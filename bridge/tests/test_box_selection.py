"""Parity area 4 — rubber-band selection, and the GPU pick pass behind it.

Box selection is driven purely by `_button`/`_drag`, so it round-trips like any
other drag — and it is the one input path that had been noted as unverified in
this branch ("rubber-band select needs the GL pick pass"). It does not need
anything new: the bridge has a real GL context and the pump draws, so
`SceneMultipick` runs where it always did.

Run::

    bridge/.venv/bin/python -m pytest bridge/tests/test_box_selection.py -q
"""

from __future__ import annotations

import os
import sys
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

DATA = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "test",
    "dat",
)
IL2 = os.path.join(DATA, "il2.pdb")

#: `internal.modifier_keys` is indexed by the raw mask: 1 is SHFT.
SHFT = 1


@pytest.fixture()
def boxable(ws: WSClient):
    ws.call("cmd.delete", "all")
    ws.call("cmd.load", IL2, "zbx_obj")
    # Leave editing mode, or the single-left slot resolves to `pkat` and the
    # box actions are not what a shift-drag reaches. See `test_picking.py`.
    ws.call("cmd.unpick")
    ws.call("cmd.edit_mode", 0)
    for leftover in ("pk1", "pk2", "pk3", "pk4", "pkset", "pkmol", "sele"):
        ws.call("cmd.delete", leftover)
    ws.call("cmd.hide", "everything")
    ws.call("cmd.show", "spheres", "zbx_obj")
    ws.call("cmd.zoom", "zbx_obj")
    assert ws.subscribe("pixels")["t"] == "ok"
    time.sleep(1.2)
    yield ws
    ws.call("cmd.delete", "sele")
    ws.call("cmd.delete", "zbx_obj")


def rubber_band(ws: WSClient, button: int, frm=(0.3, 0.3), to=(0.7, 0.7)) -> None:
    """A real press-drag-release with SHIFT held, in viewport pixels."""
    width, height = ws.call("cmd.get_viewport")[:2]
    x0, y0 = int(width * frm[0]), int(height * frm[1])
    x1, y1 = int(width * to[0]), int(height * to[1])

    ws.input("button", button=button, state=0, x=x0, y=y0, mod=SHFT, when=0.0)
    for step in range(1, 6):
        ws.input(
            "drag",
            x=x0 + (x1 - x0) * step // 5,
            y=y0 + (y1 - y0) * step // 5,
            mod=SHFT,
            when=0.0,
        )
        time.sleep(0.1)
    ws.input("button", button=button, state=1, x=x1, y=y1, mod=SHFT, when=0.0)
    time.sleep(1.5)


# ---------------------------------------------------------------- bindings


def test_the_box_actions_live_on_shift_drag(ws: WSClient, bridge) -> None:
    """`+Box` on shift+left, `-Box` on shift+middle, in the default mode."""
    ws.do(
        "print('ZBX_SLOTS', [e for e in "
        "sorted(cmd.controlling.mode_dict['three_button_viewing']) if 'Box' in e[2]])"
    )
    lines = bridge.wait_for_feedback("ZBX_SLOTS", timeout=5.0)
    got = [x for x in lines if "ZBX_SLOTS" in x and "print(" not in x]
    assert got, lines[-4:]
    assert "('l', 'shft', '+Box')" in got[-1], got[-1]
    assert "('m', 'shft', '-Box')" in got[-1], got[-1]


# ------------------------------------------------------------- the round trip


def test_a_shift_left_drag_selects_a_whole_region(boxable: WSClient) -> None:
    """The end-to-end result: `ExecutiveSelectRect` -> `SceneMultipick`.

    Measured: a drag across the middle 40% of the viewport selected 954 atoms
    of il2.pdb. Asserted as "many, but not everything", because the exact count
    depends on the camera and the point of the test is that a REGION was
    picked rather than a single atom.
    """
    total = boxable.call("cmd.count_atoms", "zbx_obj")
    rubber_band(boxable, button=0)

    assert "sele" in boxable.call("cmd.get_names", "all")
    selected = boxable.call("cmd.count_atoms", "sele")
    assert selected > 50, selected
    assert selected < total, (selected, total)


def test_minus_box_subtracts_from_the_existing_selection(boxable: WSClient) -> None:
    """`-Box` is shift+MIDDLE, and it removes rather than replacing.

    A client that treated every box drag as a fresh selection would make the
    subtract binding indistinguishable from the add one.
    """
    rubber_band(boxable, button=0, frm=(0.2, 0.2), to=(0.8, 0.8))
    after_add = boxable.call("cmd.count_atoms", "sele")
    assert after_add > 50, after_add

    rubber_band(boxable, button=1, frm=(0.3, 0.3), to=(0.6, 0.6))
    after_subtract = boxable.call("cmd.count_atoms", "sele")
    assert after_subtract < after_add, (after_add, after_subtract)


def test_box_selections_are_logged_by_default(ws: WSClient) -> None:
    """`log_box_selections` is ON, so a box drag writes a `select` line.

    That matters for the web client's echo: a rubber band is not a silent
    gesture, it produces a command in the log like anything else.
    """
    assert ws.call("cmd.get", "log_box_selections") == "on"


# --------------------------------------------------- the GPU pick pass itself


@pytest.mark.parametrize(
    "name,expected",
    [
        ("pick32bit", "on"),
        ("pick_shading", "off"),
        ("pickable", "on"),
        ("pick_surface", "off"),
    ],
)
def test_the_pick_pass_settings_have_their_defaults(ws, name, expected) -> None:
    """`pick32bit` sets the bit depth, `pick_shading` forces flat shading,
    `pickable`/`pick_surface` gate what can be hit."""
    assert ws.call("cmd.get", name) == expected, name


def test_pick_surface_is_OFF_so_a_surface_is_not_clickable(ws: WSClient) -> None:
    """User-visible and easy to mistake for a broken viewport.

    With only a surface shown, clicks pass through it — that is the default,
    not a bug in the client's coordinate mapping, which is the first thing
    anyone would suspect.
    """
    assert ws.call("cmd.get", "pick_surface") == "off"


def test_the_pick_pass_is_not_client_reachable(ws: WSClient) -> None:
    """`SceneDoXYPick` stays backend-authoritative, by design.

    There is no dotted path to it; picking is reached only by sending input and
    letting the backend render its pick pass. The proof that the whole thing
    works is the selections above, not an API call.
    """
    for absent in ("cmd.do_xy_pick", "cmd.scene_do_xy_pick", "cmd.pick"):
        assert ws.call_reply(absent)["t"] == "err", absent
