/**
 * Movie-panel geometry, palette and mouse grammar.
 *
 * `xToFrame` is a port of `ViewElemXtoFrame` (`packages/engine/layer1/View.cpp:98-105`) and the
 * run collapsing is a port of the `cur_level != last_level` state machine in
 * `ViewElemDraw` (`:176-230`). Both are asserted against hand-computed values
 * from those two functions.
 */

import { describe, expect, it } from 'vitest';
import { SPEC_INTERPOLATED, SPEC_KEY, SPEC_NONE } from '@tenmol/protocol/topics/movie';
import {
  classifyGesture,
  frameToX,
  midBand,
  PALETTE,
  specRuns,
  xToFrame,
  type PanelRect,
} from './timeline';
import { mvprgRoundTrip } from './timelineFixtures';

const RECT: PanelRect = { left: 0, right: 100, top: 0, bottom: 20 };

describe('xToFrame / frameToX', () => {
  it('maps the strip onto [0, frames)', () => {
    expect(xToFrame(RECT, 10, 0)).toBe(0);
    expect(xToFrame(RECT, 10, 9)).toBe(0);
    expect(xToFrame(RECT, 10, 10)).toBe(1);
    expect(xToFrame(RECT, 10, 99)).toBe(9);
  });

  it('the nearest bias is the 0.4999 of ViewElemXtoFrame', () => {
    // At x=5 the exact frame is 0.5; without the bias that truncates to 0,
    // with it, 0.9999 -> 0.  At x=6 it becomes 1.0999 -> 1.
    expect(xToFrame(RECT, 10, 5, false)).toBe(0);
    expect(xToFrame(RECT, 10, 5, true)).toBe(0);
    expect(xToFrame(RECT, 10, 6, true)).toBe(1);
  });

  it('round-trips a frame back to its own cell', () => {
    for (let frame = 0; frame < 10; frame += 1) {
      expect(xToFrame(RECT, 10, frameToX(RECT, 10, frame))).toBe(frame);
    }
  });

  it('is not clamped, exactly like the C', () => {
    expect(xToFrame(RECT, 10, -20)).toBe(-2);
    expect(xToFrame(RECT, 10, 140)).toBe(14);
  });

  it('survives a zero-width strip', () => {
    expect(xToFrame({ left: 0, right: 0, top: 0, bottom: 10 }, 10, 5)).toBe(0);
    expect(xToFrame(RECT, 0, 5)).toBe(0);
  });
});

describe('palette and band', () => {
  it('is ViewElemDraw s four float triples, x255', () => {
    expect(PALETTE.top).toBe('rgb(153,153,255)'); // {0.6,0.6,1.0}
    expect(PALETTE.key).toBe('rgb(102,102,204)'); // {0.4,0.4,0.8}
    expect(PALETTE.bar).toBe('rgb(77,77,153)'); // {0.3,0.3,0.6}
    expect(PALETTE.bot).toBe('rgb(51,51,102)'); // {0.2,0.2,0.4}
  });

  it('splits the row into the same fifths', () => {
    // top = 0-2 = -2, bot = 20+2 = 22 -> mid_top = (3*-2 + 2*22)/5 = 7.6 -> 7
    //                                    mid_bot = (2*-2 + 3*22)/5 = 12.4 -> 12
    expect(midBand(RECT)).toEqual({ midTop: 7, midBottom: 12 });
  });
});

describe('specRuns', () => {
  it('collapses equal levels and drops level 0', () => {
    expect(specRuns([SPEC_KEY, SPEC_INTERPOLATED, SPEC_INTERPOLATED, SPEC_KEY])).toEqual([
      { start: 0, stop: 1, level: SPEC_KEY },
      { start: 1, stop: 3, level: SPEC_INTERPOLATED },
      { start: 3, stop: 4, level: SPEC_KEY },
    ]);
    expect(specRuns([SPEC_NONE, SPEC_NONE])).toEqual([]);
  });

  it('closes the final run', () => {
    expect(specRuns([SPEC_INTERPOLATED, SPEC_INTERPOLATED])).toEqual([
      { start: 0, stop: 2, level: SPEC_INTERPOLATED },
    ]);
  });

  it('handles the real 7-frame movie the bridge test produces', () => {
    // camera row of `mset '1 x3 -5'` + mview store 1/3/5 + reinterpolate,
    // measured live: [2,1,2,1,2,1,1]
    expect(specRuns([2, 1, 2, 1, 2, 1, 1])).toEqual([
      { start: 0, stop: 1, level: 2 },
      { start: 1, stop: 2, level: 1 },
      { start: 2, stop: 3, level: 2 },
      { start: 3, stop: 4, level: 1 },
      { start: 4, stop: 5, level: 2 },
      { start: 5, stop: 7, level: 1 },
    ]);
  });
});

describe('classifyGesture — MovieClick', () => {
  const base = { button: 0 as const, shift: false, ctrl: false, from: 2, to: 5, travel: 40 };

  it('right-drag is mmove, shift+right-drag is mcopy', () => {
    expect(classifyGesture({ ...base, button: 2 })).toEqual({
      kind: 'move',
      target: 6,
      source: 3,
      count: 1,
      object: 'none',
    });
    expect(classifyGesture({ ...base, button: 2, shift: true })).toEqual({
      kind: 'copy',
      target: 6,
      source: 3,
      count: 1,
      object: 'none',
    });
  });

  it('a right-click that barely moved opens the motion menu instead', () => {
    expect(classifyGesture({ ...base, button: 2, travel: 2, to: 2 })).toEqual({
      kind: 'menu',
      frame: 2,
      object: '',
      column: false,
    });
  });

  it('ctrl+left-drag inserts forward and deletes backward', () => {
    expect(classifyGesture({ ...base, ctrl: true })).toEqual({
      kind: 'insert',
      count: 3,
      frame: 3,
      object: 'none',
    });
    expect(classifyGesture({ ...base, ctrl: true, from: 5, to: 2 })).toEqual({
      kind: 'delete',
      count: 3,
      frame: 3,
      object: 'none',
    });
    expect(classifyGesture({ ...base, ctrl: true, from: 4, to: 4 })).toBeNull();
  });

  it('ctrl+middle-drag clears the range, low to high', () => {
    expect(classifyGesture({ ...base, button: 1, ctrl: true, from: 7, to: 3 })).toEqual({
      kind: 'clear',
      first: 4,
      last: 8,
      object: 'none',
    });
  });

  it('a plain left drag is the scrollbar', () => {
    expect(classifyGesture(base)).toEqual({ kind: 'seek', frame: 6 });
  });

  it('a plain middle drag does nothing', () => {
    expect(classifyGesture({ ...base, button: 1 })).toBeNull();
  });
});

describe('mvprg bookkeeping', () => {
  it('fills %d with get_movie_length()+1 and can remove that range', () => {
    expect(mvprgRoundTrip("movie.add_rock(4,60,axis='x',start=%d)", 120)).toEqual({
      command: "movie.add_rock(4,60,axis='x',start=121)",
      remove: { count: -1, frame: 121 },
    });
  });

  it('removes nothing before any program has run', () => {
    expect(mvprgRoundTrip('movie.add_blank(1)', -1).remove).toBeNull();
  });
});
