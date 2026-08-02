/**
 * The volume colour-ramp editor's arithmetic, ported VERBATIM from
 * `packages/engine/modules/pmg_qt/volume.py`.
 *
 * Every function here has a named upstream counterpart and the same result for
 * the same input. That is not pedantry: the numbers this module produces are
 * pushed straight into `cmd.volume_color`, so a transform that is "close
 * enough" renders a different volume than Qt PyMOL does.
 *
 * Nothing in this file touches React, the DOM or the bridge — it is unit-tested
 * against values captured from the running engine (`ramp.test.ts`).
 *
 * Coordinate model (`volume.py:87-88`, `:250-256`)
 * ------------------------------------------------
 *   widget            W x H CSS pixels, origin top-left
 *   plot rect         left = LEFT_MARGIN(35), top = 0,
 *                     width = W - 35, height = H - BOTTOM_MARGIN(20)
 *   x                 pixel -> 0..1 (`convertX`) -> data (`xToData`)
 *   y                 pixel -> 0..1 (`convertY`) -> alpha (`yToAlpha`),
 *                     through a base-10 log curve scaled by `amax`
 */

import type {
  FlatVolumeRamp,
  VolumeHistogram,
  VolumeRampPoint,
} from '@tenmol/protocol/topics/dialogs';

/** `volume.py:14` */
export const DOT_RADIUS = 5;
/** `volume.py:15` */
export const ALPHA_LOG_BASE = 10.0;
/** `volume.py:87` */
export const LEFT_MARGIN = 35;
/** `volume.py:88` */
export const BOTTOM_MARGIN = 20;
/** `volume.py:26` */
export const EPS = 1e-6;
/** `volume.py:28` */
export const DEFAULT_TEXT_DIALOG_WIDTH = 500;

/**
 * The six-colour cycle new points are taken from (`volume.py:17-24`), in order.
 * `itertools.cycle` in Qt; an index in state here, so it survives a re-render.
 */
export const DEFAULT_COLORS: readonly (readonly [number, number, number])[] = [
  [1, 1, 0],
  [1, 0, 0],
  [0, 0, 1],
  [0, 1, 0],
  [0, 1, 1],
  [1, 0, 1],
];

/** `volume.py:30-66`, verbatim. The L/M/R legend is kept: the web bindings are the same buttons. */
export const VOLUME_HELP = `VOLUME PANEL HELP

--------------------------------------------------
Canvas Mouse Actions (no Point under Cursor)

  L-Click            Add point
  CTRL+L-Click       Add 3 points (isosurface)

  CTRL+R-Drag        Zoom in

--------------------------------------------------
Mouse Actions with Point under Cursor

  L-Click            Edit point color
  R-Click            Edit point value
  SHIFT+R-Click      Edit point opacity
  CTRL+L-Click       Edit color of 3 points

  M-Click            Remove Point
  SHIFT+L-Click      Remove Point
  CTRL+M-Click       Remove 3 points
  CTRL+SHIFT+L-Click Remove 3 points

  L-Drag             Move point
  CTRL+L-Drag        Move 3 points (horizontal only)
  R-Drag             Move point along one axis only

--------------------------------------------------
L = Left mouse button
M = Middle mouse button
R = Right mouse button

--------------------------------------------------
See also the "volume_color" command for getting and
setting volume colors on the command line.
`;

/** Everything the transforms need. Mirrors the widget's own instance fields. */
export interface RampView {
  /** Widget width in CSS pixels. */
  width: number;
  /** Widget height in CSS pixels. */
  height: number;
  vmin: number;
  vmax: number;
  amax: number;
}

/** `paint_rect` — `volume.py:251-252`. Qt semantics: right/bottom are inclusive. */
export interface PlotRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function plotRect(view: RampView): PlotRect {
  return {
    left: LEFT_MARGIN,
    top: 0,
    width: view.width - LEFT_MARGIN,
    height: view.height - BOTTOM_MARGIN,
  };
}

export const rectRight = (r: PlotRect): number => r.left + r.width - 1;
export const rectBottom = (r: PlotRect): number => r.top + r.height - 1;

/* ------------------------------------------------------------------ *
 * The six transforms — volume.py:443-483
 * ------------------------------------------------------------------ */

const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1);

/** `convertX` (`volume.py:435-440`): widget X -> 0..1, clamped. */
export function convertX(view: RampView, xPos: number): number {
  return clamp01((xPos - LEFT_MARGIN) / (view.width - LEFT_MARGIN));
}

/** `convertY` (`volume.py:442-447`): widget Y -> 0..1, clamped, Y flipped. */
export function convertY(view: RampView, yPos: number): number {
  return clamp01(1.0 - yPos / (view.height - BOTTOM_MARGIN));
}

/** `xToData` (`volume.py:449-453`). */
export function xToData(view: RampView, x: number): number {
  return view.vmin + x * (view.vmax - view.vmin);
}

/** `dataToX` (`volume.py:455-459`). */
export function dataToX(view: RampView, d: number): number {
  return (d - view.vmin) / (view.vmax - view.vmin);
}

/** `yToAlpha` (`volume.py:461-467`): `((10^y - 1)/9) * amax`. */
export function yToAlpha(view: RampView, y: number): number {
  const t = (Math.pow(ALPHA_LOG_BASE, y) - 1.0) / (ALPHA_LOG_BASE - 1.0);
  return t * view.amax;
}

/** `alphaToY` (`volume.py:469-477`): `log10(1 + 9*(a/amax))`, 0 when amax == 0. */
export function alphaToY(view: RampView, a: number): number {
  if (view.amax === 0.0) return 0.0;
  const y = a / view.amax;
  return Math.log(1.0 + (ALPHA_LOG_BASE - 1.0) * y) / Math.log(ALPHA_LOG_BASE);
}

/* ------------------------------------------------------------------ *
 * Points <-> PyMOL's flat ramp
 * ------------------------------------------------------------------ */

/**
 * `setColors` (`volume.py:750-776`). Flat `[v,r,g,b,a]*N` -> points.
 * A NaN value aborts the whole update, exactly as upstream does (it returns
 * without touching `self.points`), because a half-applied ramp is worse than a
 * stale one.
 */
export function flatToPoints(flat: FlatVolumeRamp): VolumeRampPoint[] | null {
  const points: VolumeRampPoint[] = [];
  for (let p = 0; p + 4 < flat.length; p += 5) {
    const value = flat[p]!;
    if (Number.isNaN(value)) return null;
    points.push({
      value,
      r: flat[p + 1]!,
      g: flat[p + 2]!,
      b: flat[p + 3]!,
      alpha: flat[p + 4]!,
    });
  }
  return points;
}

/** `getColors` (`volume.py:411-427`). Points -> flat `[x, r, g, b, y]*N`. */
export function pointsToFlat(points: readonly VolumeRampPoint[]): number[] {
  const out: number[] = [];
  for (const p of points) out.push(p.value, p.r, p.g, p.b, p.alpha);
  return out;
}

/* ------------------------------------------------------------------ *
 * Histogram — volume.py:665-709
 * ------------------------------------------------------------------ */

export interface HistogramResult {
  vmin: number;
  vmax: number;
  /** `(x01, y01)` pairs; empty when the histogram carries no usable bars. */
  path: readonly (readonly [number, number])[];
  /** Set when upstream would have printed its `Warning: setHistogram ...`. */
  warning?: string;
}

/**
 * `setHistogram` (`volume.py:665-709`).
 *
 * Order of the guards is upstream's and it matters: the flat-data widening is
 * tested FIRST, so a NaN pair (which is never equal to itself) falls through to
 * the `elif` and reverts to the previous range instead of being widened.
 */
export function normalizeHistogram(
  histogram: VolumeHistogram,
  previous: { vmin: number; vmax: number },
): HistogramResult {
  let vmin = histogram[0] ?? 0;
  let vmax = histogram[1] ?? 1;

  if (vmin === vmax) {
    vmin -= 1.0;
    vmax += 1.0;
  } else if (Number.isNaN(vmin) || Number.isNaN(vmax)) {
    return {
      vmin: previous.vmin,
      vmax: previous.vmax,
      path: [],
      warning: `Warning: setHistogram vmin=${vmin} vmax=${vmax}`,
    };
  }

  const hist = histogram.slice(4);
  const n = hist.length;
  if (n === 0) return { vmin, vmax, path: [] };

  // Cut extreme peaks in the distribution: q90*4, but never above the real max.
  const shist = [...hist].sort((a, b) => a - b);
  const q90 = shist[Math.trunc(n * 0.9)]!;
  const maxValue = Math.min(q90 * 4, shist[n - 1]!);
  if (maxValue === 0.0) return { vmin, vmax, path: [] };

  const xstep = 1.0 / n;
  const ynorm = 1.0 / maxValue;
  const path: [number, number][] = [];
  let x = 0.0;
  for (const v of hist) {
    x += xstep;
    path.push([x, v * ynorm]);
  }
  return { vmin, vmax, path };
}

/**
 * Reduce a raw volume field to the SAME `[min, max, mean, stdev, h0..hN]`
 * vector `cmd.get_volume_histogram` returns — a line-for-line port of
 * `ObjectMapStateGetHistogram` (`packages/engine/layer2/ObjectMap.cpp:291-361`).
 *
 * This was written because the bridge could not deliver that call at all:
 * `codec.BLOB_RETURNS` routed `get_volume_histogram` to a blob writer that
 * demands a numpy array, while the C function returns a plain Python list.
 * THAT IS FIXED — `cmd.get_volume_histogram` now answers 68 inline floats, and
 * `packages/bridge/tests/test_p8_a10.py` both measures it and re-creates the old defect
 * with a monkeypatch to get the old `NotSerializable: get_volume_histogram
 * returned list, expected a numpy array` back. So this is now the FALLBACK, for
 * an older bridge; it stays because `cmd.get_volume_field` IS a numpy array and
 * gives the client a way to compute the identical vector itself.
 *
 * Three details that are easy to get wrong and are not negotiable, because
 * getting any of them wrong moves the plotted curve:
 *
 *   * the reported range is NOT the data range. It is
 *     `[max(min, mean - limit*stdev), min(max, mean + limit*stdev)]` where
 *     `limit` is the `volume_data_range` setting (default 5). Measured: a field
 *     whose real max is 9.034 reports 4.999136 == 0 + 5*0.9998329.
 *   * `stdev` is the POPULATION deviation computed as
 *     `sqrt((sumsq - sum^2/n) / n)`, not the sample one.
 *   * the bucket is `int(((n_points - 1) / (max_his - min_his)) * (v - min_his))`
 *     — `n_points - 1`, and anything landing outside `[0, n_points)` is DROPPED,
 *     not clamped. That is why the counts do not sum to the voxel count.
 */
export function histogramFromField(field: Float32Array, bins: number, limit = 5.0): number[] {
  const n = field.length;
  if (n === 0) return [0, 1, 1, 1, ...new Array<number>(bins).fill(0)];

  let minVal = field[0]!;
  let maxVal = field[0]!;
  let sum = field[0]!;
  let sumsq = field[0]! * field[0]!;
  for (let i = 1; i < n; i++) {
    const v = field[i]!;
    if (minVal > v) minVal = v;
    if (maxVal < v) maxVal = v;
    sum += v;
    sumsq += v * v;
  }
  const mean = sum / n;
  const stdev = Math.sqrt((sumsq - (sum * sum) / n) / n);

  let minHis: number;
  let maxHis: number;
  if (limit > 0) {
    minHis = Math.max(mean - limit * stdev, minVal);
    maxHis = Math.min(mean + limit * stdev, maxVal);
  } else {
    minHis = minVal;
    maxHis = maxVal;
  }

  const counts = new Array<number>(bins).fill(0);
  if (bins > 0 && maxHis !== minHis) {
    const irange = (bins - 1) / (maxHis - minHis);
    for (let i = 0; i < n; i++) {
      const pos = Math.trunc(irange * (field[i]! - minHis));
      if (pos >= 0 && pos < bins) counts[pos]!++;
    }
  }
  return [minHis, maxHis, mean, stdev, ...counts];
}

/* ------------------------------------------------------------------ *
 * Hit testing — volume.py:651-663
 * ------------------------------------------------------------------ */

/** `findPoint`: index of the point under `(x, y)` in widget pixels, or -1. */
export function findPoint(
  view: RampView,
  points: readonly VolumeRampPoint[],
  x: number,
  y: number,
): number {
  for (let index = 0; index < points.length; index++) {
    const p = points[index]!;
    const dx = dataToX(view, p.value) * (view.width - LEFT_MARGIN) - x + LEFT_MARGIN;
    const dy = (view.height - BOTTOM_MARGIN) * (1.0 - alphaToY(view, p.alpha)) - y;
    if (dx * dx + dy * dy < 4 * DOT_RADIUS * DOT_RADIUS) return index;
  }
  return -1;
}

/**
 * `mousePressEvent`'s guard (`volume.py:311-313`): the plot rect grown by
 * DOT_RADIUS on every side, so a dot half outside the axes is still grabbable.
 */
export function inPlotArea(view: RampView, x: number, y: number): boolean {
  const r = plotRect(view);
  return (
    x >= r.left - DOT_RADIUS &&
    x <= rectRight(r) + DOT_RADIUS &&
    y >= r.top - DOT_RADIUS &&
    y <= rectBottom(r) + DOT_RADIUS
  );
}

/* ------------------------------------------------------------------ *
 * Mutations
 * ------------------------------------------------------------------ */

export interface AddPointResult {
  points: VolumeRampPoint[];
  /** Index the newly added (centre) point ended up at — becomes `self.point`. */
  index: number;
  /** How many colours the cycle advanced by. */
  colorAdvance: number;
}

/**
 * `addPoint` (`volume.py:607-634`).
 *
 * Left-click on empty canvas inserts one point; with ctrl it inserts three —
 * the clicked one plus two zero-alpha points at -10 / +10 widget pixels — and
 * the list stays sorted by x because the insert index is found by comparison.
 */
export function addPoint(
  view: RampView,
  points: readonly VolumeRampPoint[],
  posX: number,
  posY: number,
  threePoints: boolean,
  color: readonly [number, number, number],
): AddPointResult {
  const [r, g, b] = color;
  const next = [...points];
  const newX = convertX(view, posX);
  const newY = yToAlpha(view, convertY(view, posY));

  let newIndex = next.length;
  for (let index = 0; index < next.length; index++) {
    if (newX < dataToX(view, next[index]!.value)) {
      newIndex = index;
      break;
    }
  }

  next.splice(newIndex, 0, { value: xToData(view, newX), alpha: newY, r, g, b });

  if (threePoints) {
    const left = convertX(view, posX - 10);
    next.splice(newIndex, 0, { value: xToData(view, left), alpha: 0, r, g, b });
    const right = convertX(view, posX + 10);
    next.splice(newIndex + 2, 0, { value: xToData(view, right), alpha: 0, r, g, b });
    newIndex += 1;
  }

  return { points: next, index: newIndex, colorAdvance: 1 };
}

/**
 * `removePoints` (`volume.py:636-649`).
 *
 * Removes the point at `point`; with `threePoints` also the one that slid into
 * its place (the old right neighbour) and the one before it. Upstream's exact
 * index dance, including the guards, because the off-by-one is load-bearing at
 * the ends of the list.
 */
export function removePoints(
  points: readonly VolumeRampPoint[],
  point: number,
  threePoints: boolean,
): VolumeRampPoint[] {
  if (point < 0) return [...points];
  const next = [...points];
  next.splice(point, 1);
  if (threePoints) {
    if (point < next.length) next.splice(point, 1);
    if (point > 0) next.splice(point - 1, 1);
  }
  return next;
}

export type DragConstraint = 'x' | 'y' | null;

/**
 * `movePoints` (`volume.py:556-605`).
 *
 * `delta` is 2 when ctrl is held (three points move together, horizontally
 * only) and 1 otherwise. The x clamp keeps a point from crossing its
 * neighbours; `constraint` latches an axis for right-drags.
 */
export function movePoints(
  view: RampView,
  points: readonly VolumeRampPoint[],
  point: number,
  eventX: number,
  eventY: number,
  ctrl: boolean,
  constraint: DragConstraint,
): { points: VolumeRampPoint[]; value: number; alpha: number } {
  const delta = ctrl ? 2 : 1;
  const next = [...points];
  const numPoints = next.length;
  const current = next[point]!;
  const x = current.value;
  const y = current.alpha;

  let dx = xToData(view, convertX(view, eventX)) - x;

  if (dx < 0) {
    const minX = point > delta - 1 ? next[point - delta]!.value : view.vmin;
    const x0 = point > 0 ? next[point - delta + 1]!.value : x;
    if (x0 + dx < minX) dx = minX - x0;
  } else {
    const maxX = point < numPoints - delta ? next[point + delta]!.value : view.vmax;
    const x0 = point < numPoints - delta + 1 ? next[point + delta - 1]!.value : x;
    if (x0 + dx > maxX) dx = maxX - x0;
  }

  let newX = x + dx;
  let newY = yToAlpha(view, convertY(view, eventY));

  if (constraint === 'y') newX = x;
  if (constraint === 'x' || delta > 1) newY = y;

  next[point] = { ...current, value: newX, alpha: newY };

  if (delta > 1) {
    const shift = newX - x;
    if (point > 0) {
      const left = next[point - 1]!;
      next[point - 1] = { ...left, value: left.value + shift };
    }
    if (point < numPoints - 1) {
      const right = next[point + 1]!;
      next[point + 1] = { ...right, value: right.value + shift };
    }
  }

  return { points: next, value: newX, alpha: newY };
}

/** The drag tooltip (`volume.py:601`), byte for byte. */
export function dragTooltip(value: number, alpha: number): string {
  return `value: ${value.toFixed(3)}\nalpha: ${alpha.toFixed(3)}`;
}

/**
 * `wheelEvent`'s point branch (`volume.py:547-554`): every alpha is scaled by
 * `(1 - delta)` and clamped to 0..1. `delta` is `angleDelta.y / -1000`.
 */
export function scaleAlphas(points: readonly VolumeRampPoint[], delta: number): VolumeRampPoint[] {
  return points.map((p) => {
    let y = p.alpha;
    y -= y * delta;
    y = Math.min(Math.max(y, 0.0), 1.0);
    return { ...p, alpha: y };
  });
}

/** `wheelEvent`'s value-box branch (`volume.py:533-545`). */
export function nudgeValueBox(
  view: RampView,
  key: 'vmin' | 'vmax' | 'amax',
  delta: number,
): Partial<RampView> {
  const vrange = view.vmax - view.vmin;
  if (key === 'amax') {
    return { amax: Math.max(Math.min(view.amax * (1.0 + delta), 1.0), 0.0) };
  }
  if (key === 'vmin') {
    return { vmin: Math.min(view.vmin + vrange * delta, view.vmax - EPS) };
  }
  return { vmax: Math.max(view.vmax + vrange * delta, view.vmin + EPS) };
}

/** The three inline boxes' prompt titles and limits (`volume.py:292-309`). */
export function valueBoxPrompt(
  view: RampView,
  key: 'vmin' | 'vmax' | 'amax',
): { title: string; value: number; min: number; max: number; decimals: number } {
  if (key === 'amax') {
    return { title: 'Maximum Alpha Value', value: view.amax, min: EPS, max: 1.0, decimals: 6 };
  }
  if (key === 'vmin') {
    return {
      title: 'Minimum Data Value',
      value: view.vmin,
      min: -1e8,
      max: view.vmax - EPS,
      decimals: 6,
    };
  }
  return {
    title: 'Maximum Data Value',
    value: view.vmax,
    min: view.vmin + EPS,
    max: 1e8,
    decimals: 6,
  };
}

/**
 * The numeric prompt for a right-click on a point (`volume.py:325-343`).
 * `Data value` is clamped to the neighbours; `Alpha value (opacity)` to 0..1.
 */
export function pointPrompt(
  view: RampView,
  points: readonly VolumeRampPoint[],
  point: number,
  which: 'value' | 'alpha',
): { title: string; value: number; min: number; max: number; decimals: number } {
  if (which === 'alpha') {
    return {
      title: 'Alpha value (opacity)',
      value: points[point]!.alpha,
      min: 0.0,
      max: 1.0,
      decimals: 6,
    };
  }
  const prevX = point > 0 ? points[point - 1]!.value : view.vmin;
  const nextX = point < points.length - 1 ? points[point + 1]!.value : view.vmax;
  return {
    title: 'Data value',
    value: points[point]!.value,
    min: prevX,
    max: nextX,
    decimals: 6,
  };
}

/**
 * `changePointColor` (`volume.py:367-382`): recolour one point, or that point
 * and both neighbours when the triple flag is on.
 */
export function changePointColor(
  points: readonly VolumeRampPoint[],
  point: number,
  color: readonly [number, number, number],
  triple: boolean,
): VolumeRampPoint[] {
  const [r, g, b] = color;
  const next = [...points];
  if (point < 0 || point >= next.length) return next;
  next[point] = { ...next[point]!, r, g, b };
  if (triple) {
    if (point > 0) next[point - 1] = { ...next[point - 1]!, r, g, b };
    if (point < next.length - 1) next[point + 1] = { ...next[point + 1]!, r, g, b };
  }
  return next;
}

/* ------------------------------------------------------------------ *
 * "Get colors as script" — volume.py:775-799
 * ------------------------------------------------------------------ */

/**
 * The script snippet, formatted exactly like `displayScript` (and like
 * `get_volume_color(quiet=0)`, `colorramping.py:100-112`).
 *
 * `rname` is injected rather than generated so the text is testable; the panel
 * passes `ramp%03d` with a random 0..999, as upstream does.
 */
export function colorsAsScript(points: readonly VolumeRampPoint[], rname: string): string {
  const r = pointsToFlat(points);
  const lines: string[] = ['### cut below here and paste into script ###\n'];
  lines.push(`cmd.volume_ramp_new('${rname}', [\\\n`);
  for (let i = 0; i < r.length; i += 5) {
    lines.push(
      `    ${pad6(r[i]!.toFixed(2))}, ${r[i + 1]!.toFixed(2)}, ${r[i + 2]!.toFixed(2)}, ` +
        `${r[i + 3]!.toFixed(2)}, ${r[i + 4]!.toFixed(2)}, \\\n`,
    );
  }
  lines.push('    ])\n');
  lines.push('### cut above here and paste into script ###\n');
  lines.push(
    '\n',
    'Paste into a .pml or .py script or your pymolrc file and use this\n',
    'named color ramp on the PyMOL command line like this:\n',
    '\n',
    `PyMOL> volume_color yourvolume, ${rname}\n`,
  );
  return lines.join('');
}

/** Python's `%6.2f`: right-justified in six columns. */
function pad6(s: string): string {
  return s.length >= 6 ? s : ' '.repeat(6 - s.length) + s;
}

/** `'ramp%03d' % random.randint(0, 999)` (`volume.py:781`). */
export function randomRampName(random: () => number = Math.random): string {
  return 'ramp' + String(Math.floor(random() * 1000)).padStart(3, '0');
}

/** 0..1 floats -> `#rrggbb`, for `<input type="color">`. */
export function toHexColor(r: number, g: number, b: number): string {
  const byte = (v: number) =>
    Math.round(Math.min(Math.max(v, 0), 1) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

/** `#rrggbb` -> 0..1 floats. */
export function fromHexColor(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  return [parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255];
}
