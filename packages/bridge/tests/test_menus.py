"""The menu bar (WP-14): harvest fidelity, wire reachability, generated drift.

Three groups:

1. **Pure harvest** — no engine.  ``panels/menus.py`` walks the real upstream
   literal ``PyMOLDesktopGUI.get_menudata`` (``packages/engine/modules/pymol/_gui.py:55``), so
   these tests are assertions about PyMOL itself: if upstream edits a menu, they
   fail here rather than silently desynchronising the browser.

2. **Generated drift** — the client's checked-in tree must be byte-identical to
   a fresh harvest.  This is the whole safety net behind shipping a generated
   file instead of a live endpoint.

3. **Wire reachability** — every symbol the harvest emits must actually resolve
   through the real dispatcher/policy, and every setting a check/radio binds to
   must answer ``cmd.get_setting_tuple`` over a real WebSocket.  A menu whose
   items are shaped correctly but whose calls are refused by the policy is not
   a menu.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any, Dict, Iterator, List, Tuple

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tenmol_bridge.panels import menus  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
GENERATED = os.path.join(
    REPO, "apps", "web", "src", "features", "menubar", "generated", "menudata.ts"
)


@pytest.fixture(scope="module")
def tree() -> Dict[str, Any]:
    return menus.harvest()


def walk(nodes: List[Dict[str, Any]], path: str = "") -> Iterator[Tuple[str, Dict[str, Any]]]:
    for node in nodes:
        here = "%s/%s" % (path, node.get("label", node["kind"]))
        yield here, node
        for child in node.get("items", ()):
            yield from walk([child], here)


def find(tree: Dict[str, Any], path: str) -> Dict[str, Any]:
    for here, node in walk(tree["menus"]):
        if here == path:
            return node
    raise AssertionError("no menu node at %r" % path)


def children(tree: Dict[str, Any], path: str) -> List[Dict[str, Any]]:
    return list(find(tree, path)["items"])


# ---------------------------------------------------------------- 1. harvest


def test_eleven_top_level_menus_in_order(tree: Dict[str, Any]) -> None:
    assert [m["label"] for m in tree["menus"]] == [
        "File", "Edit", "Build", "Movie", "Display",
        "Setting", "Scene", "Mouse", "Wizard", "Plugin", "Help",
    ]
    assert all(m["kind"] == "submenu" for m in tree["menus"])


def test_every_leaf_resolved_to_data(tree: Dict[str, Any]) -> None:
    """No callable survives the harvest, and nothing is dropped or unparsable."""
    dropped = [
        (path, node["action"]["reason"])
        for path, node in walk(tree["menus"])
        if node["kind"] == "command" and node["action"]["type"] == "dropped"
    ]
    errors = [path for path, node in walk(tree["menus"]) if node["kind"] == "error"]
    assert dropped == [], dropped
    assert errors == [], errors
    # The whole tree must be JSON — that is the point of the recorder.
    json.dumps(tree)


def test_node_census(tree: Dict[str, Any]) -> None:
    counts: Dict[str, int] = {}
    for _, node in walk(tree["menus"]):
        counts[node["kind"]] = counts.get(node["kind"], 0) + 1
    # Guards against a walk that silently stops recursing.
    assert counts == {
        "submenu": 106,
        "command": 388,
        "separator": 86,
        "radio": 205,
        "check": 68,
        "dynamic": 1,
    }
    assert sum(counts.values()) == 854


def test_edit_menu_is_exactly_undo_redo(tree: Dict[str, Any]) -> None:
    items = children(tree, "/Edit")
    assert [i["label"] for i in items] == ["Undo [Ctrl-Z]", "Redo [Ctrl-Y]"]
    assert [i["accel"] for i in items] == ["Ctrl-Z", "Ctrl-Y"]
    assert items[0]["action"] == {
        "type": "call",
        "calls": [{"fn": "cmd.undo", "args": [], "kwargs": {}}],
    }


def test_command_strings_stay_strings(tree: Dict[str, Any]) -> None:
    """`('command', label, str)` -> cmd.do(str), verbatim (`_addmenu`)."""
    frag = children(tree, "/Build/Fragment")
    assert len(frag) == 20
    assert frag[0]["action"] == {
        "type": "do",
        "command": "editor.attach_fragment('pk1','acetylene',2,0)",
    }
    labels = [f["label"] for f in frag]
    # The upstream typo is preserved verbatim rather than silently corrected.
    assert "Sulfer [Ctrl-Shift-S]" in labels
    assert find(tree, "/Build/Fragment/Bromine [Ctrl-Shift-B]")["accel"] == "Ctrl-Shift-B"


def test_residue_submenu_is_23_amino_acids_plus_3_ss_radios(tree: Dict[str, Any]) -> None:
    items = children(tree, "/Build/Residue")
    commands = [i for i in items if i["kind"] == "command"]
    radios = [i for i in items if i["kind"] == "radio"]
    assert len(commands) == 23
    assert len(radios) == 3
    assert commands[1]["action"]["calls"][0] == {
        "fn": "cmd.editor.attach_amino_acid",
        "args": ["pk1", "ala"],
        "kwargs": {},
    }
    assert [(r["label"], r["value"]) for r in radios] == [
        ("Helix", 1),
        ("Antiparallel Beta Sheet", 2),
        ("Parallel Beta Sheet", 3),
    ]
    assert {r["setting"] for r in radios} == {"secondary_structure"}


def test_check_uses_the_len_greater_than_four_rule(tree: Dict[str, Any]) -> None:
    """`_addmenu` tests `len(item) > 4`, so a 4-tuple does NOT set true_value."""
    # ('check', 'Specular Reflections', 'specular', 1.0)  -> 4-tuple
    specular = find(tree, "/Display/Specular Reflections")
    assert (specular["trueValue"], specular["falseValue"]) == (1, 0)
    # ('check', 'Highlight Color', 'cartoon_highlight_color', 104, -1) -> 5-tuple
    highlight = find(tree, "/Setting/Cartoon/Highlight Color")
    assert (highlight["trueValue"], highlight["falseValue"]) == (104, -1)
    # a string setting
    assembly = find(tree, "/Setting/mmCIF File Loading/Load Assembly (Biological Unit)")
    assert (assembly["trueValue"], assembly["falseValue"]) == ("1", "")
    interior = find(tree, "/Setting/Rendering/Opaque Interiors")
    assert (interior["trueValue"], interior["falseValue"]) == (74, -1)
    classified = find(tree, "/Setting/Auto-Show .../Cartoon/Sticks/Spheres by Classification")
    assert (classified["trueValue"], classified["falseValue"]) == (-1, 0)


def test_scene_f_keys_are_generated_twelve_times_three(tree: Dict[str, Any]) -> None:
    for action in ("recall", "store", "clear"):
        items = children(tree, "/Scene/" + action.capitalize())
        assert [i["label"] for i in items] == ["F%d" % i for i in range(1, 13)]
        assert items[0]["action"]["calls"][0] == {
            "fn": "cmd.scene",
            "args": ["F1", action],
            "kwargs": {},
        }


def test_transparency_composites_record_three_sets(tree: Dict[str, Any]) -> None:
    uni = find(tree, "/Setting/Transparency/Uni-Layer")
    assert [(c["fn"], c["args"]) for c in uni["action"]["calls"]] == [
        ("cmd.set", ["transparency_mode", 2]),
        ("cmd.set", ["backface_cull", 1]),
        ("cmd.set", ["two_sided_lighting", 0]),
    ]
    assert all(c["kwargs"] == {"quiet": 0} for c in uni["action"]["calls"])


def test_self_argument_is_dropped(tree: Dict[str, Any]) -> None:
    """`cmd.util.modernize_rendering(1, cmd)` passes `cmd` as `_self`."""
    node = find(tree, "/Setting/Rendering/Modernize")
    call = node["action"]["calls"][0]
    assert call["fn"] == "cmd.util.modernize_rendering"
    assert call["args"] == [1]
    assert call["selfArg"] is True


def test_movie_program_leaves_are_mvprg_hooks(tree: Dict[str, Any]) -> None:
    node = find(tree, "/Movie/Program/Camera Loop/Nutate/15 deg. over 4 sec.")
    assert node["action"] == {
        "type": "hook",
        "hook": "mvprg",
        "args": ["movie.add_nutate(4,15,start=%d)"],
    }
    # 180 degrees is written 179.99 upstream; that must survive verbatim.
    rock = find(tree, "/Movie/Program/Camera Loop/X-Rock/180 deg. over 12 sec.")
    assert "179.99" in rock["action"]["args"][0]
    # State Loop / State Sweep: 6 speeds x 4 pauses = 24 leaves each.
    for label in ("State Loop", "State Sweep"):
        speeds = children(tree, "/Movie/Program/" + label)
        assert len(speeds) == 6
        assert sum(len(s["items"]) for s in speeds) == 24
    assert find(tree, "/Movie/Update Last Program")["action"]["args"] == [None]
    assert find(tree, "/Movie/Remove Last Program")["action"]["hook"] == "mvprg_remove_last"


def test_help_menu_is_urls_plus_about(tree: Dict[str, Any]) -> None:
    urls = [
        node["action"]["url"]
        for _, node in walk(children(tree, "/Help"))
        if node["kind"] == "command" and node["action"]["type"] == "url"
    ]
    # NOTE: feature-parity.md says "11 `webbrowser.open` entries"; the real
    # count is TWELVE (3 site links + 3 doc links + 3 Topics + mailing list +
    # sponsorship + citing).  The tree is the authority, not the inventory.
    assert len(urls) == 12
    assert "http://www.pymol.org" in urls
    assert "https://pymolwiki.org/index.php/Selection_Algebra" in urls
    assert find(tree, "/Help/About PyMOL")["action"] == {"type": "hook", "hook": "show_about"}


def test_wizard_menu(tree: Dict[str, Any]) -> None:
    demos = children(tree, "/Wizard/Demo")
    commands = [d for d in demos if d["kind"] == "command"]
    assert len(commands) == 12  # 11 demos + End Demonstration
    assert commands[0]["action"]["calls"][0]["args"] == ["demo", "reps"]
    assert commands[-1]["action"]["calls"][0] == {
        "fn": "cmd.replace_wizard",
        "args": ["demo", "finish"],
        "kwargs": {},
    }
    assert find(tree, "/Wizard/Appearance")["action"] == {
        "type": "do",
        "command": "wizard appearance",
    }


def test_mouse_menu(tree: Dict[str, Any]) -> None:
    modes = children(tree, "/Mouse/Selection Mode")
    assert [(m["label"], m["value"]) for m in modes] == [
        ("Atoms", 0), ("Residues", 1), ("Chains", 2), ("Segments", 3),
        ("Objects", 4), ("Molecules", 5), ("C-alphas", 6),
    ]
    assert {m["setting"] for m in modes} == {"mouse_selection_mode"}
    ring = find(tree, "/Mouse/3 Button Motions")["action"]["calls"][0]
    assert ring == {"fn": "cmd.config_mouse", "args": ["three_button_motions"], "kwargs": {}}
    internal = find(tree, "/Mouse/3 Button Viewing")["action"]["calls"][0]
    assert internal["fn"] == "cmd.mouse"  # INTERNAL, controlling.py:609


def test_open_recent_marker_becomes_a_dynamic_node(tree: Dict[str, Any]) -> None:
    node = find(tree, "/File/Open Recent...")
    assert node == {"kind": "dynamic", "label": "Open Recent...", "source": "open_recent"}


def test_toolkit_seams_become_named_hooks(tree: Dict[str, Any]) -> None:
    assert find(tree, "/File/Open...")["action"] == {"type": "hook", "hook": "file_open"}
    assert find(tree, "/File/Quit")["action"] == {"type": "hook", "hook": "confirm_quit"}
    # NOT declared as `= None` on the base class -- `__getattr__` has to catch it.
    assert find(tree, "/Scene/Scenes...")["action"]["hook"] == "scene_panel_menu_dialog"
    assert find(tree, "/File/New PyMOL Window/Default")["action"] == {
        "type": "hook",
        "hook": "new_window",
        "args": [[]],
    }
    assert find(tree, "/File/New PyMOL Window/Ignore .pymolrc and plugins (-k)")["action"][
        "args"
    ] == [["-k"]]


def test_settings_list_is_complete_and_deduplicated(tree: Dict[str, Any]) -> None:
    seen = [
        node["setting"]
        for _, node in walk(tree["menus"])
        if node["kind"] in ("check", "radio")
    ]
    assert tree["settings"] == list(dict.fromkeys(seen))
    assert len(tree["settings"]) == len(set(tree["settings"]))
    for name in ("seq_view", "bg_rgb", "assembly", "sculpt_field_mask", "movie_fps"):
        assert name in tree["settings"]


def test_harvest_is_deterministic() -> None:
    assert menus.harvest() == menus.harvest()


def test_none_action_is_reported_not_silently_lost() -> None:
    """`('command', label, None)` -> Qt prints 'warning: skipping' and drops it."""
    assert menus._classify(None, [], [], []) == {
        "type": "dropped",
        "reason": "action is None",
    }


def test_truncate_recent_label() -> None:
    assert menus.truncate_recent_label("/tmp/x.pdb") == "/tmp/x.pdb"
    short = "/" + "a" * 126  # len 127 -> untouched
    assert menus.truncate_recent_label(short) == short
    long = "/" + "b" * 200
    assert menus.truncate_recent_label(long) == "..." + long[-120:]
    assert len(menus.truncate_recent_label(long)) == 123


def test_recent_files_roundtrip(tmp_path: Any, monkeypatch: Any) -> None:
    """The sqlite DB stays SERVER side (`~/.pymol/recent.db`, `_gui.py:975`)."""
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setattr(os.path, "expanduser", lambda p: p.replace("~", str(tmp_path)))
    assert menus.recent_files() == []
    menus.add_recent_file("/tmp/first.pdb")
    menus.add_recent_file("/tmp/second.pdb")
    assert set(menus.recent_files()) == {"/tmp/first.pdb", "/tmp/second.pdb"}
    assert os.path.isfile(os.path.join(str(tmp_path), ".pymol", "recent.db"))


# ------------------------------------------------------- 2. generated drift


def test_generated_typescript_matches_a_fresh_harvest() -> None:
    assert os.path.isfile(GENERATED), (
        "the client's generated menu tree is missing; regenerate with\n    %s" % menus.GENERATOR
    )
    with open(GENERATED, encoding="utf-8") as handle:
        on_disk = handle.read()
    assert on_disk == menus.to_typescript(), (
        "apps/web/.../generated/menudata.ts has drifted from packages/engine/modules/pymol/_gui.py.\n"
        "Regenerate with:\n    %s" % menus.GENERATOR
    )


def test_generated_typescript_is_byte_stable() -> None:
    assert menus.to_typescript() == menus.to_typescript()


# ---------------------------------------------------- 3. wire reachability


def test_every_symbol_the_menu_emits_is_allowed_by_the_policy(
    tree: Dict[str, Any], bridge: Any
) -> None:
    symbols = sorted(
        {
            call["fn"]
            for _, node in walk(tree["menus"])
            if node["kind"] == "command" and node["action"]["type"] == "call"
            for call in node["action"]["calls"]
        }
    )
    assert len(symbols) >= 12
    refused = [
        (symbol, bridge.server.policy.check(symbol).reason)
        for symbol in symbols
        if not bridge.server.policy.check(symbol).allowed
    ]
    assert refused == [], refused


def test_every_symbol_the_menu_emits_resolves_in_the_engine(
    tree: Dict[str, Any], bridge: Any
) -> None:
    """Resolution only — nothing is executed, so no engine state changes."""
    symbols = sorted(
        {
            call["fn"]
            for _, node in walk(tree["menus"])
            if node["kind"] == "command" and node["action"]["type"] == "call"
            for call in node["action"]["calls"]
        }
    )
    dispatcher = bridge.server.dispatcher

    def probe(engine: Any) -> List[str]:
        bad: List[str] = []
        for symbol in symbols:
            try:
                dispatcher.resolve(engine, symbol)
            except Exception as exc:  # noqa: BLE001
                bad.append("%s: %s" % (symbol, exc))
        return bad

    assert bridge.pump.call(probe, timeout=60.0) == []


def test_every_menu_setting_answers_get_setting_tuple(tree: Dict[str, Any], ws: Any) -> None:
    """This is what drives every checkmark and radio dot in the bar."""
    bad = []
    for name in tree["settings"]:
        reply = ws.call_reply("cmd.get_setting_tuple", name)
        if reply["t"] != "ok" or not isinstance(reply["result"], list):
            bad.append((name, reply))
    assert bad == [], bad[:5]


def test_a_check_item_round_trips_through_the_wire(ws: Any) -> None:
    """set -> get_setting_tuple, i.e. the exact loop a checkmark rides."""
    before = ws.call("cmd.get_setting_tuple", "cartoon_fancy_helices")
    original = before[1][0]
    try:
        ws.call("cmd.set", "cartoon_fancy_helices", 1, log=1, quiet=0)
        assert ws.call("cmd.get_setting_tuple", "cartoon_fancy_helices")[1][0] == 1
        ws.call("cmd.set", "cartoon_fancy_helices", 0, log=1, quiet=0)
        assert ws.call("cmd.get_setting_tuple", "cartoon_fancy_helices")[1][0] == 0
    finally:
        ws.call("cmd.set", "cartoon_fancy_helices", original, quiet=1)


def test_bg_rgb_is_a_COLOR_setting_not_float3(ws: Any) -> None:
    """MEASURED CORRECTION to the area docs.

    `feature-parity.md` and `qt-main-window.md` describe the Display >
    Background radios (White 0 / Light Grey 134 / Grey 104 / Black 1) as if
    `bg_rgb` were a float3 whose first component Qt compares.  It is not: this
    build reports type 5 (cSetting_color) and `get_setting_tuple` returns a
    ONE-element tuple holding the colour INDEX, which is exactly what those
    radio values are (`_gui.py:404-410` annotates them `# white`, `# grey80`,
    `# grey50`, `# black`).  So `values[0] == value` compares indices and the
    radios tick correctly.
    """
    before = ws.call("cmd.get_setting_tuple", "bg_rgb")
    assert before[0] == 5
    assert len(before[1]) == 1
    original = before[1][0]
    try:
        ws.call("cmd.set", "bg_rgb", 104, log=1, quiet=0)  # grey50
        assert ws.call("cmd.get_setting_tuple", "bg_rgb")[1][0] == 104
        ws.call("cmd.set", "bg_rgb", 1, log=1, quiet=0)  # black
        assert ws.call("cmd.get_setting_tuple", "bg_rgb")[1][0] == 1
    finally:
        ws.call("cmd.set", "bg_rgb", original, quiet=1)


def test_settings_helper_reads_live_values(tree: Dict[str, Any], bridge: Any) -> None:
    names = tree["settings"][:20]
    values = bridge.pump.call(
        lambda engine: menus.settings(engine.cmd, names), timeout=60.0
    )
    assert set(values) == set(names)
    assert all("error" not in v for v in values.values()), values


def test_a_command_string_leaf_executes(tree: Dict[str, Any], ws: Any) -> None:
    """`('command', label, str)` really is a runnable PyMOL command line."""
    node = find(tree, "/Build/Fragment/Methane [Ctrl-Shift-M]")
    assert node["action"]["type"] == "do"
    ws.do("delete all")
    reply = ws.do("fragment ala")
    assert reply["t"] == "ok"
    reply = ws.do(node["action"]["command"])
    assert reply["t"] == "ok", reply
    ws.do("delete all")


# ------------------------------------------- 4. the bound wire endpoint


def test_bootstrap_binds_the_endpoint_and_serves_the_tree(tree: Dict[str, Any], ws: Any) -> None:
    """The whole client handshake, over a real socket.

    `panels/*.py` modules have no `_bridge.*` route (``server.py`` owns that
    table), so they bind themselves onto the live ``cmd``: one ``{t:'do'}`` with
    a leading ``/`` (PyMOL's "rest of the line is Python" escape,
    ``packages/engine/modules/pymol/parser.py``), then ordinary ``{t:'call'}`` frames against a
    one-segment symbol, which needs no policy grant.
    """
    # Before the bootstrap the symbol genuinely does not exist.
    ws.request(t="call", fn=menus.ATTRIBUTE, args=["menus"], kwargs={})

    reply = ws.do(menus.BOOTSTRAP)
    assert reply["t"] == "ok", reply

    payload = ws.call(menus.ATTRIBUTE, "menus")
    assert [m["label"] for m in payload["menus"]] == [
        m["label"] for m in tree["menus"]
    ]
    assert payload["settings"] == tree["settings"]
    assert payload["schema"] == menus.SCHEMA_VERSION


def test_settings_verb_answers_every_menu_setting_in_one_round_trip(
    tree: Dict[str, Any], ws: Any
) -> None:
    ws.do(menus.BOOTSTRAP)
    values = ws.call(menus.ATTRIBUTE, "settings")
    assert set(values) == set(tree["settings"])
    assert all("error" not in v for v in values.values())
    assert values["bg_rgb"]["type"] == 5
    assert isinstance(values["assembly"]["value"], str)
    # and a scoped request
    subset = ws.call(menus.ATTRIBUTE, "settings", ["seq_view", "movie_fps"])
    assert set(subset) == {"seq_view", "movie_fps"}


def test_recent_verb_round_trips_over_the_wire(ws: Any, tmp_path: Any) -> None:
    """Open Recent is backed by server-side sqlite, so it survives the browser."""
    ws.do(menus.BOOTSTRAP)
    marker = os.path.join(str(tmp_path), "wp14-recent-probe.pdb")
    after = ws.call(menus.ATTRIBUTE, "recent_add", marker)
    assert marker in after
    assert marker in ws.call(menus.ATTRIBUTE, "recent")


def test_unknown_verb_is_an_error_not_a_silent_none(ws: Any) -> None:
    ws.do(menus.BOOTSTRAP)
    reply = ws.call_reply(menus.ATTRIBUTE, "nope")
    assert reply["t"] == "err"
    assert "unknown" in json.dumps(reply["error"])


def test_the_endpoint_symbol_passes_the_policy_with_no_grant(bridge: Any) -> None:
    decision = bridge.server.policy.check(menus.ATTRIBUTE)
    assert decision.allowed, decision.reason
