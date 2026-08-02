"""Wave 8, area 5 — settings & colours, the gaps waves 4-7 left open.

Six claims, each measured against the LIVE engine over the real WebSocket,
each the gap clause of one PARTIAL row in ``docs/feature-parity.md``:

    row 223  the 5388-slot table is BROWSABLE, not just sampled: the twelve
             regions ``ColorReset`` lays down are where ``palette.ts`` says.
    row 229  ``cmd.volume_color`` over the five ``colorramping.namedramps``
             against a REAL ``object:volume`` (wave 4 wired it and never ran it).
    row 230  the ten fixed-carbon shortcuts ``util.cbag``..``cbak`` — including
             the one thing that makes them not ``util.cba`` in disguise.
    row 231  the by-element pages, the spectrum / auto / chain / ss entries and
             ``mesh_color``'s negative-colour submenu, applied and measured.
    row 211  ``cmd.alter`` / ``cmd.alter_state`` writes, and the atom-STATE
             level ``cmd.set`` cannot reach at all.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_p8_a5.py -q
"""

from __future__ import annotations

import inspect
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

REPO = Path(__file__).resolve().parents[3]
COLORS_TS = REPO / "apps" / "web" / "src" / "features" / "colors"
MENU_DATA_TS = COLORS_TS / "menuData.ts"
PALETTE_TS = COLORS_TS / "palette.ts"
CCP4 = REPO / "packages" / "engine" / "testing" / "data" / "emd_1155.ccp4"

#: Every object this file makes starts with this.  The suite shares ONE PyMOL
#: process, so a stray object changes what `cmd.get_names()` answers for every
#: other test file (WP-12 counts them).
PREFIX = "p8a5"


@pytest.fixture(scope="module", autouse=True)
def _restore_session(bridge: Any) -> Any:
    """Save the camera, delete our objects, and put both back.

    ``cmd.load`` of a map auto-zooms (``auto_zoom`` is on by default), which
    moves the CAMERA — a global the movie/scene/camera tests read.  ``cmd.load``
    does not reset the view for us, so it is saved here explicitly.
    """
    from pymol import cmd

    view = cmd.get_view()
    yield
    for name in list(cmd.get_names("objects")):
        if name.startswith(PREFIX):
            cmd.delete(name)
    cmd.set_view(view)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def atom_colors(selection: str) -> List[Tuple[str, str, int]]:
    """``[(name, elem, color_index)]`` for a selection, straight from iterate."""
    from pymol import cmd

    out: List[Tuple[str, str, int]] = []
    cmd.iterate(selection, "out.append((name, elem, color))", space={"out": out})
    return out


def carbon_colors(selection: str) -> set:
    return {c for _n, e, c in atom_colors(selection) if e == "C"}


def make_fragment(ws: Any, name: str, fragment: str = "trp") -> str:
    """A private object to recolour, always in a known colour state."""
    ws.call("delete", name)
    ws.call("fragment", fragment, name)
    ws.call("color", "grey50", name)
    return name


def ts_block(source: str, marker: str) -> str:
    start = source.index(marker)
    open_at = source.index("= [", start) + 2
    depth = 0
    for i in range(open_at, len(source)):
        if source[i] == "[":
            depth += 1
        elif source[i] == "]":
            depth -= 1
            if depth == 0:
                return source[open_at : i + 1]
    raise AssertionError("unterminated array for %s" % marker)


# ---------------------------------------------------------------------------
# row 230 — the ten fixed-carbon shortcuts
# ---------------------------------------------------------------------------


def util_shortcut_colors() -> Dict[str, str]:
    """The colour each ``cbaX`` hard-codes, read out of util.py's own source.

    Reading the source rather than hard-coding the answer is the point: this is
    what makes the TS table a PORT and not a copy that drifts.
    """
    import pymol.util as util

    out: Dict[str, str] = {}
    for name in ("cbag", "cbac", "cbam", "cbay", "cbas", "cbaw", "cbab", "cbao", "cbap", "cbak"):
        src = inspect.getsource(getattr(util, name))
        colors = re.findall(r'cmd\.color\("(\w+)","\(elem C', src)
        assert len(colors) == 1, (name, colors)
        out[name] = colors[0]
    return out


def test_the_ten_fixed_carbon_shortcuts_are_ported_name_for_name() -> None:
    """``FIXED_CARBON_SHORTCUTS`` is util.py:442-510, in order."""
    block = ts_block(MENU_DATA_TS.read_text(), "export const FIXED_CARBON_SHORTCUTS")
    ts = re.findall(r"\{ fn: '(\w+)', color: '(\w+)' \}", block)
    assert [fn for fn, _c in ts] == [
        "cbag",
        "cbac",
        "cbam",
        "cbay",
        "cbas",
        "cbaw",
        "cbab",
        "cbao",
        "cbap",
        "cbak",
    ]
    assert dict(ts) == util_shortcut_colors()


def test_the_ten_shortcut_colours_resolve_to_these_slots() -> None:
    """The indices the web fixture in `p8cmenu.dom.test.tsx` stands on."""
    from pymol import cmd

    assert {name: cmd.get_color_index(name) for name in sorted(set(util_shortcut_colors().values()))} == {
        "brightorange": 30,
        "carbon": 26,
        "cyan": 5,
        "hydrogen": 29,
        "lightmagenta": 154,
        "pink": 48,
        "purple": 19,
        "salmon": 9,
        "slate": 11,
        "yellow": 6,
    }
    assert cmd.get_color_index("tv_red") == 32


def test_every_fixed_carbon_shortcut_recolours_carbons_over_the_wire(ws: Any) -> None:
    """All ten called as the C menu calls them, with the result measured.

    Non-carbons go to ``atomic`` — which is not one index but the per-element
    ones (measured on a `trp` fragment: N=27, O=28, H=29) — and carbons go to
    the shortcut's own colour.
    """
    from pymol import cmd

    name = make_fragment(ws, PREFIX + "_short")
    expected = util_shortcut_colors()
    seen: Dict[str, int] = {}
    for fn, color in expected.items():
        ws.call("color", "grey50", name)  # so an inert call would show up
        assert carbon_colors(name) == {104}
        ws.call("util." + fn, name)
        want = cmd.get_color_index(color)
        assert carbon_colors(name) == {want}, fn
        assert {c for _n, e, c in atom_colors(name) if e == "N"} == {27}, fn
        seen[fn] = want
    # ten shortcuts, and they are not all the same colour
    assert len(seen) == 10
    assert len(set(seen.values())) >= 9
    ws.call("delete", name)


def test_the_fixed_carbon_shortcuts_leave_the_object_colour_alone(ws: Any) -> None:
    """The one behavioural difference from ``util.cba``.

    ``cba`` ends with ``cmd.color(color, sel, flags=1)`` (util.py:518-524),
    which writes the OBJECT colour rec; the ten shortcuts (util.py:442-510) do
    not.  MEASURED: after ``util.cbag`` the object was still 104 (grey50);
    after ``util.cba(33, …)`` it was 33.
    """
    from pymol import cmd

    name = make_fragment(ws, PREFIX + "_objcol")
    assert cmd.get_object_color_index(name) == 104
    ws.call("util.cbag", name)
    assert cmd.get_object_color_index(name) == 104, "cbag must not touch the object colour"
    ws.call("util.cba", 33, name)
    assert cmd.get_object_color_index(name) == 33, "cba must touch the object colour"
    ws.call("delete", name)


# ---------------------------------------------------------------------------
# row 231 — the by-element pages, spectrum / auto / chain / ss, and negative
# ---------------------------------------------------------------------------


def by_elem_pages() -> Tuple[List[int], List[str]]:
    """The cba indices and the cbh names, out of the live ``pymol.menu``.

    ``by_elem`` (menu.py:400-418) is page 1 INLINE plus five nested pages, so
    this walks the tree rather than the top level — page 1's own eight entries
    are siblings of the ``set 2``..``set 6/H`` submenus, not children of them.
    ``by_elem`` takes the cmd instance and never uses it, so ``None`` is fine.
    """
    import pymol.menu as pymol_menu

    indices: List[int] = []
    names: List[str] = []

    def walk(items: Any) -> None:
        for item in items:
            if len(item) < 3:
                continue
            target = item[2]
            if isinstance(target, list):
                walk(target)
                continue
            if not isinstance(target, str):
                continue
            hit = re.match(r"util\.cba\((\d+),", target)
            if hit:
                indices.append(int(hit.group(1)))
            hit = re.match(r'util\.cbh\("([\w]+)",', target)
            if hit:
                names.append(hit.group(1))

    walk(pymol_menu.by_elem(None, "(all)"))
    return indices, names


def test_the_six_by_element_pages_are_the_ones_the_menu_builds() -> None:
    """40 cba indices over 5 pages + 8 cbh names on page 6, matching menuData.ts."""
    indices, names = by_elem_pages()
    assert len(indices) == 40
    assert len(names) == 8

    source = MENU_DATA_TS.read_text()
    block = ts_block(source, "export const BY_ELEM_PAGES")
    assert [int(n) for n in re.findall(r"index: (\d+) \}", block)] == indices
    assert re.findall(r"name: '(\w+)' \}", block) == names


def test_all_48_by_element_entries_actually_recolour(ws: Any) -> None:
    """Every tile on all six pages, applied live — the reviewer's open item.

    Wave 4 exercised ONE of them (`util.cba(33, …)`).  This runs all 48 and
    checks the two things the menu promises: carbons (or hydrogens, on page 6)
    land on the named index, and the object colour follows, because every
    by-element entry is a ``cba``/``cbh`` and both end with ``flags=1``.
    """
    from pymol import cmd

    import pymol.util as util

    indices, names = by_elem_pages()
    name = make_fragment(ws, PREFIX + "_elem")

    for index in indices:
        ws.call("color", "grey50", name)
        ws.call("util.cba", index, name)
        assert carbon_colors(name) == {index}, index
        assert cmd.get_object_color_index(name) == index, index

    for color_name in names:
        ws.call("color", "grey50", name)
        ws.call("util.cbh", color_name, name)
        want = cmd.get_color_index(color_name)
        hydrogens = {c for _n, e, c in atom_colors(name) if e == "H"}
        assert hydrogens == {want}, color_name
        assert cmd.get_object_color_index(name) == want, color_name
        # The carbons went through the `atomic` pass, and `atomic` does NOT mean
        # slot 26 for carbon: `AtomInfoGetColor` returns `G->AtomInfo->CColor`,
        # which `AtomInfoUpdateAutoColor` sets to `ColorGetNext(G)` whenever
        # `auto_color` is on (`packages/engine/layer2/AtomInfo.cpp:1340-1347`) — i.e. the auto
        # cycle, advanced once per object created in the process.  MEASURED: the
        # same call answered 26 in a one-test run and 154 in a whole-file run,
        # so this asserts membership of the cycle, not a fixed index.
        carbons = carbon_colors(name)
        assert len(carbons) == 1 and carbons <= set(util._color_cycle), (color_name, carbons)

    ws.call("delete", name)


def test_the_by_chain_and_by_ss_and_auto_entries_move_real_colours(ws: Any) -> None:
    """`util.color_chains` / `chainbow` / `cbss` / `color_objs` / `color auto`.

    Two chains are made by hand, because a `fragment` has none, and the two
    chains must end up in DIFFERENT colours — that is the whole claim of
    "by chain", and a call that silently did nothing would pass a smoke test.
    """
    from pymol import cmd
    import pymol.util as util

    name = make_fragment(ws, PREFIX + "_chain")
    cmd.alter(name + " and name CA+CB+CG+N+C+O", "chain='A'")
    cmd.alter(name + " and not chain A", "chain='B'")
    cmd.sort(name)
    assert sorted(cmd.get_chains(name)) == ["A", "B"]

    ws.call("util.color_chains", "(%s)" % name)
    a = {c for n, _e, c in atom_colors(name + " and chain A")}
    b = {c for n, _e, c in atom_colors(name + " and chain B")}
    assert len(a) == 1 and len(b) == 1 and a != b, (a, b)
    assert a | b <= set(util._color_cycle)

    ws.call("color", "grey50", name)
    ws.call("util.chainbow", "(%s)" % name)
    assert carbon_colors(name) != {104}, "chainbow spectrums each chain byres"

    # by ss: a trp fragment has no H or S, so everything is the LOOP colour.
    ws.call("util.cbss", name, "red", "yellow", "green")
    assert {c for _n, _e, c in atom_colors(name)} == {cmd.get_color_index("green")}

    ws.call("color", "grey50", name)
    ws.call("util.color_objs", "(%s)" % name)
    assert carbon_colors(name) != {104}
    assert cmd.get_object_color_index(name) in set(util._color_cycle)

    ws.call("color", "grey50", name)
    ws.call("color", "auto", name)
    assert carbon_colors(name) != {104}
    ws.call("delete", name)


def test_the_spectrum_submenu_entries_all_run_and_spread_colours(ws: Any) -> None:
    """`spectrum count/b` and `util.color_by_area`, the exact calls the menu makes."""
    name = make_fragment(ws, PREFIX + "_spec")

    ws.call("spectrum", "count", selection="(%s)&elem C" % name)
    spread = carbon_colors(name)
    assert len(spread) > 1, "rainbow over carbons must not be one colour"

    ws.call("color", "grey50", name)
    ws.call("spectrum", "count", selection=name, byres=1)
    assert carbon_colors(name) != {104}

    ws.call("color", "grey50", name)
    ws.call("spectrum", "b", selection=name, quiet=0)
    assert {c for _n, _e, c in atom_colors(name)} != {104}

    ws.call("color", "grey50", name)
    ws.call("util.color_by_area", name, "molecular")
    assert {c for _n, _e, c in atom_colors(name)} != {104}
    ws.call("delete", name)


def test_the_negative_colour_submenu_writes_exactly_two_settings(ws: Any) -> None:
    """`pymol.menu.mesh_color` — menu.py:696-712.

    One menu item, two writes, and the ORDER matters: `_negative_visible` first,
    then `_negative_color`.  Both reps the C menu can land on are checked
    (`cObjectMesh` -> rep 'mesh', `cObjectSurface` -> rep 'surface',
    `packages/engine/layer3/Executive.cpp:15249-15256`).
    """
    from pymol import cmd

    name = make_fragment(ws, PREFIX + "_neg")
    for rep in ("mesh", "surface"):
        visible, color = rep + "_negative_visible", rep + "_negative_color"
        assert cmd.get_setting_int(visible, name) == 0
        # the "off" entry
        ws.call("set", visible, 0, name, quiet=0)
        assert cmd.get_setting_int(visible, name) == 0
        # a colour entry: both writes, in order
        ws.call("set", visible, 1, name, quiet=0)
        ws.call("set", color, "tv_red", name, quiet=0)
        assert cmd.get_setting_int(visible, name) == 1, rep
        assert cmd.get_setting_int(color, name) == cmd.get_color_index("tv_red"), rep
        # and off again really turns it off
        ws.call("set", visible, 0, name, quiet=0)
        assert cmd.get_setting_int(visible, name) == 0, rep

    # the menu is built for exactly these two reps and no other
    source = MENU_DATA_TS.read_text()
    assert re.search(r"export const NEGATIVE_REPS = \['mesh', 'surface'\]", source)
    ws.call("delete", name)


def test_mesh_color_is_the_menu_a_mesh_object_really_gets() -> None:
    """The claim the negative submenu rests on, checked in pymol.menu's source."""
    import pymol.menu as pymol_menu

    src = inspect.getsource(pymol_menu.mesh_color)
    assert "def mesh_color(self_cmd, name, rep='mesh')" in src
    # the colour entries: visible=1 FIRST, then the colour — one menu item, two writes
    assert (
        'cmd.set("%s_negative_visible",1,"%s",quiet=0);'
        'cmd.set("%s_negative_color","{0}","%s",quiet=0)' in src.replace("'\n            '", "")
    )
    # and an `off` entry that writes 0 and nothing else
    assert re.search(
        r"'off',\s*'cmd\.set\(\"%s_negative_visible\",0,\"%s\",quiet=0\);'\s*%\s*\(rep, name\)",
        src,
    )


# ---------------------------------------------------------------------------
# row 223 — the twelve regions of the 5388-slot table
# ---------------------------------------------------------------------------


def ts_regions() -> List[Dict[str, Any]]:
    block = ts_block(PALETTE_TS.read_text(), "export const COLOR_REGIONS")
    out = []
    for hit in re.finditer(
        r"\{\s*id: '([\w]+)',\s*label: '([^']*)',\s*first: (\d+),\s*count: (\d+),", block
    ):
        out.append(
            {
                "id": hit.group(1),
                "label": hit.group(2),
                "first": int(hit.group(3)),
                "count": int(hit.group(4)),
            }
        )
    return out


def test_the_twelve_colour_regions_are_where_ColorReset_puts_them(ws: Any) -> None:
    """`palette.ts:COLOR_REGIONS` against the live table, boundary by boundary.

    The browser pages through these; a region that is one slot out shows the
    wrong 200 colours and nothing complains.  So every region is checked for
    (a) contiguity, (b) the name at its first and last slot, and (c) that the
    twelve together tile 0..5387 with no gap and no overlap.
    """
    pairs = ws.call("get_color_indices", all=1)
    # THE BUILT-IN REGION ONLY.  `set_color` appends and cannot be undone (there
    # is no `delete_color`), so by the time this runs in the whole suite the
    # table is longer than 5388 — measured 5391 in a full run.  Every colour
    # test in this tree filters the same way (`builtin_names`, test_wf_colors.py).
    by_index = {int(index): str(name) for name, index in pairs if int(index) < 5388}
    assert len(by_index) == 5388, "six missing names would mean a set_color on a built-in"

    regions = ts_regions()
    assert len(regions) == 12

    covered: List[int] = []
    for region in regions:
        first, count = region["first"], region["count"]
        for i in range(first, first + count):
            assert i in by_index, (region["id"], i)
        covered.extend(range(first, first + count))

    assert sorted(covered) == list(range(5388)), "the regions must tile the table exactly"

    # the landmarks the inventory row names, read from the live table
    assert by_index[0] == "white"
    assert by_index[54] == "grey00" and by_index[153] == "grey99"
    assert by_index[154] == "lightmagenta"
    assert by_index[155] == "s000" and by_index[1154] == "s999"
    assert by_index[1155] == "r000" and by_index[2154] == "r999"
    assert by_index[2155] == "c000" and by_index[3154] == "c999"
    assert by_index[3155] == "w000" and by_index[4154] == "w999"
    assert by_index[4155] == "density"
    assert by_index[4156] == "gray00" and by_index[4255] == "gray99"
    assert by_index[4256] == "o000" and by_index[5255] == "o999"
    assert by_index[5256] == "paleyellow" and by_index[5280] == "darksalmon"
    # the element block starts at HELIUM, not hydrogen: `hydrogen` is one of the
    # 54 core names (index 29) and ColorReset does not repeat it.
    assert by_index[5281] == "helium"
    assert [by_index[i] for i in (5385, 5386, 5387)] == ["deuterium", "lonepair", "pseudoatom"]


def test_every_generated_band_slot_the_browser_shows_has_a_colour(ws: Any) -> None:
    """A page of the browser is 200 real RGB values, not 200 blanks.

    The client caches every tuple at bootstrap, so this checks the assumption
    that makes the browser free: `get_color_tuple` answers for every slot in
    the generated bands, including the last one of the last band.
    """
    for index in (155, 1154, 1155, 2154, 2155, 3154, 3155, 4154, 4256, 5255, 5387):
        tuple_ = ws.call("get_color_tuple", index)
        assert isinstance(tuple_, list) and len(tuple_) == 3, index
        assert all(0.0 <= float(v) <= 1.0 for v in tuple_), (index, tuple_)


# ---------------------------------------------------------------------------
# row 229 — volume ramps against a real volume object
# ---------------------------------------------------------------------------


def test_volume_color_over_the_five_named_ramps_on_a_real_volume(ws: Any) -> None:
    """The half of row 229 wave 4 wired and never ran.

    A gaussian `map_new` map is NOT enough — measured: `volume`, `isomesh` and
    `isosurface` on one all return None and create NO object, silently.  A real
    CCP4 map does work, so this loads `packages/engine/testing/data/emd_1155.ccp4`.

    `cmd.volume_color(name, preset)` with no ramp READS (colorramping.py:123),
    so the same verb the panel writes with is the one that verifies it.
    """
    from pymol import cmd
    from pymol.colorramping import namedramps, ramp_expand

    assert CCP4.exists(), CCP4
    vol, map_name = PREFIX + "_vol", PREFIX + "_map"
    ws.call("delete", map_name)
    ws.call("delete", vol)
    ws.call("load", str(CCP4), map_name)
    ws.call("volume", vol, map_name)
    assert ws.call("get_type", vol) == "object:volume"

    assert sorted(namedramps) == ["2fofc", "esp", "fofc", "rainbow", "rainbow2"]
    for preset in sorted(namedramps):
        ws.call("volume_color", vol, preset)
        got = ws.call("volume_color", vol)
        want = ramp_expand(namedramps[preset])
        assert len(got) == len(want), preset
        assert all(abs(float(g) - float(w)) < 1e-5 for g, w in zip(got, want)), preset

    # and the panel's list is that dict, not a copy that drifted
    block = ts_block(MENU_DATA_TS.read_text(), "export const VOLUME_RAMPS")
    assert sorted(re.findall(r"'([\w]+)'", block)) == sorted(namedramps)

    ws.call("delete", vol)
    ws.call("delete", map_name)
    assert vol not in cmd.get_names("objects")


def test_a_volume_ramp_is_not_a_colour_slot(ws: Any) -> None:
    """Why the volume side is a different mechanism with a similar name.

    `ramp_new` registers a colour EXTENSION and `get_color_index` answers -10-slot
    for it (wave 4 measured -10).  A volume's ramp is not in the colour table at
    all: `get_color_index` on the volume object answers -1.
    """
    vol, map_name = PREFIX + "_vol2", PREFIX + "_map2"
    ws.call("load", str(CCP4), map_name)
    ws.call("volume", vol, map_name)
    assert ws.call("get_color_index", vol) == -1
    ws.call("delete", vol)
    ws.call("delete", map_name)


# ---------------------------------------------------------------------------
# row 211 — alter / alter_state, and the atom-state level
# ---------------------------------------------------------------------------


def test_the_seventeen_atom_state_settings_are_the_ones_we_think() -> None:
    from pymol import cmd

    names = [
        n
        for n in cmd.setting.get_name_list()
        if cmd._cmd.get_setting_level(cmd.setting._get_index(n)) == "atom-state"
    ]
    assert len(names) == 17
    assert "label_screen_point" in names
    assert cmd.setting._get_index("label_screen_point") == 728  # setting.py:519-526


def test_alter_writes_an_atom_level_override_and_del_removes_it(ws: Any) -> None:
    """`cmd.alter` with `s[...]`, over the wire, with the reply checked.

    The reply is the ATOM COUNT the expression ran on — 1 here — which is the
    only acknowledgement the client gets, and what `describeAtomWriteResult`
    renders.
    """
    from pymol import cmd

    name = make_fragment(ws, PREFIX + "_alter")
    index = cmd.setting._get_index("sphere_scale")

    assert ws.call("alter", "%s and name CA" % name, "s['sphere_scale']=3.5") == 1
    defined = {n: ids for n, ids in _atom_indices(name)}
    assert defined["CA"] == [index]
    assert defined["CB"] == []
    assert cmd.get_setting_float("sphere_scale", name) == 1.0, "atom scope, not object"

    assert ws.call("alter", "%s and name CA" % name, "del s['sphere_scale']") == 1
    assert dict(_atom_indices(name))["CA"] == []
    ws.call("delete", name)


def test_alter_state_is_the_only_path_to_an_atom_state_setting(ws: Any) -> None:
    """The claim row 211 rests on, measured four ways on ONE setting.

    `label_screen_point` is atom-state level (index 728, the one
    `setting.py:519-526` names). The four writes that could plausibly reach it:

    1. `cmd.set(name, value, selection)`  lands on the ATOM  — a real override,
       but not the per-state one, and `iterate_state` never sees it.
    2. `cmd.alter` with `s[...]`          lands on the ATOM too.
    3. `cmd.alter_state` with `s[...]`    lands on the ATOM-STATE. Only this one.
    4. `del s[...]` inside `alter_state`  removes it, and `cmd.unset` cannot.

    Which is also why the client cannot LIST atom-state overrides: the bridge's
    scope RPC reads `list(s)` inside plain `cmd.iterate`
    (`panels/settings.py:760`) and that `s` is the atom's.
    """
    from pymol import cmd

    name = make_fragment(ws, PREFIX + "_astate")
    index = cmd.setting._get_index("label_screen_point")
    assert cmd._cmd.get_setting_level(index) == "atom-state"

    # 1. cmd.set over a selection: ATOM level, invisible to iterate_state
    ws.call("set", "label_screen_point", "(9.0, 9.0, 9.0)", "%s and name CB" % name)
    assert dict(_atom_indices(name))["CB"] == [index]
    assert dict(_state_indices(name, 1))["CB"] == [], "cmd.set does not reach atom-state"

    # 2. plain alter: same level as cmd.set
    assert ws.call("alter", "%s and name CG" % name, "s['label_screen_point']=(4.0,5.0,6.0)") == 1
    assert dict(_atom_indices(name))["CG"] == [index]
    assert dict(_state_indices(name, 1))["CG"] == [], "alter does not reach atom-state either"

    # 3. alter_state: the atom-state table, on an atom with no atom-level entry
    n = ws.call(
        "alter_state", 1, "%s and name CD1" % name, "s['label_screen_point']=(1.0, 2.0, 3.0)"
    )
    assert n == 1
    assert dict(_state_indices(name, 1))["CD1"] == [index]
    assert _state_value(name, 1, "CD1", "label_screen_point") == (1.0, 2.0, 3.0)
    assert dict(_atom_indices(name))["CD1"] == [], "and it is NOT visible to plain iterate"

    # 4. del s[...] inside alter_state — the documented escape hatch
    assert ws.call("alter_state", 1, "%s and name CD1" % name, "del s['label_screen_point']") == 1
    assert dict(_state_indices(name, 1))["CD1"] == []
    ws.call("delete", name)


def test_the_literals_the_client_builds_are_the_ones_pymol_accepts(ws: Any) -> None:
    """One expression per kind, in the exact shape `atomSettings.ts` emits.

    float3 `(1.0, 2.0, 3.0)`, float `0.5`, int `2`, boolean `1`, colour by NAME
    `'tv_red'`.  The colour one is the interesting case: the wrapper resolves a
    string through `ColorGetIndex`, so the client can send a name and does.
    """
    from pymol import cmd

    name = make_fragment(ws, PREFIX + "_lit")
    cases = [
        ("label_screen_point", "s['label_screen_point']=(1.0, 2.0, 3.0)", (1.0, 2.0, 3.0)),
        ("label_multiline_spacing", "s['label_multiline_spacing']=0.5", 0.5),
        ("label_relative_mode", "s['label_relative_mode']=2", 2),
        ("label_bg_outline", "s['label_bg_outline']=1", 1),
        ("label_bg_color", "s['label_bg_color']='tv_red'", cmd.get_color_index("tv_red")),
    ]
    for setting, expression, want in cases:
        assert ws.call("alter_state", 1, "%s and name CB" % name, expression) == 1, expression
        assert _state_value(name, 1, "CB", setting) == want, expression
    ws.call("delete", name)


def _atom_indices(selection: str) -> List[Tuple[str, List[int]]]:
    from pymol import cmd

    out: List[Tuple[str, List[int]]] = []
    cmd.iterate(selection, "out.append((name, list(s)))", space={"out": out})
    return out


def _state_indices(selection: str, state: int) -> List[Tuple[str, List[int]]]:
    from pymol import cmd

    out: List[Tuple[str, List[int]]] = []
    cmd.iterate_state(state, selection, "out.append((name, list(s)))", space={"out": out})
    return out


def _state_value(selection: str, state: int, atom: str, setting: str) -> Any:
    from pymol import cmd

    out: List[Any] = []
    cmd.iterate_state(
        state,
        "%s and name %s" % (selection, atom),
        "out.append(s[%r])" % setting,
        space={"out": out},
    )
    assert len(out) == 1, out
    return out[0]


# ---------------------------------------------------------------------------
# row 212 — session / defaults lifecycle
# ---------------------------------------------------------------------------

LIFECYCLE_TS = REPO / "apps" / "web" / "src" / "features" / "settings" / "sessionLifecycle.ts"
SETTING_CPP = REPO / "packages" / "engine" / "layer1" / "Setting.cpp"


def test_the_reinit_codes_and_menu_labels_are_pymols_own() -> None:
    """`REINIT_CODES` is `commanding.py:350-356`; the menu is `_gui.py:126-132`.

    The labels do NOT match the words — "Stored Settings" runs
    `reinitialize settings` and "Original Settings" runs
    `reinitialize original_settings` — so the pairing is diffed, not assumed.
    """
    import pymol.commanding as commanding

    source = LIFECYCLE_TS.read_text()
    ts_codes = {
        name: int(code)
        for name, code in re.findall(r"^  (\w+): (\d+),$", source, re.MULTILINE)
    }
    assert ts_codes == dict(commanding.reinit_code)

    ts_menu = re.findall(r"label: '([^']+)',\n    what: '(\w+)',", source)
    py_menu = _gui_reinitialize_menu()
    assert ts_menu == py_menu
    assert ("Stored Settings", "settings") in ts_menu
    assert ("Original Settings", "original_settings") in ts_menu


def _gui_reinitialize_menu() -> List[Tuple[str, str]]:
    """The four `File > Reinitialize` leaves, out of `pymol._gui`'s source."""
    import pymol._gui as gui

    src = inspect.getsource(gui)
    start = src.index("('menu', 'Reinitialize', [")
    end = src.index("]),", start)
    block = src[start:end]
    out: List[Tuple[str, str]] = []
    for label, target in re.findall(r"\('command', '([^']+)',\s*([^)]+)\)", block):
        target = target.strip().rstrip(",").strip()
        if target == "cmd.reinitialize":
            out.append((label, "everything"))
        else:
            out.append((label, target.strip("'").split()[-1]))
    return out


def test_the_session_blacklist_port_matches_setting_cpp() -> None:
    """`SESSION_BLACKLIST` is the `case cSetting_*:` list, in source order.

    There is NO Python accessor for `is_session_blacklisted` — it is a `static
    bool` (`packages/engine/layer1/Setting.cpp:627`) — so the client has to carry the list, and
    this is the only thing standing between that list and silent drift.
    """
    src = SETTING_CPP.read_text()
    start = src.index("static bool is_session_blacklisted(int index)")
    end = src.index("\n}", src.index("return false;", start))
    body = src[start:end]
    # `async_builds` is inside `#if defined(_PYMOL_ACTIVEX)` and is NOT compiled
    # into any build this client will ever talk to.
    body = re.sub(r"#if defined\(_PYMOL_ACTIVEX\).*?#endif", "", body, flags=re.S)
    cases = re.findall(r"case cSetting_(\w+):", body)

    block = ts_block(LIFECYCLE_TS.read_text(), "export const SESSION_BLACKLIST")
    ts = re.findall(r"'(\w+)'", block)
    assert ts == cases
    assert len(ts) == 45


def test_a_blacklisted_setting_never_reaches_the_session_dump(ws: Any) -> None:
    """The predicate, OBSERVED, without a C accessor.

    `SettingAsPyList` (`Setting.cpp:956-975`) writes one entry per setting whose
    `defined` flag is set, and `get_list` drops it when
    `is_session_blacklisted(index)` (`:921`).  So: mark two settings defined —
    one blacklisted, one not — and see which of them makes it into
    `cmd.get_session()['settings']`.

    Both are written to THEIR OWN CURRENT VALUE.  The shared engine cannot tell
    the difference (nothing changes but the `defined` bit, which is what this
    test is about), and no other test can be affected by it.
    """
    from pymol import cmd

    blacklisted, control = "cache_max", "dot_density"
    ws.call("set", blacklisted, cmd.get_setting_int(blacklisted))
    ws.call("set", control, cmd.get_setting_int(control))

    session = cmd.get_session(
        names=PREFIX + "_no_such_object", partial=0, quiet=1, cache=0, version=1.9
    )
    defined = {int(row[0]) for row in session["settings"]}

    assert cmd.setting._get_index(control) in defined
    assert cmd.setting._get_index(blacklisted) not in defined

    # and every name the port lists is absent for the same reason (they are all
    # in the same switch), while nothing at a real level is dropped by accident
    block = ts_block(LIFECYCLE_TS.read_text(), "export const SESSION_BLACKLIST")
    checked = 0
    for name in re.findall(r"'(\w+)'", block):
        try:
            index = cmd.setting._get_index(name)
        except Exception:  # noqa: BLE001
            # Not in `setting.get_name_list()` at all — an unused-level record,
            # which `is_session_blacklisted` drops by its FIRST rule anyway.
            continue
        checked += 1
        assert index not in defined, name
    assert checked >= 40, checked


def test_the_live_ramps_section_of_the_c_menu_really_colours(ws: Any) -> None:
    """`all_colors_generic`'s ramps section — menu.py:625-636, the last of the
    six submenus the wave-4 reviewer left unverified.

    A ramp is registered as a colour EXTENSION (`ColorRegisterExt`,
    `packages/engine/layer1/Color.cpp:347`) with index `-10 - slot`, so picking one out of the
    ramps section is an ordinary `cmd.color_deep(name, sele)` whose result is a
    NEGATIVE colour index on every atom — which is why `resolveColor` in
    `palette.ts` refuses to invent an RGB for it: the colour is evaluated per
    vertex from (position, state) by `ColorGetRamped`.
    """
    from pymol import cmd

    map_name, ramp = PREFIX + "_rmap", PREFIX + "_ramp"
    name = make_fragment(ws, PREFIX + "_rmol")
    ws.call("load", str(CCP4), map_name)
    ws.call("ramp_new", ramp, map_name, [1.0, 2.0, 3.0], ["red", "white", "blue"])

    assert ws.call("get_type", ramp) == "object:ramp"
    index = ws.call("get_color_index", ramp)
    assert index <= -10, index
    # `loadRamps` in palette.ts is this scan: get_names -> get_type -> index
    live = [n for n in ws.call("get_names", "objects") if ws.call("get_type", n) == "object:ramp"]
    assert ramp in live

    ws.call("color_deep", ramp, name, quiet=0)
    assert {c for _n, _e, c in atom_colors(name)} == {index}

    ws.call("delete", ramp)
    ws.call("delete", map_name)
    ws.call("delete", name)
