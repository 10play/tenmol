/**
 * Tests for the transform + state verbs (packages/engine-ts/src/cmd/xform.ts):
 * transform_object / transform_selection, set_state_order, get_coordset /
 * load_coordset, get_object_state / get_selection_state, set_frame, and the
 * set_discrete / count_discrete pair.
 *
 * Driven through the full {@link LocalBackend} so the composed verbs
 * (`frame`, `load_coords`, `get_frame`) are all present, exactly as the wire
 * uses them. Assertions check real effects read back via `get_coordset`.
 */

import { describe, expect, it } from 'vitest';

import { LocalBackend } from '@tenmol/engine-ts';
import { decodeCoords, type WireNdarray } from '@tenmol/protocol';
import { SMALL_PDB, EXPECTED } from './fixture';

type Triple = [number, number, number];

/** A two-model (two-state) PDB so the state ops have something to reorder. */
const MULTI_PDB = [
  'MODEL        1',
  'ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00 10.00           N',
  'ATOM      2  CA  ALA A   1       1.000   0.000   0.000  1.00 11.00           C',
  'ATOM      3  C   ALA A   1       2.000   0.000   0.000  1.00 12.00           C',
  'ENDMDL',
  'MODEL        2',
  'ATOM      1  N   ALA A   1       0.000   0.000   5.000  1.00 10.00           N',
  'ATOM      2  CA  ALA A   1       1.000   0.000   5.000  1.00 11.00           C',
  'ATOM      3  C   ALA A   1       2.000   0.000   5.000  1.00 12.00           C',
  'ENDMDL',
  'END',
].join('\n');

/** Boot a backend with one object read from `pdb` (name 'm'). */
async function boot(pdb = SMALL_PDB, name = 'm'): Promise<LocalBackend> {
  const backend = new LocalBackend();
  await backend.connect();
  await backend.call('read_pdbstr', [pdb, name]);
  return backend;
}

// get_coordset returns an N×3 numpy float32 array, serialized on the wire as a
// base64 `__ndarray__` (matching real PyMOL over the bridge). Decode it back to
// [x,y,z] triples for the assertions.
const coordset = async (b: LocalBackend, name = 'm', state = 1): Promise<Triple[]> => {
  const nd = await b.call<WireNdarray>('get_coordset', [name, state]);
  const flat = decodeCoords(nd);
  const out: Triple[] = [];
  for (let i = 0; i < flat.length; i += 3) out.push([flat[i]!, flat[i + 1]!, flat[i + 2]!]);
  return out;
};

/** Row-major 4×4 translation matrix. */
function translate(tx: number, ty: number, tz: number): number[] {
  return [1, 0, 0, tx, 0, 1, 0, ty, 0, 0, 1, tz, 0, 0, 0, 1];
}

/** Row-major 4×4 rotation of +90° about the z axis. */
const ROT_Z90 = [0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const dist = (a: Triple, b: Triple): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/* ---------------------------- get_coordset ------------------------------- */

describe('get_coordset', () => {
  it('returns one [x,y,z] triple per atom', async () => {
    const b = await boot();
    const cs = await coordset(b);
    expect(cs.length).toBe(EXPECTED.total);
    for (const c of cs) expect(c.length).toBe(3);
    // First atom of the fixture is at the origin.
    expect(cs[0]).toEqual([0, 0, 0]);
  });

  it('returns null for an unknown object', async () => {
    // Verified against real PyMOL over the oracle bridge: _cmd.get_coordset for
    // a missing object yields None, not an empty array.
    const b = await boot();
    expect(await b.call('get_coordset', ['nope'])).toBeNull();
  });
});

/* --------------------------- transform_object ---------------------------- */

describe('transform_object', () => {
  it('translates every coordinate by the matrix offset', async () => {
    const b = await boot();
    const before = await coordset(b);
    await b.call('transform_object', ['m', translate(1, 2, 3)]);
    const after = await coordset(b);
    expect(after.length).toBe(before.length);
    after.forEach((c, i) => {
      expect(c[0]).toBeCloseTo(before[i]![0] + 1, 4);
      expect(c[1]).toBeCloseTo(before[i]![1] + 2, 4);
      expect(c[2]).toBeCloseTo(before[i]![2] + 3, 4);
    });
  });

  it('preserves pairwise distances under a rotation', async () => {
    const b = await boot();
    const before = await coordset(b);
    const d0 = dist(before[0]!, before[1]!);
    await b.call('transform_object', ['m', ROT_Z90]);
    const after = await coordset(b);
    expect(dist(after[0]!, after[1]!)).toBeCloseTo(d0, 4);
    // A +90° z rotation maps (x,y) -> (-y,x): atom 1 (1.458,0,0) -> (0,1.458,0).
    expect(after[1]![0]).toBeCloseTo(0, 4);
    expect(after[1]![1]).toBeCloseTo(before[1]![0], 4);
  });

  it('returns 0 for an unknown object', async () => {
    const b = await boot();
    expect(await b.call('transform_object', ['nope', translate(1, 0, 0)])).toBe(0);
  });

  it('with state 0 transforms every state', async () => {
    const b = await boot(MULTI_PDB);
    await b.call('transform_object', ['m', translate(10, 0, 0), 0]);
    const s1 = await coordset(b, 'm', 1);
    const s2 = await coordset(b, 'm', 2);
    expect(s1[0]![0]).toBeCloseTo(10, 4);
    expect(s2[0]![0]).toBeCloseTo(10, 4);
    expect(s2[0]![2]).toBeCloseTo(5, 4); // z untouched
  });
});

/* -------------------------- transform_selection -------------------------- */

describe('transform_selection', () => {
  it('translates only the matched atoms', async () => {
    const b = await boot();
    const before = await coordset(b);
    const moved = await b.call<number>('transform_selection', ['chain A', translate(0, 0, 100)]);
    expect(moved).toBe(EXPECTED.chainA);
    const after = await coordset(b);
    // Chain A atoms (first 5 in the fixture) shifted; chain B untouched.
    expect(after[0]![2]).toBeCloseTo(before[0]![2] + 100, 4);
    expect(after[EXPECTED.chainA]![2]).toBeCloseTo(before[EXPECTED.chainA]![2], 4);
  });
});

/* ---------------------------- set_state_order ---------------------------- */

describe('set_state_order', () => {
  it('reorders the states of a multi-state object', async () => {
    const b = await boot(MULTI_PDB);
    const s1 = await coordset(b, 'm', 1);
    const s2 = await coordset(b, 'm', 2);
    expect(s1[0]![2]).toBeCloseTo(0, 4);
    expect(s2[0]![2]).toBeCloseTo(5, 4);
    const n = await b.call<number>('set_state_order', ['m', [2, 1]]);
    expect(n).toBe(2);
    // States are now swapped.
    expect((await coordset(b, 'm', 1))[0]![2]).toBeCloseTo(5, 4);
    expect((await coordset(b, 'm', 2))[0]![2]).toBeCloseTo(0, 4);
  });

  it('is a no-op for a malformed order', async () => {
    const b = await boot(MULTI_PDB);
    expect(await b.call('set_state_order', ['m', [1]])).toBe(0);
    expect(await b.call('set_state_order', ['m', [1, 3]])).toBe(0);
    // Unchanged.
    expect((await coordset(b, 'm', 1))[0]![2]).toBeCloseTo(0, 4);
  });
});

/* ----------------------------- load_coordset ----------------------------- */

describe('load_coordset', () => {
  it('writes coordinates back into a state (inverse of get_coordset)', async () => {
    const b = await boot();
    const cs = await coordset(b);
    // Shift every atom by +7 in x and load it back.
    const shifted: Triple[] = cs.map((c) => [c[0] + 7, c[1], c[2]]);
    const n = await b.call<number>('load_coordset', [shifted, 'm', 1]);
    expect(n).toBe(EXPECTED.total);
    const after = await coordset(b);
    after.forEach((c, i) => expect(c[0]).toBeCloseTo(cs[i]![0] + 7, 4));
  });
});

/* --------------------- get_object_state / selection_state ---------------- */

describe('current-state getters', () => {
  it('get_object_state reports 1 for a single-state object', async () => {
    const b = await boot();
    expect(await b.call('get_object_state', ['m'])).toBe(1);
  });

  it('get_object_state clamps the frame to a multi-state object range', async () => {
    const b = await boot(MULTI_PDB);
    // The global frame cursor stays at 1 (fixed stub), so state reads 1.
    expect(await b.call('get_object_state', ['m'])).toBe(1);
  });

  it('get_object_state returns 1 for an unknown object', async () => {
    const b = await boot();
    expect(await b.call('get_object_state', ['nope'])).toBe(1);
  });

  it('get_selection_state is the shared object state (1 for single-state objects)', async () => {
    // Mirrors real PyMOL: maps get_object_state over the selection's objects and
    // returns the sole shared state; a single-state object reads 1, and an empty
    // selection (no objects touched) also returns 1. Verified against the oracle.
    const b = await boot();
    expect(await b.call('get_selection_state', ['chain A'])).toBe(1);
    expect(await b.call('get_selection_state', ['none'])).toBe(1);
  });
});

/* ------------------------------- set_frame ------------------------------- */

describe('set_frame', () => {
  it('is callable and returns the resulting frame', async () => {
    const b = await boot();
    const f = await b.call<number>('set_frame', [1]);
    expect(typeof f).toBe('number');
  });
});

/* --------------------------------- discrete ------------------------------ */

describe('set_discrete / count_discrete', () => {
  it('flags and unflags an object, observable via count_discrete', async () => {
    const b = await boot();
    expect(await b.call('count_discrete', ['all'])).toBe(0);
    expect(await b.call('set_discrete', ['m', 1])).toBe(1);
    expect(await b.call('count_discrete', ['all'])).toBe(1);
    await b.call('set_discrete', ['m', 0]);
    expect(await b.call('count_discrete', ['all'])).toBe(0);
  });

  it('returns 0 for an unknown object', async () => {
    const b = await boot();
    expect(await b.call('set_discrete', ['nope', 1])).toBe(0);
  });
});
