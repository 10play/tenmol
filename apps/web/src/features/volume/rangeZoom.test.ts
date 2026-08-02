/**
 * `ctrl+R-drag` on the volume ramp canvas — the ARITHMETIC and the BAND.
 *
 * Upstream is three fragments of `packages/engine/modules/pmg_qt/volume.py`:
 *
 *   :495-499  mouseMoveEvent — `buttons() == RightButton and
 *             modifiers() == ControlModifier` records `zoom_pos` and repaints;
 *             note it returns BEFORE `self.dragged = True`, so a ctrl+R-drag
 *             never counts as a point drag.
 *   :251-255  paintZoomArea — `fillRect(rect, QColor(0, 64, 128, 128))` over
 *             the plot rect between `init_pos.x()` and `zoom_pos.x()`.
 *   :358-362  mouseReleaseEvent — `if self.init_pos.x() != self.zoom_pos.x():
 *             self.vmin, self.vmax = sorted([xToData(convertX(init)),
 *             xToData(convertX(zoom))])`.
 *
 * The event model is tested in `rangeZoom.dom.test.tsx`; this file pins the two
 * pure halves, so a failure says which one moved.
 *
 * The numbers below are the REAL range of the captured fixture
 * (`__fixtures__/engine-volume.json`, `cmd.get_volume_histogram` on a 2fofc map:
 * `[-0.30942875146865845, 4.999135971069336, ...]`), not round test numbers.
 */

import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/engine-volume.json';
import { paint, type PaintOptions } from './paint';
import { convertX, xToData, type RampView } from './ramp';

const VIEW: RampView = {
  width: 600, // volume.py:99 sizeHint
  height: 200,
  vmin: fixture.histogram[0]!,
  vmax: fixture.histogram[1]!,
  amax: 1,
};

/** `mouseReleaseEvent`'s two lines, isolated. Returns null when Qt ignores it. */
function zoomRange(
  view: RampView,
  fromX: number,
  toX: number,
): { vmin: number; vmax: number } | null {
  if (fromX === toX) return null; // volume.py:359
  const a = xToData(view, convertX(view, fromX));
  const b = xToData(view, convertX(view, toX));
  return a <= b ? { vmin: a, vmax: b } : { vmin: b, vmax: a };
}

describe('ctrl+R-drag range zoom (volume.py:358-362)', () => {
  it('maps the two band edges through convertX -> xToData and sorts them', () => {
    // 565 px of plot (600 - LEFT_MARGIN 35) spanning -0.309429 .. 4.999136.
    const zoomed = zoomRange(VIEW, 100, 300)!;
    expect(zoomed.vmin).toBeCloseTo(-0.30942875146865845 + (65 / 565) * 5.308564722538, 12);
    expect(zoomed.vmin).toBeCloseTo(0.301291083867571, 12);
    expect(zoomed.vmax).toBeCloseTo(2.180429038748277, 12);
  });

  it('sorts, so a right-to-left drag gives the identical window', () => {
    expect(zoomRange(VIEW, 300, 100)).toEqual(zoomRange(VIEW, 100, 300));
  });

  it('ignores a zero-width band', () => {
    expect(zoomRange(VIEW, 240, 240)).toBeNull();
  });

  it('clamps a band dragged off either end to the current window', () => {
    // convertX clamps to 0..1 (volume.py:435-440), so the zoom can never widen.
    const zoomed = zoomRange(VIEW, -400, 4000)!;
    expect(zoomed.vmin).toBe(VIEW.vmin);
    expect(zoomed.vmax).toBe(VIEW.vmax);
  });

  it('compounds: the second band is read against the FIRST zoom, not the original', () => {
    const first = zoomRange(VIEW, 100, 300)!;
    const second = zoomRange({ ...VIEW, ...first }, 100, 300)!;
    expect(second.vmin).toBeCloseTo(0.5174750963759708, 12);
    expect(second.vmax).toBeCloseTo(1.1826566733248933, 12);
    // strictly inside the first window — that is what "zoom in" means
    expect(second.vmin).toBeGreaterThan(first.vmin);
    expect(second.vmax).toBeLessThan(first.vmax);
  });
});

/* ------------------------------------------------------------------ *
 * The band itself — paintZoomArea (volume.py:251-255)
 * ------------------------------------------------------------------ */

interface FillRect {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: unknown;
}

/**
 * A 2D context that records instead of rasterising.
 *
 * jsdom's `<canvas>` has no `getContext('2d')` without the native `canvas`
 * package, so every DOM-side assertion about what was DRAWN has to go through a
 * double. This one is deliberately dumb: it records `fillRect` with the
 * `fillStyle` in force at the time, which is all `paintZoomArea` produces.
 */
export function recordingContext(): {
  ctx: CanvasRenderingContext2D;
  fills: FillRect[];
  texts: { text: string; x: number; y: number }[];
} {
  const fills: FillRect[] = [];
  const texts: { text: string; x: number; y: number }[] = [];
  const noop = () => {};
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textBaseline: 'alphabetic',
    canvas: { width: 0, height: 0 },
    clearRect: noop,
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    rect: noop,
    clip: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    fill: noop,
    stroke: noop,
    setLineDash: noop,
    setTransform: noop,
    strokeRect: noop,
    fillRect(x: number, y: number, w: number, h: number) {
      fills.push({ x, y, w, h, fill: (this as { fillStyle: unknown }).fillStyle });
    },
    fillText(text: string, x: number, y: number) {
      texts.push({ text, x, y });
    },
    // QFontMetrics stand-ins: 7 px average width, 8 + 3 px height.
    measureText: (text: string) => ({
      width: text.length * 7,
      fontBoundingBoxAscent: 8,
      fontBoundingBoxDescent: 3,
    }),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills, texts };
}

function paintOptions(patch: Partial<PaintOptions> = {}): PaintOptions {
  return {
    view: VIEW,
    points: [],
    path: [],
    originalVmin: VIEW.vmin,
    originalVmax: VIEW.vmax,
    hoverPoint: -1,
    zoomFrom: null,
    zoomTo: null,
    lineColor: '#8a8a8a',
    font: '11px monospace',
    boxFill: '#ffffff',
    textColor: '#333333',
    ...patch,
  };
}

/** `QColor(0, 64, 128, 128)` — 128/255 rounds to 0.502 in CSS. */
const BAND = 'rgba(0, 64, 128, 0.502)';

describe('paintZoomArea (volume.py:251-255)', () => {
  it('paints nothing until BOTH edges exist', () => {
    for (const patch of [{}, { zoomFrom: 100 }, { zoomTo: 300 }]) {
      const { ctx, fills } = recordingContext();
      paint(ctx, paintOptions(patch));
      expect(fills.filter((f) => f.fill === BAND)).toEqual([]);
    }
  });

  it('fills the plot rect between the two edges in QColor(0,64,128,128)', () => {
    const { ctx, fills } = recordingContext();
    paint(ctx, paintOptions({ zoomFrom: 100, zoomTo: 300 }));
    const band = fills.filter((f) => f.fill === BAND);
    expect(band).toEqual([{ x: 100, y: 0, w: 200, h: 180, fill: BAND }]);
    // full plot height: height 200 - BOTTOM_MARGIN 20
  });

  it('paints a right-to-left drag as the same band', () => {
    const { ctx, fills } = recordingContext();
    paint(ctx, paintOptions({ zoomFrom: 300, zoomTo: 100 }));
    expect(fills.filter((f) => f.fill === BAND)).toEqual([
      { x: 100, y: 0, w: 200, h: 180, fill: BAND },
    ]);
    // DIVERGENCE, deliberate: Qt builds the band with QRect::setLeft(init) +
    // setRight(zoom), which is a non-normalised (empty) rect when the drag runs
    // leftwards, so upstream shows no band at all in that direction. The RESULT
    // is identical either way because the release sorts, so the band is drawn
    // symmetrically here rather than reproducing a paint bug.
  });

  it('is painted LAST, over the histogram and the dots (volume.py:257-266)', () => {
    const { ctx, fills } = recordingContext();
    paint(ctx, paintOptions({ zoomFrom: 100, zoomTo: 300 }));
    expect(fills[fills.length - 1]!.fill).toBe(BAND);
  });
});
