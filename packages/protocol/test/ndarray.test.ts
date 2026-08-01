import { describe, expect, it } from 'vitest';

import {
  UnsupportedDtype,
  decodeCoords,
  decodeNdarray,
  isWireNdarray,
  type WireNdarray,
} from '../src/ndarray';

function wire(values: number[], shape: number[], dtype = 'float32'): WireNdarray {
  const typed =
    dtype === 'float64' ? new Float64Array(values) : new Float32Array(values);
  const bytes = new Uint8Array(typed.buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return { __ndarray__: true, shape, dtype, encoding: 'base64', data: btoa(binary) };
}

describe('decodeNdarray', () => {
  it('round-trips the coordinate shape the bridge sends', () => {
    const decoded = decodeNdarray(wire([1, 2, 3, 4, 5, 6], [2, 3]));
    expect(Array.from(decoded.data as unknown as Float32Array)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(decoded.shape).toEqual([2, 3]);
  });

  it('throws on an unknown dtype instead of guessing a width', () => {
    /*
     * Reading float64 data through a Float32Array produces numbers rather than
     * an error, and every one of them is wrong — silently. So an unknown dtype
     * has to be loud.
     */
    expect(() => decodeNdarray({ ...wire([1], [1]), dtype: 'float16' })).toThrow(
      UnsupportedDtype,
    );
  });

  it('catches a payload that does not match its own shape', () => {
    expect(() => decodeNdarray({ ...wire([1, 2, 3], [3]), shape: [4] })).toThrow(/needs 4/);
  });

  it('handles float64 as well as float32', () => {
    const decoded = decodeNdarray(wire([1.5, 2.5], [2], 'float64'));
    expect(Array.from(decoded.data as unknown as Float64Array)).toEqual([1.5, 2.5]);
  });
});

describe('decodeCoords', () => {
  it('accepts an [n,3] array', () => {
    expect(Array.from(decodeCoords(wire([0, 0, 0, 1, 1, 1], [2, 3])))).toEqual([
      0, 0, 0, 1, 1, 1,
    ]);
  });

  it('refuses anything that is not [n,3]', () => {
    // A caller that assumed triples from a flat array would read every third
    // number as an x, which looks like a scrambled structure rather than a bug.
    expect(() => decodeCoords(wire([1, 2, 3], [3]))).toThrow(/\[n,3\]/);
    expect(() => decodeCoords(wire([1, 2, 3, 4], [2, 2]))).toThrow(/\[n,3\]/);
  });
});

describe('isWireNdarray', () => {
  it('recognises the envelope and rejects look-alikes', () => {
    expect(isWireNdarray(wire([1], [1]))).toBe(true);
    expect(isWireNdarray({ __ndarray__: true })).toBe(false);
    expect(isWireNdarray({ data: 'abc' })).toBe(false);
    expect(isWireNdarray(null)).toBe(false);
  });
});
