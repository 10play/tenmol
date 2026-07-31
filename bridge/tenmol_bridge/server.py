"""The HTTP/WebSocket surface: ``/healthz``, ``/ws``, ``/blob/{id}``.

The asyncio thread **never** touches PyMOL.  It submits to
:class:`tenmol_bridge.pump.Pump` and awaits the future.  A message is submitted
synchronously in receive order and its reply is awaited on a background task,
so a slow call (``ray``) does not head-of-line-block the socket while the
engine still sees commands in the order the client sent them.

Security is the transport, not a symbol deny-list (plan §A6):

* bind ``127.0.0.1`` only;
* a 256-bit token minted at startup, written mode ``0600``, required on ``/ws``
  and ``/blob``;
* an ``Origin`` allow-list;
* a loopback peer check — the precedent is PyMOL's own HTTP bridge, which hard
  rejects non-loopback peers (``modules/pymol/pymolhttpd.py:61-68``).
"""

from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional, Sequence

from fastapi import FastAPI, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from .blobs import BlobNotFound, BlobStore
from .config import BridgeConfig, log
from .dispatch import Dispatcher
from .engine import EngineState
from .errors import BadMessage, error_payload
from .incentive_only import as_wire as incentive_manifest
from .policy import build_policy
from .pump import Pump
from .render import TOPIC_GEOMETRY, TOPIC_PIXELS, RenderService
from .session import (
    T_CALL,
    T_CONFIRM,
    T_DO,
    T_INPUT,
    T_PING,
    T_SUB,
    T_UNSUB,
    TOPIC_FEEDBACK,
    TOPIC_PROGRESS,
    ClientSession,
    err_frame,
    err_frame_from_exception,
    feedback_frame,
    hello_frame,
    ok_frame,
)
from .shims import Shims

__all__ = ["create_app", "BridgeServer"]


class BridgeServer:
    """Owns the pump, the policy, the blob store, the shims and the clients."""

    def __init__(self, config: Optional[BridgeConfig] = None) -> None:
        self.config = config or BridgeConfig()
        self.pump = Pump(self.config)
        self.blobs = BlobStore()
        self.shims = Shims(self.pump)
        self.policy = build_policy()
        self.render = RenderService(self.pump, emit=self._emit_topic)
        self.dispatcher = Dispatcher(
            pump=self.pump,
            policy=self.policy,
            blobs=self.blobs,
            on_shutdown=self.request_shutdown,
            on_dangerous=lambda symbol, why: log("dangerous: %s (%s)" % (symbol, why)),
            bridge_routes=self.render.route,
        )
        self.sessions: List[ClientSession] = []
        self.shutdown_requested = False
        self._started = False

    # -- lifecycle ---------------------------------------------------------

    def start(self) -> None:
        if self._started:
            return
        self._started = True
        try:
            self.pump.start()
        except Exception as exc:  # noqa: BLE001 - the server stays up
            log("pump failed to start: %r" % (exc,))
        if self.pump.state == EngineState.DEGRADED:
            log(
                "RUNNING DEGRADED - PyMOL is unavailable (%s). RPC answers with "
                "err/PyMOLUnavailable; the front-end is still developable."
                % self.pump.engine.error
            )
        elif self.pump.state == EngineState.HEADLESS:
            log(
                "RUNNING HEADLESS - no offscreen GL. Picking, Mode P and the "
                "deferred draw queue are unavailable."
            )
        else:
            # The shims need a live pump and a live PyMOL.
            self.pump.call(lambda _engine: self.shims.install(), label="shims")
        self.pump.status_poller.add_sink(self._on_status)
        if self.pump.state == EngineState.RUNNING:
            try:
                self.render.attach()
            except Exception as exc:  # noqa: BLE001 - the server stays up
                log("render service failed to attach: %r" % (exc,))
        else:
            log("render service NOT attached (engine is %s)" % (self.pump.state,))

    def stop(self) -> None:
        if not self._started:
            return
        self.pump.status_poller.remove_sink(self._on_status)
        try:
            self.render.detach()
        except Exception as exc:  # noqa: BLE001
            log("render service detach raised %r" % (exc,))
        try:
            self.pump.call(lambda _engine: self.shims.uninstall(), timeout=5.0,
                           label="shims-uninstall")
        except Exception:  # noqa: BLE001
            pass
        self.pump.stop()
        self.blobs.clear()
        self._started = False

    def request_shutdown(self) -> None:
        """``cmd.quit`` routed here (plan §A6)."""
        self.shutdown_requested = True
        log("shutdown requested by the client (cmd.quit)")

    # -- fan-out (called on the STATUS thread) -----------------------------

    def _on_status(
        self, lines: Sequence[str], progress: float, updates: Sequence[Any]
    ) -> None:
        if not self.sessions:
            return
        for session in list(self.sessions):
            if lines and TOPIC_FEEDBACK in session.subs:
                session.send_soon(feedback_frame(lines))
            if TOPIC_PROGRESS in session.subs:
                session.emit_soon(TOPIC_PROGRESS, {"value": progress})

    def _emit_topic(self, topic: str, payload: Dict[str, Any]) -> None:
        """RenderService -> subscribed clients.  Called on the ENGINE thread."""
        for session in list(self.sessions):
            if topic in session.subs:
                session.emit_soon(topic, payload)

    # -- guards ------------------------------------------------------------

    def check_http(self, request: Request) -> Optional[JSONResponse]:
        client = request.client.host if request.client else None
        if not self.config.peer_allowed(client):
            return JSONResponse({"error": "non-loopback peer"}, status_code=403)
        if not self.config.origin_allowed(request.headers.get("origin")):
            return JSONResponse({"error": "origin not allowed"}, status_code=403)
        return None

    def check_token(self, presented: Optional[str]) -> bool:
        return self.config.token_ok(presented)

    def hello(self) -> Dict[str, Any]:
        status = self.pump.status()
        return hello_frame(
            pymolVersion=self.pump.pymol_version,
            state=status["state"],
            width=status["width"],
            height=status["height"],
            glutThread=status["glutThread"],
            threadIdent=status["threadIdent"],
            gl=status["gl"],
            incentiveOnly=incentive_manifest(),
            # Mode G availability, so the client does not have to probe blind.
            # `packages/viewport/src/renderPolicy.ts:28` documents this field.
            modeG=self.render.geometry.capabilities(),
        )


def create_app(config: Optional[BridgeConfig] = None) -> FastAPI:
    server = BridgeServer(config)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        server.start()
        try:
            yield
        finally:
            server.stop()

    app = FastAPI(title="tenmol-bridge", version="0.1.0", lifespan=lifespan)
    app.state.server = server
    app.state.config = server.config
    app.state.pump = server.pump

    # -- health ------------------------------------------------------------

    @app.get("/healthz")
    async def healthz(request: Request) -> Response:
        denied = server.check_http(request)
        if denied is not None:
            return denied
        status = server.pump.status()
        status["clients"] = len(server.sessions)
        status["blobs"] = server.blobs.stats()
        status["shims"] = server.shims.info()
        status["shutdownRequested"] = server.shutdown_requested
        return JSONResponse(status)

    # -- blobs -------------------------------------------------------------

    @app.get("/blob/{blob_id}")
    async def get_blob(blob_id: str, request: Request) -> Response:
        denied = server.check_http(request)
        if denied is not None:
            return denied
        token = request.headers.get("x-tenmol-token") or request.query_params.get(
            "token"
        )
        if not server.check_token(token):
            return JSONResponse({"error": "bad token"}, status_code=401)
        try:
            blob = server.blobs.get(blob_id)
        except BlobNotFound:
            return JSONResponse({"error": "no such blob"}, status_code=404)
        return Response(
            content=blob.read(),
            media_type=blob.mime,
            headers={"cache-control": "no-store"},
        )

    # -- the socket --------------------------------------------------------

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket) -> None:
        client_host = ws.client.host if ws.client else None
        if not server.config.peer_allowed(client_host):
            await ws.close(code=4403)
            return
        if not server.config.origin_allowed(ws.headers.get("origin")):
            await ws.close(code=4403)
            return
        token = ws.query_params.get("token") or ws.headers.get("x-tenmol-token")
        if not server.check_token(token):
            await ws.close(code=4401)
            return

        await ws.accept()
        session = ClientSession(ws)
        server.sessions.append(session)
        writer = asyncio.get_running_loop().create_task(session.writer())
        try:
            await session.send(server.hello())
            while True:
                message = await ws.receive()
                if message.get("type") == "websocket.disconnect":
                    break
                text = message.get("text")
                if text is None:
                    await session.send(
                        err_frame(
                            None,
                            error_payload(
                                BadMessage(
                                    "binary frames are server->client only in "
                                    "protocol v1"
                                )
                            ),
                        )
                    )
                    continue
                try:
                    payload = json.loads(text)
                except ValueError as exc:
                    await session.send(
                        err_frame(
                            None, error_payload(BadMessage("invalid JSON: %s" % exc))
                        )
                    )
                    continue
                await _handle(server, session, payload)
        except WebSocketDisconnect:
            pass
        finally:
            if session in server.sessions:
                server.sessions.remove(session)
            try:
                server.render.remove_client(session)
            except Exception as exc:  # noqa: BLE001
                log("render remove_client raised %r" % (exc,))
            await session.close()
            writer.cancel()

    return app


async def _handle(
    server: BridgeServer, session: ClientSession, msg: Any
) -> None:
    if not isinstance(msg, dict):
        await session.send(
            err_frame(None, error_payload(BadMessage("frame is not an object")))
        )
        return
    msg_id = msg.get("id")
    kind = msg.get("t")
    try:
        if kind == T_CALL:
            future = server.dispatcher.call(
                msg.get("fn"), msg.get("args"), msg.get("kwargs")
            )
            session.spawn(_reply(session, msg_id, future))
        elif kind == T_DO:
            future = server.dispatcher.do(msg.get("cmd"), echo=bool(msg.get("echo", True)))
            session.spawn(_reply(session, msg_id, future))
        elif kind == T_INPUT:
            future = server.dispatcher.input(msg)
            session.spawn(_reply(session, msg_id, future, quiet=msg_id is None))
        elif kind == T_CONFIRM:
            future = server.dispatcher.confirm(msg.get("fn"))
            session.spawn(_reply(session, msg_id, future))
        elif kind == T_SUB:
            topic = session.subs.add(msg.get("topic"))
            await session.send(ok_frame(msg_id, {"topic": topic, "subscribed": True}))
            if topic in (TOPIC_PIXELS, TOPIC_GEOMETRY):
                server.render.add_client(session, topic)
            if topic == TOPIC_FEEDBACK:
                # Replay what the engine said before this client existed
                # (banner, startup script).  The drain is consume-once, so
                # nobody else could have handed it over.
                backlog = server.pump.status_poller.lines(limit=2000)
                if backlog:
                    await session.send(feedback_frame(backlog))
        elif kind == T_UNSUB:
            topic = session.subs.remove(msg.get("topic"))
            if topic == TOPIC_PIXELS:
                server.render.stream.remove_client(session)
            await session.send(ok_frame(msg_id, {"topic": topic, "subscribed": False}))
        elif kind == T_PING:
            await session.send({"id": msg_id, "t": "pong"})
        elif server.render.handle_client_message(session, msg):
            # `{t:'ack', what:'pixels', frameId:N}` — Mode P flow control. No
            # reply: an ack that produced an ok frame would double the traffic
            # it exists to bound.
            pass
        else:
            raise BadMessage("unknown message type %r" % (kind,))
    except Exception as exc:  # noqa: BLE001
        await session.send(err_frame_from_exception(msg_id, exc))


async def _reply(
    session: ClientSession,
    msg_id: Optional[int],
    future: Any,
    quiet: bool = False,
) -> None:
    try:
        outcome = await asyncio.wrap_future(future)
    except BaseException as exc:  # noqa: BLE001
        if quiet:
            log("fire-and-forget request failed: %r" % (exc,))
            return
        await session.send(err_frame_from_exception(msg_id, exc))
        return
    if quiet:
        return
    result = outcome.get("result") if isinstance(outcome, dict) else outcome
    extra: Dict[str, Any] = {}
    if isinstance(outcome, dict):
        if outcome.get("invalidates"):
            extra["invalidates"] = list(outcome["invalidates"])
        if outcome.get("dangerous"):
            extra["dangerous"] = True
    await session.send(ok_frame(msg_id, result, **extra))
