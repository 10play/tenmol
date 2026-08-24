/**
 * Tests for the `ramps` subsystem (packages/engine-ts/src/cmd/ramps.ts):
 * `ramp_new`, `ramp_color`, `ramp_update`, `gradient`, `volume_ramp_new` /
 * `volume_color` / `volume_ramp_color`, and `color_by_ramp`.
 *
 * Builds an isolated RegistrarCtx over a bare Executive (no full Engine). The
 * expected colours are derived by hand from linear interpolation between the
 * ramp breakpoints, exactly what PyMOL's ObjectGadgetRamp produces.
 */

import { describe, expect, it } from 'vitest';

import { Executive } from '../src/exec/executive';
import { getColorTuple } from '../src/exec/color';
import { parsePdb } from '../src/model/pdb';
import { registerRamps } from '../src/cmd/ramps';
import type { CommandHandler } from '../src/cmd/registrar';
import { makePdb, FIXTURE_ATOMS } from './fixture';

interface Harness {
  ex: Executive;
  call(name: string, args?: unknown[], kwargs?: Record<string, unknown>): unknown;
  publishCount: number;
}

function makeHarness(): Harness {
  const ex = new Executive();
  ex.addMolecule(parsePdb(makePdb(FIXTURE_ATOMS), 'm'));
  const handlers = new Map<string, CommandHandler>();
  const state = { publishCount: 0 };
  const ctx = {
    command: (n: string, f: CommandHandler) => handlers.set(n, f),
    executive: ex,
    publish() {
      state.publishCount++;
    },
    emitView() {},
    str: (v: unknown, d = '') => (v == null ? d : String(v)),
  };
  registerRamps(ctx);
  return {
    ex,
    call(name, args = [], kwargs = {}) {
      const h = handlers.get(name);
      if (!h) throw new Error(`no handler ${name}`);
      return h(args, kwargs);
    },
    get publishCount() {
      return state.publishCount;
    },
  };
}

const rgb = (v: unknown): [number, number, number] => v as [number, number, number];

describe('ramp_new / ramp_color', () => {
  it('defines a blue→white→red ramp over [0,50,100] and interpolates linearly', () => {
    const h = makeHarness();
    // ramp_new returns None (matches the real-PyMOL oracle), not the ramp name.
    expect(h.call('ramp_new', ['r1', 'map1', [0, 50, 100], ['blue', 'white', 'red']])).toBeNull();

    // 25 is halfway from blue [0,0,1] to white [1,1,1] -> [0.5, 0.5, 1].
    const c25 = rgb(h.call('ramp_color', ['r1', 25]));
    expect(c25[0]).toBeCloseTo(0.5, 6);
    expect(c25[1]).toBeCloseTo(0.5, 6);
    expect(c25[2]).toBeCloseTo(1.0, 6);

    // 50 lands exactly on the middle breakpoint -> white.
    const c50 = rgb(h.call('ramp_color', ['r1', 50]));
    expect(c50).toEqual([1, 1, 1]);

    // 75 is halfway from white [1,1,1] to red [1,0,0] -> [1, 0.5, 0.5].
    const c75 = rgb(h.call('ramp_color', ['r1', 75]));
    expect(c75[0]).toBeCloseTo(1.0, 6);
    expect(c75[1]).toBeCloseTo(0.5, 6);
    expect(c75[2]).toBeCloseTo(0.5, 6);
  });

  it('clamps to the end colours outside the range', () => {
    const h = makeHarness();
    h.call('ramp_new', ['r2', 'map1', [0, 50, 100], ['blue', 'white', 'red']]);

    expect(rgb(h.call('ramp_color', ['r2', -20]))).toEqual([0, 0, 1]); // below -> blue
    expect(rgb(h.call('ramp_color', ['r2', 0]))).toEqual([0, 0, 1]); // low end -> blue
    expect(rgb(h.call('ramp_color', ['r2', 100]))).toEqual([1, 0, 0]); // high end -> red
    expect(rgb(h.call('ramp_color', ['r2', 250]))).toEqual([1, 0, 0]); // above -> red
  });

  it('accepts explicit [r,g,b] triples as colours', () => {
    const h = makeHarness();
    h.call('ramp_new', ['r3', 'map1', [0, 10], [[0, 0, 0], [1, 1, 1]]]);
    const mid = rgb(h.call('ramp_color', ['r3', 5]));
    expect(mid[0]).toBeCloseTo(0.5, 6);
    expect(mid[1]).toBeCloseTo(0.5, 6);
    expect(mid[2]).toBeCloseTo(0.5, 6);
  });

  it('returns the sentinel grey for an unknown ramp', () => {
    const h = makeHarness();
    expect(rgb(h.call('ramp_color', ['nope', 5]))).toEqual([0.5, 0.5, 0.5]);
  });
});

describe('ramp_update', () => {
  it('replaces the range and colours of an existing ramp', () => {
    const h = makeHarness();
    h.call('ramp_new', ['ru', 'map1', [0, 100], ['blue', 'red']]);
    // Before update: 50 is the midpoint blue->red -> [0.5, 0, 0.5].
    const before = rgb(h.call('ramp_color', ['ru', 50]));
    expect(before[0]).toBeCloseTo(0.5, 6);
    expect(before[2]).toBeCloseTo(0.5, 6);

    // Update to green->yellow over [0,10]: 5 -> [0.5, 1, 0].
    h.call('ramp_update', ['ru', [0, 10], ['green', 'yellow']]);
    const after = rgb(h.call('ramp_color', ['ru', 5]));
    expect(after[0]).toBeCloseTo(0.5, 6);
    expect(after[1]).toBeCloseTo(1.0, 6);
    expect(after[2]).toBeCloseTo(0.0, 6);
  });
});

describe('gradient', () => {
  it('stores a gradient like a ramp readable via ramp_color', () => {
    const h = makeHarness();
    h.call('gradient', ['g1', 'map1', [0, 50, 100], ['blue', 'white', 'red']]);
    const c25 = rgb(h.call('ramp_color', ['g1', 25]));
    expect(c25[0]).toBeCloseTo(0.5, 6);
    expect(c25[2]).toBeCloseTo(1.0, 6);
  });

  it('defaults to a blue→white→red ramp when no colours are given', () => {
    const h = makeHarness();
    h.call('gradient', ['g2', 'map1']);
    // Default range [0,0.5,1]; value 0.25 halfway blue->white.
    const c = rgb(h.call('ramp_color', ['g2', 0.25]));
    expect(c[0]).toBeCloseTo(0.5, 6);
    expect(c[1]).toBeCloseTo(0.5, 6);
    expect(c[2]).toBeCloseTo(1.0, 6);
  });
});

describe('volume ramps (RGBA)', () => {
  it('interpolates a value->RGBA map and clamps at the ends', () => {
    const h = makeHarness();
    // Flat quintuples (value, r, g, b, alpha).
    h.call('volume_ramp_new', ['v1', [0, 0, 0, 1, 0, 100, 1, 0, 0, 1]]);

    // Midpoint: colour blue->red halfway, alpha 0->1 halfway.
    const mid = h.call('volume_ramp_color', ['v1', 50]) as number[];
    expect(mid[0]).toBeCloseTo(0.5, 6);
    expect(mid[1]).toBeCloseTo(0.0, 6);
    expect(mid[2]).toBeCloseTo(0.5, 6);
    expect(mid[3]).toBeCloseTo(0.5, 6);

    // Endpoints clamp (RGBA).
    expect(h.call('volume_ramp_color', ['v1', -5])).toEqual([0, 0, 1, 0]);
    expect(h.call('volume_ramp_color', ['v1', 999])).toEqual([1, 0, 0, 1]);
  });

  it('volume_color stores an equivalent RGBA ramp', () => {
    const h = makeHarness();
    h.call('volume_color', ['v2', [0, 1, 1, 1, 0.2, 10, 0, 0, 0, 0.8]]);
    const mid = h.call('volume_ramp_color', ['v2', 5]) as number[];
    expect(mid[0]).toBeCloseTo(0.5, 6);
    expect(mid[3]).toBeCloseTo(0.5, 6);
  });

  it('returns transparent black for an unknown volume ramp', () => {
    const h = makeHarness();
    expect(h.call('volume_ramp_color', ['none', 5])).toEqual([0, 0, 0, 0]);
  });
});

describe('color_by_ramp', () => {
  it('colours atoms by b-factor through the ramp and assigns the ramp colours', () => {
    const h = makeHarness();
    // Assign distinct b-factors: 0, 50, 100 across the atoms.
    const atoms = h.ex.molecule('m')!.atoms;
    atoms[0]!.b = 0; // blue end
    atoms[1]!.b = 50; // white middle
    atoms[2]!.b = 100; // red end
    for (let i = 3; i < atoms.length; i++) atoms[i]!.b = 100;

    h.call('ramp_new', ['cbr', 'map1', [0, 50, 100], ['blue', 'white', 'red']]);
    const n = h.call('color_by_ramp', ['cbr', 'b', 'all']) as number;
    expect(n).toBe(9);

    // b=0 -> blue, b=50 -> white, b=100 -> red.
    expect(getColorTuple(atoms[0]!.color)).toEqual([0, 0, 1]);
    expect(getColorTuple(atoms[1]!.color)).toEqual([1, 1, 1]);
    expect(getColorTuple(atoms[2]!.color)).toEqual([1, 0, 0]);

    // Atoms sharing a b-factor share the colour index (one colour per value).
    expect(atoms[2]!.color).toBe(atoms[3]!.color);
    // The two ends differ.
    expect(atoms[0]!.color).not.toBe(atoms[2]!.color);
    expect(h.publishCount).toBeGreaterThan(0);
  });

  it('colours by occupancy (q) when asked, and returns 0 for an unknown ramp', () => {
    const h = makeHarness();
    const atoms = h.ex.molecule('m')!.atoms;
    atoms[0]!.q = 0;
    atoms[1]!.q = 100;

    h.call('ramp_new', ['cbq', 'map1', [0, 100], ['blue', 'red']]);
    const n = h.call('color_by_ramp', ['cbq', 'q', 'all']) as number;
    expect(n).toBe(9);
    expect(getColorTuple(atoms[0]!.color)).toEqual([0, 0, 1]);
    expect(getColorTuple(atoms[1]!.color)).toEqual([1, 0, 0]);

    expect(h.call('color_by_ramp', ['missing', 'b', 'all'])).toBe(0);
  });
});
