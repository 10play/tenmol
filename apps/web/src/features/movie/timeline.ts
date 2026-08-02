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
 * The movie-panel mouse grammar (`layer1/Movie.cpp:1488-1699`).
 *
 * Every gesture emits a literal command string through `PParse`; these are the
 * same strings, so the DOM panel and the GL panel are indistinguishable in a
 * log file.
 *
 * THE `object=` ARGUMENT IS THE WHOLE POINT OF THIS FUNCTION and it is the one
 * thing that is easy to get silently wrong, because the three values are not
 * "" / name / nothing but `none` / name / "" — and `mview clear` uses a fourth.
 * `CMovie::release` (`:1607-1615`) builds it as:
 *
 *   `DragColumn` (Ctrl+Shift)   `,object=''`     camera **and** every object
 *   a valid `DragObj`           `,object='<name>'`
 *   otherwise (the camera row)  `,object='none'`  camera **only**
 *
 * and `cMovieDragModeOblate` then overrides the column case to `'same'`
 * (`:1665`). Those are not cosmetic: `ExecutiveMotionViewModify`
 * (`layer3/Executive.cpp:533-560`) reads `''`/`all`/`same` as "camera then all
 * other objects" and `none` as "camera, and stop". Measured on a 6-frame movie
 * with keys on both the camera and object `m2`:
 *
 *   `cmd.mmove(2,3,1,object='none')`  camera [2,2,1,1,1,2]  m2 [2,1,2,1,1,2]
 *   `cmd.mmove(2,3,1,object='')`      camera [2,2,1,1,1,2]  m2 [2,2,1,1,1,2]
 *
 * Passing no `object=` at all — which is what omitting an empty string does —
 * lands on the default `object=''`, i.e. the COLUMN behaviour, for a gesture
 * the user aimed at the camera row alone.
 */
export type PanelGesture =
  | { kind: 'move'; target: number; source: number; count: number; object: string }
  | { kind: 'copy'; target: number; source: number; count: number; object: string }
  | { kind: 'insert'; count: number; frame: number; object: string }
  | { kind: 'delete'; count: number; frame: number; object: string }
  | { kind: 'clear'; first: number; last: number; object: string }
  | { kind: 'seek'; frame: number }
  | { kind: 'menu'; frame: number; object: string; column: boolean };

export interface GestureInput {
  button: 0 | 1 | 2;
  shift: boolean;
  ctrl: boolean;
  /** 0-based frame under the press. */
  from: number;
  /** 0-based frame under the release. */
  to: number;
  /** Pixels travelled horizontally; a right-click that moves less opens the menu. */
  travel: number;
  /**
   * Pixels travelled VERTICALLY. `CMovie::drag:1588` clears `DragMenu` on
   * `|dy| > 5` as well as `|dx| > 3`, so a right-press that slides down out of
   * its row is not a menu either. Optional: omitted means 0.
   */
  travelY?: number;
  /**
   * `CMovie::DragDraw` (`:1580`) — false once the pointer is more than 50 px
   * above or below the panel block, and `CMovie::release` emits NOTHING while
   * it is false (`:1633`, `:1650`, `:1664`, `:1681`). Defaults to true so the
   * hundreds of existing call sites keep their meaning.
   */
  inRange?: boolean;
  /** The row's object name; `''` is the camera row (`cExecAll`). */
  object?: string;
  /** `MovieGetLength()`. Drags that end outside `[0, frames)` are dropped. */
  frames?: number;
}

/**
 * `CMovie::drag`'s `DragDraw` test (`layer1/Movie.cpp:1580`).
 *
 * ```c
 * I->DragDraw = ((y < (rect.top + 50)) && (y > (rect.bottom - 50)));
 * ```
 *
 * The C's y axis points UP, so `rect.top > rect.bottom` and that reads as "no
 * further than 50 px outside the block, either way". Here y points down, so
 * the comparison flips; the 50 does not.
 *
 * It is not decoration: while it is false the ghost boxes are not drawn AND
 * the release emits no command at all. That is how a user abandons a drag
 * they did not mean to start — pull away from the panel and let go.
 */
export const DRAG_ABANDON_PX = 50;

export function dragInRange(
  y: number,
  block: { top: number; bottom: number },
  slack = DRAG_ABANDON_PX,
): boolean {
  return y > block.top - slack && y < block.bottom + slack;
}

/** `CMovie::release`'s `extra`, minus the `,object=` prefix (`:1607-1615`). */
export function objectArgument(object: string, column: boolean, oblate = false): string {
  if (column) return oblate ? 'same' : '';
  return object || 'none';
}

/**
 * `MovieClick` + `CMovie::drag` + `CMovie::release`, as a pure function.
 *
 * The menu rule is the composite one the C actually uses, not "it barely
 * moved": `CMovie::drag` clears `DragMenu` once `|dx| > 3` (`:1589`) and
 * `release` opens the menu only when `DragCurFrame == DragStartFrame` **and**
 * `DragMenu` is still set (`:1621`). A right-drag of 4 px that stays inside one
 * cell therefore does nothing at all — it is neither a menu nor an `mmove` onto
 * itself.
 *
 * `inRange` is the second half of that state machine and the one wave 4 left
 * out: `CMovie::release` wraps the mmove/mcopy, the oblate clear and the
 * ins/del in `if(I->DragDraw && ...)`, so a drag that wandered more than 50 px
 * out of the panel emits nothing when it is released. THE MENU IS NOT WRAPPED
 * — `:1621` tests only `DragCurFrame == DragStartFrame && DragMenu` — so a
 * right-press that goes 200 px away and comes back to its own cell still opens
 * the motion menu. That asymmetry is deliberate in the C and reproduced here.
 */
export function classifyGesture(input: GestureInput): PanelGesture | null {
  const { button, shift, ctrl, from, to, travel } = input;
  const object = input.object ?? '';
  const frames = input.frames ?? Number.POSITIVE_INFINITY;
  const count = 1;
  const column = ctrl && shift;
  const inRange = input.inRange ?? true;
  // `CMovie::drag:1588` — the menu dies on |dx|>3 OR |dy|>5.
  const menuAlive = travel <= 3 && (input.travelY ?? 0) <= 5;

  if (button === 2) {
    // Pressing past the last cell opens the menu immediately (`:1508-1514`).
    if (from >= frames) return { kind: 'menu', frame: from, object, column };
    if (to === from) {
      return menuAlive ? { kind: 'menu', frame: from, object, column } : null;
    }
    if (to < 0 || to >= frames || !inRange) return null;
    const arg = objectArgument(object, column);
    // `mod == cOrthoSHIFT` is an EQUALITY test (`:1503`), so Ctrl+Shift+Right
    // is a column *move*, never a copy.
    return shift && !ctrl
      ? { kind: 'copy', target: to + 1, source: from + 1, count, object: arg }
      : { kind: 'move', target: to + 1, source: from + 1, count, object: arg };
  }

  if (button === 0) {
    // `case cOrthoSHIFT: break;` — "TEMPORAL SELECTIONS -- TO COME" (`:1521`).
    if (shift && !ctrl) return null;
    if (ctrl) {
      if (!inRange) return null;
      const arg = objectArgument(object, column);
      const cur = Math.max(0, to); // `if(I->DragCurFrame<0) DragCurFrame = 0`
      const delta = cur - from;
      // The C emits `cmd.mdelete(0, from+1)` here; we suppress it. Measured:
      // `cmd.mdelete(0,3)` returns without changing count_frames, so the only
      // thing it does is put a no-op line in the user's log.
      if (delta === 0) return null;
      return delta > 0
        ? { kind: 'insert', count: delta, frame: Math.max(0, from + 1), object: arg }
        : { kind: 'delete', count: -delta, frame: cur + 1, object: arg };
    }
    // Plain left drag is the scrollbar: SceneSetFrame(G,7,v).
    return { kind: 'seek', frame: to + 1 };
  }

  if (button === 1 && ctrl) {
    if (!inRange) return null;
    // `cMovieDragModeOblate`, clamped into the strip (`:1657-1663`).
    const last = frames === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : frames - 1;
    const lo = Math.min(Math.max(0, Math.min(from, to)), last);
    const hi = Math.min(Math.max(0, Math.max(from, to)), last);
    return { kind: 'clear', first: lo + 1, last: hi + 1, object: objectArgument(object, column, true) };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * drag ghosts — `ViewElemDrawBox` (`View.cpp:107-155`)
 * ------------------------------------------------------------------ */

/** One box of `CMovie::draw`'s `DragDraw` overlay (`Movie.cpp:1793-1838`). */
export interface DragBox {
  first: number;
  last: number;
  /** `color4` as an rgba() string. */
  color: string;
  /** `fill` — false is a line loop, true is a blended polygon. */
  fill: boolean;
}

/**
 * `ViewElemDrawBox`'s pixel span for 0-based frames `[first, last)`.
 *
 * The `(stop - start) < 1 -> stop = start + 1` guard is the reason a key frame
 * is still visible in a 500-frame movie 300 px wide: without it the box has
 * zero width and disappears.
 */
export function boxSpan(
  rect: PanelRect,
  frames: number,
  first: number,
  last: number,
): { start: number; stop: number; top: number; bottom: number } {
  const start = frameToX(rect, frames, first);
  let stop = frameToX(rect, frames, last);
  if (stop - start < 1) stop = start + 1;
  // `top = rect->top - 1`, `bot = rect->bottom + 1`, in the C's y-up frame;
  // the canvas is y-down, so the two swap and the ±1 goes the other way.
  return { start, stop, top: rect.top + 1, bottom: rect.bottom - 1 };
}

/**
 * The exact boxes `CMovie::draw` paints while a drag is live.
 *
 * `Movie.cpp:1797-1838` — three shapes for three drag modes:
 *
 *   move/copy   white unfilled box on the SOURCE cell, grey filled box on the
 *               target cell; the target is drawn only while it is in range
 *   oblate      white unfilled *and* grey filled over the whole span
 *   ins/del     one box: white when it has not moved, GREEN when the drag is
 *               forward (an insert), RED when it is backward (a delete)
 *
 * The colours are the literal float4s: `{1,1,1,0.5}`, `{0.75,0.75,0.75,0.5}`,
 * `{0.5,1,0.5,0.5}`, `{1,0.5,0.5,0.5}`.
 */
export const GHOST = {
  white: 'rgba(255,255,255,0.5)',
  grey: 'rgba(191,191,191,0.5)',
  green: 'rgba(128,255,128,0.5)',
  red: 'rgba(255,128,128,0.5)',
} as const;

export function dragBoxes(input: {
  button: 0 | 1 | 2;
  ctrl: boolean;
  /** 0-based frame of the press. */
  from: number;
  /** 0-based frame currently under the pointer. */
  to: number;
  frames: number;
}): DragBox[] {
  const { button, ctrl, from, to, frames } = input;
  const clamp = (v: number) => Math.min(Math.max(0, v), Math.max(0, frames - 1));

  if (button === 2) {
    const boxes: DragBox[] = [];
    if (from < frames) boxes.push({ first: from, last: from + 1, color: GHOST.white, fill: false });
    if (to >= 0 && to < frames) {
      boxes.push({ first: to, last: to + 1, color: GHOST.grey, fill: true });
    }
    return boxes;
  }
  if (button === 1 && ctrl) {
    const lo = clamp(Math.min(from, to));
    const hi = clamp(Math.max(from, to));
    return [
      { first: lo, last: hi + 1, color: GHOST.white, fill: false },
      { first: lo, last: hi + 1, color: GHOST.grey, fill: true },
    ];
  }
  if (button === 0 && ctrl) {
    // Note the asymmetry the C has: the "unchanged" box is `first == last`,
    // which `boxSpan`'s minimum width turns into a one-pixel caret.
    if (to === from) return [{ first: from, last: from, color: GHOST.white, fill: true }];
    return to > from
      ? [{ first: from, last: to, color: GHOST.green, fill: true }]
      : [{ first: to, last: from, color: GHOST.red, fill: true }];
  }
  return [];
}

/** Paint `dragBoxes` into a row rect. */
export function drawDragBoxes(
  ctx: CanvasRenderingContext2D,
  rect: PanelRect,
  frames: number,
  boxes: readonly DragBox[],
): void {
  for (const box of boxes) {
    const { start, stop, top, bottom } = boxSpan(rect, frames, box.first, box.last);
    if (box.fill) {
      ctx.fillStyle = box.color;
      ctx.fillRect(start, top, stop - start, bottom - top);
    } else {
      ctx.strokeStyle = box.color;
      ctx.lineWidth = 1;
      ctx.strokeRect(start + 0.5, top + 0.5, stop - start - 1, bottom - top - 1);
    }
  }
}

/**
 * The wheel half of `MovieClick` (`:1556-1568`).
 *
 * `P_GLUT_BUTTON_SCROLL_FORWARD` falls through with `scrolldir = -1`, so
 * Ctrl+Shift sets `movie_panel_row_height - scrolldir` — wheel *forward* makes
 * the rows taller — and everything else is `SceneSetFrame(G, 5, scrolldir)`,
 * one frame per notch. `deltaY > 0` is the DOM's scroll-backward.
 *
 * The one addition is the floor: the C happily walks the row height down
 * through 0 into negatives, at which point `MovieGetPanelHeight` returns a
 * negative height. `movie_panel_row_height` is a global setting shared with the
 * GL panel, so it is clamped here rather than repaired later.
 */
export type WheelGesture =
  | { kind: 'frame'; delta: 1 | -1 }
  | { kind: 'rowHeight'; value: number };

export function classifyWheel(input: {
  deltaY: number;
  ctrl: boolean;
  shift: boolean;
  rowHeight: number;
}): WheelGesture {
  const scrolldir: 1 | -1 = input.deltaY > 0 ? 1 : -1;
  if (input.ctrl && input.shift) {
    return { kind: 'rowHeight', value: Math.max(1, input.rowHeight - scrolldir) };
  }
  return { kind: 'frame', delta: scrolldir };
}
