"""Parity area 11 — how a typed command actually reaches PyMOL.

`{t:'do'}` is not a thin wrapper around `{t:'call'}`. The string goes to
`cmd.do` -> C -> the Python closure `Parser._parse`, which does several things
a client has to know about because they change what a single frame means.

Run::

    bridge/.venv/bin/python -m pytest bridge/tests/test_command_path.py -q
"""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

DATA = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "test",
    "dat",
)
IL2 = os.path.join(DATA, "il2.pdb")


#: Settings these tests write. The suite shares ONE PyMOL process, so a global
#: left changed here fails somebody else's test — which is exactly what
#: happened: `set sphere_scale, 0.33` broke two unrelated assertions in
#: `test_properties.py` that expect the stock default of 1.0.
TOUCHED_SETTINGS = ("sphere_scale", "bg_rgb")


@pytest.fixture()
def obj(ws: WSClient):
    ws.call("cmd.delete", "all")
    ws.call("cmd.load", IL2, "zcp_obj")
    saved = {name: ws.call("cmd.get", name) for name in TOUCHED_SETTINGS}
    yield ws
    for name, value in saved.items():
        ws.call("cmd.set", name, value)
    for name in ws.call("cmd.get_names", "all"):
        if name.startswith("zcp_"):
            ws.call("cmd.delete", name)


def feedback_value(bridge, tag: str) -> str:
    """The printed line for `tag`, skipping PyMOL's echo of the command."""
    lines = bridge.wait_for_feedback(tag, timeout=5.0)
    for line in lines:
        if tag in line and "print(" not in line:
            return line.split(tag, 1)[1].strip()
    raise AssertionError("no %s output in %r" % (tag, lines[-5:]))


# ------------------------------------------------- what one frame can contain


def test_one_frame_can_hold_SEVERAL_commands_split_on_semicolons(obj) -> None:
    """So a client cannot assume one `do` is one action.

    Both run; the last wins. This matters for undo, for echo and for anything
    that counts commands.
    """
    obj.do("bg_color red; bg_color blue")
    assert obj.call("cmd.get", "bg_rgb") == "blue"


def test_a_LEADING_SLASH_runs_literal_python(obj, bridge) -> None:
    """`/expr` bypasses the keyword parser entirely."""
    obj.do('/print("ZCPSLASH", 6 * 7)')
    assert feedback_value(bridge, "ZCPSLASH") == "42"


def test_a_BACKSLASH_continues_across_two_frames(obj, bridge) -> None:
    """State survives BETWEEN frames, which is easy to miss.

    The parser buffers an unterminated line, so frame N and frame N+1 can be
    halves of one statement. A client that assumed each frame was independent
    — resetting UI state, or interleaving another command — would corrupt it.
    """
    obj.do('print("ZCPCONT", \\')
    obj.do("  1 + 1)")
    assert feedback_value(bridge, "ZCPCONT") == "2"


# ------------------------------------------------------------ argument binding


def test_every_parsed_argument_arrives_as_a_STRING(obj) -> None:
    """`parse_arg` does no coercion — the COMMAND converts.

    `set sphere_scale, 0.33` binds the string "0.33"; `cmd.set` turns it into a
    float. So the client cannot pre-type command-line arguments, and a command
    whose own conversion is missing will fail on its own terms rather than at
    the parser.
    """
    obj.do("set sphere_scale, 0.33")
    assert float(obj.call("cmd.get", "sphere_scale")) == pytest.approx(0.33)


def test_positional_binding_follows_the_functions_own_signature(obj) -> None:
    """Two bare positionals land on the right parameters."""
    obj.do("set_name zcp_obj, zcp_renamed")
    names = obj.call("cmd.get_names", "all")
    assert "zcp_renamed" in names and "zcp_obj" not in names


def test_a_keyword_argument_binds_by_name(obj) -> None:
    obj.do("set sphere_scale, 0.44, zcp_obj")
    assert float(obj.call("cmd.get", "sphere_scale", "zcp_obj")) == pytest.approx(0.44)


# ------------------------------------------------------------------- async


def test_async_runs_a_keyword_and_sync_joins_it(obj) -> None:
    """`cmd.async_` is accepted over the wire and `cmd.sync` waits for it.

    Only the round trip is asserted, not the wizard: `async_` pushes a
    "please wait" Message wizard and pops it in `finally`, so by the time
    `sync` returns there is nothing left to observe — asserting on the wizard
    would be a race, not a test.
    """
    # `orient` MOVES THE CAMERA, and the camera is shared by every test in
    # this process — `cmd.translate` defaults to camera space, so leaving it
    # turned broke an unrelated coordinate assertion elsewhere. Restore it.
    view = obj.call("cmd.get_view")
    try:
        assert obj.call_reply("cmd.async_", "orient")["t"] == "ok"
        assert obj.call_reply("cmd.sync")["t"] == "ok"
    finally:
        obj.call("cmd.set_view", view)


# --------------------------------------------------------- progress / ready


def test_progress_is_NEGATIVE_when_idle(obj) -> None:
    """The sign is the signal, not the magnitude.

    Qt hides the progress bar and the abort button while it is < 0. A client
    that rendered `get_progress()` as a 0..1 fraction would show a full bar at
    rest, because -1.0 clamps to something.
    """
    progress = obj.call("cmd.get_progress")
    assert isinstance(progress, float)
    assert progress < 0, progress


def test_ready_answers_truthy_on_a_live_engine(obj) -> None:
    assert obj.call("cmd.ready") == 1


def test_busy_TEXT_is_not_exposed_to_python(ws: WSClient) -> None:
    """`OrthoBusyMessage`/`OrthoBusySlow` are C-internal.

    So a progress UI can show a FRACTION but cannot show PyMOL's own "Building
    surface..." style captions without new bindings.
    """
    for symbol in ("cmd.get_busy_message", "cmd.busy_message", "cmd.get_busy"):
        assert ws.call_reply(symbol)["t"] == "err", symbol
