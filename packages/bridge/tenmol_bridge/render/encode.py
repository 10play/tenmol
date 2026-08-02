"""Mode P image encoding: RGBA framebuffer bytes -> a wire payload.

Pure functions plus one small controller.  **Nothing here imports PyMOL, GL,
asyncio or FastAPI**, so the whole encode path is unit-testable on a machine
that has never built PyMOL.

MEASURED ON THIS MACHINE (M4 Max, ``GL_RENDERER = "Apple M4 Max"``), 1AON =
58,870 atoms, cartoon, 1280x960, Pillow 11.1.0 — see ``test_render.py``:

======================  ==========  ===========  ================================
codec                   ms (median) bytes        note
======================  ==========  ===========  ================================
``jpeg`` q60            1.58        126,595      motion, degraded
``jpeg`` q80            1.69        182,717      **the motion codec**
``jpeg`` q90            1.83        253,094      motion, high
``png`` L1 (RGBA)       13.69       773,830      **the settle codec**
``png`` L1 (RGB)        11.34       711,404      settle, alpha dropped
``png`` L3              18.46       568,045      too slow to be worth it
``webp`` q80            45.43       136,016      3x too slow; never the motion codec
``raw-rgba``            ~0.4        4,915,200    loopback debugging only
======================  ==========  ===========  ================================

(The plan §1.3 table quotes 1.9 ms / 209,186 B for JPEG q80 and 10.5 ms /
746,205 B for PNG L1.  Same order, same conclusion; the small deltas are a
different camera and Pillow's RGBX fast path, below.)

THE TWO FAST PATHS, both worth 1-3 ms/frame and both easy to lose
-----------------------------------------------------------------
1. **``raw`` mode ``"RGBX"`` for JPEG.**  ``glReadPixels`` must return RGBA
   (a 4-byte pixel keeps every row 4-aligned, which is what ``GL_PACK_ALIGNMENT``
   defaults to), but JPEG has no alpha.  ``Image.frombuffer("RGB", size, buf,
   "raw", "RGBX", 0, ±1)`` makes Pillow skip the 4th byte *inside the encoder's
   own row unpacker*.  The obvious ``frombuffer("RGBA", ...).convert("RGB")``
   costs a full 3.7 MB conversion pass instead.

2. **The vertical flip is free.**  ``glReadPixels`` has a bottom-left origin;
   the browser's ``<canvas>`` has a top-left one.  Passing ``-1`` as
   ``frombuffer``'s last argument makes Pillow's ``map_buffer`` build the line
   pointer table in reverse (``src/map.c``) — no memcpy at all.  Measured
   identical (0.002 ms) for orientation ``+1`` and ``-1``.

So: read RGBA, flip in the decoder, encode from RGBX.  ``raw-rgba`` is the one
encoding that cannot flip for free (it is the buffer itself), so it always sets
``flipY`` and the client flips at blit time.

NO PILLOW?
----------
Pillow is not a hard dependency of ``tenmol-bridge`` (see
:func:`capabilities`).  Without it ``png`` still works — :func:`encode_png_stdlib`
is a ~40-line ``zlib`` encoder — and ``jpeg``/``webp`` raise
:class:`~tenmol_bridge.errors.BridgeError` rather than silently sending
something else.  :func:`resolve_encoding` is what callers use to degrade
politely.
"""

from __future__ import annotations

import struct
import time
import zlib
from typing import Any, Dict, NamedTuple, Optional, Sequence, Tuple

from ..errors import BridgeError

__all__ = [
    "PIXEL_ENCODINGS",
    "LOSSLESS_PIXEL_ENCODINGS",
    "DEFAULT_MOTION_ENCODING",
    "DEFAULT_SETTLE_ENCODING",
    "DEFAULT_QUALITY",
    "MIN_QUALITY",
    "MAX_QUALITY",
    "EncodeError",
    "EncodedImage",
    "capabilities",
    "have_pillow",
    "supported_encodings",
    "resolve_encoding",
    "is_lossless",
    "encode_rgba",
    "encode_png_stdlib",
    "AdaptiveQuality",
    "sniff_image",
]

#: Mirrors ``PIXEL_ENCODINGS`` in ``packages/protocol/src/geometry.ts``.
PIXEL_ENCODINGS: Tuple[str, ...] = ("jpeg", "png", "webp", "raw-rgba")

#: Mirrors ``LOSSLESS_PIXEL_ENCODINGS`` there.
LOSSLESS_PIXEL_ENCODINGS: Tuple[str, ...] = ("png", "raw-rgba")

DEFAULT_MOTION_ENCODING = "jpeg"
DEFAULT_SETTLE_ENCODING = "png"
DEFAULT_QUALITY = 80
MIN_QUALITY = 25
MAX_QUALITY = 95

#: zlib level for PNG.  1 is the plan's choice: 13.7 ms vs 18.5 ms at level 3
#: for 27 % more bytes, on a link that is loopback.
PNG_COMPRESS_LEVEL = 1

_BYTES_PER_PIXEL = 4


class EncodeError(BridgeError):
    """This build cannot produce the requested encoding."""


class EncodedImage(NamedTuple):
    """One encoded frame plus everything the wire header needs."""

    data: bytes
    encoding: str
    width: int
    height: int
    #: ``True`` when row 0 of :attr:`data` is the BOTTOM row of the image, i.e.
    #: the client must flip at blit time.  Mirrors ``PixelFrameHeader.flipY``.
    flip_y: bool
    quality: Optional[int] = None
    encode_ms: float = 0.0

    @property
    def lossless(self) -> bool:
        return is_lossless(self.encoding)

    @property
    def nbytes(self) -> int:
        return len(self.data)


# --------------------------------------------------------------------------- #
# Capability probing
# --------------------------------------------------------------------------- #

_pillow: Any = None
_pillow_checked = False
_pillow_error: Optional[str] = None


def _pil():
    """Import Pillow once; ``None`` if it is not installed."""
    global _pillow, _pillow_checked, _pillow_error
    if not _pillow_checked:
        _pillow_checked = True
        try:
            from PIL import Image  # noqa: WPS433 - optional dependency

            _pillow = Image
        except Exception as exc:  # noqa: BLE001
            _pillow = None
            _pillow_error = repr(exc)
    return _pillow


def have_pillow() -> bool:
    return _pil() is not None


def supported_encodings() -> Tuple[str, ...]:
    """The encodings this build can actually produce, in preference order."""
    if have_pillow():
        return PIXEL_ENCODINGS
    return ("png", "raw-rgba")


def capabilities() -> Dict[str, Any]:
    """What ``/healthz`` should report about the encoder."""
    image = _pil()
    out: Dict[str, Any] = {
        "pillow": image is not None,
        "encodings": list(supported_encodings()),
        "pngCompressLevel": PNG_COMPRESS_LEVEL,
    }
    if image is not None:
        try:
            import PIL

            out["pillowVersion"] = PIL.__version__
        except Exception:  # noqa: BLE001
            out["pillowVersion"] = "?"
        try:
            image.init()
            out["webp"] = "WEBP" in image.SAVE
        except Exception:  # noqa: BLE001
            out["webp"] = False
    else:
        out["pillowError"] = _pillow_error
        out["webp"] = False
    return out


def is_lossless(encoding: str) -> bool:
    return encoding in LOSSLESS_PIXEL_ENCODINGS


def resolve_encoding(requested: str, prefer_lossless: bool = False) -> str:
    """Map a requested encoding onto one this build can produce.

    Degrading is always *towards* a codec that exists, never towards silence:
    ``jpeg``/``webp`` fall back to ``png`` with no Pillow, and an unknown name
    raises rather than guessing.
    """
    if requested not in PIXEL_ENCODINGS:
        raise EncodeError(
            "unknown pixel encoding %r; v1 encodings are %s"
            % (requested, ", ".join(PIXEL_ENCODINGS)),
            requested=requested,
        )
    available = supported_encodings()
    if requested in available:
        return requested
    return "png" if not prefer_lossless or "png" in available else "raw-rgba"


# --------------------------------------------------------------------------- #
# The encoder
# --------------------------------------------------------------------------- #


def encode_rgba(
    buffer: Any,
    width: int,
    height: int,
    encoding: str = DEFAULT_MOTION_ENCODING,
    quality: int = DEFAULT_QUALITY,
    bottom_up: bool = True,
    flip: bool = True,
    alpha: bool = False,
) -> EncodedImage:
    """Encode ``width x height`` RGBA bytes.

    ``buffer`` is anything supporting the buffer protocol — in the product it
    is the reused ``ctypes`` array :func:`glReadPixels` wrote into, so this
    function must not hold on to it.

    ``bottom_up`` describes the *input* (``glReadPixels`` -> ``True``); ``flip``
    asks for it to be corrected.  The result's :attr:`EncodedImage.flip_y` is
    the honest answer for the wire header, whatever happened.

    ``alpha`` keeps the alpha channel where the codec has one.  Default off:
    PyMOL's default background is opaque, and dropping alpha is 8 % fewer bytes
    and 2.4 ms less PNG time.
    """
    width = int(width)
    height = int(height)
    expect = width * height * _BYTES_PER_PIXEL
    view = memoryview(buffer).cast("B")
    if len(view) < expect:
        raise EncodeError(
            "framebuffer is %d bytes, %dx%d RGBA needs %d"
            % (len(view), width, height, expect),
            width=width,
            height=height,
        )
    if len(view) > expect:
        view = view[:expect]

    quality = max(1, min(100, int(quality)))
    t0 = time.perf_counter()

    if encoding == "raw-rgba":
        # The one encoding whose payload IS the buffer.  Flipping would be a
        # real 4.9 MB memcpy for no benefit, so we never do it and tell the
        # truth in flip_y.
        data = bytes(view)
        return EncodedImage(
            data, "raw-rgba", width, height, bottom_up, None,
            (time.perf_counter() - t0) * 1000.0,
        )

    if encoding not in PIXEL_ENCODINGS:
        raise EncodeError(
            "unknown pixel encoding %r" % (encoding,), requested=encoding
        )

    do_flip = bool(flip and bottom_up)
    out_flip_y = bottom_up and not do_flip

    image_mod = _pil()
    if image_mod is None:
        if encoding != "png":
            raise EncodeError(
                "encoding %r needs Pillow, which is not installed in this "
                "bridge environment (pip install pillow)" % (encoding,),
                requested=encoding,
                available=list(supported_encodings()),
            )
        data = encode_png_stdlib(view, width, height, flip=do_flip, alpha=alpha)
        return EncodedImage(
            data, "png", width, height, out_flip_y, None,
            (time.perf_counter() - t0) * 1000.0,
        )

    orientation = -1 if do_flip else 1
    import io

    sink = io.BytesIO()

    if encoding == "jpeg":
        # "RGBX": Pillow's row unpacker skips the 4th byte.  See module header.
        image = image_mod.frombuffer(
            "RGB", (width, height), view, "raw", "RGBX", 0, orientation
        )
        image.save(sink, "JPEG", quality=quality, optimize=False, subsampling=1)
        used_quality: Optional[int] = quality
    elif encoding == "png":
        if alpha:
            image = image_mod.frombuffer(
                "RGBA", (width, height), view, "raw", "RGBA", 0, orientation
            )
        else:
            # PNG cannot be written from Pillow's "RGBX" mode
            # (PngImagePlugin._OUTMODES has no RGBX entry -- measured:
            #  OSError: cannot write mode RGBX as PNG), so the alpha-less PNG
            # goes through RGBA -> RGB.  11.3 ms + 711 KB vs 13.7 ms + 774 KB.
            image = image_mod.frombuffer(
                "RGBA", (width, height), view, "raw", "RGBA", 0, orientation
            ).convert("RGB")
        image.save(sink, "PNG", compress_level=PNG_COMPRESS_LEVEL)
        used_quality = None
    elif encoding == "webp":
        image = image_mod.frombuffer(
            "RGBA", (width, height), view, "raw", "RGBA", 0, orientation
        )
        if not alpha:
            image = image.convert("RGB")
        image.save(sink, "WEBP", quality=quality, method=0)
        used_quality = quality
    else:  # pragma: no cover - PIXEL_ENCODINGS is closed
        raise EncodeError("unreachable encoding %r" % (encoding,))

    return EncodedImage(
        sink.getvalue(),
        encoding,
        width,
        height,
        out_flip_y,
        used_quality,
        (time.perf_counter() - t0) * 1000.0,
    )


def encode_png_stdlib(
    buffer: Any,
    width: int,
    height: int,
    flip: bool = True,
    alpha: bool = False,
    compress_level: int = PNG_COMPRESS_LEVEL,
) -> bytes:
    """A minimal, correct PNG encoder using only ``zlib`` and ``struct``.

    Exists so that "the scene settled" still produces a *lossless* still on a
    bridge with no Pillow, instead of the stream silently staying JPEG.  Filter
    type 0 (None) on every scanline: the point is to be dependency-free and
    obviously correct, not to be small.
    """
    view = memoryview(buffer).cast("B")
    stride = width * _BYTES_PER_PIXEL
    color_type = 6 if alpha else 2  # 6 = RGBA, 2 = RGB
    rows = bytearray()
    order = range(height - 1, -1, -1) if flip else range(height)
    for y in order:
        row = view[y * stride : (y + 1) * stride]
        rows.append(0)  # filter: None
        rows += row if alpha else _drop_alpha(row)

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + tag
            + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, color_type, 0, 0, 0)
    return b"".join(
        (
            b"\x89PNG\r\n\x1a\n",
            chunk(b"IHDR", ihdr),
            chunk(b"IDAT", zlib.compress(bytes(rows), compress_level)),
            chunk(b"IEND", b""),
        )
    )


def _drop_alpha(row: memoryview) -> bytes:
    """RGBA row -> RGB row."""
    raw = row.tobytes()
    out = bytearray(len(raw) // 4 * 3)
    out[0::3] = raw[0::4]
    out[1::3] = raw[1::4]
    out[2::3] = raw[2::4]
    return bytes(out)


# --------------------------------------------------------------------------- #
# Adaptive quality
# --------------------------------------------------------------------------- #


class AdaptiveQuality:
    """Quality that walks down under backpressure and back up when it clears.

    The plan's transport policy is "frames are dropped, never queued".  Dropping
    is handled by :mod:`tenmol_bridge.render.framestream`; this class handles
    the *other* half — a client that is only slightly behind should get cheaper
    frames rather than a stutter.  Both knobs move on the same evidence:

    * a frame we had to **skip** because the client had not acked   -> penalise
    * an encode that blew the per-frame budget                      -> penalise
    * ``recover_after`` consecutive clean frames                    -> reward

    Deliberately hysteretic (down fast, up slow): oscillating quality is far
    more visible than a steadily lower one.
    """

    def __init__(
        self,
        base: int = DEFAULT_QUALITY,
        minimum: int = MIN_QUALITY,
        maximum: int = MAX_QUALITY,
        step_down: int = 10,
        step_up: int = 5,
        recover_after: int = 20,
        budget_ms: float = 6.0,
    ) -> None:
        self.base = int(base)
        self.minimum = int(minimum)
        self.maximum = int(maximum)
        self.step_down = int(step_down)
        self.step_up = int(step_up)
        self.recover_after = int(recover_after)
        self.budget_ms = float(budget_ms)
        self._quality = self.base
        self._clean = 0
        self.penalties = 0
        self.rewards = 0

    @property
    def quality(self) -> int:
        return self._quality

    def set_base(self, base: int) -> None:
        """The client asked for a specific quality; that becomes the ceiling."""
        self.base = max(1, min(100, int(base)))
        self._quality = min(self._quality, self.base)
        if self._quality < self.minimum:
            self._quality = min(self.base, self.minimum)
        self._clean = 0

    def penalise(self, reason: str = "backpressure") -> int:
        self.penalties += 1
        self._clean = 0
        self._quality = max(self.minimum, self._quality - self.step_down)
        return self._quality

    def observe(self, encode_ms: float, skipped: bool = False) -> int:
        """One frame's outcome.  Returns the quality to use for the next one."""
        if skipped or encode_ms > self.budget_ms:
            return self.penalise("slow-encode" if not skipped else "backpressure")
        self._clean += 1
        if self._clean >= self.recover_after and self._quality < self.base:
            self._clean = 0
            self.rewards += 1
            self._quality = min(self.base, self._quality + self.step_up)
        return self._quality

    def reset(self) -> int:
        self._quality = self.base
        self._clean = 0
        return self._quality

    def stats(self) -> Dict[str, Any]:
        return {
            "quality": self._quality,
            "base": self.base,
            "min": self.minimum,
            "max": self.maximum,
            "penalties": self.penalties,
            "rewards": self.rewards,
            "budgetMs": self.budget_ms,
        }


def sniff_image(data: Sequence[int] | bytes) -> Optional[str]:
    """Identify an encoded still from its magic bytes.

    Used by the tests (and by ``/healthz``'s self-check) to assert that what we
    put on the wire really is the format the header claims.
    """
    raw = bytes(data[:16])
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if raw.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if raw.startswith(b"RIFF") and raw[8:12] == b"WEBP":
        return "webp"
    return None
