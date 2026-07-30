"""The PyMOL thread.

Process model (this is the whole point of the file)
---------------------------------------------------
There is exactly **one** thread in this process that ever touches PyMOL: the
pump thread started by :class:`PyMOLPump`.  Every ``cmd.*`` call originating
from the WebSocket server is marshalled onto it through a FIFO queue and
awaited through a :class:`concurrent.futures.Future`.  FIFO in, FIFO out, one
executor => the client's command ordering is the engine's command ordering.

Why the queue is not optional (critique A4)
-------------------------------------------
``locking.is_gui_thread()`` is ``gui_ident is None or gui_ident == get_ident()``
(``modules/pymol/locking.py:80-86``) where ``gui_ident`` is the module global
``pymol.glutThread`` (``modules/pymol/__init__.py:543``, i.e. ``None``).  It is
only ever assigned by ``prime_pymol()`` / ``launch()``
(``modules/pymol/__init__.py:378-383``); ``pymol2.SingletonPyMOL.start()``
(``modules/pymol2/__init__.py:52-63``) never sets it.

So in a bridge that does nothing, ``is_gui_thread()`` is **True on every
thread**, and ``cmd.refresh()`` (``modules/pymol/viewing.py:1769-1772``),
``cmd.sync()`` (``modules/pymol/commanding.py:415-419``), ``cmd.do`` flushing
(``commanding.py:466``) and ``internal.py:547`` all take their "I am the GUI,
run it inline" branch on whatever uvicorn worker happens to call them.  The
ordering guarantee would be fiction.

:meth:`PyMOLPump._boot` therefore sets ``pymol.glutThread`` to this thread's
ident before the engine starts, and re-asserts it afterwards.  With that set,
those functions correctly marshal when called from a non-pump thread — and any
accidental direct call from the asyncio thread degrades to "queued", not to
"silently racing".
"""

from __future__ import annotations

import concurrent.futures
import os
import queue
import threading
import time
import traceback
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Optional

from .feedback import FeedbackBroker, FeedbackDrain

# --------------------------------------------------------------------------
# Errors
# --------------------------------------------------------------------------


class PyMOLUnavailable(RuntimeError):
    """PyMOL could not be imported or started; the bridge is degraded.

    The server stays up so the front-end remains developable: every RPC that
    needs the engine is answered with an ``err`` frame carrying this type.
    """


class PumpNotRunning(RuntimeError):
    pass


class PumpTimeout(TimeoutError):
    pass


# --------------------------------------------------------------------------
# Engine handle
# --------------------------------------------------------------------------


@dataclass
class Engine:
    """Everything the pump thread owns.  Never touch from another thread."""

    pymol: Any  # the ``pymol`` module
    p: Any  # ``pymol2.SingletonPyMOL`` instance
    cmd: Any  # ``pymol.cmd`` module (bound to ``p``)
    version: str = "unknown"
    glut_thread_ident: Optional[int] = None
    width: int = 640
    height: int = 480


# --------------------------------------------------------------------------
# THE per-tick draw/refresh call
# --------------------------------------------------------------------------
#
# ############################  READ THIS  ################################
# TODO(spike-01): ratify what this function must do.  Until spike 01 reports,
# the default is the conservative one and every alternative is one config word
# away (``--tick=<name>`` / ``BridgeConfig.tick_strategy``).  Nothing else in
# the bridge knows how the tick draws.
#
# The problem, from 02-completeness-critique.md A1: viewport input is not
# executed on arrival, it is *enqueued*.
#   CScene::click   -> SceneDeferClickWhen -> OrthoDefer  (layer1/Scene.cpp:4113-4126)
#   CScene::drag    -> OrthoDefer                          (layer1/Scene.cpp:4129-4137)
#   CScene::release -> OrthoDefer                          (layer1/Scene.cpp:4145-4155)
#   deferred cmd.png / deferred ray                        (layer1/Ortho.cpp:3141-3169,
#                                                           layer1/SceneRay.cpp:754-769)
# The queue is drained by OrthoExecDeferred (layer1/Ortho.cpp:268-277) whose
# ONLY caller in the tree is ExecutiveDrawNow (layer3/Executive.cpp:11514-11523).
# ExecutiveDrawNow is also the only routine caller of SceneUpdate(G,false)
# (Executive.cpp:11531-11534), i.e. what runs Rep::update() and builds the
# geometry WP-06 serialises.
#
# MEASURED HERE (darwin/arm64, PyMOL 3.2.0a0, spike 00's venv), scene = one
# 'ala' fragment, reshape(640,480,1), left-button press + 11 drags + release:
#
#   pmgui=1 (no_gui=0, the default)
#     tick=idle           -> get_view UNCHANGED   (as predicted by A1)
#     tick=refresh        -> get_view UNCHANGED   (survived, did not crash)
#     tick=refresh_always -> get_view UNCHANGED   (461 ticks, no crash)
#     p.draw()            -> SIGSEGV (spike 00 §6.1: glGetBooleanv <-
#                            PyMOL_DrawWithoutLock; kills the process outright)
#   pmgui=0 (no_gui=1)
#     tick=draw           -> get_view CHANGED, rotation applied, NO crash
#                            ...and cmd._get_feedback() returned [] - 0 lines.
#
# Reaching ExecutiveDrawNow is necessary but NOT sufficient, which is why
# 'refresh' does nothing: OrthoExecDeferred is additionally gated on
# PyMOL_GetIdleAndReady (Executive.cpp:11521), which is `IdleAndReady == 3`
# (layer5/PyMOL.cpp:2560-2562, IDLE_AND_READY at :105).  IdleAndReady only
# increments inside PyMOL_Idle *while DrawnFlag is set* (:2413-2415), and
# DrawnFlag is only ever set inside PyMOL_Draw (:2325 GUI branch, :2328
# non-GUI branch).  A process that never calls draw() therefore never becomes
# "idle and ready" and its deferred queue is never drained, no matter how many
# times cmd.refresh() runs.
#
# And the reason draw() is safe with pmgui=0 is the same code: at :2302 the GL
# prologue (PushValidContext + setup_gl_state + glGetString) is inside
# `if (G->HaveGUI)`, and HaveGUI == Option->pmgui (layer5/PyMOL.cpp:2248).
#
# So the real trade-off is not "draw vs never draw", it is pmgui:
#   pmgui=1 -> console feedback works (OrthoFeedbackIn, layer1/Ortho.cpp:493),
#              viewport input dead, draw() fatal.
#   pmgui=0 -> viewport input works, draw() safe, console feedback SILENT.
# Neither is a complete product.  Spike 01 (+ spike 02 for the feedback half)
# must pick one and pay for the other side - e.g. pmgui=0 plus a stdout/stderr
# tee, or a one-line change to OrthoFeedbackIn's gate.
# #########################################################################

TickStrategy = Callable[[Engine], bool]

TICK_STRATEGIES: Dict[str, TickStrategy] = {}


def register_tick_strategy(name: str) -> Callable[[TickStrategy], TickStrategy]:
    def _wrap(fn: TickStrategy) -> TickStrategy:
        TICK_STRATEGIES[name] = fn
        return fn

    return _wrap


@register_tick_strategy("idle")
def _tick_idle(engine: Engine) -> bool:
    """SAFE / DEFAULT. Advance the engine's own idle work only.

    Known consequence: OrthoExecDeferred never runs, so viewport click/drag,
    deferred png and deferred ray stay queued forever (critique A1).  Fine for
    RPC-only development, NOT fine for the viewport.
    """
    did_work = bool(engine.p.idle())
    redisplay = bool(engine.p.getRedisplay())
    return did_work or redisplay


@register_tick_strategy("refresh")
def _tick_refresh(engine: Engine) -> bool:
    """CANDIDATE (spike 01). idle, then cmd.refresh() when redisplay is pending.

    ``cmd.refresh()`` reaches ExecutiveDrawNow, which is what drains the
    deferred queue.  Survived headless in a smoke test; unproven in general.
    """
    did_work = bool(engine.p.idle())
    if engine.p.getRedisplay():
        engine.cmd.refresh()
        return True
    return did_work


@register_tick_strategy("refresh_always")
def _tick_refresh_always(engine: Engine) -> bool:
    """CANDIDATE (spike 01). Unconditional ExecutiveDrawNow every tick."""
    engine.p.idle()
    engine.p.getRedisplay()
    engine.cmd.refresh()
    return True


@register_tick_strategy("draw")
def _tick_draw(engine: Engine) -> bool:
    """CANDIDATE (spike 01). The only strategy in which viewport input works.

    REQUIRES ``pmgui=0`` (``--no-pmgui``).  With ``pmgui=1`` this segfaults the
    process (spike 00 §6.1); :meth:`PyMOLPump._boot` refuses that combination
    rather than letting a single tick kill the user's session.

    Cost: ``OrthoFeedbackIn`` drops every console line (layer1/Ortho.cpp:493),
    so the web console needs another source.  See spike 02 / feedback.py.
    """
    engine.p.idle()
    engine.p.getRedisplay()
    engine.p.draw()
    return True


@register_tick_strategy("draw_unsafe")
def _tick_draw_unsafe(engine: Engine) -> bool:
    """Same as ``draw`` but with the pmgui guard bypassed.

    Only for the spike, and only once a real current GL context exists (see
    00-parity-inventory.md:519 on backend-authoritative picking).  Otherwise
    this is a guaranteed SIGSEGV.
    """
    engine.p.idle()
    engine.p.getRedisplay()
    engine.p.draw()
    return True


DEFAULT_TICK_STRATEGY = "idle"

#: strategies that call ``p.draw()`` and therefore need ``pmgui == 0``
DRAW_STRATEGIES = frozenset({"draw"})


def tick_draw(engine: Engine, strategy: TickStrategy) -> bool:
    """The one per-tick draw/refresh call in the whole bridge.

    Every caller goes through here so that spike 01's answer lands in exactly
    one place.  See the banner comment above.
    """
    return strategy(engine)


# --------------------------------------------------------------------------
# Task marshalling
# --------------------------------------------------------------------------


@dataclass
class _Task:
    fn: Callable[[Engine], Any]
    future: "concurrent.futures.Future[Any]"
    label: str = ""
    requires_pymol: bool = True
    enqueued_at: float = field(default_factory=time.monotonic)


class PumpState:
    STOPPED = "stopped"
    STARTING = "starting"
    RUNNING = "running"
    DEGRADED = "degraded"


class PyMOLPump:
    """Owns the PyMOL thread, the task queue and the feedback drain."""

    def __init__(
        self,
        *,
        tick_hz: float = 60.0,
        tick_strategy: str = DEFAULT_TICK_STRATEGY,
        width: int = 640,
        height: int = 480,
        quiet: bool = False,
        pmgui: bool = True,
        max_tasks_per_tick: int = 64,
        broker: Optional[FeedbackBroker] = None,
        log: Callable[[str], None] = lambda msg: None,
    ) -> None:
        if tick_strategy not in TICK_STRATEGIES:
            raise ValueError(
                "unknown tick strategy %r; known: %s"
                % (tick_strategy, ", ".join(sorted(TICK_STRATEGIES)))
            )
        self.tick_interval = 1.0 / float(tick_hz) if tick_hz > 0 else 0.0
        self.tick_strategy_name = tick_strategy
        self._strategy = TICK_STRATEGIES[tick_strategy]
        if tick_strategy in DRAW_STRATEGIES and pmgui:
            raise ValueError(
                "tick strategy %r calls p.draw(), which segfaults while "
                "pmgui=1 (layer5/PyMOL.cpp:2302-2325, spike 00 §6.1). "
                "Pass --no-pmgui, or use --tick draw_unsafe if you have a real "
                "current GL context." % tick_strategy
            )
        self.width = width
        self.height = height
        self.quiet = quiet
        self.pmgui = pmgui
        self.max_tasks_per_tick = max_tasks_per_tick
        self.broker = broker if broker is not None else FeedbackBroker()
        self._log = log

        self._queue: "queue.SimpleQueue[Optional[_Task]]" = queue.SimpleQueue()
        self._thread: Optional[threading.Thread] = None
        self._ready = threading.Event()
        self._stopping = threading.Event()

        self.state: str = PumpState.STOPPED
        self.error: Optional[str] = None
        self.error_traceback: str = ""
        self.engine: Optional[Engine] = None
        self.ticks = 0
        self.tasks_run = 0

    # -- lifecycle ---------------------------------------------------------

    def start(self, timeout: float = 60.0) -> None:
        if self._thread is not None:
            raise RuntimeError("pump already started")
        self.state = PumpState.STARTING
        self._thread = threading.Thread(
            target=self._run, name="pymol-pump", daemon=True
        )
        self._thread.start()
        if not self._ready.wait(timeout):
            raise PumpTimeout("pump did not become ready in %.1fs" % timeout)

    def stop(self, timeout: float = 10.0) -> None:
        if self._thread is None:
            return
        self._stopping.set()
        self._queue.put(None)  # wake the loop
        self._thread.join(timeout)
        self._thread = None
        self.state = PumpState.STOPPED

    @property
    def running(self) -> bool:
        return self.state == PumpState.RUNNING

    @property
    def pymol_version(self) -> str:
        return self.engine.version if self.engine else "unavailable"

    def status(self) -> Dict[str, Any]:
        return {
            "state": self.state,
            "error": self.error,
            "pymolVersion": self.pymol_version,
            "tickStrategy": self.tick_strategy_name,
            "pmgui": self.pmgui,
            "tickHz": (1.0 / self.tick_interval) if self.tick_interval else 0.0,
            "ticks": self.ticks,
            "tasksRun": self.tasks_run,
            "glutThread": self.engine.glut_thread_ident if self.engine else None,
            "threadIdent": self._thread.ident if self._thread else None,
        }

    # -- marshalling -------------------------------------------------------

    def submit(
        self,
        fn: Callable[[Engine], Any],
        *,
        label: str = "",
        requires_pymol: bool = True,
    ) -> "concurrent.futures.Future[Any]":
        """Queue ``fn`` for execution on the PyMOL thread. Never blocks."""
        future: "concurrent.futures.Future[Any]" = concurrent.futures.Future()
        if self._thread is None or self._stopping.is_set():
            future.set_exception(PumpNotRunning("pump is not running"))
            return future
        if requires_pymol and self.state == PumpState.DEGRADED:
            future.set_exception(self._unavailable())
            return future
        self._queue.put(_Task(fn, future, label=label,
                             requires_pymol=requires_pymol))
        return future

    def call_sync(
        self,
        fn: Callable[[Engine], Any],
        *,
        label: str = "",
        timeout: Optional[float] = 30.0,
    ) -> Any:
        return self.submit(fn, label=label).result(timeout)

    def _unavailable(self) -> PyMOLUnavailable:
        return PyMOLUnavailable(
            "PyMOL is not available in this bridge process: %s"
            % (self.error or "unknown reason")
        )

    # -- the thread --------------------------------------------------------

    def _run(self) -> None:
        try:
            self.engine = self._boot()
            self.state = PumpState.RUNNING
            self._log(
                "pump ready: pymol %s, tick=%s, pmgui=%d, glutThread=%s"
                % (
                    self.engine.version,
                    self.tick_strategy_name,
                    1 if self.pmgui else 0,
                    self.engine.glut_thread_ident,
                )
            )
            if self.tick_strategy_name not in DRAW_STRATEGIES | {"draw_unsafe"}:
                self._log(
                    "NOTE tick=%s never sets DrawnFlag, so PyMOL never becomes "
                    "idle-and-ready and OrthoExecDeferred never runs: viewport "
                    "click/drag stay queued (critique A1, spike 01)"
                    % self.tick_strategy_name
                )
            if not self.pmgui:
                self._log(
                    "NOTE pmgui=0: OrthoFeedbackIn drops every console line "
                    "(layer1/Ortho.cpp:493) - the feedback topic will be empty "
                    "(spike 02)"
                )
        except BaseException as exc:  # noqa: BLE001 - degrade, do not die
            self.state = PumpState.DEGRADED
            self.error = "%s: %s" % (type(exc).__name__, exc)
            self.error_traceback = traceback.format_exc()
            self._log("pump DEGRADED - %s" % self.error)
        finally:
            self._ready.set()

        while not self._stopping.is_set():
            self._drain_tasks()
            if self.state == PumpState.RUNNING and self.engine is not None:
                try:
                    tick_draw(self.engine, self._strategy)
                except Exception as exc:  # noqa: BLE001
                    self._log("tick error: %r" % (exc,))
                try:
                    self.broker.poll_sources()
                except Exception as exc:  # noqa: BLE001
                    self._log("feedback error: %r" % (exc,))
            self.ticks += 1
            self._sleep_until_next_tick()

        self._shutdown()

    def _sleep_until_next_tick(self) -> None:
        """Block on the queue so a task wakes us immediately; else tick."""
        if self.tick_interval <= 0:
            return
        try:
            task = self._queue.get(timeout=self.tick_interval)
        except queue.Empty:
            return
        if task is None:
            return
        self._execute(task)

    def _drain_tasks(self) -> None:
        for _ in range(self.max_tasks_per_tick):
            try:
                task = self._queue.get_nowait()
            except queue.Empty:
                return
            if task is None:
                return
            self._execute(task)

    def _execute(self, task: _Task) -> None:
        if not task.future.set_running_or_notify_cancel():
            return
        if task.requires_pymol and self.state != PumpState.RUNNING:
            task.future.set_exception(self._unavailable())
            return
        try:
            task.future.set_result(task.fn(self.engine))
        except BaseException as exc:  # noqa: BLE001
            task.future.set_exception(exc)
        finally:
            self.tasks_run += 1

    # -- boot / shutdown ---------------------------------------------------

    def _boot(self) -> Engine:
        if os.environ.get("TENMOL_BRIDGE_FORCE_NO_PYMOL"):
            # Test hook: exercise the degraded path on a machine where PyMOL
            # imports fine.  Documented in bridge/README.md.
            raise PyMOLUnavailable(
                "TENMOL_BRIDGE_FORCE_NO_PYMOL is set (degraded mode forced)"
            )

        import pymol  # noqa: PLC0415 - deliberately lazy

        # --- critique A4: claim the GUI-thread identity BEFORE starting -----
        ident = threading.get_ident()
        pymol.glutThread = ident

        options = pymol.invocation.options
        options.show_splash = 0
        if self.quiet:
            options.quiet = 1
        # pmgui is the whole trade-off (see the tick_draw banner above):
        #   no_gui=0 -> pmgui=1 -> HaveGUI=1 -> console feedback queued
        #               (layer1/Ortho.cpp:493-497, layer1/P.cpp:1820,
        #                layer5/PyMOL.cpp:2248), draw() fatal, input dead.
        #   no_gui=1 -> pmgui=0 -> draw() safe, viewport input works,
        #               console feedback silently dropped.
        options.no_gui = 0 if self.pmgui else 1

        import pymol2  # noqa: PLC0415

        p = pymol2.SingletonPyMOL()
        p.start()

        # start() must not have clobbered our identity claim
        pymol.glutThread = ident

        cmd = p.cmd
        try:
            version = str(cmd.get_version()[0])
        except Exception:  # noqa: BLE001
            version = "unknown"

        p.reshape(self.width, self.height, 1)

        engine = Engine(
            pymol=pymol,
            p=p,
            cmd=cmd,
            version=version,
            glut_thread_ident=pymol.glutThread,
            width=self.width,
            height=self.height,
        )
        self.broker.clear_sources()
        self.broker.add_source(FeedbackDrain(cmd))
        return engine

    def _shutdown(self) -> None:
        # Fail anything still queued so no caller waits forever.
        while True:
            try:
                task = self._queue.get_nowait()
            except queue.Empty:
                break
            if task is None:
                continue
            if not task.future.done():
                task.future.set_exception(PumpNotRunning("pump stopped"))
        engine = self.engine
        self.engine = None
        if engine is not None:
            try:
                engine.p.stop()
            except Exception as exc:  # noqa: BLE001
                self._log("engine stop failed: %r" % (exc,))

    # -- input (viewport) --------------------------------------------------
    #
    # These only ENQUEUE work inside the engine (Scene.cpp:4113-4155); whether
    # it ever executes depends on tick_draw above.

    def button(self, button: int, state: int, x: int, y: int, mod: int):
        return self.submit(
            lambda e: e.p.button(button, state, x, y, mod), label="button"
        )

    def drag(self, x: int, y: int, mod: int):
        return self.submit(lambda e: e.p.drag(x, y, mod), label="drag")

    def reshape(self, width: int, height: int, force: bool = False):
        def _do(e: Engine) -> None:
            e.p.reshape(int(width), int(height), 1 if force else 0)
            e.width, e.height = int(width), int(height)

        return self.submit(_do, label="reshape")
