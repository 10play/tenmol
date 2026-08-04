"""Parity area 4 — selection levels, and the Python key-dispatch entry points.

`mouse_selection_mode` decides how far a single click widens: clicking one atom
can select that atom, its residue, its chain, or its whole molecule. The client
has to reproduce the mapping exactly, because picking one atom and getting a
chain is not a subtle bug to a user.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_selection_modes.py -q
"""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

DATA = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
    "packages", "engine", "test",
    "dat",
)
IL2 = os.path.join(DATA, "il2.pdb")

#: mode -> the selection keyword it wraps a picked atom in.
#: `packages/engine/layer1/Scene.cpp`; 0 is bare (the atom itself).
MODE_KEYWORD = {
    0: "",
    1: "byresi",
    2: "bychain",
    3: "bysegi",
    4: "byobject",
    5: "bymol",
    6: "bca.",
}


@pytest.fixture()
def scene(ws: WSClient):
    ws.call("cmd.delete", "all")
    ws.call("cmd.load", IL2, "zsm_obj")
    saved = ws.call("cmd.get", "mouse_selection_mode")
    yield ws
    ws.call("cmd.set", "mouse_selection_mode", saved)
    ws.call("cmd.delete", "zsm_obj")


# --------------------------------------------------------- selection levels


def test_the_default_level_is_RESIDUES(scene: WSClient) -> None:
    """1, not 0. A fresh click selects a residue, not an atom."""
    assert int(float(scene.call("cmd.get", "mouse_selection_mode"))) == 1


@pytest.mark.parametrize("mode,keyword", sorted(MODE_KEYWORD.items()))
def test_every_level_maps_to_a_real_selection_keyword(scene, mode, keyword) -> None:
    """The mapping the client must reproduce, exercised as real selections."""
    atom = "zsm_obj and index 1"
    expression = "%s (%s)" % (keyword, atom) if keyword else atom
    assert scene.call("cmd.count_atoms", expression) > 0, (mode, keyword)


def test_the_levels_widen_in_the_documented_order(scene: WSClient) -> None:
    """Measured on il2.pdb index 1: 1 atom -> 11 (residue) -> 2084 (chain).

    Asserted as a RELATION rather than as three numbers, so it survives a
    different fixture: an atom is never more than its residue, which is never
    more than its chain.
    """
    atom = "zsm_obj and index 1"
    counts = {
        level: scene.call("cmd.count_atoms", "%s (%s)" % (MODE_KEYWORD[level], atom))
        for level in (1, 2, 5)
    }
    bare = scene.call("cmd.count_atoms", atom)

    assert bare == 1
    assert bare < counts[1] <= counts[2] <= counts[5]


def test_c_alpha_level_NARROWS_rather_than_widens(scene: WSClient) -> None:
    """`bca.` is the odd one out — it is a residue's guide atom, not a group.

    Grouping it with the others in a "wider and wider" mental model is how a
    client ends up selecting nothing when the user clicks a side chain.
    """
    atom = "zsm_obj and index 1"
    assert scene.call("cmd.count_atoms", "bca. (%s)" % atom) <= scene.call(
        "cmd.count_atoms", "byresi (%s)" % atom
    )


def test_the_cycle_wraps_at_both_ends(scene: WSClient) -> None:
    """`cmd.mouse('select_forward'/'select_backward')` wraps 0..6.

    7 is SETTABLE but outside the cycle — measured — so a client that cycled by
    incrementing and clamping at 7 would show a mode the menu never offers.
    """
    scene.call("cmd.set", "mouse_selection_mode", 6)
    scene.call("cmd.mouse", "select_forward")
    assert int(float(scene.call("cmd.get", "mouse_selection_mode"))) == 0

    scene.call("cmd.set", "mouse_selection_mode", 0)
    scene.call("cmd.mouse", "select_backward")
    assert int(float(scene.call("cmd.get", "mouse_selection_mode"))) == 6


# ------------------------------------------------------- key dispatch entry


def test_the_ctrl_entry_point_invokes_a_CTRL_binding(ws: WSClient, bridge) -> None:
    """`cmd._ctrl('J')` -> `CTRL-J`, not `_special`'s numeric code path.

    The four entry points are not interchangeable: `_special` takes a GLUT
    code plus x/y, these take a character.
    """
    ws.do("cmd.set_key('CTRL-J', lambda: print('ZSM_CTRLJ fired'))")
    try:
        assert ws.call_reply("cmd._ctrl", "J")["t"] == "ok"
        lines = bridge.wait_for_feedback("ZSM_CTRLJ", timeout=5.0)
        assert any("ZSM_CTRLJ fired" in line for line in lines), lines[-4:]
    finally:
        ws.do("cmd.key_mappings.pop('CTRL-J', None)")


def test_modifier_names_are_indexed_by_MASK_not_by_bit(ws: WSClient, bridge) -> None:
    """`['', 'SHFT', 'CTRL', 'CTSH', 'ALT']` indexed by the raw mask value.

    So 3 is CTSH (Ctrl+Shift) and 4 is ALT — it is NOT a bitmask lookup, and
    anything above 4 has no name at all. A client that OR-ed Alt into Shift and
    got 5 would index off the end.
    """
    ws.do("print('ZSM_MODS', cmd.internal.modifier_keys)")
    lines = bridge.wait_for_feedback("ZSM_MODS", timeout=5.0)
    got = [x for x in lines if "ZSM_MODS" in x and "print(" not in x]
    assert got, lines[-4:]
    assert "'SHFT', 'CTRL', 'CTSH', 'ALT'" in got[-1], got[-1]
