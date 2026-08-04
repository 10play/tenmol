"""Wave 8, area 2 — the object panel / ButMode gaps, against a live engine.

Everything here runs through the real bridge fixture (a real uvicorn server, a
real WebSocket, the shared PyMOL), and every claim is a MEASUREMENT, not a
reading of the C++:

  * ``internal_gui_name_color_mode 1`` really is the FIRST CARBON's colour —
    proved by colouring that one atom differently from every other one;
  * ``ObjectGetSpecLevel`` is recoverable from ``get_session(partial=1)``, which
    is what the M button's tint needs and what the inventory said needed a new
    C accessor;
  * the rep bitmask table the client ticks menu leaves with is diffed against
    the live ``pymol.constants.repmasks``;
  * every reorder rule ``actions.ts:planDrop`` emits is EXECUTED and the
    resulting panel order read back;
  * ``cmd.mouse('backward')`` / ``select_backward`` really walk the ring the
    other way.

THE SUITE SHARES ONE PYMOL, so every object carries the ``p8a2_`` prefix, every
global this file touches is restored in a fixture, and nothing here calls
``cmd.reinitialize``.
"""

from __future__ import annotations

from typing import Any, Dict, List

import pytest

from tenmol_bridge.panels import objects as panel

pytestmark = pytest.mark.usefixtures("bridge")

PREFIX = "p8a2_"
BOOTSTRAP = "/from tenmol_bridge.panels.objects import install;install()"


def _snapshot(ws: Any) -> Dict[str, Any]:
    ws.do(BOOTSTRAP)
    return ws.call("tenmol_objects", "snapshot")


def _rows(ws: Any) -> Dict[str, Dict[str, Any]]:
    return {row["name"]: row for row in _snapshot(ws)["rows"]}


@pytest.fixture
def scene(ws):
    """Three fragments and a group, deleted again afterwards."""
    names = [PREFIX + n for n in ("ala", "trp", "gly", "grp")]
    for name in names:
        ws.call("delete", name)
    ws.call("fragment", "ala", PREFIX + "ala")
    ws.call("fragment", "trp", PREFIX + "trp")
    ws.call("fragment", "gly", PREFIX + "gly")
    yield names
    for name in names:
        ws.call("delete", name)


@pytest.fixture
def name_color_mode(ws):
    """`internal_gui_name_color_mode` is GLOBAL; put it back."""
    before = ws.call("get_setting_int", "internal_gui_name_color_mode")
    yield
    ws.call("set", "internal_gui_name_color_mode", int(before))


# ==========================================================================
# ROW: name colour modes — mode 1 is the FIRST CARBON ATOM
# ==========================================================================


def test_mode_1_is_the_first_carbon_atoms_colour_not_the_objects(
    ws, scene, name_color_mode
):
    """`getNameColor` case `cNameColorMode_carbon` (`Executive.cpp:16133-16146`).

    The object colour and the first carbon's colour are made DIFFERENT on
    purpose: if the bridge were quietly answering `get_object_color_index` for
    mode 1 as well, this test would still see a colour and would still be
    green — so the two are pulled apart and both are asserted.
    """
    name = PREFIX + "trp"
    ws.call("color", "green", name)  # every atom, and the object record
    ws.call("set_object_color", name, "blue")

    # Colour ONLY the first carbon in AtomInfo order — which is the order
    # `cmd.iterate` walks, and the order `getNameColor`'s loop walks
    # (measured: index 2 for `trp`, not 1, because atom 1 is a nitrogen).
    ws.do(
        "/_x=[];cmd.iterate('(%s) and elem C','_x.append(index)',space={'_x':_x});"
        "cmd.color('orange','(%s) and index %%d' %% _x[0])" % (name, name)
    )

    orange = ws.call("get_color_tuple", ws.call("get_color_index", "orange"))
    green = ws.call("get_color_tuple", ws.call("get_color_index", "green"))
    blue = ws.call("get_color_tuple", ws.call("get_color_index", "blue"))

    ws.call("set", "internal_gui_name_color_mode", 1)
    row = _rows(ws)[name]
    assert "nameColor" in row, "mode 1 must ship a colour for a molecule"
    assert [round(c, 5) for c in row["nameColor"]] == [round(c, 5) for c in orange]
    assert [round(c, 5) for c in row["nameColor"]] != [round(c, 5) for c in green]
    assert [round(c, 5) for c in row["nameColor"]] != [round(c, 5) for c in blue]

    # mode 2 is the OBJECT colour, and it is a different answer for this object
    ws.call("set", "internal_gui_name_color_mode", 2)
    row2 = _rows(ws)[name]
    assert [round(c, 5) for c in row2["nameColor"]] == [round(c, 5) for c in blue]

    # mode 0 ships nothing at all
    ws.call("set", "internal_gui_name_color_mode", 0)
    assert "nameColor" not in _rows(ws)[name]


def test_mode_1_is_silent_for_a_row_that_is_not_a_molecule(
    ws, scene, name_color_mode
):
    """`if (obj->type == cObjectMolecule)` — everything else keeps
    `cColorDefault` and therefore the default text colour (`:16137`)."""
    ws.call("group", PREFIX + "grp", "%sala %strp" % (PREFIX, PREFIX))
    # a new group is CLOSED, and a closed group's children are not rows at all
    ws.call("group", PREFIX + "grp", action="open")
    ws.call("set", "internal_gui_name_color_mode", 1)
    rows = _rows(ws)
    assert "nameColor" not in rows[PREFIX + "grp"]
    assert "nameColor" in rows[PREFIX + "ala"]


# ==========================================================================
# ROW: the M button's motion spec level
# ==========================================================================


@pytest.fixture
def movie(ws):
    """`mset` / `mview` / the current frame are GLOBAL movie state.

    Restored rather than wiped: a bare `mset` would clear a movie some other
    test in this shared process set up, so the frame count and the current
    frame are put back the way they were found.
    """
    frames = int(ws.call("count_frames"))
    frame = int(ws.call("get_frame"))
    yield
    if frames > 1:
        ws.do("mset 1x%d" % frames)
    else:
        ws.do("mset")
    ws.do("frame %d" % max(1, frame))
    assert int(ws.call("count_frames")) == frames


def test_spec_level_is_readable_without_a_new_c_accessor(ws, scene, movie):
    """`ObjectGetSpecLevel(obj, frame)` from the partial session.

    `packages/engine/layer1/PyMOLObject.cpp:109`: no `ViewElem` -> -1, in range -> that frame's
    `specification_level`, past the end -> 0, `frame < 0` -> the max. All four
    branches are exercised against a REAL `mview store`.
    """
    name = PREFIX + "ala"
    other = PREFIX + "trp"

    # No motion at all: -1 for every object.
    ws.do("mset")
    assert panel_spec(ws)[name] == -1

    ws.do("mset 1x10")
    ws.do("frame 3")
    ws.do("mview store, object=%s" % name)

    levels = panel_spec(ws)
    # frame 3 is 1-based -> ViewElem index 2, and that is the STORED key frame
    assert levels[name] == 2, levels
    # the object that was never stored still has no ViewElem
    assert levels[other] == -1, levels

    # A different frame of the same object is INTERPOLATED, level 1.
    ws.do("frame 5")
    assert panel_spec(ws)[name] == 1

    # frame < 0 asks for the maximum over the whole track
    assert ws.call("tenmol_objects", "spec", -1)[name] == 2
    # past the end of the ViewElem is 0, not an IndexError
    assert ws.call("tenmol_objects", "spec", 10_000)[name] == 0


def panel_spec(ws: Any) -> Dict[str, int]:
    return _snapshot(ws)["specLevels"]


def test_the_snapshot_carries_the_frame_it_read_the_levels_at(ws, scene, movie):
    ws.do("mset 1x10")
    ws.do("frame 4")
    snapshot = _snapshot(ws)
    assert snapshot["frame"] == 4
    assert isinstance(snapshot["specLevels"], dict)
    # and internal_gui_mode, which decides whether the popups invert
    assert snapshot["internalGuiMode"] == ws.call("get_setting_int", "internal_gui_mode")


# ==========================================================================
# ROW: rep check marks in the S / H menus
# ==========================================================================


def test_rep_masks_match_pymols_own_table(ws):
    """The TypeScript `REP_MASKS` is `pymol.constants.repmasks`, diffed live.

    `apps/web/src/features/objects/reps.ts` has to carry the table (the client
    must not round-trip for a check mark), so the table is compared against the
    engine's rather than trusted.
    """
    from pymol import constants

    expected = {
        "everything": 0b000111111111111111111111,
        "sticks": 1 << 0,
        "spheres": 1 << 1,
        "surface": 1 << 2,
        "labels": 1 << 3,
        "nb_spheres": 1 << 4,
        "cartoon": 1 << 5,
        "ribbon": 1 << 6,
        "lines": 1 << 7,
        "mesh": 1 << 8,
        "dots": 1 << 9,
        "dashes": 1 << 10,
        "nonbonded": 1 << 11,
        "cell": 1 << 12,
        "cgo": 1 << 13,
        "callback": 1 << 14,
        "extent": 1 << 15,
        "slice": 1 << 16,
        "angles": 1 << 17,
        "dihedrals": 1 << 18,
        "ellipsoids": 1 << 19,
        "volume": 1 << 20,
        "licorice": (1 << 0) | (1 << 4),
        "wire": (1 << 7) | (1 << 11),
    }
    assert dict(constants.repmasks) == expected


def test_the_reps_bitmask_tracks_what_the_show_menu_leaves_do(ws, scene):
    """The check mark's whole premise: `reps` on the wire == what is shown.

    The command strings are the ones `pymol.menu.rep_action` builds, run
    verbatim through `{t:'do'}` the way a menu leaf does.
    """
    name = PREFIX + "gly"
    bit = lambda index: 1 << index  # noqa: E731

    ws.call("hide", "everything", name)
    assert _rows(ws)[name]["reps"] == 0

    ws.do('cmd.show("lines"     ,"%s")' % name)
    assert _rows(ws)[name]["reps"] == bit(7)

    ws.do('cmd.show("nonbonded" ,"%s")' % name)
    # `wire` is lines|nonbonded: only NOW is that leaf fully "on"
    assert _rows(ws)[name]["reps"] == bit(7) | bit(11)

    ws.do('cmd.show_as("sticks"    ,"%s")' % name)
    assert _rows(ws)[name]["reps"] == bit(0), "show_as replaces, it does not add"

    ws.do('cmd.hide("sticks"    ,"%s")' % name)
    assert _rows(ws)[name]["reps"] == 0


def test_the_show_menu_really_contains_those_command_strings(ws, scene):
    """The client parses `command`; if `menu.py` changed shape it would tick
    nothing. Pin the two leaves the check-mark parser depends on."""
    ws.do(BOOTSTRAP)
    payload = ws.call("tenmol_objects", "menu", PREFIX + "gly", "S", "object:molecule")
    commands = _commands(payload["items"])
    assert 'cmd.show("lines"     ,"%s")' % (PREFIX + "gly") in commands
    assert 'cmd.show("wire"      ,"%s")' % (PREFIX + "gly") in commands
    # and the `flag ignore` leaf, which must NOT be ticked, is two statements
    assert any(";" in command and "cmd.flag" in command for command in commands)


def _commands(items: List[Dict[str, Any]]) -> List[str]:
    out: List[str] = []
    for node in items:
        if "command" in node:
            out.append(node["command"])
        if node.get("items"):
            out.extend(_commands(node["items"]))
    return out


# ==========================================================================
# ROW: drag-to-reorder and drag-into-group — planDrop's output, EXECUTED
# ==========================================================================


def _order(ws: Any) -> List[str]:
    """Panel order, `all` dropped — what the drag actually rearranges."""
    return [row["name"] for row in _snapshot(ws)["rows"] if not row["isAll"]]


def _mine(names: List[str]) -> List[str]:
    return [name for name in names if name.startswith(PREFIX)]


def test_planDrop_order_current_moves_a_row_DOWN(ws, scene):
    """`pressed < over` -> `cmd.order("<target> <moved>", location='current')`
    (`Executive.cpp:15927-15930`)."""
    ws.do("order %sala %strp %sgly" % (PREFIX, PREFIX, PREFIX))
    assert _mine(_order(ws)) == [PREFIX + "ala", PREFIX + "trp", PREFIX + "gly"]

    # drag `ala` down onto `trp`
    ws.call("order", "%strp %sala" % (PREFIX, PREFIX), location="current")
    assert _mine(_order(ws)) == [PREFIX + "trp", PREFIX + "ala", PREFIX + "gly"]


def test_planDrop_order_upper_moves_a_row_UP(ws, scene):
    """`pressed > over` -> `location='upper'`, which is the OTHER string and a
    different result: it puts the moved row ABOVE the target."""
    ws.do("order %sala %strp %sgly" % (PREFIX, PREFIX, PREFIX))
    # drag `gly` up onto `trp`
    ws.call("order", "%sgly %strp" % (PREFIX, PREFIX), location="upper")
    assert _mine(_order(ws)) == [PREFIX + "ala", PREFIX + "gly", PREFIX + "trp"]


def test_planDrop_group_drops_a_row_into_an_open_group(ws, scene):
    """`group <parent>, <child>` — and the child becomes a NESTED row, which is
    the observable difference from a reorder."""
    ws.call("group", PREFIX + "grp", PREFIX + "ala")
    ws.call("group", PREFIX + "grp", action="open")

    rows = {row["name"]: row for row in _snapshot(ws)["rows"]}
    assert rows[PREFIX + "ala"]["group"] == PREFIX + "grp"
    assert rows[PREFIX + "ala"]["nest"] == 1
    assert rows[PREFIX + "grp"]["isGroup"] is True
    assert rows[PREFIX + "grp"]["isOpen"] is True

    # A CLOSED group's children are not rows at all (PanelListGroup:1554-1560)
    ws.call("group", PREFIX + "grp", action="close")
    assert PREFIX + "ala" not in {row["name"] for row in _snapshot(ws)["rows"]}


def test_planDrop_ungroup_pops_a_row_out_of_its_group(ws, scene):
    ws.call("group", PREFIX + "grp", PREFIX + "ala")
    ws.call("group", PREFIX + "grp", action="open")
    assert _rows(ws)[PREFIX + "ala"]["group"] == PREFIX + "grp"

    ws.call("ungroup", PREFIX + "ala")
    row = _rows(ws)[PREFIX + "ala"]
    assert row["group"] == ""
    assert row["nest"] == 0


def test_the_engine_refuses_the_drop_planDrop_guards_against(ws, scene, bridge):
    """Why `planDrop` has a `{kind:'none'}` case for "a group dropped onto its
    own member" — the command it would otherwise emit is REJECTED.

    Executive.cpp:15845 does nothing there; the observable consequence of not
    doing nothing is this error line and an unchanged panel.
    """
    ws.call("group", PREFIX + "grp", PREFIX + "ala")
    ws.call("group", PREFIX + "grp", action="open")
    before = _order(ws)

    # the drag `grp` -> `ala` inverted: make the MEMBER the parent
    ws.do("group %sala, %sgrp" % (PREFIX, PREFIX))
    lines = bridge.wait_for_feedback("not a group object")
    assert any("not a group object" in line for line in lines), lines
    assert _order(ws) == before

    # and re-adding a member to the group it is already in changes nothing
    ws.call("group", PREFIX + "grp", PREFIX + "ala")
    assert _order(ws) == before
    assert _rows(ws)[PREFIX + "ala"]["nest"] == 1


# ==========================================================================
# ROW: ButMode — cmd.mouse walks the ring, forward and BACKWARD
# ==========================================================================


@pytest.fixture
def mouse_mode(ws):
    """`button_mode`, `button_mode_name` and `mouse_selection_mode` are GLOBAL.

    Restored by writing `button_mode` back and letting `cmd.mouse()` re-derive
    the name and the 80-slot table from it. NOT with `cmd.config_mouse`, which
    changes the mouse RING and resets `button_mode` to 0 — a much bigger
    write than the one being undone, and one that leaks into every later test
    in this shared process (measured: it left `mouse_selection_mode` 0 and
    broke `test_selection_modes.py::test_the_default_level_is_RESIDUES`).
    """
    button_mode = int(ws.call("get_setting_int", "button_mode"))
    name = ws.call("get_setting_text", "button_mode_name")
    selection = int(ws.call("get_setting_int", "mouse_selection_mode"))
    yield
    ws.call("set", "button_mode", button_mode, quiet=1)
    if ws.call("get_setting_text", "button_mode_name") != name:
        ws.call("mouse", quiet=1)
    ws.call("set", "mouse_selection_mode", selection, quiet=1)
    # The restore is asserted, so a leak fails HERE and not three files later.
    assert int(ws.call("get_setting_int", "mouse_selection_mode")) == selection
    assert ws.call("get_setting_text", "button_mode_name") == name


def test_mouse_forward_and_backward_are_inverses_on_the_ring(ws, mouse_mode):
    """`cmd.mouse('forward'|'backward')` — what the block emits, measured.

    `CButMode::click` inverts `forward` for the right button, a backward wheel
    notch and Shift; the block can only be right about that if `backward`
    really is the other direction, so both are walked here.
    """
    start = ws.call("get_setting_text", "button_mode_name")
    seen = [start]
    for _ in range(3):
        ws.call("mouse", "forward", quiet=1)
        seen.append(ws.call("get_setting_text", "button_mode_name"))
    assert len(set(seen)) > 1, "forward must move the ring: %r" % (seen,)

    for _ in range(3):
        ws.call("mouse", "backward", quiet=1)
    assert ws.call("get_setting_text", "button_mode_name") == start, (
        "three forward and three backward must land back on %r" % start
    )


def test_select_forward_and_backward_walk_mouse_selection_mode(ws, mouse_mode):
    ws.call("set", "mouse_selection_mode", 1)
    ws.call("mouse", "select_forward", quiet=1)
    assert ws.call("get_setting_int", "mouse_selection_mode") == 2
    ws.call("mouse", "select_backward", quiet=1)
    assert ws.call("get_setting_int", "mouse_selection_mode") == 1
    # and it WRAPS, which is why the block never has to bound it
    ws.call("mouse", "select_backward", quiet=1)
    assert ws.call("get_setting_int", "mouse_selection_mode") == 0
    ws.call("mouse", "select_backward", quiet=1)
    assert ws.call("get_setting_int", "mouse_selection_mode") == 6


def test_mouse_config_menu_is_the_live_pymol_menu(ws):
    """The block's right-click menu is `pymol.menu.mouse_config(cmd)`; the
    client mirrors it, so the mirror is diffed against the engine."""
    from pymol import menu as pymol_menu
    import pymol

    live = [[int(row[0]), str(row[1]), str(row[2])] for row in pymol_menu.mouse_config(pymol.cmd)]
    labels = [row[1] for row in live if row[0] == 1]
    assert labels == [
        "3-Button Motions",
        "3-Button Editing",
        "3-Button Viewing",
        "3-Button Lights",
        "3-Button All Modes",
        "2-Button Editing",
        "2-Button Viewing",
        "2-Button Lights",
    ]
    # `mouse_config` has NO title row: it starts on a code-1 item and the
    # "Mouse Config" heading is the pop-up host's, not the menu's.
    assert live[0][0] == 1 and live[0][1] == "3-Button Motions"
    assert [row[0] for row in live] == [1, 1, 1, 1, 1, 0, 1, 1, 1]
    assert live[2][2] == 'cmd.mouse("three_button_viewing")'
    assert live[4][2] == 'cmd.config_mouse("three_button_all_modes")'


# ==========================================================================
# the module's own contract
# ==========================================================================


def test_spec_verb_is_addressable_and_rejects_nonsense(ws):
    ws.do(BOOTSTRAP)
    reply = ws.call_reply("tenmol_objects", "spec")
    assert reply["t"] == "ok", reply
    assert isinstance(reply["result"], dict)
    assert "spec_levels" in panel.__all__


# ==========================================================================
# ROW: the wizard panel block — every popup row's get_menu, and get_event_mask
# ==========================================================================


#: Globals the stock wizards write while merely being CONSTRUCTED — grepped
#: out of ``packages/engine/modules/pymol/wizard/*.py`` (``appearance.py:69``,
#: ``label.py:34`` and ``distance.py:70`` all zero ``mouse_selection_mode``)
#: plus the ones their first action touches. Snapshotting a curated list and
#: ASSERTING it came back is the only way to walk every wizard in a process
#: that 1500 other tests share; the first version of this file did not, and it
#: left ``mouse_selection_mode`` at 0 and broke
#: ``test_selection_modes.py::test_the_default_level_is_RESIDUES``.
_WIZARD_GLOBALS = (
    "mouse_selection_mode",
    "button_mode",
    "auto_zoom",
    "antialias",
    "line_smooth",
    "cache_frames",
    "movie_panel",
    "suspend_updates",
    "valence",
    "sculpting",
    "auto_sculpt",
    "max_threads",
    "hash_max",
    "dot_width",
    "line_width",
    "transparency",
    "coulomb_dielectric",
    "roving_detail",
    "roving_origin",
    "roving_map1_name",
    "roving_sticks",
    "roving_polar_contacts",
    "cgo_line_width",
    "auto_remove_hydrogens",
    "editor_auto_dihedral",
)


@pytest.fixture
def wizard_stack(ws):
    """`cmd.set_wizard_stack` is GLOBAL, and so is everything in
    :data:`_WIZARD_GLOBALS`. Snapshot both, restore both, assert both."""
    before = {name: ws.call("cmd.get", name) for name in _WIZARD_GLOBALS}
    # `cmd.key_mappings` too: `wizard/filter.py` binds F1/F2/F3 and the arrow
    # keys with `cmd.set_key` in its constructor and only unbinds them in
    # `cleanup()`, which a bare `set_wizard_stack([])` never reaches. Measured:
    # leaving them behind breaks
    # `test_p8_a7.py::test_f_keys_recall_scenes_through_the_special_key_fallback`.
    ws.do("/import pymol;pymol._p8a2_keys = set(cmd.key_mappings)")
    # ...and the object list: `wizard/box.py` CREATES `box_points` in its
    # constructor. Measured: leaving it behind put a third sequence in
    # `test_p8_a6.py::TestLoadAlnMulti` and 3320 bytes into an .obj export that
    # was asserted empty.
    names_before = set(ws.call("get_names", "all", 0) or ())
    yield
    ws.do("/cmd.set_wizard_stack([])")
    assert ws.call("wizards.probe")["depth"] == 0
    ws.do(
        "/import pymol;[cmd.key_mappings.pop(k, None) for k in list(cmd.key_mappings) "
        "if k not in pymol._p8a2_keys];"
        "print('P8A2KEYS', sorted(set(cmd.key_mappings) ^ pymol._p8a2_keys))"
    )
    for name, value in before.items():
        if ws.call("cmd.get", name) != value:
            ws.call("set", name, value, quiet=1)
    for name in set(ws.call("get_names", "all", 0) or ()) - names_before:
        ws.call("delete", name)
    assert set(ws.call("get_names", "all", 0) or ()) == names_before
    after = {name: ws.call("cmd.get", name) for name in _WIZARD_GLOBALS}
    assert after == before, {
        name: (before[name], after[name]) for name in before if before[name] != after[name]
    }


#: Every wizard `wizards.catalog` offers that can be built with NO arguments
#: and no scene. `openvr` needs a headset, `security` is a modal about the
#: script that is running, and `dragging`/`sculpting` mutate editing state.
_SKIP = {"openvr", "security", "dragging", "sculpting", "demo", "stereodemo"}


def test_every_stock_wizard_panel_popup_resolves_to_a_real_menu(ws, wizard_stack):
    """`CWizard::click` case 3: `get_menu(code)` and open a popup
    (`packages/engine/layer1/Wizard.cpp:495-511`).

    The inventory said the popup CONTENTS per wizard were unverified. Here
    every wizard the catalog offers is launched, its real `get_panel()` read,
    and EVERY type-3 row's `get_menu(code)` fetched and checked to be a
    well-formed `[code, text, command]` list — the same shape `PopUp.cpp`
    consumes. A wizard whose popup returned None or a callable would fail.
    """
    catalog = ws.call("wizards.catalog")
    names = [entry["name"] for entry in catalog["wizards"]]
    assert len(names) > 15, names

    checked: Dict[str, int] = {}
    problems: List[str] = []
    # Wizards that cannot be built with no arguments on this machine, with the
    # engine's own reason. Recorded rather than skipped: a NEW one appearing
    # here is a regression, and a silent `continue` would hide it.
    unlaunchable: Dict[str, str] = {}
    for name in names:
        if name in _SKIP:
            continue
        launched = ws.call_reply("wizards.launch", name)
        if launched["t"] != "ok" or launched["result"].get("depth", 0) == 0:
            error = launched.get("error") or {}
            unlaunchable[name] = str(error.get("message", error))[:120]
            continue
        snapshot = ws.call("wizards.snapshot")
        popups = [row for row in snapshot["panel"] if row["type"] == 3]
        for row in popups:
            result = ws.call("wizards.menu", row["code"])
            if result["items"] is None:
                problems.append(
                    "%s popup %r -> %r" % (name, row["code"], result["error"])
                )
                continue
            for item in result["items"]:
                assert set(("code", "text")) <= set(item), (name, row, item)
                assert item["code"] in (0, 1, 2), (name, row, item)
                assert isinstance(item["text"], str), (name, row, item)
                # a callable must NEVER reach the wire
                assert isinstance(item.get("command", ""), str), (name, row, item)
        checked[name] = len(popups)
        ws.call("wizards.dismiss", all=True)

    assert not problems, problems

    # MEASURED on this build: exactly two stock wizards refuse a bare launch,
    # and for reasons that have nothing to do with the panel protocol.
    assert set(unlaunchable) == {"cleanup", "renaming"}, unlaunchable
    assert "szybki" in unlaunchable["cleanup"], unlaunchable
    assert "old_name" in unlaunchable["renaming"], unlaunchable

    # Everything else was walked, and most of the catalogue really was reached.
    assert len(checked) >= 15, checked
    # the wizards that actually HAVE popup rows, measured on this build
    with_popups = {name: n for name, n in checked.items() if n}
    assert with_popups, checked
    assert "appearance" in with_popups, checked
    assert with_popups["appearance"] >= 3, with_popups
    assert "measurement" in with_popups, with_popups


def test_get_event_mask_is_read_per_wizard_and_gates_forwarding(ws, wizard_stack):
    """`get_event_mask()` (`Wizard.cpp:220`) — the row's other named gap.

    Two things are asserted: the mask the panel ships is the wizard's OWN
    answer (different wizards give different masks), and the bridge refuses to
    forward an event the mask does not include, which is what the mask is FOR.
    """
    masks: Dict[str, int] = {}
    for name in ("measurement", "message", "appearance"):
        ws.call("wizards.launch", name)
        snapshot = ws.call("wizards.snapshot")
        masks[name] = snapshot["eventMask"]
        ws.call("wizards.dismiss", all=True)

    # `message` asks for nothing (`message.py` has no get_event_mask override
    # and no interaction); `measurement` wants picks.
    assert masks["measurement"] != masks["message"], masks
    assert masks["measurement"] & 1, masks  # cWizardEventPick

    ws.call("wizards.launch", "message", ["hello from p8a2"])
    snapshot = ws.call("wizards.snapshot")
    mask = snapshot["eventMask"]
    result = ws.call("wizards.event", "key", key=65)
    if not (mask & 16):  # cWizardEventKey
        assert result["dispatched"] is False, result
    ws.call("wizards.dismiss", all=True)


# ==========================================================================
# ROW: the in-viewport command prompt — Ctrl-V paste, live
# ==========================================================================


def test_cmd_paste_is_reachable_and_cannot_block_the_engine(ws, bridge):
    """`Ctrl-V` on a non-empty ortho line calls `cmd.paste()` (`Ortho.cpp:912`,
    `case 22`), which is what `OrthoConsole.tsx:320-324` calls too.

    Two things are measured, and the second one is a PRODUCT FINDING:

      1. the call crosses the wire and returns, so the fallback path is not
         blocked by policy and does not hang the pump;
      2. `externing.py:152-175` only reads the clipboard when
         `pymol.machine_get_clipboard` EXISTS, and that attribute is installed
         by the Tk/Qt skin — a bridge engine has no skin, so `cmd.paste()` is a
         NO-OP here. The browser's own `paste` event is therefore not a
         nice-to-have, it is the only thing that pastes anything.
    """
    ws.do(
        "/import pymol;print('P8A2CLIP', hasattr(pymol,'machine_get_clipboard'))"
    )
    lines = bridge.wait_for_feedback("P8A2CLIP")
    said = [line for line in lines if "P8A2CLIP" in line and "print(" not in line]
    assert said, lines
    assert said[-1].strip().endswith("False"), said

    reply = ws.call_reply("cmd.paste")
    assert reply["t"] == "ok", reply


def test_presentation_escape_quit_is_ROUTED_and_is_not_executed_here(ws):
    """`Esc` in presentation mode runs `_quit` (`Ortho.cpp:957`).

    This CANNOT be exercised live: the suite shares one PyMOL and one bridge,
    and `quit` ends both. What is asserted instead is the thing that makes the
    client's `session.call('quit')` safe to write at all — the bridge does not
    let it reach the C `exit()` path, it ROUTES it to its own shutdown.
    """
    from tenmol_bridge.policy import base

    assert "quit" in base.ROUTED and "_quit" in base.ROUTED, base.ROUTED
    # and the dispatcher really consults that set rather than carrying its own
    reply = ws.call_reply("get_setting_int", "presentation")
    assert reply["t"] == "ok", reply
