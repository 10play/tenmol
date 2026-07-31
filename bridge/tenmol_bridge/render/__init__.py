"""The render feed: Mode P (server pixels) and Mode G (client geometry).

Plan §1.3, as amended by the product owner: **both modes are built from the
start**.  Mode P is the correctness baseline — every rep renders exactly as
PyMOL renders it, because it is PyMOL rendering it — and Mode G is developed
alongside it per rep, with automatic fallback to Mode P for anything it cannot
express.

    ``framestream``  the FBO readback, the encode policy, flow control, ray
    ``encode``       RGBA bytes -> jpeg/png/webp/raw, and adaptive quality
    ``modeg``        ``_cmd.web_get_rep_geometry`` -> @tenmol/protocol frames

:class:`RenderService` is the single object the WebSocket server holds.  It owns
one tick hook, one dirty gate and one geometry cache, and it exposes the six
``_bridge.*`` routes the client calls.  **It does not import FastAPI**: the
server passes sessions in and gets frames back through ``send_soon``.

WIRING (six lines in ``server.py``, which WP-02 owns — see the WP-04 report)::

    from .render import RenderService
    self.render = RenderService(self.pump)          # in BridgeServer.__init__
    self.render.attach()                            # in start(), after the pump
    self.render.detach()                            # in stop()
    self.render.add_client(session)                 # on sub 'pixels'/'geometry'
    self.render.remove_client(session)              # on disconnect
    self.render.handle_client_message(session, msg) # for t:'ack'
    ... and Dispatcher._route() gains RenderService.ROUTES
"""

from __future__ import annotations

import threading
import time
from typing import Any, Callable, Dict, List, Optional

from ..config import log
from ..errors import BadMessage, BridgeError
from . import encode
from .encode import AdaptiveQuality, EncodedImage, capabilities as encoder_capabilities
from .framestream import (
    TOPIC_PIXELS,
    FrameStream,
    PixelReadback,
    RedisplayGate,
    StreamParams,
    Subscriber,
    pixel_frame_header,
)
from .modeg import (
    MODE_G_CAPABLE_REPS,
    REP_IDS,
    REP_NAMES,
    TOPIC_GEOMETRY,
    GeometryResult,
    GeometryService,
    RepInv,
    rep_id,
    rep_name,
)

__all__ = [
    "AdaptiveQuality",
    "EncodedImage",
    "FrameStream",
    "GeometryResult",
    "GeometryService",
    "MODE_G_CAPABLE_REPS",
    "PixelReadback",
    "REP_IDS",
    "REP_NAMES",
    "RedisplayGate",
    "RenderService",
    "RepInv",
    "StreamParams",
    "Subscriber",
    "TOPIC_GEOMETRY",
    "TOPIC_PIXELS",
    "encode",
    "encoder_capabilities",
    "pixel_frame_header",
    "rep_id",
    "rep_name",
]


class RenderService:
    """Mode P + Mode G, behind one attach/detach and six routes."""

    #: ``fn`` values the dispatcher should route here instead of into ``pymol``.
    ROUTES = (
        "_bridge.set_pixel_stream",
        "_bridge.request_frame",
        "_bridge.ray",
        "_bridge.get_geometry",
        # The viewport's Mode-G source calls this name POSITIONALLY:
        # `_bridge.pull_geometry(object, repName, state)`
        # (packages/viewport/src/modeG/sources.ts:40,74). Same handler.
        "_bridge.pull_geometry",
        "_bridge.set_render_mode",
        "_bridge.render_stats",
    )

    #: How often the Mode-G fingerprint is polled, in engine ticks.  15 ticks at
    #: 60 Hz = 4 Hz, the plan's slow-tick rate; the poll itself is ~0.03 ms.
    scan_every = 15

    def __init__(
        self,
        pump: Any,
        params: Optional[StreamParams] = None,
        emit: Optional[Callable[[str, Dict[str, Any]], None]] = None,
    ) -> None:
        self.pump = pump
        #: ``emit(topic, payload)`` — the server's per-topic fan-out.  Called on
        #: the ENGINE thread, so it must not block (``ClientSession.emit_soon``).
        self.emit = emit
        self.stream = FrameStream(pump, params=params, on_event=self._emit)
        self.geometry = GeometryService(pump, on_event=self._emit)
        #: Client render-mode policy: ``{'default': 'pixel', 'perRep': {...}}``.
        self.policy: Dict[str, Any] = {"default": "pixel", "perRep": {}}
        self._lock = threading.Lock()
        self._ticks = 0
        self._attached = False
        self._geometry_clients: Dict[Any, Any] = {}

    # -- lifecycle ---------------------------------------------------------

    def attach(self) -> "RenderService":
        if self._attached:
            return self
        self.stream.attach()
        self.pump.add_tick_hook(self._on_tick)
        self._attached = True
        log(
            "render service attached: gate=%s encoder=%s modeG=%s"
            % (
                self.stream.gate.mode,
                ",".join(encode.supported_encodings()),
                self.geometry.capabilities()["accessor"],
            )
        )
        return self

    def detach(self) -> None:
        if not self._attached:
            return
        try:
            self.pump.remove_tick_hook(self._on_tick)
        finally:
            self.stream.detach()
            self._attached = False

    def __enter__(self) -> "RenderService":
        return self.attach()

    def __exit__(self, *exc: Any) -> None:
        self.detach()

    # -- clients -----------------------------------------------------------

    def add_client(self, session: Any, topic: str = TOPIC_PIXELS) -> None:
        """A client subscribed to ``pixels`` or ``geometry``."""
        if topic == TOPIC_PIXELS:
            self.stream.add_client(session)
        elif topic == TOPIC_GEOMETRY:
            with self._lock:
                self._geometry_clients[id(session)] = session
        else:
            raise BadMessage("render service does not serve topic %r" % (topic,))

    def remove_client(self, session: Any) -> None:
        self.stream.remove_client(session)
        with self._lock:
            self._geometry_clients.pop(id(session), None)

    def handle_client_message(self, session: Any, message: Dict[str, Any]) -> bool:
        """Consume ``{t:'ack', what:'pixels', frameId:N}``.  True if handled."""
        if message.get("t") != "ack":
            return False
        what = message.get("what", TOPIC_PIXELS)
        if what != TOPIC_PIXELS:
            return False
        frame_id = message.get("frameId", message.get("frame_id"))
        try:
            self.stream.ack(session, int(frame_id))
        except (TypeError, ValueError):
            raise BadMessage("ack needs an integer frameId", frameId=frame_id)
        return True

    # -- the tick ----------------------------------------------------------

    def _on_tick(self, engine: Any) -> None:
        """Runs after :meth:`FrameStream.on_tick` (hooks fire in add order)."""
        self._ticks += 1
        if self._ticks % self.scan_every:
            return
        with self._lock:
            listeners = bool(self._geometry_clients)
        if not listeners:
            return
        try:
            invalidated = self.geometry.scan(engine)
        except Exception as exc:  # noqa: BLE001
            log("geometry scan raised %r" % (exc,))
            return
        if invalidated:
            self._emit(TOPIC_GEOMETRY, {"invalidated": invalidated})

    def _emit(self, topic: str, payload: Dict[str, Any]) -> None:
        if self.emit is None:
            return
        try:
            self.emit(topic, payload)
        except Exception as exc:  # noqa: BLE001
            log("render event emit raised %r" % (exc,))

    # -- routes ------------------------------------------------------------

    def route(self, symbol: str, args: Any = None, kwargs: Any = None) -> Any:
        """Dispatch one ``_bridge.*`` call.  Returns a ``Future`` or a value."""
        args = list(args or ())
        kwargs = dict(kwargs or {})
        if symbol == "_bridge.set_pixel_stream":
            return self.stream.set_params(**kwargs)
        if symbol == "_bridge.request_frame":
            self.stream.request_frame(int(kwargs.get("count", 1)))
            self.stream.gate.mark("client-request")
            return self.stream.describe()
        if symbol == "_bridge.ray":
            return self.stream.ray(
                int(kwargs.pop("width", 0) or (args[0] if args else 0)),
                int(kwargs.pop("height", 0) or (args[1] if len(args) > 1 else 0)),
                **kwargs,
            )
        if symbol in ("_bridge.get_geometry", "_bridge.pull_geometry"):
            # Positional form, used by the viewport: (object, rep, state).
            for name, value in zip(("object", "rep", "state"), args):
                kwargs.setdefault(name, value)
            return self._geometry_call(**kwargs)
        if symbol == "_bridge.set_render_mode":
            return self.set_render_mode(**kwargs)
        if symbol == "_bridge.render_stats":
            return self.stats()
        raise BridgeError("no render route for %r" % (symbol,), symbol=symbol)

    def _geometry_call(
        self,
        object: str = "",  # noqa: A002 - the wire name is `object`
        rep: Any = None,
        state: int = -1,
        have: Optional[str] = None,
        update: bool = True,
        session: Any = None,
    ) -> Any:
        if not object or rep is None:
            raise BadMessage("get_geometry needs `object` and `rep`")

        def body(engine: Any) -> Dict[str, Any]:
            result = self.geometry.fetch(
                engine, object, rep, state=state, update=update, have=have
            )
            if result.frame:
                for client in self._geometry_sinks():
                    try:
                        client.send_soon(result.frame)
                    except Exception as exc:  # noqa: BLE001
                        log("geometry sink raised %r" % (exc,))
            return result.to_json()

        return self.pump.submit(body, label="render:get_geometry")

    def _geometry_sinks(self) -> List[Any]:
        with self._lock:
            return list(self._geometry_clients.values())

    def set_render_mode(
        self, default: Optional[str] = None, perRep: Any = None, **_: Any
    ) -> Dict[str, Any]:
        """Apply a ``RenderModePolicy`` and answer with the EFFECTIVE modes.

        A rep the accessor cannot serve comes back ``effective:'pixel'`` with a
        ``fallbackReason`` — never silently.  ``geometry.ts``'s
        ``resolveRenderMode()`` is the client-side twin of this.
        """
        if default is not None:
            if default not in ("pixel", "geometry"):
                raise BadMessage("render mode must be 'pixel' or 'geometry'")
            self.policy["default"] = default
        if perRep:
            for entry in perRep:
                index = rep_id(entry.get("rep"))
                requested = entry.get("requested", self.policy["default"])
                if requested not in ("pixel", "geometry"):
                    raise BadMessage("render mode must be 'pixel' or 'geometry'")
                self.policy["perRep"][index] = requested

        caps = self.geometry.capabilities()
        modes: List[Dict[str, Any]] = []
        for index in sorted(REP_NAMES):
            requested = self.policy["perRep"].get(index, self.policy["default"])
            effective, reason = self._resolve(index, requested, caps["accessor"])
            entry = {
                "rep": index,
                "name": REP_NAMES[index],
                "requested": requested,
                "effective": effective,
            }
            if reason:
                entry["fallbackReason"] = reason
            modes.append(entry)
        payload = {"default": self.policy["default"], "modes": modes}
        self._emit(TOPIC_GEOMETRY, {"invalidated": [], "modes": modes})
        # Anything that fell back to Mode P must be redrawn server-side.
        self.stream.gate.mark("render-mode")
        self.stream.request_frame()
        return payload

    @staticmethod
    def _resolve(index: int, requested: str, accessor: bool):
        if requested == "pixel":
            return "pixel", None
        if not accessor:
            return "pixel", "no-accessor"
        if index not in MODE_G_CAPABLE_REPS:
            return "pixel", "unsupported-rep"
        return "geometry", None

    # -- diagnostics -------------------------------------------------------

    def stats(self) -> Dict[str, Any]:
        return {
            "attached": self._attached,
            "modeP": self.stream.stats(),
            "modeG": self.geometry.stats(),
            "policy": {
                "default": self.policy["default"],
                "perRep": {
                    REP_NAMES.get(k, str(k)): v
                    for k, v in self.policy["perRep"].items()
                },
            },
            "geometryClients": len(self._geometry_sinks()),
            "uptimeS": round(time.monotonic() - _T0, 1),
        }


_T0 = time.monotonic()
