"""Parity area 2, rows 112-113 — the busy/progress indicator, the splash, and
the rubber-band marquee rectangle.

Both rows describe things PyMOL draws in its OWN ortho layer:

  * ``OrthoBusyDraw`` (``packages/engine/layer1/Ortho.cpp:609-724``) — a 240x60 black box in the
    top-left with a message line and up to TWO bars (the slow and the fast
    counter), gated by ``show_progress`` and throttled.
  * ``OrthoDrawLoop`` (``packages/engine/layer1/Ortho.cpp:1695-1745``) — the 1 px rubber band
    from ``I->LoopRect``, pushed there by ``OrthoSetLoopRect`` from
    ``SceneMouse.cpp:44-92``.
  * ``I->SplashFlag`` (``:2718-2731``) — forces the whole scrollback visible
    until the first click or Esc.

None of the three is drawn for a web client (there is no GL front buffer to
draw into and no ortho CGO on the wire), so what matters is what the BACKEND
still exposes.  This file measures that.  The React side of the same two rows
is pinned by ``apps/web/src/features/console/orthoOverlays.test.ts`` and
``.../orthoOverlays.dom.test.tsx``.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_wf_ortho.py -q
"""

from __future__ import annotations

import os
import sys
import time
from typing import Any, Dict, List, Tuple

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

DATA = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
    "packages", "engine", "test",
    "dat",
)
IL2 = os.path.join(DATA, "il2.pdb")

#: Big enough that the ray outlives several 10 Hz status polls on this machine
#: (measured: 0.66-0.72 s for 2084 spheres at this size on an M4 Max, 16
#: threads).  It is the image size, not the molecule, that buys the time.
RAY_W, RAY_H = 6000, 4400


# --------------------------------------------------------------------------
# fixtures
# --------------------------------------------------------------------------


@pytest.fixture()
def rayable(ws: WSClient):
    """A scene that can be ray-traced, with every global it touches restored.

    THE WHOLE SUITE SHARES ONE PYMOL.  ``cmd.ray`` is unusually invasive: it
    stops a running movie, stops rocking and turns ``sculpting`` OFF
    (``packages/engine/modules/pymol/viewing.py:1733-1738``), and it renders whatever the
    camera is looking at.  So the camera, ``show_progress`` and ``sculpting``
    are all saved and put back.
    """
    view = ws.call("cmd.get_view")
    show_progress = ws.call("cmd.get_setting_int", "show_progress")
    sculpting = ws.call("cmd.get_setting_int", "sculpting")

    ws.call("cmd.delete", "all")
    ws.call("cmd.load", IL2, "wfo_obj")
    ws.call("cmd.show", "spheres", "wfo_obj")
    ws.call("cmd.zoom", "wfo_obj")
    assert ws.subscribe("progress")["t"] == "ok"

    yield ws

    ws.call("cmd.delete", "wfo_obj")
    ws.call("cmd.set", "show_progress", show_progress)
    ws.call("cmd.set", "sculpting", sculpting)
    ws.call("cmd.set_view", view)


def timed_ray(ws: WSClient) -> Tuple[float, List[Tuple[float, float]]]:
    """Ray, returning ``(duration, [(arrival_time, progress_value), ...])``.

    The samples are the ``progress`` topic frames that arrived WHILE the ray
    was running -- i.e. exactly what a subscribed browser would have seen.
    """
    samples: List[Tuple[float, float]] = []
    t0 = time.monotonic()
    msg_id = ws.send(t="call", fn="cmd.ray", args=[RAY_W, RAY_H], kwargs={})
    reply: Dict[str, Any] = {}
    while True:
        frame = ws._recv(30.0)
        if frame is None:
            raise AssertionError("no reply to the ray")
        if frame.get("t") == "event" and frame.get("topic") == "progress":
            samples.append((time.monotonic() - t0, float(frame["payload"]["fraction"])))
        if frame.get("id") == msg_id and frame.get("t") in ("ok", "err"):
            reply = frame
            break
    duration = time.monotonic() - t0
    assert reply["t"] == "ok", reply
    return duration, samples


# --------------------------------------------------------------------------
# row 112 — the busy / progress indicator
# --------------------------------------------------------------------------


def test_the_progress_topic_carries_a_live_fraction_while_pymol_is_busy(
    rayable: WSClient,
) -> None:
    """The push channel, end to end, against a real long C++ call.

    This is the whole point of the row: the client does NOT poll (Qt does, at
    `pymol_qt_gui.py:931-939`).  The bridge's 10 Hz status thread reads
    `cmd.get_progress()` — which takes `lock_api_status`, not the API lock, so
    it answers while the ray holds the engine — and republishes it on the
    `progress` topic.

    Measured on this machine: a 6000x4400 ray of 2084 spheres ran for ~0.7 s
    and delivered 6-7 frames, of which 3-5 were non-negative, rising
    0.35 -> 0.45 -> 0.53.  Asserted loosely, because the values are whatever
    `Ray.cpp`'s scanline counters happen to be at poll time.
    """
    duration, samples = timed_ray(rayable)
    assert duration > 0.25, "the ray was too quick to prove anything: %.3fs" % duration

    busy = [v for _, v in samples if v >= 0]
    assert busy, "no non-negative progress frame in %r" % (samples,)
    assert all(0.0 <= v <= 1.0 for v in busy), busy
    # `CmdGetProgress` folds slow into fast and divides, so it is a FRACTION,
    # never a count (`packages/engine/layer4/Cmd.cpp:4334-4348`).
    assert max(busy) < 1.0001, busy
    # Monotone: PyMOL only ever moves the counters forward within one job.
    assert busy == sorted(busy), busy


def test_progress_goes_back_to_MINUS_ONE_when_the_job_is_over(
    rayable: WSClient,
) -> None:
    """The sign is the signal.

    `PyMOL_GetBusy()` false makes `CmdGetProgress` return -1.0 whatever the
    counters hold (`packages/engine/layer4/Cmd.cpp:4341`), and `SceneRay` clears busy on its
    way out (`packages/engine/layer1/SceneRay.cpp:741`).  A client that rendered the value as a
    0..1 fraction would leave a full bar on screen forever.
    """
    _, samples = timed_ray(rayable)
    assert any(v >= 0 for _, v in samples), samples

    # Give the 10 Hz poller two cycles to publish the idle value.
    deadline = time.monotonic() + 3.0
    idle = None
    while time.monotonic() < deadline:
        frame = rayable._recv(0.3)
        if frame and frame.get("topic") == "progress":
            idle = float(frame["payload"]["fraction"])
            if idle < 0:
                break
    assert idle is not None, "the progress topic stopped publishing"
    assert idle < 0, idle
    assert rayable.call("cmd.get_progress") < 0


def test_the_update_rate_is_throttled_in_the_C_not_by_the_poller(
    rayable: WSClient,
) -> None:
    """`OrthoBusyFast` is called per scanline block; the client sees ~5 Hz.

    `Ray.cpp:3581-3586` calls `OrthoBusyFast` once per row of tiles — hundreds
    to thousands of times for this image — but `OrthoBusySlow`/`OrthoBusyFast`
    only push into `PyMOL_SetProgress` when `time_yet > 0.15` s
    (`packages/engine/layer1/Ortho.cpp:547`, `:577`), and the drawn box has its own 0.2 s gate
    (`cBusyUpdate`, `:198`).  So the number of DISTINCT values a UI can ever
    show is bounded by the wall clock, not by the work.

    Measured: 0.66-0.72 s of ray -> 3 distinct fractions.
    """
    duration, samples = timed_ray(rayable)
    busy = [v for _, v in samples if v >= 0]
    assert busy, samples

    distinct = len({v for v in busy})
    ceiling = int(duration / 0.15) + 2
    assert distinct <= ceiling, (distinct, ceiling, duration, busy)
    # And repeats prove the poller is faster than the throttle rather than the
    # other way round: 10 Hz polls against a >=0.15 s update.
    assert len(busy) >= distinct, busy


def test_show_progress_0_silences_the_whole_channel(rayable: WSClient) -> None:
    """The row's gate, measured rather than read.

    `show_progress` guards the call to `PyMOL_SetProgress` itself
    (`packages/engine/layer1/Ortho.cpp:547`, `:577`), not merely the drawing, so turning it off
    silences the DATA as well as the box.  Measured: 13 frames across two rays,
    every one of them -1.0.
    """
    # `show_progress` is an INT setting, not a boolean one
    # (`packages/engine/layer1/SettingInfo.h:347`), so `cmd.get` renders it "1", not "on".
    assert rayable.call("cmd.get", "show_progress") == "1"
    rayable.call("cmd.set", "show_progress", 0)

    duration, samples = timed_ray(rayable)
    assert duration > 0.25, duration
    assert samples, "the status thread stopped publishing entirely"
    assert all(v < 0 for _, v in samples), samples

    # ... and it comes back.  (The fixture restores the setting anyway; this
    # asserts the gate is not a one-way latch.)
    rayable.call("cmd.set", "show_progress", 1)
    _, samples = timed_ray(rayable)
    assert any(v >= 0 for _, v in samples), samples


def test_ray_turns_sculpting_off_which_hides_the_C_sculpting_guard(
    rayable: WSClient,
) -> None:
    """A withdrawn claim, kept as a test.

    `CmdGetProgress` refuses to report anything while `sculpting` is on
    (`packages/engine/layer4/Cmd.cpp:4328`), so reading the source suggests "sculpting kills
    the progress bar".  Driving it says otherwise: `cmd.ray` sets `sculpting`
    to off BEFORE it starts (`packages/engine/modules/pymol/viewing.py:1736-1737`), so the
    guard cannot fire during the one operation that reports progress.  The
    first probe here looked like a product bug (progress flowing with
    sculpting on); it was the fixture's own `set` being undone by `ray`.

    What a UI must take from this: `set sculpting, on` does NOT silence the
    progress bar, and it is `ray` that silently clears the setting.
    """
    rayable.call("cmd.set", "sculpting", 1)
    assert rayable.call("cmd.get_setting_int", "sculpting") == 1

    _, samples = timed_ray(rayable)

    assert rayable.call("cmd.get_setting_int", "sculpting") == 0
    assert any(v >= 0 for _, v in samples), samples


def test_the_busy_MESSAGE_and_the_two_BARS_are_not_reachable_from_python(
    ws: WSClient, bridge
) -> None:
    """What the overlay cannot say, and why it draws one bar and not two.

    `I->BusyMessage` (set by `OrthoBusyMessage`, `packages/engine/layer1/Ortho.cpp:530`) and the
    four `I->BusyStatus[]` counters are C-internal.  The single number
    `cmd.get_progress()` returns has already FOLDED the slow counter into the
    fast one (`packages/engine/layer4/Cmd.cpp:4334-4348`), so the two-bar layout of
    `OrthoBusyDraw` is not reconstructible from the exposed API.  Reproducing
    it is a **NEW** binding, exactly as the inventory row says.

    `_cmd.get_busy`/`_cmd.set_busy` DO exist (`packages/engine/layer4/Cmd.cpp:6455`, `:6633`)
    but are not re-exported on `cmd`, so they are not reachable either.
    """
    for symbol in (
        "cmd.get_busy_message",
        "cmd.busy_message",
        "cmd.get_busy_status",
        "cmd.get_busy",
        "cmd.set_busy",
    ):
        reply = ws.call_reply(symbol)
        assert reply["t"] == "err", (symbol, reply)
        assert "no such symbol" in reply["error"]["message"], reply

    ws.do(
        "print('WFO_BUSY', hasattr(cmd, 'get_busy'), "
        "hasattr(__import__('pymol')._cmd, 'get_busy'))"
    )
    lines = bridge.wait_for_feedback("WFO_BUSY", timeout=5.0)
    # PyMOL echoes the command line before it runs it; skip the echo.
    said = [ln for ln in lines if "WFO_BUSY" in ln and "print(" not in ln]
    assert said, lines[-4:]
    assert said[-1].strip() == "WFO_BUSY False True", said[-1]


def test_the_progress_frame_on_the_wire_matches_the_type_that_declares_it(
    rayable: WSClient,
) -> None:
    """FIXED IN WAVE 10.  This test used to pin the disagreement.

    `ProgressPayload` (`packages/protocol/src/topics/progress.ts`) declared
    `{fraction, busy, label, abortable}` while `BridgeServer._on_status` emitted
    `{"value": <float>}` — zero overlapping field names, so anything reading the
    declared type got `undefined`, and the only reason the bar ever moved is
    that `apps/web/src/app/session.ts:170` read both and said so in a comment.
    `server.py` was frozen for every wave that noticed.

    Both sides now agree, and the agreement is one function,
    `tenmol_bridge.session.progress_payload`. `label` was deleted rather than
    faked: the busy text is `I->BusyMessage` and there is no accessor for it —
    the test just above measures `hasattr(cmd, 'get_busy') == False`.
    """
    _, samples = timed_ray(rayable)
    assert samples, "no progress frame at all"

    payloads = [
        frame["payload"]
        for frame in rayable.events
        if frame.get("topic") == "progress"
    ]
    assert payloads, rayable.events[-3:]
    assert set(payloads[-1]) == {"fraction", "busy", "abortable"}, payloads[-1]
    assert isinstance(payloads[-1]["fraction"], float)

    # A busy frame really did carry busy=True during the ray, so the flag is
    # not merely present.
    busy = [p for p in payloads if p["fraction"] >= 0.0]
    assert busy, [p["fraction"] for p in payloads]
    assert all(p["busy"] is True and p["abortable"] is True for p in busy)

    # ...and it goes back to idle. Pumped for it rather than read off the last
    # frame already collected: `timed_ray` returns on the ok reply, and the ray
    # can still have been reporting when that arrived.
    rayable.pump_frames(0.5)
    last = [
        frame["payload"]
        for frame in rayable.events
        if frame.get("topic") == "progress"
    ][-1]
    assert last == {"fraction": -1.0, "busy": False, "abortable": False}, last


def test_a_plain_rpc_gets_no_answer_while_the_engine_is_busy(
    rayable: WSClient, bridge
) -> None:
    """Why the progress channel has to be a PUSH.

    An ordinary `cmd.*` call needs `lock_api`, which the ray holds for its
    whole duration; only the three `lock_api_status` calls the pump owns
    (`get_progress`, `_get_feedback`, `get_setting_updates`) can answer.  So a
    client that polled `cmd.get_progress()` over the same WebSocket would get
    its answer AFTER the job it was trying to report on.

    Measured: a `cmd.get_setting_int` issued on a second connection 50 ms into
    a 0.7 s ray took ~0.6 s to come back.
    """
    other = WSClient(bridge.ws_url)
    try:
        msg_id = rayable.send(
            t="call", fn="cmd.ray", args=[RAY_W, RAY_H], kwargs={}
        )
        time.sleep(0.05)
        t0 = time.monotonic()
        assert other.call("cmd.get_setting_int", "show_progress") == 1
        blocked = time.monotonic() - t0
        rayable.wait_reply(msg_id, timeout=60)
    finally:
        other.close()

    assert blocked > 0.2, (
        "the second call answered in %.3fs; either the ray was too short or "
        "the engine is no longer serialising API calls" % blocked
    )


# --------------------------------------------------------------------------
# row 113 — splash flag and the marquee rectangle
# --------------------------------------------------------------------------


def test_the_marquee_rectangle_is_not_readable_from_python(
    ws: WSClient, bridge
) -> None:
    """`LoopRect` never leaves the C, so the web client must draw its own.

    `SceneLoopClick`/`SceneLoopDrag` keep the rect in `CScene` and mirror it
    into `COrtho` with `OrthoSetLoopRect` (`packages/engine/layer1/SceneMouse.cpp:44-66`); the
    only Python-visible consequence of a rubber band is the SELECTION it makes
    at release (`ExecutiveSelectRect`), which `test_box_selection.py` already
    pins.  Nothing reports the rect while the drag is in flight, so a live
    marquee cannot be echoed from the backend without a **NEW** event -- which
    is why the client draws it from its own pointer state.
    """
    for symbol in (
        "cmd.get_loop_rect",
        "cmd.loop_rect",
        "cmd.get_loop_flag",
        "cmd.get_scene_loop_rect",
    ):
        reply = ws.call_reply(symbol)
        assert reply["t"] == "err", (symbol, reply)

    ws.do("print('WFO_LOOP', [n for n in dir(cmd) if 'loop' in n.lower()])")
    lines = bridge.wait_for_feedback("WFO_LOOP", timeout=5.0)
    said = [ln for ln in lines if "WFO_LOOP" in ln and "print(" not in ln]
    assert said, lines[-4:]
    # `mmatrix`-style loop settings only; nothing that reads a rectangle.
    assert "rect" not in said[-1].lower(), said[-1]


def test_the_splash_FLAG_is_invisible_but_the_splash_TEXT_is_a_command(
    ws: WSClient, bridge
) -> None:
    """What replaces `SplashFlag` for a browser.

    `I->SplashFlag` has no getter and no setter: it is raised in `OrthoInit`
    when `showSplash` is set and cleared by the first `OrthoButton` or Esc
    (`packages/engine/layer1/Ortho.cpp:2523`, `:967`).  The TEXT, though, is a normal command --
    `cmd.splash(0)` runs `OrthoSplash` (`packages/engine/layer4/Cmd.cpp:2865-2869`) and the
    banner arrives as ordinary feedback, which is how a React banner can show
    the real thing instead of a hard-coded copy.

    `cmd.splash(2)` is the query form and answers 1 on an open-source build.

    HAZARD, and the reason for the save/restore below: `cmd.splash(0)` also
    does `set text, 1` when `internal_feedback > 0`
    (`packages/engine/modules/pymol/commanding.py:337-339`) -- a global that changes what the
    in-viewport console draws for every later test.
    """
    for symbol in ("cmd.get_splash", "cmd.splash_flag", "cmd.get_splash_flag"):
        assert ws.call_reply(symbol)["t"] == "err", symbol

    assert ws.call("cmd.splash", 2) == 1

    text = ws.call("cmd.get_setting_int", "text")
    feedback = ws.call("cmd.get_setting_int", "internal_feedback")
    try:
        assert ws.call_reply("cmd.splash", 0)["t"] == "ok"
        lines = bridge.wait_for_feedback("Enter \"help\" for a list", timeout=5.0)
        joined = "\n".join(lines)
        assert "PyMOL(TM) Molecular Graphics System" in joined, lines[-20:]
        assert "Hit ESC anytime to toggle between text and graphics." in joined
    finally:
        ws.call("cmd.set", "text", text)
        ws.call("cmd.set", "internal_feedback", feedback)


def test_the_bridge_boots_with_the_splash_off(ws: WSClient, bridge) -> None:
    """Which is why the client's splash flag starts FALSE.

    `EngineState` sets `options.show_splash = 0` unless `--splash`
    (`packages/bridge/tenmol_bridge/engine.py:132`), so `OrthoInit` never raises
    `SplashFlag` and the banner is never in the ring when a browser connects.
    A console store that started with `splash: true` would cover the viewport
    with 26 lines of unrelated scrollback on every page load; it starts false
    (`packages/stores/src/console.ts:193-206`) and this is the backend fact
    that makes that correct.
    """
    assert bridge.pump.engine.config.splash is False

    ws.do("print('WFO_SPLASH', __import__('pymol').invocation.options.show_splash)")
    lines = bridge.wait_for_feedback("WFO_SPLASH", timeout=5.0)
    said = [ln for ln in lines if "WFO_SPLASH" in ln and "print(" not in ln]
    assert said, lines[-4:]
    assert said[-1].strip() == "WFO_SPLASH 0", said[-1]
