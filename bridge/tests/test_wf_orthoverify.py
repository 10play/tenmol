"""Adversarial re-verification of parity rows 112-113 (busy box, splash,
marquee).

``bridge/tests/test_wf_ortho.py`` already measures the ``progress`` push
channel.  This file exists because three of its assertions are weaker than the
sentences they are quoted as supporting, and one hazard it fences was never
actually observed to fire:

  * the ``LoopRect`` scan prints ``[n for n in dir(cmd) if 'loop' in n]`` and
    then asserts ``'rect' not in`` the printed line — which is true of an EMPTY
    list whatever PyMOL exposes.  Here the two scans are asserted EXACTLY, and
    the missing getters have to fail with ``no such symbol`` specifically, not
    with any error at all (a policy refusal would also read ``err``).
  * the splash test joins the WHOLE 20 000-line feedback ring
    (``StatusPoller.__init__``) and looks for the banner anywhere in it, so any
    earlier caller of ``cmd.splash`` in the same shared PyMOL would satisfy it.
    Here the banner has to appear in the lines that arrived AFTER the call.
  * ``cmd.splash(0)`` doing ``set text, 1`` was read out of
    ``modules/pymol/commanding.py:338-339`` but cannot fire under the bridge as
    shipped, because ``engine.py:176`` sets ``internal_feedback`` to 0.  It is
    driven here so the claim is measured rather than read.

Plus one fact neither file pinned: the ``progress`` topic ticks on its own
while nothing at all is happening, which is what makes it a push feed rather
than a reply.

Run::

    bridge/.venv/bin/python -m pytest bridge/tests/test_wf_orthoverify.py -q
"""

from __future__ import annotations

import ast
import os
import sys
import time
from typing import List

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402


def _printed(bridge, tag: str, expr: str, ws: WSClient) -> str:
    """``print(tag, expr)`` over ``{t:'do'}``, minus PyMOL's echo of the line.

    PyMOL echoes ``PyMOL>print(...)`` before running it, so the tag appears
    twice; the echo is the one that still contains ``print(``.
    """
    ws.do("print(%r, %s)" % (tag, expr))
    lines = bridge.wait_for_feedback(tag, timeout=5.0)
    said = [ln for ln in lines if tag in ln and "print(" not in ln]
    assert said, lines[-6:]
    return said[-1].strip()[len(tag) + 1 :]


# --------------------------------------------------------------------------
# row 113 — the marquee rectangle really is unreachable
# --------------------------------------------------------------------------


def test_no_cmd_symbol_mentions_a_loop_and_the_only_rect_is_a_colorection(
    ws: WSClient, bridge
) -> None:
    """The scan, asserted exactly instead of by a substring that cannot fail.

    Measured on this build: nothing in ``dir(cmd)`` contains ``loop`` at all,
    and the only three names containing ``rect`` are ``del_colorection`` /
    ``get_colorection`` / ``set_colorection`` — ``colo-rect-ion``, a false
    positive.  So ``I->LoopRect`` (``layer1/SceneMouse.cpp:44-66``) has no
    Python route, in or out, and a browser marquee has to be drawn from local
    pointer state.
    """
    loops = ast.literal_eval(
        _printed(bridge, "WFOV_LOOP", "[n for n in dir(cmd) if 'loop' in n.lower()]", ws)
    )
    assert loops == [], loops

    rects = ast.literal_eval(
        _printed(bridge, "WFOV_RECT", "[n for n in dir(cmd) if 'rect' in n.lower()]", ws)
    )
    assert rects == ["del_colorection", "get_colorection", "set_colorection"], rects


def test_the_loop_and_splash_getters_fail_as_MISSING_not_as_refused(
    ws: WSClient,
) -> None:
    """"``err``" is not the same claim as "does not exist".

    The bridge's policy layer also answers ``err`` (``is not allowed``,
    ``is not callable``), so a getter that existed but was fenced would satisfy
    a bare ``reply['t'] == 'err'``.  Every one of these has to be absent.
    """
    for symbol in (
        "cmd.get_loop_rect",
        "cmd.loop_rect",
        "cmd.get_loop_flag",
        "cmd.get_scene_loop_rect",
        "cmd.get_splash",
        "cmd.splash_flag",
        "cmd.get_splash_flag",
        "cmd.get_busy",
        "cmd.set_busy",
        "cmd.get_busy_status",
    ):
        reply = ws.call_reply(symbol)
        assert reply["t"] == "err", (symbol, reply)
        assert "no such symbol" in reply["error"]["message"], (symbol, reply)


# --------------------------------------------------------------------------
# row 113 — the splash TEXT
# --------------------------------------------------------------------------


def _new_lines(bridge, before: List[str], needle: str, timeout: float = 5.0) -> List[str]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        after = bridge.feedback_lines()
        fresh = after[len(before) :]
        if any(needle in line for line in fresh):
            return fresh
        time.sleep(0.05)
    return bridge.feedback_lines()[len(before) :]


def test_the_banner_is_produced_BY_the_call_not_already_in_the_ring(
    ws: WSClient, bridge
) -> None:
    """`cmd.splash(0)` is what puts PyMOL's banner on the feedback channel.

    Asserted against the lines that arrived AFTER the call, so a banner printed
    by an earlier test in the same shared PyMOL cannot stand in for it.  The
    control half matters as much: the two banner lines are NOT in the slice
    taken just before, which is what makes the second half meaningful.

    `cmd.splash(2)` is the query form and answers 1 on this open-source build
    (``modules/pymol/commanding.py:315-352``).
    """
    assert ws.call("cmd.splash", 2) == 1

    text = ws.call("cmd.get_setting_int", "text")
    feedback = ws.call("cmd.get_setting_int", "internal_feedback")
    try:
        before = bridge.feedback_lines()
        # A quiet round trip, so "nothing new arrived on its own" is a fair
        # control rather than a race with the 10 Hz drain.
        ws.call("cmd.get_setting_int", "text")
        time.sleep(0.4)
        control = "\n".join(bridge.feedback_lines()[len(before) :])
        assert "PyMOL(TM) Molecular Graphics System" not in control, control

        before = bridge.feedback_lines()
        assert ws.call_reply("cmd.splash", 0)["t"] == "ok"
        fresh = "\n".join(_new_lines(bridge, before, 'Enter "help" for a list'))
        assert "PyMOL(TM) Molecular Graphics System" in fresh, fresh
        assert "Hit ESC anytime to toggle between text and graphics." in fresh, fresh
    finally:
        ws.call("cmd.set", "text", text)
        ws.call("cmd.set", "internal_feedback", feedback)


def test_the_splash_set_text_1_hazard_only_fires_when_internal_feedback_is_ON(
    ws: WSClient,
) -> None:
    """Measured, not read.

    ``cmd.splash(0)`` does ``set text, 1`` — but only inside
    ``if get_setting_int('internal_feedback') > 0``
    (``modules/pymol/commanding.py:338-339``).  The bridge boots with
    ``internal_feedback`` forced to 0 (``tenmol_bridge/engine.py:176``), so on
    a stock bridge the splash does NOT touch ``text``; the hazard is real only
    once something has turned the in-viewport feedback band back on.

    Both settings are global and both are restored.
    """
    text = ws.call("cmd.get_setting_int", "text")
    feedback = ws.call("cmd.get_setting_int", "internal_feedback")
    try:
        # (a) internal_feedback off -> `text` is left alone.
        ws.call("cmd.set", "internal_feedback", 0)
        ws.call("cmd.set", "text", 0)
        assert ws.call_reply("cmd.splash", 0)["t"] == "ok"
        assert ws.call("cmd.get_setting_int", "text") == 0

        # (b) internal_feedback on -> the same call raises `text`.
        ws.call("cmd.set", "internal_feedback", 1)
        ws.call("cmd.set", "text", 0)
        assert ws.call_reply("cmd.splash", 0)["t"] == "ok"
        assert ws.call("cmd.get_setting_int", "text") == 1
    finally:
        ws.call("cmd.set", "internal_feedback", feedback)
        ws.call("cmd.set", "text", text)


# --------------------------------------------------------------------------
# row 112 — the progress feed is unconditional
# --------------------------------------------------------------------------


def test_the_progress_topic_ticks_at_10_Hz_with_nothing_happening(
    ws: WSClient,
) -> None:
    """A push feed, not a reply: it publishes when the client asks nothing.

    ``StatusPoller`` runs at 10 Hz and fans ``cmd.get_progress()`` out on the
    ``progress`` topic whether or not anything is busy, so the client never
    polls (Qt does, at ``pymol_qt_gui.py:931-939``).  Measured while idle: the
    value is the -1.0 sentinel every time, so a UI that mapped it to 0..100 %
    would show a bar permanently.
    """
    assert ws.subscribe("progress")["t"] == "ok"

    values = []
    stamps = []
    deadline = time.monotonic() + 1.2
    while time.monotonic() < deadline:
        frame = ws._recv(0.3)
        if frame and frame.get("t") == "event" and frame.get("topic") == "progress":
            stamps.append(time.monotonic())
            values.append(float(frame["payload"]["fraction"]))

    # 1.2 s at 10 Hz is 12 frames; allow a wide margin for a loaded machine.
    assert len(values) >= 5, (values, stamps)
    assert all(v == -1.0 for v in values), values
    # The declared shape (`topics/progress.ts`), which the server disagreed
    # with in every field until wave 10 fixed `BridgeServer._on_status`.
    assert set(ws.events[-1]["payload"]) == {"fraction", "busy", "abortable"}, (
        ws.events[-1]
    )
    assert ws.events[-1]["payload"]["busy"] is False
    span = stamps[-1] - stamps[0]
    assert span / max(1, len(stamps) - 1) < 0.5, (span, len(stamps))
