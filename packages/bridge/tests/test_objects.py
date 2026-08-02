"""WP-12 — the object panel endpoint and its A/S/H/L/C/M popup menus.

Everything here runs against the REAL bridge fixture (`conftest.RunningBridge`),
i.e. a real uvicorn server, a real WebSocket and a real PyMOL.  The menu
assertions are the point: they check that `pymol.menu.*` is what answers, not a
transcription — a leaf's `command` string is compared against what
`packages/engine/modules/pymol/menu.py` actually builds.

The session-scoped PyMOL is shared with every other test module, so every object
made here carries the `wp12_` prefix and is deleted again.
"""

from __future__ import annotations

import sys

import pytest

from tenmol_bridge.panels import objects as panel

pytestmark = pytest.mark.usefixtures("bridge")


PREFIX = "wp12_"


@pytest.fixture
def scene(ws):
    """A molecule, a group with two members, a selection and a pseudoatom."""
    names = [
        PREFIX + n for n in ("ala", "trp", "gly", "grp", "sel", "pa", "inner")
    ]
    for name in names:
        ws.call("delete", name)
    ws.call("fragment", "ala", PREFIX + "ala")
    ws.call("fragment", "trp", PREFIX + "trp")
    ws.call("fragment", "gly", PREFIX + "gly")
    ws.call("group", PREFIX + "grp", "%sala %strp" % (PREFIX, PREFIX))
    ws.call("select", PREFIX + "sel", "%sgly and name CA" % PREFIX)
    ws.call("pseudoatom", PREFIX + "pa")
    yield names
    for name in names:
        ws.call("delete", name)


def _rows(ws):
    snapshot = ws.call("tenmol_objects", "snapshot")
    return snapshot, {row["name"]: row for row in snapshot["rows"]}


# ---------------------------------------------------------------- bootstrap


def test_bootstrap_binds_the_symbol_and_the_wire_can_reach_it(ws):
    """`{t:'do'}` installs `cmd.tenmol_objects`; `{t:'call'}` then resolves it.

    This is the whole addressing story for the panel: `panels/__init__.py` is a
    frozen barrel nothing imports and `server.py`'s `_bridge.*` table is owned
    by WP-02, so the endpoint reaches the wire through `dispatch.py`'s
    one-segment `getattr(engine.cmd, fn)` rule.
    """
    ws.do("/from tenmol_bridge.panels.objects import install;install()")
    reply = ws.call_reply("tenmol_objects", "snapshot")
    assert reply["t"] == "ok", reply
    assert "rows" in reply["result"]


def test_unknown_verb_is_an_error_not_a_silent_none(ws):
    ws.do("/from tenmol_bridge.panels.objects import install;install()")
    reply = ws.call_reply("tenmol_objects", "nonsense")
    assert reply["t"] == "err"
    assert "verb" in reply["error"]["message"]


# ------------------------------------------------------------------- rows


def test_group_nesting_and_open_close_come_from_pymol_not_from_dotted_names(ws, scene):
    """`cmd.group('g','ala trp')` makes members whose names have NO dotted
    prefix, so the old name-inference could not see them at all.
    """
    ws.do("/from tenmol_bridge.panels.objects import install;install()")

    ws.call("group", PREFIX + "grp", action="close")
    _, rows = _rows(ws)
    assert rows[PREFIX + "grp"]["isGroup"] is True
    assert rows[PREFIX + "grp"]["isOpen"] is False
    # PanelListGroup only recurses into an OPEN group (Executive.cpp:1554-1560),
    # so a closed group's children are not rows at all.
    assert PREFIX + "ala" not in rows
    assert PREFIX + "trp" not in rows

    ws.call("group", PREFIX + "grp", action="open")
    snapshot, rows = _rows(ws)
    assert rows[PREFIX + "grp"]["isOpen"] is True
    assert rows[PREFIX + "ala"]["group"] == PREFIX + "grp"
    assert rows[PREFIX + "ala"]["nest"] == 1
    # ... and the children follow the group immediately, in panel order.
    order = [row["name"] for row in snapshot["rows"]]
    grp = order.index(PREFIX + "grp")
    assert order[grp + 1 : grp + 3] == [PREFIX + "ala", PREFIX + "trp"]


def test_row_types_selections_and_the_all_pseudo_object(ws, scene):
    ws.do("/from tenmol_bridge.panels.objects import install;install()")
    snapshot, rows = _rows(ws)

    assert snapshot["rows"][0]["name"] == "all"
    assert snapshot["rows"][0]["isAll"] is True
    assert rows[PREFIX + "sel"]["type"] == "selection"
    assert rows[PREFIX + "gly"]["type"] == "object:molecule"
    assert rows[PREFIX + "grp"]["type"] == "object:group"
    assert rows[PREFIX + "pa"]["type"] == "object:molecule"


def test_enabled_reps_and_colour_track_cmd_get_vis(ws, scene):
    ws.do("/from tenmol_bridge.panels.objects import install;install()")
    ws.call("disable", PREFIX + "gly")
    _, rows = _rows(ws)
    assert rows[PREFIX + "gly"]["enabled"] is False
    ws.call("enable", PREFIX + "gly")
    _, rows = _rows(ws)
    assert rows[PREFIX + "gly"]["enabled"] is True

    vis = ws.call("get_vis")
    expected = 0
    for index in vis[PREFIX + "gly"][2] or ():
        expected |= 1 << int(index)
    assert rows[PREFIX + "gly"]["reps"] == expected
    assert rows[PREFIX + "gly"]["color"] == vis[PREFIX + "gly"][3]


def test_caption_mirrors_ObjectMolecule_getCaption(ws, scene):
    """`<coordset name> <state>/<nstates>`, `\\789` when the state is frozen."""
    ws.do("/from tenmol_bridge.panels.objects import install;install()")
    ws.call("set_title", PREFIX + "gly", 1, "hello")
    _, rows = _rows(ws)
    assert rows[PREFIX + "gly"]["caption"] == "hello 1/1"

    # state_counter_mode 2 = "just state" (ObjectMolecule.cpp:415-419)
    ws.call("set", "state_counter_mode", 2, PREFIX + "gly")
    _, rows = _rows(ws)
    assert rows[PREFIX + "gly"]["caption"] == "hello 1"

    # 0 = off: caption is the coordset title alone
    ws.call("set", "state_counter_mode", 0, PREFIX + "gly")
    _, rows = _rows(ws)
    assert rows[PREFIX + "gly"]["caption"] == "hello"

    ws.call("unset", "state_counter_mode", PREFIX + "gly")
    # an object-level `state` setting is the "frozen" flag
    ws.call("set", "state", 1, PREFIX + "gly")
    _, rows = _rows(ws)
    assert rows[PREFIX + "gly"]["caption"] == "hello \\7891/1"
    ws.call("unset", "state", PREFIX + "gly")
    ws.call("set_title", PREFIX + "gly", 1, "")


def test_op_count_follows_button_mode_name(ws, scene):
    """`get_op_cnt()` is 5, or 6 in "3-Button Motions" (Executive.cpp:1757)."""
    ws.do("/from tenmol_bridge.panels.objects import install;install()")
    snapshot = ws.call("tenmol_objects", "snapshot")
    assert snapshot["opCount"] == (6 if snapshot["buttonMode"] == "3-Button Motions" else 5)
    assert snapshot["ops"][:5] == ["A", "S", "H", "L", "C"]

    ws.call("set", "button_mode_name", "3-Button Motions")
    snapshot = ws.call("tenmol_objects", "snapshot")
    assert snapshot["opCount"] == 6
    assert snapshot["ops"] == ["A", "S", "H", "L", "C", "M"]
    ws.call("set", "button_mode_name", "")


def test_name_colour_mode_2_returns_the_object_colour(ws, scene):
    """`getNameColor` mode 2 (`Executive.cpp:16148-16151`)."""
    ws.do("/from tenmol_bridge.panels.objects import install;install()")
    ws.call("color", "red", PREFIX + "gly")
    snapshot = ws.call("tenmol_objects", "snapshot", 2)
    rows = {row["name"]: row for row in snapshot["rows"]}
    # mode 2 reads obj->Color, which `color` does not change on its own; what
    # must hold is that the field is a 3-float RGB when the object HAS a colour.
    colour = rows[PREFIX + "gly"].get("nameColor")
    assert colour is None or (len(colour) == 3 and all(0.0 <= c <= 1.0 for c in colour))
    # mode 0 must never pay for the lookup.
    snapshot = ws.call("tenmol_objects", "snapshot", 0)
    rows = {row["name"]: row for row in snapshot["rows"]}
    assert "nameColor" not in rows[PREFIX + "gly"]


def test_hide_underscore_names_drops_underscore_rows(ws):
    ws.do("/from tenmol_bridge.panels.objects import install;install()")
    ws.call("delete", "_wp12_hidden")
    ws.call("fragment", "ala", "_wp12_hidden")
    try:
        ws.call("set", "hide_underscore_names", 1)
        _, rows = _rows(ws)
        assert "_wp12_hidden" not in rows
        ws.call("set", "hide_underscore_names", 0)
        _, rows = _rows(ws)
        assert "_wp12_hidden" in rows
    finally:
        ws.call("set", "hide_underscore_names", 1)
        ws.call("delete", "_wp12_hidden")


# ------------------------------------------------------------------- menus


def test_menu_dispatch_table_matches_CExecutive_click():
    """Every (row kind, button) pair, transcribed from `Executive.cpp:15012`."""
    assert panel.menu_name_for("all", "A") == "all_action"
    assert panel.menu_name_for("selection", "A") == "sele_action"
    assert panel.menu_name_for("object:group", "A") == "group_action"
    assert panel.menu_name_for("object:molecule", "A") == "mol_action"
    assert panel.menu_name_for("object:map", "A") == "map_action"
    assert panel.menu_name_for("object:surface", "A") == "surface_action"
    assert panel.menu_name_for("object:mesh", "A") == "mesh_action"
    assert panel.menu_name_for("object:slice", "A") == "slice_action"
    assert panel.menu_name_for("object:ramp", "A") == "ramp_action"
    for kind in ("object:measurement", "object:cgo", "object:callback",
                 "object:alignment", "object:volume"):
        assert panel.menu_name_for(kind, "A") == "simple_action"

    assert panel.menu_name_for("object:molecule", "S") == "mol_show"
    assert panel.menu_name_for("object:measurement", "S") == "measurement_show"
    assert panel.menu_name_for("object:cgo", "S") == "cgo_show"
    assert panel.menu_name_for("object:map", "H") == "map_hide"
    assert panel.menu_name_for("object:volume", "H") == "volume_hide"

    # L has NO menu for measurement/map/surface/mesh/slice (:15218-15227)
    for kind in ("object:measurement", "object:map", "object:surface",
                 "object:mesh", "object:slice"):
        assert panel.menu_name_for(kind, "L") is None
    assert panel.menu_name_for("object:molecule", "L") == "mol_labels"

    assert panel.menu_name_for("object:surface", "C") == "mesh_color"
    assert panel.menu_name_for("object:volume", "C") == "vol_color"
    assert panel.menu_name_for("object:ramp", "C") == "ramp_color"
    assert panel.menu_name_for("object:measurement", "C") == "measurement_color"

    assert panel.menu_name_for("all", "M") == "camera_motion"
    assert panel.menu_name_for("selection", "M") is None


def test_menu_argument_quirks():
    """The three places `MenuActivate` does NOT pass a plain name."""
    assert panel._menu_args("all", "all", "L") == ["(all)"]
    assert panel._menu_args("s", "object:surface", "C") == ["s", "surface"]
    assert panel._menu_args("all", "all", "M") == ["0"]
    assert panel._menu_args("m", "object:molecule", "M") == ["m", "0"]
    assert panel._menu_args("m", "object:molecule", "S") == ["m"]


def test_show_menu_is_pymol_menu_mol_show_verbatim(ws, scene):
    ws.do("/from tenmol_bridge.panels.objects import install;install()")
    payload = ws.call("tenmol_objects", "menu", PREFIX + "gly", "S")
    assert payload["menu"] == "mol_show"
    items = payload["items"]
    assert items[0] == {"code": 2, "text": "Show:", "path": [0], "command": ""}

    by_text = {item["text"]: item for item in items}
    # rep_action's leaves, including the two-space indents PyMOL draws
    assert by_text["wire"]["command"] == 'cmd.show("wire"      ,"%sgly")' % PREFIX
    assert by_text["  lines"]["command"] == 'cmd.show("lines"     ,"%sgly")' % PREFIX
    assert by_text["  nb_spheres"]["command"] == 'cmd.show("nb_spheres","%sgly")' % PREFIX
    assert by_text["cartoon"]["command"] == 'cmd.show("cartoon"   ,"%sgly")' % PREFIX
    assert by_text["valence"]["command"].startswith("cmd.set_bond(")
    # `as` is a submenu of show_as (menu.py:178-182)
    assert by_text["as"]["items"][1]["command"].startswith('cmd.show_as("wire"')
    # `flag ignore` is a submenu, `organic`/`main chain`/... are show_misc
    assert {"organic", "main chain", "side chain", "disulfides"} <= set(by_text)
    assert by_text["organic"]["items"][1]["command"].startswith('cmd.show("lines"')
    assert by_text["flag ignore"]["items"][1]["text"] == "clear"


def test_hide_menu_carries_everything_and_the_selection_expressions(ws, scene):
    ws.do("/from tenmol_bridge.panels.objects import install;install()")
    payload = ws.call("tenmol_objects", "menu", PREFIX + "gly", "H")
    assert payload["menu"] == "mol_hide"
    by_text = {item["text"]: item for item in payload["items"]}
    assert by_text["everything"]["command"] == 'cmd.hide("everything","%sgly")' % PREFIX
    assert by_text["waters"]["command"] == 'cmd.hide("(solvent and (%sgly))")' % PREFIX
    assert by_text["unselected"]["command"] == 'cmd.hide("(not %sgly)")' % PREFIX
    assert "byres" in by_text["main chain"]["command"]
    # `hydrogens` is a submenu (hide_hydro, menu.py:217-221)
    assert [i["text"] for i in by_text["hydrogens"]["items"]] == ["Hide:", "all", "nonpolar"]


def test_label_menu_and_the_all_row_passing_the_literal_all_selection(ws, scene):
    ws.do("/from tenmol_bridge.panels.objects import install;install()")
    payload = ws.call("tenmol_objects", "menu", PREFIX + "gly", "L")
    assert payload["menu"] == "mol_labels"
    by_text = {item["text"]: item for item in payload["items"]}
    assert by_text["clear"]["command"] == 'cmd.label("%sgly","\'\'")' % PREFIX
    assert by_text["b-factor"]["command"] == "cmd.label(\"%sgly\",\"'%%1.2f'%%b\")" % PREFIX
    assert "label_anchor" not in by_text["residues"]["command"]  # already resolved
    assert {"other properties", "atom identifiers"} <= set(by_text)

    # the `all` row passes "(all)" (Executive.cpp:15207)
    payload = ws.call("tenmol_objects", "menu", "all", "L", "all")
    assert 'cmd.label("(all)"' in payload["items"][1]["command"]


def test_colour_menu_carries_the_nine_named_groups_and_the_rgb_codes(ws, scene):
    ws.do("/from tenmol_bridge.panels.objects import install;install()")
    payload = ws.call("tenmol_objects", "menu", PREFIX + "gly", "C")
    assert payload["menu"] == "mol_color"
    texts = [item["text"] for item in payload["items"]]
    # the group titles carry `\RGB` escapes, so match on the readable tail
    assert any(t.endswith("reds") for t in texts)
    assert any(t.endswith("greens") for t in texts)
    assert any(t.endswith("grays") for t in texts)
    by_text = {item["text"]: item for item in payload["items"]}
    for label in ("by element", "by chain", "by ss  ", "by rep", "auto"):
        assert "items" in by_text[label], label
    # Each palette group is a submenu whose title is `\<code><group>` and whose
    # leaves are `\<code><colour>` (`all_colors_generic`, menu.py:625-637).
    reds = next(i for i in payload["items"] if i["text"].endswith("reds"))
    assert reds["text"] == "\\900reds"
    assert reds["items"][0] == {
        "code": 2, "text": "Reds", "path": reds["path"] + [0], "command": "",
    }
    red = next(i for i in reds["items"] if i["text"].endswith("red") and i["code"] == 1)
    assert red["text"] == "\\900red"
    assert red["command"] == "cmd.color_deep(\"red\", '%sgly', 0)" % PREFIX
    # 80 named colours over nine groups
    groups = [i for i in payload["items"] if i.get("items") and i["text"][:1] == "\\"]
    assert len(groups) >= 9


def test_action_menus_per_row_type(ws, scene):
    ws.do("/from tenmol_bridge.panels.objects import install;install()")
    assert ws.call("tenmol_objects", "menu", "all", "A", "all")["menu"] == "all_action"
    assert ws.call("tenmol_objects", "menu", PREFIX + "sel", "A")["menu"] == "sele_action"
    assert ws.call("tenmol_objects", "menu", PREFIX + "grp", "A")["menu"] == "group_action"
    mol = ws.call("tenmol_objects", "menu", PREFIX + "gly", "A")
    assert mol["menu"] == "mol_action"
    by_text = {item["text"]: item for item in mol["items"]}
    assert by_text["zoom"]["command"] == 'cmd.zoom("%sgly",animate=-1)' % PREFIX
    assert by_text["reset matrix"]["command"] == 'cmd.reset(object="%sgly")' % PREFIX
    # `\933delete object` — the red text colour code is preserved verbatim
    delete = next(i for i in mol["items"] if i["text"].endswith("delete object"))
    assert delete["text"].startswith("\\933")
    assert delete["command"] == 'cmd.delete("%sgly")' % PREFIX


def test_L_button_raises_for_the_row_types_that_have_no_label_menu(ws, scene):
    ws.do("/from tenmol_bridge.panels.objects import install;install()")
    reply = ws.call_reply("tenmol_objects", "menu", PREFIX + "gly", "L", "object:map")
    assert reply["t"] == "err"
    assert "no L menu" in reply["error"]["message"]


def test_lazy_submenus_are_marked_and_expand_resolves_them(ws, scene):
    """`lambda: copy_to(...)` / `lambda: move_to_group(...)` — SubGetItem."""
    ws.do("/from tenmol_bridge.panels.objects import install;install()")
    payload = ws.call("tenmol_objects", "menu", PREFIX + "gly", "A")
    lazy = [item for item in payload["items"] if item.get("lazy")]
    assert [item["text"] for item in lazy] == ["copy to object", "group"]
    assert all("items" not in item for item in lazy)

    group = next(item for item in lazy if item["text"] == "group")
    resolved = ws.call(
        "tenmol_objects", "expand", PREFIX + "gly", "A", group["path"]
    )
    texts = [item["text"] for item in resolved["items"]]
    assert texts[0] == "Move to Group:"
    assert "ungroup" in texts
    assert PREFIX + "grp" in texts  # the live group list, not a hardcoded one

    copy_to = next(item for item in lazy if item["text"] == "copy to object")
    resolved = ws.call(
        "tenmol_objects", "expand", PREFIX + "gly", "A", copy_to["path"]
    )
    assert resolved["items"][0]["text"] == "Copy To:"
    assert any(item["text"] == PREFIX + "trp" for item in resolved["items"])


def test_expand_refuses_a_path_that_is_not_a_lazy_submenu(ws, scene):
    ws.do("/from tenmol_bridge.panels.objects import install;install()")
    reply = ws.call_reply("tenmol_objects", "expand", PREFIX + "gly", "A", [1])
    assert reply["t"] == "err"
    assert "lazy" in reply["error"]["message"]


def test_motion_menus(ws, scene):
    ws.do("/from tenmol_bridge.panels.objects import install;install()")
    camera = ws.call("tenmol_objects", "menu", "all", "M", "all")
    assert camera["menu"] == "camera_motion"
    by_text = {item["text"]: item for item in camera["items"]}
    assert by_text["store"]["command"] == 'cmd.mview("store",first=0)'
    assert by_text["interpolate"]["command"] == 'cmd.mview("interpolate")'
    assert "items" in by_text["store with scene"]

    obj = ws.call("tenmol_objects", "menu", PREFIX + "gly", "M")
    assert obj["menu"] == "obj_motion"
    by_text = {item["text"]: item for item in obj["items"]}
    assert by_text["drag"]["command"] == 'cmd.drag("%sgly")' % PREFIX
    assert by_text["store"]["command"] == (
        'cmd.mview("store",object="%sgly",first=0)' % PREFIX
    )


def test_menu_leaves_are_command_strings_that_cmd_do_actually_runs(ws, scene):
    """The whole point of `[code,text,command]`: `PopUp.cpp:471-475` PParses it."""
    ws.do("/from tenmol_bridge.panels.objects import install;install()")
    payload = ws.call("tenmol_objects", "menu", PREFIX + "gly", "H")
    hide_everything = next(i for i in payload["items"] if i["text"] == "everything")
    ws.do(hide_everything["command"])
    vis = ws.call("get_vis")
    assert vis[PREFIX + "gly"][2] in (None, [])

    payload = ws.call("tenmol_objects", "menu", PREFIX + "gly", "S")
    show_sticks = next(i for i in payload["items"] if i["text"] == "  sticks")
    ws.do(show_sticks["command"])
    vis = ws.call("get_vis")
    assert vis[PREFIX + "gly"][2]  # something is on again


# ------------------------------------------------------- panel-only helpers


def test_object_type_table_covers_every_cObject_t_value():
    """`packages/engine/layer1/PyMOLObject.h:40-56` — a missing entry would silently type a row
    as a molecule and open the wrong menu."""
    assert sorted(panel.OBJECT_TYPES) == list(range(1, 16))
    assert panel.OBJECT_TYPES[12] == "object:group"
    assert panel.OBJECT_TYPES[8] == "object:ramp"


def test_rep_bitmask_round_trips_the_index_list():
    assert panel._rep_bitmask(None) == 0
    assert panel._rep_bitmask([]) == 0
    assert panel._rep_bitmask([0, 1]) == 0b11
    assert panel._rep_bitmask([4]) == 16
    assert panel._rep_bitmask([31, 99]) == 0  # out of range, never wraps


def test_snapshot_is_cheap_enough_to_poll(ws, scene):
    """It replaces a 30 Hz two-call poll, so it has to cost about the same."""
    import time

    ws.do("/from tenmol_bridge.panels.objects import install;install()")
    ws.call("tenmol_objects", "snapshot")
    start = time.monotonic()
    for _ in range(20):
        ws.call("tenmol_objects", "snapshot")
    per_call_ms = (time.monotonic() - start) * 1000 / 20
    assert per_call_ms < 25, "snapshot round trip %.2f ms" % per_call_ms
    print("wp12 snapshot round trip: %.2f ms" % per_call_ms, file=sys.stderr)


def test_every_per_type_menu_provider_builds(ws, scene):
    """One row per `CExecutive::click` case, for all six buttons.

    The object types the panel dispatches on cannot all be created in a headless
    session (a map needs a density file, a ramp needs a map), but the menu
    providers take only the NAME — `mesh_color(cmd, name, rep)`,
    `volume_show(cmd, sele)` and the rest never touch the object.  Passing the
    row kind explicitly therefore exercises the real provider for every type,
    which is what this asserts: no dispatch entry names a `pymol.menu` function
    that does not exist or cannot be serialised.
    """
    ws.do("/from tenmol_bridge.panels.objects import install;install()")
    kinds = [
        "all", "selection", "object:group", "object:molecule", "object:map",
        "object:mesh", "object:surface", "object:slice", "object:volume",
        "object:measurement", "object:cgo", "object:alignment",
        "object:callback", "object:ramp",
    ]
    built = {}
    for kind in kinds:
        for op in "ASHLCM":
            expected = panel.menu_name_for(kind, op)
            if expected is None:
                continue
            name = "all" if kind == "all" else PREFIX + "gly"
            reply = ws.call_reply("tenmol_objects", "menu", name, op, kind)
            assert reply["t"] == "ok", (kind, op, reply)
            payload = reply["result"]
            assert payload["menu"] == expected, (kind, op)
            if expected == "slice_color":
                # `slice_color` IS `colorramps` (menu.py:655-657): one row per
                # object:ramp and nothing else, so an empty list is the correct
                # answer in a session with no ramps.
                assert payload["items"] == [], (kind, op)
            else:
                assert payload["items"], (kind, op)
                assert payload["items"][0]["code"] == 2, (kind, op)  # title row
            built[(kind, op)] = payload["menu"]
    # every colour variant really is a different provider
    assert built[("object:mesh", "C")] == "mesh_color"
    assert built[("object:surface", "C")] == "mesh_color"
    assert built[("object:volume", "C")] == "vol_color"
    assert built[("object:slice", "C")] == "slice_color"
    assert built[("object:map", "C")] == "general_color"
    assert built[("object:ramp", "C")] == "ramp_color"
    assert len(built) == 63  # 84 (kind,button) pairs minus the 21 PyMOL leaves inert


def test_caption_marks_a_discrete_object_with_993(ws, scene):
    """`I->DiscreteFlag` -> `\\993` (ObjectMolecule.cpp:406-409)."""
    ws.do("/from tenmol_bridge.panels.objects import install;install()")
    ws.call("delete", PREFIX + "disc")
    ws.call("create", PREFIX + "disc", PREFIX + "gly", 1, 1, discrete=1)
    try:
        assert ws.call("count_discrete", PREFIX + "disc")
        _, rows = _rows(ws)
        assert rows[PREFIX + "disc"]["caption"] == "\\9931/1"
    finally:
        ws.call("delete", PREFIX + "disc")
