"""WP-02 ACCEPTANCE — the process model, end to end, in ONE process.

Gate 0 -> 1 of the plan (§9).  In a single process this file:

* creates the offscreen GL context and boots the engine
  (session fixture in ``conftest.py``, through the real uvicorn app);
* **drags the mouse over the WebSocket and asserts ``get_view()[:9]``
  changed** — the assertion that proves blocker A1 is dead.  A bridge that
  does not call ``PyMOL_Draw`` every tick never drains ``OrthoDefer``
  (``packages/engine/layer1/Scene.cpp:4113-4155`` -> ``packages/engine/layer1/Ortho.cpp:268-277`` ->
  ``packages/engine/layer3/Executive.cpp:11521-11523``, gated on ``IdleAndReady == 3``) and the
  view would not move at all;
* asserts the feedback drain carries both the ``PyMOL>print(...)`` echo
  (C-origin, ``OrthoFeedbackIn``) and the printed value (Python-origin, via
  ``pcatch`` writing through ``SingletonPyMOLGlobals``);
* runs ``cmd.mpng`` — the ``ModalDraw`` path critique A2 called a hang — and
  asserts the engine still answers afterwards;
* asserts ``/healthz`` reports ``glutThread == threadIdent`` (critique A4);
* asserts **no bridge log line ever appears in the feedback**: after
  ``pcatch._install()``, ``sys.stdout`` and ``sys.stderr`` ARE the PyMOL console
  (plan §1.1's own transcript leaked three harness diagnostics into it).
"""

from __future__ import annotations

import os
import tempfile
import time

import pytest

from conftest import slow, slow_rate

from tenmol_bridge.config import log
from tenmol_bridge.engine import EngineState


# ---------------------------------------------------------------- boot state


def test_healthz_reports_glut_thread_equals_thread_ident(bridge):
    """Critique A4.  Without this, EVERY thread is "the GUI thread"."""
    health = bridge.healthz()
    assert health["state"] in (EngineState.RUNNING, EngineState.HEADLESS), health
    assert health["threadIdent"] is not None
    assert health["glutThread"] is not None
    assert health["glutThread"] == health["threadIdent"], health

    # ...and it is really PyMOL's module global, not just our own bookkeeping:
    # locking.is_gui_thread() reads pymol.glutThread
    # (packages/engine/modules/pymol/locking.py:80-86).
    import pymol

    assert pymol.glutThread == health["threadIdent"]
    from pymol import locking

    assert not locking.is_gui_thread(pymol.cmd), (
        "the test thread must NOT be considered the GUI thread; if it is, "
        "cmd.refresh/sync/do all take their run-inline branch on whatever "
        "thread calls them and command ordering is fiction"
    )


@pytest.mark.gl
def test_gl_context_is_real_hardware(gl_bridge):
    gl = gl_bridge.healthz()["gl"]
    assert gl["available"] is True
    assert gl["renderer"], gl
    # 8/8/8/8 matters: PickColorConverterSetRgbaBitsFromGL sizes the pick index
    # from these exact glGetIntegerv values (packages/engine/layer1/ScenePicking.cpp:38-84).
    assert gl["colorBits"] == [8, 8, 8, 8], gl
    assert gl["depthBits"] >= 24, gl
    assert gl["fbo"], gl


@pytest.mark.gl
def test_at_least_three_warmup_draws_before_input(gl_bridge):
    """IDLE_AND_READY == 3 (packages/engine/layer5/PyMOL.cpp:105)."""
    assert gl_bridge.pump.engine.draws >= 3


def test_viewport_equals_window(bridge, ws):
    """internal_gui/internal_feedback = 0, or every mouse coordinate is wrong.

    With the defaults on, reshape(640,480) yields get_viewport() == (420,462)
    (spike 04 §7.1 item 3).
    """
    health = bridge.healthz()
    viewport = ws.call("get_viewport")
    assert list(viewport) == [health["width"], health["height"]], viewport


# ----------------------------------------------------------------- the drag


@pytest.mark.gl
def test_mouse_drag_rotates_the_camera(gl_bridge, ws):
    """THE assertion.  Blocker A1: viewport input is enqueued, not executed.

    Mouse events map 1:1 to PyMOL_Button/PyMOL_Drag; coordinates are PyMOL
    window coordinates (bottom-left origin);
    P_GLUT_LEFT/MIDDLE/RIGHT = 0/1/2, DOWN/UP = 0/1
    (packages/engine/layer0/os_gl_glut_pretend.h:11-26).
    """
    ws.call("delete", "all")
    ws.call("fragment", "ala")
    ws.call("orient")

    before = ws.call("get_view")
    # MEASURED, and it contradicts the plan's §6/WP-09 note: the *Python* API
    # cmd.get_view() returns 18 floats, not 25 -- viewing.py:731 slices the
    # C accessor's 25 down to r[0:3]+r[4:7]+r[8:11]+r[16:25].  The 25-float
    # form is what _cmd.get_view() returns.  [0:9] is the rotation matrix in
    # both.  (Reported to the plan owner / WP-09.)
    assert len(before) == 18, before

    ws.input("button", button=0, state=0, x=400, y=300, mod=0)
    for step in range(1, 13):
        ws.input("drag", x=400 + step * 10, y=300, mod=0)
    ws.input("button", button=1, state=1, x=520, y=300, mod=0)

    # Let the pump draw; the deferred queue drains inside PyMOL_Draw.
    deadline = time.monotonic() + 5.0
    after = before
    while time.monotonic() < deadline:
        after = ws.call("get_view")
        if list(after[:9]) != list(before[:9]):
            break
        time.sleep(0.05)

    assert list(after[:9]) != list(before[:9]), (
        "the rotation matrix did not change: the drag was enqueued through "
        "OrthoDefer and never drained. before=%r after=%r"
        % (before[:9], after[:9])
    )


@pytest.mark.gl
def test_drag_only_moves_the_camera_not_the_object(gl_bridge, ws):
    """Sanity: the camera rotated, the coordinates did not."""
    ws.call("delete", "all")
    ws.call("fragment", "ala")
    coords_before = ws.call("get_atom_coords", "index 1")
    ws.input("button", button=0, state=0, x=300, y=300, mod=0)
    for step in range(1, 9):
        ws.input("drag", x=300 + step * 15, y=300 + step * 5, mod=0)
    ws.input("button", button=1, state=1, x=420, y=340, mod=0)
    time.sleep(0.3)
    coords_after = ws.call("get_atom_coords", "index 1")
    assert coords_before == coords_after


# -------------------------------------------------------------- the console


def test_feedback_carries_c_origin_and_python_origin_lines(bridge, ws):
    """spike 02 §2b: this only works with SingletonPyMOL + pcatch + pmgui=1."""
    marker = "tenmol-acceptance-%d" % int(time.time() * 1000)
    ws.subscribe("feedback")
    ws.do('print("%s")' % marker)

    lines = bridge.wait_for_feedback(marker, timeout=5.0)
    echo = 'PyMOL>print("%s")' % marker

    assert any(line == echo for line in lines), (
        "the C-origin PyMOL> echo is missing; OrthoFeedbackIn is gated on "
        "pmgui (packages/engine/layer1/Ortho.cpp:492-499) -- did something set no_gui=1? "
        "lines=%r" % lines[-10:]
    )
    assert any(line == marker for line in lines), (
        "the Python-origin print() is missing; pcatch writes through the "
        "file-scope SingletonPyMOLGlobals pointer (packages/engine/layer1/P.cpp:2667) and is "
        "silent with a non-singleton instance. lines=%r" % lines[-10:]
    )
    # ...and both reached the browser over the socket, in order.
    ws.pump_frames(0.5)
    assert echo in ws.feedback, ws.feedback[-10:]
    assert marker in ws.feedback, ws.feedback[-10:]
    assert ws.feedback.index(echo) < ws.feedback.index(marker)


def test_no_bridge_log_line_appears_in_the_feedback(bridge, ws):
    """Plan §1.1: the bridge logs to stderr ONLY.

    After ``pcatch._install()``, ``sys.stderr`` and ``sys.stdout`` are both the
    PyMOL line buffer, so a naive log call lands in the user's console.  This
    is the regression test for that.
    """
    marker = "BRIDGE-LOG-MUST-NOT-LEAK-%d" % int(time.time() * 1000)
    for _ in range(5):
        log(marker)
    # Force a round-trip so at least one status poll happens afterwards.
    ws.call("get_frame")
    time.sleep(0.4)

    lines = bridge.feedback_lines()
    assert not any(marker in line for line in lines), [
        line for line in lines if marker in line
    ]
    assert not any(line.startswith("[tenmol-bridge") for line in lines), [
        line for line in lines if line.startswith("[tenmol-bridge")
    ]


def test_feedback_drain_is_exclusive_to_the_bridge(ws):
    """Two consumers split the stream, so the API refuses the second one."""
    reply = ws.call_reply("_get_feedback")
    assert reply["t"] == "err"
    assert reply["error"]["kind"] == "NotAllowed"
    assert "exclusiv" in reply["error"]["message"]


# ------------------------------------------------------------------ ModalDraw


@pytest.mark.gl
def test_mpng_completes_and_the_engine_survives(gl_bridge, ws):
    """Critique A2.  ModalDraw only wedges an engine that never draws.

    ``I->ModalDraw`` is cleared inside ``PyMOL_Draw``
    (``packages/engine/layer5/PyMOL.cpp:2279-2286``); a pump that draws clears it on the next
    tick.
    """
    ws.call("delete", "all")
    ws.call("fragment", "ala")
    ws.call("mset", "1 x5")

    with tempfile.TemporaryDirectory(prefix="tenmol-mpng-") as tmpdir:
        prefix = os.path.join(tmpdir, "f")
        ws.call("mpng", prefix, timeout=120.0)

        deadline = time.monotonic() + 30.0
        produced = []
        while time.monotonic() < deadline:
            produced = sorted(
                name for name in os.listdir(tmpdir) if name.endswith(".png")
            )
            if len(produced) >= 5:
                break
            time.sleep(0.1)
        assert len(produced) >= 5, produced
        assert all(
            os.path.getsize(os.path.join(tmpdir, name)) > 0 for name in produced
        )

    # The engine is still alive and still answering.
    assert ws.call("count_atoms", "all") == 10
    assert ws.call("get_names") == ["ala"]

    # ...and it can still draw and still pick up new work.
    ws.call("mset")
    ws.call("delete", "all")


# --------------------------------------------------------------- invariants


def test_only_one_engine_thread_and_asyncio_never_touches_pymol(bridge):
    import threading

    names = sorted(
        thread.name for thread in threading.enumerate() if not thread.daemon or True
    )
    assert names.count("tenmol-engine") == 1, names
    assert names.count("tenmol-status") == 1, names


def test_status_thread_only_uses_lock_attempting_calls(bridge, ws):
    """spike 05 §6: a generic poller blocks for the full duration of a ray.

    get_progress/_get_feedback/get_setting_updates use ``lock_attempt``
    (``acquire(blocking=0)``), so they return in microseconds even while the
    engine thread holds the API lock.

    EVERYTHING ASSERTED HERE IS A DELTA OVER THE HOLD WINDOW, and that is not
    a style choice.  ``polls``, ``lock_misses`` and ``max_poll_ms`` are
    cumulative for the LIFE OF THE PROCESS and the whole suite shares one
    (``conftest.py``), so an absolute reading of any of them is a statement
    about the 69 test files that happen to sort before this one.

    ``max_poll_ms`` is the trap, because it is a HIGH-WATER MARK: nothing ever
    brings it back down, so ``assert poller.max_poll_ms < 250.0`` asked "did
    ANY poll since process start take a quarter of a second", and the answer on
    a shared runner is yes, for reasons that have nothing to do with the lock.
    The CI failure, from ``pytest-bridge.xml`` of run 30769055002::

        E  AssertionError: {'running': True, 'hz': 10.0, 'polls': 2782,
                            'lockMisses': 1370, ...}
        E  assert 497.73274999995465 < 250.0

    The mechanism, measured here rather than guessed: with one subscriber
    attached, a session whose high-water was **0.027 ms** after boot read
    **15.756 ms** the moment a single unrelated ``for i in range(120000):
    print(...)`` ran, because one poll drained 120k lines and fanned them all
    out.  A 580x jump bought entirely by a test that is not this one, on a box
    2.4x faster than the runner and with one client instead of the suite's
    churn — the runner's 497.7 ms is the same effect with the same cause, and
    it is not a defect: a poll that drains 120k lines is SUPPOSED to be slow.

    So the bound is NOT scaled and NOT deleted — it is RESET, below, in the gap
    between two polls, which turns exactly the same 250 ms into a statement
    about this test's own window.  Measured inside the window: 0.027–0.235 ms,
    i.e. the bound keeps a factor of a thousand.

    WHAT THAT COSTS: the old form also happened to watch the other 69 files.
    It was a bad watchman — a poll that drains and fans out 120k lines is
    *supposed* to be three orders of magnitude slower than an idle one, so the
    reading it produced was noise, and no test owns "every poll in the session"
    as a claim.  Scope lost, signal gained.

    The runner's ``polls: 2782, lockMisses: 1370`` is not a symptom either: a
    49% miss rate is the CORRECT reading of a box where the engine thread holds
    ``lock_api`` for a much larger share of the wall clock, and a miss costs a
    100 ms retry and loses nothing, because ``_get_feedback`` leaves the lines
    in ``I->Line[]`` when it declines to take the lock.  A miss is the whole
    point of ``lock_attempt``; zero misses during the hold would be the bug,
    and that is what the ``lock_misses`` assertion below says.
    """
    poller = bridge.pump.status_poller
    hold = 1.5
    interval = bridge.pump.config.status_interval

    #: ``time.monotonic()`` either side of the lock, filled on the ENGINE
    #: thread.  The window has to be delimited from in there: `elapsed` also
    #: covers the queue wait, and the engine thread is DRAWING for that part —
    #: on a software rasteriser a draw is long enough to be mistaken for the
    #: stall this test hunts for.
    window = {}

    def hold_the_api_lock(engine):
        # Exactly what every long C++ call does for its whole duration: hold
        # lock_api (packages/engine/modules/pymol/locking.py:26-30).  A generic poller thread
        # would block here for the full 1.5 s -- spike 05 §6 measured
        # cmd.get_names() blocked for 3,808.8 ms during a 4.3 s ray.
        engine.cmd.lock(engine.cmd)
        window["from"] = time.monotonic()
        try:
            time.sleep(hold)
        finally:
            window["to"] = time.monotonic()
            engine.cmd.unlock(-1, engine.cmd)
        return True

    # A sink runs at the END of every poll (``StatusPoller.poll_once``), so a
    # stamp taken here says "a poll just finished" — which is both the clock
    # this test reads and the fence it needs before touching ``max_poll_ms``.
    stamps = []

    def stamp(_lines, _progress, _updates):
        stamps.append(time.monotonic())

    poller.add_sink(stamp)
    try:
        # ESTABLISH THE PRECONDITION rather than assume it (the suite shares
        # one poller).  The reset has to land in the gap BETWEEN two polls: a
        # poll that was already draining another file's output when the reset
        # happened would record its own 260 ms afterwards and the window would
        # inherit exactly the number this test is trying to stop inheriting.
        # Waiting for a sink call puts us ~100 ms clear of the next poll.
        fence = len(stamps)
        quiet = time.monotonic() + slow(5.0)
        while len(stamps) == fence and time.monotonic() < quiet:
            time.sleep(0.005)
        polls_before = poller.polls
        misses_before = poller.lock_misses
        poller.max_poll_ms = 0.0
        started = time.monotonic()
        assert bridge.pump.call(hold_the_api_lock, timeout=30.0, label="hold-lock")
        elapsed = time.monotonic() - started
        windowed_max_poll_ms = poller.max_poll_ms
    finally:
        poller.remove_sink(stamp)

    polls_during = poller.polls - polls_before
    # Scaled: a loaded runner genuinely polls fewer times in the same
    # wall-clock window. A stalled thread still reports ~0 and fails.
    expected = max(1, int(slow_rate((elapsed - 0.3) * bridge.pump.config.status_hz)))
    assert polls_during >= expected, (
        "the status thread stalled while the API lock was held for %.2fs: "
        "%d polls, expected >= %d" % (elapsed, polls_during, expected)
    )
    # ...and it saw the lock as busy rather than as "no output": _get_feedback
    # returns None, not [], on a lock miss (packages/engine/modules/pymol/internal.py:596-606).
    assert poller.lock_misses > misses_before, poller.status()

    # The original 250 ms, now over this test's own window instead of the
    # session's.  A poll DURING the hold is the cheapest poll there is — all
    # three calls decline the lock and the sinks fan out nothing — so this is
    # the same claim with none of the cross-file noise.  NOT scaled: 0.235 ms
    # was the worst reading under a deliberately throttled QoS class with the
    # machine at load average 100, which is 1,000x of headroom; a factor of 3
    # on top of that would be decoration.
    assert windowed_max_poll_ms < 250.0, (
        "one poll took %.3f ms while the API lock was held for %.1f s — it "
        "waited for the lock instead of attempting it, or a sink blocked the "
        "poll thread. %r" % (windowed_max_poll_ms, hold, poller.status())
    )

    # ...and the same claim in the time domain, which catches a poll that never
    # RETURNED (max_poll_ms is only written when one finishes).  The rate above
    # is scaled 3x DOWN on CI, which leaves room for one long stall followed by
    # a catch-up burst; this is the half of the claim that scaling gave away,
    # and it is deliberately NOT scaled.  A poll that BLOCKED on lock_api is
    # stuck for whatever is left of the hold — at least 1.4 of the 1.5 s, since
    # the next poll starts within `interval` of the lock being taken — so half
    # the hold is the widest bound that still catches it.
    #
    # MEASURED, worst gap inside the window:
    #   idle                                              0.105 s
    #   48 spinning processes, load average 100           0.105 s  (unmoved:
    #     the engine thread is asleep for this window, so the poller contends
    #     with the OS and nothing else)
    #   the same, under `taskpolicy -c background`   0.20 - 0.30 s  (a ceiling,
    #     not a slope — 28, 48 and 64 spinners all land in that band, because
    #     it is the background QoS class's timer slack and not the load)
    # against a bound of 0.75 s, and 1.5 s when a poll really does block.
    # THE WINDOW EDGES COUNT AS STAMPS.  Without them the measurement has a
    # hole big enough to drive the defect through: a poller that runs normally
    # for 0.3 s and then blocks leaves stamps at 0.1/0.2/0.3 and nothing after,
    # its own stamp landing outside the window — three 0.1 s gaps and a clean
    # pass.  Bracketing by `from`/`to` turns that into a 1.2 s trailing silence,
    # and makes "no polls at all in the window" fall out as a 1.5 s gap instead
    # of needing a special case.
    # Snapshot: a poll that had already copied the sink list can still append
    # after `remove_sink` returns.
    taken = [
        moment for moment in list(stamps)
        if window["from"] <= moment <= window["to"]
    ]
    edges = [window["from"]] + taken + [window["to"]]
    gaps = [later - earlier for earlier, later in zip(edges, edges[1:])]
    stalled_for = max(gaps)
    assert stalled_for < hold / 2.0, (
        "the status thread went quiet for %.3f s while the API lock was held "
        "for %.1f s; the poll interval is %.3f s, so a gap this size means a "
        "poll blocked on lock_api instead of attempting it. gaps=%r, %r"
        % (stalled_for, hold, interval, [round(g, 3) for g in gaps],
           poller.status())
    )


def test_healthz_exposes_what_the_ui_needs(bridge):
    health = bridge.healthz()
    for key in (
        "state",
        "pymolVersion",
        "threadIdent",
        "glutThread",
        "ticks",
        "draws",
        "width",
        "height",
        "gl",
        "queueDepth",
        "status",
        "clients",
        "blobs",
        "shims",
    ):
        assert key in health, (key, sorted(health))
