"""The engine thread, the FIFO, the 60 Hz draw pump, and the 10 Hz status thread.

Process model (plan §1.1) — exactly two threads may touch PyMOL:

========  ==================================================  ======
thread    may call                                            rate
========  ==================================================  ======
engine    everything: ``cmd.*``, ``p.draw``, ``p.idle``,       60 Hz
          ``p.button``, ``p.drag``, GL
status    **only** ``cmd.get_progress()``,                     10 Hz
          ``cmd._get_feedback()``,
          ``cmd.get_setting_updates()``
asyncio   nothing. Ever.                                       —
========  ==================================================  ======

Why the status thread is restricted to those three and not a generic poller:
they are the only *lock-attempting* calls in the API
(``modules/pymol/monitoring.py:5-7`` ``lock_api_status``;
``modules/pymol/internal.py:596-606`` and ``modules/pymol/setting.py:440-447``
use ``lock_attempt`` = ``acquire(blocking=0)``, ``modules/pymol/locking.py:29-30``).
Spike 05 §6 measured them returning in 0.0-0.1 ms *during* a 4.3 s ``cmd.ray()``
while ``cmd.get_names()`` from the same probe **blocked for 3,808.8 ms**.  A
generic poller thread stalls for the full duration of every long C++ call, and
``cmd.get_progress()`` is the only liveness signal the UI has while PyMOL is
busy.

The status thread is also the process's **exclusive** consumer of the
destructive drains (plan §1.2).  ``cmd._get_feedback()`` pops from an uncapped
``std::queue<std::string>`` (``layer1/Ortho.cpp:492-499``; 20,000 undrained
lines = +2.98 MB RSS), returns ``None`` — not ``[]`` — on a lock miss, and two
interleaved consumers split the lines at random.  Nothing else in this process
may call it.  WP-03 layers classification, fan-out and the state tick on top of
:class:`StatusPoller` via :meth:`StatusPoller.add_sink`; it does not open a
second drain.
"""

from __future__ import annotations

import concurrent.futures
import queue
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Callable, Deque, Dict, List, Optional, Sequence

from .config import BridgeConfig, log
from .engine import Engine, EngineState
from .errors import EngineNotRunning, EngineTimeout, PyMOLUnavailable

__all__ = ["Pump", "StatusPoller", "Task", "EngineState"]

#: A task body.  Receives the live :class:`~tenmol_bridge.engine.Engine`; runs
#: on the engine thread; whatever it returns resolves the future.
TaskBody = Callable[[Engine], Any]


@dataclass(order=False)
class Task:
    body: TaskBody
    future: "concurrent.futures.Future[Any]"
    #: Draw immediately after this task instead of waiting for the next tick.
    #: Mouse input sets this: ``CScene::click``/``drag``/``release`` only
    #: *enqueue* through ``OrthoDefer`` (``layer1/Scene.cpp:4113-4155``) and
    #: the queue is drained by ``OrthoExecDeferred`` from ``ExecutiveDrawNow``
    #: (``layer1/Ortho.cpp:268-277``, ``layer3/Executive.cpp:11521-11523``).
    tick_after: bool = False
    label: str = ""
    submitted_at: float = field(default_factory=time.monotonic)


class Pump:
    """Owns the engine thread.  The only way to reach PyMOL from anywhere else."""

    def __init__(
        self,
        config: Optional[BridgeConfig] = None,
        engine: Optional[Engine] = None,
    ) -> None:
        self.config = config or BridgeConfig()
        self.engine = engine or Engine(self.config)
        self.status_poller = StatusPoller(self.engine, self.config)

        self._queue: "queue.Queue[Optional[Task]]" = queue.Queue()
        self._thread: Optional[threading.Thread] = None
        self._booted = threading.Event()
        self._stop = threading.Event()
        self._tick_hooks: List[Callable[[Engine], None]] = []
        self._pre_tick_hooks: List[Callable[[Engine], None]] = []
        self._hook_lock = threading.Lock()
        self._boot_error: Optional[BaseException] = None
        self._tick_overruns = 0
        self._max_batch = 256

    # ---------------------------------------------------------- lifecycle

    def start(self, timeout: float = 60.0) -> "Pump":
        if self._thread is not None:
            return self
        self._thread = threading.Thread(
            target=self._run, name="tenmol-engine", daemon=True
        )
        self._thread.start()
        if not self._booted.wait(timeout):
            raise EngineTimeout("engine did not boot within %.1fs" % timeout)
        if self._boot_error is not None:
            raise self._boot_error
        if self.engine.state in (EngineState.RUNNING, EngineState.HEADLESS):
            self.status_poller.start()
        return self

    def stop(self, timeout: float = 10.0) -> None:
        if self._thread is None:
            return
        self.status_poller.stop()
        self._stop.set()
        self._queue.put(None)
        self._thread.join(timeout)
        if self._thread.is_alive():
            log("engine thread did not stop within %.1fs" % timeout)
        self._thread = None

    def __enter__(self) -> "Pump":
        return self.start()

    def __exit__(self, *exc_info: Any) -> None:
        self.stop()

    # ------------------------------------------------------------- submit

    def submit(
        self,
        body: TaskBody,
        tick_after: bool = False,
        label: str = "",
    ) -> "concurrent.futures.Future[Any]":
        """Queue ``body`` for the engine thread.  FIFO in, FIFO out.

        Ordering is the client's ordering: one queue, one executor.
        """
        future: "concurrent.futures.Future[Any]" = concurrent.futures.Future()
        if self._thread is None or self._stop.is_set():
            future.set_exception(EngineNotRunning("the engine pump is not running"))
            return future
        self._queue.put(Task(body, future, tick_after=tick_after, label=label))
        return future

    def call(
        self,
        body: TaskBody,
        timeout: Optional[float] = 30.0,
        tick_after: bool = False,
        label: str = "",
    ) -> Any:
        """Blocking :meth:`submit`.  Never call this from the engine thread."""
        if threading.get_ident() == self.engine.thread_ident:
            raise RuntimeError("Pump.call() from the engine thread would deadlock")
        future = self.submit(body, tick_after=tick_after, label=label)
        try:
            return future.result(timeout)
        except concurrent.futures.TimeoutError as exc:
            raise EngineTimeout("engine call %r timed out" % (label or body,)) from exc

    def pump_for(self, seconds: float) -> None:
        """Block the caller while the engine keeps ticking.

        Useful to honour the 150 ms single-click floor
        (``I->SingleClickDelay = 0.15``, ``layer1/SceneMouse.cpp:1152``,
        consumed at ``layer1/Scene.cpp:2441``) and in tests.  The engine thread
        is not blocked — this is a plain sleep on the caller plus a final
        round-trip so the caller knows the ticks happened.
        """
        time.sleep(max(0.0, seconds))
        self.call(lambda engine: engine.ticks, label="pump_for-sync")

    # -------------------------------------------------------------- hooks

    def add_tick_hook(self, hook: Callable[[Engine], None]) -> None:
        """Run ``hook(engine)`` on the engine thread after every draw.

        WP-04 (Mode P readback/encode) and WP-03 (the 30 Hz state snapshot)
        attach here.  A hook that raises is logged and removed — a broken
        feature must not take the pump down.
        """
        with self._hook_lock:
            self._tick_hooks.append(hook)

    def remove_tick_hook(self, hook: Callable[[Engine], None]) -> None:
        with self._hook_lock:
            if hook in self._tick_hooks:
                self._tick_hooks.remove(hook)

    def add_pre_tick_hook(self, hook: Callable[[Engine], None]) -> None:
        """Run ``hook(engine)`` on the engine thread BEFORE ``engine.tick()``.

        Measured reason this exists, from the WP-04 report: ``PyMOL_Draw`` sets
        ``I->RedisplayFlag = false`` at ``layer5/PyMOL.cpp:2331`` *before*
        ``ExecutiveDrawNow``, so a post-draw hook reading ``getRedisplay()``
        sees False for every change the draw just rendered.  Mode P's dirty
        gate has to probe here or the viewport never updates.
        """
        with self._hook_lock:
            self._pre_tick_hooks.append(hook)

    def remove_pre_tick_hook(self, hook: Callable[[Engine], None]) -> None:
        with self._hook_lock:
            if hook in self._pre_tick_hooks:
                self._pre_tick_hooks.remove(hook)

    # ------------------------------------------------------------- status

    @property
    def state(self) -> str:
        return self.engine.state

    @property
    def pymol_version(self) -> str:
        return self.engine.pymol_version

    def status(self) -> Dict[str, Any]:
        out = self.engine.status()
        out.update(
            {
                "queueDepth": self._queue.qsize(),
                "tickHz": self.config.tick_hz,
                "tickOverruns": self._tick_overruns,
                "status": self.status_poller.status(),
            }
        )
        return out

    # ------------------------------------------------------------ the loop

    def _run(self) -> None:
        try:
            self.engine.boot()
        except BaseException as exc:  # noqa: BLE001
            self._boot_error = exc
            log("engine boot failed: %r" % (exc,))
            self._booted.set()
            return
        self._booted.set()

        interval = self.config.tick_interval
        # ABSOLUTE deadlines, not "sleep(interval)" per iteration.  Measured on
        # this machine: queue.get(timeout=1/60), time.sleep(1/60) and
        # Event.wait(1/60) all return after ~22 ms, not 16.7 -- macOS timer
        # coalescing adds a fixed ~5.5 ms.  A relative loop therefore tops out
        # at ~45 Hz; advancing the deadline absolutely keeps the *rate* at 60 Hz
        # with a constant phase lag, because a wait that overshoots leaves less
        # time before the next deadline.
        deadline = time.monotonic()
        while not self._stop.is_set():
            deadline += interval
            # Drain the FIFO until the tick deadline, waking immediately on a
            # new submission.  Long tasks (ray, load) simply overrun the tick;
            # the status thread is what keeps the UI alive meanwhile.
            drained = 0
            while drained < self._max_batch:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                try:
                    task = self._queue.get(timeout=remaining)
                except queue.Empty:
                    break
                if task is None:
                    self._stop.set()
                    break
                drained += 1
                self._execute(task)
                if task.tick_after:
                    break
            if self._stop.is_set():
                break
            self._run_hooks(pre=True)
            try:
                self.engine.tick()
            except BaseException as exc:  # noqa: BLE001
                log("tick raised %r - stopping the pump" % (exc,))
                break
            self._run_hooks()
            now = time.monotonic()
            if now > deadline + interval:
                # A long call (ray, load, a big surface) blew through several
                # ticks.  Resync rather than firing a burst of catch-up draws.
                self._tick_overruns += 1
                deadline = now

        try:
            self._fail_pending(EngineNotRunning("bridge is shutting down"))
            self.engine.shutdown()
        except BaseException as exc:  # noqa: BLE001
            log("engine shutdown raised %r" % (exc,))

    def _execute(self, task: Task) -> None:
        if not task.future.set_running_or_notify_cancel():
            return
        try:
            result = task.body(self.engine)
        except BaseException as exc:  # noqa: BLE001
            task.future.set_exception(exc)
            return
        task.future.set_result(result)

    def _run_hooks(self, pre: bool = False) -> None:
        with self._hook_lock:
            hooks = list(self._pre_tick_hooks if pre else self._tick_hooks)
        for hook in hooks:
            try:
                hook(self.engine)
            except BaseException as exc:  # noqa: BLE001
                log("tick hook %r raised %r - removing it" % (hook, exc))
                if pre:
                    self.remove_pre_tick_hook(hook)
                else:
                    self.remove_tick_hook(hook)

    def _fail_pending(self, exc: BaseException) -> None:
        while True:
            try:
                task = self._queue.get_nowait()
            except queue.Empty:
                return
            if task is None:
                continue
            if not task.future.done():
                task.future.set_exception(exc)


class StatusPoller:
    """The 10 Hz thread.  Calls ONLY the three lock-attempting functions.

    It owns the process's single feedback drain and its own capped ring buffer
    (PyMOL keeps no readable scrollback: ``I->Line[]`` is a 256-entry ring at
    ``layer1/Ortho.cpp:62`` with no Python route).  ``sinks`` receive
    ``(lines, progress, setting_updates)`` on the status thread.
    """

    def __init__(
        self,
        engine: Engine,
        config: Optional[BridgeConfig] = None,
        ring_size: int = 20000,
    ) -> None:
        self.engine = engine
        self.config = config or BridgeConfig()
        self._ring: Deque[str] = deque(maxlen=ring_size)
        self._settings: Deque[Any] = deque(maxlen=4096)
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._sinks: List[Callable[[Sequence[str], float, Sequence[Any]], None]] = []
        self.progress = -1.0
        self.polls = 0
        self.lock_misses = 0
        self.max_poll_ms = 0.0
        self.total_lines = 0

    # -- lifecycle ---------------------------------------------------------

    def start(self) -> "StatusPoller":
        if self._thread is not None:
            return self
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._loop, name="tenmol-status", daemon=True
        )
        self._thread.start()
        return self

    def stop(self, timeout: float = 3.0) -> None:
        if self._thread is None:
            return
        self._stop.set()
        self._thread.join(timeout)
        self._thread = None

    def add_sink(
        self, sink: Callable[[Sequence[str], float, Sequence[Any]], None]
    ) -> None:
        with self._lock:
            self._sinks.append(sink)

    def remove_sink(
        self, sink: Callable[[Sequence[str], float, Sequence[Any]], None]
    ) -> None:
        with self._lock:
            if sink in self._sinks:
                self._sinks.remove(sink)

    # -- the ring buffer ---------------------------------------------------

    def lines(self, limit: Optional[int] = None) -> List[str]:
        """A copy of the console scrollback the bridge has captured."""
        with self._lock:
            data = list(self._ring)
        return data if limit is None else data[-limit:]

    def clear(self) -> None:
        with self._lock:
            self._ring.clear()
            self._settings.clear()

    def setting_updates(self) -> List[Any]:
        with self._lock:
            return list(self._settings)

    def status(self) -> Dict[str, Any]:
        return {
            "running": self._thread is not None,
            "hz": self.config.status_hz,
            "polls": self.polls,
            "lockMisses": self.lock_misses,
            "maxPollMs": round(self.max_poll_ms, 3),
            "lines": self.total_lines,
            "progress": self.progress,
        }

    # -- the poll ----------------------------------------------------------

    def poll_once(self) -> int:
        """One status poll.  Safe to call from the status thread only."""
        cmd = self.engine.cmd
        if cmd is None:
            return 0
        t0 = time.perf_counter()
        lines: List[str] = []

        # 1. cmd._get_feedback() - DESTRUCTIVE, exclusive to this poller.
        #    None means "API lock busy, retry", NOT "no output"
        #    (modules/pymol/internal.py:596-606).  Treating None as empty
        #    silently drops console lines.
        try:
            drained = cmd._get_feedback()
        except Exception:  # noqa: BLE001 - never let the poller die
            drained = None
        if drained is None:
            self.lock_misses += 1
        elif drained:
            lines = list(drained)

        # 2. cmd.get_progress() - the ONLY liveness signal while PyMOL is busy;
        #    returns -1.0 when idle (modules/pymol/monitoring.py:5-7).
        try:
            progress = float(cmd.get_progress())
        except Exception:  # noqa: BLE001
            progress = -1.0
        self.progress = progress

        # 3. cmd.get_setting_updates() - DESTRUCTIVE.  [] on a lock miss is
        #    indistinguishable from "nothing changed"
        #    (modules/pymol/setting.py:440-447), so never build quiescence
        #    detection on it.
        try:
            updates = cmd.get_setting_updates() or []
        except Exception:  # noqa: BLE001
            updates = []

        with self._lock:
            if lines:
                self._ring.extend(lines)
                self.total_lines += len(lines)
            if updates:
                self._settings.extend(updates)
            sinks = list(self._sinks)

        for sink in sinks:
            try:
                sink(lines, progress, updates)
            except Exception as exc:  # noqa: BLE001
                log("status sink %r raised %r" % (sink, exc))

        self.polls += 1
        self.max_poll_ms = max(self.max_poll_ms, (time.perf_counter() - t0) * 1000.0)
        return len(lines)

    def _loop(self) -> None:
        interval = self.config.status_interval
        while not self._stop.is_set():
            try:
                self.poll_once()
            except Exception as exc:  # noqa: BLE001
                log("status poll raised %r" % (exc,))
            self._stop.wait(interval)


def require_engine(engine: Engine) -> Any:
    """Raise :class:`PyMOLUnavailable` unless the engine has a live ``cmd``."""
    if engine.cmd is None:
        raise PyMOLUnavailable(
            "PyMOL is not available in this bridge process: %r" % (engine.error,)
        )
    return engine.cmd
