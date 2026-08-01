import { describe, expect, it } from 'vitest';

import {
  INITIAL,
  derive,
  pxToUnits,
  reducer,
  unitsToPx,
  type RenderState,
} from './useRenderForm';

const at = (over: Partial<RenderState> = {}): RenderState => ({ ...INITIAL, ...over });

describe('unit conversion', () => {
  it('uses the Qt form’s 2.54 cm/inch factor', () => {
    expect(unitsToPx(1, 300, 'inch')).toBe(300);
    expect(unitsToPx(2.54, 300, 'cm')).toBe(300);
    expect(pxToUnits(300, 300, 'inch')).toBeCloseTo(1);
    expect(pxToUnits(300, 300, 'cm')).toBeCloseTo(2.54);
  });

  it('never divides by zero', () => {
    // The Qt version catches ZeroDivisionError and self-unchecks the aspect
    // lock; a reducer should simply not produce one.
    expect(pxToUnits(100, 0, 'inch')).toBe(0);
    expect(Number.isFinite(unitsToPx(5, 0, 'inch'))).toBe(true);
  });

  it('always yields at least one pixel', () => {
    expect(unitsToPx(0, 300, 'inch')).toBe(1);
    expect(unitsToPx(-5, 300, 'inch')).toBe(1);
    expect(unitsToPx(Number.NaN, 300, 'inch')).toBe(1);
  });
});

describe('aspect lock', () => {
  it('scales the other dimension when locked', () => {
    const s = reducer(at({ width: 800, height: 600, lock: true }), { type: 'width', px: 400 });
    expect(s).toMatchObject({ width: 400, height: 300 });
  });

  it('leaves the other dimension alone when unlocked', () => {
    const s = reducer(at({ width: 800, height: 600, lock: false }), { type: 'width', px: 400 });
    expect(s).toMatchObject({ width: 400, height: 600 });
  });

  it('does not drift over repeated edits', () => {
    // The write-back design drifts here, which is why the Qt form needs
    // @skipIfCircular; deriving from the previous pair does not.
    let s = at({ width: 1000, height: 500, lock: true });
    for (const px of [900, 800, 700, 600]) s = reducer(s, { type: 'width', px });
    expect(s.width / s.height).toBeCloseTo(2, 5);
  });

  it('is symmetric between the two dimensions', () => {
    const w = reducer(at({ width: 1000, height: 500 }), { type: 'width', px: 500 });
    const h = reducer(at({ width: 1000, height: 500 }), { type: 'height', px: 250 });
    expect(w).toMatchObject({ width: 500, height: 250 });
    expect(h).toMatchObject({ width: 500, height: 250 });
  });
});

describe('dpi', () => {
  it('changes the physical size, never the pixel size', () => {
    const s = reducer(at({ width: 1024, height: 768, dpi: 300 }), { type: 'dpi', value: 600 });
    expect(s).toMatchObject({ width: 1024, height: 768, dpi: 600 });
    expect(derive(s).widthUnits).toBeCloseTo(1024 / 600);
  });

  it('refuses a zero or negative dpi rather than propagating it', () => {
    expect(reducer(at(), { type: 'dpi', value: 0 }).dpi).toBe(1);
    expect(reducer(at(), { type: 'dpi', value: -10 }).dpi).toBe(1);
  });
});

describe('editing in physical units', () => {
  it('routes through the pixel path so the lock still applies', () => {
    const s = reducer(at({ width: 600, height: 300, dpi: 300, units: 'inch', lock: true }), {
      type: 'widthUnits',
      value: 4,
    });
    expect(s.width).toBe(1200);
    expect(s.height).toBe(600); // 2:1 preserved
  });

  it('respects centimetres', () => {
    const s = reducer(at({ dpi: 100, units: 'cm', lock: false }), {
      type: 'widthUnits',
      value: 2.54,
    });
    expect(s.width).toBe(100);
  });
});

describe('use current viewport size', () => {
  it('adopts the viewport verbatim even with the lock on', () => {
    // `button_current` is an override, not an edit: it must not be reshaped by
    // the aspect ratio it is replacing.
    const s = reducer(at({ width: 100, height: 100, lock: true }), {
      type: 'viewport',
      width: 1176,
      height: 644,
    });
    expect(s).toMatchObject({ width: 1176, height: 644 });
  });
});

describe('derive', () => {
  it('reports the aspect ratio and both physical sizes', () => {
    const d = derive(at({ width: 1024, height: 512, dpi: 256, units: 'inch' }));
    expect(d.aspect).toBeCloseTo(2);
    expect(d.widthUnits).toBeCloseTo(4);
    expect(d.heightUnits).toBeCloseTo(2);
  });
});
