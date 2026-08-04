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
  rejects non-loopback peers (``packages/engine/modules/pymol/pymolhttpd.py:61-68``).
"""

from __future__ import annotations

import asyncio
import json
import time
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional, Sequence, Set

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
    TOPIC_DIALOG,
    TOPIC_FEEDBACK,
    TOPIC_PROGRESS,
    TOPIC_SETTINGS,
    ClientSession,
    err_frame,
    err_frame_from_exception,
    feedback_frame,
    hello_frame,
    ok_frame,
    plugin_dialog_payload,
    progress_payload,
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
            bridge_routes=self.bridge_route,
        )
        self.sessions: List[ClientSession] = []
        self.shutdown_requested = False
        self._started = False

        # -- settings push (rows 208/209) ---------------------------------
        #: Indices the status thread drained and the engine has not enriched
        #: yet.  A SET, because the engine may be inside a long call while
        #: several 10 Hz polls go by and the client only needs each index once.
        self._settings_pending: Set[int] = set()
        self._settings_full = False
        self._settings_inflight = False
        self._settings_pushes = 0

        # -- blocked plugin dialogs (row 295) -----------------------------
        #: ``panels.files.DialogBroker``, cached on the ENGINE thread so the
        #: status thread never touches PyMOL to reach it.
        self._dialog_broker: Any = None
        self._dialog_seen: Dict[int, Dict[str, Any]] = {}
        self._dialog_probe_ticks = 0

        # -- client liveness (row 77) -------------------------------------
        self._clients_ever = 0
        #: ``time.monotonic()`` of the moment the LAST client went away, or
        #: None while at least one is connected.
        self._empty_since: Optional[float] = None
        #: Seconds with no connected client after which the bridge decides the
        #: browser is gone and requests shutdown.  ``0`` disables it; see
        #: :meth:`_check_client_liveness` for why the default is off.
        self.idle_shutdown_seconds: float = _idle_shutdown_default()
        self.shutdown_reason: Optional[str] = None

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
                "deferred draw queue are unavailable; Mode G, cmd.ray and the "
                "whole RPC surface are NOT."
            )
        else:
            # The shims need a live pump and a live PyMOL.
            self.pump.call(lambda _engine: self.shims.install(), label="shims")
        self.pump.status_poller.add_sink(self._on_status)
        if self.pump.state in (EngineState.RUNNING, EngineState.HEADLESS):
            # Engine-thread side of the `dialog` push: find the broker once,
            # so the status thread never reaches into `pymol.cmd` to do it.
            self.pump.add_tick_hook(self._probe_dialog_broker)
        if self.pump.state in (EngineState.RUNNING, EngineState.HEADLESS):
            # HEADLESS attaches MODE G ONLY. Mode P is glReadPixels on an FBO
            # and genuinely needs a context; the geometry accessor and the
            # version counters are CPU walks and do not. Gating both on GL was
            # the reason a `--no-gl` bridge served an EMPTY viewport, which is
            # the exact configuration the cross-platform bet depends on.
            try:
                self.render.attach(pixels=self.pump.state == EngineState.RUNNING)
            except Exception as exc:  # noqa: BLE001 - the server stays up
                log("render service failed to attach: %r" % (exc,))
        else:
            log("render service NOT attached (engine is %s)" % (self.pump.state,))

    def stop(self) -> None:
        if not self._started:
            return
        self.pump.status_poller.remove_sink(self._on_status)
        self.pump.remove_tick_hook(self._probe_dialog_broker)
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

    def request_shutdown(self, reason: str = "cmd.quit") -> None:
        """``cmd.quit`` routed here (plan §A6), and the idle watchdog."""
        if self.shutdown_requested:
            return
        self.shutdown_requested = True
        self.shutdown_reason = reason
        log("shutdown requested (%s)" % reason)

    # -- fan-out (called on the STATUS thread) -----------------------------

    def _on_status(
        self, lines: Sequence[str], progress: float, updates: Sequence[Any]
    ) -> None:
        """The 10 Hz sink.  STATUS THREAD — it must not touch PyMOL.

        Everything reached from here is either a pure-Python object (the
        sessions, the cached :class:`DialogBroker`) or a hand-off to the engine
        thread through :meth:`Pump.submit`.  ``updates`` is what
        ``cmd.get_setting_updates()`` already returned to the poller: this is a
        FAN-OUT of a drain that happened, never a second drain (plan §1.2,
        enforced by ``tools/parity/drain_lint.py``).
        """
        self._check_client_liveness()
        if not self.sessions:
            # Nothing to fan out to, and nothing to remember: a client that
            # connects later bootstraps the whole catalogue and every value
            # (`features/settings/service.ts`), so a backlog kept for it would
            # be both useless and unbounded — this runs at 10 Hz for the life
            # of the process.
            self._settings_pending.clear()
            self._settings_full = False
            return
        if updates:
            self._note_settings(updates)
        payload = progress_payload(progress)
        for session in list(self.sessions):
            if lines and TOPIC_FEEDBACK in session.subs:
                session.send_soon(feedback_frame(lines))
            if TOPIC_PROGRESS in session.subs:
                session.emit_soon(TOPIC_PROGRESS, payload)
        self._flush_settings()
        self._flush_dialogs()

    # -- settings change push (rows 208 / 209) -----------------------------

    #: A drain this large is a session load or a `reinitialize`, not an edit
    #: (measured: the first drain after boot is 780 indices).  Enriching 780
    #: settings and shipping them to every client is the wrong answer to
    #: "everything changed" — `full` tells the client to refetch instead.
    #: Same constant, same reason, as `panels.settings.SettingTap.FULL_RESYNC_AT`.
    SETTINGS_FULL_RESYNC_AT = 600

    def _note_settings(self, updates: Sequence[Any]) -> None:
        """STATUS THREAD.  Remember what changed; enrich later, elsewhere."""
        for index in updates:
            if isinstance(index, (int, float)) and not isinstance(index, bool):
                self._settings_pending.add(int(index))
        if len(self._settings_pending) >= self.SETTINGS_FULL_RESYNC_AT:
            self._settings_full = True

    def _flush_settings(self) -> None:
        """STATUS THREAD -> ENGINE THREAD -> subscribers.

        WHY THE HOP.  ``SettingsPayload`` (``topics/settings.ts``) is enriched:
        name, kind, value, text.  Reading a value is ``cmd.get_setting_tuple``,
        which takes ``lock_api`` — the one thing the status thread may never
        do, because it would block for the whole of a ``cmd.ray()`` and take
        the progress feed down with it.  So the status thread only *collects*
        indices and the engine thread renders them.

        ONE TASK IN FLIGHT AT A TIME.  A long engine call (ray, load) means
        several 10 Hz polls go by; submitting per poll would queue a burst of
        enrichments behind it that all describe the same settings.  The pending
        set unions instead, so the burst collapses into one payload.
        """
        if self._settings_inflight or not self._settings_pending:
            return
        if not any(TOPIC_SETTINGS in s.subs for s in list(self.sessions)):
            # Nobody is listening. Drop the backlog rather than growing it for
            # ever: a client that subscribes later bootstraps the whole
            # catalogue anyway (`features/settings/service.ts`).
            self._settings_pending.clear()
            self._settings_full = False
            return
        indices = sorted(self._settings_pending)
        full = self._settings_full or len(indices) >= self.SETTINGS_FULL_RESYNC_AT
        self._settings_pending.clear()
        self._settings_full = False
        self._settings_inflight = True

        def body(engine: Any) -> None:
            try:
                payload = _enrich_settings(engine, indices, full)
            finally:
                self._settings_inflight = False
            self._emit_topic(TOPIC_SETTINGS, payload)
            self._settings_pushes += 1

        future = self.pump.submit(body, label="settings:changed")
        if future.done() and future.exception() is not None:
            self._settings_inflight = False

    # -- blocked plugin dialogs (row 295) ----------------------------------

    def _probe_dialog_broker(self, engine: Any) -> None:
        """ENGINE THREAD, from the pump's tick hook.  Cache the broker.

        ``cmd.tenmol_files`` only exists once ``panels.files.install()`` has
        run, which the client does on bootstrap, so this keeps looking until it
        appears and then stops.  Once per second, not once per tick: it is an
        attribute read, but it is an attribute read *on PyMOL's cmd module*,
        and the point of caching it is that the status thread must never do
        that itself.
        """
        if self._dialog_broker is not None:
            return
        self._dialog_probe_ticks += 1
        if self._dialog_probe_ticks % 60:
            return
        panel = getattr(getattr(engine, "cmd", None), "tenmol_files", None)
        broker = getattr(panel, "broker", None)
        if broker is not None and hasattr(broker, "pending"):
            self._dialog_broker = broker
            log("dialog broker attached to the `dialog` topic")

    def _flush_dialogs(self) -> None:
        """STATUS THREAD.  Push openings and closings on the ``dialog`` topic.

        ``DialogBroker.pending()`` is a plain dict read under the broker's own
        ``threading.Condition``; it takes no PyMOL lock and calls nothing in
        PyMOL, which is what makes it legal here.  The broker object itself was
        resolved on the engine thread (:meth:`_probe_dialog_broker`).

        This is a 10 Hz sweep rather than a callback because ``DialogBroker``
        has no notification hook and lives in ``panels/files.py``.  Measured
        cost: one dict comprehension over 0-1 entries, 10 times a second.  The
        latency it replaces is the client's 700 ms ``dialog_pending`` poll.
        """
        broker = self._dialog_broker
        if broker is None:
            return
        try:
            pending = broker.pending()
        except Exception as exc:  # noqa: BLE001 - never kill the status sink
            log("dialog broker pending() raised %r" % (exc,))
            self._dialog_broker = None
            return
        current = {int(req["dialogId"]): req for req in pending}
        if not current and not self._dialog_seen:
            return
        for dialog_id, request in current.items():
            if dialog_id not in self._dialog_seen:
                self._emit_topic(TOPIC_DIALOG, plugin_dialog_payload(request, "opened"))
        for dialog_id, request in list(self._dialog_seen.items()):
            if dialog_id not in current:
                self._emit_topic(TOPIC_DIALOG, plugin_dialog_payload(request, "closed"))
        self._dialog_seen = current

    # -- client liveness (row 77) ------------------------------------------

    def _check_client_liveness(self) -> None:
        """STATUS THREAD.  Notice that the browser is gone.

        ``execapp``'s shutdown is ``closeEvent -> cmd.quit()``: closing the
        window IS the quit.  A browser tab has no equivalent — it can be closed,
        crash, or have its machine suspended, and in none of those cases does
        anything call ``cmd.quit``.  Before this, ``shutdown_requested`` was set
        by exactly one thing (the routed ``cmd.quit``), so a closed tab left the
        engine ticking at 60 Hz for ever.

        TWO LAYERS, and only the second one is new.  A tab that is *closed*
        sends a WebSocket close (or its TCP FIN does), the endpoint's ``finally``
        removes the session, and this sees ``len(self.sessions) == 0``
        immediately.  A machine that is *suspended* sends nothing at all; there
        the WebSocket keep-alive ping is what eventually closes the socket
        (uvicorn's ``ws_ping_interval`` / ``ws_ping_timeout``, 20 s each by
        default), and this then sees the same thing.  Either way the observable
        is "no sessions", and the question is only how long to wait.

        DEFAULT OFF, deliberately.  ``pnpm dev`` restarts the browser side
        constantly and a bridge that quit during a page reload would be
        unusable; and the tests share one engine across a whole run with long
        client-free stretches.  It arms only after a client has connected at
        least once, and the timeout comes from ``TENMOL_BRIDGE_IDLE_SHUTDOWN``
        (or from the launcher setting :attr:`idle_shutdown_seconds`).
        """
        if self.sessions:
            self._empty_since = None
            return
        if self._clients_ever == 0 or self.shutdown_requested:
            return
        now = time.monotonic()
        if self._empty_since is None:
            self._empty_since = now
            return
        limit = self.idle_shutdown_seconds
        if limit > 0 and (now - self._empty_since) >= limit:
            self.request_shutdown(
                "no client for %.1fs (idle_shutdown_seconds=%.1f); the browser "
                "is gone and a closed tab cannot call cmd.quit"
                % (now - self._empty_since, limit)
            )

    def client_liveness(self) -> Dict[str, Any]:
        """What ``/healthz`` reports about the heartbeat."""
        empty_since = self._empty_since
        return {
            "clients": len(self.sessions),
            "clientsEver": self._clients_ever,
            "idleSeconds": (
                None if empty_since is None else round(time.monotonic() - empty_since, 3)
            ),
            "idleShutdownSeconds": self.idle_shutdown_seconds,
            "armed": self._clients_ever > 0,
        }

    def _emit_topic(self, topic: str, payload: Dict[str, Any]) -> None:
        """RenderService -> subscribed clients.  Called on the ENGINE thread.

        This is the BROADCAST path and it stays a broadcast: ``objects``,
        ``view``, ``frame``, ``feedback``, ``progress`` and the Mode-G
        *invalidation* notice are shared state — every client that subscribed
        genuinely needs to hear about them.  What must NOT come through here is
        the answer to one client's request; see :meth:`_geometry_route`.
        """
        for session in list(self.sessions):
            if topic in session.subs:
                session.emit_soon(topic, payload)

    # -- _bridge.* routing (D4: address the answer to the caller) ----------

    #: ``_bridge.*`` symbols whose answer is a bulk binary frame belonging to
    #: exactly one client.  ``sources.ts:40`` calls the second one positionally.
    UNICAST_ROUTES = ("_bridge.get_geometry", "_bridge.pull_geometry")

    #: The dialog rendezvous ``packages/protocol/src/topics/dialog.ts:37``
    #: declares: "The client's answer, sent as
    #: ``{t:'call', fn:'_bridge.answer_dialog'}``".  It had no route at all,
    #: which is why ``panels/files.py`` inverted the protocol and made the
    #: client POLL ``cmd.tenmol_files.dialog_pending`` instead.
    DIALOG_ROUTES = ("_bridge.answer_dialog", "_bridge.pending_dialogs")

    def bridge_route(
        self,
        symbol: str,
        args: Any = None,
        kwargs: Any = None,
        session: Optional[ClientSession] = None,
    ) -> Any:
        """The dispatcher's ``_bridge.*`` table, with the caller threaded in.

        Everything except the geometry pull is genuinely process-wide state
        (stream parameters, the render-mode policy, stats) and goes straight to
        :meth:`RenderService.route`.  The geometry pull is the one route whose
        result is a payload *for the caller*, so this file — which owns the
        session objects — resolves it instead.
        """
        if symbol in self.UNICAST_ROUTES:
            return self._geometry_route(args, kwargs, session)
        if symbol in self.DIALOG_ROUTES:
            return self._dialog_route(symbol, args, kwargs)
        return self.render.route(symbol, args, kwargs)

    def _dialog_route(self, symbol: str, args: Any, kwargs: Any) -> Any:
        """``_bridge.answer_dialog({dialogId, value})`` -> the blocked thread.

        Answered on THIS thread, not on the engine thread, and that is the
        whole point.  ``DialogBroker.answer`` only takes the broker's own
        ``Condition`` and wakes a *plugin worker* thread; routing it through
        the pump would put the answer behind whatever the engine is doing, and
        the case that matters most — a plugin dialog raised while a long call
        is running — is exactly the case where the pump is busy.

        ``value`` follows ``DialogAnswer`` (``topics/dialog.ts:38-42``): a
        path, a list of paths, or ``null`` for cancelled.
        """
        argv = list(args or ())
        params = dict(kwargs or {})
        if argv and isinstance(argv[0], dict):
            params = {**argv[0], **params}
            argv = argv[1:]
        for name, value in zip(("dialogId", "value"), argv):
            params.setdefault(name, value)
        broker = self._dialog_broker
        if broker is None:
            raise BadMessage(
                "no plugin dialog broker in this process yet; it appears once "
                "`cmd.tenmol_files` exists (panels/files.install())"
            )
        if symbol == "_bridge.pending_dialogs":
            return broker.pending()
        if "dialogId" not in params:
            raise BadMessage("answer_dialog needs `dialogId`")
        answered = broker.answer(int(params["dialogId"]), params.get("value"))
        # Do not wait for the next 10 Hz sweep to tell the other clients the
        # picker is gone: two browsers on one bridge would both keep it open.
        self._flush_dialogs()
        return answered

    def _geometry_route(
        self,
        args: Any = None,
        kwargs: Any = None,
        session: Optional[ClientSession] = None,
    ) -> Any:
        """``_bridge.pull_geometry(object, rep, state)`` -> ONE client (D4).

        ``RenderService._geometry_call`` sends ``result.frame`` to every
        ``geometry`` subscriber, because the render service is not told who
        asked.  Measured cost of that on a 1tii cartoon: every extra connected
        client received the same 360 KB frame it had not requested and could not
        use, and the browser decoded it before discarding it.

        The fix is not to stop registering geometry clients — the tick scan and
        the ``invalidated`` notice still need that set — it is to answer the
        *request* on the requester's own socket.  The metadata still comes back
        in the ordinary ``ok`` frame, so a caller that only wants the status
        (``unchanged`` / ``not-built`` / ``unsupported``) needs no binary frame
        at all.
        """
        argv = list(args or ())
        params = dict(kwargs or {})
        for name, value in zip(("object", "rep", "state"), argv):
            params.setdefault(name, value)
        object_name = params.get("object") or ""
        rep = params.get("rep")
        if not object_name or rep is None:
            raise BadMessage("pull_geometry needs `object` and `rep`")
        state = int(params.get("state", -1))
        update = bool(params.get("update", True))
        have = params.get("have")
        # A client cannot name another client: `session` is the connection the
        # frame arrived on, and any `session` key in the client's kwargs is
        # ignored (the dispatcher passes the real one separately).
        target = session

        def body(engine: Any) -> Dict[str, Any]:
            result = self.render.geometry.fetch(
                engine, object_name, rep, state=state, update=update, have=have
            )
            if result.frame:
                self._deliver_geometry(target, result.frame)
            return result.to_json()

        return self.pump.submit(body, label="render:pull_geometry")

    def _deliver_geometry(self, target: Optional[ClientSession], frame: Any) -> None:
        """Engine thread -> one socket.  ``send_soon`` is thread-safe."""
        if target is None:
            # No caller identity (an internal or replayed call). Fall back to
            # the old fan-out rather than dropping the payload on the floor,
            # and say so, because it is the thing D4 exists to prevent.
            log("geometry frame has no requesting session; broadcasting")
            for session in list(self.sessions):
                if TOPIC_GEOMETRY in session.subs:
                    session.send_soon(frame)
            return
        if target.closed:
            return
        target.send_soon(frame)

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


def _idle_shutdown_default() -> float:
    """``TENMOL_BRIDGE_IDLE_SHUTDOWN`` in seconds; 0 (off) when unset/invalid."""
    import os

    raw = os.environ.get("TENMOL_BRIDGE_IDLE_SHUTDOWN", "")
    try:
        return max(0.0, float(raw))
    except ValueError:
        return 0.0


def _enrich_settings(
    engine: Any, indices: Sequence[int], full: bool
) -> Dict[str, Any]:
    """ENGINE THREAD.  Indices -> ``SettingsPayload`` (``topics/settings.ts``).

    ``changed`` is keyed by the index rendered as a decimal string, because
    JSON object keys are strings — the type says so and this is the mirror.

    ``panels.settings.values`` is reused rather than re-implemented: it already
    knows that ``cmd.get_setting_tuple`` gives the typed value and ``cmd.get``
    the *text* rendering (``on``/``off``, ``%1.5f``, a colour's NAME), and that
    a float3 comes back as three floats.  Importing it here is an import, not
    an edit: the module is a leaf and the frozen ``panels/__init__.py`` barrel
    is not involved in ``from .panels.settings import ...``.

    A full resync ships NO values at all.  798 enriched rows is ~60 KB per
    session load per client, to say something the client answers by refetching
    the catalogue anyway.
    """
    payload: Dict[str, Any] = {
        "changed": {},
        "full": bool(full),
        "indices": list(indices),
    }
    if full or not indices:
        return payload
    try:
        from .panels.settings import KIND_BY_TYPE, values as read_values
        from pymol import setting as pymol_setting
    except Exception as exc:  # noqa: BLE001 - degraded engine, or no PyMOL
        payload["error"] = repr(exc)
        return payload

    # `name_dict` is the inverse of `index_dict` and is built once at import
    # (`packages/engine/modules/pymol/setting.py:42`), so this is a dict lookup per index.
    names: Dict[int, str] = {}
    try:
        name_dict = pymol_setting.name_dict
        names = {int(i): str(name_dict.get(int(i), "")) for i in indices}
    except Exception:  # noqa: BLE001
        pass

    try:
        read = read_values(indices, cmd=engine.cmd)
    except Exception as exc:  # noqa: BLE001
        payload["error"] = repr(exc)
        return payload

    types: Dict[int, int] = {}
    try:
        for index in indices:
            got = engine.cmd.get_setting_tuple(index)
            if got:
                types[int(index)] = int(got[0])
    except Exception:  # noqa: BLE001
        pass

    changed: Dict[str, Any] = {}
    for row in read.get("values", ()):  # [index, value, text]
        index = int(row[0])
        entry: Dict[str, Any] = {
            "index": index,
            "name": names.get(index, ""),
            "kind": KIND_BY_TYPE.get(types.get(index, -1), "blank"),
            "value": row[1],
            "text": row[2] if len(row) > 2 else "",
        }
        changed[str(index)] = entry
    payload["changed"] = changed
    payload["failed"] = list(read.get("failed", ()))
    return payload


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
        # Per-session counters, so "did client B pay for client A's geometry
        # pull?" is answerable from the server rather than inferred from a
        # client's own bookkeeping (D4).
        status["sessions"] = [session.stats() for session in list(server.sessions)]
        status["blobs"] = server.blobs.stats()
        status["shims"] = server.shims.info()
        status["shutdownRequested"] = server.shutdown_requested
        status["shutdownReason"] = server.shutdown_reason
        status["liveness"] = server.client_liveness()
        status["push"] = {
            "settingsPushes": server._settings_pushes,  # noqa: SLF001 - same module
            "settingsPending": len(server._settings_pending),  # noqa: SLF001
            "dialogBroker": server._dialog_broker is not None,  # noqa: SLF001
            "dialogsOpen": len(server._dialog_seen),  # noqa: SLF001
        }
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
        server._clients_ever += 1  # noqa: SLF001 - same module; arms the watchdog
        server._empty_since = None  # noqa: SLF001
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
                msg.get("fn"), msg.get("args"), msg.get("kwargs"), session=session
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
