"""Mode P: read the offscreen FBO back after each draw and push encoded frames.

Plan §1.3 / §6 WP-04.  This is the *correctness baseline* of the whole product:
every rep renders exactly as PyMOL renders it, because it is PyMOL rendering
it.  Mode G (``modeg.py``) is developed alongside it, per rep, with automatic
fallback to here.

THE TICK
--------
``Pump`` runs, in this order, on the engine thread::

    drain the FIFO (client commands, mouse input)
    engine.tick()      ->  p.idle() ; p.draw()
    tick hooks         ->  FrameStream.on_tick(engine)   <- we are here

so by the time :meth:`FrameStream.on_tick` runs the framebuffer already holds
the current frame and one ``glReadPixels`` is all that is left.

WHY THE DIRTY GATE IS A PRE-DRAW PROBE AND NOT A TICK HOOK  (measured)
---------------------------------------------------------------------
``PyMOL_Draw`` sets ``I->RedisplayFlag = false`` at ``layer5/PyMOL.cpp:2331``
**before** it calls ``ExecutiveDrawNow``.  So a tick hook — which runs *after*
the draw — sees the flag already cleared for the very frame it is about to
send, and ``getRedisplay()`` polled there returns ``False`` for every real
change.  Gating emission on it would produce a viewport that never updates.
Desktop PyMOL has the same ordering constraint and solves it the same way: the
Qt widget polls ``PyMOL_GetRedisplay`` from the idle loop and only then calls
``update()`` -> ``paintGL`` -> ``PyMOL_Draw``.

:class:`RedisplayGate` therefore probes ``PyMOL_GetRedisplay(reset=1)``
*immediately before* ``engine.tick()``.  It reaches that position through
``pump.add_pre_tick_hook`` when the pump offers one (it does not today) and
otherwise by wrapping the bound ``engine.tick`` on the instance — reversibly,
loudly, and only while attached.  The gate is also the process's **single**
consumer of that destructive flag (plan §1.2), and fans it out to sinks so
WP-03's ``redisplay`` topic does not open a second drain.

TRANSPORT POLICY (plan §1.3, verbatim)
--------------------------------------
* JPEG q80 while the camera moves; lossless PNG once it settles.
* Frames are **dropped, never queued**: at most :attr:`StreamParams.max_in_flight`
  un-acked frames per client, with :attr:`StreamParams.ack_timeout_s` as the
  liveness escape hatch so a client that never acks degrades to "no flow
  control" instead of to a frozen viewport.
* Under sustained backpressure the JPEG quality walks down
  (:class:`~tenmol_bridge.render.encode.AdaptiveQuality`) before frames start
  being skipped.
* ``cmd.ray`` is an explicit high-quality mode, not something the stream ever
  does on its own.
"""

from __future__ import annotations

import ctypes
import json
import sys
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from ..config import log
from ..errors import BridgeError, NoOffscreenGL, PyMOLUnavailable
from ..session import HEADER_ALIGNMENT, encode_binary_frame
from . import encode as _encode
from .encode import AdaptiveQuality, EncodedImage

__all__ = [
    "StreamParams",
    "RedisplayGate",
    "PixelReadback",
    "Subscriber",
    "FrameStream",
    "pixel_frame_header",
    "TOPIC_PIXELS",
]

#: The topic this module publishes descriptors on (``session.TOPIC_PIXELS``).
TOPIC_PIXELS = "pixels"

# -- GL enums we need; identical in the EXT and ARB namespaces ---------------
_GL_RGBA = 0x1908
_GL_UNSIGNED_BYTE = 0x1401
_GL_COLOR_ATTACHMENT0 = 0x8CE0
_GL_PACK_ALIGNMENT = 0x0D05
_GL_FRAMEBUFFER = 0x8D40


# --------------------------------------------------------------------------- #
# Stream parameters
# --------------------------------------------------------------------------- #


@dataclass
class StreamParams:
    """Everything the client can negotiate, plus the policy constants."""

    #: Codec while the scene is in motion.  1.7 ms / 183 KB at 1280x960.
    motion_encoding: str = _encode.DEFAULT_MOTION_ENCODING
    #: Codec once the scene settles.  Lossless; text, thin lines and
    #: ``ray_trace_mode`` outlines survive intact.
    settle_encoding: str = _encode.DEFAULT_SETTLE_ENCODING
    #: Ceiling for the lossy codec; :class:`AdaptiveQuality` may go below it.
    quality: int = _encode.DEFAULT_QUALITY
    #: Device pixel ratio the client is displaying at.  Reported, not applied,
    #: unless :attr:`settle_scale` is used.
    dpr: float = 1.0
    #: Multiply the framebuffer by this on settle, for a retina-crisp still.
    #: 1.0 disables the resize entirely (the default: a resize costs a full
    #: PyMOL reshape + rebuild, and 2560x1920 PNG is ~40 ms).
    settle_scale: float = 1.0
    #: Quiet time before the lossless still.  Long enough that the tail of a
    #: drag does not trigger one, short enough to feel immediate.
    settle_ms: float = 180.0
    #: Hard cap on emitted frames per second while in motion.  The pump ticks
    #: at 60 Hz; 60 fps of JPEG is 11 MB/s, which loopback carries fine, but a
    #: cap gives the encode budget somewhere to go.
    max_fps: float = 60.0
    #: At most this many un-acked frames per client.  Plan §1.3: "the bridge
    #: emits at most one un-acknowledged frame per client."
    max_in_flight: int = 1
    #: After this long an un-acked frame is treated as lost rather than as
    #: backpressure, so a client that never acks still gets a live viewport.
    ack_timeout_s: float = 0.75
    #: Outbox depth above which we skip regardless of acks.
    max_outbox: int = 4
    #: Keep the alpha channel.  Off: PyMOL's background is opaque and RGB is
    #: 8 % fewer bytes and 2.4 ms less PNG.
    alpha: bool = False
    #: Flip server-side (free — see ``encode.py``) so the payload is a normal
    #: top-down image the client can ``drawImage`` and the user can save.
    server_flip: bool = True
    #: Stop emitting entirely (tab hidden, or every rep moved to Mode G).
    paused: bool = False

    def clamp(self) -> "StreamParams":
        self.quality = max(1, min(100, int(self.quality)))
        self.dpr = max(0.1, min(8.0, float(self.dpr)))
        self.settle_scale = max(1.0, min(4.0, float(self.settle_scale)))
        self.settle_ms = max(0.0, min(5000.0, float(self.settle_ms)))
        self.max_fps = max(1.0, min(240.0, float(self.max_fps)))
        self.max_in_flight = max(1, min(16, int(self.max_in_flight)))
        self.ack_timeout_s = max(0.05, min(30.0, float(self.ack_timeout_s)))
        self.max_outbox = max(1, min(1024, int(self.max_outbox)))
        return self

    def to_payload(self, **extra: Any) -> Dict[str, Any]:
        """The ``pixels`` topic event body (``PixelsPayload``, WP-01)."""
        payload: Dict[str, Any] = {
            "dpr": self.dpr,
            "motionEncoding": self.motion_encoding,
            "settleEncoding": self.settle_encoding,
            "quality": self.quality,
            "paused": self.paused,
            "settleMs": self.settle_ms,
            "settleScale": self.settle_scale,
            "maxFps": self.max_fps,
            "maxInFlight": self.max_in_flight,
        }
        payload.update(extra)
        return payload


# --------------------------------------------------------------------------- #
# The dirty gate
# --------------------------------------------------------------------------- #


class RedisplayGate:
    """The process's single consumer of ``PyMOL_GetRedisplay`` (destructive).

    See the module docstring for why this has to run *before* the draw.  Sinks
    registered with :meth:`add_sink` are called with ``(dirty: bool)`` once per
    tick on the engine thread; WP-03's ``redisplay`` topic is meant to hang off
    this rather than draining the flag a second time.
    """

    def __init__(self) -> None:
        self._sinks: List[Callable[[bool], None]] = []
        self._lock = threading.Lock()
        self._attached_to: Any = None
        self._original_tick: Optional[Callable[[], bool]] = None
        self.mode = "detached"
        #: Sticky: set by a probe or by :meth:`mark`, cleared by the consumer.
        self.pending = True  # the first frame is always owed
        self.probes = 0
        self.dirty_probes = 0
        self.external_marks = 0

    # -- attach / detach ---------------------------------------------------

    def attach(self, pump: Any) -> str:
        """Install the pre-draw probe.  Returns the mode actually used."""
        if self._attached_to is not None:
            return self.mode
        self._attached_to = pump
        adder = getattr(pump, "add_pre_tick_hook", None)
        if callable(adder):
            adder(self._probe)
            self.mode = "pre-tick-hook"
            return self.mode
        engine = pump.engine
        self._original_tick = engine.tick

        def tick() -> bool:
            self._probe(engine)
            return self._original_tick()  # type: ignore[misc]

        engine.tick = tick  # type: ignore[method-assign]
        self.mode = "engine-tick-wrapper"
        log(
            "RedisplayGate: pump has no add_pre_tick_hook, wrapping "
            "Engine.tick on the instance (PyMOL_Draw clears RedisplayFlag "
            "at layer5/PyMOL.cpp:2331, so a post-draw probe is always False)"
        )
        return self.mode

    def detach(self) -> None:
        pump, self._attached_to = self._attached_to, None
        if pump is None:
            return
        remover = getattr(pump, "remove_pre_tick_hook", None)
        if self.mode == "pre-tick-hook" and callable(remover):
            remover(self._probe)
        elif self._original_tick is not None:
            try:
                pump.engine.tick = self._original_tick  # type: ignore[method-assign]
            except Exception:  # noqa: BLE001
                pass
        self._original_tick = None
        self.mode = "detached"

    # -- the probe ---------------------------------------------------------

    def _probe(self, engine: Any) -> None:
        self.probes += 1
        dirty = False
        try:
            if engine.p is not None:
                dirty = bool(engine.p.getRedisplay(1))
        except Exception as exc:  # noqa: BLE001 - never take the pump down
            log("RedisplayGate probe raised %r" % (exc,))
            return
        if dirty:
            self.dirty_probes += 1
            self.pending = True
        with self._lock:
            sinks = list(self._sinks)
        for sink in sinks:
            try:
                sink(dirty)
            except Exception as exc:  # noqa: BLE001
                log("redisplay sink %r raised %r" % (sink, exc))

    # -- api ---------------------------------------------------------------

    def mark(self, reason: str = "") -> None:
        """Force the next tick to count as dirty (resize, ray, first frame)."""
        self.external_marks += 1
        self.pending = True

    def take(self) -> bool:
        """Consume the sticky dirty bit.  Only the frame producer may call it."""
        was = self.pending
        self.pending = False
        return was

    def add_sink(self, sink: Callable[[bool], None]) -> None:
        with self._lock:
            self._sinks.append(sink)

    def remove_sink(self, sink: Callable[[bool], None]) -> None:
        with self._lock:
            if sink in self._sinks:
                self._sinks.remove(sink)

    def stats(self) -> Dict[str, Any]:
        return {
            "mode": self.mode,
            "probes": self.probes,
            "dirtyProbes": self.dirty_probes,
            "externalMarks": self.external_marks,
            "pending": self.pending,
        }


# --------------------------------------------------------------------------- #
# glReadPixels
# --------------------------------------------------------------------------- #


class PixelReadback:
    """``glReadPixels`` against whatever offscreen backend is in play.

    Resolution order for the GL entry points, so the whole three-platform
    matrix works with one code path:

    1. ``ctx.gl`` — the ``GLFunctions`` table ``glcontext/egl.py`` and
       ``glcontext/wgl.py`` expose (spike 07);
    2. ``ctx._gl`` — the private ``CDLL`` ``glcontext/cgl.py`` already holds;
    3. a fresh ``ctypes.CDLL`` on the platform's GL library, as a last resort.

    Option 1 is what spike 07 asked WP-04 to prefer ("read back through
    ``ctx.gl.glReadPixels`` ... so Mode P shares one dispatch table with the
    context on all three platforms"); options 2 and 3 exist because
    ``CGLContext`` has no ``.gl`` yet.
    """

    _DARWIN_GL = "/System/Library/Frameworks/OpenGL.framework/Libraries/libGL.dylib"

    def __init__(self, context: Any) -> None:
        self.context = context
        self.source = "none"
        self._read_pixels: Optional[Callable[..., Any]] = None
        self._pixel_storei: Optional[Callable[..., Any]] = None
        self._read_buffer: Optional[Callable[..., Any]] = None
        self._buffer: Any = None
        self._buffer_bytes = 0
        self._resolve()

    # -- resolution --------------------------------------------------------

    def _resolve(self) -> None:
        ctx = self.context
        table = getattr(ctx, "gl", None)
        if table is not None and hasattr(table, "glReadPixels"):
            self._read_pixels = table.glReadPixels
            self._pixel_storei = getattr(table, "glPixelStorei", None)
            self._read_buffer = getattr(table, "glReadBuffer", None)
            self.source = "context.gl"
            return
        lib = getattr(ctx, "_gl", None)
        if lib is not None and hasattr(lib, "glReadPixels"):
            self._bind(lib, "context._gl")
            return
        lib = self._dlopen()
        if lib is not None:
            self._bind(lib, "dlopen")
            return
        raise NoOffscreenGL(
            "cannot resolve glReadPixels for backend %r"
            % (getattr(ctx, "backend", "?"),),
            platform=sys.platform,
            backend=getattr(ctx, "backend", "?"),
            reason="no-readpixels",
        )

    def _bind(self, lib: Any, source: str) -> None:
        self._read_pixels = lib.glReadPixels
        self._pixel_storei = getattr(lib, "glPixelStorei", None)
        self._read_buffer = getattr(lib, "glReadBuffer", None)
        self.source = source

    def _dlopen(self) -> Any:
        candidates: Sequence[str]
        if sys.platform == "darwin":
            candidates = (self._DARWIN_GL,)
        elif sys.platform.startswith("win"):
            candidates = ("opengl32.dll",)
        else:
            candidates = ("libGL.so.1", "libGL.so")
        for name in candidates:
            try:
                return ctypes.CDLL(name)
            except OSError:
                continue
        return None

    # -- the readback ------------------------------------------------------

    def buffer_for(self, width: int, height: int) -> Any:
        need = int(width) * int(height) * 4
        if self._buffer is None or self._buffer_bytes < need:
            self._buffer = (ctypes.c_ubyte * need)()
            self._buffer_bytes = need
        return self._buffer

    def read(self, width: int, height: int) -> Tuple[Any, float]:
        """Read ``width x height`` RGBA from the bound FBO.  Bottom-up.

        Returns ``(buffer, milliseconds)``.  The buffer is REUSED between calls
        — encode from it immediately, never retain it.
        """
        if self._read_pixels is None:  # pragma: no cover - _resolve raises
            raise NoOffscreenGL("glReadPixels unavailable", reason="no-readpixels")
        buf = self.buffer_for(width, height)
        t0 = time.perf_counter()
        if self._read_buffer is not None:
            try:
                self._read_buffer(_GL_COLOR_ATTACHMENT0)
            except Exception:  # noqa: BLE001 - default is already correct
                self._read_buffer = None
        if self._pixel_storei is not None:
            try:
                self._pixel_storei(_GL_PACK_ALIGNMENT, 4)
            except Exception:  # noqa: BLE001
                self._pixel_storei = None
        self._read_pixels(
            0, 0, int(width), int(height), _GL_RGBA, _GL_UNSIGNED_BYTE, buf
        )
        return buf, (time.perf_counter() - t0) * 1000.0

    def info(self) -> Dict[str, Any]:
        return {
            "source": self.source,
            "bufferBytes": self._buffer_bytes,
            "backend": getattr(self.context, "backend", None),
        }


# --------------------------------------------------------------------------- #
# One subscribed client
# --------------------------------------------------------------------------- #


@dataclass
class Subscriber:
    """Per-client flow-control state.  ``sink`` is duck-typed on purpose.

    The product's sink is :class:`tenmol_bridge.session.ClientSession` (it has
    ``send_soon`` and ``outbox``); the tests use a list-backed stub.  Anything
    with ``send_soon(frame_bytes)`` works.
    """

    key: Any
    sink: Any
    last_sent: int = 0
    last_acked: int = 0
    sent_at: float = 0.0
    frames_sent: int = 0
    frames_skipped: int = 0
    bytes_sent: int = 0
    ack_latency_ms: float = 0.0
    acks: int = 0
    ack_timeouts: int = 0

    # -- flow control ------------------------------------------------------

    def in_flight(self) -> int:
        return max(0, self.last_sent - self.last_acked)

    def outbox_depth(self) -> int:
        outbox = getattr(self.sink, "outbox", None)
        if outbox is not None:
            try:
                return int(outbox.qsize())
            except Exception:  # noqa: BLE001
                return 0
        depth = getattr(self.sink, "queued", None)
        if callable(depth):
            try:
                return int(depth())
            except Exception:  # noqa: BLE001
                return 0
        return 0

    def blocked(self, params: StreamParams, now: float) -> Optional[str]:
        """``None`` when a frame may be sent, else why it may not."""
        if self.outbox_depth() > params.max_outbox:
            return "outbox"
        flight = self.in_flight()
        if flight < params.max_in_flight:
            return None
        if self.sent_at and (now - self.sent_at) >= params.ack_timeout_s:
            # The client is not acking (or the ack was lost).  Liveness beats
            # flow control: release the window, count it, keep going.
            self.ack_timeouts += 1
            self.last_acked = self.last_sent
            return None
        return "unacked"

    def ack(self, frame_id: int, now: Optional[float] = None) -> bool:
        frame_id = int(frame_id)
        if frame_id <= self.last_acked or frame_id > self.last_sent:
            return False
        self.last_acked = frame_id
        self.acks += 1
        if self.sent_at:
            self.ack_latency_ms = ((now or time.monotonic()) - self.sent_at) * 1000.0
        return True

    def record_sent(self, frame_id: int, nbytes: int, now: float) -> None:
        self.last_sent = frame_id
        self.sent_at = now
        self.frames_sent += 1
        self.bytes_sent += nbytes

    def stats(self) -> Dict[str, Any]:
        return {
            "framesSent": self.frames_sent,
            "framesSkipped": self.frames_skipped,
            "bytesSent": self.bytes_sent,
            "lastSent": self.last_sent,
            "lastAcked": self.last_acked,
            "acks": self.acks,
            "ackTimeouts": self.ack_timeouts,
            "ackLatencyMs": round(self.ack_latency_ms, 2),
        }


# --------------------------------------------------------------------------- #
# The frame header
# --------------------------------------------------------------------------- #


def pixel_frame_header(
    image: EncodedImage,
    frame_id: int,
    seq: int,
    dpr: float,
    view: Optional[Sequence[float]] = None,
    reps: Optional[Sequence[int]] = None,
    still: Optional[str] = None,
) -> Dict[str, Any]:
    """``PixelFrameHeader`` from ``packages/protocol/src/geometry.ts``.

    Byte-for-byte the shape ``packages/protocol/python/tenmol_wire.py``'s
    :func:`pixel_header` produces (``test_render.py`` asserts it), with two
    additive keys the TypeScript interface tolerates: ``still`` names the reason
    a lossless frame was sent (``settle`` / ``ray`` / ``requested``) and
    ``encodeMs`` carries the server-side cost for the client's HUD.
    """
    header: Dict[str, Any] = {
        "v": 1,
        "kind": "pixels",
        "seq": int(seq),
        "payloadBytes": len(image.data),
        "width": int(image.width),
        "height": int(image.height),
        "dpr": float(dpr),
        "encoding": image.encoding,
        "flipY": bool(image.flip_y),
        "lossless": bool(image.lossless),
        "frameId": int(frame_id),
        "encodeMs": round(image.encode_ms, 3),
    }
    if image.quality is not None:
        header["quality"] = int(image.quality)
    if view is not None:
        header["view"] = [float(v) for v in view]
    if reps is not None:
        header["reps"] = [int(r) for r in reps]
    if still is not None:
        header["still"] = still
    return header


# --------------------------------------------------------------------------- #
# The stream
# --------------------------------------------------------------------------- #


class FrameStream:
    """Readback + encode + fan-out, driven by the pump's tick hook."""

    def __init__(
        self,
        pump: Any,
        params: Optional[StreamParams] = None,
        gate: Optional[RedisplayGate] = None,
        on_event: Optional[Callable[[str, Dict[str, Any]], None]] = None,
    ) -> None:
        self.pump = pump
        self.params = (params or StreamParams()).clamp()
        self.gate = gate or RedisplayGate()
        self.on_event = on_event
        self.quality = AdaptiveQuality(base=self.params.quality)

        self._subs: Dict[Any, Subscriber] = {}
        self._lock = threading.Lock()
        self._readback: Optional[PixelReadback] = None
        self._attached = False

        self._frame_id = 0
        self._seq = 0
        self._forced = 0
        #: "a frame is owed" — set by the rate cap, by backpressure and by a
        #: pause.  DELIBERATELY NOT the same thing as ``gate.pending``, which
        #: means "the scene changed": conflating them makes every skipped frame
        #: look like motion, which resets the settle timer and produces an
        #: endless dribble of JPEGs on a static scene (measured before the
        #: split: 2 spurious frames per idle second).
        self._owed = False
        self._last_emit = 0.0
        self._last_dirty = 0.0
        self._settle_sent = True
        self._resize_pending: Optional[Tuple[int, int]] = None

        # -- telemetry (all milliseconds unless named otherwise)
        self.frames_emitted = 0
        self.stills_emitted = 0
        self.frames_skipped = 0
        self.ticks_seen = 0
        self.ticks_dirty = 0
        self.bytes_emitted = 0
        self.last_readback_ms = 0.0
        self.last_encode_ms = 0.0
        self.last_total_ms = 0.0
        self.last_bytes = 0
        self.last_error: Optional[str] = None
        self.render_failures = 0
        #: Quiet period after a render error, so a persistently broken frame
        #: does not become a 60 Hz busy loop of tracebacks.
        self.error_backoff_s = 1.0
        self._error_until = 0.0
        self._samples: List[Tuple[float, float, float, int]] = []
        self._max_samples = 512

    # -- lifecycle ---------------------------------------------------------

    def attach(self) -> "FrameStream":
        """Register the pre-draw dirty probe and the post-draw frame hook."""
        if self._attached:
            return self
        self.gate.attach(self.pump)
        self.pump.add_tick_hook(self.on_tick)
        self._attached = True
        return self

    def detach(self) -> None:
        if not self._attached:
            return
        try:
            self.pump.remove_tick_hook(self.on_tick)
        finally:
            self.gate.detach()
            self._attached = False

    def __enter__(self) -> "FrameStream":
        return self.attach()

    def __exit__(self, *exc: Any) -> None:
        self.detach()

    # -- clients -----------------------------------------------------------

    def add_client(self, sink: Any, key: Any = None) -> Subscriber:
        """Subscribe ``sink``.  Idempotent per key."""
        key = key if key is not None else id(sink)
        with self._lock:
            sub = self._subs.get(key)
            if sub is None:
                sub = Subscriber(key=key, sink=sink)
                self._subs[key] = sub
        # A new client owes a frame immediately: it has nothing to show.
        self.request_frame()
        return sub

    def remove_client(self, key_or_sink: Any) -> None:
        with self._lock:
            if key_or_sink in self._subs:
                del self._subs[key_or_sink]
                return
            for key, sub in list(self._subs.items()):
                if sub.sink is key_or_sink:
                    del self._subs[key]
                    return

    def subscriber(self, key_or_sink: Any) -> Optional[Subscriber]:
        with self._lock:
            sub = self._subs.get(key_or_sink)
            if sub is not None:
                return sub
            for candidate in self._subs.values():
                if candidate.sink is key_or_sink:
                    return candidate
        return None

    @property
    def client_count(self) -> int:
        with self._lock:
            return len(self._subs)

    def ack(self, key_or_sink: Any, frame_id: int) -> bool:
        """``{t:'ack', what:'pixels', frameId}`` from a client."""
        sub = self.subscriber(key_or_sink)
        if sub is None:
            return False
        return sub.ack(frame_id)

    # -- control -----------------------------------------------------------

    def request_frame(self, count: int = 1) -> None:
        """Emit on the next tick even if nothing is dirty."""
        self._forced = max(self._forced, int(count))

    def set_params(self, **changes: Any) -> Dict[str, Any]:
        """Apply a ``PixelStreamRequest``.  Returns the new ``PixelsPayload``."""
        params = self.params
        alias = {
            "motionEncoding": "motion_encoding",
            "settleEncoding": "settle_encoding",
            "settleMs": "settle_ms",
            "settleScale": "settle_scale",
            "maxFps": "max_fps",
            "maxInFlight": "max_in_flight",
            "ackTimeout": "ack_timeout_s",
            "serverFlip": "server_flip",
        }
        resize: Optional[Tuple[int, int]] = None
        width = changes.pop("width", None)
        height = changes.pop("height", None)
        if width or height:
            current = self.viewport()
            resize = (int(width or current[0]), int(height or current[1]))
        for name, value in changes.items():
            field_name = alias.get(name, name)
            if not hasattr(params, field_name):
                raise BridgeError(
                    "unknown pixel stream parameter %r" % (name,), parameter=name
                )
            setattr(params, field_name, value)
        for enc_attr in ("motion_encoding", "settle_encoding"):
            requested = getattr(params, enc_attr)
            setattr(
                params,
                enc_attr,
                _encode.resolve_encoding(
                    requested, prefer_lossless=enc_attr == "settle_encoding"
                ),
            )
        params.clamp()
        self.quality.set_base(params.quality)
        if resize is not None:
            self._resize_pending = resize
        self.gate.mark("set_params")
        self.request_frame()
        return self.describe()

    def viewport(self) -> Tuple[int, int]:
        engine = self.pump.engine
        return int(engine.width), int(engine.height)

    def describe(self) -> Dict[str, Any]:
        width, height = self.viewport()
        blocked = 0
        with self._lock:
            subs = list(self._subs.values())
        for sub in subs:
            if sub.in_flight() >= self.params.max_in_flight:
                blocked += 1
        return self.params.to_payload(
            width=width,
            height=height,
            frameId=self._frame_id,
            awaitingAck=blocked > 0,
            clients=len(subs),
            effectiveQuality=self.quality.quality,
            reps=[],
        )

    # -- the tick ----------------------------------------------------------

    def on_tick(self, engine: Any) -> None:
        """Post-draw hook.  Runs on the engine thread; must stay cheap."""
        self.ticks_seen += 1
        dirty = self.gate.take()
        if dirty:
            self.ticks_dirty += 1
            self._last_dirty = time.monotonic()
            self._settle_sent = False

        if self._resize_pending is not None:
            width, height = self._resize_pending
            self._resize_pending = None
            try:
                engine.resize(width, height)
                engine.p.draw()
                self.gate.mark("resize")
                self._emit_event(self.describe())
            except Exception as exc:  # noqa: BLE001
                self.last_error = "resize: %r" % (exc,)
                log("FrameStream resize failed: %r" % (exc,))
            dirty = True
            self._settle_sent = False

        if self.params.paused or not self._subs:
            # Nobody consumed the frame that dirty bit stood for, so the first
            # frame after unpause must still be a real one.
            if dirty:
                self._owed = True
            return
        if engine.context is None or engine.cmd is None:
            if dirty:
                self._owed = True
            return

        now = time.monotonic()
        if now < self._error_until:
            if dirty:
                self._owed = True
            return
        forced = self._forced > 0
        owed = self._owed or forced
        quiet = (now - self._last_dirty) * 1000.0 >= self.params.settle_ms

        if not dirty and not owed:
            # Quiescent.  One lossless still, then nothing at all until
            # something changes: "never spin at full rate on a static scene".
            if not self._settle_sent and self.frames_emitted > 0 and quiet:
                if self._emit(engine, still="settle") is not None:
                    self._settle_sent = True
            return

        if not forced and (now - self._last_emit) < 1.0 / self.params.max_fps:
            # Rate cap.  We still OWE this frame — dropping it here would leave
            # the client showing a stale picture forever — but it is not fresh
            # motion, so the settle timer keeps running.
            self._owed = True
            return

        if self._forced > 0:
            self._forced -= 1
        # A frame we owe on a scene that has already gone quiet may as well be
        # the lossless one; a frame we owe mid-drag must be cheap.
        still = "settle" if (not dirty and quiet and not self._settle_sent) else None
        if still is None and not dirty and quiet:
            still = "requested"
        self._owed = False
        if self._emit(engine, still=still) is not None and still is not None:
            self._settle_sent = True

    # -- emission ----------------------------------------------------------

    def _ready_subscribers(self, now: float) -> Tuple[List[Subscriber], int]:
        ready: List[Subscriber] = []
        blocked = 0
        with self._lock:
            subs = list(self._subs.values())
        for sub in subs:
            reason = sub.blocked(self.params, now)
            if reason is None:
                ready.append(sub)
            else:
                blocked += 1
                sub.frames_skipped += 1
        return ready, blocked

    def _emit(self, engine: Any, still: Optional[str] = None) -> Optional[int]:
        now = time.monotonic()
        ready, blocked = self._ready_subscribers(now)
        if not ready:
            # Everyone is behind.  Drop the frame (never queue it), remember we
            # still owe one, and make the next one cheaper.
            self.frames_skipped += 1
            self.quality.observe(0.0, skipped=True)
            self._owed = True
            return None

        lossless = still is not None
        encoding = (
            self.params.settle_encoding if lossless else self.params.motion_encoding
        )
        t0 = time.perf_counter()
        try:
            image = self._render_frame(engine, encoding, lossless=lossless)
        except Exception as exc:  # noqa: BLE001 - a broken frame must not kill the pump
            self.last_error = repr(exc)
            self.render_failures += 1
            # Back off rather than retrying a failing render 60 times a second.
            self._error_until = now + self.error_backoff_s
            log("FrameStream: frame dropped: %r" % (exc,))
            return None
        total_ms = (time.perf_counter() - t0) * 1000.0

        self._frame_id += 1
        self._seq += 1
        header = pixel_frame_header(
            image,
            frame_id=self._frame_id,
            seq=self._seq,
            dpr=self.params.dpr,
            view=self._safe_view(engine),
            still=still,
        )
        frame = encode_binary_frame(header, image.data)

        for sub in ready:
            try:
                sub.sink.send_soon(frame)
            except Exception as exc:  # noqa: BLE001
                log("pixel sink %r raised %r" % (sub.key, exc))
                continue
            sub.record_sent(self._frame_id, len(frame), now)

        self.frames_emitted += 1
        if lossless:
            self.stills_emitted += 1
        self.bytes_emitted += len(frame)
        self.last_encode_ms = image.encode_ms
        self.last_total_ms = total_ms
        self.last_bytes = len(frame)
        self._last_emit = now
        if not lossless:
            self.quality.observe(image.encode_ms, skipped=blocked > 0)
        self._samples.append(
            (self.last_readback_ms, image.encode_ms, total_ms, len(frame))
        )
        if len(self._samples) > self._max_samples:
            del self._samples[: len(self._samples) - self._max_samples]
        return self._frame_id

    def _render_frame(
        self, engine: Any, encoding: str, lossless: bool
    ) -> EncodedImage:
        """Read the FBO back and encode it.  Engine thread only."""
        if self._readback is None:
            self._readback = PixelReadback(engine.context)
        scale = self.params.settle_scale if lossless else 1.0
        if scale > 1.0:
            return self._render_scaled_still(engine, encoding, scale)
        width, height = self.viewport()
        buf, read_ms = self._readback.read(width, height)
        self.last_readback_ms = read_ms
        return _encode.encode_rgba(
            buf,
            width,
            height,
            encoding=encoding,
            quality=self.quality.quality,
            bottom_up=True,
            flip=self.params.server_flip,
            alpha=self.params.alpha,
        )

    def _render_scaled_still(
        self, engine: Any, encoding: str, scale: float
    ) -> EncodedImage:
        """Settle at ``dpr``: resize the FBO up, draw, read, resize back.

        13.9 ms/frame at 2560x1920 is fine for a still and not for a drag, which
        is exactly why this only ever runs on the settle path (plan §1.3).
        """
        base_w, base_h = self.viewport()
        big_w, big_h = int(base_w * scale), int(base_h * scale)
        try:
            engine.resize(big_w, big_h)
            engine.p.draw()
            assert self._readback is not None
            buf, read_ms = self._readback.read(big_w, big_h)
            self.last_readback_ms = read_ms
            return _encode.encode_rgba(
                buf,
                big_w,
                big_h,
                encoding=encoding,
                quality=self.quality.quality,
                bottom_up=True,
                flip=self.params.server_flip,
                alpha=self.params.alpha,
            )
        finally:
            try:
                engine.resize(base_w, base_h)
                engine.p.draw()
                # The resize dirtied PyMOL again; swallow that so the settle
                # still does not immediately re-trigger itself.
                engine.p.getRedisplay(1)
                self.gate.pending = False
            except Exception as exc:  # noqa: BLE001
                self.last_error = "restore-size: %r" % (exc,)
                log("FrameStream could not restore the viewport: %r" % (exc,))

    @staticmethod
    def _safe_view(engine: Any) -> Optional[List[float]]:
        try:
            return [float(v) for v in engine.cmd.get_view()]
        except Exception:  # noqa: BLE001
            return None

    def _emit_event(self, payload: Dict[str, Any]) -> None:
        if self.on_event is not None:
            try:
                self.on_event(TOPIC_PIXELS, payload)
            except Exception as exc:  # noqa: BLE001
                log("pixels event sink raised %r" % (exc,))

    # -- ray ---------------------------------------------------------------

    def ray_now(
        self,
        engine: Any,
        width: int = 0,
        height: int = 0,
        antialias: int = -1,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """``cmd.ray`` as an explicit high-quality mode.  Engine thread only.

        ``cmd.ray()`` leaves the result in the scene's image buffer, and
        ``cmd.png(None, prior=1)`` returns *those exact bytes* as a PNG without
        re-rendering: ``CmdPNG`` returns ``PyBytes_FromStringAndSize(pngbuf)``
        whenever the filename is empty (``layer4/Cmd.cpp:4830-4834``), and
        ``prior=1`` takes the fast path that never touches
        ``_call_with_opengl_context`` (``modules/pymol/exporting.py:588-593``).
        That matters: the plain ``cmd.png(None)`` path needs WP-02's
        ``_pushValidContext`` shim and raises "getting png buffer failed"
        without it — measured.
        """
        cmd = engine.cmd
        if cmd is None:
            raise PyMOLUnavailable("cannot ray: PyMOL is not available")
        t0 = time.perf_counter()
        cmd.ray(int(width), int(height), int(antialias), quiet=1, **kwargs)
        ray_ms = (time.perf_counter() - t0) * 1000.0
        data = cmd.png(None, prior=1, quiet=1)
        if not isinstance(data, (bytes, bytearray)):
            raise BridgeError(
                "cmd.png(None, prior=1) returned %r, not PNG bytes"
                % (type(data).__name__,)
            )
        png_ms = (time.perf_counter() - t0) * 1000.0 - ray_ms
        image = EncodedImage(
            data=bytes(data),
            encoding="png",
            width=int(width) or self.viewport()[0],
            height=int(height) or self.viewport()[1],
            flip_y=False,  # ScenePNG writes top-down, unlike glReadPixels
            quality=None,
            encode_ms=png_ms,
        )
        frame_id = self._push_still(image, still="ray")
        # PyMOL keeps showing the ray image until the scene changes, exactly as
        # the desktop does, so the next readback would just be the same picture.
        self._settle_sent = True
        return {
            "frameId": frame_id,
            "bytes": len(image.data),
            "width": image.width,
            "height": image.height,
            "rayMs": round(ray_ms, 3),
            "pngMs": round(png_ms, 3),
        }

    def ray(self, width: int = 0, height: int = 0, **kwargs: Any) -> Any:
        """Non-blocking :meth:`ray_now`; returns the pump's ``Future``."""
        return self.pump.submit(
            lambda engine: self.ray_now(engine, width, height, **kwargs),
            label="render:ray",
        )

    def _push_still(self, image: EncodedImage, still: str) -> int:
        now = time.monotonic()
        self._frame_id += 1
        self._seq += 1
        header = pixel_frame_header(
            image,
            frame_id=self._frame_id,
            seq=self._seq,
            dpr=self.params.dpr,
            still=still,
        )
        frame = encode_binary_frame(header, image.data)
        with self._lock:
            subs = list(self._subs.values())
        for sub in subs:
            try:
                sub.sink.send_soon(frame)
            except Exception as exc:  # noqa: BLE001
                log("pixel sink %r raised %r" % (sub.key, exc))
                continue
            sub.record_sent(self._frame_id, len(frame), now)
        self.frames_emitted += 1
        self.stills_emitted += 1
        self.bytes_emitted += len(frame)
        self.last_bytes = len(frame)
        self._last_emit = now
        return self._frame_id

    # -- telemetry ---------------------------------------------------------

    def timings(self) -> Dict[str, Any]:
        """Median / p95 of the last :attr:`_max_samples` emitted frames."""
        if not self._samples:
            return {"samples": 0}
        read = sorted(s[0] for s in self._samples)
        enc = sorted(s[1] for s in self._samples)
        total = sorted(s[2] for s in self._samples)
        size = sorted(s[3] for s in self._samples)

        def pick(values: List[float], q: float) -> float:
            return values[min(len(values) - 1, int(len(values) * q))]

        return {
            "samples": len(self._samples),
            "readbackMsMedian": round(pick(read, 0.5), 3),
            "encodeMsMedian": round(pick(enc, 0.5), 3),
            "frameMsMedian": round(pick(total, 0.5), 3),
            "frameMsP95": round(pick(total, 0.95), 3),
            "kbMedian": round(pick(size, 0.5) / 1024.0, 1),
            "kbP95": round(pick(size, 0.95) / 1024.0, 1),
        }

    def stats(self) -> Dict[str, Any]:
        with self._lock:
            subs = {str(key): sub.stats() for key, sub in self._subs.items()}
        return {
            "attached": self._attached,
            "clients": len(subs),
            "framesEmitted": self.frames_emitted,
            "stills": self.stills_emitted,
            "framesSkipped": self.frames_skipped,
            "ticksSeen": self.ticks_seen,
            "ticksDirty": self.ticks_dirty,
            "bytesEmitted": self.bytes_emitted,
            "renderFailures": self.render_failures,
            "owed": self._owed,
            "lastError": self.last_error,
            "gate": self.gate.stats(),
            "quality": self.quality.stats(),
            "encoder": _encode.capabilities(),
            "readback": self._readback.info() if self._readback else None,
            "params": self.params.to_payload(),
            "timings": self.timings(),
            "subscribers": subs,
            "headerAlignment": HEADER_ALIGNMENT,
        }

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return "<FrameStream %s>" % json.dumps(
            {
                "clients": self.client_count,
                "frames": self.frames_emitted,
                "skipped": self.frames_skipped,
            }
        )
