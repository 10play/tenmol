/**
 * Draw-arrays topology, the reason cartoon was unpickable.
 *
 * Measured on a 1TII cartoon: the accessor emits 1220 blocks, of which 1036 are
 * mode 5 (TRIANGLE_STRIP) and 184 are mode 6 (TRIANGLE_FAN). NONE are mode 4.
 * An index that accepted only GL_TRIANGLES discarded every block, so the index
 * stayed empty and all eight test clicks missed.
 */
import { describe, expect, it } from 'vitest';

import { createPickIndex } from './pick';

/** A minimal CGO draw-arrays frame: vertex-only, one primitive. */
function frame(mode: number, verts: number[][]) {
  const nverts = verts.length;
  const data = new Float32Array(verts.flat());
  return {
    header: {
      v: 1 as const,
      kind: 'cgo-draw-arrays' as const,
      object: 'o',
      rep: 5,
      state: 0,
      blocks: [{ mode, arraybits: 1, nverts, data: { byteOffset: 0, byteLength: data.byteLength, dtype: 'f32' as const, itemSize: 3 } }],
      instances: [],
    },
    // `viewOf` requires a Uint8Array payload, not an ArrayBuffer.
    payload: new Uint8Array(data.buffer),
  } as never;
}

const tri = (z: number) => [
  [0, 0, z],
  [1, 0, z],
  [0, 1, z],
];

describe('draw-arrays blocks reach the pick index', () => {
  it('indexes a TRIANGLE_STRIP block', () => {
    const index = createPickIndex();
    index.apply(frame(5, [...tri(0), [1, 1, 0]]));
    expect(index.stats.triangles).toBeGreaterThan(0);
    expect(index.stats.keys).toBe(1);
  });

  it('indexes a TRIANGLE_FAN block', () => {
    const index = createPickIndex();
    index.apply(frame(6, [...tri(0), [1, 1, 0]]));
    expect(index.stats.triangles).toBeGreaterThan(0);
  });

  it('indexes plain GL_TRIANGLES', () => {
    const index = createPickIndex();
    index.apply(frame(4, tri(0)));
    expect(index.stats.triangles).toBe(1);
  });

  it('ignores a LINES block, which is not face soup', () => {
    const index = createPickIndex();
    index.apply(frame(1, tri(0)));
    expect(index.stats.triangles).toBe(0);
    expect(index.stats.keys).toBe(0);
  });
});
