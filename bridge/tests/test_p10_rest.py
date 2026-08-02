"""Wave 10 — the settings asset, the legacy plugin registry, and the seqview.

Three inventory rows share this file because each needs the same two things: a
live PyMOL to validate against, and a claim that is about DELIVERY rather than
about a function returning the right number.

* row 203 — setting defaults / min-max / help.  The data was already correct;
  what was missing was the build-time JSON asset the row asks for, so an
  installed bridge (no ``layer1/`` next to it) had no defaults at all.
* row 76 — the legacy plugin menu machinery, option (b): plugins stay headless
  in Python and register JSON menu descriptors that the browser renders and
  clicks back over the bridge.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import textwrap
from typing import Any, Dict

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tenmol_bridge.panels import settings as S  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SETTING_INFO_H = os.path.join(REPO, "layer1", "SettingInfo.h")


# ===========================================================================
# Row 203 — the build-time asset
# ===========================================================================


def test_the_checked_in_asset_is_byte_identical_to_a_fresh_generation() -> None:
    """The asset cannot go stale silently: a drift is a RED test.

    This is the whole reason a generated file is safe to check in.  ``--check``
    is the same comparison as a shell command, so CI can run it without pytest.
    """
    path = S.asset_path()
    assert path is not None, "the build-time asset is not next to the module"
    with open(path, "r", encoding="utf-8") as handle:
        on_disk = handle.read()
    assert on_disk == S.asset_json(), (
        "panels/setting_catalog.json is stale — regenerate it with "
        "`python -m tenmol_bridge.panels.settings --emit`"
    )
    assert S._main(["--check"]) == 0


def test_the_asset_carries_the_whole_c_table_and_the_whole_csv() -> None:
    document = S.load_asset()
    assert document is not None
    assert document["version"] == S.ASSET_VERSION
    assert document["cSettingInit"] == S.C_SETTING_INIT == 798
    assert len(document["records"]) == 798
    assert [r["index"] for r in document["records"]] == list(range(798))
    # The origins are what `defaultsSource` / `helpSource` report: the numbers
    # came from the header whichever way they were delivered.
    assert document["settingInfoOrigin"] == "layer1/SettingInfo.h"
    assert document["helpOrigin"] == "data/setting_help.csv"
    # 697 logical help rows out of 875 physical CSV lines (descriptions contain
    # newlines), which is exactly what `load_help` produced before the asset.
    assert len(document["help"]) == 697
    by_index = {r["index"]: r for r in document["records"]}
    assert by_index[7]["name"] == "ambient"
    assert by_index[7]["default"] == pytest.approx(0.14)
    assert by_index[87]["min"] == 0 and by_index[87]["max"] == 4
    assert by_index[10]["default"] == [-0.4, -0.4, -1.0]
    assert by_index[83]["kind"] == "blank"
    # 30 declared ranges, same count the header parse reports (test_settings.py).
    ranged = [
        r
        for r in document["records"]
        if r["min"] is not None and r["kind"] != "boolean"
    ]
    assert len(ranged) == 30


@pytest.mark.skipif(not os.path.isfile(SETTING_INFO_H), reason="no SettingInfo.h")
def test_the_asset_says_exactly_what_the_header_parse_says() -> None:
    """Delivery changed; the data did not."""
    fresh = S.parse_setting_info(SETTING_INFO_H)
    document = S.load_asset()
    assert document is not None
    assert {r["index"]: r for r in document["records"]} == fresh


def test_an_asset_of_the_wrong_shape_is_absence_not_a_crash(tmp_path: Any) -> None:
    for text in ("{", "[]", json.dumps({"version": 999, "records": []}),
                 json.dumps({"version": S.ASSET_VERSION, "records": "no"})):
        path = tmp_path / "bad.json"
        path.write_text(text, encoding="utf-8")
        assert S.load_asset(str(path)) is None


def test_an_installed_layout_has_defaults_only_because_of_the_asset(
    monkeypatch: Any, bridge: Any
) -> None:
    """The measurement the row exists for.

    An installed PyMOL ships no ``layer1/`` — headers are not in a wheel — so
    before this asset a bridge outside a source checkout reported
    ``defaultsSource: None`` and 0 of 779 rows carried a default.  Both halves
    are asserted here: with the asset 779/779, and with it removed 0/779.
    """
    monkeypatch.setattr(S, "setting_info_path", lambda: None)
    with_asset = bridge.pump.call(
        lambda engine: S.catalogue(engine.cmd, refresh=True), label="test:p10-asset"
    )
    meta = with_asset["meta"]
    assert meta["defaultsSource"] == "layer1/SettingInfo.h"
    assert "build-time asset" in meta["defaultsNote"]
    assert sum(1 for row in with_asset["settings"] if "default" in row) == 779
    assert sum(1 for row in with_asset["settings"] if "help" in row) == 671
    by_name = {row["name"]: row for row in with_asset["settings"]}
    assert by_name["ambient"]["default"] == pytest.approx(0.14)
    assert by_name["stick_quality"]["min"] == 3
    assert by_name["stick_quality"]["max"] == 100

    monkeypatch.setattr(S, "asset_path", lambda: None)
    without = bridge.pump.call(
        lambda engine: S.catalogue(engine.cmd, refresh=True), label="test:p10-noasset"
    )
    assert without["meta"]["defaultsSource"] is None
    assert sum(1 for row in without["settings"] if "default" in row) == 0

    # Put the real catalogue back for every other test in the session.
    monkeypatch.undo()
    restored = bridge.pump.call(
        lambda engine: S.catalogue(engine.cmd, refresh=True), label="test:p10-restore"
    )
    assert restored["meta"]["defaultsSource"] == "layer1/SettingInfo.h"


def test_an_asset_that_disagrees_with_the_live_table_is_rejected_wholesale(
    monkeypatch: Any, bridge: Any, tmp_path: Any
) -> None:
    """A stale asset must produce NO defaults, exactly like a stale header.

    The header is hidden as well, so the fall-through cannot mask the refusal.
    """
    document = S.build_asset()
    document["records"][7]["name"] = "not_ambient_any_more"
    bad = tmp_path / "stale.json"
    bad.write_text(json.dumps(document), encoding="utf-8")
    monkeypatch.setattr(S, "asset_path", lambda: str(bad))
    monkeypatch.setattr(S, "setting_info_path", lambda: None)
    built = bridge.pump.call(
        lambda engine: S.catalogue(engine.cmd, refresh=True), label="test:p10-stale"
    )
    assert built["meta"]["defaultsSource"] is None
    assert "disagrees with the live setting table" in built["meta"]["defaultsNote"]
    assert all("default" not in row for row in built["settings"])

    monkeypatch.undo()
    bridge.pump.call(
        lambda engine: S.catalogue(engine.cmd, refresh=True), label="test:p10-restore2"
    )


def test_a_stale_asset_still_loses_to_the_header_on_a_source_checkout(
    monkeypatch: Any, bridge: Any, tmp_path: Any
) -> None:
    """On a checkout the header wins, because it is what the asset is made of."""
    document = S.build_asset()
    document["records"][7]["name"] = "not_ambient_any_more"
    bad = tmp_path / "stale.json"
    bad.write_text(json.dumps(document), encoding="utf-8")
    monkeypatch.setattr(S, "asset_path", lambda: str(bad))
    built = bridge.pump.call(
        lambda engine: S.catalogue(engine.cmd, refresh=True), label="test:p10-fallback"
    )
    assert built["meta"]["defaultsSource"] == "layer1/SettingInfo.h"
    assert "parsed from the header" in built["meta"]["defaultsNote"]
    by_name = {row["name"]: row for row in built["settings"]}
    assert by_name["ambient"]["default"] == pytest.approx(0.14)

    monkeypatch.undo()
    bridge.pump.call(
        lambda engine: S.catalogue(engine.cmd, refresh=True), label="test:p10-restore3"
    )


def test_help_survives_a_layout_with_no_csv_next_to_the_bridge(
    monkeypatch: Any, bridge: Any
) -> None:
    monkeypatch.setattr(S, "setting_help_path", lambda: None)
    built = bridge.pump.call(
        lambda engine: S.catalogue(engine.cmd, refresh=True), label="test:p10-help"
    )
    meta = built["meta"]
    assert meta["helpSource"] == "data/setting_help.csv"
    assert meta["helpRows"] == 697
    by_name: Dict[str, Any] = {row["name"]: row for row in built["settings"]}
    assert "ambient lighting level" in by_name["ambient"]["help"]

    monkeypatch.undo()
    bridge.pump.call(
        lambda engine: S.catalogue(engine.cmd, refresh=True), label="test:p10-restore4"
    )


# ===========================================================================
# Row 106 — the scene-button strip's right-click menu
# ===========================================================================


def test_scene_menu_is_reachable_with_a_null_self_cmd(ws: Any) -> None:
    """The client fetches `pymol.menu.scene_menu`; it does not write one.

    `menu` is an addressable root (`policy/base.py`) and `scene_menu`
    (`modules/pymol/menu.py:1842`) never touches its `self_cmd` argument — it
    only formats strings — so `None` is a legal first argument and no bridge
    panel is needed for this menu at all.  Asserted through the SOCKET, because
    "is it reachable" is a policy question, not a Python one.
    """
    rows = ws.call("menu.scene_menu", None, "p10scene")
    assert [row[0] for row in rows] == [2, 1, 0, 1, 0, 1]
    assert rows[0][1] == "Scene p10scene"
    commands = {row[1]: row[2] for row in rows if row[0] == 1}
    assert commands["rename"] == 'cmd.wizard("renaming","p10scene",mode="scene")'
    assert commands["update"] == 'cmd.scene("p10scene","update")'
    # The delete leaf carries PyMOL's red text escape; the popup renders it.
    delete = [row for row in rows if row[0] == 1 and row[1].endswith("delete")][0]
    assert delete[1].startswith("\\")
    assert delete[2] == 'cmd.scene("p10scene","delete")'
    # A name with a quote in it is escaped by `menu.py:1843`, not interpolated.
    quoted = ws.call("menu.scene_menu", None, 'ev"il')
    assert 'cmd.scene("ev\\"il","update")' in [row[2] for row in quoted]


def test_the_drag_emissions_really_reorder_the_scene_list(ws: Any) -> None:
    """`dragOrder`'s two forms, executed against the live scene bin.

    The client emits exactly what `SceneMouse.cpp:1287-1291` PParses.  This
    proves the two forms MEAN what the drag needs them to mean, which is the
    half a jsdom test cannot: `location='top'` moves a scene to slot 0, and the
    two-name form places the second name immediately after the first.
    """
    names = ["p10s_a", "p10s_b", "p10s_c", "p10s_d"]
    # SAVE IT.  `scene_animation_duration` is global and 2.25 s is its default;
    # `test_wf_camera.py::test_scene_animation_duration_is_the_sweep_length`
    # asserts that default and goes red if this test leaves 0 behind — which it
    # did, once.
    duration = ws.call("cmd.get", "scene_animation_duration")
    try:
        ws.do("set scene_animation_duration, 0")
        for name in names:
            ws.call("cmd.scene", name, "store")
        stored = [n for n in ws.call("cmd.get_scene_list") if n.startswith("p10s_")]
        assert stored == names

        # Dragging `d` onto `c` (up): anchor is the row above `c`, i.e. `b`.
        ws.call("cmd.scene_order", "p10s_b p10s_d")
        after = [n for n in ws.call("cmd.get_scene_list") if n.startswith("p10s_")]
        assert after == ["p10s_a", "p10s_b", "p10s_d", "p10s_c"]

        # Dragging `c` onto the first slot.
        ws.call("cmd.scene_order", "p10s_c", location="top")
        after = [n for n in ws.call("cmd.get_scene_list") if n.startswith("p10s_")]
        assert after[0] == "p10s_c"
        assert set(after) == set(names)
    finally:
        for name in names:
            try:
                ws.call("cmd.scene", name, "clear")
            except Exception:  # noqa: BLE001 - cleanup must not fail the test
                pass
        ws.call("cmd.set", "scene_animation_duration", float(duration))


# ===========================================================================
# Row 76 — the legacy plugin menu as JSON descriptors (option (b))
# ===========================================================================
#
# EVERY test below runs in a SUBPROCESS.  Three of the things under test are
# process-global and two of them are irreversible in practice:
# ``pymol._ext_gui``, ``pmg_tk.startup.__path__``, ``plugins.plugins`` — and the
# defect being measured (``PluginInfo.load`` leaving ``cmd.extend`` wrapped)
# corrupts command registration for the life of the process.  None of that may
# touch the engine the rest of the suite shares.


def _subprocess(source: str) -> subprocess.CompletedProcess:
    """Run ``source`` in a fresh interpreter — the only safe place for pmg_qt."""
    proc = subprocess.run(
        [sys.executable, "-c", textwrap.dedent(source)],
        capture_output=True,
        text=True,
        timeout=180,
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    return proc


_PREAMBLE = """
    import json, sys
    sys.path.insert(0, %r)
    import pymol2
    _p = pymol2.PyMOL(); _p.start()
    import pymol
    from pymol import plugins as pl
    from tenmol_bridge.panels import plugins as P
"""


def _script(body: str) -> str:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    # BOTH halves are dedented here rather than once over the join: the two
    # pieces are written at different indents, so a single dedent of the
    # concatenation finds a common prefix of zero and leaves the preamble
    # indented (`IndentationError: unexpected indent`).
    return textwrap.dedent(_PREAMBLE % root) + textwrap.dedent(body)


def test_a_real_plugin_registers_a_json_menu_and_the_click_comes_back() -> None:
    """The whole of option (b), end to end, with `plugins.addmenuitem`.

    A plugin calls the one toolkit-neutral entry point it has always had; the
    browser gets a JSON tree keyed by the pipe-joined label path; invoking a
    leaf by (key, index) runs the plugin's function on the engine.
    """
    out = _subprocess(
        _script(
            """
            P.install(_p.cmd)
            api = _p.cmd.tenmol_plugins
            fired = []
            pl.addmenuitem('My Tool|Run', lambda: fired.append('ran'))
            pl.addmenuitem('My Tool|-', None)
            pl.addmenuitem('Top level', lambda: fired.append('top'))
            # A duplicate CASCADE is swallowed (ValueError inside addmenuitem),
            # so re-registering a submenu is idempotent.
            pl.addmenuitem('My Tool|Second', lambda: fired.append('second'))
            menu = api.menu()
            result = api.invoke('Plugin|My Tool', 0)
            print('OUT', json.dumps({
                'keys': menu['keys'],
                'tool': [m for m in menu['menus'] if m['key'] == 'Plugin|My Tool'][0],
                'plugin': [m for m in menu['menus'] if m['key'] == 'Plugin'][0],
                'invoke': result,
                'fired': fired,
                'tk': [m for m in sys.modules if m.startswith('tkinter')],
                'qt': [m for m in sys.modules if m.startswith('pymol.Qt')],
            }))
            """
        )
    )
    data = json.loads(out.stdout.split("OUT ", 1)[1])
    assert data["keys"] == ["Plugin", "PluginQt", "Plugin|My Tool"]
    assert data["tool"]["items"] == [
        {"kind": "command", "index": 0, "label": "Run"},
        {"kind": "separator", "index": 1, "label": ""},
        {"kind": "command", "index": 2, "label": "Second"},
    ]
    # The cascade is a child of `Plugin`, addressable by its pipe-joined key.
    top = data["plugin"]["items"]
    assert top[0]["kind"] == "menu" and top[0]["key"] == "Plugin|My Tool"
    assert top[1] == {"kind": "command", "index": 1, "label": "Top level"}
    assert data["invoke"] == {"ok": True, "label": "Run"}
    assert data["fired"] == ["ran"]
    # No toolkit was dragged in by any of it.
    assert data["tk"] == []
    assert data["qt"] == []


def test_an_unknown_parent_and_a_bad_address_are_refusals_not_crashes() -> None:
    out = _subprocess(
        _script(
            """
            P.install(_p.cmd)
            api = _p.cmd.tenmol_plugins
            pl.addmenuitem('Solo', lambda: None)
            # `PmwMenuBar._get_menu` prints and returns None for an unknown
            # parent; nothing is registered and nothing raises.
            pl.addmenuitem('x', None, menuName='NoSuchMenu')
            print('OUT', json.dumps({
                'keys': api.menu()['keys'],
                'nomenu': api.invoke('NoSuchMenu', 0),
                'noitem': api.invoke('Plugin', 9),
                'notleaf': api.invoke('Plugin', 0) if False else api.invoke('PluginQt', 0),
            }))
            """
        )
    )
    data = json.loads(out.stdout.split("OUT ", 1)[1])
    assert data["keys"] == ["Plugin", "PluginQt"]
    assert "Error: no such menu: 'NoSuchMenu'" in out.stdout
    assert data["nomenu"] == {"ok": False, "error": "no such menu: 'NoSuchMenu'"}
    assert data["noitem"]["ok"] is False and "no item 9" in data["noitem"]["error"]
    assert data["notleaf"]["ok"] is False


def test_deletemenuitems_is_one_based_and_inclusive() -> None:
    """Upstream's contract, driven through the real `PmwMenuBar`."""
    out = _subprocess(
        _script(
            """
            P.install(_p.cmd)
            api = _p.cmd.tenmol_plugins
            for label in ('A', 'B', 'C', 'D'):
                pl.addmenuitem(label, lambda: None)
            app = pymol._ext_gui
            before = [a['label'] for a in api.menu()['menus'][0]['items']]
            app.menuBar.deletemenuitems('Plugin', 2, 3)
            after = [a['label'] for a in api.menu()['menus'][0]['items']]
            print('OUT', json.dumps({'before': before, 'after': after}))
            """
        )
    )
    data = json.loads(out.stdout.split("OUT ", 1)[1])
    assert data["before"] == ["A", "B", "C", "D"]
    assert data["after"] == ["A", "D"]


def test_a_plugin_that_raises_is_reported_instead_of_taking_the_call_down() -> None:
    """`PmwMenuBar`'s wrapper is upstream's; its second half cannot run here.

    The wrapper prints the plugin's traceback (which reaches the client as
    console feedback) and then reaches for `QtWidgets.QMessageBox`, which with
    no Qt binding raises `ImportError: pymol.Qt` from inside the handler.
    `invoke` turns that into a structured failure rather than an exception.
    """
    out = _subprocess(
        _script(
            """
            P.install(_p.cmd)
            api = _p.cmd.tenmol_plugins
            def boom():
                raise RuntimeError('plugin exploded')
            pl.addmenuitem('Boom', boom)
            print('OUT', json.dumps(api.invoke('Plugin', 0)))
            """
        )
    )
    data = json.loads(out.stdout.split("OUT ", 1)[1])
    assert data["ok"] is False
    assert data["label"] == "Boom"
    assert data["error"] == "ImportError: pymol.Qt"
    assert "traceback was printed to the console" in data["note"]
    # The PLUGIN's own error is on the console, which is where the user reads it.
    assert "RuntimeError: plugin exploded" in (out.stdout + out.stderr)


def test_load_guards_the_cmd_extend_defect_this_row_documents() -> None:
    """The upstream defect, measured, and then measured again with the guard.

    `PluginInfo.load` swaps `cmd.extend` for a recording wrapper and restores it
    on the SUCCESS path only.  A plugin whose `__init_plugin__` raises therefore
    leaves `cmd.extend` as `extend_overload` for the life of the process.
    `PluginMenuAPI.load` restores it in a `finally` and says that it had to.
    """
    with tempfile.TemporaryDirectory() as startup:
        with open(os.path.join(startup, "p10_boom.py"), "w") as handle:
            handle.write(
                "def __init_plugin__(app=None):\n"
                "    raise RuntimeError('p10 boom during init')\n"
            )
        with open(os.path.join(startup, "p10_ok.py"), "w") as handle:
            handle.write(
                "def __init_plugin__(app=None):\n"
                "    from pymol import plugins\n"
                "    plugins.addmenuitem('P10 Ok|Say hi', lambda: print('P10 hi'))\n"
            )
        out = _subprocess(
            _script(
                """
                import pmg_tk.startup as st
                st.__path__.append(%r)
                pl.initialize(-2)

                # 1. UNGUARDED — what upstream does today.
                virgin = pymol.cmd.extend
                try:
                    pl.plugin_load('p10_boom')
                except Exception:
                    pass
                unguarded = pymol.cmd.extend is not virgin
                unguarded_name = getattr(pymol.cmd.extend, '__name__', '?')
                pymol.cmd.extend = virgin

                # 2. GUARDED — through this module.
                P.install(_p.cmd)
                api = _p.cmd.tenmol_plugins
                boom = api.load('p10_boom')
                restored = pymol.cmd.extend is virgin
                ok = api.load('p10_ok')
                menu = api.menu()
                fired = api.invoke('Plugin|P10 Ok', 0)
                print('OUT', json.dumps({
                    'discovered': sorted(pl.plugins),
                    'unguarded': unguarded,
                    'unguardedName': unguarded_name,
                    'boom': boom,
                    'restored': restored,
                    'ok': ok,
                    'keys': menu['keys'],
                    'fired': fired,
                }))
                """
                % startup
            )
        )
    data = json.loads(out.stdout.split("OUT ", 1)[1])
    assert "p10_boom" in data["discovered"] and "p10_ok" in data["discovered"]
    # The defect is real and reproduces.
    assert data["unguarded"] is True
    assert data["unguardedName"] == "extend_overload"
    # The guard sees it happen and undoes it.
    assert data["boom"]["extendWasWrapped"] is True
    assert data["restored"] is True
    # `plugin_load` swallows the failure; the registry does not.
    assert data["boom"]["loaded"] is False
    assert data["ok"]["loaded"] is True
    assert data["keys"] == ["Plugin", "PluginQt", "Plugin|P10 Ok"]
    assert data["fired"] == {"ok": True, "label": "Say hi"}
    assert "P10 hi" in out.stdout


def test_addmenuitemqt_stays_refused_and_says_why() -> None:
    """A plugin asserting "I open a PyQt window" must not be run on the server."""
    out = _subprocess(
        _script(
            """
            P.install(_p.cmd)
            api = _p.cmd.tenmol_plugins
            try:
                pl.addmenuitemqt('Qt Tool', lambda: None)
                refused = None
            except Exception as exc:
                refused = type(exc).__name__
            status = api.status()
            print('OUT', json.dumps({
                'refused': refused,
                'haveQt': status['haveQt'],
                'note': status['qtNote'],
                'qtMenu': [m for m in api.menu()['menus'] if m['key'] == 'PluginQt'][0],
            }))
            """
        )
    )
    data = json.loads(out.stdout.split("OUT ", 1)[1])
    assert data["refused"] == "QtNotAvailableError"
    assert data["haveQt"] is False
    assert "server's display" in data["note"]
    assert data["qtMenu"]["items"] == []


def test_install_is_idempotent_and_uninstall_puts_ext_gui_back() -> None:
    out = _subprocess(
        _script(
            """
            first = P.install(_p.cmd)
            app = pymol._ext_gui
            second = P.install(_p.cmd)
            same = pymol._ext_gui is app
            pl.addmenuitem('Kept', lambda: None)
            kept = len(_p.cmd.tenmol_plugins.menu()['menus'][0]['items'])
            removed = P.uninstall(_p.cmd)
            print('OUT', json.dumps({
                'first': first, 'second': second, 'same': same, 'kept': kept,
                'removed': removed,
                'extGui': pymol._ext_gui,
                'attr': hasattr(_p.cmd, 'tenmol_plugins'),
                'afterMenu': None,
            }))
            """
        )
    )
    data = json.loads(out.stdout.split("OUT ", 1)[1])
    assert data["first"]["ok"] is True and data["second"] == data["first"]
    assert data["same"] is True, "a second install must not drop the registry"
    assert data["kept"] == 1
    assert data["removed"] is True
    assert data["extGui"] is None
    assert data["attr"] is False


# ===========================================================================
# Row 65 — what `stereo <mode>` does to a GL-BACKED engine
# ===========================================================================


def test_stereo_modes_against_a_real_gl_context(ws: Any, bridge: Any) -> None:
    """The measurement three waves recorded as impossible to take.

    Waves 8 and 9 left this row NOT ATTEMPTED with the same reason: "stereo is
    global, quadbuffer asks a context that has no quad buffers and openvr
    reaches for a VR runtime — any of which can take the one engine down and
    with it every other agent's tests".

    That risk assessment is FALSIFIED here, on this build.  Measured first in a
    throwaway GL-backed bridge (the e2e harness's, so a crash would have cost
    nothing) across all nine leaves of Display > Stereo Mode — anaglyph,
    crosseye, walleye, byrow, chromadepth, swap, quadbuffer, openvr, off:

        every one replied ok in under 2 ms, the engine stayed `running`, and
        `/healthz.draws` kept climbing by ~89 per 1.5 s (~59 fps) throughout.

    The two "dangerous" ones do not reach anything: PyMOL refuses them itself
    with a console error and changes no state.  Only after that was this test —
    which runs against the SHARED engine — written, and it still restores
    everything it touches.
    """
    before_stereo = ws.call("cmd.get", "stereo")
    before_mode = ws.call("cmd.get", "stereo_mode")
    ws.subscribe("feedback")
    try:
        # 1. The two the row calls impossible: refused BY PYMOL, no state change.
        for mode, needle in (
            ("quadbuffer", "no 'quadbuffer' support detected"),
            ("openvr", "'openvr' stereo mode not available"),
        ):
            ws.do("stereo %s" % mode)
            lines = bridge.wait_for_feedback(needle, timeout=5.0)
            assert any(needle in line for line in lines), (mode, lines[-4:])
            assert ws.call("cmd.get", "stereo") == "off"
            assert ws.call("cmd.get", "stereo_mode") == before_mode

        # 2. The software ones DO take effect, which is what makes Mode P
        #    (PyMOL renders, the browser shows pixels) able to honour them.
        #    `stereo_mode` values are `layer1/SettingInfo.h`'s: 2 crosseye,
        #    3 walleye, 10 anaglyph.
        for mode, expected in (("crosseye", "2"), ("walleye", "3"), ("anaglyph", "10")):
            ws.do("stereo %s" % mode)
            assert ws.call("cmd.get", "stereo") == "on", mode
            assert ws.call("cmd.get", "stereo_mode") == expected, mode

        # 3. And the engine is still drawing with stereo on — the question the
        #    row actually asks.  A pixels subscription is what makes the pump
        #    draw at all, so this is measured with one open.
        ws.subscribe("pixels")
        ws.do("turn y, 5")
        ws.pump_frames(1.2)
        health = bridge.healthz()
        assert health["state"] == "running"
        assert health["draws"] > 0
    finally:
        ws.do("stereo off")
        ws.do("set stereo_mode, %s" % before_mode)
        assert ws.call("cmd.get", "stereo") == before_stereo
        assert ws.call("cmd.get", "stereo_mode") == before_mode
