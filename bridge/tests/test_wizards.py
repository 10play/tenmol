"""WP-16 — the wizard protocol, end to end through the real bridge.

Everything here goes over the WebSocket against a live PyMOL, because the whole
claim of this work package is "port the protocol once and 26 wizards render for
free".  That claim is only tested by launching the real wizards.
"""

from __future__ import annotations

import pytest

from tenmol_bridge.panels import wizards as service
from tenmol_bridge.policy import build_policy


# ---------------------------------------------------------------------------
# pure, no engine
# ---------------------------------------------------------------------------


def test_event_bits_match_the_python_and_c_tables():
    # modules/pymol/wizard/__init__.py:6-15 == layer1/Wizard.cpp:49-58
    assert service.EVENT_BITS == {
        "pick": 1,
        "select": 2,
        "key": 4,
        "special": 8,
        "scene": 16,
        "state": 32,
        "frame": 64,
        "dirty": 128,
        "view": 256,
        "position": 512,
    }


def test_panel_rows_tolerate_none_empty_and_short_rows():
    # dragging.py:104 returns None; message.py:36 returns [].
    assert service._panel_rows(None) == []
    assert service._panel_rows([]) == []
    # Wizard.cpp:241 requires >= 3 items; a 2-item row is dropped, extras ignored.
    rows = service._panel_rows([[1, "t"], [2, "Go", "cmd.x()", "extra"]])
    assert len(rows) == 1
    assert rows[0]["type"] == 2
    assert rows[0]["kind"] == "button"
    assert rows[0]["code"] == "cmd.x()"


def test_panel_rows_keep_blank_spacers():
    # security.py:37-45 uses [1,'',''] spacer rows between the buttons.
    rows = service._panel_rows([[1, "", ""], [0, "", ""]])
    assert [row["kind"] for row in rows] == ["text", "blank"]


def test_encode_menu_shapes():
    budget = [service.MAX_MENU_ITEMS]
    items = service._encode_menu(
        [
            [2, "Title", ""],
            [0, "ignored", "ignored"],
            [1, "Leaf", "cmd.get_wizard().set_mode(0)"],
            [1, "Sub", [[1, "Inner", "cmd.x()"]]],
        ],
        0,
        budget,
    )
    assert [i["kind"] for i in items] == ["title", "separator", "item", "item"]
    assert "command" not in items[0]  # code 2 -> the third element is skipped
    assert items[1]["text"] == ""  # code 0 -> text is ignored
    assert items[2]["command"] == "cmd.get_wizard().set_mode(0)"
    assert items[3]["submenu"][0]["command"] == "cmd.x()"


def test_encode_menu_resolves_a_lazy_callable_submenu():
    # layer4/PopUp.cpp:88-105 SubGetItem: a non-list third element is CALLED.
    # A callable cannot be serialized, so the bridge must resolve it.
    calls = []

    def lazy():
        calls.append(1)
        return [[1, "Late", "cmd.late()"]]

    items = service._encode_menu([[1, "Store...", lazy]], 0, [100])
    assert calls == [1]
    assert items[0]["submenu"][0]["command"] == "cmd.late()"


def test_encode_menu_budget_is_bounded():
    huge = [[1, "x", "cmd.x()"]] * 50
    items = service._encode_menu(huge, 0, [10])
    assert len(items) == 10


def test_grant_registers_the_service_and_the_root():
    policy = build_policy()
    assert "wizards" in policy.roots
    for leaf in ("probe", "snapshot", "menu", "exec_code", "event", "launch"):
        policy.check("wizards." + leaf).raise_if_denied()
    # exec_code runs arbitrary command language and says so.
    assert policy.check("wizards.exec_code").dangerous
    assert policy.check("wizards.exec_code").invalidates == ("resync",)


def test_the_module_is_addressable_as_pymol_wizards():
    import sys

    build_policy()  # loads the grant, which seeds sys.modules
    assert sys.modules.get("pymol.wizards") is service
    assert __import__("pymol.wizards", fromlist=["__name__"]) is service


# ---------------------------------------------------------------------------
# against the engine
# ---------------------------------------------------------------------------


@pytest.fixture
def clean_wizards(ws):
    ws.call("wizards.dismiss", all=True)
    yield ws
    ws.call("wizards.dismiss", all=True)


def test_probe_is_empty_with_no_wizard(clean_wizards):
    probe = clean_wizards.call("wizards.probe")
    assert probe["depth"] == 0
    assert probe["cls"] is None
    snap = clean_wizards.call("wizards.snapshot")
    assert snap["panel"] == [] and snap["prompt"] == [] and snap["depth"] == 0


def test_measurement_panel_prompt_and_menus(clean_wizards):
    ws = clean_wizards
    ws.call("wizards.launch", "measurement")
    snap = ws.call("wizards.snapshot")

    assert snap["cls"] == "Measurement"
    assert snap["module"] == "pymol.wizard.measurement"
    assert snap["depth"] == 1
    # measurement.py:195-203 — 6 rows, title / 2 popups / 3 buttons.
    assert [row["kind"] for row in snap["panel"]] == [
        "text",
        "popup",
        "popup",
        "button",
        "button",
        "button",
    ]
    assert snap["panel"][0]["text"] == "Measurement"
    assert snap["panel"][-1]["code"] == "cmd.set_wizard()"
    assert snap["prompt"]  # 'Please click on the first atom...'
    # measurement.py:101-106 -> pick | select | dirty
    assert snap["eventMask"] == 1 + 2 + 128
    assert "do_pick" in snap["methods"] and "do_pick_state" in snap["methods"]

    mode = ws.call("wizards.menu", "mode")["items"]
    labels = [i["text"] for i in mode if i["kind"] == "item"]
    assert "Distances" in labels and "Polar Contacts" in labels
    # The three neighbour modes carry a nested submenu (measurement.py:130-137).
    assert any("submenu" in i for i in mode)

    assert ws.call("wizards.menu", "no_such_tag")["items"] is None


def test_panel_button_code_executes_server_side(clean_wizards):
    ws = clean_wizards
    ws.call("wizards.launch", "measurement")
    before = ws.call("wizards.snapshot")
    assert before["panel"][1]["text"] == "Distances"

    # The command string comes from the wizard's own menu; the client never
    # interprets it (layer1/Wizard.cpp:573-577 PParse).
    mode = ws.call("wizards.menu", "mode")["items"]
    angles = next(i for i in mode if i["text"] == "Angles")
    ws.call("wizards.exec_code", angles["command"])

    after = ws.call("wizards.snapshot")
    assert after["panel"][1]["text"] == "Angles"
    assert after["version"] > before["version"]


def test_refresh_wizard_bumps_the_version_counter(clean_wizards):
    ws = clean_wizards
    ws.call("wizards.launch", "label")
    first = ws.call("wizards.probe")
    ws.call("wizards.exec_code", "cmd.get_wizard().toggle_messages()")
    second = ws.call("wizards.probe")
    assert second["version"] > first["version"]
    # ... and the panel text really changed (label.py:70-77).
    snap = ws.call("wizards.snapshot")
    assert snap["panel"][2]["text"] == "Messages: Off"


def test_stack_push_pop_and_cleanup(clean_wizards):
    ws = clean_wizards
    ws.call("wizards.launch", "label")
    ws.call("wizards.launch", "charge")
    probe = ws.call("wizards.probe")
    assert probe["depth"] == 2 and probe["cls"] == "Charge"
    snap = ws.call("wizards.snapshot")
    assert [entry["cls"] for entry in snap["stack"]] == ["Label", "Charge"]

    ws.call("wizards.dismiss")
    assert ws.call("wizards.probe")["cls"] == "Label"
    ws.call("wizards.dismiss")
    assert ws.call("wizards.probe")["depth"] == 0


def test_replace_swaps_the_top_of_the_stack(clean_wizards):
    ws = clean_wizards
    ws.call("wizards.launch", "label")
    ws.call("wizards.replace", "charge")
    probe = ws.call("wizards.probe")
    assert probe["depth"] == 1 and probe["cls"] == "Charge"


def test_message_wizard_with_dismiss_zero_has_an_empty_panel(clean_wizards):
    ws = clean_wizards
    ws.call("wizards.launch", "message", ["one", "two"], {"dismiss": 0})
    snap = ws.call("wizards.snapshot")
    # message.py:27-36 — dismiss=0 is a prompt-only overlay.
    assert snap["panel"] == []
    assert snap["prompt"] == ["one", "two"]

    ws.call("wizards.launch", "message", ["hi"])
    snap = ws.call("wizards.snapshot")
    assert [row["text"] for row in snap["panel"]] == ["Message", "Dismiss"]


def test_appearance_panel_row_count_changes_with_state(clean_wizards):
    """The canonical dynamic panel: the middle row is colour OR what OR text."""
    ws = clean_wizards
    ws.call("wizards.launch", "appearance")
    ws.call("wizards.exec_code", "cmd.get_wizard().set_mode(0)")  # Color
    colour_panel = ws.call("wizards.snapshot")["panel"]
    assert colour_panel[2]["code"] == "color"

    ws.call("wizards.exec_code", "cmd.get_wizard().set_mode(3)")  # Show
    what_panel = ws.call("wizards.snapshot")["panel"]
    assert what_panel[2]["code"] == "what"

    # appearance.py:103-119 — every colour label carries its own \RGB swatch.
    colours = ws.call("wizards.menu", "color")["items"]
    assert any(i["text"].startswith("\\900") for i in colours)


def test_sculpting_panel_carries_raw_inline_python(clean_wizards):
    ws = clean_wizards
    ws.call("wizards.launch", "sculpting")
    panel = ws.call("wizards.snapshot")["panel"]
    codes = [row["code"] for row in panel]
    # sculpting.py:175-176 — proof that `code` is general command language and
    # must be executed server-side, not a method call the client could fake.
    assert any(code.startswith('cmd.set("sculpting"') for code in codes)
    assert any(code.startswith('cmd.set("sculpt_vdw_vis_mode"') for code in codes)


def test_density_panel_and_live_menu(clean_wizards):
    ws = clean_wizards
    ws.call("wizards.launch", "density")
    snap = ws.call("wizards.snapshot")
    assert len(snap["panel"]) == 14  # density.py:159-176
    # density.py:205-206 -> pick | select | position (the roving behaviour)
    assert snap["eventMask"] == 1 + 2 + 512
    assert snap["prompt"] == []  # get_prompt returns None
    radius = ws.call("wizards.menu", "radius")["items"]
    assert [i["text"] for i in radius][0] == "4.0 A Radius"


def test_filter_panel_and_state_mask(clean_wizards):
    ws = clean_wizards
    ws.call("wizards.launch", "filter")
    snap = ws.call("wizards.snapshot")
    assert len(snap["panel"]) == 12  # filter.py:228-254
    assert snap["eventMask"] == 1 + 2 + 32  # filter.py:122-123
    assert "do_state" in snap["methods"]


def test_pair_fit_button_label_is_dynamic(clean_wizards):
    ws = clean_wizards
    ws.call("wizards.launch", "pair_fit")
    panel = ws.call("wizards.snapshot")["panel"]
    # pair_fit.py:30 — 'Fit %d Pairs' proves button text comes from the
    # snapshot and can never be hardcoded in React.
    assert panel[1]["text"] == "Fit 0 Pairs"


def test_mutagenesis_menu_has_nested_submenus(clean_wizards):
    ws = clean_wizards
    ws.call("wizards.launch", "mutagenesis")
    snap = ws.call("wizards.snapshot")
    assert len(snap["panel"]) == 10  # mutagenesis.py:276-295
    assert snap["eventMask"] == 1 + 2 + 32  # pick | select | state
    mode = ws.call("wizards.menu", "mode")["items"]
    grouped = [i for i in mode if "submenu" in i]
    assert {i["text"].strip() for i in grouped} >= {"ARG...", "LYS...", "HIS..."}
    inner = grouped[0]["submenu"]
    assert any(i.get("command", "").endswith('set_mode("ARG")') for i in inner)


def test_cleanup_wizard_reports_its_missing_dependency(clean_wizards):
    """cleanup.py:52-54 raises rather than opening; the client must SEE that."""
    ws = clean_wizards
    reply = ws.call_reply("wizards.launch", "cleanup")
    assert reply["t"] == "err"
    assert "szybki" in reply["error"]["message"]
    assert ws.call("wizards.probe")["depth"] == 0


def test_catalog_lists_the_bundled_wizards_and_the_menubar(clean_wizards):
    catalog = clean_wizards.call("wizards.catalog")
    names = {entry["name"] for entry in catalog["wizards"]}
    assert {
        "measurement",
        "mutagenesis",
        "pair_fit",
        "appearance",
        "cleanup",
        "density",
        "filter",
        "label",
        "charge",
        "sculpting",
        "message",
        "demo",
    } <= names
    assert catalog["aliases"]["distance"] == "measurement"
    labels = [i.get("label") for i in catalog["menubar"]]
    assert labels[:2] == ["Appearance", "Measurement"]


def test_distance_alias_launches_measurement(clean_wizards):
    ws = clean_wizards
    ws.call("wizards.launch", "distance")  # wizarding.py:88-89
    assert ws.call("wizards.probe")["cls"] == "Measurement"


# -- events -----------------------------------------------------------------


def test_event_is_gated_on_the_mask_exactly_like_the_C_layer(clean_wizards):
    ws = clean_wizards
    ws.call("wizards.launch", "label")  # mask = pick|select (label.py:45-46)
    result = ws.call("wizards.event", "scene")
    assert result["dispatched"] is False
    assert result["reason"] == "masked out"
    assert result["mask"] == 3


def test_event_with_no_wizard_is_refused(clean_wizards):
    result = clean_wizards.call("wizards.event", "pick")
    assert result["dispatched"] is False
    assert result["reason"] == "no wizard on the stack"


def test_unknown_event_kind_is_an_error(clean_wizards):
    reply = clean_wizards.call_reply("wizards.event", "wobble")
    assert reply["t"] == "err"
    assert "unknown wizard event" in reply["error"]["message"]


def test_pick_dispatch_labels_an_atom(clean_wizards):
    """The full browser pick path: selection -> cmd.edit -> do_pick_state -> do_pick."""
    ws = clean_wizards
    ws.call("delete", "all")
    ws.call("fragment", "ala")
    ws.call("wizards.launch", "label")

    ws.subscribe("feedback")

    result = ws.call("wizards.event", "pick", selection="ala and name CA")
    assert result["dispatched"] is True
    methods = [call["method"] for call in result["calls"]]
    assert methods == ["do_pick_state", "do_pick"]

    # label.py:79 -> do_select('pk1') -> iterate_state pulls 12 atom fields into
    # self.atom, which the prompt then renders (label.py:52-64).
    prompt = ws.call("wizards.snapshot")["prompt"][0]
    assert "/ala/" in prompt and "CA" in prompt and "XYZ" in prompt

    # ... and the label really landed on the atom (label.py:96-98).
    ws.call("iterate", "ala and name CA", "print('LABEL=' + label)")
    ws.pump_frames(1.0)
    assert any("LABEL=ALA-" in line for line in ws.feedback), ws.feedback[-5:]

    ws.call("delete", "all")


def test_pick_records_a_one_based_state(clean_wizards):
    ws = clean_wizards
    ws.call("delete", "all")
    ws.call("fragment", "ala")
    ws.call("wizards.launch", "measurement")
    result = ws.call("wizards.event", "pick", selection="ala and name CA")
    state_call = result["calls"][0]
    assert state_call["method"] == "do_pick_state"
    assert state_call["args"] == [1]  # 1-based, Wizard.cpp:189/:324
    assert state_call["present"] is True  # measurement.py:292 implements it
    ws.call("delete", "all")


def test_select_dispatch_reaches_do_select(clean_wizards):
    ws = clean_wizards
    ws.call("delete", "all")
    ws.call("fragment", "ala")
    ws.call("select", "mysel", "ala and name CB")
    ws.call("wizards.launch", "label")
    result = ws.call("wizards.event", "select", name="mysel")
    assert result["dispatched"] is True
    assert [c["method"] for c in result["calls"]] == ["do_pick_state", "do_select"]
    assert result["calls"][1]["present"] is True
    ws.call("delete", "all")


def test_key_dispatch_drives_the_hand_rolled_line_editor(clean_wizards):
    """pseudoatom.py:20-36 — key-only mask, ASCII ints, prompt shows the caret."""
    ws = clean_wizards
    ws.call("wizards.launch", "pseudoatom", ["label"], {"pos": [0.0, 0.0, 0.0]})
    snap = ws.call("wizards.snapshot")
    assert snap["eventMask"] == 4  # key only
    assert [row["text"] for row in snap["panel"]] == ["Cancel"]

    for char in "abc":
        assert ws.call("wizards.event", "key", k=ord(char))["dispatched"] is True
    assert ws.call("wizards.snapshot")["prompt"] == ["Label text: \\888abc_"]

    ws.call("wizards.event", "key", k=8)  # backspace
    assert ws.call("wizards.snapshot")["prompt"] == ["Label text: \\888ab_"]

    ws.call("wizards.event", "key", k=13)  # enter -> creates the pseudoatom
    assert ws.call("wizards.probe")["depth"] == 0
    assert "ab" in (ws.call("get_names", "objects") or [])
    ws.call("delete", "all")


def test_renaming_wizard_key_entry(clean_wizards):
    ws = clean_wizards
    ws.call("delete", "all")
    ws.call("fragment", "ala")
    ws.call("wizards.launch", "renaming", ["ala"])
    assert ws.call("wizards.snapshot")["eventMask"] == 4
    # renaming.py:14 seeds new_name with the OLD name, so the line editor starts
    # full and backspace (8/127) is what clears it.
    assert ws.call("wizards.snapshot")["prompt"] == [
        "Renaming \\999ala\\--- to: \\999ala_"
    ]
    for _ in range(3):
        ws.call("wizards.event", "key", k=127)
    for char in "gly":
        ws.call("wizards.event", "key", k=ord(char))
    prompt = ws.call("wizards.snapshot")["prompt"][0]
    assert prompt == "Renaming \\999ala\\--- to: \\999gly_"
    ws.call("wizards.event", "key", k=13)
    assert "gly" in (ws.call("get_names", "objects") or [])
    ws.call("delete", "all")


def test_annotation_wizard_takes_scene_state_frame_only(clean_wizards):
    ws = clean_wizards
    ws.call("wizards.launch", "annotation")
    snap = ws.call("wizards.snapshot")
    assert snap["eventMask"] == 16 + 32 + 64  # annotation.py:7-8
    assert ws.call("wizards.event", "pick")["reason"] == "masked out"
    assert ws.call("wizards.event", "scene")["dispatched"] is True
    assert ws.call("wizards.event", "state", state=1)["dispatched"] is True


def test_demo_panel_is_all_replace_wizard(clean_wizards):
    ws = clean_wizards
    ws.call("wizards.launch", "demo")
    panel = ws.call("wizards.snapshot")["panel"]
    assert panel[0]["text"] == "Demonstrations"
    buttons = [row for row in panel if row["kind"] == "button"]
    assert len(buttons) == 12
    assert all(row["code"].startswith("replace_wizard demo,") for row in buttons)


def test_security_wizard_has_blank_spacer_rows(clean_wizards):
    ws = clean_wizards
    ws.call("wizards.launch", "security")
    panel = ws.call("wizards.snapshot")["panel"]
    kinds = [row["kind"] for row in panel]
    assert kinds == ["text", "button", "text", "button", "text", "button"]
    assert panel[2]["text"] == "" and panel[4]["text"] == ""
    assert len(ws.call("wizards.snapshot")["prompt"]) > 10
