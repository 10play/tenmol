/**
 * `line` and `cross` instance buffers.
 *
 * These two kinds are what take `lines`, `ribbon`, `nonbonded`, `cell`,
 * `extent`, `dashes`, `angles` and `dihedrals` off the Mode-P fallback list —
 * the C++ accessor always extracted them, but `render/modeg.py` had no packer
 * so they arrived with `payloadBytes: 0` and an `unmapped` census.
 */
import { INSTANCE_ITEM_SIZE, type InstanceBuffer } from '@tenmol/protocol';
import type { BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';

import { buildInstancedDraw, isDrawableInstanceKind } from './instances';

/** `LineSegments` narrowed to what these assertions read. */
type LineObject = { geometry: BufferGeometry };

const ref = { byteOffset: 0, byteLength: 0, kind: 'f32' as const, itemSize: 1 };

function lineBuffer(count: number): InstanceBuffer {
  return { kind: 'line', count, itemSize: INSTANCE_ITEM_SIZE.line, data: ref };
}
function crossBuffer(count: number): InstanceBuffer {
  return { kind: 'cross', count, itemSize: INSTANCE_ITEM_SIZE.cross, data: ref };
}

describe('line instances', () => {
  it('is drawable', () => {
    expect(isDrawableInstanceKind('line')).toBe(true);
    expect(isDrawableInstanceKind('cross')).toBe(true);
  });

  it('expands one instance into two vertices keeping both endpoint colours', () => {
    // v1=(0,0,0) v2=(1,2,3) rgba1=red rgba2=blue
    const data = new Float32Array([0, 0, 0, 1, 2, 3, 1, 0, 0, 1, 0, 0, 1, 1]);
    const draw = buildInstancedDraw(lineBuffer(1), data);
    expect(draw).not.toBeNull();

    const geometry = (draw!.object as unknown as LineObject).geometry;
    const pos = geometry.getAttribute('position').array as Float32Array;
    const col = geometry.getAttribute('color').array as Float32Array;

    expect(Array.from(pos)).toEqual([0, 0, 0, 1, 2, 3]);
    // A CGO_SPLITLINE is bicoloured; losing the second colour would silently
    // repaint half of every bond.
    expect(Array.from(col.subarray(0, 4))).toEqual([1, 0, 0, 1]);
    expect(Array.from(col.subarray(4, 8))).toEqual([0, 0, 1, 1]);
    expect(draw!.count).toBe(1);
  });

  it('reports segments, not vertices, so the HUD agrees with the bridge', () => {
    const data = new Float32Array(3 * INSTANCE_ITEM_SIZE.line);
    expect(buildInstancedDraw(lineBuffer(3), data)!.count).toBe(3);
  });

  it('rejects a short buffer rather than reading past the end', () => {
    expect(buildInstancedDraw(lineBuffer(4), new Float32Array(10))).toBeNull();
  });
});

describe('cross instances', () => {
  it('expands a centre into three axis-aligned segments of nonbondedSize', () => {
    const data = new Float32Array([10, 20, 30, 0, 1, 0, 1]);
    const draw = buildInstancedDraw(crossBuffer(1), data, { nonbondedSize: 0.5 });
    const geometry = (draw!.object as unknown as LineObject).geometry;
    const pos = Array.from(geometry.getAttribute('position').array as Float32Array);

    expect(pos).toEqual([
      9.5, 20, 30, 10.5, 20, 30, // x arm
      10, 19.5, 30, 10, 20.5, 30, // y arm
      10, 20, 29.5, 10, 20, 30.5, // z arm
    ]);
    expect(draw!.count).toBe(3); // three segments
  });

  it('paints all six vertices with the atom colour', () => {
    const data = new Float32Array([0, 0, 0, 0.25, 0.5, 0.75, 1]);
    const draw = buildInstancedDraw(crossBuffer(1), data, { nonbondedSize: 1 });
    const geometry = (draw!.object as unknown as LineObject).geometry;
    const col = geometry.getAttribute('color').array as Float32Array;
    expect(col).toHaveLength(24);
    for (let v = 0; v < 6; v++) {
      expect(Array.from(col.subarray(v * 4, v * 4 + 4))).toEqual([0.25, 0.5, 0.75, 1]);
    }
  });

  it('falls back to the cSetting_nonbonded_size default of 0.25', () => {
    const data = new Float32Array([0, 0, 0, 1, 1, 1, 1]);
    const draw = buildInstancedDraw(crossBuffer(1), data);
    const geometry = (draw!.object as unknown as LineObject).geometry;
    const pos = geometry.getAttribute('position').array as Float32Array;
    expect(pos[0]).toBeCloseTo(-0.25);
    expect(pos[3]).toBeCloseTo(0.25);
  });

  it('has a finite bounding sphere covering the arms', () => {
    const data = new Float32Array([0, 0, 0, 1, 1, 1, 1]);
    const draw = buildInstancedDraw(crossBuffer(1), data, { nonbondedSize: 2 });
    const geometry = (draw!.object as unknown as LineObject).geometry;
    expect(geometry.boundingSphere).not.toBeNull();
    expect(geometry.boundingSphere.radius).toBeGreaterThanOrEqual(2);
    expect(Number.isFinite(geometry.boundingSphere.radius)).toBe(true);
  });
});
