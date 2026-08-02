"""WP-15 — the settings service.

Three layers, deliberately:

* pure parsing of ``packages/engine/layer1/SettingInfo.h`` and of the update tap, which need no
  PyMOL at all;
* the module against the LIVE setting table (levels, types, the 779/780 split);
* the whole way out through the WebSocket, because the interesting question is
  not "does the function work" but "can the browser reach it *through the
  capability policy* without any file this work package does not own".
"""

from __future__ import annotations

import os
import sys
import time
from typing import Any, Dict

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tenmol_bridge.panels import settings as S  # noqa: E402

REPO = os.path.dirname(
    os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    )
)
SETTING_INFO_H = os.path.join(REPO, "packages", "engine", "layer1", "SettingInfo.h")

BOOTSTRAP = "/import tenmol_bridge.panels.settings as _s;_s.install()"


# ---------------------------------------------------------------------------
# 1. The header parse (no PyMOL)
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not os.path.isfile(SETTING_INFO_H), reason="no SettingInfo.h")
def test_parses_every_record_in_settinginfo_h() -> None:
    """798 records, indices 0..797, no gaps — ``cSetting_INIT`` is 798."""
    parsed = S.parse_setting_info(SETTING_INFO_H)
    assert len(parsed) == S.C_SETTING_INIT == 798
    assert sorted(parsed) == list(range(798))


@pytest.mark.skipif(not os.path.isfile(SETTING_INFO_H), reason="no SettingInfo.h")
def test_record_payloads_match_the_documented_table() -> None:
    parsed = S.parse_setting_info(SETTING_INFO_H)

    # The one blank slot, REC__( 83, ) — packages/engine/layer1/SettingInfo.h:167.
    assert parsed[83]["kind"] == "blank"
    assert parsed[83]["level"] == "unused"

    # Levels use the C ENUM suffix in the header (`ostate`) and the NAME
    # everywhere else (`object-state`); the parser translates.
    assert parsed[1]["name"] == "min_mesh_spacing"
    assert parsed[1]["level"] == "object-state"

    # Defaults, per type.
    assert parsed[7] == {
        "index": 7,
        "name": "ambient",
        "kind": "float",
        "level": "global",
        "default": pytest.approx(0.14),
        "min": None,
        "max": None,
    }
    assert parsed[10]["default"] == [-0.4, -0.4, -1.0]  # float3 `light`
    assert parsed[6]["default"] == "0x000000"  # color `bg_rgb`
    assert parsed[15]["default"] == 0 and parsed[15]["kind"] == "boolean"

    # A trailing /* comment */ after the closing paren is not an argument.
    assert parsed[44]["name"] == "line_width"
    assert parsed[44]["default"] == pytest.approx(1.49)

    # `MAX_SPHERE_QUALITY` is a #define in the same header, not a literal.
    assert parsed[87]["min"] == 0 and parsed[87]["max"] == 4
    assert parsed[189]["max"] == 4


@pytest.mark.skipif(not os.path.isfile(SETTING_INFO_H), reason="no SettingInfo.h")
def test_exactly_thirty_records_declare_a_range() -> None:
    """`hasMinMax()` is rare: 30 records, all int except two floats.

    Booleans are excluded because `REC_b` synthesises 0/1 in the macro itself
    (`packages/engine/layer1/SettingInfo.h:18`) rather than declaring a range.
    """
    parsed = S.parse_setting_info(SETTING_INFO_H)
    ranged = [r for r in parsed.values() if r["min"] is not None and r["kind"] != "boolean"]
    assert len(ranged) == 30
    by_name = {r["name"]: (r["min"], r["max"]) for r in ranged}
    assert by_name["stick_quality"] == (3, 100)
    assert by_name["sphere_mode"] == (-1, 11)
    assert by_name["light_count"] == (1, 10)
    floats = [r["name"] for r in ranged if r["kind"] == "float"]
    assert sorted(floats) == ["openvr_gui_alpha", "openvr_gui_fov"]


def test_help_csv_is_read_and_is_not_used_for_defaults() -> None:
    path = S.setting_help_path()
    assert path and os.path.isfile(path)
    help_text = S.load_help(path)
    # 875 physical lines, fewer logical rows: descriptions contain newlines.
    assert len(help_text) > 600
    assert "ambient" in help_text
    assert "background rgb color" in help_text["bg_rgb"]


# ---------------------------------------------------------------------------
# 2. The update tap (no PyMOL)
# ---------------------------------------------------------------------------


def test_tap_is_cursor_addressed_and_deduplicates() -> None:
    tap = S.SettingTap()
    assert tap.since(0)["indices"] == []

    tap.record([155])
    tap.record([155, 279])
    first = tap.since(0)
    assert first["indices"] == [155, 279]
    assert first["batches"] == 2
    # A client that has never read is by definition doing a full resync.
    assert first["full"] is True

    # Reading again at the new cursor yields nothing: the tap is not destructive
    # for the client, but it IS cumulative, so the cursor is what advances.
    assert tap.since(first["cursor"])["indices"] == []

    tap.record([1])
    assert tap.since(first["cursor"])["indices"] == [1]
    # ...and re-reading the same cursor gives the same answer, unlike
    # cmd.get_setting_updates(), which would have cleared it.
    assert tap.since(first["cursor"])["indices"] == [1]


def test_tap_flags_a_session_sized_batch_as_full() -> None:
    tap = S.SettingTap()
    tap.record(list(range(780)))
    out = tap.since(0)
    assert out["full"] is True
    assert len(out["indices"]) == 780


def test_tap_reports_a_wrapped_ring_as_lost() -> None:
    tap = S.SettingTap(max_batches=4)
    for i in range(10):
        tap.record([i])
    # A client whose cursor is 1 asked for batches 2..10, but 1..6 are gone.
    out = tap.since(1)
    assert out["lost"] is True
    assert out["cursor"] == 10


def test_tap_ignores_non_numeric_junk() -> None:
    tap = S.SettingTap()
    tap.record(["nonsense", None, 12])  # type: ignore[list-item]
    assert tap.since(0)["indices"] == [12]


# ---------------------------------------------------------------------------
# 3. Against the live setting table
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def catalogue(bridge: Any) -> Dict[str, Any]:
    """Built on the engine thread of the real bridge, like the product does."""
    return bridge.pump.call(
        lambda engine: S.catalogue(engine.cmd, refresh=True), label="test:catalogue"
    )


def test_catalogue_covers_every_setting_python_can_see(catalogue: Dict[str, Any]) -> None:
    """779 visible, 780 in index_dict — the alias is injected after the snapshot."""
    assert catalogue["count"] == 779
    assert catalogue["meta"]["nameListSize"] == 779
    assert catalogue["meta"]["indexDictSize"] == 780
    assert catalogue["aliases"] == {"ray_shadows": 195}
    assert len({row["index"] for row in catalogue["settings"]}) == 779


def test_catalogue_level_counts_match_the_c_table(catalogue: Dict[str, Any]) -> None:
    """`SettingGetSettingIndices` drops every `unused` record, so no row has it."""
    assert catalogue["levelCounts"] == {
        "global": 454,
        "object": 44,
        "object-state": 231,
        "atom": 27,
        "atom-state": 17,
        "bond": 6,
    }
    assert "unused" not in catalogue["levelCounts"]


def test_catalogue_type_counts_match_the_c_table(catalogue: Dict[str, Any]) -> None:
    assert catalogue["counts"] == {
        "boolean": 209,
        "int": 199,
        "float": 291,
        "float3": 15,
        "color": 33,
        "string": 32,
    }
    assert sum(catalogue["counts"].values()) == 779


def test_catalogue_carries_level_scopes_defaults_and_help(catalogue: Dict[str, Any]) -> None:
    by_name = {row["name"]: row for row in catalogue["settings"]}

    # The level is the whole point: it is not in `pymol.setting` at all.
    assert by_name["stick_radius"]["level"] == "bond"
    assert by_name["surface_color"]["level"] == "atom"
    assert by_name["ambient"]["level"] == "global"

    # Scopes are the lattice, not a chain (Setting.cpp:55-96).
    assert by_name["ambient"]["scopes"] == ["global"]
    assert by_name["stick_radius"]["scopes"] == [
        "global",
        "object",
        "object-state",
        "bond",
    ]
    # sphere_scale is ATOM level, so its scope list ends at `atom`.
    assert by_name["sphere_scale"]["level"] == "atom"
    assert by_name["sphere_scale"]["scopes"] == [
        "global",
        "object",
        "object-state",
        "atom",
    ]

    # Defaults come from the validated header parse...
    assert by_name["ambient"]["default"] == pytest.approx(0.14)
    assert by_name["sphere_quality"]["min"] == 0
    # ...and help from the CSV that had zero consumers before this.
    assert "ambient lighting level" in by_name["ambient"]["help"]


def test_catalogue_says_where_defaults_came_from(catalogue: Dict[str, Any]) -> None:
    meta = catalogue["meta"]
    assert meta["cSettingInit"] == 798
    assert meta["minMaxEnforced"] is False
    assert "not enforced" in meta["minMaxNote"] or "hints" in meta["minMaxNote"]
    assert meta["defaultsSource"] == "packages/engine/layer1/SettingInfo.h"


def test_a_header_that_disagrees_is_rejected_wholesale(monkeypatch: Any, bridge: Any) -> None:
    """A stale header must produce NO defaults, never wrong ones.

    BOTH deliveries have to be removed since wave 10: defaults now arrive from
    the build-time asset (``panels/setting_catalog.json``) when it is present
    and from the header only otherwise, so hiding the header alone no longer
    hides the data.  The claim under test is unchanged — no source, no defaults.
    """
    monkeypatch.setattr(S, "setting_info_path", lambda: None)
    monkeypatch.setattr(S, "asset_path", lambda: None)
    built = bridge.pump.call(
        lambda engine: S.catalogue(engine.cmd, refresh=True), label="test:catalogue-nohdr"
    )
    assert built["meta"]["defaultsSource"] is None
    assert "unavailable" in built["meta"]["defaultsNote"]
    assert all("default" not in row for row in built["settings"])
    # Put the real one back for the rest of the module.
    monkeypatch.undo()
    bridge.pump.call(lambda engine: S.catalogue(engine.cmd, refresh=True), label="test:restore")


def test_values_reads_every_setting_in_one_call(bridge: Any) -> None:
    reply = bridge.pump.call(lambda engine: S.values(cmd=engine.cmd), label="test:values")
    assert len(reply["values"]) == 779
    assert reply["failed"] == []
    by_index = {row[0]: row for row in reply["values"]}
    # boolean -> int + on/off text; float -> %1.5f; float3 -> [ x, y, z ]
    assert by_index[15][2] in ("on", "off")
    assert by_index[7][2] == "0.14000"
    assert by_index[10][1] == [-0.4, -0.4, -1.0]
    assert by_index[10][2].startswith("[ ")


def test_coercion_mirrors_setting_validate_value(bridge: Any) -> None:
    def run(engine: Any) -> Dict[str, Any]:
        return {
            "bool_word": S.coerce("boolean", "on"),
            "bool_abbrev": S.coerce("boolean", "f"),
            "bool_float": S.coerce("boolean", "2.5"),
            "int_from_bool": S.coerce("int", "on"),
            "float3_csv": S.coerce("float3", "1,2,3"),
            "float3_ws": S.coerce("float3", "1 2 3"),
            "string_quotes": S.coerce("string", '"quoted"'),
            "color": S.coerce("color", 25),
        }

    got = bridge.pump.call(run, label="test:coerce")
    assert got["bool_word"] == 1
    assert got["bool_abbrev"] == 0
    assert got["bool_float"] == 1
    assert got["int_from_bool"] == 1
    assert got["float3_csv"] == (1.0, 2.0, 3.0)
    assert got["float3_ws"] == (1.0, 2.0, 3.0)
    assert got["string_quotes"] == "quoted"
    assert got["color"] == "25"


# ---------------------------------------------------------------------------
# 4. End to end, through the socket and the capability policy
# ---------------------------------------------------------------------------


def test_the_client_cannot_drain_settings_itself(ws: Any) -> None:
    """The reason the tap exists: a second consumer splits the stream."""
    reply = ws.call_reply("cmd.get_setting_updates")
    assert reply["t"] == "err"
    assert "destructive drain" in reply["error"]["message"]


def test_bootstrap_and_catalogue_over_the_wire(ws: Any) -> None:
    ws.do(BOOTSTRAP)
    status = ws.call("setting.tenmol_settings_status")
    assert status["installed"] is True
    assert status["module"] == "tenmol_bridge.panels.settings"

    catalogue = ws.call("setting.tenmol_settings_catalogue")
    assert catalogue["count"] == 779
    names = {row["name"] for row in catalogue["settings"]}
    assert "cartoon_transparency" in names
    assert "sphere_scale" in names


def test_write_read_and_reset_over_the_wire(ws: Any) -> None:
    ws.do(BOOTSTRAP)
    # 155 = sphere_scale, a float at object-state level.
    ws.call("cmd.set", 155, 3.25, log=1, quiet=0)
    reply = ws.call("setting.tenmol_settings_values", [155])
    assert reply["values"] == [[155, pytest.approx(3.25), "3.25000"]]

    # cmd.unset restores the DEFAULT (PyMOL 2.5+), not zero.
    ws.call("cmd.unset", 155)
    reply = ws.call("setting.tenmol_settings_values", [155])
    assert reply["values"][0][1] == pytest.approx(1.0)


def test_int_global_clamping_is_visible_in_the_readback(ws: Any) -> None:
    """`stick_quality` declares 3..100 and IS clamped for a global write."""
    ws.do(BOOTSTRAP)
    ws.call("cmd.set", 46, 500, quiet=0)
    reply = ws.call("setting.tenmol_settings_values", [46])
    assert reply["values"][0][1] == 100
    ws.call("cmd.unset", 46)


def test_the_tap_reports_a_change_the_status_thread_drained(ws: Any) -> None:
    ws.do(BOOTSTRAP)
    start = ws.call("setting.tenmol_settings_drain", 0)["cursor"]
    ws.call("cmd.set", 279, 0.42, quiet=0)  # cartoon_transparency

    deadline = time.monotonic() + 5.0
    seen: Dict[str, Any] = {}
    while time.monotonic() < deadline:
        seen = ws.call("setting.tenmol_settings_drain", start)
        if 279 in seen["indices"]:
            break
        time.sleep(0.1)

    assert 279 in seen["indices"], "the status thread's drain never reached the tap"
    assert seen["observing"] is True
    assert seen["cursor"] > start
    # And the same cursor answers the same way: nothing was consumed.
    assert 279 in ws.call("setting.tenmol_settings_drain", start)["indices"]
    # A cursor at the head is empty.
    assert ws.call("setting.tenmol_settings_drain", seen["cursor"])["indices"] == []
    ws.call("cmd.unset", 279)


def test_object_and_atom_scope_report_real_overrides(ws: Any) -> None:
    ws.do(BOOTSTRAP)
    ws.call("cmd.fragment", "ala", "wp15_ala")
    ws.call("cmd.set", "sphere_scale", 2.0, "wp15_ala")

    scope = ws.call("setting.tenmol_settings_scope", "wp15_ala")
    assert [155, "float", pytest.approx(2.0)] in [
        [row[0], row[1], row[2]] for row in scope["objectSettings"]
    ]

    # The per-object read cascades: object value wins over the global one.
    obj = ws.call("setting.tenmol_settings_values", [155], "wp15_ala")
    assert obj["values"][0][1] == pytest.approx(2.0)
    glob = ws.call("setting.tenmol_settings_values", [155])
    assert glob["values"][0][1] == pytest.approx(1.0)

    # Atom level: `iter(s)` yields the indices actually defined on that atom
    # (`SettingUniqueGetIndicesAsPyList`, packages/engine/layer1/P.cpp:455-606). sphere_scale
    # is an ATOM-level setting, so a selection narrower than the object writes
    # per atom rather than per object.
    ws.call("cmd.set", "sphere_scale", 3.0, "wp15_ala and name CB")
    atoms = ws.call("setting.tenmol_settings_scope", "", "wp15_ala")
    assert atoms["atoms"], "no per-atom override was reported"
    defined = {index for atom in atoms["atoms"] for index in atom["settings"]}
    assert 155 in defined

    ws.call("cmd.delete", "wp15_ala")


def test_bond_level_settings_need_set_bond_not_set(ws: Any) -> None:
    """The silent no-op the table exists to stop.

    ``packages/engine/modules/pymol/setting.py:245-248``: "if you attempt to use the set
    command with a per-bond setting over a selection of atoms, the setting
    change will appear to take, but no change will be observed."  So this
    asserts BOTH halves: ``cmd.set`` leaves no bond override, ``cmd.set_bond``
    creates one, and ``cmd.unset_bond`` removes it again.
    """
    ws.do(BOOTSTRAP)
    ws.call("cmd.fragment", "trp", "wp15_bond")

    # The six names are bond level in the live table, not a hard-coded guess.
    catalogue = ws.call("setting.tenmol_settings_catalogue")
    by_name = {row["name"]: row for row in catalogue["settings"]}
    for name in S.BOND_SETTINGS:
        assert by_name[name]["level"] == "bond", name
        assert "bond" in by_name[name]["scopes"]

    empty = ws.call("setting.tenmol_settings_bonds", "wp15_bond")
    assert empty["bonds"] == []
    assert sorted(empty["settings"]) == sorted(
        by_name[n]["index"] for n in S.BOND_SETTINGS
    )

    # cmd.set over a selection: accepted, and does nothing at the bond level.
    ws.call("cmd.set", "stick_transparency", 0.7, "wp15_bond")
    assert ws.call("setting.tenmol_settings_bonds", "wp15_bond")["bonds"] == []

    # cmd.set_bond: the only write that lands.
    ws.call("cmd.set_bond", "stick_transparency", 0.7, "wp15_bond", None)
    landed = ws.call("setting.tenmol_settings_bonds", "wp15_bond")["bonds"]
    assert landed, "cmd.set_bond wrote nothing"
    assert all(row["model"] == "wp15_bond" for row in landed)
    assert landed[0]["value"] == pytest.approx(0.7)
    assert landed[0]["index"] == by_name["stick_transparency"]["index"]
    assert len(landed[0]["atoms"]) == 2

    # The same rows show up in the selection scope report.
    scoped = ws.call("setting.tenmol_settings_scope", "", "wp15_bond")
    assert scoped["bonds"], "scope() did not forward the bond overrides"

    ws.call("cmd.unset_bond", "stick_transparency", "wp15_bond", None)
    assert ws.call("setting.tenmol_settings_bonds", "wp15_bond")["bonds"] == []

    ws.call("cmd.delete", "wp15_bond")


def test_unset_deep_clears_object_and_atom_but_not_the_global(ws: Any) -> None:
    """``unset_deep`` clears object/ostate/atom/bond, NOT the global value.

    ``packages/engine/modules/pymol/setting.py:516-544`` — the docstring is explicit that
    atom-state is excluded; what matters for the client is that a global write
    survives it, so the table must not present it as "reset everything".
    """
    ws.do(BOOTSTRAP)
    ws.call("cmd.fragment", "ala", "wp15_deep")
    ws.call("cmd.set", "sphere_scale", 2.0, "wp15_deep")
    ws.call("cmd.set", "sphere_scale", 4.0)  # global

    assert ws.call("setting.tenmol_settings_scope", "wp15_deep")["objectSettings"]

    ws.call("cmd.unset_deep", [155], "wp15_deep")
    assert ws.call("setting.tenmol_settings_scope", "wp15_deep")["objectSettings"] == []
    # The global survives, and the object now cascades to it.
    assert ws.call("setting.tenmol_settings_values", [155])["values"][0][1] == pytest.approx(4.0)
    assert ws.call("setting.tenmol_settings_values", [155], "wp15_deep")["values"][0][
        1
    ] == pytest.approx(4.0)

    ws.call("cmd.unset", 155)
    ws.call("cmd.delete", "wp15_deep")


def test_reinitialize_settings_produces_a_full_resync_batch(ws: Any) -> None:
    """`cmd.reinitialize('settings')` -> a drain big enough to mean "refetch".

    The client's `poll()` treats `full` as "re-read every value" rather than
    diffing, and this is the event that must produce it (inventory area 5,
    session/defaults lifecycle).
    """
    ws.do(BOOTSTRAP)
    start = ws.call("setting.tenmol_settings_drain", 0)["cursor"]
    ws.call("cmd.reinitialize", "settings")

    deadline = time.time() + 10.0
    seen: Dict[str, Any] = {}
    while time.time() < deadline:
        seen = ws.call("setting.tenmol_settings_drain", start)
        if seen["full"]:
            break
        time.sleep(0.05)
    assert seen.get("full") is True, seen
    assert len(seen["indices"]) >= S.SettingTap.FULL_RESYNC_AT
