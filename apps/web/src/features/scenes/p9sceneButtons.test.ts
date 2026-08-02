/**
 * Row 333 — the three pieces of `SceneDrawButtons` the overlay never had:
 * the 8-dip character cell, `max_char` truncation and the vertical scrollbar.
 *
 * THE EXPECTED NUMBERS BELOW ARE DERIVED BY HAND from `layer1/Scene.cpp`, not
 * copied from a run of the code under test; each one carries the expression it
 * comes from. The constants themselves are cross-checked against the C source
 * at test time by
 * `bridge/tests/test_p9_rest.py::test_scene_button_geometry_matches_Scene_cpp`,
 * which re-reads `layer1/Scene.cpp`, `layer1/Scene.h` and this module — so a
 * `#define` that moves upstream fails there, and a formula that moves here
 * fails below.
 */

import { describe, expect, it } from 'vitest';
import {
  buttonAt,
  dip2pixel,
  isScrollBarClick,
  layoutSceneButtons,
  SCENE_BOTTOM_MARGIN,
  SCENE_CHAR_WIDTH_DIP,
  SCENE_SCROLLBAR_WIDTH_DIP,
  SCENE_TOGGLE_WIDTH_DIP,
} from './sceneButtonGeometry';

/** The default block in this build: `cmd.get_viewport()` is 800x600. */
const BLOCK = { left: 0, right: 800, bottom: 0, top: 600 };

describe('the layout is SceneDrawButtons`', () => {
  it('is 8 dip per character and one control-size row', () => {
    const layout = layoutSceneButtons({ rect: BLOCK, names: ['a'] });
    // charWidth = DIP2PIXEL(8) with _gScaleFactor 1.
    expect(layout.charWidth).toBe(8);
    // lineHeight = DIP2PIXEL(internal_gui_control_size), default 18.
    expect(layout.lineHeight).toBe(18);
    // text_lift = lineHeight/2 - DIP2PIXEL(5) = 9 - 5.
    expect(layout.textLift).toBe(4);
  });

  it('scales every dimension by display_scale_factor, as DIP2PIXEL does', () => {
    const layout = layoutSceneButtons({ rect: BLOCK, names: ['abc'], scale: 2 });
    expect(layout.charWidth).toBe(16);
    expect(layout.lineHeight).toBe(36);
    // x = left + DIP2PIXEL(SceneTextLeftMargin=1) = 2
    // x2 = x + 3*16 + DIP2PIXEL(6) = 2 + 48 + 12
    expect(layout.buttons[0]?.left).toBe(2);
    expect(layout.buttons[0]?.right).toBe(62);
  });

  it('sizes a button by its NAME, not by the box it is in', () => {
    const layout = layoutSceneButtons({ rect: BLOCK, names: ['ab', 'abcdef'] });
    // x2 = x + len*charWidth + DIP2PIXEL(6); x = 0 + 1 = 1.
    expect(layout.buttons[0]?.width).toBe(2 * 8 + 6);
    expect(layout.buttons[1]?.width).toBe(6 * 8 + 6);
    expect(layout.buttons[0]?.left).toBe(1);
  });

  it('stacks downward from the top of the visible run, one row per entry', () => {
    const layout = layoutSceneButtons({ rect: BLOCK, names: ['a', 'b', 'c'] });
    // y = bottom + SceneBottomMargin + (n_vis-1)*lineHeight, then y -= lineHeight.
    const first = SCENE_BOTTOM_MARGIN + 2 * 18;
    expect(layout.buttons.map((b) => b.bottom)).toEqual([first, first - 18, first - 36]);
    // …and `topOffset` is the same stack measured from the top, for CSS.
    expect(layout.buttons[0]?.topOffset).toBe(600 - (first + 18));
  });
});

describe('max_char', () => {
  it('cuts a name to the characters that fit, and PyMOL does not add an ellipsis', () => {
    // max_char = ((800 - (1 + 0 + 4)) - 1*17) / 8 = 778/8 = 97 (truncated).
    const wide = layoutSceneButtons({ rect: BLOCK, names: ['x'.repeat(200)] });
    expect(wide.maxChar).toBe(97);
    expect(wide.buttons[0]?.label).toHaveLength(97);
    expect(wide.buttons[0]?.label.endsWith('…')).toBe(false);
    expect(wide.buttons[0]?.truncated).toBe(true);

    // A name that fits is untouched.
    const short = layoutSceneButtons({ rect: BLOCK, names: ['scene_one'] });
    expect(short.buttons[0]?.label).toBe('scene_one');
    expect(short.buttons[0]?.truncated).toBe(false);
  });

  it('shrinks with the block, one character per 8 px', () => {
    const rect = { left: 0, right: 8 * 10 + 5 + SCENE_TOGGLE_WIDTH_DIP, bottom: 0, top: 600 };
    // ((w - 5) - 17)/8 = 80/8 = 10
    const layout = layoutSceneButtons({ rect, names: ['abcdefghijklmno'] });
    expect(layout.maxChar).toBe(10);
    expect(layout.buttons[0]?.label).toBe('abcdefghij');
  });

  it('loses another 14 px of names the moment a scrollbar appears', () => {
    const rect = { left: 0, right: 800, bottom: 0, top: 3 * 18 }; // n_disp = 2
    const withoutBar = layoutSceneButtons({ rect, names: ['a', 'b'] });
    const withBar = layoutSceneButtons({ rect, names: ['a', 'b', 'c'] });
    expect(withoutBar.scrollBar).toBeNull();
    expect(withBar.scrollBar).not.toBeNull();
    // max_char -= (SceneScrollBarMargin + SceneScrollBarWidth) = 1 + 13
    expect(withoutBar.maxChar - withBar.maxChar).toBe(
      Math.trunc((SCENE_SCROLLBAR_WIDTH_DIP + 1) / SCENE_CHAR_WIDTH_DIP) + 1,
    );
    // and the text column starts to the right of the bar.
    expect(withBar.buttons[0]?.left).toBe(1 + 13 + 1);
  });
});

describe('the scrollbar', () => {
  it('appears exactly when the list is longer than n_disp rows', () => {
    // n_disp = ((top-bottom) - SceneTopMargin)/lineHeight - 1
    const rect = { left: 0, right: 800, bottom: 0, top: 5 * 18 }; // 5 - 1 = 4
    const four = layoutSceneButtons({ rect, names: ['a', 'b', 'c', 'd'] });
    expect(four.nDisp).toBe(4);
    expect(four.scrollBar).toBeNull();

    const five = layoutSceneButtons({ rect, names: ['a', 'b', 'c', 'd', 'e'] });
    expect(five.scrollBar).toEqual({
      left: 1,
      right: 14,
      top: 5 * 18 - 1,
      bottom: 2,
      width: 13,
      total: 5,
      visible: 4,
    });
  });

  it('never reports fewer than one visible row, however short the block', () => {
    const layout = layoutSceneButtons({
      rect: { left: 0, right: 800, bottom: 0, top: 4 },
      names: ['a', 'b'],
    });
    expect(layout.nDisp).toBe(1);
    expect(layout.scrollBar?.total).toBe(2);
  });

  it('drops NSkip entries off the top of the list', () => {
    const rect = { left: 0, right: 800, bottom: 0, top: 3 * 18 }; // n_disp = 2
    const layout = layoutSceneButtons({ rect, names: ['a', 'b', 'c', 'd'], skip: 2 });
    expect(layout.buttons.map((b) => b.name)).toEqual(['c', 'd']);
  });

  it('stops drawing when the next row would fall below the block', () => {
    // 4 entries in a 3-row block: n_disp = 3 - 1 = 2, and the stack is
    // ANCHORED AT THE BOTTOM -- y starts at bottom + 3 + (n_vis-1)*18 = 21 and
    // walks down, so the loop breaks on `y < rect.bottom` after two rows even
    // though four names were handed in.
    const rect = { left: 0, right: 800, bottom: 0, top: 3 * 18 };
    const layout = layoutSceneButtons({ rect, names: ['a', 'b', 'c', 'd'] });
    expect(layout.nDisp).toBe(2);
    expect(layout.buttons.map((b) => b.name)).toEqual(['a', 'b']);
    // The last row sits exactly on the bottom margin; the break is checked
    // AFTER the rect is stored, so a row landing on it is drawn, not dropped.
    expect(layout.buttons[1]?.bottom).toBe(SCENE_BOTTOM_MARGIN);
    // One row of headroom is deliberately left above: n_disp is
    // `height/lineHeight - 1`, never `height/lineHeight`.
    expect(layout.buttons[0]?.top).toBe(SCENE_BOTTOM_MARGIN + 2 * 18);
  });
});

describe('the guards', () => {
  it('shows nothing for an empty list', () => {
    const layout = layoutSceneButtons({ rect: BLOCK, names: [] });
    expect(layout.shown).toBe(false);
    expect(layout.buttons).toEqual([]);
  });

  it('shows nothing in a block 6 px wide or less', () => {
    expect(
      layoutSceneButtons({ rect: { left: 0, right: 6, bottom: 0, top: 600 }, names: ['a'] }).shown,
    ).toBe(false);
    expect(
      layoutSceneButtons({ rect: { left: 0, right: 7, bottom: 0, top: 600 }, names: ['a'] }).shown,
    ).toBe(true);
  });
});

describe('hit testing is PyMOL`s', () => {
  it('is STRICT on every edge, so the seam between rows hits nothing', () => {
    const layout = layoutSceneButtons({ rect: BLOCK, names: ['alpha', 'beta'] });
    const first = layout.buttons[0]!;
    expect(buttonAt(layout, first.left + 1, first.bottom + 1)?.name).toBe('alpha');
    // `Rect::contains(x, y, proper = true)` — `>` and `<`, never `>=`.
    expect(buttonAt(layout, first.left, first.bottom + 1)).toBeNull();
    expect(buttonAt(layout, first.left + 1, first.bottom)).toBeNull();
    expect(buttonAt(layout, first.right, first.bottom + 1)).toBeNull();
  });

  it('gives the left gutter to the scrollbar, as SceneClick does', () => {
    const rect = { left: 0, right: 800, bottom: 0, top: 3 * 18 };
    const layout = layoutSceneButtons({ rect, names: ['a', 'b', 'c'] });
    // (x - rect.left) < SceneScrollBarWidth + SceneScrollBarMargin
    expect(isScrollBarClick(layout, rect, 13)).toBe(true);
    expect(isScrollBarClick(layout, rect, 14)).toBe(false);
    const noBar = layoutSceneButtons({ rect, names: ['a'] });
    expect(isScrollBarClick(noBar, rect, 0)).toBe(false);
  });
});

describe('dip2pixel', () => {
  it('is a multiply, which is why every constant here is a DIP', () => {
    expect(dip2pixel(SCENE_CHAR_WIDTH_DIP, 1)).toBe(8);
    expect(dip2pixel(SCENE_CHAR_WIDTH_DIP, 3)).toBe(24);
  });
});
