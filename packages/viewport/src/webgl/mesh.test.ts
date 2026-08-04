import { describe, expect, it } from 'vitest';

import { stripLineIndices, visibleTriangleIndices } from './mesh';

describe('stripLineIndices (RepMesh::N -> GL_LINES)', () => {
  it('turns a run of n vertices into n-1 segments', () => {
    expect(Array.from(stripLineIndices([4], 4))).toEqual([0, 1, 1, 2, 2, 3]);
  });

  it('walks consecutive runs without joining them', () => {
    // Two runs of 3: 0-1,1-2 then 3-4,4-5. There must be NO 2-3 segment.
    expect(Array.from(stripLineIndices([3, 3], 6))).toEqual([0, 1, 1, 2, 3, 4, 4, 5]);
  });

  it('drops a run that would overrun the vertex buffer', () => {
    expect(Array.from(stripLineIndices([3, 99], 3))).toEqual([0, 1, 1, 2]);
  });

  it('ignores degenerate runs of 0 or 1 vertices but still advances', () => {
    expect(Array.from(stripLineIndices([1, 3], 4))).toEqual([1, 2, 2, 3]);
  });

  it('is empty for an empty strip list', () => {
    expect(stripLineIndices([], 0)).toHaveLength(0);
  });
});

describe('visibleTriangleIndices (packages/engine/layer2/RepSurface.cpp:209-216)', () => {
  const index = new Int32Array([0, 1, 2, 1, 2, 3]);

  it('returns the original buffer when there is no visibility array', () => {
    const out = visibleTriangleIndices(index, null, false);
    expect(out.kept).toBe(2);
    expect(out.total).toBe(2);
  });

  it('AND-combines vertex visibility when proximity is off', () => {
    // vertex 3 invisible -> the second triangle goes.
    const out = visibleTriangleIndices(index, new Int32Array([1, 1, 1, 0]), false);
    expect(out.kept).toBe(1);
    expect(Array.from(out.index)).toEqual([0, 1, 2]);
  });

  it('OR-combines vertex visibility when proximity is on', () => {
    // (0,1,2) survives on vertex 0, (1,2,3) survives on vertex 3.
    expect(visibleTriangleIndices(index, new Int32Array([1, 0, 0, 1]), true).kept).toBe(2);
    // With AND, the same visibility keeps neither.
    expect(visibleTriangleIndices(index, new Int32Array([1, 0, 0, 1]), false).kept).toBe(0);
    // Proximity cannot rescue a triangle none of whose vertices are visible.
    expect(visibleTriangleIndices(index, new Int32Array([1, 0, 0, 0]), true).kept).toBe(1);
  });

  it('keeps nothing when every vertex is hidden', () => {
    const out = visibleTriangleIndices(index, new Int32Array([0, 0, 0, 0]), false);
    expect(out.kept).toBe(0);
    expect(out.index).toHaveLength(0);
  });
});
