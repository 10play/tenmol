import { describe, expect, it } from 'vitest';

import { Executive } from '../src/exec/executive';
import { parsePdb } from '../src/model/pdb';
import { registerSculpt } from '../src/cmd/sculpt';
import type { CommandHandler } from '../src/cmd/registrar';

/* --------------------------- PDB fixture builder ------------------------- */

function atomLine(
  serial: number,
  name: string,
  elem: string,
  x: number,
  y: number,
  z: number,
): string {
  const buf = ' '.repeat(80).split('');
  const put = (start: number, s: string): void => {
    for (let i = 0; i < s.length; i++) buf[start - 1 + i] = s[i]!;
  };
  put(1, 'ATOM');
  put(7, serial.toString().padStart(5));
  put(name.length >= 4 ? 13 : 14, name);
  put(18, 'LIG');
  put(22, 'A');
  put(23, '1'.padStart(4));
  put(31, x.toFixed(3).padStart(8));
  put(39, y.toFixed(3).padStart(8));
  put(47, z.toFixed(3).padStart(8));
  put(55, '1.00');
  put(61, '0.00');
  put(77, elem.padStart(2));
  return buf.join('').replace(/\s+$/, '');
}

function conect(a: number, b: number): string {
  return `CONECT${a.toString().padStart(5)}${b.toString().padStart(5)}`;
}

/* A bent triatomic C1-C2-C3: both bonds 1.5 Å, apex angle 90°, no clashes. */
function bentPdb(c1: [number, number, number]): string {
  return [
    atomLine(1, 'C1', 'C', c1[0], c1[1], c1[2]),
    atomLine(2, 'C2', 'C', 1.5, 0, 0),
    atomLine(3, 'C3', 'C', 1.5, 1.5, 0),
    conect(1, 2),
    conect(2, 3),
  ].join('\n');
}

/* ------------------------------ harness -------------------------------- */

function setup(pdb: string) {
  const ex = new Executive();
  ex.addMolecule(parsePdb(pdb, 'm'));
  const handlers = new Map<string, CommandHandler>();
  let publishes = 0;
  const ctx = {
    command: (n: string, f: CommandHandler) => handlers.set(n, f),
    executive: ex,
    publish() {
      publishes++;
    },
    emitView() {},
    str: (v: unknown, d = '') => (v == null ? d : String(v)),
  };
  registerSculpt(ctx);
  return {
    ex,
    mol: () => ex.molecule('m')!,
    call: (name: string, args: unknown[], kw: Record<string, unknown> = {}) =>
      handlers.get(name)!(args, kw),
    publishes: () => publishes,
  };
}

const bondLen = (
  t: ReturnType<typeof setup>,
  i: number,
  j: number,
  state = 1,
): number => {
  const a = t.mol().coord(i, state);
  const b = t.mol().coord(j, state);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
};

/* -------------------------------- tests -------------------------------- */

describe('sculpt_activate + sculpt_iterate', () => {
  it('reduces a stretched bond and lowers the energy monotonically', () => {
    const t = setup(bentPdb([0, 0, 0]));
    // Snapshot the ideal geometry (r0 = current 1.5 Å bonds, 90° angle).
    t.call('sculpt_activate', ['m']);

    // Stretch the C1-C2 bond by 50%: move C1 from (0,0,0) to (-0.75,0,0).
    const st = t.mol().states[0]!;
    st[0] = -0.75;
    expect(bondLen(t, 0, 1)).toBeCloseTo(2.25, 5);

    // Iterate in chunks; the returned energy must strictly decrease.
    const energies: number[] = [];
    for (let n = 0; n < 10; n++) {
      energies.push(t.call('sculpt_iterate', ['m', 0, 40]) as number);
    }
    // Backtracking descent never raises the energy (up to float noise once the
    // geometry is fully relaxed), and the overall drop is large.
    for (let n = 1; n < energies.length; n++) {
      expect(energies[n]!).toBeLessThanOrEqual(energies[n - 1]! + 1e-9);
    }
    expect(energies[energies.length - 1]!).toBeLessThan(energies[0]! * 0.5);
    // The bond has relaxed back toward its 1.5 Å equilibrium.
    expect(bondLen(t, 0, 1)).toBeLessThan(2.25);
    expect(Math.abs(bondLen(t, 0, 1) - 1.5)).toBeLessThan(0.1);
    expect(t.publishes()).toBe(10);
  });

  it('leaves an already-ideal geometry untouched (energy ~0)', () => {
    const t = setup(bentPdb([0, 0, 0]));
    const before = [t.mol().coord(0, 1), t.mol().coord(1, 1), t.mol().coord(2, 1)];
    t.call('sculpt_activate', ['m']);
    const E = t.call('sculpt_iterate', ['m', 0, 50]) as number;
    expect(E).toBeLessThan(1e-6);
    for (let i = 0; i < 3; i++) {
      const after = t.mol().coord(i, 1);
      for (let k = 0; k < 3; k++) {
        expect(Math.abs(after[k]! - before[i]![k]!)).toBeLessThan(1e-4);
      }
    }
  });

  it('sculpt_iterate returns 0 for an object with no active restraints', () => {
    const t = setup(bentPdb([0, 0, 0]));
    expect(t.call('sculpt_iterate', ['m', 0, 5])).toBe(0);
  });
});

describe('sculpt_deactivate / sculpt_purge', () => {
  it('deactivate drops restraints so iterate becomes a no-op', () => {
    const t = setup(bentPdb([0, 0, 0]));
    t.call('sculpt_activate', ['m']);
    expect(t.call('sculpt_deactivate', ['m'])).toBe(1);
    expect(t.call('sculpt_iterate', ['m', 0, 5])).toBe(0);
  });

  it('purge clears every object', () => {
    const t = setup(bentPdb([0, 0, 0]));
    t.call('sculpt_activate', ['m']);
    t.call('sculpt_purge', []);
    expect(t.call('sculpt_iterate', ['m', 0, 5])).toBe(0);
  });
});

describe('minimize / clean', () => {
  it('minimize is a no-op stub (matches upstream): coords unchanged', () => {
    // Upstream `minimize` routes to chempy.tinker.realtime, which is absent
    // from open-source PyMOL, so the command leaves coordinates untouched.
    // Verified against the real-PyMOL oracle: `fragment ala; minimize ala`
    // leaves the deposited bond lengths (e.g. N-CA 1.4599, C-O 1.2368) intact
    // rather than idealising them toward covalent-radius sums.
    const pdb = [
      atomLine(1, 'C1', 'C', 0, 0, 0),
      atomLine(2, 'C2', 'C', 1.9, 0, 0),
      atomLine(3, 'C3', 'C', 1.9, 1.9, 0),
      conect(1, 2),
      conect(2, 3),
    ].join('\n');

    const t = setup(pdb);
    expect(t.call('minimize', ['all', 500])).toBeNull();
    // The stretched 1.9 Å bond is left exactly as deposited.
    expect(bondLen(t, 0, 1)).toBeCloseTo(1.9, 6);
    expect(bondLen(t, 1, 2)).toBeCloseTo(1.9, 6);
  });

  it('clean raises the incentive-only error (matches Open-Source PyMOL)', () => {
    // Upstream `clean` does `raise pymol.IncentiveOnlyException` (computing.py),
    // so `cmd.clean` raises rather than minimising — verified against the oracle.
    const pdb = [
      atomLine(1, 'C1', 'C', 0, 0, 0),
      atomLine(2, 'C2', 'C', 1.9, 0, 0),
      conect(1, 2),
    ].join('\n');
    const t = setup(pdb);
    expect(() => t.call('clean', ['all'])).toThrow(/not available in Open-Source PyMOL/);
  });
});

describe('smooth (temporal, across states)', () => {
  it('reduces the middle-state deviation of a 3-state zigzag', () => {
    // One atom, 3 states: x = 0, 1, 0. The middle state deviates from the line.
    const model = (x: number): string =>
      atomLine(1, 'C1', 'C', x, 0, 0);
    const pdb = [
      'MODEL        1',
      model(0),
      'ENDMDL',
      'MODEL        2',
      model(1),
      'ENDMDL',
      'MODEL        3',
      model(0),
      'ENDMDL',
    ].join('\n');

    const t = setup(pdb);
    expect(t.mol().nstate).toBe(3);
    const before = t.mol().coord(0, 2)[0]; // deviated middle state = 1
    expect(before).toBeCloseTo(1, 5);

    // window=3 (must be <= number of states): real PyMOL's ExecutiveSmooth
    // no-ops when the window is larger than the frame count, so a window of 5
    // over 3 states would leave the coordinates untouched.
    t.call('smooth', ['all', 1, 3]);

    const after = t.mol().coord(0, 2)[0];
    // Box-average of (0,1,0) -> ~1/3: the deviation from the line (0) shrinks.
    expect(Math.abs(after - 0)).toBeLessThan(Math.abs(before - 0));
    expect(after).toBeCloseTo(1 / 3, 4);
  });
});
