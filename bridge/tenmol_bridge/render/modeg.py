"""Mode G: serve ``_cmd.web_get_rep_geometry`` over the wire.

The C++ accessor landed (WP-26, ``layer4/CmdWebGeometry.cpp``, documented in
``docs/webclient/spikes/06-geometry-accessor.md``).  This module is the *only*
thing between it and ``packages/protocol``: it takes the accessor's Python dict
and re-frames it as an ``IndexedMeshHeader`` or a ``CgoDrawArraysHeader`` binary
frame that ``decodeBinaryFrame`` / ``geometryFrameProblems`` accept, keyed per
object / per rep / per state exactly as plan §1.3 constraint 2 requires.

    accessor dict            ->  binary frame
    ----------------------------------------------------------------
    kind 'surface'           ->  indexed-mesh  (position/normal/color/
                                 alpha/ao/index/atom/vis)
    kind 'mesh'              ->  indexed-mesh  (position + strip)
    kind 'dots'              ->  cgo-draw-arrays, ONE 'sphere' instance
                                 buffer (never a triangulated point cloud)
    kind 'cgo'               ->  cgo-draw-arrays  (verbatim draw-arrays
                                 blocks + sphere/cylinder2/cone/ellipsoid
                                 instance buffers)

TWO THINGS THAT ARE EASY TO GET WRONG AND ARE NOT NEGOTIABLE
------------------------------------------------------------
1. **Impostors stay impostors.**  ``INSTANCED_ONLY_REPS`` in
   ``packages/protocol/src/geometry.ts`` makes ``geometryFrameProblems()`` FAIL
   a ``spheres`` / ``nb_spheres`` / ``dots`` / ``ellipsoids`` frame that carries
   triangles and no instances — that is the exporter regression that turned
   1UBQ ``mesh`` into 31,710 cylinders + 63,420 spheres (spike 03 §4).  Every
   bucket here goes to an ``InstanceBuffer``.

2. **The draw-arrays block is rebuilt VERBATIM.**  The accessor hands back the
   sub-arrays separately and *skips* the packed-RGBA pick slot (it is
   regenerated at pick time).  ``cgoArraysLayout()`` on the client expects the
   original consecutive layout of ``layer1/CGO.cpp:1650-1671``:

       [vertex 3N][normal 3N]?[color 4N]?[pickRGBA 1N + pickIndex 2N]?[access N]?

   so the skipped slot is re-inserted as ``N`` zero floats.  Get that wrong and
   every sub-array after the pick block is silently shifted.

INVALIDATION, HONESTLY
----------------------
Plan §4 task 6 (``ReprVersion`` change counters in ``layer3/Executive.cpp``) did
**not** land, so there is no cheap "this rep changed" counter in the C++.  What
this module does instead, in descending order of reliability:

* :meth:`GeometryService.invalidate` — the *command echo* channel of plan §1.5.
  The dispatcher already computes an ``invalidates`` list per executed command;
  wiring it here is exact and free.
* :meth:`GeometryService.scan` — a 0.03 ms fingerprint of ``cmd.get_vis()`` +
  ``cmd.get_state()`` + ``cmd.get_names()`` polled on the engine thread.  It
  catches show/hide/enable/delete/state changes and nothing else.
* content hashing at fetch time — a re-fetch of an unchanged rep answers
  ``status='unchanged'`` with no payload, so a false-positive invalidation costs
  the accessor call and not 42 MB on the wire.

That is a real limitation and it is reported rather than papered over:
:meth:`GeometryService.capabilities` returns ``exactInvalidation: False``.
"""

from __future__ import annotations

import hashlib
import struct
import threading
import time
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from ..config import log
from ..errors import BridgeError, PyMOLUnavailable
from ..session import encode_binary_frame

__all__ = [
    "REP_NAMES",
    "REP_IDS",
    "RepInv",
    "MODE_G_CAPABLE_REPS",
    "GeometryResult",
    "GeometryService",
    "rep_id",
    "rep_name",
    "TOPIC_GEOMETRY",
]

TOPIC_GEOMETRY = "geometry"

#: ``enum cRep_t``, ``layer1/Rep.h:48-74``.  Mirrors ``REP_NAMES`` in
#: ``packages/protocol/src/geometry.ts`` exactly.
REP_NAMES: Dict[int, str] = {
    0: "sticks",
    1: "spheres",
    2: "surface",
    3: "labels",
    4: "nb_spheres",
    5: "cartoon",
    6: "ribbon",
    7: "lines",
    8: "mesh",
    9: "dots",
    10: "dashes",
    11: "nonbonded",
    12: "cell",
    13: "cgo",
    14: "callback",
    15: "extent",
    16: "slice",
    17: "angles",
    18: "dihedrals",
    19: "ellipsoids",
    20: "volume",
}

REP_IDS: Dict[str, int] = {name: index for index, name in REP_NAMES.items()}

#: ``MODE_G_CAPABLE_REPS`` from ``geometry.ts``, intersected with what the
#: accessor actually implements today (spike 06 §"ALL REPS": labels is
#: ``unsupported``; cell/cgo/slice/angles/dihedrals/dashes hang off
#: non-CoordSet paths and also answer ``unsupported``).
MODE_G_CAPABLE_REPS: Tuple[int, ...] = (0, 1, 2, 4, 5, 6, 7, 8, 9, 11, 19)


class RepInv:
    """``cRepInv_t``, ``layer1/Rep.h:133-184``.  Mirrors ``RepInv`` in the TS."""

    NONE = 0
    DISPLAY = 1
    COLOR = 15
    VISIB = 20
    COORD = 30
    REP = 35
    ALL = 100


#: ``MODE_G_FALLBACK_REASONS`` in ``geometry.ts``.  A rep that cannot be served
#: gets one of these, never silence.
FALLBACK_UNSUPPORTED = "unsupported-rep"
FALLBACK_NO_ACCESSOR = "no-accessor"
FALLBACK_EXTRACTION = "extraction-failed"
FALLBACK_PRESHADER = "preshader-disposed"
FALLBACK_TOO_LARGE = "payload-too-large"

#: ``INSTANCE_ITEM_SIZE`` in ``geometry.ts`` — float32 items per instance ON THE
#: WIRE.  These differ from the raw ``CGO_*_SZ`` operand counts because a GPU
#: instance buffer cannot inherit its colour from a preceding ``CGO_COLOR``.
INSTANCE_ITEM_SIZE: Dict[str, int] = {
    "sphere": 8,
    "cylinder": 12,
    "cylinder2": 16,
    "cone": 18,
    "ellipsoid": 16,
}

#: ``CGOArrayBit``, ``layer1/CGO.h:272-277``.
BIT_VERTEX = 0x01
BIT_NORMAL = 0x02
BIT_COLOR = 0x04
BIT_PICK = 0x08
BIT_ACCESS = 0x10

_F32 = struct.Struct("<f")


def rep_id(rep: Any) -> int:
    """Accept ``'cartoon'``/``5``/``'5'`` and return the ``cRep_t``."""
    if isinstance(rep, bool):
        raise BridgeError("rep must be a name or an index, not a bool", rep=rep)
    if isinstance(rep, int):
        if rep not in REP_NAMES:
            raise BridgeError("rep index %d out of range" % rep, rep=rep)
        return rep
    text = str(rep)
    if text.isdigit():
        return rep_id(int(text))
    if text in REP_IDS:
        return REP_IDS[text]
    # Singular aliases, the way the accessor accepts them.
    singular = {
        "stick": 0,
        "sphere": 1,
        "line": 7,
        "dot": 9,
        "dash": 10,
        "label": 3,
        "nb_sphere": 4,
        "angle": 17,
        "dihedral": 18,
        "ellipsoid": 19,
    }
    if text in singular:
        return singular[text]
    raise BridgeError(
        "unknown rep %r; v1 reps are %s" % (rep, ", ".join(sorted(REP_IDS))), rep=rep
    )


def rep_name(rep: Any) -> str:
    return REP_NAMES.get(rep_id(rep), "rep%s" % rep)


# --------------------------------------------------------------------------- #
# Payload packing
# --------------------------------------------------------------------------- #


class _Packer:
    """Buffers at 4-aligned offsets; the mirror of ``BufferPacker`` in
    ``packages/protocol/python/tenmol_wire.py``.

    Re-implemented here rather than imported because ``tenmol_wire.py`` lives in
    ``packages/protocol/python/`` and is not on the bridge's import path in an
    installed build.  ``test_render.py`` asserts the two produce byte-identical
    frames whenever the repo copy is reachable.
    """

    ALIGNMENT = 4
    DTYPE_BYTES = {"f32": 4, "i32": 4, "u32": 4, "u8": 1}

    def __init__(self) -> None:
        self._chunks: List[bytes] = []
        self._size = 0

    @property
    def size(self) -> int:
        return self._size

    def add(self, data: Any, dtype: str, item_size: int) -> Dict[str, Any]:
        raw = bytes(memoryview(data).cast("B"))
        elem = self.DTYPE_BYTES[dtype]
        if len(raw) % elem:
            raise BridgeError(
                "buffer of %d bytes is not a multiple of %d (%s)"
                % (len(raw), elem, dtype)
            )
        pad = (-self._size) % self.ALIGNMENT
        if pad:
            self._chunks.append(b"\0" * pad)
            self._size += pad
        ref = {
            "byteOffset": self._size,
            "byteLength": len(raw),
            "dtype": dtype,
            "itemSize": int(item_size),
        }
        self._chunks.append(raw)
        self._size += len(raw)
        return ref

    def payload(self) -> bytes:
        return b"".join(self._chunks)


def _f32(data: Any) -> bytes:
    return bytes(memoryview(data).cast("B")) if data is not None else b""


def _deinterleave_i32(data: Any, stride: int, offset: int) -> bytes:
    """Pull every ``stride``-th int32 starting at ``offset``.

    numpy when PyMOL brought it (it always does — ``import pymol`` imports
    numpy), ``array`` otherwise, so ``modeg`` stays importable in a bridge with
    no numpy.
    """
    raw = bytes(memoryview(data).cast("B"))
    try:
        import numpy  # noqa: WPS433 - optional fast path

        arr = numpy.frombuffer(raw, dtype="<i4")
        return numpy.ascontiguousarray(arr[offset::stride]).tobytes()
    except Exception:  # noqa: BLE001
        import array

        values = array.array("i")
        values.frombytes(raw)
        if values.itemsize != 4:  # pragma: no cover - 'i' is 4 bytes everywhere
            values = array.array("l")
            values.frombytes(raw)
        out = array.array("i", values[offset::stride])
        return out.tobytes()


def _concat_f32(parts: Sequence[Tuple[Any, int]], nverts: int) -> bytes:
    """Sub-arrays laid out CONSECUTIVELY, the ``cgo::draw::arrays`` block layout.

    ``layer1/CGO.cpp:1650-1671`` and ``cgoArraysLayout()`` in ``geometry.ts``:
    ``[vertex 3N][normal 3N]?[color 4N]?[pickRGBA 1N + pickIndex 2N]?[access N]?``
    — NOT interleaved per vertex.  A ``None`` source contributes ``width*N``
    zero floats, which is how the pick-colour slot the accessor deliberately
    drops gets back into the block at the right offset.
    """
    chunks: List[bytes] = []
    for data, width in parts:
        need = width * nverts * 4
        if data is None:
            chunks.append(b"\0" * need)
            continue
        raw = bytes(memoryview(data).cast("B"))
        if len(raw) < need:
            raise BridgeError(
                "sub-array has %d bytes, %d verts * %d floats needs %d"
                % (len(raw), nverts, width, need)
            )
        chunks.append(raw[:need])
    return b"".join(chunks)


def _interleave_f32(parts: Sequence[Tuple[Any, int]], count: int) -> bytes:
    """Build ``count`` items of ``sum(widths)`` float32 from separate arrays.

    INTERLEAVED per item — this is the GPU instance-attribute layout
    (``INSTANCE_ITEM_SIZE`` in ``geometry.ts``), the opposite of
    :func:`_concat_f32`.  Getting the two the wrong way round produces a frame
    that validates and renders as noise, so they are deliberately two functions
    with two names.

    ``parts`` is ``[(bytes_or_None, floats_per_item), ...]``; a ``None`` source
    contributes that many zero floats (used for the pick-colour slot the
    accessor deliberately drops).
    """
    widths = [width for _, width in parts]
    item = sum(widths)
    try:
        import numpy  # noqa: WPS433

        out = numpy.zeros((count, item), dtype="<f4")
        cursor = 0
        for data, width in parts:
            if data is not None and width:
                src = numpy.frombuffer(bytes(memoryview(data).cast("B")), dtype="<f4")
                if src.size < count * width:
                    raise BridgeError(
                        "interleave source has %d floats, need %d"
                        % (src.size, count * width)
                    )
                out[:, cursor : cursor + width] = src[: count * width].reshape(
                    count, width
                )
            cursor += width
        return out.tobytes()
    except BridgeError:
        raise
    except Exception:  # noqa: BLE001 - no numpy
        import array

        sources: List[Optional[array.array]] = []
        for data, _width in parts:
            if data is None:
                sources.append(None)
            else:
                values = array.array("f")
                values.frombytes(bytes(memoryview(data).cast("B")))
                sources.append(values)
        out = array.array("f", bytes(4 * item * count))
        for index in range(count):
            cursor = 0
            for (source, (_data, width)) in zip(sources, parts):
                if source is not None and width:
                    base = index * width
                    out[index * item + cursor : index * item + cursor + width] = (
                        array.array("f", source[base : base + width])
                    )
                cursor += width
        return out.tobytes()


# --------------------------------------------------------------------------- #
# One fetch
# --------------------------------------------------------------------------- #


class GeometryResult:
    """The outcome of one accessor call, wire-ready.

    ``status`` is the accessor's vocabulary widened by two of ours:

    ==================  =====================================================
    ``ok``              ``frame`` holds the binary frame
    ``unchanged``       the client's ``have`` hash still matches; no payload
    ``not-built``       rep is not shown / no coordset for that state
    ``empty``           built but produced no geometry
    ``vbo-only``        the CPU copy was dropped on upload
    ``unsupported``     no accessor for this rep or object type
    ``layout-mismatch`` an upstream ``Rep`` struct moved; nothing was read
    ``no-accessor``     this PyMOL build has no ``web_get_rep_geometry``
    ==================  =====================================================
    """

    __slots__ = (
        "key",
        "object",
        "rep",
        "rep_index",
        "state",
        "status",
        "message",
        "header",
        "frame",
        "content_hash",
        "fetch_ms",
        "encode_ms",
        "fallback",
        "diagnostics",
    )

    def __init__(
        self,
        key: str,
        object_name: str,
        rep_index: int,
        state: int,
        status: str,
        message: str = "",
        header: Optional[Dict[str, Any]] = None,
        frame: Optional[bytes] = None,
        content_hash: str = "",
        fetch_ms: float = 0.0,
        encode_ms: float = 0.0,
        fallback: Optional[str] = None,
        diagnostics: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.key = key
        self.object = object_name
        self.rep_index = rep_index
        self.rep = REP_NAMES.get(rep_index, str(rep_index))
        self.state = state
        self.status = status
        self.message = message
        self.header = header
        self.frame = frame
        self.content_hash = content_hash
        self.fetch_ms = fetch_ms
        self.encode_ms = encode_ms
        self.fallback = fallback
        self.diagnostics = diagnostics or {}

    @property
    def ok(self) -> bool:
        return self.status == "ok"

    @property
    def nbytes(self) -> int:
        return len(self.frame) if self.frame else 0

    def to_json(self) -> Dict[str, Any]:
        """The ``ok`` result of a ``_bridge.get_geometry`` call.

        The bulk NEVER travels in JSON: this is the descriptor, and the frame
        goes out of band as a WebSocket binary frame.
        """
        return {
            "key": self.key,
            "object": self.object,
            "rep": self.rep,
            "repIndex": self.rep_index,
            "state": self.state,
            "status": self.status,
            "message": self.message,
            "hash": self.content_hash,
            "bytes": self.nbytes,
            "fetchMs": round(self.fetch_ms, 3),
            "encodeMs": round(self.encode_ms, 3),
            "fallbackReason": self.fallback,
            "diagnostics": self.diagnostics,
        }


# --------------------------------------------------------------------------- #
# The service
# --------------------------------------------------------------------------- #


class GeometryService:
    """Fetch, convert, cache and invalidate Mode-G payloads."""

    #: Refuse to build a frame bigger than this.  1AON cartoon is 42 MB from
    #: the accessor (spike 06); pushing that per frame is not viable, so it is
    #: a per-rep pull with a hard ceiling and an honest fallback reason.
    max_frame_bytes = 96 * 1024 * 1024

    def __init__(self, pump: Any, on_event: Optional[Any] = None) -> None:
        self.pump = pump
        self.on_event = on_event
        self._lock = threading.Lock()
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._dirty: Dict[str, int] = {}
        self._fingerprint: Optional[str] = None
        self._seq = 0
        self.fetches = 0
        self.cache_hits = 0
        self.errors = 0
        self.last_error: Optional[str] = None
        self._accessor_checked = False
        self._accessor: Optional[Any] = None

    # -- capability --------------------------------------------------------

    def accessor(self, engine: Any) -> Optional[Any]:
        """``_cmd.web_get_rep_geometry`` or ``None`` if this build lacks it."""
        if not self._accessor_checked:
            self._accessor_checked = True
            try:
                from pymol import _cmd  # noqa: WPS433 - only exists with PyMOL

                self._accessor = getattr(_cmd, "web_get_rep_geometry", None)
            except Exception as exc:  # noqa: BLE001
                self._accessor = None
                self.last_error = repr(exc)
            if self._accessor is None:
                log(
                    "Mode G disabled: this PyMOL build has no "
                    "_cmd.web_get_rep_geometry (layer4/CmdWebGeometry.cpp); "
                    "every rep falls back to Mode P"
                )
        return self._accessor

    def capabilities(self, engine: Any = None) -> Dict[str, Any]:
        engine = engine if engine is not None else getattr(self.pump, "engine", None)
        # BOTH conditions matter.  ``from pymol import _cmd`` succeeds in a
        # DEGRADED bridge — the module is importable, PyMOL just never started
        # — so checking only for the symbol reports Mode G as available on a
        # process that cannot serve a single rep.
        available = (
            engine is not None
            and getattr(engine, "cmd", None) is not None
            and self.accessor(engine) is not None
        )
        return {
            "accessor": available,
            "symbol": "_cmd.web_get_rep_geometry",
            "capableReps": [
                {"rep": index, "name": REP_NAMES[index]}
                for index in MODE_G_CAPABLE_REPS
            ],
            # Plan §4 task 6 (ReprVersion counters) is NOT implemented, so the
            # bridge cannot say "only the colours changed" from the C++ side.
            "exactInvalidation": False,
            "invalidationSources": ["command-echo", "vis-fingerprint", "content-hash"],
            "maxFrameBytes": self.max_frame_bytes,
            "fallbackReason": None if available else FALLBACK_NO_ACCESSOR,
        }

    # -- keys --------------------------------------------------------------

    @staticmethod
    def key(object_name: str, state: int, rep: Any) -> str:
        """``geometryKey()`` from ``geometry.ts``: NUL-separated.

        A PyMOL object name may legally contain spaces, slashes and dots, so
        the separator has to be a character a name cannot contain.
        """
        return "\x00".join((str(object_name), str(int(state)), str(rep_id(rep))))

    @staticmethod
    def parse_key(key: str) -> Optional[Tuple[str, int, int]]:
        parts = key.split("\x00")
        if len(parts) != 3:
            return None
        try:
            return parts[0], int(parts[1]), int(parts[2])
        except ValueError:
            return None

    # -- fetch -------------------------------------------------------------

    def fetch(
        self,
        engine: Any,
        object_name: str,
        rep: Any,
        state: int = -1,
        update: bool = True,
        have: Optional[str] = None,
    ) -> GeometryResult:
        """One accessor call, converted to a binary frame.  Engine thread only.

        ``have`` is the client's cached content hash; when it still matches, the
        result is ``status='unchanged'`` and carries no payload.
        """
        cmd = engine.cmd
        if cmd is None:
            raise PyMOLUnavailable("cannot read geometry: PyMOL is not available")
        index = rep_id(rep)
        name = REP_NAMES[index]
        key = self.key(object_name, state, index)

        accessor = self.accessor(engine)
        if accessor is None:
            return GeometryResult(
                key,
                object_name,
                index,
                state,
                "no-accessor",
                "this PyMOL build has no _cmd.web_get_rep_geometry",
                fallback=FALLBACK_NO_ACCESSOR,
            )

        self.fetches += 1
        t0 = time.perf_counter()
        # The accessor follows the standard "_cmd assumes the API lock is held"
        # contract (spike 06 §7) and uses the BLOCKED entry convention, so it
        # must run on the engine thread and never on the status thread.
        cmd.lock(_self=cmd)
        try:
            raw = accessor(cmd._COb, str(object_name), int(state), name, 1 if update else 0)
        except Exception as exc:  # noqa: BLE001
            self.errors += 1
            self.last_error = repr(exc)
            return GeometryResult(
                key,
                object_name,
                index,
                state,
                "unsupported",
                str(exc),
                fetch_ms=(time.perf_counter() - t0) * 1000.0,
                fallback=FALLBACK_EXTRACTION,
            )
        finally:
            cmd.unlock(-1, _self=cmd)
        fetch_ms = (time.perf_counter() - t0) * 1000.0

        status = str(raw.get("status", "unsupported"))
        # The accessor resolves state=-1 to a real index and tells us which.
        resolved_state = int(raw.get("state", state))
        key = self.key(object_name, resolved_state, index)
        if status != "ok":
            return GeometryResult(
                key,
                object_name,
                index,
                resolved_state,
                status,
                str(raw.get("message", "")),
                fetch_ms=fetch_ms,
                fallback=_fallback_for(status),
            )

        t1 = time.perf_counter()
        try:
            header, payload, diagnostics = self._convert(
                raw, object_name, index, resolved_state
            )
        except BridgeError:
            raise
        except Exception as exc:  # noqa: BLE001
            self.errors += 1
            self.last_error = repr(exc)
            log("Mode G conversion failed for %s: %r" % (key, exc))
            return GeometryResult(
                key,
                object_name,
                index,
                resolved_state,
                "extraction-failed",
                repr(exc),
                fetch_ms=fetch_ms,
                encode_ms=(time.perf_counter() - t1) * 1000.0,
                fallback=FALLBACK_EXTRACTION,
            )

        digest = hashlib.blake2b(payload, digest_size=16).hexdigest()
        if have and have == digest:
            self.cache_hits += 1
            with self._lock:
                self._cache[key] = {"hash": digest, "bytes": len(payload)}
            return GeometryResult(
                key,
                object_name,
                index,
                resolved_state,
                "unchanged",
                "content hash unchanged",
                content_hash=digest,
                fetch_ms=fetch_ms,
                encode_ms=(time.perf_counter() - t1) * 1000.0,
                diagnostics=diagnostics,
            )

        self._seq += 1
        header["seq"] = self._seq
        header["hash"] = digest
        header["payloadBytes"] = len(payload)
        frame = encode_binary_frame(header, payload)
        encode_ms = (time.perf_counter() - t1) * 1000.0

        if len(frame) > self.max_frame_bytes:
            return GeometryResult(
                key,
                object_name,
                index,
                resolved_state,
                "payload-too-large",
                "%d bytes exceeds the %d byte per-rep ceiling"
                % (len(frame), self.max_frame_bytes),
                content_hash=digest,
                fetch_ms=fetch_ms,
                encode_ms=encode_ms,
                fallback=FALLBACK_TOO_LARGE,
                diagnostics=diagnostics,
            )

        with self._lock:
            self._cache[key] = {"hash": digest, "bytes": len(frame)}
            self._dirty.pop(key, None)
        return GeometryResult(
            key,
            object_name,
            index,
            resolved_state,
            "ok",
            "",
            header=header,
            frame=frame,
            content_hash=digest,
            fetch_ms=fetch_ms,
            encode_ms=encode_ms,
            diagnostics=diagnostics,
        )

    # -- conversion --------------------------------------------------------

    def _convert(
        self, raw: Dict[str, Any], object_name: str, index: int, state: int
    ) -> Tuple[Dict[str, Any], bytes, Dict[str, Any]]:
        kind = str(raw.get("kind", ""))
        if kind == "surface":
            return self._indexed_mesh(raw, object_name, index, state)
        if kind == "mesh":
            return self._strip_mesh(raw, object_name, index, state)
        if kind == "dots":
            return self._dots(raw, object_name, index, state)
        if kind == "cgo":
            return self._cgo(raw, object_name, index, state)
        raise BridgeError("accessor returned unknown kind %r" % (kind,), kind=kind)

    def _common(self, object_name: str, index: int, state: int) -> Dict[str, Any]:
        return {
            "v": 1,
            "object": object_name,
            "state": int(state),
            "rep": int(index),
            "payloadBytes": 0,
            "seq": 0,
        }

    def _indexed_mesh(
        self, raw: Dict[str, Any], object_name: str, index: int, state: int
    ) -> Tuple[Dict[str, Any], bytes, Dict[str, Any]]:
        packer = _Packer()
        buffers: Dict[str, Any] = {
            "position": packer.add(raw["vertex"], "f32", 3),
        }
        if raw.get("normal"):
            buffers["normal"] = packer.add(raw["normal"], "f32", 3)
        if raw.get("color"):
            buffers["color"] = packer.add(raw["color"], "f32", 3)
        if raw.get("alpha"):
            buffers["alpha"] = packer.add(raw["alpha"], "f32", 1)
        if raw.get("ao"):
            buffers["ao"] = packer.add(raw["ao"], "f32", 1)
        if raw.get("index"):
            buffers["index"] = packer.add(raw["index"], "i32", 3)
        if raw.get("atom"):
            buffers["atom"] = packer.add(raw["atom"], "i32", 1)
        if raw.get("visible"):
            buffers["vis"] = packer.add(raw["visible"], "i32", 1)

        one_color = None
        if raw.get("one_color_flag"):
            rgb = raw.get("rgb") or [1.0, 1.0, 1.0]
            one_color = [float(component) for component in rgb[:3]]

        header = self._common(object_name, index, state)
        header.update(
            {
                "kind": "indexed-mesh",
                "counts": {
                    "verts": int(raw.get("n_vert", 0)),
                    "tris": int(raw.get("n_tri", 0)),
                },
                "buffers": buffers,
                "proximity": bool(raw.get("proximity", False)),
                "oneColor": one_color,
                "defaultAlpha": float(raw.get("default_alpha", 1.0)),
                "surfaceMode": raw.get("surface_mode"),
                "surfaceType": raw.get("surface_type"),
            }
        )
        diagnostics = {
            "source": raw.get("source", "surface"),
            "nVert": int(raw.get("n_vert", 0)),
            "nTri": int(raw.get("n_tri", 0)),
        }
        return header, packer.payload(), diagnostics

    def _strip_mesh(
        self, raw: Dict[str, Any], object_name: str, index: int, state: int
    ) -> Tuple[Dict[str, Any], bytes, Dict[str, Any]]:
        """``RepMesh``: line strips, NOT the 31,710 cylinders the exporters emit."""
        packer = _Packer()
        buffers: Dict[str, Any] = {"position": packer.add(raw["vertex"], "f32", 3)}
        if raw.get("strips"):
            buffers["strip"] = packer.add(raw["strips"], "i32", 1)
        if raw.get("color"):
            buffers["color"] = packer.add(raw["color"], "f32", 3)
        one_color = None
        if raw.get("one_color_flag") or not raw.get("color"):
            rgb = raw.get("rgb") or [1.0, 1.0, 1.0]
            one_color = [float(component) for component in rgb[:3]]

        header = self._common(object_name, index, state)
        header.update(
            {
                "kind": "indexed-mesh",
                "counts": {"verts": int(raw.get("n_vert", 0)), "tris": 0},
                "buffers": buffers,
                "proximity": False,
                "oneColor": one_color,
                "meshType": raw.get("mesh_type"),
                "nStrip": int(raw.get("n_strip", 0)),
            }
        )
        diagnostics = {
            "source": "RepMesh",
            "nVert": int(raw.get("n_vert", 0)),
            "nStrip": int(raw.get("n_strip", 0)),
        }
        return header, packer.payload(), diagnostics

    def _dots(
        self, raw: Dict[str, Any], object_name: str, index: int, state: int
    ) -> Tuple[Dict[str, Any], bytes, Dict[str, Any]]:
        """``RepDot`` as sphere INSTANCES.

        ``INSTANCED_ONLY_REPS`` includes ``Rep.Dot``, so a draw-arrays point
        cloud would be rejected by ``geometryFrameProblems()``.  Radius 0 means
        "screen-space point of ``dot_width`` pixels"; a non-zero radius is what
        ``dot_as_spheres`` asks for.
        """
        count = int(raw.get("n_vert", 0))
        packer = _Packer()
        radius = float(raw.get("dot_radius", 0.0) or 0.0)
        rgba = _rgb_to_rgba(raw.get("color"), count)
        data = _interleave_f32(
            [
                (raw.get("vertex"), 3),
                (_const_f32(radius, count), 1),
                (rgba, 4),
            ],
            count,
        )
        instance: Dict[str, Any] = {
            "kind": "sphere",
            "count": count,
            "itemSize": INSTANCE_ITEM_SIZE["sphere"],
            "data": packer.add(data, "f32", INSTANCE_ITEM_SIZE["sphere"]),
        }
        if raw.get("atom"):
            instance["atom"] = packer.add(raw["atom"], "i32", 1)

        header = self._common(object_name, index, state)
        header.update(
            {
                "kind": "cgo-draw-arrays",
                "blocks": [],
                "instances": [instance],
                "pointSize": float(raw.get("width", 1.0) or 1.0),
                "dotSize": float(raw.get("dot_size", 0.0) or 0.0),
            }
        )
        diagnostics = {"source": "RepDot", "dots": count}
        return header, packer.payload(), diagnostics

    def _cgo(
        self, raw: Dict[str, Any], object_name: str, index: int, state: int
    ) -> Tuple[Dict[str, Any], bytes, Dict[str, Any]]:
        packer = _Packer()
        blocks: List[Dict[str, Any]] = []
        instances: List[Dict[str, Any]] = []

        for group in ("draw_arrays", "begin_end"):
            for entry in raw.get(group) or ():
                block = self._draw_arrays_block(packer, entry)
                if block is not None:
                    blocks.append(block)

        for builder in (
            self._spheres,
            self._cylinders,
            self._cones,
            self._ellipsoids,
        ):
            built = builder(packer, raw)
            if built is not None:
                instances.append(built)

        header = self._common(object_name, index, state)
        header.update(
            {
                "kind": "cgo-draw-arrays",
                "blocks": blocks,
                "instances": instances,
            }
        )
        # Buckets the accessor supports that the v1 wire schema has no instance
        # kind for.  Carried as counts so the client can say WHY something is
        # missing instead of drawing a partial molecule silently.
        extras = {}
        for bucket in ("triangles", "lines", "crosses"):
            entry = raw.get(bucket) or {}
            if int(entry.get("n", 0) or 0):
                extras[bucket] = int(entry["n"])
        if extras:
            header["unmapped"] = extras
        if raw.get("nonbonded_size") is not None:
            header["nonbondedSize"] = float(raw["nonbonded_size"])

        diagnostics = {
            "source": raw.get("source", ""),
            "ops": raw.get("ops", {}),
            "unhandledOps": raw.get("unhandled_ops", {}),
            "vboOps": int(raw.get("vbo_ops", 0) or 0),
            "blocks": len(blocks),
            "instances": [
                {"kind": inst["kind"], "count": inst["count"]} for inst in instances
            ],
            "unmapped": extras,
        }
        return header, packer.payload(), diagnostics

    # -- cgo buckets -------------------------------------------------------

    def _draw_arrays_block(
        self, packer: _Packer, entry: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        nverts = int(entry.get("nverts", 0) or 0)
        if nverts <= 0:
            return None
        vertex = entry.get("vertex")
        if not vertex:
            return None
        normal = entry.get("normal")
        rgba = entry.get("rgba")
        pick = entry.get("pick")
        access = entry.get("accessibility")

        arraybits = BIT_VERTEX
        parts: List[Tuple[Any, int]] = [(vertex, 3)]
        if normal:
            arraybits |= BIT_NORMAL
            parts.append((normal, 3))
        if rgba:
            arraybits |= BIT_COLOR
            parts.append((rgba, 4))
        if pick:
            arraybits |= BIT_PICK
            # The accessor SKIPS the packed-RGBA pick slot (regenerated at pick
            # time), but cgoArraysLayout() still expects its 1*N floats before
            # the 2*N index pair.  Re-insert it as zeros or every later
            # sub-array is shifted.
            parts.append((None, 1))
            parts.append((pick, 2))
        if access:
            arraybits |= BIT_ACCESS
            parts.append((access, 1))

        data = _concat_f32(parts, nverts)
        return {
            "mode": int(entry.get("mode", 4)),
            "arraybits": arraybits,
            "nverts": nverts,
            "data": packer.add(data, "f32", sum(width for _s, width in parts)),
        }

    def _spheres(
        self, packer: _Packer, raw: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        bucket = raw.get("spheres") or {}
        count = int(bucket.get("n", 0) or 0)
        if not count:
            return None
        data = _interleave_f32([(bucket.get("xyzr"), 4), (bucket.get("rgba"), 4)], count)
        return self._instance(packer, "sphere", count, data, bucket.get("pick"))

    def _cylinders(
        self, packer: _Packer, raw: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        bucket = raw.get("cylinders") or {}
        count = int(bucket.get("n", 0) or 0)
        if not count:
            return None
        # cylinder2 = origin[3] axis[3] radius capbits rgba1[4] rgba2[4] = 16.
        # The accessor always carries both colours (CGO_SHADER_CYLINDER_WITH_
        # 2ND_COLOR is what RepCylBond emits), so cylinder2 is the honest kind.
        cap = _i32_to_f32(bucket.get("cap"), count)
        data = _interleave_f32(
            [
                (bucket.get("origin_axis_radius"), 7),
                (cap, 1),
                (bucket.get("rgba1"), 4),
                (bucket.get("rgba2"), 4),
            ],
            count,
        )
        return self._instance(
            packer, "cylinder2", count, data, bucket.get("pick1"), bucket.get("pick2")
        )

    def _cones(self, packer: _Packer, raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        bucket = raw.get("cones") or {}
        count = int(bucket.get("n", 0) or 0)
        if not count:
            return None
        cap = _i32_to_f32(bucket.get("cap"), count * 2)
        data = _interleave_f32(
            [
                (bucket.get("v1v2_r1r2"), 8),
                (cap, 2),
                (bucket.get("rgba1"), 4),
                (bucket.get("rgba2"), 4),
            ],
            count,
        )
        return self._instance(packer, "cone", count, data, bucket.get("pick"))

    def _ellipsoids(
        self, packer: _Packer, raw: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        bucket = raw.get("ellipsoids") or {}
        count = int(bucket.get("n", 0) or 0)
        if not count:
            return None
        # ellipsoid = center[3] m[9] rgba[4] = 16.  The accessor's xyzr carries
        # a 4th component (the bounding radius) that the wire layout has no slot
        # for; the 3x3 in `axes` already encodes the semi-axes.
        centers = _drop_fourth(bucket.get("xyzr"), count)
        data = _interleave_f32(
            [(centers, 3), (bucket.get("axes"), 9), (bucket.get("rgba"), 4)], count
        )
        return self._instance(packer, "ellipsoid", count, data, bucket.get("pick"))

    def _instance(
        self,
        packer: _Packer,
        kind: str,
        count: int,
        data: bytes,
        pick: Any = None,
        pick2: Any = None,
    ) -> Dict[str, Any]:
        item = INSTANCE_ITEM_SIZE[kind]
        expect = count * item * 4
        if len(data) != expect:
            raise BridgeError(
                "%s instance buffer is %d bytes, count(%d) * itemSize(%d) * 4 = %d"
                % (kind, len(data), count, item, expect),
                kind=kind,
            )
        out: Dict[str, Any] = {
            "kind": kind,
            "count": count,
            "itemSize": item,
            "data": packer.add(data, "f32", item),
        }
        if pick:
            # (atom, bond) interleaved int32 -> two flat int32 buffers.
            out["atom"] = packer.add(_deinterleave_i32(pick, 2, 0), "i32", 1)
            out["bond"] = packer.add(_deinterleave_i32(pick, 2, 1), "i32", 1)
        if pick2:
            out["atom2"] = packer.add(_deinterleave_i32(pick2, 2, 0), "i32", 1)
        return out

    # -- invalidation ------------------------------------------------------

    def invalidate(
        self,
        objects: Optional[Iterable[str]] = None,
        keys: Optional[Iterable[str]] = None,
        level: int = RepInv.ALL,
    ) -> List[Dict[str, Any]]:
        """Mark geometry stale.  The command-echo channel calls this.

        Returns the ``GeometryInvalidation[]`` the ``geometry`` topic carries.
        """
        out: List[Dict[str, Any]] = []
        with self._lock:
            cached = list(self._cache.items())
        names = set(objects or ())
        wanted = set(keys or ())
        for key, entry in cached:
            parsed = self.parse_key(key)
            if parsed is None:
                continue
            name, state, index = parsed
            if wanted and key not in wanted:
                continue
            if names and name not in names:
                continue
            if not wanted and not names:
                pass  # invalidate everything
            with self._lock:
                self._dirty[key] = int(level)
            out.append(
                {
                    "object": name,
                    "state": state,
                    "rep": index,
                    "level": int(level),
                    "estimatedBytes": int(entry.get("bytes", 0)),
                }
            )
        return out

    def scan(self, engine: Any) -> List[Dict[str, Any]]:
        """Poll the cheap scene fingerprint.  Engine thread only.

        ``cmd.get_vis()`` is 0.0007 ms and changes on show/hide/enable/delete;
        ``cmd.get_state()`` catches a state change.  It is NOT a complete dirty
        signal — see the module docstring — and that is what
        ``capabilities()['exactInvalidation'] = False`` is telling the client.
        """
        cmd = engine.cmd
        if cmd is None:
            return []
        try:
            fingerprint = repr(
                (
                    sorted((cmd.get_vis() or {}).items()),
                    int(cmd.get_state()),
                    int(cmd.get_frame()),
                )
            )
        except Exception as exc:  # noqa: BLE001
            self.last_error = repr(exc)
            return []
        digest = hashlib.blake2b(
            fingerprint.encode("utf-8", "replace"), digest_size=8
        ).hexdigest()
        if digest == self._fingerprint:
            return []
        first = self._fingerprint is None
        self._fingerprint = digest
        if first:
            return []
        return self.invalidate(level=RepInv.VISIB)

    def dirty_keys(self) -> Dict[str, int]:
        with self._lock:
            return dict(self._dirty)

    def forget(self, key: Optional[str] = None) -> None:
        with self._lock:
            if key is None:
                self._cache.clear()
                self._dirty.clear()
            else:
                self._cache.pop(key, None)
                self._dirty.pop(key, None)

    # -- diagnostics -------------------------------------------------------

    def stats(self) -> Dict[str, Any]:
        with self._lock:
            cached = len(self._cache)
            cached_bytes = sum(int(e.get("bytes", 0)) for e in self._cache.values())
            dirty = len(self._dirty)
        return {
            "fetches": self.fetches,
            "cacheHits": self.cache_hits,
            "errors": self.errors,
            "lastError": self.last_error,
            "cachedKeys": cached,
            "cachedBytes": cached_bytes,
            "dirtyKeys": dirty,
            "seq": self._seq,
            "capabilities": self.capabilities(),
        }


# --------------------------------------------------------------------------- #
# small helpers
# --------------------------------------------------------------------------- #


def _fallback_for(status: str) -> Optional[str]:
    return {
        "unsupported": FALLBACK_UNSUPPORTED,
        "layout-mismatch": FALLBACK_EXTRACTION,
        "vbo-only": FALLBACK_PRESHADER,
        "empty": None,
        "not-built": None,
    }.get(status, FALLBACK_EXTRACTION)


def _const_f32(value: float, count: int) -> bytes:
    return _F32.pack(float(value)) * count


def _rgb_to_rgba(rgb: Any, count: int) -> Optional[bytes]:
    """Widen an f32 RGB triple stream to RGBA with alpha 1."""
    if not rgb:
        return None
    return _interleave_f32([(rgb, 3), (_const_f32(1.0, count), 1)], count)


def _i32_to_f32(data: Any, count: int) -> bytes:
    """int32 flags -> float32, so they can sit in an instance's float buffer."""
    if not data:
        return _const_f32(0.0, count)
    try:
        import numpy  # noqa: WPS433

        values = numpy.frombuffer(bytes(memoryview(data).cast("B")), dtype="<i4")
        return numpy.ascontiguousarray(
            values[:count].astype("<f4")
        ).tobytes()
    except Exception:  # noqa: BLE001
        import array

        values_a = array.array("i")
        values_a.frombytes(bytes(memoryview(data).cast("B")))
        return array.array("f", [float(v) for v in values_a[:count]]).tobytes()


def _drop_fourth(data: Any, count: int) -> bytes:
    """xyzr -> xyz."""
    if not data:
        return _const_f32(0.0, count * 3)
    try:
        import numpy  # noqa: WPS433

        values = numpy.frombuffer(
            bytes(memoryview(data).cast("B")), dtype="<f4"
        ).reshape(-1, 4)
        return numpy.ascontiguousarray(values[:count, :3]).tobytes()
    except Exception:  # noqa: BLE001
        import array

        values_a = array.array("f")
        values_a.frombytes(bytes(memoryview(data).cast("B")))
        out = array.array("f")
        for index in range(count):
            out.extend(values_a[index * 4 : index * 4 + 3])
        return out.tobytes()
