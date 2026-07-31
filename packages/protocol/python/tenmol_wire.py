"""Reference Python implementation of the tenmol binary-frame codec.

WP-01 (``packages/protocol``). This is the NORMATIVE producer side of the wire
format that ``packages/protocol/src/geometry.ts`` consumes. The bridge
(``bridge/tenmol_bridge/``, WP-02/WP-04/WP-26) should import or vendor this
module rather than re-deriving the layout; ``test/roundtrip.test.ts`` encodes
with exactly this code and decodes in TypeScript.

Wire format (server -> client, WebSocket BINARY frame)::

    [ 0 .. 3 ]                  uint32 little-endian  headerLength
    [ 4 .. 4+headerLength )     UTF-8 JSON            BinaryFrameHeader
    [ 4+headerLength .. end )   raw bytes             payload

``headerLength`` is space-padded to a multiple of :data:`ALIGNMENT` (4) so the
payload starts at a 4-byte-aligned offset from the frame start.  A WebSocket
binary frame reaches the browser as an ``ArrayBuffer`` at byteOffset 0, so every
4-aligned ``BufferRef.byteOffset`` is also absolutely 4-aligned and
``viewOf()`` on the client is ZERO COPY.

DO NOT DROP THE PADDING. Without it ``viewOf()`` falls back to
``payload.slice()`` -- a memcpy of every buffer, which for a 1AON cartoon is
~93 MB per pull (spike 03 section 8).

Stdlib only: no numpy, no msgpack.
"""

from __future__ import annotations

import json
import struct
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

__all__ = [
    "ALIGNMENT",
    "LENGTH_PREFIX_BYTES",
    "DTYPE_BYTES",
    "align_up",
    "BufferPacker",
    "encode_binary_frame",
    "decode_binary_frame",
]

#: JSON header padding / BufferRef offset alignment. Must equal
#: ``BINARY_FRAME_ALIGNMENT`` in ``src/geometry.ts``.
ALIGNMENT = 4

#: uint32 little-endian header length prefix.
LENGTH_PREFIX_BYTES = 4

#: Must equal ``DTYPE_BYTES`` in ``src/geometry.ts``.
DTYPE_BYTES: Dict[str, int] = {"f32": 4, "i32": 4, "u32": 4, "u8": 1}

#: Must equal ``INSTANCE_ITEM_SIZE`` in ``src/geometry.ts``. float32 items per
#: instance, on the wire (colour included -- a GPU instance buffer cannot
#: inherit it from a preceding ``CGO_COLOR``).
INSTANCE_ITEM_SIZE: Dict[str, int] = {
    "sphere": 8,  # cx,cy,cz,radius, r,g,b,a
    "cylinder": 12,  # ox,oy,oz, ax,ay,az, radius, capbits, r,g,b,a
    "cylinder2": 16,  # ... r1,g1,b1,a1, r2,g2,b2,a2
    "cone": 18,  # v1[3], v2[3], radius1, radius2, cap1, cap2, rgba1[4], rgba2[4]
    "ellipsoid": 16,  # center[3], m[9], r,g,b,a
}

#: ``arraybits`` flags, ``layer1/CGO.h:272-277``.
CGO_ARRAY_BIT = {
    "vertex": 0x01,
    "normal": 0x02,
    "color": 0x04,
    "pickColor": 0x08,
    "accessibility": 0x10,
    "texCoord": 0x20,
}

#: Floats per vertex per sub-array; ``layer1/CGO.cpp:54-65``,
#: ``layer0/ShaderMgr.h:430-431``.
_CGO_SUB_SIZES: Sequence[Tuple[int, int]] = (
    (CGO_ARRAY_BIT["normal"], 3),
    (CGO_ARRAY_BIT["color"], 4),
    (CGO_ARRAY_BIT["pickColor"], 1 + 2),
    (CGO_ARRAY_BIT["accessibility"], 1),
)


def align_up(n: int, to: int = ALIGNMENT) -> int:
    """Round ``n`` up to the next multiple of ``to``."""
    rem = n % to
    return n if rem == 0 else n + (to - rem)


def cgo_narrays(arraybits: int) -> int:
    """Floats per vertex across all sub-arrays of a ``cgo::draw::arrays`` block.

    Mirrors ``cgoNarrays()`` in ``src/geometry.ts`` and the C struct's
    ``narrays`` (``layer1/CGO.h:341-352``).
    """
    n = 3  # CGO_VERTEX_ARRAY is always present (assert at layer1/CGO.cpp:1651)
    for bit, size in _CGO_SUB_SIZES:
        if arraybits & bit:
            n += size
    return n


class BufferPacker:
    """Accumulates payload buffers at ``ALIGNMENT``-aligned offsets.

    Every ``add`` returns the ``BufferRef`` dict the JSON header must carry.
    Padding bytes between buffers are zero.
    """

    def __init__(self) -> None:
        self._chunks: List[bytes] = []
        self._size = 0

    @property
    def size(self) -> int:
        return self._size

    def add(self, data: Any, dtype: str, item_size: int) -> Dict[str, int | str]:
        """Append ``data`` (any bytes-like: bytes, bytearray, memoryview,
        ``array.array``, numpy array) and return its ``BufferRef``."""
        if dtype not in DTYPE_BYTES:
            raise ValueError("unknown dtype %r" % (dtype,))
        raw = memoryview(data).cast("B") if not isinstance(data, (bytes, bytearray)) else bytes(data)
        raw = bytes(raw)

        elem = DTYPE_BYTES[dtype]
        if len(raw) % elem:
            raise ValueError(
                "buffer of %d bytes is not a multiple of %d (%s)" % (len(raw), elem, dtype)
            )
        if item_size > 0 and (len(raw) // elem) % item_size:
            raise ValueError(
                "buffer of %d elements is not a multiple of itemSize %d"
                % (len(raw) // elem, item_size)
            )

        # Align the START of every buffer so viewOf() stays zero-copy.
        pad = align_up(self._size) - self._size
        if pad:
            self._chunks.append(b"\0" * pad)
            self._size += pad

        ref = {
            "byteOffset": self._size,
            "byteLength": len(raw),
            "dtype": dtype,
            "itemSize": item_size,
        }
        self._chunks.append(raw)
        self._size += len(raw)
        return ref

    def payload(self) -> bytes:
        return b"".join(self._chunks)


def encode_binary_frame(header: Dict[str, Any], payload: bytes) -> bytes:
    """Encode one binary frame.

    ``header['payloadBytes']`` is overwritten with the real length. The JSON is
    space-padded to a multiple of :data:`ALIGNMENT` (JSON tolerates trailing
    whitespace, so the client parses it unchanged).
    """
    payload = bytes(payload)
    full = dict(header)
    full["payloadBytes"] = len(payload)

    # separators=(',', ':') so the padding is the only whitespace in the frame.
    text = json.dumps(full, separators=(",", ":"), ensure_ascii=False)
    raw = text.encode("utf-8")
    pad = align_up(len(raw)) - len(raw)
    if pad:
        raw = raw + b" " * pad

    return struct.pack("<I", len(raw)) + raw + payload


def decode_binary_frame(frame: bytes) -> Tuple[Dict[str, Any], memoryview]:
    """Inverse of :func:`encode_binary_frame`. Returns ``(header, payload)``.

    ``payload`` is a memoryview onto ``frame`` -- no copy, matching the
    TypeScript side.
    """
    buf = memoryview(frame)
    if len(buf) < LENGTH_PREFIX_BYTES:
        raise ValueError("binary frame too short: %d bytes" % len(buf))
    (header_len,) = struct.unpack_from("<I", buf, 0)
    start = LENGTH_PREFIX_BYTES
    end = start + header_len
    if end > len(buf):
        raise ValueError("header length %d exceeds frame of %d bytes" % (header_len, len(buf)))
    if header_len % ALIGNMENT:
        raise ValueError("header length %d is not %d-byte aligned" % (header_len, ALIGNMENT))
    header = json.loads(bytes(buf[start:end]).decode("utf-8"))
    payload = buf[end:]
    declared = header.get("payloadBytes")
    if declared is not None and declared != len(payload):
        raise ValueError("payloadBytes %s != actual %d" % (declared, len(payload)))
    return header, payload


# --------------------------------------------------------------------------- #
# Convenience builders. These are the shapes WP-26's accessor must produce.
# --------------------------------------------------------------------------- #


def indexed_mesh_header(
    *,
    object: str,
    state: int,
    rep: int,
    seq: int,
    verts: int,
    tris: int,
    buffers: Dict[str, Dict[str, Any]],
    proximity: bool = False,
    one_color: Optional[Sequence[float]] = None,
    matrix: Optional[Sequence[float]] = None,
    level: Optional[int] = None,
) -> Dict[str, Any]:
    """``RepSurface`` (``layer2/RepSurface.cpp:59-101``) as an indexed mesh.

    ``buffers`` keys: position, normal, color, alpha, ao, index, strip, atom,
    vis -- mapping onto V, VN, VC, VA, VAO, T, S, AT, Vis respectively.
    """
    header: Dict[str, Any] = {
        "v": 1,
        "kind": "indexed-mesh",
        "object": object,
        "state": state,
        "rep": rep,
        "seq": seq,
        "payloadBytes": 0,
        "counts": {"verts": verts, "tris": tris},
        "buffers": buffers,
        "proximity": bool(proximity),
        "oneColor": list(one_color) if one_color is not None else None,
    }
    if matrix is not None:
        header["matrix"] = list(matrix)
    if level is not None:
        header["level"] = level
    return header


def cgo_header(
    *,
    object: str,
    state: int,
    rep: int,
    seq: int,
    blocks: Iterable[Dict[str, Any]],
    instances: Iterable[Dict[str, Any]] = (),
    matrix: Optional[Sequence[float]] = None,
    level: Optional[int] = None,
) -> Dict[str, Any]:
    """``CGO_DRAW_ARRAYS`` blocks passed verbatim, plus instance buffers.

    Spheres and cylinders are emitted as INSTANCE buffers, never tessellated
    (plan section 1.3 constraint 1).
    """
    header: Dict[str, Any] = {
        "v": 1,
        "kind": "cgo-draw-arrays",
        "object": object,
        "state": state,
        "rep": rep,
        "seq": seq,
        "payloadBytes": 0,
        "blocks": list(blocks),
        "instances": list(instances),
    }
    if matrix is not None:
        header["matrix"] = list(matrix)
    if level is not None:
        header["level"] = level
    return header


def pixel_header(
    *,
    width: int,
    height: int,
    dpr: float,
    encoding: str,
    frame_id: int,
    seq: int,
    flip_y: bool = True,
    quality: Optional[int] = None,
    view: Optional[Sequence[float]] = None,
    reps: Optional[Sequence[int]] = None,
) -> Dict[str, Any]:
    """Mode P bitmap frame descriptor."""
    header: Dict[str, Any] = {
        "v": 1,
        "kind": "pixels",
        "seq": seq,
        "payloadBytes": 0,
        "width": width,
        "height": height,
        "dpr": dpr,
        "encoding": encoding,
        "flipY": bool(flip_y),
        "lossless": encoding in ("png", "raw-rgba"),
        "frameId": frame_id,
    }
    if quality is not None:
        header["quality"] = quality
    if view is not None:
        header["view"] = list(view)
    if reps is not None:
        header["reps"] = list(reps)
    return header
