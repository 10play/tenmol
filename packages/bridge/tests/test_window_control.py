"""Parity area 1 — backend-driven window control and the clipboard seam.

Both rows are about the backend reaching OUT to a GUI it does not have. What
the browser can and cannot do about that is the whole content.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_window_control.py -q
"""

from __future__ import annotations

import os
import sys
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

#: `window_dict` keys, in the row's order. The VALUES (0..8) are the C enum.
WINDOW_ACTIONS = (
    "hide", "show", "position", "size", "box",
    "maximize", "fit", "focus", "defocus",
)


# ------------------------------------------------------------ the seam


def test_copy_image_is_INSTALLED_and_does_not_raise(ws: WSClient) -> None:
    """Upstream's default raises; the bridge fills the seam.

    `packages/engine/modules/pymol/internal.py` documents `_copy_image` as "may be
    monkey-patched by GUI implementations" and raises NotImplementedError
    otherwise. The bridge replaces it (`shims.py`) with a dispatcher that
    returns None when no handler is registered — so a caller gets a quiet
    no-op, NOT an exception.

    Worth pinning because it is easy to describe backwards: a comment in
    `RenderDialog.tsx` said this raises, and it does not.
    """
    reply = ws.call_reply("cmd._copy_image")
    assert reply["t"] == "ok", reply
    assert reply["result"] is None


def test_the_real_clipboard_path_is_the_files_panel(ws: WSClient) -> None:
    """`cmd._copy_image` cannot hand a browser a QImage under any handler.

    The working route returns PNG BYTES for the client to write with
    `navigator.clipboard.write`, and it lives on the files panel — covered in
    `test_files.py`. This asserts only that the two are different things, so
    nobody wires the button to the seam and wonders why nothing is copied.
    """
    ws.do("import tenmol_bridge.panels.files as _tf; _tf.install()")
    assert ws.call_reply("cmd.tenmol_files.copy_image_png")["t"] == "ok"


# --------------------------------------------------------- window control


@pytest.mark.parametrize("action", WINDOW_ACTIONS)
def test_every_window_action_NAME_is_accepted(ws: WSClient, action: str) -> None:
    """All nine resolve, even with no window to act on."""
    assert ws.call_reply("cmd.window", action)["t"] == "ok", action


def test_the_INTEGER_form_is_rejected(ws: WSClient) -> None:
    """The row lists "hide 0, show 1, ..." — those are `window_dict` VALUES.

    The API takes the KEY. A client that sent the documented integer gets
    "unknown action: '0'", which reads as a bug in the client rather than the
    wrong spelling.
    """
    reply = ws.call_reply("cmd.window", 0)
    assert reply["t"] == "err"
    assert "unknown action" in reply["error"]["message"], reply


def test_an_unknown_action_is_refused_with_the_choices(ws: WSClient) -> None:
    reply = ws.call_reply("cmd.window", "nonesuch")
    assert reply["t"] == "err"
    assert "Choices" in reply["error"]["message"], reply


# ------------------------------------------------------------- viewport


def test_cmd_viewport_DOES_resize_this_engine_now(ws: WSClient) -> None:
    """FIXED IN WAVE 10.  This test used to pin the silent no-op.

    `cmd.viewport(w, h)` returned ok and changed nothing — `CmdViewport` ends
    at `PyMOL_NeedReshape` (`packages/engine/layer4/Cmd.cpp:4968`), which with `G->HaveGUI`
    true only raises a flag for the embedding application, and nothing read it.
    A client that resized this way saw the canvas and the engine drift apart
    with no error to explain it.

    `PyMOL_GetReshapeInfo` has no Python wrapper, so draining the flag was
    never reachable from here. `execapp` does not drain it either — it replaces
    the command (`pymol_qt_gui.py:1229-1231`, `commandoverloaddecorator`), and
    `Engine._install_viewport_seam` now does the same.

    Restored afterwards: the viewport is shared by every test in this process
    and a stale 640x480 would move every subsequent pick coordinate.
    """
    before = ws.call("cmd.get_viewport")[:2]
    try:
        assert ws.call_reply("cmd.viewport", 640, 480)["t"] == "ok"
        time.sleep(0.4)
        assert ws.call("cmd.get_viewport")[:2] == [640, 480]
    finally:
        ws.input("reshape", width=before[0], height=before[1], force=1)
        time.sleep(0.6)
    assert ws.call("cmd.get_viewport")[:2] == before


def test_the_reshape_INPUT_frame_is_what_actually_resizes(ws: WSClient) -> None:
    """`{t:'input', kind:'reshape'}` is the browser's resize path, and it works.

    Measured: 800x600 -> 640x480 and back. Restored afterwards, because the
    viewport is shared by every test in this process and a stale 640x480 would
    move every subsequent pick coordinate.
    """
    before = ws.call("cmd.get_viewport")[:2]
    try:
        ws.input("reshape", width=640, height=480, force=1)
        time.sleep(1.0)
        assert ws.call("cmd.get_viewport")[:2] == [640, 480]
    finally:
        ws.input("reshape", width=before[0], height=before[1], force=1)
        time.sleep(1.0)
    assert ws.call("cmd.get_viewport")[:2] == before


def test_full_screen_has_nothing_to_act_on(ws: WSClient) -> None:
    """Same shape as `cmd.viewport`, but it fails loudly instead of silently.

    Recorded together so the pair is legible: two window-control calls, two
    different failure modes for the same missing window.
    """
    assert ws.call_reply("cmd.full_screen")["t"] == "err"
