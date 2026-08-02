"""What PyMOL RESERVES in the internal-GUI column, at the browser's own height.

NOT A PARITY ROW.  This file exists to put a number under a product fix: the
web client's `.internal-gui` column was measured in Chromium at 1280x900 giving
the OBJECT LIST 34 px of 644 with six objects loaded, and 0 px once three
scenes were stored — every row rendered, one row reachable, then none.  The
fix (`apps/web/src/features/objects/objects.css`, `movie.css`, `scenes.css`,
`styles/global.css`) gives the object list a floor.  A floor needs a
justification that is not taste, so this file measures the two things upstream
actually charges the column for, and the one thing it does not.

WHAT ``OrthoReshape`` / ``OrthoLayoutPanel`` DO (``packages/engine/layer1/Ortho.cpp:2261-2456``):

    textBottom      = MovieGetPanelHeight(G)          # a FULL-WIDTH strip at
                                                      # the bottom of the WINDOW
    controlBottom   = textBottom                      # the column starts above it
    butModeBottom   = controlBottom + 20              # DIP2PIXEL(20), fixed
    wizardBottom    = butModeBottom + ButModeGetHeight(G)
    executiveBottom = wizardBottom  + I->WizardHeight
    Executive       = m_top(0) .. executiveBottom     # THE RESIDUAL

So exactly three things outrank the object list, and every one of them is
either a constant or content-sized: Control 20, ButMode 40 (124 with
``mouse_grid``), Wizard ``control_size * NLine + 4`` and 0 with no wizard.  The
movie panel is charged BEFORE the column is laid out, but it is charged to the
whole window width, not to the 220 px column.

AND THE SCENE BIN IS CHARGED NOTHING AT ALL.  ``SceneDrawButtons``
(``packages/engine/layer1/Scene.cpp:2885-2905``) draws into ``I->rect`` — the SCENE's
rectangle — and its first guard is ``!I->SceneVec.empty()``, so with no scenes
stored it draws nothing whatsoever.  The web `.scpanel` was measured taking
**217 px of the 644 px column with zero scenes in the session**.  The answer to
"is that close to what PyMOL reserves" is measured below: it is 217 px more.

INSTRUMENTS.  ``cmd`` exposes no block rectangle, so both readings here are
indirect and both are already established by ``test_f7_layout.py``:

  * ``cmd.get_viewport()`` after a real reshape gives the SCENE rectangle, and
    ``sceneBottom = textBottom + (internal_feedback - 1) * 12 + 18``.  With
    ``internal_feedback`` 0, ``sceneBottom == textBottom``, so the scene height
    lost to a movie panel IS ``MovieGetPanelHeight``.
  * WHICH BLOCK ANSWERS A CLICK IS THAT BLOCK'S RECTANGLE
    (``OrthoButton`` -> ``Block::recursiveFind``).  A click inside the ButMode
    band runs ``mouse forward`` and moves ``button_mode``; one pixel above it
    does nothing.  That edge is ``executiveBottom``.

SHARED STATE.  This file writes layout globals, ``button_mode``, the movie and
the object list, and clicks into the ortho blocks.  Everything is snapshotted
and restored by the ``bench`` fixture, which also asserts the scene rectangle
came back — the same discipline ``test_f7_layout.py`` uses, for the same reason
(the whole bridge suite shares one PyMOL process).
"""

from __future__ import annotations

import os
import sys
from typing import Iterator, List, Tuple

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import RunningBridge, WSClient  # noqa: E402

#: The browser window every measurement is compared against.
BROWSER_W, BROWSER_H = 1280, 900

#: MEASURED IN CHROMIUM at that window size: `.internal-gui`'s own height, once
#: the menubar, the status bar, the feedback pane and the command line have
#: taken theirs.  Every number below is taken in a PyMOL window of exactly this
#: height so the two columns are comparable rather than merely similar.
COLUMN_H = 644

#: ``cOrthoRightSceneMargin`` / the ``internal_gui_width`` default.
COLUMN_W = 220

#: ``packages/engine/layer1/Ortho.cpp:2267`` — ``controlHeight = DIP2PIXEL(20)``.
CONTROL_H = 20
#: ``ButModeGetHeight`` (``packages/engine/layer1/ButMode.cpp:72-78``), without / with
#: ``mouse_grid``.  Both measured by click in ``test_f7_layout.py``.
BUTMODE_H, BUTMODE_GRID_H = 40, 124

#: ``movie_panel_row_height`` (``packages/engine/layer1/SettingInfo.h:722``).
MOVIE_ROW_H = 15

#: THE FLOOR THE WEB CLIENT IMPLEMENTS, and the whole point of this file.
#: ``.objpanel__rows { min-height: 144px }`` — ``controlHeight`` plus the
#: LARGEST ``ButModeGetHeight``, i.e. the object list is never handed less than
#: the two blocks that outrank it can ever take between them.  Asserted below
#: to be a strict under-estimate of what PyMOL itself hands the Executive block
#: at the same column height.
WEB_EXEC_FLOOR = 144

#: Globals this file writes.
TOUCHED_INT = (
    "internal_gui",
    "internal_gui_width",
    "internal_gui_mode",
    "internal_feedback",
    "mouse_grid",
    "movie_panel",
    "movie_panel_row_height",
    "internal_gui_control_size",
    "scene_buttons",
    "button_mode",
    "mouse_selection_mode",
)


def reshape(ws: WSClient, width: int, height: int) -> Tuple[int, int]:
    """Drive a real canvas resize and read the scene rectangle back.

    ``cmd.set`` on a layout setting only QUEUES ``viewport``; the bridge is not
    a windowing system, so nothing relayouts until a reshape arrives.
    """
    ws.input("reshape", width=width, height=height)
    w, h = ws.call("cmd.get_viewport")
    return int(w), int(h)


def restore_viewport(ws: WSClient, target: Tuple[int, int]) -> Tuple[int, int]:
    """Reshape until ``cmd.get_viewport()`` reports ``target`` again.

    THE LEAK THIS EXISTS TO CLOSE, and it is not hypothetical: the first draft
    of this file reshaped back to a HARD-CODED 1280x900 and left the whole
    shared process there. ``test_p9_rest.py:543`` asserts
    ``cmd.get_viewport() == (800, 600)``, and it went red in the full suite
    while passing on its own — the classic shape of a leak, blamed on whoever
    happened to be editing that file at the time.

    The window is not the scene: PyMOL takes the feedback band, the movie strip
    and the internal-GUI column off it, and how much depends on settings this
    file spends its time changing. Rather than model that, this iterates — the
    relation is linear, so one correction converges — and hands back what the
    engine finally reports so the caller can assert on it.
    """
    tw, th = target
    w, h = tw, th
    got = (0, 0)
    for _ in range(4):
        ws.input("reshape", width=w, height=h)
        gw, gh = ws.call("cmd.get_viewport")
        got = (int(gw), int(gh))
        if got == target:
            return got
        w += tw - got[0]
        h += th - got[1]
    return got


def settle(ws: WSClient, seconds: float = 1.2) -> None:
    ws.pump_frames(seconds)


def click(ws: WSClient, x: int, y: int) -> None:
    ws.input("button", button=0, state=0, x=x, y=y, mod=0, when=0.0)
    ws.input("button", button=0, state=1, x=x, y=y, mod=0, when=0.0)
    settle(ws, 1.3)


def button_mode(ws: WSClient) -> int:
    return int(ws.call("cmd.get_setting_int", "button_mode"))


def modes(ws: WSClient) -> Tuple[int, int]:
    return (
        int(ws.call("cmd.get_setting_int", "button_mode")),
        int(ws.call("cmd.get_setting_int", "mouse_selection_mode")),
    )


def answers_butmode(ws: WSClient, y: int) -> bool:
    """Click the column at height ``y``; True when the ButMode block took it.

    ``x`` is one pixel inside the column's left edge — the one x at which a
    click on the Executive block is a guaranteed no-op, for the two reasons
    ``test_f7_layout.probe_column`` spells out (the toggle-column test needs
    ``(rect.right - x - 1) / ExecToggleWidth < op_cnt``, and the name test
    needs ``(xx - 1) / 8 > nest_level``).

    BOTH of the block's own settings are watched.  ``CButMode::click`` splits on
    ``dy = (y - rect.bottom) / cButModeLineHeight``: at ``dy < 2`` it runs
    ``mouse select_forward`` and moves ``mouse_selection_mode``, and only above
    that does it run ``mouse forward`` and move ``button_mode``.  Watching only
    the second reported "the block does not answer" for the bottom 24 px of its
    own band — which is how the first draft of this file mis-measured it.
    """
    before = modes(ws)
    click(ws, BROWSER_W - COLUMN_W + 1, y)
    return modes(ws) != before


#: The lowest y at which a click is a RE-USABLE probe, relative to the block's
#: own bottom.  ``mouse select_forward`` SATURATES: measured, it walked
#: ``mouse_selection_mode`` 1,2,3,4,5,6 and then stopped changing, so the
#: seventh click in the bottom band looks exactly like a click that missed the
#: block.  ``mouse forward`` WRAPS (measured 0,1,0,1,...), so every probe is
#: taken at ``dy >= 2`` — 2 * ``cButModeLineHeight`` (12) above ``rect.bottom``,
#: plus one.  The first draft bisected from ``rect.bottom + 1`` and reported
#: "the block does not answer" for a block that answers perfectly well.
PROBE_LIFT = 2 * 12 + 1


def butmode_top(ws: WSClient, lo: int, hi: int) -> int:
    """The highest y at which the ButMode block still answers, by bisection.

    Returns ``executiveBottom - 1``: one pixel higher and the Executive block
    takes the click and does nothing.  Costs ~log2(hi-lo) clicks at 1.3 s each,
    which is why it bisects instead of scanning.
    """
    assert answers_butmode(ws, lo), "the ButMode block does not answer at y=%d" % lo
    assert not answers_butmode(ws, hi), "the ButMode block still answers at y=%d" % hi
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if answers_butmode(ws, mid):
            lo = mid
        else:
            hi = mid
    return lo


@pytest.fixture
def bench(ws: WSClient, gl_bridge: RunningBridge) -> Iterator[WSClient]:
    """``internal_gui`` on, 220 px wide, no feedback band, at 1280x644.

    ``gl_bridge`` because the click instrument needs a draw: without GL the
    engine never calls ``p.draw()`` (``engine.py:236-239``) and ``OrthoButton``'s
    deferred queue is never drained.

    ``internal_feedback`` 0 so ``sceneBottom == textBottom`` exactly, which is
    what makes ``MovieGetPanelHeight`` readable off ``cmd.get_viewport()``.
    ``mouse_grid`` 0 because ITS DEFAULT IS 1 — a test that assumed otherwise
    would be measuring the 124 px band while claiming the 40 px one.
    """
    saved = {n: int(ws.call("cmd.get_setting_int", n)) for n in TOUCHED_INT}
    saved_view = list(ws.call("cmd.get_view"))
    # THE SCENE RECTANGLE AS FOUND, before a single reshape. Not a size this
    # file chooses: the rest of the suite runs at whatever the rig booted with
    # and at least one test asserts on it exactly (`test_p9_rest.py:543`).
    before = tuple(int(v) for v in ws.call("cmd.get_viewport"))

    ws.call("cmd.set", "internal_gui", 1)
    ws.call("cmd.set", "internal_gui_width", COLUMN_W)
    ws.call("cmd.set", "internal_gui_mode", 0)
    ws.call("cmd.set", "internal_feedback", 0)
    ws.call("cmd.set", "mouse_grid", 0)
    ws.call("cmd.set", "movie_panel", 0)
    ws.subscribe("pixels")
    assert reshape(ws, BROWSER_W, COLUMN_H) == (BROWSER_W - COLUMN_W, COLUMN_H)
    settle(ws)
    try:
        yield ws
    finally:
        for name, value in saved.items():
            if name != "button_mode":
                ws.call("cmd.set", name, value)
        # `button_mode` is applied to the C button table by `cmd.mouse` as a
        # side effect; a bare `cmd.set` would leave the table disagreeing with
        # the setting for every later test in the shared process.
        for _ in range(10):
            if button_mode(ws) == saved["button_mode"]:
                break
            ws.call("cmd.mouse", "forward")
        for name in ("p11l_a", "p11l_b", "p11l_c"):
            ws.call("cmd.delete", name)
        ws.call("cmd.mset", "")
        ws.call("cmd.set_view", saved_view)
        ws.call("cmd.set_view", saved_view)
        after = restore_viewport(ws, before)
        assert after == before, "test_p11_layout leaked: scene %r -> %r" % (before, after)
        assert {n: int(ws.call("cmd.get_setting_int", n)) for n in TOUCHED_INT} == saved


def test_the_executive_block_is_the_residual_at_the_browsers_column_height(
    bench: WSClient,
) -> None:
    """MEASURED BY CLICK, in a window exactly as tall as the browser's column.

    The web `.internal-gui` is 644 px at 1280x900 (measured in Chromium).  In a
    PyMOL window of the same height, with no wizard, ``mouse_grid`` off and no
    movie panel, the ButMode block answers a click up to y=59 and stops at y=60
    — bottom-up window coordinates, so the Executive block runs 60..643:

        executiveBottom = 0 + 20 (Control) + 40 (ButMode) + 0 (Wizard) = 60
        Executive       = 644 - 60 = 584 px

    584 of 644 is **90.7%** of the column.  The web client was measured handing
    the same list 34 px, and 0 px with three scenes stored.
    """
    ws = bench
    top = butmode_top(ws, lo=CONTROL_H + PROBE_LIFT, hi=CONTROL_H + BUTMODE_H + 40)
    exec_bottom = top + 1
    assert exec_bottom == CONTROL_H + BUTMODE_H, (
        "executiveBottom is %d, not controlHeight + ButModeGetHeight = %d"
        % (exec_bottom, CONTROL_H + BUTMODE_H)
    )
    executive = COLUMN_H - exec_bottom
    assert executive == 584, "the Executive block is %d px, not 584" % executive
    # The floor the web client implements is a STRICT under-estimate of this.
    assert WEB_EXEC_FLOOR < executive
    assert WEB_EXEC_FLOOR == CONTROL_H + BUTMODE_GRID_H


def test_the_movie_panel_is_charged_to_the_window_not_to_the_column(
    bench: WSClient,
) -> None:
    """MEASURED.  ``MovieGetPanelHeight`` = ``row_height * ExecutiveCountMotions``.

    The number the web `.mvpanel` should be compared against.  Six objects and
    a 30-frame movie, ``movie_panel`` on:

        scene 1060x644 -> 1060x629      i.e. textBottom = 15 px

    ``ExecutiveCountMotions`` counts the camera plus every object that HAS a
    motion, and ``mset`` alone gives motions to nothing, so a six-object session
    charges the column exactly one ``movie_panel_row_height`` — 15 px.  The web
    `.mvpanel` was measured at **223 px** in the same session, and it is charged
    to the 220 px column rather than to the full window width.

    The Executive block moves down by exactly that 15 px and no more, which is
    the second half of the claim: the movie panel is a bottom margin, not a
    competitor.
    """
    ws = bench
    ws.call("cmd.load", "packages/engine/test/dat/1tii.pdb", "p11l_a")
    ws.call("cmd.load", "packages/engine/test/dat/1tii.pdb", "p11l_b")
    ws.call("cmd.load", "packages/engine/test/dat/1tii.pdb", "p11l_c")
    ws.call("cmd.mset", "1 x30")
    settle(ws)

    off = reshape(ws, BROWSER_W, COLUMN_H)
    assert off == (BROWSER_W - COLUMN_W, COLUMN_H)

    ws.call("cmd.set", "movie_panel", 1)
    on = reshape(ws, BROWSER_W, COLUMN_H - 1)
    on = reshape(ws, BROWSER_W, COLUMN_H)
    text_bottom = off[1] - on[1]
    assert text_bottom == MOVIE_ROW_H, (
        "MovieGetPanelHeight is %d, not one movie_panel_row_height (%d)"
        % (text_bottom, MOVIE_ROW_H)
    )

    # And the column's blocks all move up by exactly that, no more.
    top = butmode_top(
        ws,
        lo=text_bottom + CONTROL_H + PROBE_LIFT,
        hi=text_bottom + CONTROL_H + BUTMODE_H + 40,
    )
    exec_bottom = top + 1
    assert exec_bottom == text_bottom + CONTROL_H + BUTMODE_H
    executive = COLUMN_H - exec_bottom
    assert executive == 584 - MOVIE_ROW_H, "the Executive block is %d px" % executive
    assert executive == 569


def test_the_scene_bin_reserves_zero_column_height(bench: WSClient) -> None:
    """MEASURED.  ``scene_buttons`` moves NOTHING — not the scene, not a block.

    ``SceneDrawButtons`` (``packages/engine/layer1/Scene.cpp:2885``) draws into ``I->rect``, the
    SCENE's rectangle, and returns immediately when ``I->SceneVec`` is empty.
    So the answer to "is the web `.scpanel` at 217 px with zero scenes close to
    what PyMOL reserves" is: PyMOL reserves 0, with three scenes stored as well
    as with none, and the 217 px is 217 px the object list does not get.

    Both halves are measured, because "the setting did nothing" is a claim that
    needs the reshape to have actually run:

        scene_buttons 0, no scenes   -> scene 1060x644, executiveBottom 60
        scene_buttons 1, no scenes   -> scene 1060x644, executiveBottom 60
        scene_buttons 1, 3 scenes    -> scene 1060x644, executiveBottom 60
    """
    ws = bench
    saved_scenes = list(ws.call("cmd.get_scene_list") or [])

    ws.call("cmd.set", "scene_buttons", 0)
    base = reshape(ws, BROWSER_W, COLUMN_H - 1)
    base = reshape(ws, BROWSER_W, COLUMN_H)
    top_off = butmode_top(ws, lo=CONTROL_H + PROBE_LIFT, hi=CONTROL_H + BUTMODE_H + 40)

    ws.call("cmd.set", "scene_buttons", 1)
    assert reshape(ws, BROWSER_W, COLUMN_H - 1)
    assert reshape(ws, BROWSER_W, COLUMN_H) == base, "scene_buttons moved the scene rectangle"

    names: List[str] = []
    try:
        for name in ("p11l_s1", "p11l_s2", "p11l_s3"):
            ws.call("cmd.scene", name, "store")
            names.append(name)
        settle(ws)
        assert reshape(ws, BROWSER_W, COLUMN_H - 1)
        assert reshape(ws, BROWSER_W, COLUMN_H) == base, (
            "storing three scenes moved the scene rectangle"
        )
        top_on = butmode_top(ws, lo=CONTROL_H + PROBE_LIFT, hi=CONTROL_H + BUTMODE_H + 40)
        assert top_on == top_off, (
            "the Executive block moved from %d to %d for three scenes; PyMOL "
            "reserves no column height for the scene bin at all" % (top_off, top_on)
        )
        assert COLUMN_H - (top_on + 1) == 584
    finally:
        for name in names:
            ws.call("cmd.scene", name, "delete")
        assert list(ws.call("cmd.get_scene_list") or []) == saved_scenes


def test_the_executive_block_is_measured_in_18_px_rows(bench: WSClient) -> None:
    """``ExecLineHeight`` is ``internal_gui_control_size``, and it is 18.

    ``ExecutiveDrawPanel`` (``packages/engine/layer3/Executive.cpp:16192-16221``) sizes the
    object list in rows of ``DIP2PIXEL(internal_gui_control_size)`` and computes
    ``n_disp = (rect.top - rect.bottom) / ExecLineHeight``, clamped to at least
    1.  That is the unit the web floor is stated in — 144 px is exactly 8 of
    these rows — and the row height `--pm-row-h` the object panel draws with.

    Measured rather than transcribed because the setting is a global any test
    in the shared process could have moved.
    """
    ws = bench
    assert int(ws.call("cmd.get_setting_int", "internal_gui_control_size")) == 18
    assert WEB_EXEC_FLOOR % 18 == 0
    assert WEB_EXEC_FLOOR // 18 == 8


def test_the_column_is_220_px_wide_and_the_browser_matches_it(bench: WSClient) -> None:
    """The one geometry the web column already reproduced, re-read here.

    Sanity for everything above: if ``internal_gui_width`` were not 220 in this
    process, every y measured by clicking at ``W - 220 + 1`` would be a click
    into the scene and every reading would be a fiction.
    """
    ws = bench
    assert int(ws.call("cmd.get_setting_int", "internal_gui_width")) == COLUMN_W
    assert reshape(ws, BROWSER_W, COLUMN_H) == (BROWSER_W - COLUMN_W, COLUMN_H)
