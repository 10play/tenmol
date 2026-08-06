/**
 * The ramp canvas painter — one pass, in `paintEvent`'s order
 * (`packages/engine/modules/pmg_qt/volume.py:250-266`):
 *
 *   grid -> axes (+ the three value boxes) -> [clip] histogram [unclip]
 *        -> colour dots -> zoom band
 *
 * Qt draws with a `QPainter`; here it is a 2D canvas context. The geometry is
 * identical because it comes from `ramp.ts`, which is the verbatim port. The
 * only things this file invents are the font metrics — Qt asks
 * `QFontMetrics` for `averageCharWidth()` and `height()`, and the canvas
 * equivalent is `measureText`.
 *
 * `paint()` RETURNS the three value-box rectangles, because upstream's
 * `mousePressEvent` and `wheelEvent` hit-test against `self.text_boxes`, which
 * only exists as a side effect of having painted (`volume.py:238-249`). Keeping
 * that coupling explicit is better than duplicating the layout maths in two
 * places and letting them drift.
 */

import {
  DOT_RADIUS,
  alphaToY,
  dataToX,
  plotRect,
  rectBottom,
  rectRight,
  type PlotRect,
  type RampView,
} from './ramp';
import type { VolumeRampPoint } from '@tenmol/protocol/topics/dialogs';

/** A hit-testable rectangle, in widget pixels (Qt `QRect` semantics). */
export interface BoxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Which of the three editable value boxes a rect belongs to. */
export type ValueBoxKey = 'vmin' | 'vmax' | 'amax';
/** The value-box rectangles `paint()` returns, keyed for hit-testing. */
export type ValueBoxes = Partial<Record<ValueBoxKey, BoxRect>>;

/** Inclusive point-in-rect test, matching Qt's `QRect.contains()`. */
export function boxContains(rect: BoxRect | undefined, x: number, y: number): boolean {
  if (!rect) return false;
  // Qt's QRect.contains() is inclusive of right()/bottom() == x+w-1 / y+h-1.
  return (
    x >= rect.x && x <= rect.x + rect.width - 1 && y >= rect.y && y <= rect.y + rect.height - 1
  );
}

/** Everything one `paint()` pass needs to draw the ramp canvas. */
export interface PaintOptions {
  view: RampView;
  points: readonly VolumeRampPoint[];
  /** From `normalizeHistogram`. */
  path: readonly (readonly [number, number])[];
  originalVmin: number;
  originalVmax: number;
  hoverPoint: number;
  /** Widget X of the ctrl+right-drag anchor and cursor, or null. */
  zoomFrom: number | null;
  zoomTo: number | null;
  /** Axis/grid colour. Qt uses darkGray when the dock is floating. */
  lineColor: string;
  /** Canvas font, e.g. `11px ui-monospace`. */
  font: string;
  /** Fill for the three value boxes. Qt: white when floating. */
  boxFill: string;
  textColor: string;
}

/** Draw everything. Returns the value-box hit rects for the pointer handlers. */
export function paint(ctx: CanvasRenderingContext2D, options: PaintOptions): ValueBoxes {
  const { view } = options;
  const rect = plotRect(view);

  ctx.clearRect(0, 0, view.width, view.height);
  ctx.font = options.font;
  ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 1;

  paintGrid(ctx, options, rect);
  const boxes = paintAxes(ctx, options, rect);

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.left, rect.top, rect.width, rect.height);
  ctx.clip();
  paintHistogram(ctx, options, rect);
  ctx.restore();

  paintColorDots(ctx, options, rect);
  paintZoomArea(ctx, options, rect);
  return boxes;
}

/** `paintGrid` (`volume.py:97-112`): axis lines plus 9 dashed alpha gridlines. */
function paintGrid(ctx: CanvasRenderingContext2D, o: PaintOptions, rect: PlotRect): void {
  const x0 = rect.left;
  const x1 = rect.left + rect.width;
  const y0 = rect.top;
  const y1 = rect.top + rect.height;

  ctx.strokeStyle = o.lineColor;
  ctx.setLineDash([]);
  line(ctx, x0, y1, x1, y1);
  line(ctx, x0, y0, x0, y1);

  ctx.setLineDash([3, 3]);
  const numLines = 10;
  for (let l = 1; l < numLines; l++) {
    const y = Math.round(y0 + rect.height * (1.0 - alphaToY(o.view, l / numLines)));
    line(ctx, x0, y, x1, y);
  }
  ctx.setLineDash([]);
}

/**
 * `paintAxes` (`volume.py:198-249`).
 *
 * Integer x ticks with collision avoidance (`x - lastx > w + 2*fw`), 0.1..0.9 y
 * ticks with `lasty - y > fh && y > 2*fh`, then the three editable value boxes.
 */
function paintAxes(ctx: CanvasRenderingContext2D, o: PaintOptions, rect: PlotRect): ValueBoxes {
  const { view } = o;
  const low = Math.ceil(view.vmin);
  const hi = Math.floor(view.vmax) + 1;
  const fw = averageCharWidth(ctx);
  const fh = fontHeight(ctx) - 2;

  ctx.strokeStyle = o.lineColor;
  ctx.fillStyle = o.textColor;
  ctx.setLineDash([]);

  const x0 = rect.left;
  const y0 = rectBottom(rect);
  const y1 = y0 + 4;
  let lastx = x0;

  // horizontal axis
  for (let tick = low; tick < hi; tick++) {
    const s = String(tick);
    const w = fw * s.length;
    let x = x0 + w / 2 + (rect.width * (tick - view.vmin)) / (view.vmax - view.vmin);
    if (x - lastx > w + 2 * fw) {
      x = Math.round(x);
      line(ctx, x, y0, x, y1);
      ctx.fillText(s, Math.round(x - w / 2), y1 + fh - 2);
      lastx = x;
    }
  }

  // vertical axis
  const vx = rect.left;
  let lasty = y0;
  for (let tick = 1; tick < 10; tick++) {
    const t = tick / 10.0;
    let y = y0 - alphaToY(view, t) * rect.height;
    if (lasty - y > fh && y > 2 * fh) {
      y = Math.round(y);
      line(ctx, vx - 5, y, vx, y);
      ctx.fillText(String(t), vx - 5 - 3 * fw, Math.round(y - 2 + fh / 2));
      lasty = y;
    }
  }

  const boxes: ValueBoxes = {};
  boxes.vmin = paintValueBox(ctx, o, rect.left, y1 + fh, false, view.vmin, 3);
  boxes.vmax = paintValueBox(ctx, o, rectRight(rect), y1 + fh, true, view.vmax, 3);
  boxes.amax = paintValueBox(ctx, o, x0 - 4 * fw, 2 + fh, false, view.amax, 2);
  return boxes;
}

/** `paintValueBox` (`volume.py:178-196`). */
function paintValueBox(
  ctx: CanvasRenderingContext2D,
  o: PaintOptions,
  x: number,
  y: number,
  rightJust: boolean,
  value: number,
  decimals: number,
): BoxRect {
  const s = value.toFixed(decimals);
  const sw = Math.ceil(ctx.measureText(s).width);
  const sh = fontHeight(ctx);
  const rect: BoxRect = rightJust
    ? { x: x - sw - 4, y: y - sh, width: sw + 4, height: sh + 2 }
    : { x, y: y - sh, width: sw + 4, height: sh + 2 };

  ctx.fillStyle = o.boxFill;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.strokeStyle = o.lineColor;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width, rect.height);
  ctx.fillStyle = o.textColor;
  ctx.fillText(s, rect.x + 2, y - 2);
  return rect;
}

/**
 * `paintHistogram` (`volume.py:147-176`).
 *
 * One sample per pixel column, lerped between the two nearest bars and remapped
 * through the current zoom window; `h = rect.height() - 2` and the `+1` at the
 * end are upstream's, not a rounding accident.
 */
function paintHistogram(ctx: CanvasRenderingContext2D, o: PaintOptions, rect: PlotRect): void {
  if (o.path.length === 0) return;
  const vrange = o.originalVmax - o.originalVmin;
  if (vrange === 0.0) return;

  const normMin = (o.view.vmin - o.originalVmin) / vrange;
  const normMax = (o.view.vmax - o.originalVmin) / vrange;
  const h = rect.height - 2;
  const dnorm = normMax - normMin;
  const iwidth = 1.0 / rect.width;

  ctx.beginPath();
  let started = false;
  for (let i = 0; i < rect.width; i++) {
    const pos = (i * iwidth * dnorm + normMin) * o.path.length;
    const ipos = Math.trunc(pos);
    if (pos < 0 || ipos >= o.path.length - 1) continue;
    const y0 = o.path[ipos]![1];
    const y1 = o.path[ipos + 1]![1];
    const yv = y0 + (y1 - y0) * (pos - Math.trunc(pos));
    const x = rect.left + i;
    const y = h - alphaToY(o.view, yv) * h + 1;
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  if (!started) return;
  ctx.strokeStyle = 'red';
  ctx.stroke();
}

/**
 * `paintColorDots` (`volume.py:114-145`): a grey polyline through the points,
 * then a filled circle per point in its own colour, then the hovered point
 * again at `DOT_RADIUS + 2`.
 */
function paintColorDots(ctx: CanvasRenderingContext2D, o: PaintOptions, rect: PlotRect): void {
  const scaled: { x: number; y: number; color: string }[] = [];
  for (const p of o.points) {
    const x = Math.round(rect.left + rect.width * dataToX(o.view, p.value));
    const y = Math.round(rect.top + rect.height * (1.0 - alphaToY(o.view, p.alpha)));
    scaled.push({ x, y, color: rgbCss(p.r, p.g, p.b) });
  }

  ctx.strokeStyle = 'gray';
  ctx.setLineDash([]);
  for (let i = 1; i < scaled.length; i++) {
    line(ctx, scaled[i - 1]!.x, scaled[i - 1]!.y, scaled[i]!.x, scaled[i]!.y);
  }

  ctx.strokeStyle = 'gray';
  for (const dot of scaled) {
    circle(ctx, dot.x, dot.y, DOT_RADIUS, dot.color);
  }

  if (o.hoverPoint >= 0 && o.hoverPoint < scaled.length) {
    const dot = scaled[o.hoverPoint]!;
    circle(ctx, dot.x, dot.y, DOT_RADIUS + 2, dot.color);
  }
}

/** `paintZoomArea` (`volume.py:251-255`): the translucent ctrl+right-drag band. */
function paintZoomArea(ctx: CanvasRenderingContext2D, o: PaintOptions, rect: PlotRect): void {
  if (o.zoomFrom === null || o.zoomTo === null) return;
  const left = Math.min(o.zoomFrom, o.zoomTo);
  const width = Math.abs(o.zoomTo - o.zoomFrom);
  ctx.fillStyle = 'rgba(0, 64, 128, 0.502)'; // QColor(0, 64, 128, 128)
  ctx.fillRect(left, rect.top, width, rect.height);
}

/* ---------------------------------------------------------------- helpers */

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath();
  ctx.moveTo(x0 + 0.5, y0 + 0.5);
  ctx.lineTo(x1 + 0.5, y1 + 0.5);
  ctx.stroke();
}

function circle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  fill: string,
): void {
  // Qt's drawEllipse(x-r, y-r, 2r, 2r) has its centre half a pixel past (x, y).
  ctx.beginPath();
  ctx.arc(x + 0.5, y + 0.5, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.stroke();
}

/** Format a 0..1 RGB triple as a clamped `rgb(...)` CSS string. */
export function rgbCss(r: number, g: number, b: number): string {
  const byte = (v: number) => Math.round(Math.min(Math.max(v, 0), 1) * 255);
  return `rgb(${byte(r)}, ${byte(g)}, ${byte(b)})`;
}

/**
 * `QFontMetrics.averageCharWidth()`. Qt returns the font's own average; the
 * canvas has no such query, so we measure `x`, which is what every 2D-canvas
 * port of a Qt metric does.
 */
function averageCharWidth(ctx: CanvasRenderingContext2D): number {
  return ctx.measureText('x').width;
}

/** `QFontMetrics.height()` — ascent + descent + leading. */
function fontHeight(ctx: CanvasRenderingContext2D): number {
  const m = ctx.measureText('Mg');
  const ascent = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent ?? 8;
  const descent = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent ?? 3;
  return Math.ceil(ascent + descent);
}
