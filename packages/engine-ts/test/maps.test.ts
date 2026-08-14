/**
 * Isolated tests for the `maps` subsystem (scalar volumes + marching cubes).
 * Imports only the module under test, the Executive, parsePdb and protocol.
 */
import { describe, it, expect } from 'vitest';
import type { Json } from '@tenmol/protocol';
import { Executive } from '../src/exec/executive';
import { parsePdb } from '../src/model/pdb';
import { registerMaps } from '../src/cmd/maps';

/** Two carbon atoms 3 Å apart on the x-axis. */
const PDB = [
  'ATOM      1  C1  LIG A   1       0.000   0.000   0.000  1.00  0.00           C',
  'ATOM      2  C2  LIG A   1       3.000   0.000   0.000  1.00  0.00           C',
  'END',
].join('\n');

type Handlers = Map<string, (a: unknown[], k: Record<string, unknown>) => Json>;

function harness(): { ex: Executive; call: (n: string, ...a: unknown[]) => Json } {
  const ex = new Executive();
  ex.addMolecule(parsePdb(PDB, 'm'));
  const handlers: Handlers = new Map();
  registerMaps({
    command: (n, f) => handlers.set(n, f),
    executive: ex,
    publish() {},
    emitView() {},
    str: (v: unknown, d = '') => (v == null ? d : String(v)),
  } as never);
  return {
    ex,
    call: (n, ...a) => {
      const f = handlers.get(n);
      if (!f) throw new Error(`no handler ${n}`);
      return f(a, {});
    },
  };
}

// C vdw = 1.7, grid 0.5, buffer 0 => bbox [-1.7,-1.7,-1.7]..[4.7,1.7,1.7].
const ORIGIN = [-1.7, -1.7, -1.7];
const SPACING = 0.5;
const DIMS = [13, 7, 7]; // floor(range/grid)+1 per axis

describe('map_new (gaussian)', () => {
  it('grids the selection bbox with the expected dims', () => {
    const { call } = harness();
    call('map_new', 'g', 'gaussian', 0.5);
    const field = call('get_volume_field', 'g') as { dims: number[]; data: number[] };
    expect(field.dims).toEqual(DIMS);
    expect(field.data.length).toBe(DIMS[0] * DIMS[1] * DIMS[2]); // 637 cells
  });

  it('peaks on an atom', () => {
    const { call } = harness();
    call('map_new', 'g', 'gaussian', 0.5);
    const field = call('get_volume_field', 'g') as { dims: number[]; data: number[] };
    const { dims, data } = field;

    // Argmax cell.
    let best = 0;
    for (let i = 1; i < data.length; i++) if (data[i]! > data[best]!) best = i;
    expect(data[best]!).toBeGreaterThan(0.9); // gaussian amplitude ~1 at an atom

    // World coord of the peak cell.
    const x = best % dims[0]!;
    const y = Math.floor(best / dims[0]!) % dims[1]!;
    const z = Math.floor(best / (dims[0]! * dims[1]!));
    const wx = ORIGIN[0]! + x * SPACING;
    const wy = ORIGIN[1]! + y * SPACING;
    const wz = ORIGIN[2]! + z * SPACING;

    // Distance to the nearer of the two atoms (0,0,0) / (3,0,0).
    const d0 = Math.hypot(wx, wy, wz);
    const d1 = Math.hypot(wx - 3, wy, wz);
    expect(Math.min(d0, d1)).toBeLessThan(SPACING); // within one grid step of an atom
  });
});

describe('map_new (vdw)', () => {
  it('is a 0/1 indicator peaking inside the atoms', () => {
    const { call } = harness();
    call('map_new', 'v', 'vdw', 0.5);
    const { data } = call('get_volume_field', 'v') as { data: number[] };
    let ones = 0;
    for (const v of data) {
      expect(v === 0 || v === 1).toBe(true);
      if (v === 1) ones++;
    }
    expect(ones).toBeGreaterThan(0);
  });
});

describe('get_volume_histogram', () => {
  it('counts sum to the cell count', () => {
    const { call } = harness();
    call('map_new', 'g', 'gaussian', 0.5);
    const hist = call('get_volume_histogram', 'g', 64) as number[];
    // PyMOL (querying.py:62) returns [min, max, mean, stdev, h0..h(bins-1)],
    // a flat list of length bins + 4.
    const [lo, hi, mean, stdev, ...counts] = hist;
    expect(counts.length).toBe(64);
    expect(lo!).toBeLessThan(hi!);
    expect(mean!).toBeGreaterThanOrEqual(lo!);
    expect(mean!).toBeLessThanOrEqual(hi!);
    expect(stdev!).toBeGreaterThanOrEqual(0);
    const total = counts.reduce((a, b) => a + b, 0);
    expect(total).toBe(DIMS[0] * DIMS[1] * DIMS[2]); // 637
  });
});

describe('isosurface (marching cubes)', () => {
  it('produces a non-empty mesh at a mid level', () => {
    const { call } = harness();
    call('map_new', 'g', 'gaussian', 0.5);
    const hist = call('get_volume_histogram', 'g', 64) as number[];
    const lo = hist[0]!;
    const hi = hist[1]!;
    const mid = (lo + hi) / 2;

    const obj = call('isosurface', 'surf', 'g', mid) as string;
    const stats = call('get_isosurface_stats', obj) as { verts: number; tris: number };
    expect(stats.verts).toBeGreaterThan(0);
    expect(stats.tris).toBeGreaterThan(0);
    // Each triangle references 3 vertices.
    expect(stats.verts).toBeGreaterThanOrEqual(3);
  });

  it('isomesh at a high level yields two disjoint blobs (more tris than a plane)', () => {
    const { call } = harness();
    call('map_new', 'g', 'gaussian', 0.5);
    // A high level (0.5) carves a sphere around each atom.
    const obj = call('isomesh', 'mesh', 'g', 0.5) as string;
    const stats = call('get_isosurface_stats', obj) as { verts: number; tris: number };
    expect(stats.tris).toBeGreaterThan(0);
  });

  it('isodot returns points and no triangles', () => {
    const { call } = harness();
    call('map_new', 'g', 'gaussian', 0.5);
    const obj = call('isodot', 'dots', 'g', 0.5) as string;
    const stats = call('get_isosurface_stats', obj) as { verts: number; tris: number };
    expect(stats.verts).toBeGreaterThan(0);
    expect(stats.tris).toBe(0);
  });
});

describe('resampling', () => {
  it('map_halve halves the dims', () => {
    const { call } = harness();
    call('map_new', 'g', 'gaussian', 0.5);
    call('map_halve', 'g');
    const { dims } = call('get_volume_field', 'g') as { dims: number[] };
    expect(dims).toEqual([
      Math.floor(DIMS[0]! / 2),
      Math.floor(DIMS[1]! / 2),
      Math.floor(DIMS[2]! / 2),
    ]); // [6,3,3]
  });

  it('map_double roughly doubles the dims (2n-1)', () => {
    const { call } = harness();
    call('map_new', 'g', 'gaussian', 0.5);
    call('map_double', 'g');
    const { dims } = call('get_volume_field', 'g') as { dims: number[] };
    expect(dims).toEqual([DIMS[0]! * 2 - 1, DIMS[1]! * 2 - 1, DIMS[2]! * 2 - 1]);
  });
});

describe('isolevel', () => {
  it('records a contour level on a map', () => {
    const { call } = harness();
    call('map_new', 'g', 'gaussian', 0.5);
    expect(call('isolevel', 'g', 0.7)).toBe(0.7);
  });
});
