/**
 * Parity area 2, rows 112-113 — the busy box and the marquee, unit half.
 *
 * The engine-side facts these depend on are measured live in
 * `packages/bridge/tests/test_wf_ortho.py`:
 *
 *   * `cmd.get_progress()` is a single folded FRACTION, negative when idle,
 *     and `show_progress, 0` silences it entirely (13 frames across two rays,
 *     all -1.0);
 *   * `I->BusyMessage` and the four `I->BusyStatus[]` counters are not symbols
 *     on `cmd`, so the two-bar box cannot be reproduced;
 *   * `I->LoopRect` has no getter, so the rectangle has to be client-local.
 */

import { describe, expect, it } from 'vitest';
import {
  BUSY_BAR,
  BUSY_BAR_WIDTH,
  BUSY_HEIGHT,
  BUSY_MARGIN,
  BUSY_SPACING,
  BUSY_UPDATE_S,
  BUSY_WIDTH,
  DEFAULT_MODE,
  LOOP_ACTIONS,
  busyFillWidth,
  busyVisible,
  loopBox,
  loopKindFor,
  modeFromDisplayName,
  tableForDisplayName,
} from './orthoOverlays';
import { tableForMode } from '../../../../../packages/viewport/src/input/mouseConfig';

describe('the busy box geometry is PyMOL’s', () => {
  it('carries the five cBusy* constants verbatim', () => {
    // `packages/engine/layer1/Ortho.cpp:192-198`.
    expect([BUSY_WIDTH, BUSY_HEIGHT, BUSY_MARGIN, BUSY_BAR, BUSY_SPACING]).toEqual([
      240, 60, 10, 10, 15,
    ]);
    expect(BUSY_UPDATE_S).toBe(0.2);
    expect(BUSY_BAR_WIDTH).toBe(220); // cBusyWidth - 2 * cBusyMargin
  });

  it('maps the fraction onto the bar the way the C does', () => {
    // `x = status[0] * (cBusyWidth - 2*margin) / status[1]` (`:675-677`).
    expect(busyFillWidth(0)).toBe(0);
    expect(busyFillWidth(0.5)).toBe(110);
    expect(busyFillWidth(1)).toBe(220);
    // A real sample from a live ray (`test_wf_ortho.py` measured 0.3467).
    expect(busyFillWidth(0.3467)).toBe(76);
  });

  it('never draws a bar for the idle sentinel or for junk', () => {
    // -1.0 is "not busy" (`packages/engine/layer4/Cmd.cpp:4341`), NOT 0%. A client that
    // clamped it into 0..1 would leave a bar on screen forever.
    expect(busyFillWidth(-1)).toBe(0);
    expect(busyFillWidth(Number.NaN)).toBe(0);
    expect(busyFillWidth(Number.POSITIVE_INFINITY)).toBe(0);
    // Over-range cannot spill outside the 240 px box.
    expect(busyFillWidth(4)).toBe(220);
  });
});

describe('when the box is drawn', () => {
  it('needs a non-negative progress AND show_progress', () => {
    expect(busyVisible(-1, true)).toBe(false);
    expect(busyVisible(0, true)).toBe(true); // 0 is busy-at-zero, not idle
    expect(busyVisible(0.5, true)).toBe(true);
    expect(busyVisible(0.5, false)).toBe(false);
    expect(busyVisible(Number.NaN, true)).toBe(false);
  });
});

describe('the marquee rectangle', () => {
  it('normalises either drag direction, like SceneLoopRelease', () => {
    // `packages/engine/layer1/SceneMouse.cpp:76-88` swaps top/bottom and right/left so the
    // rect handed to `ExecutiveSelectRect` is well ordered.
    const downRight = loopBox({ x: 10, y: 20 }, { x: 110, y: 220 });
    expect(downRight).toEqual({ left: 10, top: 20, width: 100, height: 200 });

    const upLeft = loopBox({ x: 110, y: 220 }, { x: 10, y: 20 });
    expect(upLeft).toEqual(downRight);

    const upRight = loopBox({ x: 10, y: 220 }, { x: 110, y: 20 });
    expect(upRight).toEqual(downRight);
  });

  it('is a degenerate box before the pointer has moved', () => {
    // `SceneLoopClick` sets all four edges to the press point (`:49-52`).
    expect(loopBox({ x: 7, y: 9 }, { x: 7, y: 9 })).toEqual({
      left: 7,
      top: 9,
      width: 0,
      height: 0,
    });
  });

  it('knows the six action codes that start a loop', () => {
    // The `switch` in `SceneClick` (`packages/engine/layer1/SceneMouse.cpp:803-809`), values
    // from `packages/engine/layer1/ButMode.h:44-46,58-59,91`.
    expect(LOOP_ACTIONS).toEqual({
      19: 'add',
      20: 'subtract',
      21: 'set',
      32: 'add',
      33: 'subtract',
      52: 'set',
    });
  });
});

describe('which drags draw a marquee in the default mouse mode', () => {
  const table = tableForMode(DEFAULT_MODE);
  const SHIFT = 1;
  const CTRL = 2;
  const LEFT = 0;
  const MIDDLE = 1;
  const RIGHT = 2;

  it('shift+left adds and shift+middle subtracts', () => {
    // Pinned against the live engine in
    // `test_box_selection.py::test_the_box_actions_live_on_shift_drag`, which
    // read `('l','shft','+Box')` and `('m','shft','-Box')` out of
    // `cmd.controlling.mode_dict['three_button_viewing']`.
    expect(loopKindFor(table, LEFT, SHIFT)).toBe('add');
    expect(loopKindFor(table, MIDDLE, SHIFT)).toBe('subtract');
  });

  it('draws nothing for a plain rotate, a pan or a ctrl-drag', () => {
    expect(loopKindFor(table, LEFT, 0)).toBeNull(); // Rota
    expect(loopKindFor(table, MIDDLE, 0)).toBeNull(); // Move
    expect(loopKindFor(table, RIGHT, 0)).toBeNull(); // MovZ
    expect(loopKindFor(table, LEFT, CTRL)).toBeNull(); // Move
    expect(loopKindFor(table, RIGHT, SHIFT)).toBeNull(); // Clip
  });

  it('follows the mode rather than hard-coding shift+left/middle', () => {
    // Every stock mode puts `+Box` on shift+left, but `-Box` MOVES:
    // shift+middle in three-button viewing (`modes.ts:91-92`), shift+RIGHT in
    // two-button selecting (`:236-238`) — a two-button mouse has no middle —
    // and alt+shift+left in one-button viewing (`:320`, `:332`).
    const ALT_SHIFT = 5;
    const twoButton = tableForMode('two_button_selecting');
    const oneButton = tableForMode('one_button_viewing');

    expect(loopKindFor(twoButton, RIGHT, SHIFT)).toBe('subtract');
    expect(loopKindFor(table, RIGHT, SHIFT)).toBeNull(); // Clip here
    expect(loopKindFor(twoButton, MIDDLE, SHIFT)).toBeNull(); // unbound here
    expect(loopKindFor(oneButton, LEFT, ALT_SHIFT)).toBe('subtract');
    expect(loopKindFor(table, LEFT, ALT_SHIFT)).toBeNull();
  });
});

describe('button_mode_name -> ButMode table', () => {
  it('inverts mode_name_dict', () => {
    expect(modeFromDisplayName('3-Button Viewing')).toBe('three_button_viewing');
    expect(modeFromDisplayName('3-Button Editing')).toBe('three_button_editing');
    // `cmd.mouse` writes the raw key through when there is no display name.
    expect(modeFromDisplayName('two_button_selecting')).toBe('two_button_selecting');
  });

  it('falls back to three-button viewing for an unknown name', () => {
    // The name arrives over a socket after mount; until it does — or if a
    // plugin invents a mode — the stock table is the safe answer.
    expect(modeFromDisplayName('')).toBe(DEFAULT_MODE);
    expect(modeFromDisplayName('Ludicrous Mode')).toBe(DEFAULT_MODE);
    expect(tableForDisplayName('Ludicrous Mode')).toEqual(tableForMode(DEFAULT_MODE));
  });
});
