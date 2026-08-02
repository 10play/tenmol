/**
 * Movie-panel CELL RENDERING (row 318) — the part of `ViewElemDraw` that the
 * palette test does not reach.
 *
 * `timeline.test.ts` pins the four colours and `midBand`'s fifths, and
 * `wfMovieGrammar.test.ts` pins `boxSpan`. Nothing asserted what `drawRow`
 * actually PAINTS, so the whole visual language of the panel —
 *
 *   specification_level 2 (key frame)    a FULL-HEIGHT block in `key_color`
 *   specification_level 1 (interpolated) a THIN CENTRE BAR in `bar_color`,
 *                                        `key_color` along its top edge and
 *                                        `bot_color` along its bottom edge
 *   specification_level 0                nothing at all
 *
 * — could be replaced by "fill the whole row for both levels" and every test in
 * the tree stayed green (measured: that exact mutation survived the full web
 * suite). That asymmetry is what makes an interpolated stretch read as
 * "between two keys" rather than as a key of its own, so it is asserted here
 * against `packages/engine/layer1/View.cpp:176-230` directly.
 *
 * The context is a recorder rather than a real canvas: `drawRow` only ever
 * calls `fillRect` and assigns `fillStyle`, and the ORDER of those calls is
 * part of the claim (the bar is painted first and the two edge lines over it).
 */

import { describe, expect, it } from 'vitest';
import { SPEC_INTERPOLATED, SPEC_KEY, SPEC_NONE } from '@tenmol/protocol/topics/movie';
import { drawRow, midBand, PALETTE, type PanelRect } from './timeline';

const RECT: PanelRect = { left: 0, right: 100, top: 0, bottom: 20 };

interface Fill {
  style: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function record(): { ctx: CanvasRenderingContext2D; fills: Fill[] } {
  const fills: Fill[] = [];
  const ctx = {
    fillStyle: '',
    fillRect(x: number, y: number, w: number, h: number) {
      fills.push({ style: String(this.fillStyle), x, y, w, h });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills };
}

describe('drawRow — ViewElemDraw cell rendering (row 318)', () => {
  it('paints a key frame as one full-height block in key_color', () => {
    const { ctx, fills } = record();
    drawRow(ctx, RECT, 4, [SPEC_KEY, SPEC_NONE, SPEC_NONE, SPEC_NONE]);
    expect(fills).toEqual([
      { style: PALETTE.key, x: 0, y: RECT.top, w: 25, h: RECT.bottom - RECT.top },
    ]);
  });

  it('paints an interpolated run as a thin centre bar, not a block', () => {
    const { ctx, fills } = record();
    const { midTop, midBottom } = midBand(RECT); // 7 .. 12 for this rect
    drawRow(ctx, RECT, 4, [SPEC_INTERPOLATED, SPEC_INTERPOLATED, SPEC_NONE, SPEC_NONE]);

    expect(fills).toEqual([
      // the bar itself, in bar_color, confined to the two inner fifths
      { style: PALETTE.bar, x: 0, y: midTop, w: 50, h: midBottom - midTop },
      // key_color along the top edge, bot_color along the bottom edge
      { style: PALETTE.key, x: 0, y: midTop, w: 50, h: 1 },
      { style: PALETTE.bot, x: 0, y: midBottom - 1, w: 50, h: 1 },
    ]);

    // the claim that makes the two levels distinguishable at a glance
    const barHeight = fills[0]!.h;
    expect(barHeight).toBeLessThan(RECT.bottom - RECT.top);
    expect(fills.every((f) => f.y >= midTop && f.y + f.h <= midBottom)).toBe(true);
  });

  it('paints nothing for level 0, however many frames carry it', () => {
    const { ctx, fills } = record();
    drawRow(ctx, RECT, 6, [SPEC_NONE, SPEC_NONE, SPEC_NONE, SPEC_NONE, SPEC_NONE, SPEC_NONE]);
    expect(fills).toEqual([]);
  });

  it('draws one rectangle per RUN, not one per frame', () => {
    // The 7-frame movie `mset '1 x3 -5'` + mview store 1/3/5 + reinterpolate
    // measures as [2,1,2,1,2,1,1]: three key frames and three interpolated
    // runs, i.e. 3 blocks + 3x3 bar/edge fills = 12 fillRects, never 7*k.
    const { ctx, fills } = record();
    drawRow(ctx, RECT, 7, [SPEC_KEY, SPEC_INTERPOLATED, SPEC_KEY, SPEC_INTERPOLATED, SPEC_KEY, SPEC_INTERPOLATED, SPEC_INTERPOLATED]);
    expect(fills.filter((f) => f.style === PALETTE.key && f.h > 1)).toHaveLength(3);
    expect(fills.filter((f) => f.style === PALETTE.bar)).toHaveLength(3);
    expect(fills).toHaveLength(12);
    // the last interpolated run spans two frames and is therefore twice as wide
    const bars = fills.filter((f) => f.style === PALETTE.bar);
    expect(bars[2]!.w).toBeGreaterThan(bars[0]!.w);
  });

  it('never lets a run collapse to zero width, however long the movie', () => {
    const { ctx, fills } = record();
    const levels = Array.from({ length: 500 }, (_, i) => (i === 250 ? SPEC_KEY : SPEC_NONE));
    drawRow(ctx, RECT, 500, levels);
    expect(fills).toHaveLength(1);
    expect(fills[0]!.w).toBeGreaterThanOrEqual(1);
  });
});
