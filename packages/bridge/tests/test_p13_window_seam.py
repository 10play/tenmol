"""Row 78 (window control) and row 74 (clipboard image copy) — the halves
`test_window_control.py` does NOT hold.

MEASURED at the start of this wave, on a green tree:

  * emptying `BridgeWindow.window_cmd` so it dispatches NOTHING left the whole
    bridge suite green.  `test_every_window_action_NAME_is_accepted` only
    proves `window_sc.auto_err` resolves the nine names; it never looks at what
    reached the window.  So "when `pymol.gui.get_qtwindow()` returns a window,
    `cmd.window` calls `window.window_cmd` instead of the C implementation"
    — the entire point of the row — was untested, and so was the
    name -> `window_dict` integer mapping the client has to agree with.

  * flipping `copy_image_png`'s `prior=1` to `prior=0` also left the suite
    green.  `test_copy_image_returns_the_PRIOR_render_as_png_bytes` renders a
    scene and then copies it, so a re-render produces an equally valid PNG and
    the assertion passes either way.  `prior=1` is the whole reason the button
    is usable after a ray trace, so it needs a case where "copy what is on
    screen" and "render again" give DIFFERENT answers.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_p13_window_seam.py -q
"""

from __future__ import annotations

import base64
import os
import sys
from typing import Any, Dict, List

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

#: `packages/engine/modules/pymol/constants.py:150-152`, verbatim.
WINDOW_DICT = {
    "hide": 0,
    "show": 1,
    "position": 2,
    "size": 3,
    "box": 4,
    "maximize": 5,
    "fit": 6,
    "focus": 7,
    "defocus": 8,
}


def _window_calls(bridge: Any) -> List[Dict[str, Any]]:
    """Every `window` dispatch the shim has seen with no handler bound.

    `Shims.dispatch` records unhandled calls in `_pending` precisely so a
    missing listener is visible instead of silent, which makes it the
    observation point for "did `cmd.window` reach `window_cmd`".
    """
    return [
        entry["payload"]
        for entry in bridge.server.shims.pending()
        if entry["handler"] == "window"
    ]


# --------------------------------------------------- row 78: cmd.window


@pytest.mark.parametrize("action,code", sorted(WINDOW_DICT.items()))
def test_every_window_action_REACHES_window_cmd_with_its_window_dict_code(
    bridge: Any, ws: WSClient, action: str, code: int
) -> None:
    """`cmd.window(name)` -> `get_qtwindow().window_cmd(window_dict[name], ...)`.

    `viewing.py:1446-1457` translates the NAME to the integer and hands it to
    the window; the C `_cmd.window` is only reached when there is no window.
    The bridge always provides one (`BridgeWindow`), so every one of the nine
    must arrive here, carrying its own code.
    """
    before = len(_window_calls(bridge))
    assert ws.call_reply("cmd.window", action)["t"] == "ok", action
    calls = _window_calls(bridge)
    assert len(calls) == before + 1, (action, calls[-3:])
    assert calls[-1]["action"] == code, (action, calls[-1])


def test_the_geometry_arguments_arrive_unchanged(bridge: Any, ws: WSClient) -> None:
    """`window_cmd(action, x, y, width, height)` — all four, as ints.

    `box` is the one action that uses every argument (move + resize), so it is
    the one that would hide an argument dropped on the floor.
    """
    before = len(_window_calls(bridge))
    assert ws.call_reply("cmd.window", "box", 11, 22, 333, 444)["t"] == "ok"
    calls = _window_calls(bridge)
    assert len(calls) == before + 1
    assert calls[-1] == {
        "action": WINDOW_DICT["box"],
        "x": 11,
        "y": 22,
        "width": 333,
        "height": 444,
    }


# ---------------------------------------------- row 74: prior=1 clipboard


def _png_size(blob: bytes) -> tuple:
    """(width, height) out of the IHDR — no image library, no decode."""
    assert blob[:8] == b"\x89PNG\r\n\x1a\n", blob[:16]
    assert blob[12:16] == b"IHDR", blob[:20]
    return (
        int.from_bytes(blob[16:20], "big"),
        int.from_bytes(blob[20:24], "big"),
    )


@pytest.mark.engine
def test_copy_image_asks_cmd_png_for_the_PRIOR_image(bridge: Any, ws: WSClient) -> None:
    """`cmd.png(path, prior=1, dpi=...)` — the row's backend contract, literally.

    WHY THE CALL AND NOT THE PIXELS. MEASURED on this build, `prior=1` and
    `prior=0` are indistinguishable from the OUTPUT once any image exists:
    `_cmd.png` re-saves the same buffer, so both hand back the identical
    160x120 ray trace. And the other direction is not stable either — the pump
    keeps drawing, so "no prior image" is a race, not a state a test can hold.

    What `prior=1` decides is which BRANCH of `exporting.py:586-601` runs: the
    cheap `func()` that returns the existing image, or
    `_call_with_opengl_context(func)` that renders a new one. That is the whole
    content of the row — Edit > Copy Image must not pay for a second render of
    a ray trace the user is already looking at — and the call is where it is
    observable, so the call is what this pins.

    The pixels are asserted too, so the test still fails if the copy stops
    working at all rather than merely stopping being cheap.
    """
    ws.do("import tenmol_bridge.panels.files as _tf; _tf.install()")
    seen: List[Dict[str, Any]] = []

    def install(_engine: Any) -> Any:
        from pymol import cmd as cmd_module

        original = cmd_module.png

        def spy(*args: Any, **kwargs: Any) -> Any:
            seen.append(dict(kwargs))
            return original(*args, **kwargs)

        cmd_module.png = spy
        return original

    original = bridge.pump.call(install, label="p13-png-spy")

    def restore(_engine: Any) -> None:
        from pymol import cmd as cmd_module

        cmd_module.png = original

    try:
        ws.call("cmd.delete", "all")
        ws.call("cmd.fragment", "ala", "p13_prior")
        ws.call("cmd.orient", "p13_prior")
        ws.call("cmd.ray", 160, 120)
        seen.clear()
        result = ws.call("cmd.tenmol_files.copy_image_png")
    finally:
        bridge.pump.call(restore, label="p13-png-restore")
        ws.call("cmd.delete", "p13_prior")

    assert seen, "copy_image_png never called cmd.png"
    assert seen[-1].get("prior") == 1, (
        "copy_image_png asked for a RE-RENDER instead of the prior image: %r"
        % (seen[-1],)
    )

    assert result["ok"] is True, result
    copied = base64.b64decode(result["base64"])
    assert len(copied) == result["bytes"]
    # The prior image is the 160x120 ray trace, not an 800x600 viewport grab.
    assert _png_size(copied) == (160, 120), _png_size(copied)
