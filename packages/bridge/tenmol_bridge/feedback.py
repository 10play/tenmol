"""PyMOL feedback: one drain, many subscribers.

Why this file exists at all
---------------------------
``cmd._get_feedback()`` (``packages/engine/modules/pymol/internal.py:580-606`) is a
**consume-once** drain: it loops ``_cmd.get_feedback(_COb)`` until the C queue
returns falsy and hands the caller the only copy of those lines.  Two consumers
means each of them sees a random half of the console.  Therefore exactly one
component in this process may ever call it: the pump thread
(:mod:`tenmol_bridge.pump`), which owns a :class:`FeedbackDrain` and fans the
lines out through a :class:`FeedbackBroker` to every WebSocket session.

It also returns ``None`` (not ``[]``) when ``lock_attempt`` fails
(``internal.py:596-606``) — that is "busy, try next tick", not "no output".

TODO(spike-02): does a headless bridge get ANY feedback?
-------------------------------------------------------
``OrthoFeedbackIn`` is gated on ``G->Option->pmgui`` (``packages/engine/layer1/Ortho.cpp:493-497``)
and ``pmgui = !no_gui`` (``packages/engine/layer1/P.cpp:1820``).  ``architecture.md:38-49``
and ``docs/spikes/feedback.md`` records the measurement behind this: the web
console could be permanently blank.

Measured on this machine (darwin/arm64, PyMOL 3.2.0a0 from
``docs/spikes/build.md``'s venv), with ``pymol2.SingletonPyMOL``
and default options (``pymol.invocation.options.no_gui == 0`` => ``pmgui == 1``):
``cmd._get_feedback()`` returned 22 lines including the splash banner and the
``PyMOL>print('hello from do')`` command echo.  So feedback DOES flow in the
configuration this pump uses.

What is NOT settled, and is spike 02's job:
  1. what happens under ``--no-gui`` / ``pmgui == 0`` (expected: silence);
  2. that Python-level ``print()`` from ``cmd.do`` goes to the process stdout,
     NOT into the Ortho queue (observed: "hello from do" was on stdout only) —
     so the web console needs a stdout/stderr tee as well, or it will miss every
     ``print`` from scripts, wizards and ``util.*``;
  3. whether ``colorprinting`` escape codes need stripping before display.

Item 2 is why :class:`FeedbackBroker` takes *sources*, plural.  Adding a stdout
tee later must not require touching the pump or the server.
"""

from __future__ import annotations

import threading
from collections import deque
from typing import Callable, Deque, List, Optional, Protocol, Sequence

FeedbackListener = Callable[[Sequence[str]], None]


class FeedbackSource(Protocol):
    """Anything that can yield console lines when polled from the pump thread."""

    name: str

    def poll(self) -> Optional[List[str]]:
        """Return newly produced lines, ``[]`` if none, ``None`` if busy."""


class FeedbackDrain:
    """The one and only consumer of ``cmd._get_feedback()``.

    Constructed with the ``pymol.cmd`` module (or a ``pymol2.PyMOL().cmd``
    instance).  ``poll()`` must only ever be called from the pump thread.
    """

    name = "ortho"

    def __init__(self, cmd) -> None:
        self._cmd = cmd
        self.busy_polls = 0
        self.total_lines = 0
        #: set when the installed PyMOL has no ``_get_feedback`` at all
        self.unavailable_reason: Optional[str] = None
        if not hasattr(cmd, "_get_feedback"):
            self.unavailable_reason = (
                "cmd._get_feedback is missing from this PyMOL build "
                "(expected packages/engine/modules/pymol/internal.py:580)"
            )

    def poll(self) -> Optional[List[str]]:
        if self.unavailable_reason is not None:
            return []
        lines = self._cmd._get_feedback()
        if lines is None:
            # lock_attempt failed - the engine is busy, not silent.
            self.busy_polls += 1
            return None
        if lines:
            self.total_lines += len(lines)
        return list(lines)


class FeedbackBroker:
    """Fan-out for console lines.

    ``poll_sources()`` runs on the pump thread; ``add_listener`` /
    ``remove_listener`` are called from the asyncio thread when sessions come
    and go, so the listener list is mutex-protected and copied before dispatch.

    Listeners must not block: the WebSocket sessions push onto an asyncio queue
    via ``loop.call_soon_threadsafe`` and return immediately.
    """

    def __init__(self, backlog_size: int = 500) -> None:
        self._lock = threading.Lock()
        self._listeners: List[FeedbackListener] = []
        self._sources: List[FeedbackSource] = []
        # The engine talks before any browser connects (the splash banner is
        # already in the queue when the pump finishes booting) and the drain is
        # consume-once, so those lines are gone unless we keep them. A late
        # subscriber gets this replayed - see server.Session sub handling.
        self._backlog: Deque[str] = deque(maxlen=backlog_size)
        self.dropped_listener_errors = 0

    def backlog(self) -> List[str]:
        with self._lock:
            return list(self._backlog)

    # -- sources (pump thread owns these) ---------------------------------
    def add_source(self, source: FeedbackSource) -> None:
        with self._lock:
            self._sources.append(source)

    def clear_sources(self) -> None:
        with self._lock:
            self._sources = []

    # -- listeners (asyncio thread) ---------------------------------------
    def add_listener(self, listener: FeedbackListener) -> None:
        with self._lock:
            self._listeners.append(listener)

    def remove_listener(self, listener: FeedbackListener) -> None:
        with self._lock:
            try:
                self._listeners.remove(listener)
            except ValueError:
                pass

    @property
    def listener_count(self) -> int:
        with self._lock:
            return len(self._listeners)

    # -- pump thread -------------------------------------------------------
    def poll_sources(self) -> List[str]:
        """Drain every source once and publish.  Pump thread only."""
        with self._lock:
            sources = list(self._sources)
        collected: List[str] = []
        for source in sources:
            try:
                lines = source.poll()
            except Exception as exc:  # never let a bad source kill the pump
                collected.append(
                    "[tenmol-bridge] feedback source %r failed: %s"
                    % (getattr(source, "name", source), exc)
                )
                continue
            if lines:
                collected.extend(lines)
        if collected:
            self.publish(collected)
        return collected

    def publish(self, lines: Sequence[str]) -> None:
        if not lines:
            return
        with self._lock:
            self._backlog.extend(lines)
            listeners = list(self._listeners)
        for listener in listeners:
            try:
                listener(lines)
            except Exception:
                # A dead session must never take down the pump thread.
                self.dropped_listener_errors += 1
