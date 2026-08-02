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

INVALIDATION — NOW EXACT (defect D1)
------------------------------------
Plan §4 task 6 landed in wave 2: ``_cmd.web_get_versions``
(``layer4/CmdWebGeometry.cpp:2145``) returns a monotonic version and an
``active`` flag per ``(object, rep, state)``, backed by four counters on
``struct CExecutive``.  :meth:`GeometryService.scan` polls it on the engine
thread and diffs it in :mod:`tenmol_bridge.state.repversions`, which is where
the semantics (and the measurements) are documented.

Three channels, in descending order of reliability:

* **rep-version counters** — exact.  Names the key AND says whether it is still
  drawn, which is the half the old fingerprint could not express: ``hide
  everything`` now emits ``{rep: cartoon, active: false, reason: 'hidden'}`` and
  the client DROPS the buffers instead of leaving them on screen.  Measured on
  1UBQ in this tree: 1.0 µs per idle poll, 0 changes over 300 idle polls,
  ``color red, resi 1-20`` reported as a version bump that ``get_vis()`` cannot
  see at all.
* :meth:`GeometryService.invalidate` — the *command echo* channel of plan §1.5,
  still wired, still exact for the objects a command touched.
* the ``get_vis()`` fingerprint — kept ONLY as the fallback for a PyMOL build
  without ``web_get_versions``, and it still cannot see a recolour.  When it is
  in use ``capabilities()['exactInvalidation']`` is ``False``, as before.

Content hashing at fetch time is unchanged and is now a second line of defence
rather than the primary signal: a re-fetch of an unchanged rep still answers
``status='unchanged'`` with no payload.

HOW THE CLIENT SEES IT
----------------------
Two routes, because the viewport package cannot reach topic events today (its
``ViewportTransport`` has no ``onTopic``):

* push — :meth:`scan` returns the diff and ``RenderService._on_tick`` emits it
  on the ``geometry`` topic;
* pull — :meth:`versions_payload` puts the WHOLE current table (compact rows)
  plus an ``epoch`` into ``_bridge.render_stats``, so a client diffs it itself.
  Stateless per client, so it is also immune to the D4 fan-out bug: two clients
  each get the truth rather than each other's events.
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
from ..state import repversions

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
#: accessor actually implements today.
#:
#: THIS LIST IS A PROMISE, AND IT WAS WRONG.  ``_resolve`` in
#: ``render/__init__.py`` answers ``set_render_mode`` with ``unsupported-rep``
#: for anything missing here, and ``capabilities()['capableReps']`` is what a
#: client is told it may ask for -- so a rep left off this tuple is a rep the
#: bridge keeps rasterising for ever, however well the accessor serves it.
#:
#: The old comment said "cell/cgo/slice/angles/dihedrals/dashes hang off
#: non-CoordSet paths and also answer ``unsupported``".  That was true of spike
#: 06 and is no longer true of this tree.  Re-measured against a real PyMOL
#: built from this source (``bridge/tests/test_modeg_objects.py`` is the
#: executable form of the table):
#:
#:     dashes    (10)  RepDistDash::V              status ok, 16 line instances
#:     cell      (12)  CoordSet::UnitCellCGO       status ok, 1 draw-arrays block
#:                                                 (GL_LINES, 24 verts)
#:     cgo       (13)  ObjectCGO::origCGO          status ok, 1 begin/end block
#:     extent    (15)  CObject::ExtentMin/Max      status ok, 12 line instances
#:     angles    (17)  RepAngle::V                 status ok, 52 line instances
#:     dihedrals (18)  RepDihedral::V              status ok, 55 line instances
#:
#: Still excluded, each for a reason that has been checked rather than assumed:
#:   3  labels    -- the accessor answers ``unsupported``; text needs an atlas.
#:   14 callback  -- arbitrary user GL at render time; nothing to serialise.
#:   16 slice     -- needs an ObjectMap to exist before it can be exercised, and
#:                   nothing in ``test/dat`` carries one.  NOT claimed here
#:                   because it has not been measured in this tree.
#:   20 volume    -- a 3-D field, served by ``cmd.get_volume_field``.
MODE_G_CAPABLE_REPS: Tuple[int, ...] = (
    0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 17, 18, 19,
)


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
    # `line` carries both endpoint colours because CGO_SPLITLINE bicolours a
    # single segment.  The accessor funnels lines / ribbon / nonbonded / cell /
    # extent / dashes / angles / dihedrals through this one bucket, so these two
    # packers are what take eight reps off the Mode-P fallback list.
    "line": 14,
    "cross": 7,
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
        # -- exact invalidation (D1) --------------------------------------
        self._versions_checked = False
        self._versions_fn: Optional[Any] = None
        #: ``{geometry key: RepVersion}`` as of the last successful poll.
        self._table: Dict[str, repversions.RepVersion] = {}
        self._table_primed = False
        #: Bumps ONLY when :attr:`_table` changed in a way a client cares
        #: about, so a polling client can skip the diff entirely.
        self._epoch = 0
        self._version_serial = 0
        self._version_polls = 0
        self._version_walks = 0
        self._version_changes = 0
        self._version_error: Optional[str] = None
        self._last_changes: List[Dict[str, Any]] = []

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

    def versions_fn(self) -> Optional[Any]:
        """``_cmd.web_get_versions`` or ``None`` on a wave-1 PyMOL build.

        Cheap and thread-safe (one ``getattr`` on an already-imported module),
        so :meth:`capabilities` may call it from the WebSocket thread.  Calling
        the returned function is NOT thread-safe — that is engine-thread only,
        see :meth:`poll_versions`.
        """
        if not self._versions_checked:
            self._versions_checked = True
            try:
                from pymol import _cmd  # noqa: WPS433 - only exists with PyMOL

                self._versions_fn = getattr(_cmd, "web_get_versions", None)
            except Exception as exc:  # noqa: BLE001
                self._versions_fn = None
                self._version_error = repr(exc)
            if self._versions_fn is None:
                log(
                    "Mode G invalidation is INEXACT: this PyMOL build has no "
                    "_cmd.web_get_versions (layer4/CmdWebGeometry.cpp); falling "
                    "back to the get_vis() fingerprint, which cannot see a "
                    "recolour and cannot say which rep to DROP (defect D1)"
                )
        return self._versions_fn

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
        exact = available and self.versions_fn() is not None
        sources = ["command-echo", "content-hash"]
        sources.insert(0, "rep-version-counters" if exact else "vis-fingerprint")
        return {
            "accessor": available,
            "symbol": "_cmd.web_get_rep_geometry",
            "capableReps": [
                {"rep": index, "name": REP_NAMES[index]}
                for index in MODE_G_CAPABLE_REPS
            ],
            # True only when `_cmd.web_get_versions` is present: then every
            # invalidation names a key AND says whether it is still drawn, so a
            # client can DROP as well as REFETCH (defect D1).
            "exactInvalidation": exact,
            "versionSymbol": "_cmd.web_get_versions",
            "invalidationSources": sources,
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

        # A DISABLED OBJECT MUST NOT BE SERVED.  `cmd.hide('everything')` does
        # NOT clear the reps of a disabled object -- measured:
        #
        #   fetch 1ejg, e ; disable e ; hide everything
        #   -> _cmd.web_get_versions row ('e','cartoon|0', version 1,
        #      rep_active TRUE, enabled FALSE)
        #   -> _cmd.web_get_rep_geometry('e', 'cartoon') = status 'ok',
        #      266,592 bytes of a perfectly good cartoon
        #
        # so the accessor answers a rep the version table already calls
        # inactive, and Mode G drew a molecule Mode P was not drawing.  Seen in
        # a browser: 1UBQ's cartoon plus a stale cyan 1EJG floating beside it,
        # IoU against Mode P 0.704.  `state/repversions.py` already folds
        # `enabled` into the wire `active`, so this is just making the fetch
        # path agree with the invalidation path.  `not-built` is the existing
        # "nothing to draw, not an error" status and the client already drops
        # on it (`EMPTY_STATUSES` in modeG/sources.ts).
        try:
            # Only for an object that EXISTS and is disabled.  A name that does
            # not exist at all must keep falling through to the accessor, which
            # answers `unsupported` -- "disabled" and "no such object" are
            # different facts and the client acts on them differently.
            if str(object_name) in cmd.get_names("objects") and str(
                object_name
            ) not in cmd.get_names("objects", enabled_only=1):
                return GeometryResult(
                    key,
                    object_name,
                    index,
                    state,
                    "not-built",
                    "object is disabled; Mode P is not drawing it either",
                )
        except Exception:  # noqa: BLE001 - a missing object is handled below
            pass

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

        # THE CELL RENDERS WHITE, AND THE COLOUR IS NOT IN THE GEOMETRY.
        # `CrystalGetUnitCellCGO` emits vertices and nothing else -- the block
        # arrives `arraybits: 1`, 24 verts, no colour array -- because PyMOL
        # colours it at RENDER time: `CoordSet::render` calls
        # `CGORender(UnitCellCGO, color, ...)` with `color` from
        # `ResolveCellColor` (`layer2/CoordSet.cpp:1281-1291,1412-1416`), which
        # is the `cell_color` setting or, when that is negative (the default),
        # the OBJECT's colour.  A client that only sees the buffer has no way
        # to know that, so it drew a white box over a green one.  Resolve it
        # here, on the engine thread, and hand it down as `rgb` -- the same key
        # the accessor already uses for extent/dashes/angles/dihedrals.
        if index == REP_IDS["cell"] and not raw.get("rgb"):
            rgb = self._cell_rgb(cmd, object_name)
            if rgb is not None:
                raw["rgb"] = rgb

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

    @staticmethod
    def _cell_rgb(cmd: Any, object_name: str) -> Optional[Tuple[float, float, float]]:
        """``ResolveCellColor`` in Python.  ``None`` when it cannot be read.

        Must run with the API lock RELEASED: every call below takes its own.
        Failure is never fatal -- a missing colour only means the client falls
        back to the buffer's own (white), which is what it did before.
        """
        try:
            color = int(cmd.get_setting_int("cell_color", str(object_name)))
            if color < 0:
                # `cell_color` unset -> the object's own colour, exactly as
                # `ResolveCellColor` does.
                color = int(cmd.get_object_color_index(str(object_name)))
            rgb = cmd.get_color_tuple(color)
        except Exception:  # noqa: BLE001 - diagnostics only, never fatal
            return None
        if not rgb or len(rgb) < 3:
            return None
        return (float(rgb[0]), float(rgb[1]), float(rgb[2]))

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
        # ``RepDot::VN`` -- one normal per dot, which ``RepDot`` shades with and
        # which had nowhere to go until now (parity row 131: "UNLIT because the
        # wire buffer carries no normal").  It rides as an OPTIONAL SUB-BUFFER,
        # the same shape ``atom``/``bond``/``atom2`` already use, so the 8-float
        # ``sphere`` record is untouched and every size check on it still holds.
        normals = raw.get("normal")
        if normals is not None and len(memoryview(normals).cast("B")) == count * 3 * 4:
            instance["normal"] = packer.add(normals, "f32", 3)

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

        # `CGORender(cgo, color, ...)` takes a colour POINTER used for every
        # vertex the CGO does not colour itself; the unit cell is the rep that
        # relies on it (see `fetch`).  `rgb` is that pointer, on the wire.
        fallback_rgb = raw.get("rgb")
        for group in ("draw_arrays", "begin_end"):
            for entry in raw.get(group) or ():
                block = self._draw_arrays_block(packer, entry, fallback_rgb)
                if block is not None:
                    blocks.append(block)

        for builder in (
            self._spheres,
            self._cylinders,
            self._cones,
            self._ellipsoids,
            self._lines,
            self._crosses,
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
        for bucket in ("triangles",):
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
        self,
        packer: _Packer,
        entry: Dict[str, Any],
        fallback_rgb: Any = None,
    ) -> Optional[Dict[str, Any]]:
        nverts = int(entry.get("nverts", 0) or 0)
        if nverts <= 0:
            return None
        vertex = entry.get("vertex")
        if not vertex:
            return None
        normal = entry.get("normal")
        rgba = entry.get("rgba")
        if not rgba and fallback_rgb:
            # A colourless block is NOT a white block: PyMOL hands `CGORender`
            # an explicit colour for exactly this case.  Materialising it as a
            # constant colour array costs 16 bytes a vertex on the one rep that
            # needs it (24 verts for a unit cell) and keeps the client's
            # `cgoArraysLayout()` path completely unchanged.
            rgba = _const_rgba(fallback_rgb, nverts)
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
        # ellipsoid = center[3] m[9] rgba[4] = 16.  The 4th component of `xyzr`
        # is NOT redundant: `CGOSimpleEllipsoid` (layer1/CGO.cpp:6355-6376)
        # places the surface at ``v + r * (u0*n0 + u1*n1 + u2*n2)``, so the
        # semi-axes are ``r * |n_i|`` -- and RepEllipsoid hands us axes that are
        # NORMALISED so the longest is exactly 1.0 (measured on 1EJG: max |n_i|
        # == 1.000000 for all 367 instances, while r ranges 0.218..0.862).
        # Dropping r therefore drew every ellipsoid at the same size, ~2.8x too
        # large (IoU against Mode P 0.215; folding r in takes it to 0.910).
        # Folded into the axes here so the wire layout is unchanged.
        centers = _drop_fourth(bucket.get("xyzr"), count)
        axes = _scale_axes_by_radius(bucket.get("axes"), bucket.get("xyzr"), count)
        data = _interleave_f32(
            [(centers, 3), (axes, 9), (bucket.get("rgba"), 4)], count
        )
        return self._instance(packer, "ellipsoid", count, data, bucket.get("pick"))

    def _lines(self, packer: _Packer, raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        bucket = raw.get("lines") or {}
        count = int(bucket.get("n", 0) or 0)
        if not count:
            return None
        # line = v1[3] v2[3] rgba1[4] rgba2[4] = 14.  `vertex` arrives as 6
        # floats per segment (both endpoints already paired by the accessor),
        # so it is one part, not two.
        data = _interleave_f32(
            [
                (bucket.get("vertex"), 6),
                (bucket.get("rgba1"), 4),
                (bucket.get("rgba2"), 4),
            ],
            count,
        )
        return self._instance(
            packer, "line", count, data, bucket.get("pick1"), bucket.get("pick2")
        )

    def _crosses(
        self, packer: _Packer, raw: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        bucket = raw.get("crosses") or {}
        count = int(bucket.get("n", 0) or 0)
        if not count:
            return None
        # cross = center[3] rgba[4] = 7.  Deliberately NOT expanded into three
        # segments here: the client builds them from `nonbondedSize`, which
        # keeps the wire at 1/3 the size and lets the arm length follow the
        # setting without a refetch.
        data = _interleave_f32(
            [(bucket.get("xyz"), 3), (bucket.get("rgba"), 4)], count
        )
        return self._instance(packer, "cross", count, data, bucket.get("pick"))

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

    # -- exact invalidation (defect D1) ------------------------------------

    def poll_versions(
        self, engine: Any, update: bool = True, force: bool = False
    ) -> Optional[Dict[str, Any]]:
        """One ``_cmd.web_get_versions`` call.  **Engine thread only.**

        Returns ``None`` when this build has no counters (the caller then falls
        back to the fingerprint) and raises nothing: a transient refusal
        (``modal draw in progress``) is recorded and reported as an empty poll,
        because turning it into a fingerprint scan would produce exactly the
        false positives this replaced.

        ``update`` runs ``SceneUpdate`` — but only inside the C++, and only when
        a counter actually moved, so an idle poll never rebuilds anything.
        Measured on 1UBQ: 1.0 µs when nothing changed.
        """
        fn = self.versions_fn()
        if fn is None:
            return None
        cmd = engine.cmd
        if cmd is None:
            return None
        self._version_polls += 1
        # Same "the _cmd entry point assumes the API lock is held" contract as
        # the accessor (spike 06 §7): engine thread, lock held, BLOCKED entry.
        cmd.lock(_self=cmd)
        try:
            raw = fn(cmd._COb, 1 if update else 0, 1 if force else 0)
        except Exception as exc:  # noqa: BLE001
            self._version_error = repr(exc)
            return {"changed": False, "objects": {}, "_error": repr(exc)}
        finally:
            cmd.unlock(-1, _self=cmd)
        if raw.get("recomputed"):
            self._version_walks += 1
        return raw

    def _scan_versions(self, engine: Any) -> Optional[List[Dict[str, Any]]]:
        """The exact path.  ``None`` means "no counters, use the fingerprint"."""
        raw = self.poll_versions(engine)
        if raw is None:
            return None
        if raw.get("_error"):
            return []
        self._version_serial = int(raw.get("serial", 0) or 0)
        # THE FAST PATH.  `changed` is False whenever all four CExecutive
        # counters are unchanged OR the full walk re-hashed every built rep and
        # found nothing different.  Either way there is nothing to tell anyone,
        # and we must not allocate a table to discover that.
        if not raw.get("changed") and self._table_primed:
            return []

        table = repversions.build_table(raw, REP_IDS)
        with self._lock:
            if not self._table_primed:
                # First poll of the session.  The client has fetched nothing
                # yet, so announcing the whole scene would be N pulls of
                # geometry nobody asked for.  Prime silently; the client's own
                # first request is what populates its cache.
                self._table = table
                self._table_primed = True
                self._epoch += 1
                return []
            previous = self._table
            sizes = {key: int(e.get("bytes", 0)) for key, e in self._cache.items()}

        changes = repversions.diff_tables(previous, table, sizes)

        with self._lock:
            self._table = table
            if not changes:
                return []
            self._epoch += 1
            self._version_changes += len(changes)
            self._last_changes = changes[-64:]
            for change in changes:
                key = self.key(change["object"], change["state"], change["rep"])
                if change["active"]:
                    self._dirty[key] = int(change["level"])
                else:
                    # Hidden / deleted: forget the server-side bookkeeping too,
                    # or a later `show` would be answered `unchanged` against a
                    # hash whose buffers the client has already thrown away —
                    # and nothing would ever be drawn again.
                    self._cache.pop(key, None)
                    self._dirty.pop(key, None)
        return changes

    def versions_payload(self) -> Dict[str, Any]:
        """The whole table, for a client that polls instead of listening.

        Safe from any thread.  ``reps`` is the compact
        :data:`~tenmol_bridge.state.repversions.ROW_FORMAT` row form; a client
        keeps its own copy and diffs it, which makes this stateless per client
        and therefore immune to the D4 fan-out defect.
        """
        with self._lock:
            rows = repversions.table_rows(self._table)
            payload = {
                "exact": self._versions_fn is not None,
                "symbol": "_cmd.web_get_versions",
                "epoch": self._epoch,
                "serial": self._version_serial,
                "primed": self._table_primed,
                "polls": self._version_polls,
                "walks": self._version_walks,
                "changes": self._version_changes,
                "rowFormat": list(repversions.ROW_FORMAT),
                "reps": rows,
                "lastChanges": list(self._last_changes),
            }
        if self._version_error:
            payload["lastError"] = self._version_error
        return payload

    def scan(self, engine: Any) -> List[Dict[str, Any]]:
        """Poll for changed geometry.  Engine thread only.

        Prefers the exact ``_cmd.web_get_versions`` counters; falls back to the
        old ``cmd.get_vis()`` fingerprint on a PyMOL build without them.  The
        fingerprint is 0.0007 ms and changes on show/hide/enable/delete, but it
        is object-level: it cannot see a recolour and it cannot name the rep to
        DROP, which is why ``capabilities()['exactInvalidation']`` is ``False``
        whenever it is the one running.
        """
        exact = self._scan_versions(engine)
        if exact is not None:
            return exact
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
                # The version table is a MIRROR of the C++, not a cache of our
                # own, so a full forget must re-prime rather than diff against
                # a table whose companion cache is gone.
                self._table = {}
                self._table_primed = False
                self._last_changes = []
                self._epoch += 1
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
            # D1: the pull half of invalidation.  A Mode-G client polls this,
            # compares `epoch`, and only then looks at `reps`.
            "versions": self.versions_payload(),
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


def _const_rgba(rgb: Any, count: int) -> Optional[bytes]:
    """``count`` copies of one opaque RGBA, from an ``[r, g, b]`` triple.

    Returns ``None`` for anything that is not a usable triple so the caller
    keeps its "no colour array" branch rather than shipping garbage.
    """
    try:
        r, g, b = (float(rgb[0]), float(rgb[1]), float(rgb[2]))
    except (TypeError, ValueError, IndexError, KeyError):
        return None
    return struct.pack("<4f", r, g, b, 1.0) * count


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


def _scale_axes_by_radius(axes: Any, xyzr: Any, count: int) -> bytes:
    """Fold ``xyzr[3]`` into the three ellipsoid axis vectors.

    RepEllipsoid normalises its axes and keeps the scale in the 4th component
    of ``xyzr``; the wire layout has three axis vectors and no scalar, so the
    two are multiplied here. See ``_ellipsoids`` for the source citation.
    """
    if not axes:
        return _const_f32(0.0, count * 9)
    if not xyzr:
        return bytes(memoryview(axes).cast("B"))[: count * 36]
    try:
        import numpy  # noqa: WPS433

        a = numpy.frombuffer(bytes(memoryview(axes).cast("B")), dtype="<f4")[
            : count * 9
        ].reshape(-1, 9)
        r = numpy.frombuffer(bytes(memoryview(xyzr).cast("B")), dtype="<f4")[
            : count * 4
        ].reshape(-1, 4)[:, 3:4]
        return numpy.ascontiguousarray(a * r, dtype="<f4").tobytes()
    except Exception:  # noqa: BLE001
        import array

        a_a = array.array("f")
        a_a.frombytes(bytes(memoryview(axes).cast("B")))
        r_a = array.array("f")
        r_a.frombytes(bytes(memoryview(xyzr).cast("B")))
        out = array.array("f")
        for index in range(count):
            radius = r_a[index * 4 + 3]
            for slot in range(9):
                out.append(a_a[index * 9 + slot] * radius)
        return out.tobytes()


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
