/**
 * Movie-panel geometry and palette, ported from `layer1/View.cpp`.
 *
 * The C panel is drawn with four colours and one piece of arithmetic, and both
 * are reproduced exactly so a cell lands on the same pixel and hit-tests back
 * to the same frame:
 *
 *   `ViewElemDraw`      (`:158-230`)  palette + the mid_top/mid_bot fifths
 *   `ViewElemXtoFrame`  (`:98-105`)   x -> frame, with the 0.4999 "nearest" bias
 *   `ViewElemDrawBox`   (`:107-135`)  first/last -> a pixel span
 *
 * specification_level 1 (interpolated) draws a THIN CENTRE BAR in `bar_color`
 * with a `key_color` line along its top edge and a `bot_color` line along its
 * bottom edge; level 2 (key frame) draws a FULL-HEIGHT block in `key_color`.
 * Level 0 draws nothing. That asymmetry is the whole visual language of the
 * panel — an interpolated stretch has to read as "between two keys".
 */

import { SPEC_INTERPOLATED, SPEC_KEY, type SpecLevel } from '@tenmol/protocol/topics/movie';

/** `float top_color[3] = {0.6,0.6,1.0}` and friends (`View.cpp:170-173`). */
export const PALETTE = {
  top: 'rgb(153,153,255)',
  key: 'rgb(102,102,204)',
  bar: 'rgb(77,77,153)',
  bot: 'rgb(51,51,102)',
} as const;

export interface PanelRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * `ViewElemXtoFrame` — 0-based frame under `x`.
 *
 * `nearest` adds 0.4999 so a drag snaps to the closest boundary instead of the
 * one to its left. Not clamped, exactly like the C: the caller clamps, because
 * `MovieClick` uses the un-clamped value to detect a drag off the end.
 */
export function xToFrame(rect: PanelRect, frames: number, x: number, nearest = false): number {
  const width = rect.right - rect.left;
  if (width <= 0 || frames <= 0) return 0;
  const extra = nearest ? 0.4999 : 0;
  return Math.trunc(extra + (frames * (x - rect.left)) / width);
}

/** Inverse: the pixel span of 0-based frames `[first, last)`. */
export function frameToX(rect: PanelRect, frames: number, frame: number): number {
  const width = rect.right - rect.left;
  if (frames <= 0) return rect.left;
  return Math.trunc(rect.left + (width * frame) / frames);
}

/** The two inner fifths `ViewElemDraw` uses for the interpolated bar. */
export function midBand(rect: PanelRect): { midTop: number; midBottom: number } {
  const top = rect.top - 2;
  const bottom = rect.bottom + 2;
  return {
    midTop: Math.trunc((0.499 + 3 * top + 2 * bottom) / 5),
    midBottom: Math.trunc((0.499 + 2 * top + 3 * bottom) / 5),
  };
}

/** A run of equal spec level, in 0-based half-open frame indices. */
export interface SpecRun {
  start: number;
  stop: number;
  level: SpecLevel;
}

/**
 * Collapse a per-frame level array into runs — the same `cur_level !=
 * last_level` state machine the C draw loop runs, which is why a 500-frame
 * movie is a handful of rectangles rather than 500.
 */
export function specRuns(levels: readonly SpecLevel[]): SpecRun[] {
  const runs: SpecRun[] = [];
  let start = 0;
  for (let i = 1; i <= levels.length; i += 1) {
    const previous = levels[i - 1] ?? 0;
    const current = i < levels.length ? (levels[i] ?? 0) : -1;
    if (current !== previous) {
      if (previous !== 0) runs.push({ start, stop: i, level: previous });
      start = i;
    }
  }
  return runs;
}

/** Draw one row of the panel into a 2D context. */
export function drawRow(
  ctx: CanvasRenderingContext2D,
  rect: PanelRect,
  frames: number,
  levels: readonly SpecLevel[],
): void {
  const { midTop, midBottom } = midBand(rect);
  for (const run of specRuns(levels)) {
    const start = frameToX(rect, frames, run.start);
    const stop = frameToX(rect, frames, run.stop);
    const width = Math.max(1, stop - start);
    if (run.level === SPEC_KEY) {
      ctx.fillStyle = PALETTE.key;
      ctx.fillRect(start, rect.top, width, rect.bottom - rect.top);
    } else if (run.level === SPEC_INTERPOLATED) {
      ctx.fillStyle = PALETTE.bar;
      ctx.fillRect(start, midTop, width, Math.max(1, midBottom - midTop));
      ctx.fillStyle = PALETTE.key;
      ctx.fillRect(start, midTop, width, 1);
      ctx.fillStyle = PALETTE.bot;
      ctx.fillRect(start, Math.max(midTop, midBottom - 1), width, 1);
    }
  }
}

/**
 * The movie-panel mouse grammar (`layer1/Movie.cpp:1488-1690`).
 *
 * Every gesture emits a literal command string through `PParse`; these are the
 * same strings, so the DOM panel and the GL panel are indistinguishable in a
 * log file. `DragColumn` (Ctrl+Shift) means "all rows", which is why it clears
 * `object`.
 */
export type PanelGesture =
  | { kind: 'move'; target: number; source: number; count: number }
  | { kind: 'copy'; target: number; source: number; count: number }
  | { kind: 'insert'; count: number; frame: number }
  | { kind: 'delete'; count: number; frame: number }
  | { kind: 'clear'; first: number; last: number }
  | { kind: 'seek'; frame: number }
  | { kind: 'menu'; frame: number };

export interface GestureInput {
  button: 0 | 1 | 2;
  shift: boolean;
  ctrl: boolean;
  /** 0-based frame under the press. */
  from: number;
  /** 0-based frame under the release. */
  to: number;
  /** Pixels travelled; a right-click that moves less opens the menu instead. */
  travel: number;
}

/** `MovieClick`'s dispatch table, as a pure function. */
export function classifyGesture(input: GestureInput): PanelGesture | null {
  const { button, shift, ctrl, from, to, travel } = input;
  const count = 1;
  if (button === 2) {
    // A right-click that barely moved is a context menu (`:1560`, 3px/5px).
    if (travel < 5) return { kind: 'menu', frame: from };
    return shift
      ? { kind: 'copy', target: to + 1, source: from + 1, count }
      : { kind: 'move', target: to + 1, source: from + 1, count };
  }
  if (button === 0) {
    if (ctrl) {
      const delta = to - from;
      if (delta === 0) return null;
      return delta > 0
        ? { kind: 'insert', count: delta, frame: from + 1 }
        : { kind: 'delete', count: -delta, frame: to + 1 };
    }
    // Plain left drag is the scrollbar: SceneSetFrame(G,7,v).
    return { kind: 'seek', frame: to + 1 };
  }
  if (button === 1 && ctrl) {
    return { kind: 'clear', first: Math.min(from, to) + 1, last: Math.max(from, to) + 1 };
  }
  return null;
}
