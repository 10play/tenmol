"""Parity area 1/2 — window shell, External GUI dock, internal GUI column, gutter.

Inventory rows pinned here (``docs/00-parity-inventory.md``):

* **53** Main window shell / dock layout (``packages/engine/modules/pmg_qt/pymol_qt_gui.py:88``)
* **54** External GUI dock: toggle dockable / visible (``:171``)
* **88** Internal GUI layout column (``packages/engine/layer1/Ortho.cpp:2261-2340``)
* **103** Control-bar left gutter: drag-resize + double-click collapse
  (``packages/engine/layer1/Control.cpp:443-478``)

Three of the four rows describe **Qt machinery that cannot exist in a browser**
(a ``QMainWindow``, a ``QDockWidget``, a ``QShortcut``).  What is testable — and
what this file tests — is the BACKEND CONTRACT the React replacement stands on:

* the invocation options the Qt window sizes itself from, and the fact that the
  bridge deliberately zeroes two of them;
* that ``pymol.gui.ext_hide`` / ``ext_show`` are still the *printed* no-ops the
  row describes, because the bridge's ``get_qtwindow()`` shim makes PyMOL take
  the "a Qt window exists" branch;
* the exact pixel arithmetic ``OrthoReshape`` applies for ``internal_gui``,
  ``internal_gui_width``, ``internal_gui_mode``, ``internal_feedback`` and
  ``movie_panel`` — MEASURED over the socket, not read off the C++;
* that ``cmd.set('internal_gui_width', n)`` is NOT clamped, so the min-5 floor
  in ``Control.cpp`` is the client's job.

SHARED-STATE WARNING.  Every setting touched here is a PyMOL global in the one
process the whole suite shares.  ``shell_settings`` snapshots and restores them
and re-asserts the scene rectangle afterwards; do not add a test here that
writes one of them outside that fixture.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_wf_shell.py -q
"""

from __future__ import annotations

import os
import re
import sys
import time
from typing import Dict, List, Tuple

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import RunningBridge, WSClient  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
QT_GUI = os.path.join(REPO, "packages", "engine", "modules", "pmg_qt", "pymol_qt_gui.py")

#: Settings this file writes.  Snapshotted and restored by ``shell_settings``.
TOUCHED = (
    "internal_gui",
    "internal_gui_width",
    "internal_gui_mode",
    "internal_feedback",
    "movie_panel",
    "movie_panel_row_height",
    "mouse_grid",
)

#: ``packages/engine/layer1/Ortho.h:24-26`` — the DIP constants the arithmetic below is made of.
ORTHO_RIGHT_SCENE_MARGIN = 220
ORTHO_BOTTOM_SCENE_MARGIN = 18
ORTHO_LINE_HEIGHT = 12
#: ``packages/engine/layer1/Control.cpp:46`` — NOT a DIP value, a raw 5.
CONTROL_MIN_WIDTH = 5


# --------------------------------------------------------------- helpers


def tagged(ws: WSClient, tag: str, line: str, timeout: float = 6.0) -> List[str]:
    """``cmd.do(line)`` and return the feedback lines carrying ``tag``.

    PyMOL echoes the command back BEFORE running it (``PyMOL>print(...)``), and
    that echo contains the tag too, so the echo is filtered out explicitly.
    This is the only way to read a plain ATTRIBUTE such as
    ``pymol.invocation.options.win_x``: the dispatcher invokes callables only.
    """
    if not getattr(ws, "_wf_shell_subscribed", False):
        # `{t:'do'}` output only reaches this client if it asked for the topic;
        # without this the helper times out and looks like PyMOL swallowed the
        # print.  Once per client: a re-subscribe replays the whole ring.
        ws.subscribe("feedback")
        ws._wf_shell_subscribed = True  # type: ignore[attr-defined]
    start = len(ws.feedback)
    ws.do(line)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        ws.pump_frames(0.15)
        hits = [t for t in ws.feedback[start:] if tag in t and line not in t]
        if hits:
            return hits
    raise AssertionError("no %r line in feedback for %r" % (tag, line))


def scene_rect(ws: WSClient, width: int, height: int) -> Tuple[int, int]:
    """Force a window reshape, then read the SCENE rectangle back.

    ``cmd.set('internal_gui', ...)`` only queues ``OrthoCommandIn(G,"viewport")``
    (``packages/engine/layer1/Setting.cpp:2824-2834``), and ``viewport`` with no arguments ends
    in ``PyMOL_NeedReshape`` (``packages/engine/layer5/PyMOL.cpp:2511-2536``), which GROWS the
    window to keep the scene the same size and then waits for a main loop that
    the bridge does not run.  Measured: the scene rectangle does not move.  The
    ``{t:'input',kind:'reshape'}`` path calls ``Engine.resize`` ->
    ``p.reshape(w,h,force=1)`` -> ``OrthoReshape``, which is what a browser
    canvas resize does, so that is what this drives.
    """
    ws.input("reshape", width=width, height=height)
    w, h = ws.call("cmd.get_viewport")
    return int(w), int(h)


@pytest.fixture
def shell_settings(ws: WSClient):
    """Snapshot/restore every global this file writes, and prove it restored."""
    saved: Dict[str, int] = {n: int(ws.call("cmd.get_setting_int", n)) for n in TOUCHED}
    fb = int(ws.call("cmd.count_frames"))
    before = scene_rect(ws, 800, 600)
    try:
        yield saved
    finally:
        for name, value in saved.items():
            ws.call("cmd.set", name, value)
        if int(ws.call("cmd.count_frames")) != fb:
            ws.call("cmd.mset", "")
        after = scene_rect(ws, before[0], before[1])
        assert after == before, (
            "test_wf_shell leaked PyMOL state: scene rect %r -> %r" % (before, after)
        )
        assert {n: int(ws.call("cmd.get_setting_int", n)) for n in TOUCHED} == saved


@pytest.fixture
def dip(ws: WSClient) -> int:
    """``DIP2PIXEL(1)`` — ``_gScaleFactor``, set from ``display_scale_factor``.

    1 on this machine (measured); every expectation below multiplies by it so
    the file is still correct on a HiDPI build.
    """
    return int(ws.call("cmd.get_setting_int", "display_scale_factor")) or 1


# ==================================================================== row 53
# Main window shell / dock layout


def test_the_invocation_options_the_qt_window_sizes_itself_from(
    ws: WSClient, bridge: RunningBridge
) -> None:
    """``win_x``/``win_y``/``ext_y``, read for real, and what they are worth.

    Row 53's initial size is ``win_x + (220 if internal_gui) x win_y + (246 if
    external_gui else 18)``.  Two of those five inputs are forced to 0 by
    ``packages/bridge/tenmol_bridge/engine.py:126-131`` before ``start()``, so on the
    bridge the formula degenerates to ``win_x x win_y + 18``.

    And ``win_x``/``win_y`` are the INVOCATION defaults (640x480), not the size
    of anything that exists: the real drawing surface is ``BridgeConfig``'s.
    A React shell that sized its window from ``win_x`` would be 160x120 short.

    WITHDRAWN CLAIM, and why it matters.  This test first asserted
    ``options.no_gui == 0`` off the same read.  It passed alone and FAILED in
    the full suite: ``packages/bridge/tests/test_modeg_lines.py:41`` sets
    ``opts.no_gui = 1`` from a module fixture whether or not it started PyMOL,
    and ``pymol.invocation.options`` is a plain mutable process global.  Options
    are snapshotted into ``CPyMOLOptions`` at ``_cmd._new``
    (``packages/engine/layer1/P.cpp:1800-1830``), so that write changed NOTHING about the
    running engine — but it does mean the attribute is not evidence about it.
    The boot-time values are therefore asserted through their OBSERVABLE
    consequences below, and only the three pure-configuration numbers are read
    from the attributes.
    """
    line = tagged(
        ws,
        "WFSHELL_OPT",
        "print('WFSHELL_OPT', [pymol.invocation.options.win_x,"
        " pymol.invocation.options.win_y, pymol.invocation.options.ext_y])",
    )[0]
    win_x, win_y, ext_y = [
        int(n) for n in re.findall(r"-?\d+", line.split("WFSHELL_OPT", 1)[1])
    ]

    # Untouched invocation defaults (packages/engine/modules/pymol/invocation.py).
    assert (win_x, win_y, ext_y) == (640, 480, 168)

    # The Qt formula with the options as the bridge boots them (0 and 0)...
    assert (win_x, win_y + 18) == (640, 498)
    # ...and as a stock Qt PyMOL would have them.
    assert (win_x + 220, win_y + 246) == (860, 726)

    # `no_gui = 0` at boot, observed rather than read: `pmgui = !no_gui`
    # (`packages/engine/layer1/P.cpp:1820`) is what makes `OrthoFeedbackIn()` queue console text
    # at all (`packages/engine/layer1/Ortho.cpp:492-499`). This line came back, so it queued.
    assert "WFSHELL_OPT" in line

    # `internal_gui = 0` at boot AND after (`engine.py:175-183`), observed as
    # the setting and as the geometry.
    assert int(ws.call("cmd.get_setting_int", "internal_gui")) == 0

    # None of which is the surface PyMOL is actually drawing into.
    assert (bridge.pump.engine.width, bridge.pump.engine.height) != (win_x, win_y)
    assert scene_rect(ws, bridge.pump.engine.width, bridge.pump.engine.height) == (
        bridge.pump.engine.width,
        bridge.pump.engine.height,
    ), "with internal_gui=0 and internal_feedback=0 the scene IS the window"


def test_session_file_is_setting_440_and_a_session_save_updates_it(
    ws: WSClient, tmp_path
) -> None:
    """Row 53's window title: ``setting_callbacks[440]`` -> ``PyMOL (basename)``.

    440 is hard-coded in ``pymol_qt_gui.py:113``.  Pinning the NAME->INDEX
    mapping matters because the React shell reads the setting by name; if the
    two ever disagree the title silently stops tracking.
    """
    assert (
        int(tagged(
            ws,
            "WFSHELL_IDX",
            "print('WFSHELL_IDX', cmd.setting._get_index('session_file'))",
        )[0].split()[-1])
        == 440
    )

    saved = ws.call("cmd.get", "session_file")
    target = str(tmp_path / "wf_shell_title.pse")
    try:
        ws.call("cmd.save", target)
        assert ws.call("cmd.get", "session_file") == target
        # The same value through the index the Qt callback is registered on.
        kind, values = ws.call("cmd.get_setting_tuple", 440)
        assert kind == 6, "session_file is a string setting"
        assert values[0] == target
        # What the title becomes.
        assert "PyMOL (%s)" % os.path.basename(target) == "PyMOL (wf_shell_title.pse)"
    finally:
        ws.call("cmd.set", "session_file", saved)
    assert ws.call("cmd.get", "session_file") == saved


def test_the_qt_stylesheet_resolves_and_is_the_three_rules_the_row_claims(
    ws: WSClient,
) -> None:
    """``cmd.exp_path('$PYMOL_DATA/pmg_qt/styles/pymol.sty')`` — 3 rules, no more.

    The React shell reproduces none of it (two of the three rules are padding on
    ``QPushButton``, the third styles ``QMainWindow::separator``).  The point of
    the test is that the row's "only 3 rules" claim stays true: if upstream grows
    the stylesheet, someone has to look at what was added.
    """
    path = ws.call("cmd.exp_path", "$PYMOL_DATA/pmg_qt/styles/pymol.sty")
    assert os.path.isabs(path) and path.endswith("pmg_qt/styles/pymol.sty")
    assert os.path.exists(path), path
    with open(path) as handle:
        style = handle.read()
    selectors = [
        chunk.strip().splitlines()[-1].strip() for chunk in re.findall(r"([^{}]+)\{", style)
    ]
    assert selectors == [
        "#builder QPushButton",
        "QPushButton[quickbutton=true]",
        "QMainWindow::separator",
    ]


def test_the_qt_window_has_no_splitter_toolbar_or_statusbar() -> None:
    """Row 53's last clause, asserted against the Qt source (SOURCE-ONLY).

    No socket can observe this — there is no Qt in the bridge process.  It is
    pinned anyway because it is the justification for the React shell being a
    CSS grid with hand-rolled splitters and for ``shell/StatusBar.tsx`` being
    documented as an ADDITION rather than a port.
    """
    source = open(QT_GUI).read()
    for absent in ("QSplitter", "QToolBar", "QStatusBar"):
        assert absent not in source, "%s appeared in pymol_qt_gui.py" % absent
    for present in (
        "AllowTabbedDocks",
        "AllowNestedDocks",
        "TopDockWidgetArea",
        "options.win_x + (220 if options.internal_gui else 0)",
        "options.win_y + (246 if options.external_gui else 18)",
        "self.setCentralWidget(self.pymolwidget)",
        "$PYMOL_DATA/pmg_qt/styles/pymol.sty",
        "self.setting_callbacks[440]",
    ):
        assert present in source, "pymol_qt_gui.py no longer contains %r" % present


# ==================================================================== row 54
# External GUI dock: toggle dockable / visible


def test_ext_hide_and_ext_show_are_PRINTED_no_ops_exactly_as_the_row_says(
    ws: WSClient,
) -> None:
    """``pymol.gui.ext_hide/ext_show`` print "ignoring ..." and do nothing.

    The row says they are "printed no-ops when a Qt window exists".  There is no
    Qt window here — but ``tenmol_bridge/shims.py`` replaces
    ``pymol.gui.get_qtwindow`` with one returning a ``BridgeWindow``, so PyMOL
    takes the *window exists* branch (``packages/engine/modules/pymol/gui.py:42-64``) and the
    parity behaviour is reproduced exactly.  Measured output, in order:

        ignoring gui.ext_hide
        ignoring gui.ext_show
    """
    ws.subscribe("feedback")
    start = len(ws.feedback)
    tagged(
        ws,
        "WFSHELL_EXT",
        "/from pymol import gui; gui.ext_hide(); gui.ext_show();"
        " print('WFSHELL_EXT', repr(gui.get_qtwindow()))",
    )
    printed = [t.strip() for t in ws.feedback[start:] if "ignoring gui.ext_" in t]
    assert printed == ["ignoring gui.ext_hide", "ignoring gui.ext_show"]
    assert "BridgeWindow" in "".join(ws.feedback[start:])


def test_the_gui_namespace_is_NOT_addressable_over_the_wire(ws: WSClient) -> None:
    """REPORTED GAP, pinned so it cannot regress silently either way.

    Row 54's backend contract says ``pymol.gui.ext_hide``/``ext_show`` "must stay
    callable".  They are callable inside PyMOL (previous test) but NOT over
    ``{t:'call'}``: ``gui`` is not in ``policy/base.py: DEFAULT_ROOTS``.  The web
    client does not need them — a browser cannot hide an OS window, and the dock
    is client state — so this is reported, not granted here.  If a grant is ever
    added, this test fails and the row's annotation gets revisited.
    """
    reply = ws.call_reply("gui.ext_hide")
    assert reply["t"] == "err"
    assert reply["error"]["kind"] == "NotAllowed"
    assert "not an addressable namespace" in reply["error"]["message"]


def test_the_dock_toggle_is_a_two_state_qt_toggle_with_a_neverfloat_flag() -> None:
    """Row 54's ``toggle_ext_window_dockable``, asserted on source (SOURCE-ONLY).

    The behaviour the React ``ExternalGuiPanel`` reproduces, read off
    ``pymol_qt_gui.py:457-467``:

      * title bar is None  -> install an EMPTY title bar, ``setFloating(False)``
        => docked, no grab handle.  This is the startup state when
        ``options.external_gui`` is true.
      * title bar is empty -> remove it, ``setFloating(not neverfloat)``
        => floating with a real title bar; ``neverfloat=True`` (the frame
        double-click) leaves it docked but grabbable.

    Plus: docking LEFT or RIGHT flips the layout to ``BottomToTop`` and takes the
    quickbutton stretch out; ``Ctrl+E`` is the menu shortcut.
    """
    source = open(QT_GUI).read()
    for present in (
        "def toggle_ext_window_dockable(self, neverfloat=False)",
        "dockWidget.setFloating(tbw is None and not neverfloat)",
        "self.toggle_ext_window_dockable(True)",  # ExtGuiFrame double click
        "QtCore.QSize(options.win_x, options.ext_y)",  # ExtGuiFrame sizeHint
        "dockWidget.setTitleBarWidget(QtWidgets.QWidget())",
        "Direction.BottomToTop",
        "quickbuttonslayout.takeAt(quickbuttons_stretch_index)",
        "QtGui.QKeySequence('Ctrl+E')",
        "ext_vis_action.setText('Visible')",
    ):
        assert present in source, "pymol_qt_gui.py no longer contains %r" % present


# ==================================================================== row 88
# Internal GUI layout column


def test_internal_gui_reserves_exactly_internal_gui_width_from_the_scene(
    ws: WSClient, shell_settings, dip: int
) -> None:
    """MEASURED.  The whole point of the right-hand column, in pixels.

    On this machine (``display_scale_factor`` = 1), driving an 800x600 window:

        internal_gui 0                      -> scene 800x600
        internal_gui 1, width 220 (default) -> scene 580x600
        internal_gui 1, width 5             -> scene 795x600
        internal_gui 1, width 300           -> scene 500x600

    ``packages/engine/layer1/Ortho.cpp:2391-2394``: ``sceneRight = DIP2PIXEL(internal_gui_width)``
    and the Scene block's right margin is exactly that.
    """
    assert scene_rect(ws, 800, 600) == (800, 600)

    ws.call("cmd.set", "internal_gui", 1)
    assert scene_rect(ws, 800, 600) == (800 - ORTHO_RIGHT_SCENE_MARGIN * dip, 600)

    for width in (CONTROL_MIN_WIDTH, 300, ORTHO_RIGHT_SCENE_MARGIN):
        ws.call("cmd.set", "internal_gui_width", width)
        assert scene_rect(ws, 800, 600) == (800 - width * dip, 600), width

    ws.call("cmd.set", "internal_gui", 0)
    assert scene_rect(ws, 800, 600) == (800, 600), "the column vanishes, not shrinks"


def test_internal_gui_mode_2_floats_over_the_scene_and_0_and_1_reserve(
    ws: WSClient, shell_settings, dip: int
) -> None:
    """MEASURED.  ``InternalGUIMode`` 0 opaque, 1 BG, 2 transparent.

    ``packages/engine/layer1/Ortho.cpp:2396-2407``: only ``Transparent`` sets ``sceneRight = 0``
    *and* ``sceneBottom = 0`` — so mode 2 is the one where the React column must
    be an OVERLAY on top of the viewport instead of a grid column beside it.
    Measured with width 220 on an 800x600 window: 580, 580, 800.
    """
    ws.call("cmd.set", "internal_gui", 1)
    ws.call("cmd.set", "internal_gui_width", ORTHO_RIGHT_SCENE_MARGIN)
    measured = []
    for mode in (0, 1, 2):
        ws.call("cmd.set", "internal_gui_mode", mode)
        measured.append(scene_rect(ws, 800, 600))
    reserved = (800 - ORTHO_RIGHT_SCENE_MARGIN * dip, 600)
    assert measured == [reserved, reserved, (800, 600)]


def test_ortho_reshape_also_reserves_the_bottom_band(
    ws: WSClient, shell_settings, dip: int
) -> None:
    """MEASURED.  Row 88's last sentence, in numbers.

    ``sceneBottom = MovieGetPanelHeight() + (internal_feedback-1)*12 + 18``
    (``packages/engine/layer1/Ortho.cpp:2382-2390``).  On an 800x600 window:

        internal_feedback 1 -> 800x582      (0*12 + 18)
        internal_feedback 3 -> 800x558      (2*12 + 18)
        internal_feedback 5 -> 800x534      (4*12 + 18)
        movie_panel 1, 30-frame movie -> 800x585   (row_height 15 x 1 motion)

    This is why ``engine.py`` pins both to 0: any other value makes
    ``cmd.get_viewport()`` disagree with the browser canvas and every forwarded
    mouse coordinate wrong.
    """
    for lines in (1, 3, 5):
        ws.call("cmd.set", "internal_feedback", lines)
        expected = 600 - ((lines - 1) * ORTHO_LINE_HEIGHT + ORTHO_BOTTOM_SCENE_MARGIN) * dip
        assert scene_rect(ws, 800, 600) == (800, expected), lines
    ws.call("cmd.set", "internal_feedback", 0)
    assert scene_rect(ws, 800, 600) == (800, 600)

    # movie_panel reserves NOTHING until something actually has motion:
    # MovieGetPanelHeight (packages/engine/layer1/Movie.cpp:1701-1722) returns
    # row_height * ExecutiveCountMotions().
    ws.call("cmd.set", "movie_panel", 1)
    assert scene_rect(ws, 800, 600) == (800, 600), "no movie -> no panel"

    row_height = int(ws.call("cmd.get_setting_int", "movie_panel_row_height"))
    ws.call("cmd.mset", "1 x30")
    try:
        assert scene_rect(ws, 800, 600) == (800, 600 - row_height * dip)
    finally:
        ws.call("cmd.mset", "")
    assert scene_rect(ws, 800, 600) == (800, 600)


def test_mouse_grid_changes_the_column_but_nothing_the_wire_can_see(
    ws: WSClient, shell_settings
) -> None:
    """The ButMode 40/124 px split is SOURCE-ONLY and this says why.

    ``ButModeGetHeight`` (``packages/engine/layer1/ButMode.cpp:72-78``) returns DIP2PIXEL(124)
    with ``mouse_grid`` and DIP2PIXEL(40) without, and ``OrthoLayoutPanel``
    stacks the blocks INSIDE the column — none of which changes the scene
    rectangle, the only geometry ``cmd`` exposes.  So the React column's block
    heights are asserted against the C++ constants in the web unit test
    (``apps/web/src/shell/orthoPanel.test.ts``), not here.  What IS checkable is
    that the setting exists, is a bool, and moves nothing observable.
    """
    ws.call("cmd.set", "internal_gui", 1)
    before = scene_rect(ws, 800, 600)
    for grid in (0, 1):
        ws.call("cmd.set", "mouse_grid", grid)
        assert scene_rect(ws, 800, 600) == before, grid


# =================================================================== row 103
# Control-bar left gutter


def test_cmd_set_does_NOT_clamp_internal_gui_width_so_the_floor_is_the_clients(
    ws: WSClient, shell_settings, dip: int
) -> None:
    """MEASURED.  ``cControlMinWidth`` = 5 lives in the DRAG handler, not in ``set``.

    ``packages/engine/layer1/Control.cpp:263-276`` clamps only the value the gutter drag
    computes; ``cmd.set`` stores whatever it is given.  Measured with
    ``internal_gui`` on and an 800x600 window:

        width  -20 -> scene 820x600   <-- WIDER THAN THE FRAMEBUFFER
        width    0 -> scene 800x600
        width    3 -> scene 797x600
        width    5 -> scene 795x600

    So a React splitter that let the user drag past the floor would hand PyMOL a
    scene bigger than the canvas.  ``shell/orthoPanel.ts: clampInternalGuiWidth``
    is the client-side reimplementation of the C++ clamp, and this is the
    measurement that makes it necessary.
    """
    ws.call("cmd.set", "internal_gui", 1)
    for width in (-20, 0, 3, CONTROL_MIN_WIDTH):
        ws.call("cmd.set", "internal_gui_width", width)
        assert int(ws.call("cmd.get_setting_int", "internal_gui_width")) == width
        assert scene_rect(ws, 800, 600) == (800 - width * dip, 600), width


def test_the_gutter_write_back_round_trips_and_is_inert_while_internal_gui_is_0(
    ws: WSClient, shell_settings
) -> None:
    """Row 103's contract: ``cmd.set('internal_gui_width', n)``, and it is SAFE.

    The React gutter writes the width back so a `.pse` and a headless CLI see the
    same number the browser is showing.  The worry that motivates this test is
    the obvious one: does writing it move the scene rectangle out from under the
    canvas?  No — the bridge holds ``internal_gui`` at 0, and with the column off
    ``OrthoReshape`` sets ``internal_gui_width = 0`` outright
    (``packages/engine/layer1/Ortho.cpp:2392-2394``).  Measured: 800x600 at every width.
    """
    assert int(ws.call("cmd.get_setting_int", "internal_gui")) == 0
    for width in (CONTROL_MIN_WIDTH, 220, 420):
        ws.call("cmd.set", "internal_gui_width", width)
        assert int(ws.call("cmd.get_setting_int", "internal_gui_width")) == width
        assert scene_rect(ws, 800, 600) == (800, 600), width


def test_a_session_save_carries_internal_gui_width(ws: WSClient, shell_settings, tmp_path) -> None:
    """"...so headless/CLI parity is kept" — the reason for the write-back.

    ``SettingResetAll`` skips ``internal_gui`` and ``internal_gui_width`` unless
    ``reset_gui`` (``packages/engine/layer1/Setting.cpp:3020-3025``), so a session round trip is
    the interesting case: the value the browser wrote must be what a later
    ``pymol -c`` reads.  Asserted by unpickling the written ``.pse`` and looking
    for setting index 98 rather than by LOADING it — a load would wipe the one
    PyMOL session every other test in the suite shares.
    """
    ws.call("cmd.set", "internal_gui_width", 137)
    target = str(tmp_path / "wf_shell_width.pse")
    ws.call("cmd.save", target)
    assert os.path.getsize(target) > 0
    saved_file = ws.call("cmd.get", "session_file")
    try:
        line = tagged(
            ws,
            "WFSHELL_PSE",
            "print('WFSHELL_PSE', [v for v in"
            " __import__('pickle').load(open(%r,'rb'))['settings']"
            " if v[0] == 98])" % target,
        )[0]
        assert "137" in line, line
    finally:
        ws.call("cmd.set", "session_file", saved_file)
