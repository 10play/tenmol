"""Parity area 2/5 — the internal GUI block column, and setting side effects.

Inventory rows pinned here (``docs/webclient/00-parity-inventory.md``):

* **88** Internal GUI layout column — Executive / Wizard / ButMode / Control,
  ``layer1/Ortho.cpp:2261-2340``.
* **209** Setting side effects / geometry invalidation —
  ``SettingGenerateSideEffects``, ``layer1/Setting.cpp:1872-2400``.

WHY THIS FILE EXISTS WHEN ``test_wf_shell.py`` ALREADY MEASURED THE COLUMN.
``test_wf_shell.py`` measured everything ``cmd.get_viewport`` can see: the
220 px the column takes off the SCENE rectangle, ``internal_gui_mode`` 2
floating, the bottom band.  It then recorded the per-block heights (Control 20,
ButMode 40/124, Wizard ``control_size*NLine+4``) as **SOURCE-ONLY**, with the
note that "none of which changes the scene rectangle, the only geometry ``cmd``
exposes".

That is true of ``cmd``.  It is not true of the bridge, which has two
instruments ``cmd`` does not:

1. **The framebuffer.**  ``PixelReadback`` (``render/framestream.py:807``) reads
   the same RGBA the browser is shown, and the blocks are DRAWN into it.
2. **The input path.**  ``{t:'input',kind:'button'}`` -> ``PyMOL_Button`` ->
   ``OrthoButton`` -> ``Block::recursiveFind`` -> the block whose ``rect``
   contains the point.  Which block answers a click IS the block's rectangle.

Everything below is measured with one or both of those, on an 800x600 window
with ``display_scale_factor`` 1.  Real numbers, all reproduced by running this
file:

    column, drawn                    x 580..799 inclusive, 220 columns
    Control band                     y  0..19        (20 px)
    ButMode band, mouse_grid 0       y 20..59        (40 px)
    ButMode band, mouse_grid 1       y 20..143      (124 px)
    Executive bottom edge            y 60 / 144
    Wizard band, 2 rows @ size 18    y 60..99        (40 px = 18*2 + 4)
    Wizard band, 2 rows @ size 30    y 60..123       (64 px = 30*2 + 4)
    Wizard band, 2 rows @ size 40    y 60..143       (84 px = 40*2 + 4)
    Wizard band, no wizard           0 px, block inactive

The column measurement needs an EMPTY, STILL scene and says so: toggling the
column in mode 0 moves the scene rectangle too, so with one alanine fragment
displayed the same diff spans x 232..799 (MEASURED), 244 columns of it left of
the column edge.  The test grabs the frame twice before it starts and refuses
to interpret a diff taken over a moving scene.

THE FINDING THAT JOINS THE TWO ROWS.  ``SettingGenerateSideEffects`` handles
seven layout settings — ``internal_gui``, ``internal_gui_width``,
``internal_gui_mode``, ``internal_feedback``, ``mouse_grid``, ``movie_panel``,
``movie_panel_row_height`` — with ONE line: ``OrthoCommandIn(G, "viewport")``
(``layer1/Setting.cpp:2824-2833``).  That queues the ``viewport`` command, which
with no arguments ends in ``PyMOL_NeedReshape``, which asks the WINDOWING
SYSTEM to resize the window.  The bridge has no windowing system.  MEASURED:

    set mouse_grid, 1        -> not one pixel of the column changes, and a
                                click at y=100 still misses the ButMode block
    ... then one reshape     -> the band is 124 px and the click lands

    set internal_feedback, 3 -> cmd.get_viewport() still says 800x600
    ... then one reshape     -> 800x558, a 42 px band the canvas knows
                                nothing about

So for these seven the client's ``settings.changed`` signal is NOT enough: the
relayout only happens when the client drives ``{t:'input',kind:'reshape'}``.
By contrast ``internal_gui_control_size`` calls ``WizardRefresh`` ->
``OrthoReshapeWizard`` inline and relayouts IMMEDIATELY, and a rep-invalidating
setting reaches the ``geometry`` topic within one 4 Hz scan.  Three different
latencies out of one switch; a client that treats them alike is wrong twice.

SHARED STATE.  This file writes PyMOL globals, clicks into the ortho blocks
(which cycles ``button_mode`` and ``mouse_selection_mode``), reshapes the
window and pushes a wizard, in the ONE process the whole suite shares.  The
``column`` fixture snapshots and restores every one of those and re-asserts the
scene rectangle; ``button_mode`` is restored by re-running ``cmd.mouse`` rather
than by writing the setting, because the setting alone does not re-apply the
button table (``modules/pymol/controlling.py:646-680``).

Run::

    bridge/.venv/bin/python -m pytest bridge/tests/test_f7_layout.py -q
"""

from __future__ import annotations

import os
import re
import sys
import time
from typing import Any, Dict, Iterator, List, Tuple

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import RunningBridge, WSClient  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SETTING_CPP = os.path.join(REPO, "layer1", "Setting.cpp")

#: The window every measurement below is made in.
W, H = 800, 600

#: ``cOrthoRightSceneMargin`` / the ``internal_gui_width`` default.
COLUMN = 220

#: ``layer1/Ortho.cpp:2265`` — ``controlHeight = DIP2PIXEL(20)``.
CONTROL_H = 20
#: ``ButModeGetHeight`` (``layer1/ButMode.cpp:72-78``).
BUTMODE_H, BUTMODE_GRID_H = 40, 124
#: ``cButModeLineHeight`` (``layer1/ButMode.cpp:36``) — the ``dy < 2`` split.
BUTMODE_LINE = 12
#: The ``+ 4`` in ``LineHeight * NLine + 4`` (``layer1/Wizard.cpp:255``).
#: NOT DIP-scaled, unlike the ``LineHeight`` it is added to.
WIZARD_PAD = 4

#: Settings whose only side effect is ``OrthoCommandIn(G, "viewport")``
#: (``layer1/Setting.cpp:2824-2833``).  Asserted against the C++ below.
LAYOUT_SETTINGS = (
    "internal_gui_mode",
    "internal_gui_width",
    "internal_gui",
    "internal_feedback",
    "mouse_grid",
    "movie_panel_row_height",
    "movie_panel",
)

#: Int/bool globals the fixture snapshots.  ``stick_radius`` is a float and is
#: handled separately — ``cmd.get_setting_int`` on a float answers 0 and would
#: restore the wrong value.
TOUCHED_INT = LAYOUT_SETTINGS + (
    "internal_gui_control_size",
    "button_mode",
    "mouse_selection_mode",
)
TOUCHED_FLOAT = ("stick_radius",)

WIZ_BOOTSTRAP = "/import tenmol_bridge.panels.wizards as _w;_w.install()"


# --------------------------------------------------------------- helpers


def reshape(ws: WSClient, width: int = W, height: int = H) -> Tuple[int, int]:
    """Drive a canvas resize and read the scene rectangle back.

    The only way to make ``OrthoReshape`` run: ``cmd.set`` on a layout setting
    merely queues ``viewport``, which the bridge never completes (see the
    module docstring).
    """
    ws.input("reshape", width=width, height=height)
    w, h = ws.call("cmd.get_viewport")
    return int(w), int(h)


def viewport(ws: WSClient) -> Tuple[int, int]:
    w, h = ws.call("cmd.get_viewport")
    return int(w), int(h)


def grab(bridge: RunningBridge) -> bytes:
    """One ``glReadPixels`` of the whole window, on the engine thread.

    Bottom-up RGBA, so row 0 is the bottom of the window — the same origin the
    ortho blocks are laid out in, which is why no flip appears anywhere below.
    """
    from tenmol_bridge.render import PixelReadback

    def body(engine: Any) -> bytes:
        readback = PixelReadback(engine.context)
        buf, _ms = readback.read(W, H)
        return bytes(bytearray(buf)[: W * H * 4])

    return bridge.pump.submit(body, label="f7:readback").result(timeout=30)


def settle(ws: WSClient, seconds: float = 1.2) -> None:
    """Let the pump draw.  Input and ortho commands only apply on a draw."""
    ws.pump_frames(seconds)


def rows_differing(a: bytes, b: bytes, x0: int, x1: int) -> List[int]:
    """Window rows (bottom-up) whose pixels differ inside ``x0 <= x < x1``."""
    out: List[int] = []
    for y in range(H):
        base = y * W * 4
        if a[base + x0 * 4 : base + x1 * 4] != b[base + x0 * 4 : base + x1 * 4]:
            out.append(y)
    return out


def cols_differing(a: bytes, b: bytes) -> List[int]:
    out: List[int] = []
    for x in range(W):
        for y in range(H):
            base = (y * W + x) * 4
            if a[base : base + 4] != b[base : base + 4]:
                out.append(x)
                break
    return out


def click(ws: WSClient, x: int, y: int) -> None:
    """One left press+release at a window point, then wait for a draw.

    ``OrthoButton`` only *enqueues* (``OrthoDefer``); the queue is drained by
    ``OrthoExecDeferred``, reachable only from a real draw.  ``mouse forward``
    then goes through ``OrthoCommandIn``, which is a second queue drained on the
    next idle — hence the generous settle.
    """
    ws.input("button", button=0, state=0, x=x, y=y, mod=0, when=0.0)
    ws.input("button", button=0, state=1, x=x, y=y, mod=0, when=0.0)
    settle(ws, 1.3)


def modes(ws: WSClient) -> Tuple[int, int]:
    return (
        int(ws.call("cmd.get_setting_int", "button_mode")),
        int(ws.call("cmd.get_setting_int", "mouse_selection_mode")),
    )


def probe_column(ws: WSClient, y: int) -> str:
    """Click the column at height ``y`` and name the block that answered.

    ``x`` is one pixel inside the column's left edge, and that is deliberate:
    it is the one x at which a click on the EXECUTIVE block is a guaranteed
    no-op.  ``CExecutive::click`` (``layer3/Executive.cpp:15050,15302``) treats
    a click as a toggle-column hit only when
    ``((rect.right - x - 1) / ExecToggleWidth) < op_cnt`` — 12 at this x, never
    less than the 5-6 op columns — and as a name hit only when
    ``(xx - 1) / DIP2PIXEL(8) > nest_level``, which is ``0 > 0`` here.  So the
    Executive answers the click and does nothing, whatever object list another
    test left behind.

    Returns 'butmode-mode' (``mouse forward`` ran, ``dy >= 2``),
    'butmode-select' (``mouse select_forward`` ran, ``dy < 2``) or 'none'.
    """
    before = modes(ws)
    click(ws, W - COLUMN + 1, y)
    after = modes(ws)
    if after[0] != before[0]:
        return "butmode-mode"
    if after[1] != before[1]:
        return "butmode-select"
    return "none"


def tagged(ws: WSClient, tag: str, line: str, timeout: float = 6.0) -> str:
    """``cmd.do(line)`` and return the feedback line carrying ``tag``.

    PyMOL echoes the command before running it, so the echo is filtered out.
    """
    if not getattr(ws, "_f7_subscribed", False):
        ws.subscribe("feedback")
        ws._f7_subscribed = True  # type: ignore[attr-defined]
    start = len(ws.feedback)
    ws.do(line)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        ws.pump_frames(0.15)
        hits = [t for t in ws.feedback[start:] if tag in t and line not in t]
        if hits:
            return hits[0]
    raise AssertionError("no %r line for %r" % (tag, line))


def drain_geometry(ws: WSClient, seconds: float) -> List[Dict[str, Any]]:
    ws.events.clear()
    ws.pump_frames(seconds)
    rows: List[Dict[str, Any]] = []
    for event in ws.events:
        if event.get("topic") == "geometry":
            rows.extend(event.get("payload", {}).get("invalidated", []))
    return rows


# --------------------------------------------------------------- fixtures


@pytest.fixture
def column(ws: WSClient, gl_bridge: RunningBridge) -> Iterator[WSClient]:
    """Snapshot every global this file writes, and prove it all came back.

    ``gl_bridge`` rather than ``bridge``: with no GL the engine never calls
    ``p.draw()`` (``engine.py:236-239``), so no click is ever dispatched and no
    framebuffer exists to read.  Both instruments here need the draw.
    """
    saved_i = {n: int(ws.call("cmd.get_setting_int", n)) for n in TOUCHED_INT}
    saved_f = {n: float(ws.call("cmd.get_setting_float", n)) for n in TOUCHED_FLOAT}
    # The camera as well: two tests here build `f7_ala`, and while `cmd.fragment`
    # was MEASURED not to move the view in this process, "measured once" is not
    # a licence to leave the shared camera unpinned.
    saved_view = list(ws.call("cmd.get_view"))
    before = reshape(ws)
    ws.subscribe("pixels")
    settle(ws)
    try:
        yield ws
    finally:
        for name, value in saved_i.items():
            if name != "button_mode":
                ws.call("cmd.set", name, value)
        for name, fvalue in saved_f.items():
            ws.call("cmd.set", name, fvalue)
        # `button_mode` is not a value you can just write back: `cmd.mouse`
        # applies the ring's bindings to the C button table as a side effect
        # (`controlling.py:672-680`), and a bare `cmd.set` would leave the
        # table and the setting disagreeing for every later test.  Re-running
        # the same `mouse forward` the click ran is what puts both back.
        for _ in range(8):
            if int(ws.call("cmd.get_setting_int", "button_mode")) == saved_i["button_mode"]:
                break
            ws.call("cmd.mouse", "forward")
        ws.call("cmd.delete", "f7_ala")
        ws.call("cmd.set_view", saved_view)
        after = reshape(ws, before[0], before[1])
        assert after == before, "test_f7_layout leaked: scene %r -> %r" % (before, after)
        assert {n: int(ws.call("cmd.get_setting_int", n)) for n in TOUCHED_INT} == saved_i
        assert {n: float(ws.call("cmd.get_setting_float", n)) for n in TOUCHED_FLOAT} == saved_f


@pytest.fixture
def gui_on(column: WSClient) -> WSClient:
    """``internal_gui`` on, 220 px wide, opaque, no mouse grid, at 800x600.

    ``mouse_grid`` is pinned to 0 here because its DEFAULT IS 1 (measured), and
    a test that assumed otherwise would silently be measuring the 124 px band
    while claiming to measure the 40 px one — which is exactly what the first
    draft of this file did.
    """
    ws = column
    ws.call("cmd.set", "internal_gui", 1)
    ws.call("cmd.set", "internal_gui_width", COLUMN)
    ws.call("cmd.set", "internal_gui_mode", 0)
    ws.call("cmd.set", "internal_feedback", 0)
    ws.call("cmd.set", "movie_panel", 0)
    ws.call("cmd.set", "mouse_grid", 0)
    assert reshape(ws) == (W - COLUMN, H)
    settle(ws)
    return ws


@pytest.fixture
def dip(ws: WSClient) -> int:
    """``DIP2PIXEL(1)``.  1 on this machine; every expectation multiplies by it."""
    return int(ws.call("cmd.get_setting_int", "display_scale_factor")) or 1


# ==================================================================== row 88
# The column, in drawn pixels


def test_the_column_is_internal_gui_width_columns_of_real_pixels(
    gui_on: WSClient, gl_bridge: RunningBridge, dip: int
) -> None:
    """MEASURED, in the framebuffer: x 580..799, exactly 220 columns.

    ``test_wf_shell.py`` measured the same 220 as an absence — the scene
    rectangle shrinking.  This measures it as a presence: the pixels PyMOL
    draws for the column and nothing to the left of them.  The two together are
    what let the React shell put its own DOM in that rectangle and be sure
    nothing of PyMOL's is underneath it.

    WHAT THIS DIFF DEPENDS ON, SAID OUT LOUD.  Toggling ``internal_gui`` in
    mode 0 moves the SCENE rectangle too (800x600 -> 580x600), so anything
    drawn in the scene re-renders at a different aspect and lands in the diff:
    MEASURED, with a single alanine fragment displayed the same diff spans
    x 232..799, 244 of those columns to the LEFT of the column's own edge.  The
    "nothing differs left of 580" half is therefore a statement about an EMPTY,
    STILL scene, and the ``still`` is not free either — the two grabs are
    minutes apart in wall-clock terms for the engine.  Rather than leave that
    implicit, the frame is grabbed twice in the same state first: if the scene
    is not byte-stable, this test says so instead of reporting a nonsense edge.

    (Loading a fragment here and measuring in ``internal_gui_mode`` 2 — where
    the scene rectangle does NOT move, so the scene pixels cancel — gives the
    same x 580..799 / 220 columns in isolation, MEASURED.  It is not what this
    test does, because in the full shared suite that fragment then depends on
    whatever the previous 1300 tests left pointed at it: it was tried, and it
    reported a left edge of x=4.  An empty scene is the only cheap way to be
    sure the diff is the column and nothing else.)
    """
    ws = gui_on
    ws.call("cmd.set", "internal_gui", 0)
    assert reshape(ws) == (W, H)
    settle(ws)
    off = grab(gl_bridge)
    assert grab(gl_bridge) == off, (
        "the scene is not still between two grabs (a movie, a rock, a sculpt "
        "left running by another test) — this pixel diff cannot mean anything"
    )

    ws.call("cmd.set", "internal_gui", 1)
    assert reshape(ws) == (W - COLUMN * dip, H)
    settle(ws)
    on = grab(gl_bridge)

    columns = cols_differing(off, on)
    assert columns, "turning internal_gui on changed no pixels at all"
    assert (columns[0], columns[-1]) == (W - COLUMN * dip, W - 1)
    assert len(columns) == COLUMN * dip, "the drawn column is not %d px" % (COLUMN * dip,)


def test_the_butmode_band_is_40_px_and_124_px_with_mouse_grid(
    gui_on: WSClient, dip: int
) -> None:
    """MEASURED BY CLICK.  ``ButModeGetHeight``, from the block that answers.

    The band's top edge is the highest y at which a click still runs
    ``mouse forward``.  Measured, bottom-up in an 800x600 window:

        mouse_grid 0   y  59 -> button_mode moves,  y  60 -> nothing
        mouse_grid 1   y 143 -> button_mode moves,  y 144 -> nothing

    With the bottom edge at 20 (the test below), that is 40 px and 124 px —
    ``DIP2PIXEL(40)`` and ``DIP2PIXEL(124)``, and the Executive block starting
    exactly one pixel above each.
    """
    ws = gui_on
    top = CONTROL_H * dip + BUTMODE_H * dip - 1
    assert probe_column(ws, top) == "butmode-mode"
    assert probe_column(ws, top + 1) == "none", "the Executive block starts at %d" % (top + 1)

    ws.call("cmd.set", "mouse_grid", 1)
    assert reshape(ws) == (W - COLUMN * dip, H)
    grid_top = CONTROL_H * dip + BUTMODE_GRID_H * dip - 1
    assert probe_column(ws, grid_top) == "butmode-mode"
    assert probe_column(ws, grid_top + 1) == "none"

    # And the 84 px the grid added really did come out of Executive.
    assert grid_top - top == (BUTMODE_GRID_H - BUTMODE_H) * dip


def test_the_control_band_is_20_px_read_off_the_butmode_line_split(
    gui_on: WSClient, dip: int
) -> None:
    """MEASURED BY CLICK, without ever clicking the Control block.

    ``CButMode::click`` splits on ``dy = (y - rect.bottom) / 12``: below 2 it
    cycles the SELECTION mode, at or above it the BUTTON mode
    (``layer1/ButMode.cpp:151-186``).  So the y at which the answer flips is
    ``rect.bottom + 24``, and ``rect.bottom`` is the Control block's height.
    Measured: y 43 -> mouse_selection_mode, y 44 -> button_mode, hence
    ``rect.bottom = 20``.

    Clicking the Control block itself is avoided on purpose: its left 8 px are
    the resize gutter and a press there ``OrthoGrab``s
    (``layer1/Control.cpp:466``), while its buttons start and stop the movie.
    Neither belongs in a shared process for the sake of one boundary.

    THE MOUSE MODE IS ESTABLISHED, NOT ASSUMED, and that is not tidiness.  The
    selection half of the split only runs ``if ButModeTranslate(SINGLE_LEFT) !=
    cButModePickAtom`` (``ButMode.cpp:165``) — i.e. only outside an editing
    ring.  ``test_wf_apbs.py:87`` and ``test_wf_wizards.py:71`` both restore
    ``button_mode`` with a bare ``cmd.set``, which puts the SETTING back without
    re-applying the button table (``controlling.py:672-680``), so this shared
    process can be sitting at ``button_mode 0`` with editing bindings live.
    Measured: this test passed alone and answered 'none' in the full suite until
    the line below was added.
    """
    ws = gui_on
    ws.call("cmd.mouse", "three_button_viewing")
    ws.call("cmd.set", "mouse_grid", 0)
    assert reshape(ws) == (W - COLUMN * dip, H)
    split = CONTROL_H * dip + 2 * BUTMODE_LINE * dip
    assert probe_column(ws, split - 1) == "butmode-select"
    assert probe_column(ws, split) == "butmode-mode"


def test_the_wizard_block_is_control_size_times_nline_plus_4(
    gui_on: WSClient, gl_bridge: RunningBridge, dip: int
) -> None:
    """MEASURED, in pixels and then in the block's own row pitch.

    A ``message`` wizard has a 2-row panel (``pymol/wizard/message.py:27-35``),
    so ``OrthoReshapeWizard`` is handed ``DIP2PIXEL(18)*2 + 4 = 40``
    (``layer1/Wizard.cpp:253-259``).  Measured on an 800x600 window: the pixels
    that change when the wizard appears reach exactly y 99 and no higher — the
    band is ``[60, 99]``, sitting directly on top of the 40 px ButMode band.
    (The band's lower rows are blank fill in the same colour the Executive drew
    there, so the diff shows glyphs plus the top edge, not a solid rectangle.)

    THE SECOND FACTOR IS MEASURED BY ROW PITCH, NOT BY PIXELS, and the reason is
    itself a finding.  ``internal_gui_control_size`` relayouts INLINE
    (``Setting.cpp:2153-2156``: ``WizardRefresh`` -> ``OrthoReshapeWizard``) —
    but ``OrthoDirty`` does NOT call ``OrthoInvalidateDoDraw``
    (``layer1/Ortho.cpp:518-527``), so the cached ortho CGO is not rebuilt and
    the window keeps showing the old pitch until something else invalidates it
    (a reshape, or any console line via ``OrthoNewLine``).  Measured: after
    ``set internal_gui_control_size, 40`` not one pixel of the column changed —
    and a click that had been landing on row 0 landed on row 1.  Only the click
    is asserted: any feedback line arriving inside the window would legitimately
    redraw, so "no pixels changed" is an observation, not a contract.

    At size 18 the block is ``[60, 99]`` and y=95 is row 0, the non-clickable
    'Message' text.  At size 40 it is ``[60, 143]`` and the same y is row 1,
    'Dismiss', whose code is ``cmd.set_wizard()``.  ``a = ((rect.top - (y + 2))
    - 0) / LineHeight`` (``layer1/Wizard.cpp:487``).
    """
    ws = gui_on
    ws.do(WIZ_BOOTSTRAP)
    ws.call("cmd.set", "mouse_grid", 0)
    assert reshape(ws) == (W - COLUMN * dip, H)
    ws.call("wizards.dismiss", all=True)
    settle(ws)
    try:
        empty = grab(gl_bridge)

        ws.call("wizards.launch", "message", ["f7 layout probe"])
        panel = ws.call("wizards.snapshot")["panel"]
        assert [row["kind"] for row in panel] == ["text", "button"]
        settle(ws)
        with_wizard = grab(gl_bridge)

        control_size = int(ws.call("cmd.get_setting_int", "internal_gui_control_size"))
        assert control_size == 18, "the default control size moved"
        wizard_bottom = (CONTROL_H + BUTMODE_H) * dip
        height = control_size * dip * len(panel) + WIZARD_PAD
        rows = rows_differing(empty, with_wizard, W - COLUMN * dip, W)
        assert rows, "a wizard appeared and nothing was drawn"
        assert rows[-1] == wizard_bottom + height - 1, (
            "wizard band top edge %d, expected %d" % (rows[-1], wizard_bottom + height - 1)
        )
        assert rows[0] >= wizard_bottom, "the wizard drew below its own block"

        # y=95: row 0 at size 18 (text, inert), row 1 at size 40 (Dismiss).
        probe_y = 95
        assert (wizard_bottom + height - 1 - (probe_y + 2)) // (control_size * dip) == 0
        click(ws, W - COLUMN * dip + 40, probe_y)
        assert int(ws.call("wizards.probe")["depth"]) == 1, (
            "y=%d hit a button row at control size %d" % (probe_y, control_size)
        )

        ws.call("cmd.set", "internal_gui_control_size", 40)
        taller = 40 * dip * len(panel) + WIZARD_PAD
        assert (wizard_bottom + taller - 1 - (probe_y + 2)) // (40 * dip) == 1
        click(ws, W - COLUMN * dip + 40, probe_y)
        assert int(ws.call("wizards.probe")["depth"]) == 0, (
            "the wizard block did not relayout to control size 40 without a reshape"
        )
    finally:
        ws.call("wizards.dismiss", all=True)


def test_the_wizard_band_scales_with_control_size_in_pixels_too(
    gui_on: WSClient, gl_bridge: RunningBridge, dip: int
) -> None:
    """The other factor of ``LineHeight * NLine + 4``, in the framebuffer.

    The test above reads the second control size off the block's CLICK PITCH,
    because ``internal_gui_control_size`` relayouts without invalidating the
    cached ortho CGO.  A reshape does invalidate it, so with one in the middle
    the band can be measured in pixels at a size the default never touches.
    MEASURED, wizard-vs-no-wizard at ``internal_gui_control_size`` 30 on the
    same 800x600 window: the drawn band tops out at y=123, i.e. 60..123 =
    30*2 + 4 = 64 px, against 60..99 = 40 px at the default 18.  Same block,
    same 2-row panel, only the first factor moved.
    """
    ws = gui_on
    ws.do(WIZ_BOOTSTRAP)
    ws.call("cmd.set", "mouse_grid", 0)
    ws.call("cmd.set", "internal_gui_control_size", 30)
    assert reshape(ws) == (W - COLUMN * dip, H)
    ws.call("wizards.dismiss", all=True)
    settle(ws)
    try:
        empty = grab(gl_bridge)
        ws.call("wizards.launch", "message", ["f7 layout probe"])
        settle(ws)
        rows = rows_differing(empty, grab(gl_bridge), W - COLUMN * dip, W)
        assert rows, "a wizard appeared and nothing was drawn"
        assert rows[-1] == (CONTROL_H + BUTMODE_H) * dip + 30 * dip * 2 + WIZARD_PAD - 1
    finally:
        ws.call("wizards.dismiss", all=True)


def test_no_wizard_means_no_wizard_block_and_the_executive_reaches_butmode(
    gui_on: WSClient
) -> None:
    """Row 88's "(0 if absent)", from the input path.

    ``OrthoLayoutPanel`` gives the Wizard block ``block->active = false`` and
    ``OrthoReshapeWizard(0)`` keeps it there, so with no wizard the Executive
    block extends all the way down to the top of ButMode.  The click at y=70 is
    inside the band a 2-row wizard would occupy; with no wizard it reaches the
    Executive block, which at this x does nothing at all.
    """
    ws = gui_on
    ws.do(WIZ_BOOTSTRAP)
    ws.call("wizards.dismiss", all=True)
    assert int(ws.call("wizards.probe")["depth"]) == 0
    assert probe_column(ws, 70) == "none"


# =================================================================== row 209
# What SettingGenerateSideEffects actually does to a client


def test_the_seven_layout_settings_share_one_side_effect_a_viewport_command() -> None:
    """The case list, asserted against the C++ (SOURCE — it is a switch).

    Everything else in this section measures the CONSEQUENCE of this branch;
    this is the branch itself, pinned so that a setting quietly joining or
    leaving the list is caught rather than silently changing the contract.
    """
    source = open(SETTING_CPP, encoding="utf-8", errors="replace").read()
    block = re.search(
        r"((?:  case cSetting_\w+:\n)+)"
        r"    if\(!SettingGetGlobal_b\(G, cSetting_suspend_updates\)\) \{\n"
        r"      OrthoCommandIn\(G, \"viewport\"\);",
        source,
    )
    assert block, "the OrthoCommandIn(\"viewport\") branch moved"
    assert re.findall(r"case cSetting_(\w+):", block.group(1)) == list(LAYOUT_SETTINGS)


def test_a_layout_setting_relayouts_immediately_now(
    gui_on: WSClient, gl_bridge: RunningBridge, dip: int
) -> None:
    """FIXED IN WAVE 10.  This test used to pin the staleness.

    ``mouse_grid`` is a setting whose whole job is layout, and writing it used
    to change NOTHING until a reshape arrived: not one pixel of the column
    moved, and a click at y=100 — inside the band ``mouse_grid`` had just
    created — still missed the ButMode block.

    ``OrthoCommandIn(G, "viewport")`` queues ``viewport`` with no arguments,
    which ends in ``PyMOL_NeedReshape`` (``layer5/PyMOL.cpp:2511-2536``) — a
    request to the windowing system, and the bridge was not one.  Qt is, and
    what it does with the bare command is one line (``pymol_qt_gui.py:67-70``):
    ``pw.pymol.reshape(w, h, True)`` at the CURRENT window size.
    ``Engine._install_viewport_seam`` now does exactly that, so the relayout
    happens on the write and there is no window in which the scene rectangle
    and the canvas disagree.
    """
    ws = gui_on
    ws.call("cmd.set", "mouse_grid", 0)
    assert reshape(ws) == (W - COLUMN * dip, H)
    settle(ws)
    before = grab(gl_bridge)

    ws.call("cmd.set", "mouse_grid", 1)
    settle(ws)
    assert int(ws.call("cmd.get_setting_int", "mouse_grid")) == 1, "the write itself was lost"
    assert rows_differing(before, grab(gl_bridge), W - COLUMN * dip, W) != [], (
        "the column did NOT redraw; the viewport seam is gone"
    )
    assert probe_column(ws, 100) == "butmode-mode", "the ButMode block did not grow"

    # ...and a reshape afterwards is idempotent, not a second correction.
    assert reshape(ws) == (W - COLUMN * dip, H)
    settle(ws)
    assert probe_column(ws, 100) == "butmode-mode"


def test_internal_feedback_no_longer_leaves_the_scene_42px_out_of_date(
    column: WSClient, dip: int
) -> None:
    """FIXED IN WAVE 10.  The one case in the seven a web client trips over.

    ``internal_gui`` is held at 0 by the bridge and the React column is DOM, so
    a stale ``mouse_grid`` cost nothing.  ``internal_feedback`` is different: it
    takes a band off the bottom of the SCENE, and the scene rectangle is what
    every forwarded mouse coordinate is expressed in.  What used to happen::

        set internal_feedback, 3   -> cmd.get_viewport() still 800x600
        ... one reshape later      -> 800x558

    i.e. a user typing that at the web prompt kept a viewport that agreed with
    the canvas until the next window resize and then silently stopped agreeing
    by 42 px.  The band is now taken on the write, which is Qt's own timing.
    """
    ws = column
    ws.call("cmd.set", "internal_gui", 0)
    ws.call("cmd.set", "internal_feedback", 0)
    assert reshape(ws) == (W, H)

    band = (2 * BUTMODE_LINE + 18) * dip  # (n-1)*cOrthoLineHeight + cOrthoBottomSceneMargin
    assert band == 42

    ws.call("cmd.set", "internal_feedback", 3)
    settle(ws)
    assert viewport(ws) == (W, H - band), "the scene rectangle did not move on the write"

    # The reshape that used to be the ONLY thing that applied it now finds
    # nothing left to do.
    assert reshape(ws) == (W, H - band)


def test_a_layout_setting_emits_nothing_on_the_geometry_topic_and_a_rep_one_does(
    column: WSClient
) -> None:
    """MEASURED.  Which channel a client should actually watch, per setting.

    The row's plan asks for "a geometry-invalidation event alongside
    ``settings.changed``".  The bridge has one, and it is content-addressed
    rather than switch-addressed: ``_cmd.web_get_versions`` re-hashes built reps
    and ``RenderService._on_tick`` emits the diff on the ``geometry`` topic
    (``render/__init__.py:213-230``).  ``test_wf_volume.py`` pins that it fires
    for rep settings and stays silent for ones that change no bytes.

    What is pinned HERE is the pairing this file's rows need: the seven layout
    settings produce NO geometry event — they are ortho, not scene — while
    ``stick_radius`` on the same object produces one within a 4 Hz scan.  So a
    client cannot use the geometry topic as a "something changed" bell for
    layout, and must not ignore it for reps.  Measured on a fragment of alanine:

        set mouse_grid / internal_gui_width / movie_panel -> []
        set stick_radius, 0.4 -> [{rep 0, level 100, reason 'changed'}]
    """
    ws = column
    ws.call("cmd.delete", "f7_ala")
    ws.call("cmd.fragment", "ala", "f7_ala")
    ws.call("cmd.show_as", "sticks", "f7_ala")
    ws.call("cmd.refresh")
    ws.subscribe("geometry")
    # Prime: the version table announces nothing on its first poll, and the
    # client's own first pull is what populates the cache it diffs against.
    assert ws.call("_bridge.get_geometry", object="f7_ala", rep="sticks")["status"] == "ok"
    drain_geometry(ws, 1.5)

    mine = lambda rows: [r for r in rows if r.get("object") == "f7_ala"]  # noqa: E731
    for name, value in (("mouse_grid", 0), ("internal_gui_width", 260), ("movie_panel", 1)):
        ws.call("cmd.set", name, value)
        assert mine(drain_geometry(ws, 1.2)) == [], "%s reached the geometry topic" % name

    ws.call("cmd.set", "stick_radius", 0.4)
    rows = mine(drain_geometry(ws, 2.5))
    assert rows, "stick_radius produced no invalidation — the pipe was dead"
    assert rows[0]["rep"] == 0 and rows[0]["level"] == 100
    assert rows[0]["reason"] == "changed" and rows[0]["active"] is True
