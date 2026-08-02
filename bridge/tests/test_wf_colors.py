"""The Colours EDITOR dialog — ``Setting > Colors...`` — against a live PyMOL.

Row 72 of ``docs/webclient/00-parity-inventory.md``.  The desktop dialog is
``PyMOLQtGUI.edit_colors_dialog`` (``modules/pmg_qt/pymol_qt_gui.py:547-611``)
over ``modules/pmg_qt/forms/colors.ui``: a sorted list, a name box, three
spinboxes, three sliders, a swatch and Apply.  Nine ``connect()`` calls hold it
together, and every one of them bottoms out in a ``cmd.*`` call that this file
measures over the WebSocket, because that is the only surface the browser has.

What this pins, and why each one can break the web editor silently:

  * ``list_colors`` is ``cmd.get_color_indices()`` — mode 1, *names with no
    digit in them* — and NOT ``all=1``.  A new colour rejoins that list only if
    its name is digit-free, so the client's list model cannot be a plain
    refetch (see ``editorNames`` in ``features/colors/palette.ts``).
  * ``load_color`` is ``get_color_index`` + ``get_color_tuple``, and
    ``ColorGetIndex`` is not a dictionary lookup: prefixes, case, ``0xRRGGBB``
    and bare integers all resolve.  A local table lookup is not a substitute.
  * ``get_color_tuple`` answers **None** for the four negative keywords, which
    is a live TypeError in the desktop dialog and the reason the web client
    guards ``index < 0`` rather than ``index == -1``.
  * Apply is ONE ``cmd.do`` carrying two commands separated by a newline.  That
    it runs both is a property of the parser, not of the bridge, so it is
    asserted from the console output.
  * ``%.2f`` is the format the desktop prints, and the client writes it with
    ``Number.prototype.toFixed(2)``; the two are diffed here over every value
    the dialog can produce.

Run::

    bridge/.venv/bin/python -m pytest bridge/tests/test_wf_colors.py -q
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, List

import pytest

REPO = Path(__file__).resolve().parents[2]
QT_GUI_PY = REPO / "modules" / "pmg_qt" / "pymol_qt_gui.py"
COLORS_UI = REPO / "modules" / "pmg_qt" / "forms" / "colors.ui"
PALETTE_TS = REPO / "apps" / "web" / "src" / "features" / "colors" / "palette.ts"

#: ``ColorReset`` builds slots 0..5387; everything past that is a definition
#: made in this process.  Colours cannot be deleted — ``set_color`` only ever
#: appends — so every count below is about the built-in region, and the names
#: this module defines are prefixed so no other test file can collide with them.
COLOR_TABLE_SIZE = 5388
MINE = "tenmol_wfcolors"

#: The six built-ins `util.colors('jmol')` redefines, which a later `.pse`
#: restore re-registers at high slots. Named rather than counted, so a SEVENTH
#: name going missing fails instead of being absorbed.
PRISTINE_NAMED = {"carbon", "fluorine", "hydrogen", "nitrogen", "oxygen", "sulfur"}
PRISTINE_BUILTIN = PRISTINE_NAMED


def builtin_names(pairs: List[Any]) -> List[str]:
    return [name for name, index in pairs if index < COLOR_TABLE_SIZE]


def rehomed(pairs: List[Any]) -> List[str]:
    """Built-in names that a session restore moved ABOVE the built-in region.

    THE COUNTS BELOW ARE NOT CONSTANTS OF THE PROCESS, and that is not a bug in
    this file. `cmd.set_color` cannot be undone, and loading a .pse re-registers
    every colour the session carries — so a built-in name that some earlier test
    marked as a session colour (`util.colors('jmol')` does this to carbon,
    fluorine, hydrogen, nitrogen, oxygen and sulfur) comes back at a NEW high
    slot and vanishes from the built-in region for the rest of the run.

    Measured: with `test_colors.py` and a `.pse` round trip both ahead of this
    file, 178/5388 became 172/5382 — exactly those six names. So the assertions
    allow the region to SHRINK by names that reappear higher up, and still fail
    on anything else.
    """
    high = {name for name, index in pairs if index >= COLOR_TABLE_SIZE}
    return sorted(high)


# --------------------------------------------------------------------------- #
# list_colors
# --------------------------------------------------------------------------- #


def test_list_colors_is_the_digit_free_names_not_the_whole_table(ws: Any) -> None:
    """``form.list_colors`` is filled from ``cmd.get_color_indices()``.

    Mode 1 keeps ``ColorGetStatus(a) == 1`` (``layer4/Cmd.cpp:1341``), and that
    status is -1 as soon as the name contains a digit
    (``layer1/Color.cpp:784-800``).  178 of the 5388 built-in slots qualify.
    """
    named = ws.call("get_color_indices")
    every = ws.call("get_color_indices", all=1)

    # 178 and 5388 in a pristine session; see `rehomed` for why each may be
    # short by names that a session restore moved above the built-in region.
    moved = set(rehomed(every))
    assert len(builtin_names(named)) + len(moved & PRISTINE_NAMED) == 178
    assert len(builtin_names(every)) + len(moved & PRISTINE_BUILTIN) == COLOR_TABLE_SIZE
    assert all(not any(ch.isdigit() for ch in name) for name, _ in named)

    # The Qt list is sorted by QListWidget itself (`setSortingEnabled(True)`),
    # which is `QString::operator<` — code units, case-sensitive, i.e. exactly
    # Python's `sorted()`.  `compareColorNames` in palette.ts is that compare;
    # the two ends of the order are the interesting part, because they are the
    # only non-plain-lowercase names in the set.
    ordered = sorted(builtin_names(named))
    assert ordered[0] == "_deepsalmon", "the leading underscore sorts first"
    assert ordered[-1] == "zirconium"
    assert [n for n in ordered if n.startswith("tv")] == [
        "tv_blue", "tv_green", "tv_orange", "tv_red", "tv_yellow",
    ], "the underscore names, where a locale-aware collation could disagree"


def test_a_new_colour_joins_that_list_only_when_its_name_has_no_digit(ws: Any) -> None:
    """The Qt dialog appends every new name to the list widget by hand.

    A refetch reproduces that for a digit-free name and CANNOT for a name with a
    digit — which is why the web list adds every slot past the built-in table
    itself (``editorNames``).
    """
    before = len(ws.call("get_color_indices"))

    ws.call("set_color", MINE + "_plain", [0.1, 0.2, 0.3])
    ws.call("set_color", MINE + "_2digit", [0.1, 0.2, 0.3])
    after = ws.call("get_color_indices")
    listed = {name for name, _ in after}

    assert MINE + "_plain" in listed
    assert MINE + "_2digit" not in listed
    assert len(after) == before + 1

    # Both are in the full table, both past the built-in region.
    everything = {name: index for name, index in ws.call("get_color_indices", all=1)}
    assert everything[MINE + "_plain"] >= COLOR_TABLE_SIZE
    assert everything[MINE + "_2digit"] >= COLOR_TABLE_SIZE


# --------------------------------------------------------------------------- #
# input_name -> load_color
# --------------------------------------------------------------------------- #


def test_load_color_resolution_is_ColorGetIndex_not_a_dict_lookup(ws: Any) -> None:
    """Every keystroke in ``input_name`` runs this.

    ``ColorGetIndex`` (``layer1/Color.cpp:661-748``) tries, in order: a bare
    integer, ``0x``-hex, the seven keywords, an exact case-sensitive hit, then a
    case-insensitive PREFIX scan.  These are the answers this build gives, and
    they are the fixtures ``features/colors/editor.test.ts`` asserts against.
    """
    got = {name: ws.call("get_color_index", name) for name in (
        "red", "RED", "Red", "re", "r", "gr", "", "zzz", "reddd",
        " red", "red ", "0xff8800", "104", "grey50", "s0001",
    )}

    assert got["red"] == got["RED"] == got["Red"] == 4, "exact, then case-insensitive"
    assert got["re"] == 4, "a PREFIX resolves — the box loads red while you type"
    assert got["gr"] == 3, "first match wins: green, not grey"
    assert got["r"] == 4
    assert got[""] == 1, "an EMPTY name is black, not a miss — clearing the box loads it"
    assert got["zzz"] == -1 and got["reddd"] == -1
    assert got[" red"] == -1 and got["red "] == -1, "no trimming anywhere"
    assert got["0xff8800"] == 0x40FF8800 == 1090488320
    assert got["104"] == 104, "a bare integer is an index"
    assert got["grey50"] == 104, "...and it is the same slot grey50 occupies"
    assert got["s0001"] == -1, "the generated bands are not reachable by name"

    # ...and the second half of load_color, for the two that are not table slots.
    assert ws.call("get_color_tuple", 4) == [1.0, 0.0, 0.0]
    inline = ws.call("get_color_tuple", 1090488320)
    assert inline[0] == pytest.approx(1.0)
    assert inline[1] == pytest.approx(0x88 / 255, abs=1e-6)
    assert inline[2] == pytest.approx(0.0)


def test_get_color_tuple_is_None_for_the_four_negative_keywords(ws: Any) -> None:
    """A live defect in the desktop dialog, and the reason our guard is wider.

    ``load_color`` returns early only on -1 (``pymol_qt_gui.py:557-558``).
    ``atomic``/``object``/``front``/``back`` resolve to -4/-5/-6/-7, and mode 0
    of ``CmdGetColor`` builds a result only ``if(index >= 0)``
    (``layer4/Cmd.cpp:1336``), so ``get_color_tuple`` hands back None and
    ``rgb[0]`` raises ``TypeError`` inside the ``textChanged`` handler.
    """
    for keyword, index in (
        ("default", -1),
        ("atomic", -4),
        ("object", -5),
        ("front", -6),
        ("back", -7),
    ):
        assert ws.call("get_color_index", keyword) == index
        reply = ws.call_reply("get_color_tuple", index)
        assert reply["t"] == "ok", reply
        assert reply["result"] is None, (
            "get_color_tuple(%d) answered %r; the Qt dialog would have indexed it"
            % (index, reply["result"])
        )

    # `auto` and `current` are the two keywords that are NOT constants: they
    # resolve to a real slot, so the name box loads a real colour for them.
    for keyword in ("auto", "current"):
        index = ws.call("get_color_index", keyword)
        assert index >= 0
        assert len(ws.call("get_color_tuple", index)) == 3


# --------------------------------------------------------------------------- #
# button_apply
# --------------------------------------------------------------------------- #


def test_apply_is_one_cmd_do_that_runs_set_color_AND_recolor(bridge: Any, ws: Any) -> None:
    """``self.cmd.do('set_color %s, [%.2f, %.2f, %.2f]\\nrecolor')``.

    The browser sends it as ``{t:'call', fn:'do'}`` (``ColorEditor.apply``), so
    that is what is sent here.  The embedded newline is two commands in one
    submission; the console is the proof that both ran.
    """
    name = MINE + "_apply"
    reply = ws.call_reply("do", "set_color %s, [0.12, 0.34, 0.56]\nrecolor" % name)
    assert reply["t"] == "ok", reply
    assert reply["dangerous"] is True, "cmd.do is policy-flagged, and still allowed"

    lines = bridge.wait_for_feedback("PyMOL>set_color %s" % name, timeout=5.0)
    tail = [line for line in lines if name in line or line == "PyMOL>recolor"]
    assert "PyMOL>set_color %s, [0.12, 0.34, 0.56]" % name in tail
    assert ' Color: "%s" defined as [ 0.120, 0.340, 0.560 ].' % name in tail, (
        "set_color ran, and through cmd.do it is not quiet: %r" % (tail,)
    )
    # The second line of the same submission.
    first = lines.index("PyMOL>set_color %s, [0.12, 0.34, 0.56]" % name)
    assert "PyMOL>recolor" in lines[first : first + 4], lines[first : first + 4]

    index = ws.call("get_color_index", name)
    assert index >= COLOR_TABLE_SIZE, "a brand-new name gets a brand-new slot"
    rgb = ws.call("get_color_tuple", index)
    assert rgb == pytest.approx([0.12, 0.34, 0.56], abs=1e-6)

    # Apply again on the SAME name: it edits the slot, it does not append.
    # (This is what the dialog's `findItems` test is for — a known name is not
    # added to the list twice.)
    assert ws.call_reply("do", "set_color %s, [0.90, 0.10, 0.20]\nrecolor" % name)["t"] == "ok"
    assert ws.call("get_color_index", name) == index
    assert ws.call("get_color_tuple", index) == pytest.approx([0.90, 0.10, 0.20], abs=1e-6)


def test_set_color_from_the_dialog_never_takes_the_255_branch(ws: Any) -> None:
    """The dialog can only ever send 0..1, which matters.

    ``viewing.py`` divides by 255 when ANY component exceeds 1.0, so a UI that
    handed it 0..255 would work by accident and then break on a dark colour.
    The spinboxes' ``maximum`` is 1.0 and the web editor clamps to the same
    range; this is the assertion that the 0..1 branch is the one taken.
    """
    ws.call("set_color", MINE + "_ones", [1, 1, 1])
    assert ws.call("get_color_tuple", MINE + "_ones") == [1.0, 1.0, 1.0]


def test_toFixed_2_is_pythons_percent_2f(ws: Any) -> None:
    """``%.2f`` (desktop) vs ``toFixed(2)`` (browser), over the whole domain.

    The dialog can only produce two families of value: the 101 slider positions
    ``k/100``, and — in the web editor's extra hex field — the 256 values
    ``k/255``.  Rounding disagreement between the two languages would make the
    browser write a different colour than the desktop for the same swatch.
    """
    node = shutil.which("node")
    if not node:
        pytest.skip("no node on PATH to run the JS half of this diff")

    values = [k / 255 for k in range(256)] + [k / 100 for k in range(101)]
    expected = ["%.2f" % v for v in values]

    script = (
        "const v=JSON.parse(process.argv[1]);"
        "process.stdout.write(JSON.stringify(v.map(x=>x.toFixed(2))));"
    )
    out = subprocess.run(
        [node, "-e", script, json.dumps(values)],
        capture_output=True, text=True, check=True, timeout=60,
    )
    assert json.loads(out.stdout) == expected

    # ...and PyMOL parses what that produces back to the same float.
    ws.call("set_color", MINE + "_fmt", [float("%.2f" % (0x88 / 255)), 0.0, 1.0])
    assert ws.call("get_color_tuple", MINE + "_fmt") == pytest.approx(
        [0.53, 0.0, 1.0], abs=1e-6
    )


# --------------------------------------------------------------------------- #
# the Qt side, pinned from the checked-in sources
# --------------------------------------------------------------------------- #
#
# There is no Qt binding in this checkout (PyQt5/6 and PySide2/6 all fail to
# import in the bridge venv), so the widget behaviour cannot be OBSERVED here.
# What can be pinned is the declaration and the code that drives it, so that an
# upstream change to either shows up as a failure next to the port.


def _ui_widgets(text: str) -> Dict[str, str]:
    """``name -> class`` for every widget declared in a ``.ui`` file."""
    return {name: cls for cls, name in re.findall(r'<widget class="(\w+)" name="(\w+)"', text)}


def _ui_block(text: str, name: str) -> str:
    """The declaration of one LEAF widget: from its tag to the next ``</widget>``.

    Every widget read below is a leaf (spin boxes and sliders hold properties,
    not children), so this needs no XML parser — and the file is a fixed part of
    the upstream tree, not input.
    """
    start = text.index('name="%s"' % name)
    return text[start : text.index("</widget>", start)]


def _ui_prop(block: str, key: str) -> Any:
    found = re.search(
        r'<property name="%s">\s*<\w+>([^<]*)</\w+>\s*</property>' % key, block
    )
    return found.group(1) if found else None


def test_colors_ui_declares_the_widgets_the_web_editor_mirrors() -> None:
    text = COLORS_UI.read_text()
    kinds = _ui_widgets(text)

    assert kinds["list_colors"] == "QListWidget"
    assert kinds["frame_color"] == "QFrame"
    assert kinds["input_name"] == "QLineEdit"
    assert kinds["button_apply"] == "QPushButton"

    for channel in "RGB":
        spin = _ui_block(text, "input_" + channel)
        slider = _ui_block(text, "slider_" + channel)
        assert kinds["input_" + channel] == "QDoubleSpinBox"
        assert kinds["slider_" + channel] == "QSlider"
        assert float(_ui_prop(spin, "maximum")) == 1.0
        assert float(_ui_prop(spin, "singleStep")) == 0.01
        # No `decimals` property, so the box keeps Qt's default of 2 -- which is
        # the whole reason `run()` can print with %.2f and be telling the truth,
        # and the reason `quantiseChannels` exists on the web side.
        assert _ui_prop(spin, "decimals") is None
        assert int(_ui_prop(slider, "maximum")) == 100


def test_edit_colors_dialog_still_does_what_the_port_says_it_does() -> None:
    source = QT_GUI_PY.read_text()
    body = source[source.index("def edit_colors_dialog") : source.index("def open_builder_panel")]

    # Apply: %.2f, the embedded newline, and `recolor` in the same submission.
    assert "'set_color %s, [%.2f, %.2f, %.2f]\\nrecolor'" in body
    # The list: get_color_indices() with NO argument, sorted by the widget.
    assert "form.list_colors.setSortingEnabled(True)" in body
    assert "self.cmd.get_color_indices()" in body
    assert "get_color_indices(all" not in body
    # load_color: the -1 early return that this port widens to `index < 0`.
    assert re.search(r"index = self\.cmd\.get_color_index\(name\)\s+if index == -1:\s+return", body)
    # The two directions, and the lock that stops them oscillating.
    assert "spinbox.setValue(value / 100.)" in body
    assert "form.slider_R.setValue(round(R * 100))" in body
    assert "spinbox_lock[0] = True" in body and "spinbox_lock[0] = False" in body
    # frame_color: `%d` on a float TRUNCATES (127 for 0.5), where the web's
    # `rgbToCss` rounds (128).  One 255th, in a preview swatch only -- the value
    # Apply writes is identical.  Recorded, not fixed.
    assert '"background-color: rgb(%d,%d,%d)"' in body
    assert "R * 0xFF" in body
    assert "%d" % (0.5 * 0xFF) == "127"

    # The six connections the React component reproduces.
    for signal in (
        "form.slider_R.valueChanged.connect",
        "form.input_R.valueChanged.connect",
        "form.input_name.textChanged.connect(load_color)",
        "form.list_colors.currentTextChanged.connect(form.input_name.setText)",
        "form.button_apply.clicked.connect(run)",
    ):
        assert signal in body


def test_the_ported_module_still_names_the_calls_it_depends_on() -> None:
    """A cheap tripwire on the port itself.

    ``features/colors/palette.ts`` is the only place the editor's engine calls
    live.  If one is renamed away, this fails next to the live tests above
    rather than in a browser.
    """
    ts = PALETTE_TS.read_text()
    for needle in (
        "export function compareColorNames",
        "export function editorNames",
        "export function quantiseChannels",
        "export function applyLine",
        "export async function resolveColorName",
        "get_color_index",
        "get_color_tuple",
        "\\nrecolor",
    ):
        assert needle in ts, needle


def test_this_module_leaks_nothing_into_the_built_in_table(ws: Any) -> None:
    """Housekeeping, asserted rather than assumed.

    ``set_color`` cannot be undone — there is no ``delete_color`` — so the names
    this file defines stay in the shared session for the rest of the pytest run.
    Every one of them must land PAST slot 5387, because that is the invariant
    every other colour test filters on (``builtin()`` in ``test_colors.py``).
    """
    mine = {
        name: index
        for name, index in ws.call("get_color_indices", all=1)
        if name.startswith(MINE)
    }
    assert mine, "this module defines colours; if it stops, drop this test too"
    assert all(index >= COLOR_TABLE_SIZE for index in mine.values()), mine
    # ...and the built-in region is untouched: still 5388 slots, still the same
    # names in them.  (RGB is deliberately NOT asserted here -- `cmd.space`
    # remaps every value through the LUT, and that global belongs to
    # `test_colors.py::test_space_remaps_every_color_through_the_lut`.)
    every = ws.call("get_color_indices", all=1)
    moved = set(rehomed(every))
    assert len(builtin_names(every)) + len(moved & PRISTINE_BUILTIN) == COLOR_TABLE_SIZE
    by_index = {index: name for name, index in every}
    assert by_index[0] == "white" and by_index[4] == "red" and by_index[104] == "grey50"
