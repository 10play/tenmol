import { describe, expect, it } from 'vitest';

import { toViewMatrix } from '@tenmol/protocol';

import { pickOffsets, screenRay } from './ray';

/** A default-ish perspective view looking down -z from 100 units away. */
const view = toViewMatrix([
  1,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  1, // identity rotation
  0,
  0,
  -100, // origin in camera space
  0,
  0,
  0, // origin in model space
  80,
  120, // front / back
  -20, // negative == PERSPECTIVE (../camera.ts documents the sign trap)
]);

const ortho = toViewMatrix([
  1,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  1,
  0,
  0,
  -100,
  0,
  0,
  0,
  80,
  120,
  20, // positive == ORTHOSCOPIC
]);

describe('screenRay', () => {
  const rect = { width: 800, height: 600 };

  it('points straight down -z at the centre of the frame', () => {
    const r = screenRay(view, rect, 399.5, 299.5);
    expect(r.direction[0]).toBeCloseTo(0, 6);
    expect(r.direction[1]).toBeCloseTo(0, 6);
    expect(r.direction[2]).toBeCloseTo(-1, 6);
    expect(r.ortho).toBe(false);
  });

  it('flips y: a click ABOVE centre in the DOM points UP in eye space', () => {
    // Symmetric about the pixel CENTRE of the frame, which is 299.5.
    const up = screenRay(view, rect, 400, 99.5);
    const down = screenRay(view, rect, 400, 499.5);
    expect(up.direction[1]).toBeGreaterThan(0);
    expect(down.direction[1]).toBeLessThan(0);
    expect(up.direction[1]).toBeCloseTo(-down.direction[1], 6);
  });

  it('is orthoscopic when view[17] is positive, with a parallel direction', () => {
    const r = screenRay(ortho, rect, 100, 100);
    expect(r.ortho).toBe(true);
    expect(r.direction).toEqual([0, 0, -1]);
    // Above centre in the DOM -> positive y in eye space.
    expect(r.origin[1]).toBeGreaterThan(0);
  });

  it('samples the pixel CENTRE, so x and x+1 differ by exactly one pixel', () => {
    const a = screenRay(view, rect, 100, 300);
    const b = screenRay(view, rect, 101, 300);
    expect(a.direction[0]).toBeLessThan(b.direction[0]);
  });
});

describe('pickOffsets (layer1/ScenePicking.cpp:196-204)', () => {
  const offsets = pickOffsets();

  it('starts at the click itself', () => {
    expect(offsets[0]).toEqual([0, 0]);
  });

  it('reaches 6, not 7: the loop is `d < cRange`', () => {
    const max = Math.max(...offsets.map(([a, b]) => Math.max(Math.abs(a), Math.abs(b))));
    expect(max).toBe(6);
  });

  it('visits every pixel of the 13x13 window exactly once', () => {
    expect(offsets).toHaveLength(13 * 13);
    expect(new Set(offsets.map(([a, b]) => `${a},${b}`)).size).toBe(13 * 13);
  });

  it('is NOT centre-first at d=1: (-1,-1) is tested before (0,0)-adjacent pixels', () => {
    // The C loops are `for a in -d..d { for b in -d..d }`, so after the d=0
    // pixel the very next NEW pixel is (-1,-1).
    expect(offsets[1]).toEqual([-1, -1]);
    expect(offsets[2]).toEqual([-1, 0]);
    expect(offsets[3]).toEqual([-1, 1]);
  });

  it('honours a smaller range', () => {
    expect(pickOffsets(1)).toEqual([[0, 0]]);
    expect(pickOffsets(2)).toHaveLength(9);
  });
});
