/**
 * The volume ramp maths, checked against `modules/pmg_qt/volume.py` and against
 * REAL engine output.
 *
 * `__fixtures__/engine-volume.json` was captured from this tree's PyMOL, not
 * written by hand:
 *
 *     cmd.fragment('his'); cmd.alter('all','b=20'); cmd.map_new('map')
 *     cmd.volume('vol','map','2fofc')
 *     cmd.get_volume_histogram('vol')   -> histogram   (68 floats)
 *     cmd.get_volume_field('vol')       -> field_b64   (2992 float32)
 *     cmd.volume_color('vol')           -> ramp        (3 stops)
 *     cmd.get('volume_data_range')      -> 5.0
 *
 * so `histogramFromField` is proved against the C implementation it replaces,
 * bit for bit, rather than against my own idea of what a histogram is.
 */

import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/engine-volume.json';
import {
  DEFAULT_COLORS,
  addPoint,
  alphaToY,
  changePointColor,
  colorsAsScript,
  convertX,
  convertY,
  dataToX,
  dragTooltip,
  findPoint,
  flatToPoints,
  histogramFromField,
  inPlotArea,
  movePoints,
  normalizeHistogram,
  nudgeValueBox,
  pointPrompt,
  pointsToFlat,
  removePoints,
  scaleAlphas,
  valueBoxPrompt,
  xToData,
  yToAlpha,
  type RampView,
} from './ramp';

const view: RampView = { width: 635, height: 220, vmin: 0, vmax: 5, amax: 1 };

function decodeField(): Float32Array {
  const binary = Buffer.from(fixture.field_b64, 'base64');
  return new Float32Array(binary.buffer, binary.byteOffset, binary.byteLength / 4);
}

describe('the six transforms (volume.py:435-477)', () => {
  it('convertX maps the left margin to 0 and the right edge to 1, clamped', () => {
    expect(convertX(view, 35)).toBe(0);
    expect(convertX(view, 635)).toBe(1);
    expect(convertX(view, 0)).toBe(0); // clamped
    expect(convertX(view, 9999)).toBe(1); // clamped
    expect(convertX(view, 335)).toBeCloseTo(0.5, 6);
  });

  it('convertY flips and clamps against height - bottom_margin', () => {
    expect(convertY(view, 0)).toBe(1);
    expect(convertY(view, 200)).toBe(0);
    expect(convertY(view, 100)).toBeCloseTo(0.5, 6);
    expect(convertY(view, -10)).toBe(1);
  });

  it('xToData and dataToX are inverses across the window', () => {
    for (const x of [0, 0.25, 0.5, 0.75, 1]) {
      expect(dataToX(view, xToData(view, x))).toBeCloseTo(x, 12);
    }
    expect(xToData(view, 0.5)).toBe(2.5);
  });

  it('yToAlpha is the base-10 log curve of volume.py:461-467', () => {
    // ((10^y - 1) / 9) * amax
    expect(yToAlpha(view, 0)).toBeCloseTo(0, 12);
    expect(yToAlpha(view, 1)).toBeCloseTo(1, 12);
    expect(yToAlpha(view, 0.5)).toBeCloseTo((Math.sqrt(10) - 1) / 9, 12);
  });

  it('alphaToY inverts it, and is 0 when amax is 0', () => {
    for (const a of [0, 0.1, 0.37, 1]) {
      expect(alphaToY(view, yToAlpha(view, a))).toBeCloseTo(a, 12);
    }
    expect(alphaToY({ ...view, amax: 0 }, 0.5)).toBe(0);
  });

  it('amax scales the alpha axis', () => {
    const half: RampView = { ...view, amax: 0.5 };
    expect(yToAlpha(half, 1)).toBeCloseTo(0.5, 12);
    expect(alphaToY(half, 0.5)).toBeCloseTo(1, 12);
  });
});

describe('histogram', () => {
  it('reproduces cmd.get_volume_histogram from the raw field, exactly', () => {
    const mine = histogramFromField(decodeField(), 64, fixture.volume_data_range);
    const theirs = fixture.histogram;
    expect(mine.length).toBe(theirs.length);
    // min / max / mean / stdev. `max` is `mean + limit*stdev` and C accumulates
    // `sum`/`sumsq` in FLOAT32 (`layer2/ObjectMap.cpp:296`) while JS is float64,
    // so the two agree to ~3e-5 and no further. Every BAR is still identical,
    // which is what the drawing depends on.
    expect(mine[0]).toBeCloseTo(theirs[0]!, 5);
    expect(mine[1]).toBeCloseTo(theirs[1]!, 4);
    expect(mine[2]).toBeCloseTo(theirs[2]!, 5);
    expect(mine[3]).toBeCloseTo(theirs[3]!, 4);
    // every bar, integer-equal
    expect(mine.slice(4)).toEqual(theirs.slice(4));
  });

  it('trims to +/- volume_data_range standard deviations, not to the data range', () => {
    const field = decodeField();
    let realMax = -Infinity;
    for (const v of field) if (v > realMax) realMax = v;
    // The field really goes to ~9.03 but the histogram stops at ~5.0.
    expect(realMax).toBeGreaterThan(8);
    expect(fixture.histogram[1]!).toBeLessThan(5.1);
    expect(histogramFromField(field, 64, 0)[1]).toBeCloseTo(realMax, 5);
  });

  it('normalizeHistogram clips the peak at q90*4 and produces N points', () => {
    const result = normalizeHistogram(fixture.histogram, { vmin: 0, vmax: 1 });
    expect(result.vmin).toBeCloseTo(fixture.histogram[0]!, 6);
    expect(result.vmax).toBeCloseTo(fixture.histogram[1]!, 6);
    expect(result.path.length).toBe(64);
    // The 2337-count first bar is clipped: q90*4 is far below it, so the
    // normalised value exceeds 1 and the curve leaves the plot, which is what
    // upstream draws.
    const bars = fixture.histogram.slice(4);
    const sorted = [...bars].sort((a, b) => a - b);
    const q90 = sorted[Math.trunc(64 * 0.9)]!;
    const maxValue = Math.min(q90 * 4, sorted[63]!);
    expect(maxValue).toBe(q90 * 4);
    expect(result.path[0]![1]).toBeCloseTo(bars[0]! / maxValue, 6);
    expect(result.path[0]![0]).toBeCloseTo(1 / 64, 12);
  });

  it('widens a flat range by +/-1 (volume.py:670-673)', () => {
    const result = normalizeHistogram([3, 3, 0, 0], { vmin: -9, vmax: 9 });
    expect(result.vmin).toBe(2);
    expect(result.vmax).toBe(4);
  });

  it('reverts to the previous range on NaN and reports the warning', () => {
    const result = normalizeHistogram([NaN, 5, 0, 0], { vmin: -1, vmax: 7 });
    expect(result.vmin).toBe(-1);
    expect(result.vmax).toBe(7);
    expect(result.warning).toContain('setHistogram');
  });
});

describe('points <-> flat ramp', () => {
  it('round-trips the engine ramp through both conversions', () => {
    const points = flatToPoints(fixture.ramp);
    expect(points).not.toBeNull();
    expect(points!.length).toBe(3);
    expect(points![1]).toMatchObject({ value: 1, r: 0, g: 0, b: 1 });
    expect(points![1]!.alpha).toBeCloseTo(0.2, 6);
    expect(pointsToFlat(points!)).toEqual(fixture.ramp);
  });

  it('refuses a NaN value outright rather than half-applying (volume.py:769-771)', () => {
    expect(flatToPoints([NaN, 1, 0, 0, 1])).toBeNull();
  });
});

describe('add / remove / drag', () => {
  const base = flatToPoints(fixture.ramp)!;

  it('inserts one point in sorted position with the next cycle colour', () => {
    // x=335 is the middle of the plot -> data 2.5, which is after all 3 stops
    // (1.0, 1.0, 1.4) so it lands at the end.
    const result = addPoint(view, base, 335, 100, false, DEFAULT_COLORS[0]!);
    expect(result.points.length).toBe(4);
    expect(result.index).toBe(3);
    expect(result.points[3]!.value).toBeCloseTo(2.5, 6);
    expect(result.points[3]).toMatchObject({ r: 1, g: 1, b: 0 });
  });

  it('ctrl inserts three points, the outer two with zero alpha', () => {
    const result = addPoint(view, base, 335, 100, true, DEFAULT_COLORS[1]!);
    expect(result.points.length).toBe(6);
    expect(result.index).toBe(4);
    expect(result.points[3]!.alpha).toBe(0);
    expect(result.points[5]!.alpha).toBe(0);
    expect(result.points[3]!.value).toBeLessThan(result.points[4]!.value);
    expect(result.points[4]!.value).toBeLessThan(result.points[5]!.value);
  });

  it('removes one point, or the point and both neighbours with ctrl', () => {
    expect(removePoints(base, 1, false).length).toBe(2);
    expect(removePoints(base, 1, true).length).toBe(0);
    expect(removePoints(base, 0, true).length).toBe(1);
  });

  it('clamps a drag so a point cannot cross its neighbours', () => {
    const points = [
      { value: 1, alpha: 0.1, r: 1, g: 0, b: 0 },
      { value: 2, alpha: 0.2, r: 0, g: 1, b: 0 },
      { value: 3, alpha: 0.3, r: 0, g: 0, b: 1 },
    ];
    // Drag the middle point far right: it stops at its right neighbour.
    const right = movePoints(view, points, 1, 635, 100, false, null);
    expect(right.points[1]!.value).toBeCloseTo(3, 6);
    // and far left: it stops at its left neighbour.
    const left = movePoints(view, points, 1, 35, 100, false, null);
    expect(left.points[1]!.value).toBeCloseTo(1, 6);
  });

  it('ctrl-drag moves three points horizontally and freezes y', () => {
    const points = [
      { value: 1, alpha: 0.1, r: 1, g: 0, b: 0 },
      { value: 2, alpha: 0.2, r: 0, g: 1, b: 0 },
      { value: 3, alpha: 0.3, r: 0, g: 0, b: 1 },
    ];
    const moved = movePoints(view, points, 1, 335, 10, true, null);
    const shift = moved.points[1]!.value - 2;
    expect(moved.points[0]!.value).toBeCloseTo(1 + shift, 9);
    expect(moved.points[2]!.value).toBeCloseTo(3 + shift, 9);
    expect(moved.points[1]!.alpha).toBe(0.2); // y frozen
  });

  it('honours a latched axis constraint', () => {
    const points = [{ value: 2, alpha: 0.2, r: 1, g: 0, b: 0 }];
    const xOnly = movePoints(view, points, 0, 400, 10, false, 'x');
    expect(xOnly.points[0]!.alpha).toBe(0.2);
    const yOnly = movePoints(view, points, 0, 400, 10, false, 'y');
    expect(yOnly.points[0]!.value).toBe(2);
  });

  it('formats the drag tooltip exactly as volume.py:601 does', () => {
    expect(dragTooltip(1.23456, 0.5)).toBe('value: 1.235\nalpha: 0.500');
  });
});

describe('hit testing', () => {
  const points = flatToPoints(fixture.ramp)!;

  it('finds the point under the cursor within 2*DOT_RADIUS', () => {
    const p = points[1]!;
    const x = dataToX(view, p.value) * (view.width - 35) + 35;
    const y = (view.height - 20) * (1 - alphaToY(view, p.alpha));
    // Points 0 and 1 share value 1.0; index 0 (alpha 0) is at a different y.
    expect(findPoint(view, points, x, y)).toBe(1);
    expect(findPoint(view, points, x + 40, y)).toBe(-1);
  });

  it('accepts the plot rect grown by DOT_RADIUS on every side', () => {
    expect(inPlotArea(view, 31, 0)).toBe(true); // 35 - 5 + 1
    expect(inPlotArea(view, 20, 0)).toBe(false);
    expect(inPlotArea(view, 100, 204)).toBe(true); // bottom 199 + 5
    expect(inPlotArea(view, 100, 210)).toBe(false);
  });
});

describe('wheel', () => {
  it('scales every alpha by (1 - delta) and clamps to 0..1', () => {
    const points = [
      { value: 1, alpha: 0.5, r: 0, g: 0, b: 0 },
      { value: 2, alpha: 1, r: 0, g: 0, b: 0 },
    ];
    const up = scaleAlphas(points, -0.1);
    expect(up[0]!.alpha).toBeCloseTo(0.55, 9);
    expect(up[1]!.alpha).toBe(1); // clamped
    const down = scaleAlphas(points, 0.5);
    expect(down[0]!.alpha).toBeCloseTo(0.25, 9);
  });

  it('nudges the value boxes without touching the ramp', () => {
    expect(nudgeValueBox(view, 'amax', 0.1).amax).toBeCloseTo(1, 9); // clamped to 1
    expect(nudgeValueBox({ ...view, amax: 0.5 }, 'amax', 0.1).amax).toBeCloseTo(0.55, 9);
    expect(nudgeValueBox(view, 'vmin', 0.1).vmin).toBeCloseTo(0.5, 9);
    expect(nudgeValueBox(view, 'vmax', 0.1).vmax).toBeCloseTo(5.5, 9);
  });
});

describe('prompts', () => {
  it('gives the value boxes upstream titles and limits (volume.py:292-309)', () => {
    expect(valueBoxPrompt(view, 'amax')).toMatchObject({ title: 'Maximum Alpha Value', max: 1 });
    expect(valueBoxPrompt(view, 'vmin')).toMatchObject({ title: 'Minimum Data Value', min: -1e8 });
    expect(valueBoxPrompt(view, 'vmax')).toMatchObject({ title: 'Maximum Data Value', max: 1e8 });
    expect(valueBoxPrompt(view, 'vmin').max).toBeCloseTo(5 - 1e-6, 12);
  });

  it('clamps a point value prompt to its neighbours and alpha to 0..1', () => {
    const points = [
      { value: 1, alpha: 0.1, r: 0, g: 0, b: 0 },
      { value: 2, alpha: 0.2, r: 0, g: 0, b: 0 },
      { value: 3, alpha: 0.3, r: 0, g: 0, b: 0 },
    ];
    expect(pointPrompt(view, points, 1, 'value')).toMatchObject({
      title: 'Data value',
      min: 1,
      max: 3,
      decimals: 6,
    });
    // ends fall back to vmin / vmax
    expect(pointPrompt(view, points, 0, 'value').min).toBe(0);
    expect(pointPrompt(view, points, 2, 'value').max).toBe(5);
    expect(pointPrompt(view, points, 1, 'alpha')).toMatchObject({
      title: 'Alpha value (opacity)',
      min: 0,
      max: 1,
    });
  });
});

describe('colour editing', () => {
  const points = flatToPoints(fixture.ramp)!;

  it('recolours one point, or the point and both neighbours', () => {
    const single = changePointColor(points, 1, [1, 0.5, 0], false);
    expect(single[1]).toMatchObject({ r: 1, g: 0.5, b: 0 });
    expect(single[0]!.r).toBe(0);
    const triple = changePointColor(points, 1, [1, 0.5, 0], true);
    for (const p of triple) expect(p).toMatchObject({ r: 1, g: 0.5, b: 0 });
  });
});

describe('"Get colors as script"', () => {
  it('formats the volume_ramp_new snippet exactly (volume.py:775-799)', () => {
    const script = colorsAsScript(flatToPoints(fixture.ramp)!, 'ramp042');
    expect(script).toContain('### cut below here and paste into script ###');
    expect(script).toContain("cmd.volume_ramp_new('ramp042', [\\");
    expect(script).toContain('      1.00, 0.00, 0.00, 1.00, 0.00, \\');
    expect(script).toContain('      1.00, 0.00, 0.00, 1.00, 0.20, \\');
    expect(script).toContain('      1.40, 0.00, 0.00, 1.00, 0.00, \\');
    expect(script).toContain('    ])');
    expect(script).toContain('### cut above here and paste into script ###');
    expect(script).toContain('PyMOL> volume_color yourvolume, ramp042');
  });
});
