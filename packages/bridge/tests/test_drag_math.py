"""Parity area 4 — trackball / translate / zoom math, and where it runs.

Both rows describe formulas in `packages/engine/layer1/SceneMouse.cpp`, and both plans say the
same thing: ROUND-TRIP by default. The math only needs porting to TypeScript if
client-side prediction is enabled, which it is not. So what matters is not the
formulas but that the round trip genuinely applies them.

THE DRAW-PUMP INVARIANT IS THE WHOLE TEST. `CScene::click/drag/release` only
ENQUEUE via `OrthoDefer`; the queue is drained by `ExecutiveDrawNow`, reachable
only when `PyMOL_GetIdleAndReady` is true, which needs `DrawnFlag`, which only
`PyMOL_Draw` sets. A bridge that never draws accepts every input frame and
silently applies none of them. Subscribing to `pixels` is what starts the
drawing — so these tests subscribe, and that is not incidental setup.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_drag_math.py -q
"""

from __future__ import annotations

import os
import sys
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

DATA = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
    "packages", "engine", "test",
    "dat",
)
IL2 = os.path.join(DATA, "il2.pdb")

#: The settings each formula reads, with the defaults the rows document.
DEFAULTS = {
    "virtual_trackball": "1",
    "mouse_scale": 1.3,
    "mouse_limit": 100.0,
    "mouse_z_scale": 1.0,
    "legacy_mouse_zoom": "off",
}


@pytest.fixture()
def drawing(ws: WSClient):
    """A loaded scene WITH the pixel stream on, so the input queue drains."""
    ws.call("cmd.delete", "all")
    ws.call("cmd.load", IL2, "zdm_obj")
    assert ws.subscribe("pixels")["t"] == "ok"
    time.sleep(1.0)
    view = ws.call("cmd.get_view")
    yield ws
    ws.call("cmd.set_view", view)
    ws.call("cmd.delete", "zdm_obj")


def drag(ws: WSClient, button: int, dx: int, steps: int = 5) -> None:
    ws.input("button", button=button, state=0, x=200, y=150, mod=0, when=0.0)
    for step in range(1, steps + 1):
        ws.input("drag", x=200 + step * dx, y=150, mod=0, when=0.0)
        time.sleep(0.08)
    ws.input("button", button=button, state=1, x=200 + steps * dx, y=150, mod=0, when=0.0)
    time.sleep(1.2)


def moved(before, after) -> float:
    return max(abs(a - b) for a, b in zip(before, after))


# ---------------------------------------------------------------- settings


@pytest.mark.parametrize("name,expected", sorted(DEFAULTS.items()))
def test_the_settings_each_formula_reads_have_their_documented_defaults(
    ws: WSClient, name: str, expected
) -> None:
    """A changed default silently changes the feel of every drag."""
    value = ws.call("cmd.get", name)
    if isinstance(expected, str):
        assert value == expected, (name, value)
    else:
        assert float(value) == pytest.approx(expected), (name, value)


def test_roving_origin_is_ON_which_the_translate_row_depends_on(ws) -> None:
    """`move` runs roving follow-ups afterwards, and only when this is set.

    Recorded because it is ON by default and easy to miss: a translate does
    more than translate.
    """
    assert ws.call("cmd.get", "roving_origin") == "on"


# ------------------------------------------------------------- round trip


def test_a_forwarded_LEFT_drag_really_rotates(drawing: WSClient) -> None:
    """The round trip the plan chose, proven rather than assumed.

    Measured: a five-step horizontal left-drag moves `get_view` by ~0.24 in its
    largest component. That is PyMOL's own trackball math running — nothing in
    the client computes it.
    """
    before = drawing.call("cmd.get_view")
    drag(drawing, button=0, dx=12)
    after = drawing.call("cmd.get_view")
    assert moved(before, after) > 1e-3, (before[:4], after[:4])


def test_where_the_no_draw_case_actually_applies(ws: WSClient) -> None:
    """The invariant, stated where it is true rather than where it is not.

    An earlier version of this test asserted that a drag does NOTHING without a
    `pixels` subscription. That is FALSE on this bridge, and the test skipped
    every run — worse than no test. With a real GL context the pump draws
    regardless of who is watching, so the queue drains anyway.

    The case `packages/viewport/src/input/camera.ts` exists for is a bridge
    started `--no-gl`, where `PyMOL_Draw` is never called at all and forwarded
    input is accepted and silently never applied (measured in wave 4: a 20-step
    drag moved `get_view()[2]` by exactly 0). That configuration is covered by
    the GL-free e2e spec.

    What is assertable HERE is the precondition: this engine has a live GL
    context, which is why the round-trip tests above can rely on draining.
    """
    assert ws.call("cmd.get_renderer"), "no renderer; the drag tests above are vacuous"


def test_a_MIDDLE_drag_translates_rather_than_rotating(drawing: WSClient) -> None:
    """Slot 1 is `move` in the default mode — a different formula entirely.

    Asserted as "the view changed in a DIFFERENT way", because asserting the
    exact translation would be re-deriving
    `SceneGetExactScreenVertexScale(origin)` in the test.
    """
    before = drawing.call("cmd.get_view")
    drag(drawing, button=1, dx=12)
    after = drawing.call("cmd.get_view")
    assert moved(before, after) > 1e-3

    # A translate moves the position (view[12:15]); a rotation moves the
    # 3x3 matrix. This one must have touched the position.
    assert max(abs(a - b) for a, b in zip(before[12:15], after[12:15])) > 1e-4, (
        before[12:15],
        after[12:15],
    )
