"""Parity area 4 — what a pick actually does, and what the client can see of it.

These tests forward a REAL click through `{t:'input'}` and look at what PyMOL
did with it. They subscribe to `pixels` first, deliberately: the click is
enqueued by `OrthoDefer` and only drains when the pump draws.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_picking.py -q
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


@pytest.fixture()
def pickable(ws: WSClient):
    """A big centred sphere rep, so a click at the middle lands on an atom."""
    ws.call("cmd.delete", "all")
    ws.call("cmd.load", IL2, "zpk_obj")
    ws.call("cmd.hide", "everything")
    ws.call("cmd.show", "spheres", "zpk_obj")
    ws.call("cmd.zoom", "zpk_obj")
    # LEAVE EDITING MODE FIRST. This is not defensive tidying — it decides
    # what a left click DOES. With the editor active and pk1..pk4 set, the
    # single-left slot resolves to `pkat` (multi-atom picking) instead of
    # `sele`, and no `sele` selection is ever created. Another module in this
    # shared process leaves exactly that state behind (`pk1`, `_pkbase1`,
    # `pkset`, `pkmol` were all present when this first failed), so a pick test
    # has to establish the mode it is picking in rather than assume one.
    ws.call("cmd.unpick")
    ws.call("cmd.edit_mode", 0)
    for leftover in ("pk1", "pk2", "pk3", "pk4", "pkset", "pkmol"):
        ws.call("cmd.delete", leftover)
    saved = ws.call("cmd.get", "mouse_selection_mode")
    assert ws.subscribe("pixels")["t"] == "ok"
    time.sleep(1.2)
    yield ws
    ws.call("cmd.set", "mouse_selection_mode", saved)
    ws.call("cmd.delete", "sele")
    ws.call("cmd.delete", "zpk_obj")


#: Fractions of the viewport to try, in order. A protein is not solid — the
#: exact centre can fall between atoms, or down a channel — so clicking one
#: point and asserting a hit is a coin toss that happens to land when the test
#: runs alone and misses once another test has moved the camera. The GL-free
#: e2e spec scans for the same reason.
CLICK_POINTS = ((0.5, 0.5), (0.45, 0.5), (0.55, 0.5), (0.5, 0.45), (0.5, 0.55))


def click_until_picked(ws: WSClient) -> int:
    """Click candidate points until one produces `sele`. Returns its size."""
    width, height = ws.call("cmd.get_viewport")[:2]
    for fx, fy in CLICK_POINTS:
        x, y = int(width * fx), int(height * fy)
        ws.input("button", button=0, state=0, x=x, y=y, mod=0, when=0.0)
        ws.input("button", button=0, state=1, x=x, y=y, mod=0, when=0.0)
        time.sleep(1.2)
        if "sele" in ws.call("cmd.get_names", "all"):
            return ws.call("cmd.count_atoms", "sele")
    raise AssertionError(
        # The names list is the useful part: leftover pk1/_pkbase entries mean
        # the editor is active and the click resolved to `pkat`, not `sele`.
        "every candidate click missed the molecule (names=%r)"
        % (ws.call("cmd.get_names", "all"),)
    )


# ----------------------------------------------------------- pick semantics


def test_a_left_click_creates_the_sele_selection(pickable: WSClient) -> None:
    """The `sele` action, end to end through the real input path.

    Not a unit test of a table — an actual click frame, drained by the actual
    pump, producing the actual named selection PyMOL's own UI produces.
    """
    assert click_until_picked(pickable) > 0


def test_the_pick_honours_mouse_selection_mode(pickable: WSClient) -> None:
    """`sel_mode_kw` widens the pick, and the widening is observable.

    At the default (1, Residues) a click selects a residue's worth of atoms;
    at 0 (Atoms) it selects one. This is the same mapping asserted statically
    in `test_selection_modes.py` — here it is the mouse doing it.
    """
    pickable.call("cmd.set", "mouse_selection_mode", 0)
    pickable.call("cmd.delete", "sele")
    atoms = click_until_picked(pickable)

    pickable.call("cmd.set", "mouse_selection_mode", 1)
    pickable.call("cmd.delete", "sele")
    residue = click_until_picked(pickable)

    assert atoms == 1, atoms
    assert residue > atoms, (atoms, residue)


def test_auto_show_selections_is_on_so_the_pick_is_visible(ws: WSClient) -> None:
    """Both auto_ settings default ON — a pick shows itself without help."""
    assert ws.call("cmd.get", "auto_show_selections") == "on"
    assert ws.call("cmd.get", "auto_hide_selections") == "on"


# ------------------------------------------------------ the click payload


def test_the_click_string_is_NOT_reachable_by_a_client(ws: WSClient) -> None:
    """`PyMOL_GetClickString`'s key=value payload is behind a private symbol.

    So a client cannot read type/object/index/bond/rank/resi/name/mod_keys for
    a click. What it CAN observe is the effect — the `sele` selection above —
    and that is what the React side has to build on.

    Recorded rather than "fixed" with a grant: the payload is a single-consumer
    latch (`PyMOL_SetClickReady` / `GetClickString`), so a client reading it
    would race the wizard machinery that already consumes it.
    """
    reply = ws.call_reply("cmd._get_click_string")
    assert reply["t"] == "err"
    assert reply["error"]["kind"] == "NotAllowed", reply
    for absent in ("cmd.get_click_string", "cmd.get_clickstring"):
        assert ws.call_reply(absent)["t"] == "err", absent


# ------------------------------------------------- indicator rendering knobs


@pytest.mark.parametrize(
    "name,expected",
    [
        ("selection_width", 3.0),
        ("selection_width_max", 10.0),
        ("selection_width_scale", 2.0),
    ],
)
def test_the_indicator_width_settings_have_their_defaults(ws, name, expected) -> None:
    """`width = scale*|stick_radius|/screenVertexScale` clamped to [w, w_max]."""
    assert float(ws.call("cmd.get", name)) == pytest.approx(expected), name


def test_round_points_defaults_off(ws: WSClient) -> None:
    assert ws.call("cmd.get", "selection_round_points") == "off"


def test_sele_color_is_NOT_a_setting(ws: WSClient) -> None:
    """The row says "unless `sele_color` is set", which reads like a setting.

    It is not one — `cmd.get('sele_color')` answers "unknown Setting". It is a
    per-record field (`rec->sele_color`, `packages/engine/layer3/Executive.cpp:5254`) carried
    by an individual named selection. A client looking for a global setting to
    change the indicator colour will find nothing.
    """
    reply = ws.call_reply("cmd.get", "sele_color")
    assert reply["t"] == "err"
    assert "unknown Setting" in reply["error"]["message"], reply
