"""The colour system, asserted against a LIVE PyMOL.

Three parts:

    part 1  ``tenmol_bridge.panels.colors`` against the running engine —
            the 5388-slot table, the seven keywords, ramps, ``set_color``,
            ``spectrum``/``spectrumany``, ``cmd.space``, and PyMOL's own colour
            menu tree.
    part 2  the same facts over the WEBSOCKET, with the exact ``cmd.*`` calls
            the web client makes, because "the panel module works" and "the
            browser can get at it" are different claims (the panel module is
            NOT routable today — see the module docstring).
    part 3  the TypeScript port of ``menu.all_colors_list`` /
            ``rep_setting_lists`` / ``util._color_cycle`` /
            ``constants_palette.palette_dict``, diffed against the Python
            originals inside this process.  A drift in
            ``apps/web/src/features/colors/menuData.ts`` fails HERE.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_colors.py -q
"""

from __future__ import annotations

import ast
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tenmol_bridge.panels import colors as colorsvc  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
MENU_DATA_TS = REPO / "apps" / "web" / "src" / "features" / "colors" / "menuData.ts"
PROTOCOL_TS = REPO / "packages" / "protocol" / "src" / "topics" / "colors.ts"


@pytest.fixture(scope="module", autouse=True)
def _clean_up_objects(bridge: Any) -> Any:
    """Leave the shared session as we found it.

    The ``bridge`` fixture is session-scoped (one ``SingletonPyMOL`` per
    process), so every object this module creates is visible to every other
    test file.  Colours cannot be removed — ``set_color`` only appends — but
    objects can, and a stray ``object:ramp`` would change what
    ``cmd.get_names()`` returns for WP-12's tests.
    """
    yield

    def body(engine: Any) -> None:
        c = engine.require_pymol()
        for name in list(c.get_names("objects")):
            if name.startswith("tenmol_"):
                c.delete(name)

    on_engine(bridge, body, label="colors:cleanup")


@pytest.fixture(scope="module")
def cmd(bridge: Any) -> Any:
    """The engine's ``cmd``.  Every call below runs on the engine thread."""
    return bridge.pump.call(lambda engine: engine.require_pymol(), label="colors:cmd")


def on_engine(bridge: Any, fn: Any, label: str = "colors:test") -> Any:
    return bridge.pump.call(fn, label=label)


def builtin(entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Only the slots ``ColorReset`` registers.

    The session is shared by the whole pytest run and ``set_color`` APPENDS a
    new slot for every new name (measured: ``tenmol_wp22`` landed at index
    5388), so the table only grows.  Every count assertion below is therefore
    about the built-in region 0..5387, which is the part whose layout the Qt
    menus hardcode and the part a client caches by index.
    """
    return [e for e in entries if e["index"] < colorsvc.COLOR_TABLE_SIZE]


# --------------------------------------------------------------------------- #
# part 1 — the panel service against the engine
# --------------------------------------------------------------------------- #


def test_palette_is_5388_slots_with_the_hardcoded_landmarks(bridge: Any) -> None:
    """The index layout the Qt menus hardcode, checked rather than trusted."""
    entries = on_engine(bridge, lambda e: colorsvc.palette(e.require_pymol()))

    assert len(builtin(entries)) == colorsvc.COLOR_TABLE_SIZE == 5388
    assert len(entries) >= colorsvc.COLOR_TABLE_SIZE
    by_index = {entry["index"]: entry for entry in entries}
    # Dense, 0..5387 — the client indexes `entries[i]` directly.
    assert min(by_index) == 0
    assert max(by_index) >= 5387

    for name, index in colorsvc.COLOR_LANDMARKS.items():
        assert by_index[index]["name"] == name, (
            "slot %d is %r, not %r — the whole client palette cache is keyed on "
            "this layout" % (index, by_index[index]["name"], name)
        )

    assert by_index[0]["rgb"] == [1.0, 1.0, 1.0]  # white
    assert by_index[1]["rgb"] == [0.0, 0.0, 0.0]  # black
    # gray80 is grey, and the generator's step is 1/99, not 1/100
    # (Color.cpp:1161-1167), so it reads 0.80808..., not 0.80. That is exactly
    # the kind of thing a client must never compute for itself.
    grey = by_index[4236]["rgb"]
    assert grey[0] == grey[1] == grey[2]
    assert grey[0] == pytest.approx(80 / 99, abs=1e-5)


def test_named_colors_are_the_178_digit_free_names(bridge: Any) -> None:
    """``ColorGetStatus`` == 1 only when the name has no digits."""
    named = on_engine(bridge, lambda e: colorsvc.named_colors(e.require_pymol()))
    builtin_named = [
        (name, index) for name, index in named if index < colorsvc.COLOR_TABLE_SIZE
    ]
    assert len(builtin_named) == colorsvc.NAMED_COLOR_COUNT == 178
    assert all(not any(ch.isdigit() for ch in name) for name, _index in named)
    # ...which is why grey50/grey80/gray80 are NOT in this list even though the
    # menus reference them by index.
    names = {name for name, _ in named}
    assert "white" in names and "deepteal" in names
    assert "grey50" not in names and "gray80" not in names


def test_specials_resolve_live_and_auto_is_not_minus_two(bridge: Any) -> None:
    """The seven keywords, and the trap in two of them."""
    specials = on_engine(bridge, lambda e: colorsvc.specials(e.require_pymol()))
    by_word = {s["keyword"]: s for s in specials}
    assert sorted(by_word) == sorted(colorsvc.SPECIAL_KEYWORDS)

    # Constants (packages/engine/layer1/Color.h:36-44).
    assert by_word["default"]["index"] == -1
    assert by_word["atomic"]["index"] == -4
    assert by_word["object"]["index"] == -5
    assert by_word["front"]["index"] == -6
    assert by_word["back"]["index"] == -7

    # NOT constants: ColorGetIndex runs ColorGetNext/ColorGetCurrent
    # (Color.cpp:140,156) and hands back a real table index.
    assert by_word["auto"]["index"] >= 0, "auto resolved to a real slot, not -2"
    assert by_word["current"]["index"] >= 0

    # mode 4 flags a genuine special with a NEGATIVE red (ColorGetSpecial).
    assert by_word["front"]["rgb"][0] < 0
    assert by_word["back"]["rgb"][0] < 0
    assert by_word["auto"]["rgb"][0] >= 0


def test_inline_hex_colors_are_trgb_encoded(bridge: Any) -> None:
    """``0xRRGGBB`` becomes ``0x40RRGGBB``; the client decodes it with no round trip."""

    def body(engine: Any) -> Tuple[int, Any]:
        c = engine.require_pymol()
        return int(c.get_color_index("0xff8800")), c.get_color_tuple("0xff8800")

    index, rgb = on_engine(bridge, body)
    assert index & 0xC0000000 == 0x40000000
    assert index == 0x40FF8800
    assert rgb[0] == pytest.approx(1.0)
    assert rgb[1] == pytest.approx(0x88 / 255, abs=1e-3)
    assert rgb[2] == pytest.approx(0.0)


def test_define_sets_a_color_and_recolors(bridge: Any) -> None:
    """``set_color`` in 0..1 floats, then ``recolor``."""

    def body(engine: Any) -> Dict[str, Any]:
        return colorsvc.define(engine.require_pymol(), "tenmol_wp22", [0.25, 0.5, 0.75])

    result = on_engine(bridge, body)
    assert result["index"] >= colorsvc.COLOR_TABLE_SIZE, "a new name gets a new slot"
    assert result["rgb"][0] == pytest.approx(0.25, abs=1e-4)
    assert result["rgb"][2] == pytest.approx(0.75, abs=1e-4)

    # And it is now findable by name, which is what the editor's list needs.
    index = on_engine(
        bridge, lambda e: int(e.require_pymol().get_color_index("tenmol_wp22"))
    )
    assert index == result["index"]


def test_set_color_range_detection_is_the_trap_define_avoids(bridge: Any) -> None:
    """``viewing.py:2205-2207`` divides by 255 if ANY component exceeds 1.0."""

    def body(engine: Any) -> Tuple[Any, Any]:
        c = engine.require_pymol()
        c.set_color("tenmol_wp22_trap_a", [1, 1, 1])
        c.set_color("tenmol_wp22_trap_b", [1, 1, 2])
        return c.get_color_tuple("tenmol_wp22_trap_a"), c.get_color_tuple(
            "tenmol_wp22_trap_b"
        )

    white, nearly_black = on_engine(bridge, body)
    assert white == pytest.approx((1.0, 1.0, 1.0))
    # [1, 1, 2] is read as 0..255 and collapses to almost black. This is why
    # `define()` always sends floats.
    assert max(nearly_black) < 0.01


def test_spectrum_returns_its_range_and_falls_back_to_spectrumany(bridge: Any) -> None:
    """The C fast path, and the pure-Python path behind it."""

    def body(engine: Any) -> Dict[str, Any]:
        c = engine.require_pymol()
        c.delete("tenmol_spec")
        c.fragment("ala", "tenmol_spec")
        fast = colorsvc.spectrum(c, "count", "rainbow", "tenmol_spec")
        # An unresolvable "palette" IS the spectrumany entry point.
        anyres = colorsvc.spectrum_any(c, "count", "blue white red", "tenmol_spec")
        colours: List[int] = []
        c.iterate("tenmol_spec", "colours.append(color)", space={"colours": colours})
        c.delete("tenmol_spec")
        return {"fast": fast, "any": anyres, "colours": colours}

    result = on_engine(bridge, body)
    # 10 atoms in `ala`, count 1..10.
    assert result["fast"] == {"minimum": 1.0, "maximum": 10.0}
    assert result["any"]["maximum"] is not None

    # spectrumany writes PACKED 0x40RRGGBB colours via cmd.alter
    # (viewing.py:2053) — not table indices. The client must decode them.
    assert result["colours"], "spectrumany coloured nothing"
    assert all(c & 0xC0000000 == 0x40000000 for c in result["colours"]), [
        hex(c) for c in result["colours"][:4]
    ]


def test_cmd_has_no_spectrumany_attribute(cmd: Any) -> None:
    """The inventory says ``cmd.spectrumany``.  It does not exist.

    ``spectrumany`` is a module-level function in ``viewing.py`` that is never
    bound onto ``cmd``; the only caller is ``cmd.spectrum``'s fallback at
    ``viewing.py:2134``.  Recording it so nobody wires a UI to a missing symbol.
    """
    assert not hasattr(cmd, "spectrumany")
    assert hasattr(cmd, "spectrum")


def test_ramps_are_objects_with_a_negative_color_index(bridge: Any) -> None:
    """``ColorRegisterExt``: a ramp's colour index is ``-10 - slot``."""

    def body(engine: Any) -> Dict[str, Any]:
        c = engine.require_pymol()
        c.delete("tenmol_ramp_obj")
        c.delete("tenmol_ramp_map")
        c.fragment("ala", "tenmol_ramp_obj")
        c.map_new("tenmol_ramp_map", "gaussian", 1.0, "tenmol_ramp_obj", 6)
        c.ramp_new(
            "tenmol_ramp",
            "tenmol_ramp_map",
            [-1.0, 0.0, 1.0],
            ["red", "white", "blue"],
        )
        found = colorsvc.ramps(c)
        types = {n: c.get_type(n) for n in c.get_names("objects")}
        return {"ramps": found, "types": types}

    result = on_engine(bridge, body)
    names = {r["name"]: r for r in result["ramps"]}
    assert "tenmol_ramp" in names
    assert result["types"]["tenmol_ramp"] == "object:ramp"
    index = names["tenmol_ramp"]["index"]
    assert index <= -10, "a ramp index must be below cColorExtCutoff"
    assert (-10 - index) >= 0

    # ... and it round-trips as a colour: `color tenmol_ramp, sele` is legal.
    resolved = on_engine(
        bridge, lambda e: int(e.require_pymol().get_color_index("tenmol_ramp"))
    )
    assert resolved == index


def test_volume_ramp_presets(bridge: Any) -> None:
    """``colorramping.namedramps`` — the five volume presets."""
    names = on_engine(bridge, lambda _e: colorsvc.volume_ramp_names())
    assert names == ["2fofc", "esp", "fofc", "rainbow", "rainbow2"]


def test_space_remaps_every_color_through_the_lut(bridge: Any) -> None:
    """``cmd.space`` is why the client cannot keep a cached palette."""

    def body(engine: Any) -> Dict[str, Any]:
        c = engine.require_pymol()
        before = tuple(c.get_color_tuple(4))  # red
        grey = colorsvc.space(c, "greyscale")
        after = tuple(c.get_color_tuple(4))
        colorsvc.space(c, "rgb")
        restored = tuple(c.get_color_tuple(4))
        return {
            "before": before,
            "after": after,
            "restored": restored,
            "n": len(grey["colors"]),
        }

    result = on_engine(bridge, body)
    assert result["before"] == pytest.approx((1.0, 0.0, 0.0))
    assert result["after"] != pytest.approx(result["before"]), (
        "space greyscale did not change red — the LUT is not being applied"
    )
    assert result["after"][0] == pytest.approx(result["after"][1], abs=0.05)
    assert result["restored"] == pytest.approx((1.0, 0.0, 0.0))
    assert result["n"] >= colorsvc.COLOR_TABLE_SIZE


def test_menu_tree_is_pymols_own_and_lists_live_ramps(bridge: Any) -> None:
    """``pymol.menu.mol_color`` needs the cmd instance; this is the wrapper."""

    def body(engine: Any) -> Dict[str, Any]:
        c = engine.require_pymol()
        tree = colorsvc.menu_tree(c, "(all)", "mol_color")
        labels = [item[1] for item in tree if isinstance(item, list) and len(item) > 1]
        return {"tree": tree, "labels": labels}

    result = on_engine(bridge, body)
    labels = result["labels"]
    assert labels[0] == "Color:"
    for expected in ("by element", "by chain", "by ss  ", "by rep"):
        assert expected in labels, labels
    # `tenmol_ramp` was created by an earlier test in this module and PyMOL's
    # own `all_colors_generic` appends a ramps submenu when one exists.
    assert "ramps" in labels, labels

    with pytest.raises(ValueError):
        on_engine(bridge, lambda e: colorsvc.menu_tree(e.require_pymol(), "x", "nope"))


def test_snapshot_matches_the_ColorsPayload_shape(bridge: Any) -> None:
    payload = on_engine(bridge, lambda e: colorsvc.snapshot(e.require_pymol()))
    assert set(payload) == {"colors", "ramps", "full"}
    assert payload["full"] is True
    assert len(builtin(payload["colors"])) == colorsvc.COLOR_TABLE_SIZE
    assert all(set(c) == {"index", "name", "rgb"} for c in payload["colors"][:5])
    assert all(set(r) == {"name", "object"} for r in payload["ramps"])


# --------------------------------------------------------------------------- #
# part 2 — the calls the browser actually makes, over the socket
# --------------------------------------------------------------------------- #


def test_web_client_can_build_the_palette_over_the_wire(bridge: Any, ws: Any) -> None:
    """Exactly what ``features/colors/palette.ts`` does, over a real socket.

    This is the load-bearing test for the client: ``panels/colors.py`` is not
    reachable through ``Dispatcher.resolve`` today, so the browser has to get
    the table from plain ``cmd.*`` calls.  If the policy or the dispatcher ever
    stopped allowing one of these four, the colour feature would go dark.
    """
    all_pairs = ws.call("get_color_indices", all=1)
    named_pairs = ws.call("get_color_indices", all=0)
    assert len([p for p in all_pairs if p[1] < 5388]) == 5388
    assert len([p for p in named_pairs if p[1] < 5388]) == 178

    # Pipelined, exactly like the client's `Promise.all` chunks.
    ids = [ws.send(t="call", fn="get_color_tuple", args=[i], kwargs={}) for i in range(256)]
    tuples = [ws.wait_reply(i) for i in ids]
    assert all(reply["t"] == "ok" for reply in tuples)
    assert tuples[0]["result"] == [1.0, 1.0, 1.0]

    assert ws.call("get_color_index", "front") == -6
    assert ws.call("get_color_tuple", -6, 4)[0] < 0


def test_web_client_color_writes_over_the_wire(bridge: Any, ws: Any) -> None:
    """`color_deep`, the per-rep settings write, and the util helpers."""
    ws.call("delete", "tenmol_ws")
    ws.call("fragment", "ala", "tenmol_ws")
    # `util.colors('jmol')` below mutates GLOBAL state (six element colours and
    # `auto_color`) in a session every other test file shares, so snapshot it.
    before_elements = {
        name: ws.call("get_color_tuple", name)
        for name in ("hydrogen", "carbon", "nitrogen", "oxygen", "fluorine", "sulfur")
    }
    before_auto = ws.call("get", "auto_color")

    # A swatch click.  `color_deep` first unsets every per-rep colour setting
    # (viewing.py:1948-1976) — which is why the menu uses it and not `color`.
    ws.call("color_deep", "red", "tenmol_ws")
    colours: Any = ws.call("get_color_index", "red")
    assert colours == 4

    # "by rep" writes SETTINGS.
    ws.call("set", "cartoon_color", "blue", "tenmol_ws", quiet=0)
    assert ws.call("get", "cartoon_color", "tenmol_ws") == "blue"
    ws.call("unset", "cartoon_color", "tenmol_ws", quiet=0)

    # by element / by ss / by chain helpers.
    for fn, args in (
        ("util.cnc", ["tenmol_ws"]),
        ("util.cba", [33, "tenmol_ws"]),
        ("util.cbh", ["tv_red", "tenmol_ws"]),
        ("util.cbss", ["tenmol_ws", "red", "yellow", "green"]),
        ("util.color_chains", ["(tenmol_ws)"]),
        ("util.chainbow", ["(tenmol_ws)"]),
        ("util.color_objs", ["(tenmol_ws)"]),
        # `color_by_area` builds a temporary surface object and spectrums by
        # area (util.py:80-119); it is the slowest entry in the spectrum menu
        # and the one most likely to break silently.
        ("util.color_by_area", ["tenmol_ws", "molecular"]),
        # `util.colors('jmol')` REDEFINES six element colours and recolors
        # (util.py:1029-1040) -- i.e. it mutates the palette, which is why the
        # client refetches the whole table after it.
        ("util.colors", ["jmol"]),
    ):
        reply = ws.call_reply(fn, *args)
        assert reply["t"] == "ok", (fn, reply)

    # jmol really did move `carbon`.
    carbon = ws.call("get_color_tuple", "carbon")
    assert carbon[0] == pytest.approx(0.567, abs=1e-3)

    # ...and put it back, along with `auto_color`.
    for name, rgb in before_elements.items():
        ws.call("set_color", name, list(rgb))
    ws.call("set", "auto_color", before_auto)
    ws.call("recolor")
    assert ws.call("get_color_tuple", "carbon") == pytest.approx(
        before_elements["carbon"]
    )

    ws.call("delete", "tenmol_ws")


def test_web_client_spectrum_over_the_wire(bridge: Any, ws: Any) -> None:
    ws.call("delete", "tenmol_ws2")
    ws.call("fragment", "ala", "tenmol_ws2")
    assert ws.call("spectrum", "count", "rainbow", "tenmol_ws2", quiet=0) == [1.0, 10.0]
    # The spectrumany path, reached the only way it can be reached.
    reply = ws.call_reply("spectrum", "count", "blue white red", "tenmol_ws2")
    assert reply["t"] == "ok", reply
    ws.call("delete", "tenmol_ws2")


# --------------------------------------------------------------------------- #
# part 3 — the TypeScript port, diffed against the Python originals
# --------------------------------------------------------------------------- #


def _ts_block(source: str, marker: str) -> str:
    """The array literal assigned by ``marker``.

    Scanning starts at the ``= [`` and not at the marker, because the type
    annotation in between carries its own brackets (``readonly Palette[]``) and
    a naive bracket count closes on those instead.
    """
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
    raise AssertionError("unterminated literal after %r" % marker)


def test_ts_port_matches_pymol_source() -> None:
    """``menuData.ts`` is a hand port.  This is what keeps it honest."""
    import pymol.constants_palette as constants_palette
    import pymol.menu as pymol_menu
    import pymol.util as pymol_util

    source = MENU_DATA_TS.read_text()

    # -- all_colors_list: nine groups, in order, with identical pairs --------
    block = _ts_block(source, "export const ALL_COLORS_LIST")
    # `[ 'reds', [` on one line or spread over three — prettier decides.
    ts_groups = re.findall(r"\[\s*'(\w+)',\s*\[", block)
    ts_pairs = re.findall(r"\['(\d{3})', '(\w+)'\]", block)
    py_groups = [name for name, _ in pymol_menu.all_colors_list]
    py_pairs = [pair for _n, lst in pymol_menu.all_colors_list for pair in lst]
    assert ts_groups == py_groups
    assert ts_pairs == [(a, b) for (a, b) in py_pairs]

    # -- rep_setting_lists --------------------------------------------------
    block = _ts_block(source, "export const REP_SETTING_LISTS")
    ts_reps = re.findall(r"\['([\w]*)', '([\w]*)'\]", block)
    py_reps = [pair for lst in pymol_menu.rep_setting_lists for pair in lst]
    assert ts_reps == py_reps

    # -- util._color_cycle --------------------------------------------------
    block = _ts_block(source, "export const COLOR_CYCLE")
    ts_cycle = [int(n) for n in re.findall(r"\d+", block)]
    assert ts_cycle == list(pymol_util._color_cycle)
    assert len(ts_cycle) == 40

    # -- constants_palette.palette_dict -------------------------------------
    block = _ts_block(source, "export const PALETTES")
    ts_palettes = {
        name: (prefix, int(digits), int(first), int(last))
        for name, prefix, digits, first, last in re.findall(
            r"\{ name: '([\w]+)', prefix: '(\w)', digits: (\d+), "
            r"first: (\d+), last: (\d+) \}",
            block,
        )
    }
    assert ts_palettes == dict(constants_palette.palette_dict)
    assert len(ts_palettes) == 60, "the inventory says 57; this tree has 60"

    # -- palette_colors_dict ------------------------------------------------
    from pymol import viewing  # noqa: F401  (module import for the dict below)

    py_colors_dict = _palette_colors_dict()
    ts_colors_dict = dict(
        re.findall(r"^  (\w+): '([^']+)',$", source, re.MULTILINE)
    )
    for name, value in py_colors_dict.items():
        assert ts_colors_dict.get(name) == value, name

    # -- namedramps ---------------------------------------------------------
    from pymol.colorramping import namedramps

    block = _ts_block(source, "export const VOLUME_RAMPS")
    assert sorted(re.findall(r"'([\w]+)'", block)) == sorted(namedramps)

    # -- by_elem pages: the util.cba indices and util.cbh names -------------
    ts_pages = re.findall(r"title: '([^']+)',\n    kind: '(\w+)',", source)
    assert [t for t, _k in ts_pages] == [
        "set 1",
        "set 2",
        "set 3",
        "set 4",
        "set 5",
        "set 6/H",
    ]
    ts_cba = [int(n) for n in re.findall(r"index: (\d+) \}", source)]
    py_cba = _by_elem_indices(pymol_menu)
    assert ts_cba == py_cba


def _palette_colors_dict() -> Dict[str, str]:
    """``viewing.palette_colors_dict`` lives inside a function-scope block."""
    return {
        "rainbow_cycle": "magenta blue cyan green yellow orange red magenta",
        "rainbow_cycle_rev": "magenta red orange yellow green cyan blue magenta",
        "rainbow": "blue cyan green yellow orange red",
        "rainbow_rev": "red orange yellow green cyan blue",
        "rainbow2": "blue cyan green yellow orange red",
        "rainbow2_rev": "red orange yellow green cyan blue",
        "gcbmry": "green cyan blue magenta red yellow",
        "yrmbcg": "yellow red magenta blue cyan green",
        "cbmr": "cyan blue magenta red",
        "rmbc": "red magenta blue cyan",
    }


def _by_elem_indices(pymol_menu: Any) -> List[int]:
    """Every ``util.cba(<index>, ...)`` the six by-element pages emit, in order.

    Read out of the live menu functions rather than out of the file, so this
    tracks the real tree.  ``by_elem`` page 1 also carries the ``util.cnc``
    entry, which has no index and is therefore skipped.
    """
    out: List[int] = []
    pages = [
        pymol_menu.by_elem,
        pymol_menu.by_elem2,
        pymol_menu.by_elem3,
        pymol_menu.by_elem4,
        pymol_menu.by_elem5,
    ]
    for page in pages:
        for item in page(None, "(all)"):
            if len(item) < 3 or not isinstance(item[2], str):
                continue
            hit = re.match(r"util\.cba\((\d+),", item[2])
            if hit:
                out.append(int(hit.group(1)))
    return out


def test_protocol_constants_match_the_c_header() -> None:
    """``topics/colors.ts`` mirrors ``packages/engine/layer1/Color.h:36-47`` exactly."""
    source = PROTOCOL_TS.read_text()
    values = {
        name: ast.literal_eval(value.replace("0x", "0x"))
        for name, value in re.findall(
            r"export const (C_COLOR_\w+) = (-?[\w]+);", source
        )
    }
    assert values == {
        "C_COLOR_DEFAULT": -1,
        "C_COLOR_NEW_AUTO": -2,
        "C_COLOR_CUR_AUTO": -3,
        "C_COLOR_ATOMIC": -4,
        "C_COLOR_OBJECT": -5,
        "C_COLOR_FRONT": -6,
        "C_COLOR_BACK": -7,
        "C_COLOR_EXT_CUTOFF": -10,
        "C_COLOR_TRGB_BITS": 0x40000000,
        "C_COLOR_TRGB_MASK": 0xC0000000,
    }

    # ...and the header really does say so.  They are ``#define``s, not enum
    # members (``packages/engine/layer1/Color.h:36-47``), and ``cColorExtCutoff`` is
    # parenthesised, so the pattern allows both spellings.
    header = (REPO / "packages" / "engine" / "layer1" / "Color.h").read_text()
    for name, literal in (
        ("cColorDefault", "-1"),
        ("cColorNewAuto", "-2"),
        ("cColorCurAuto", "-3"),
        ("cColorAtomic", "-4"),
        ("cColorObject", "-5"),
        ("cColorFront", "-6"),
        ("cColorBack", "-7"),
        ("cColorExtCutoff", "-10"),
    ):
        pattern = r"#define\s+%s\s+\(?%s\)?" % (name, re.escape(literal))
        assert re.search(pattern, header), name
    assert re.search(r"#define\s+cColor_TRGB_Bits\s+0x40000000", header)
    assert re.search(r"#define\s+cColor_TRGB_Mask\s+0xC0000000", header)
