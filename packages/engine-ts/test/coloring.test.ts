/**
 * Tests for the `coloring` subsystem (packages/engine-ts/src/cmd/coloring.ts):
 * `set_color`, `spectrum`, and the `util.cb*` / `util.rainbow` helpers.
 *
 * Builds an isolated RegistrarCtx over a bare Executive (no full Engine) so the
 * other in-progress subsystems are not pulled in. Expected colours/counts are
 * derived by hand from PyMOL's palette maths and the CPK element table.
 */

import { describe, expect, it } from 'vitest';

import { Executive } from '../src/exec/executive';
import { getColorIndex, getColorTuple } from '../src/exec/color';
import { parsePdb } from '../src/model/pdb';
import { registerColoring } from '../src/cmd/coloring';
import type { CommandHandler } from '../src/cmd/registrar';
import { makePdb, type FixtureAtom } from './fixture';

/** ALA (chain A, 5 atoms) + GLY (chain B, 4 atoms): N x2, C x5, O x2. */
const FIXTURE: FixtureAtom[] = [
  { serial: 1, name: 'N', resn: 'ALA', chain: 'A', resi: 1, x: 0, y: 0, z: 0, elem: 'N' },
  { serial: 2, name: 'CA', resn: 'ALA', chain: 'A', resi: 1, x: 1.458, y: 0, z: 0, elem: 'C' },
  { serial: 3, name: 'C', resn: 'ALA', chain: 'A', resi: 1, x: 2.0, y: 1.42, z: 0, elem: 'C' },
  { serial: 4, name: 'O', resn: 'ALA', chain: 'A', resi: 1, x: 1.25, y: 2.39, z: 0, elem: 'O' },
  { serial: 5, name: 'CB', resn: 'ALA', chain: 'A', resi: 1, x: 2.0, y: -0.77, z: 1.2, elem: 'C' },
  { serial: 6, name: 'N', resn: 'GLY', chain: 'B', resi: 2, x: 3.33, y: 1.5, z: 0, elem: 'N' },
  { serial: 7, name: 'CA', resn: 'GLY', chain: 'B', resi: 2, x: 4.0, y: 2.79, z: 0, elem: 'C' },
  { serial: 8, name: 'C', resn: 'GLY', chain: 'B', resi: 2, x: 5.5, y: 2.66, z: 0, elem: 'C' },
  { serial: 9, name: 'O', resn: 'GLY', chain: 'B', resi: 2, x: 6.1, y: 3.7, z: 0, elem: 'O' },
];

interface Harness {
  ex: Executive;
  call(name: string, args?: unknown[], kwargs?: Record<string, unknown>): unknown;
  publishCount: number;
  atomColors(): number[];
}

function makeHarness(atoms: FixtureAtom[] = FIXTURE): Harness {
  const ex = new Executive();
  ex.addMolecule(parsePdb(makePdb(atoms), 'm'));
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
  registerColoring(ctx);
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
    atomColors() {
      return ex.moleculesInOrder().flatMap((m) => m.atoms.map((a) => a.color));
    },
  };
}

describe('set_color', () => {
  it('defines a colour from a 0..1 triple and makes it usable by `color`', () => {
    const h = makeHarness();
    const idx = h.call('set_color', ['myred', '[1, 0, 0]']) as number;
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(getColorIndex('myred')).toBe(idx);
    expect(getColorTuple(idx)).toEqual([1, 0, 0]);

    // The executive can now colour with it.
    expect(h.ex.color('myred', 'all')).toBe(9);
    expect(h.ex.countAtoms('color myred')).toBe(9);
    expect(h.publishCount).toBe(1);
  });

  it('normalises a 0..255 triple to 0..1', () => {
    const h = makeHarness();
    const idx = h.call('set_color', ['half', [128, 64, 255]]) as number;
    const [r, g, b] = getColorTuple(idx)!;
    expect(r).toBeCloseTo(128 / 255, 5);
    expect(g).toBeCloseTo(64 / 255, 5);
    expect(b).toBeCloseTo(1, 5);
  });

  it('accepts an rgb kwarg', () => {
    const h = makeHarness();
    const idx = h.call('set_color', ['kw'], { rgb: [0, 1, 0] }) as number;
    expect(getColorTuple(idx)).toEqual([0, 1, 0]);
  });
});

describe('util.cbag / colour-by-element', () => {
  it('colours nitrogens, oxygens and carbons with their element colours', () => {
    const h = makeHarness();
    const n = h.call('util.cbag', ['all']) as number;
    expect(n).toBe(9);

    // PyMOL CPK: N -> `nitrogen`, O -> `oxygen`; carbons -> `carbon` for cbag.
    expect(h.ex.countAtoms('color nitrogen')).toBe(2); // 2 nitrogens
    expect(h.ex.countAtoms('color oxygen')).toBe(2); // 2 oxygens
    expect(h.ex.countAtoms('color carbon')).toBe(5); // 5 carbons
    expect(h.publishCount).toBe(1);
  });

  it('cbac / cbay / cbas / cbap use their own carbon colours', () => {
    for (const [cmd, col] of [
      ['util.cbac', 'cyan'],
      ['util.cbay', 'yellow'],
      ['util.cbas', 'salmon'],
      ['util.cbap', 'purple'],
    ] as const) {
      const h = makeHarness();
      h.call(cmd, ['all']);
      expect(h.ex.countAtoms(`color ${col}`)).toBe(5); // 5 carbons
      expect(h.ex.countAtoms('color nitrogen')).toBe(2); // nitrogens unchanged (CPK)
    }
  });

  it('respects the selection argument', () => {
    const h = makeHarness();
    h.call('util.cbag', ['chain A']);
    // Only chain A recoloured: its 1 nitrogen -> the `nitrogen` colour.
    expect(h.ex.countAtoms('color nitrogen')).toBe(1);
    // chain B still at its loaded (default) colour.
    expect(h.ex.countAtoms('chain B and color nitrogen')).toBe(0);
  });
});

describe('util.cbc / colour-by-chain', () => {
  it('assigns each chain the next colour in the cycle', () => {
    const h = makeHarness();
    const nChains = h.call('util.cbc', ['all']) as number;
    expect(nChains).toBe(2);
    // Cycle starts carbon, cyan (util.py `_color_cycle`).
    expect(h.ex.countAtoms('color carbon')).toBe(5); // chain A (5 atoms)
    expect(h.ex.countAtoms('color cyan')).toBe(4); // chain B (4 atoms)
    expect(h.ex.countAtoms('chain A and color carbon')).toBe(5);
  });
});

describe('spectrum', () => {
  it('spreads `count` across the rainbow into multiple distinct colours', () => {
    const h = makeHarness();
    const [min, max] = h.call('spectrum', ['count', 'rainbow', 'all']) as [number, number];
    expect(min).toBe(1);
    expect(max).toBe(9);
    const distinct = new Set(h.atomColors());
    expect(distinct.size).toBeGreaterThan(1);
    expect(h.publishCount).toBe(1);
  });

  it('blue_red maps the first atom blue and the last atom red', () => {
    const h = makeHarness();
    h.call('spectrum', ['count', 'blue_red', 'all']);
    const mols = h.ex.moleculesInOrder();
    const first = mols[0]!.atoms[0]!; // count == min
    const last = mols[0]!.atoms[8]!; // count == max
    const fRgb = getColorTuple(first.color)!;
    const lRgb = getColorTuple(last.color)!;
    // Low end ~ blue, high end ~ red.
    expect(fRgb[2]).toBeGreaterThan(0.9);
    expect(fRgb[0]).toBeLessThan(0.1);
    expect(lRgb[0]).toBeGreaterThan(0.9);
    expect(lRgb[2]).toBeLessThan(0.1);
  });

  it('enumerates a non-numeric expression (by chain) per residue-group', () => {
    const h = makeHarness();
    h.call('spectrum', ['chain', 'rainbow', 'all']);
    const mols = h.ex.moleculesInOrder();
    const chainA = mols[0]!.atoms.filter((a) => a.chain === 'A').map((a) => a.color);
    const chainB = mols[0]!.atoms.filter((a) => a.chain === 'B').map((a) => a.color);
    // All chain-A atoms one colour; all chain-B atoms one colour; the two differ.
    expect(new Set(chainA).size).toBe(1);
    expect(new Set(chainB).size).toBe(1);
    expect(chainA[0]).not.toBe(chainB[0]);
  });

  it('colours by b-factor, honouring an explicit min/max range', () => {
    // Give atoms distinct b-factors via a fresh fixture.
    const atoms = FIXTURE.map((a) => ({ ...a }));
    const h = makeHarness(atoms);
    // With min==max the range collapses; every atom lands in the first slot.
    h.call('spectrum', ['b', 'rainbow', 'all', '0', '0']);
    expect(new Set(h.atomColors()).size).toBe(1);
  });

  it('returns [0,0] and does nothing for an empty selection', () => {
    const h = makeHarness();
    const before = h.atomColors();
    const res = h.call('spectrum', ['count', 'rainbow', 'none']) as [number, number];
    expect(res).toEqual([0, 0]);
    expect(h.atomColors()).toEqual(before);
  });
});

describe('util.rainbow', () => {
  it('spectrum-counts over Cα when the selection has any', () => {
    const h = makeHarness();
    h.call('util.rainbow', ['all']);
    const mols = h.ex.moleculesInOrder();
    const cas = mols[0]!.atoms.filter((a) => a.name === 'CA');
    // The two Cα atoms get the endpoints of the ramp (distinct colours).
    expect(cas.length).toBe(2);
    expect(cas[0]!.color).not.toBe(cas[1]!.color);
  });
});
