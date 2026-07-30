"""FastAPI/uvicorn WebSocket server for the tenmol bridge.

One WebSocket at ``/ws``, JSON text frames, plus binary frames for geometry
(see :mod:`tenmol_bridge.topics`).  The asyncio loop never calls PyMOL: it
submits to :class:`tenmol_bridge.pump.PyMOLPump` and awaits the future.

Ordering: a message is submitted to the pump synchronously, in receive order,
before its reply is awaited on a background task.  So slow calls do not head-of-
line-block the socket, while the engine still sees commands in the order the
client sent them.
"""

from __future__ import annotations

import asyncio
import json
import sys
from contextlib import asynccontextmanager
from typing import Any, Dict, Optional, Sequence, Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from . import BridgeConfig
from .dispatch import BadMessage, DispatchError, Dispatcher, Policy, error_payload
from .feedback import FeedbackBroker
from .pump import PumpState, PyMOLPump
from .topics import (
    T_CALL,
    T_DO,
    T_INPUT,
    T_SUB,
    T_UNSUB,
    TOPIC_FEEDBACK,
    Subscriptions,
    UnknownTopic,
    encode_binary_frame,
    err_frame,
    feedback_frame,
    hello_frame,
    ok_frame,
)


def log(message: str) -> None:
    """Line-buffered, flushed logging.

    Spike 00 §6.2: PyMOL tears the process down with C ``exit()``
    (``layer5/main.cpp:221``, ``layer1/P.cpp:359/369/1488``), skipping
    ``Py_FinalizeEx`` and ``atexit``, so buffered output is lost.  Flush
    everything, always.
    """
    sys.stderr.write("[tenmol-bridge] %s\n" % message)
    sys.stderr.flush()


class Session:
    """One WebSocket connection."""

    def __init__(self, ws: WebSocket, dispatcher: Dispatcher,
                 broker: FeedbackBroker) -> None:
        self.ws = ws
        self.dispatcher = dispatcher
        self.broker = broker
        self.subs = Subscriptions()
        self.outbox: "asyncio.Queue[Any]" = asyncio.Queue(maxsize=4096)
        self.loop = asyncio.get_running_loop()
        self._tasks: Set[asyncio.Task] = set()
        self._closed = False

    # -- outbound ----------------------------------------------------------

    def send_soon(self, frame: Any) -> None:
        """Queue a frame from ANY thread (the pump uses this for feedback)."""
        if self._closed:
            return
        try:
            self.loop.call_soon_threadsafe(self._enqueue, frame)
        except RuntimeError:
            pass  # loop is gone; connection is dead anyway

    def _enqueue(self, frame: Any) -> None:
        try:
            self.outbox.put_nowait(frame)
        except asyncio.QueueFull:
            log("outbox full, dropping frame for one client")

    async def send(self, frame: Any) -> None:
        await self.outbox.put(frame)

    async def send_geometry(self, meta: Dict[str, Any], payload: bytes) -> None:
        """Binary frame helper for WP-06."""
        await self.outbox.put(encode_binary_frame(meta, payload))

    async def _writer(self) -> None:
        while True:
            frame = await self.outbox.get()
            if frame is None:
                return
            if isinstance(frame, (bytes, bytearray)):
                await self.ws.send_bytes(bytes(frame))
            else:
                await self.ws.send_json(frame)

    # -- feedback fan-in ---------------------------------------------------

    def on_feedback(self, lines: Sequence[str]) -> None:
        # Called on the PUMP thread.  Must not block.
        if TOPIC_FEEDBACK in self.subs:
            self.send_soon(feedback_frame(lines))

    # -- inbound -----------------------------------------------------------

    def _spawn(self, coro) -> None:
        task = self.loop.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def handle(self, msg: Dict[str, Any]) -> None:
        if not isinstance(msg, dict):
            await self.send(err_frame(None, "BadMessage", "frame is not an object"))
            return
        msg_id = msg.get("id")
        kind = msg.get("t")
        try:
            if kind == T_CALL:
                fut = self.dispatcher.call(
                    msg.get("fn"), msg.get("args"), msg.get("kwargs")
                )
                self._spawn(self._reply(msg_id, fut))
            elif kind == T_DO:
                fut = self.dispatcher.do(msg.get("cmd"))
                self._spawn(self._reply(msg_id, fut))
            elif kind == T_INPUT:
                fut = self.dispatcher.input(msg)
                # Input is fire-and-forget; only surface failures.
                self._spawn(self._report_failure(fut, msg.get("kind")))
            elif kind == T_SUB:
                topic = self.subs.add(msg.get("topic"))
                await self.send(ok_frame(msg_id, {"topic": topic, "subscribed": True}))
                if topic == TOPIC_FEEDBACK:
                    # Replay what the engine said before this client existed
                    # (splash banner, startup script output). The drain is
                    # consume-once, so nobody else can hand it over.
                    backlog = self.broker.backlog()
                    if backlog:
                        await self.send(feedback_frame(backlog))
            elif kind == T_UNSUB:
                topic = self.subs.remove(msg.get("topic"))
                await self.send(ok_frame(msg_id, {"topic": topic, "subscribed": False}))
            else:
                raise BadMessage("unknown message type %r" % (kind,))
        except (DispatchError, UnknownTopic, KeyError, ValueError, TypeError) as exc:
            await self.send(
                err_frame(msg_id, **_err_kwargs(exc))
            )

    async def _reply(self, msg_id: Optional[int], fut) -> None:
        try:
            result = await asyncio.wrap_future(fut)
        except BaseException as exc:  # noqa: BLE001
            await self.send(err_frame(msg_id, **_err_kwargs(exc)))
            return
        await self.send(ok_frame(msg_id, result))

    async def _report_failure(self, fut, label: Any) -> None:
        try:
            await asyncio.wrap_future(fut)
        except BaseException as exc:  # noqa: BLE001
            log("input %r failed: %r" % (label, exc))

    async def close(self) -> None:
        self._closed = True
        for task in list(self._tasks):
            task.cancel()
        await self.outbox.put(None)


def _err_kwargs(exc: BaseException) -> Dict[str, str]:
    payload = error_payload(exc)
    return {
        "type_": payload["type"],
        "message": payload["message"],
        "traceback_": payload["traceback"],
    }


def create_app(config: Optional[BridgeConfig] = None) -> FastAPI:
    config = config or BridgeConfig()
    broker = FeedbackBroker()
    pump = PyMOLPump(
        tick_hz=config.tick_hz,
        tick_strategy=config.tick_strategy,
        width=config.width,
        height=config.height,
        quiet=config.quiet,
        pmgui=config.pmgui,
        broker=broker,
        log=log,
    )
    policy = Policy(allow_dangerous=config.allow_dangerous)
    dispatcher = Dispatcher(
        pump=pump,
        policy=policy,
        on_dangerous=lambda fn, why: log("DANGEROUS %s - %s" % (fn, why)),
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        try:
            pump.start()
        except Exception as exc:  # noqa: BLE001
            log("pump failed to start: %r" % (exc,))
        if pump.state == PumpState.DEGRADED:
            log(
                "RUNNING DEGRADED - PyMOL is unavailable (%s). RPC will answer "
                "with err/PyMOLUnavailable; the front-end is still developable."
                % pump.error
            )
        try:
            yield
        finally:
            pump.stop()

    app = FastAPI(title="tenmol-bridge", version="0.1.0", lifespan=lifespan)
    app.state.config = config
    app.state.pump = pump
    app.state.broker = broker
    app.state.dispatcher = dispatcher

    @app.get("/healthz")
    async def healthz() -> JSONResponse:
        return JSONResponse(pump.status())

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket) -> None:
        await ws.accept()
        session = Session(ws, dispatcher, broker)
        broker.add_listener(session.on_feedback)
        writer = asyncio.get_running_loop().create_task(session._writer())
        try:
            await session.send(hello_frame(pump.pymol_version))
            while True:
                message = await ws.receive()
                mtype = message.get("type")
                if mtype == "websocket.disconnect":
                    break
                if message.get("text") is not None:
                    try:
                        payload = json.loads(message["text"])
                    except ValueError as exc:
                        await session.send(
                            err_frame(None, "BadMessage", "invalid JSON: %s" % exc)
                        )
                        continue
                    await session.handle(payload)
                elif message.get("bytes") is not None:
                    # v1: client -> server binary frames are not defined.
                    await session.send(
                        err_frame(
                            None,
                            "BadMessage",
                            "binary frames are server->client only in protocol v1",
                        )
                    )
        except WebSocketDisconnect:
            pass
        finally:
            broker.remove_listener(session.on_feedback)
            await session.close()
            writer.cancel()

    return app
