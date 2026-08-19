import { describe, expect, it } from 'vitest';
import { Executive } from '../src/exec/executive';
import { parsePdb } from '../src/model/pdb';
import { registerMisc } from '../src/cmd/misc';

/* ------------------------------ test harness ----------------------------- */

type Handler = (args: unknown[], kwargs: Record<string, unknown>) => unknown;

function harness(pdb: string) {
  const ex = new Executive();
  ex.addMolecule(parsePdb(pdb, 'm'));
  const handlers = new Map<string, Handler>();
  const ctx = {
    command: (n: string, f: Handler) => handlers.set(n, f),
    executive: ex,
    publish() {},
    emitView() {},
    str: (v: unknown, d = '') => (v == null ? d : String(v)),
  };
  registerMisc(ctx as never);
  const call = (name: string, ...args: unknown[]) => handlers.get(name)!(args, {});
  return { ex, handlers, call };
}

/** Assemble one fixed-width PDB ATOM line (explicit element column). */
function atom(
  serial: number,
  name: string,
  resn: string,
  chain: string,
  resi: number,
  x: number,
  y: number,
  z: number,
  elem: string,
): string {
  const cols = new Array<string>(80).fill(' ');
  const put = (start: number, s: string) => {
    for (let i = 0; i < s.length; i++) cols[start - 1 + i] = s[i]!;
  };
  put(1, 'ATOM  ');
  put(7, String(serial).padStart(5));
  put(13, name.padEnd(4));
  put(18, resn.padEnd(3));
  put(22, chain);
  put(23, String(resi).padStart(4));
  put(31, x.toFixed(3).padStart(8));
  put(39, y.toFixed(3).padStart(8));
  put(47, z.toFixed(3).padStart(8));
  put(55, '  1.00');
  put(61, '  0.00');
  put(77, elem.padStart(2));
  return cols.join('');
}

// get_area depends on `dot_solvent` (default OFF), so the sphere radius is the
// van-der-Waals radius with NO solvent probe added (PyMOL RepDot area mode):
// vdw(C) = 1.7 -> a lone carbon's full sphere area = 4*pi*1.7^2 ~ 36.3168.
// (Oracle-confirmed against real PyMOL: 36.31681.)
const R = 1.7;
const LONE_C_AREA = 4 * Math.PI * R * R; // ~36.3168

/* --------------------------------- tests --------------------------------- */

describe('get_area', () => {
  it('an isolated atom is the full 4*pi*vdw^2 sphere (dot_solvent off)', () => {
    const { call } = harness(atom(1, 'CA', 'ALA', 'A', 1, 0, 0, 0, 'C'));
    const area = call('get_area', 'all') as number;
    // get_area is dot-sampled (PyMOL's geodesic sphere weights), so a fully
    // exposed atom recovers 4*pi*vdw^2 only up to the tessellation's precision
    // (~1e-5). Real PyMOL likewise returns ~36.31681, not the exact analytic.
    expect(area).toBeCloseTo(LONE_C_AREA, 3);
    expect(LONE_C_AREA).toBeCloseTo(36.3168, 3);
  });

  it('two fused atoms occlude each other (whole-object context)', () => {
    const pdb = [
      atom(1, 'CA', 'ALA', 'A', 1, 0, 0, 0, 'C'),
      atom(2, 'CB', 'ALA', 'A', 1, 1.5, 0, 0, 'C'),
    ].join('\n');
    const { call } = harness(pdb);
    const total = call('get_area', 'all') as number;
    // PyMOL occludes over the WHOLE object, so even a single-atom selection is
    // buried by the rest of the object — CA alone is NOT the lone-atom area.
    // (Oracle-confirmed against real PyMOL: total 53.3913, CA alone 26.6956.)
    const single = call('get_area', 'name CA') as number;
    expect(single).toBeLessThan(LONE_C_AREA); // buried cap removed by CB
    expect(single).toBeCloseTo(total / 2, 6); // symmetric pair
    expect(total).toBeGreaterThan(LONE_C_AREA); // still largely exposed
    expect(total).toBeLessThan(2 * LONE_C_AREA); // but each loses its buried cap
  });

  it('load_b writes each atom area into b and they sum to the total', () => {
    const pdb = [
      atom(1, 'CA', 'ALA', 'A', 1, 0, 0, 0, 'C'),
      atom(2, 'CB', 'ALA', 'A', 1, 1.5, 0, 0, 'C'),
    ].join('\n');
    const { ex, call } = harness(pdb);
    const total = call('get_area', 'all', 0, 1) as number;
    const mol = ex.molecule('m')!;
    const b0 = mol.atoms[0]!.b;
    const b1 = mol.atoms[1]!.b;
    expect(b0).toBeGreaterThan(0);
    expect(b0).toBeLessThan(LONE_C_AREA); // partially buried
    expect(b0 + b1).toBeCloseTo(total, 6);
  });
});

describe('get_sasa_relative', () => {
  it('a lone residue in isolation has relative SASA 1.0 (context == isolated)', () => {
    // Relative SASA is area-in-context / area-in-isolation (PyMOL). A single
    // residue that IS the whole object is its own isolated reference, so 1.0.
    const { call } = harness(atom(1, 'CA', 'GLY', 'A', 7, 0, 0, 0, 'C'));
    const map = call('get_sasa_relative', 'all') as Record<string, number>;
    const key = 'm//A/7'; // object/segi/chain/resi
    expect(map[key]).toBeCloseTo(1.0, 6);
  });
});

describe('find_pairs', () => {
  const pdb = [
    atom(1, 'CA', 'ALA', 'A', 1, 0, 0, 0, 'C'),
    atom(2, 'CB', 'ALA', 'A', 1, 1.5, 0, 0, 'C'),
    atom(3, 'CG', 'ALA', 'A', 1, 10, 0, 0, 'C'),
  ].join('\n');

  it('finds only the close cross-selection pair', () => {
    const { call } = harness(pdb);
    const pairs = call('find_pairs', 'name CA', 'name CB or name CG') as unknown[];
    expect(pairs).toEqual([
      [
        ['m', 1],
        ['m', 2],
      ],
    ]);
  });

  it('respects the cutoff argument', () => {
    const { call } = harness(pdb);
    // Widen the cutoff to reach CG (10 A away).
    const pairs = call('find_pairs', 'name CA', 'name CG', 0, 0, 12) as unknown[];
    expect(pairs.length).toBe(1);
    // With the default 3.5 A cutoff, CG is out of range.
    expect((call('find_pairs', 'name CA', 'name CG') as unknown[]).length).toBe(0);
  });
});

describe('index / id_atom / get_bonds', () => {
  const pdb = [
    atom(1, 'CA', 'ALA', 'A', 1, 0, 0, 0, 'C'),
    atom(2, 'CB', 'ALA', 'A', 1, 1.5, 0, 0, 'C'),
    atom(3, 'CG', 'ALA', 'A', 1, 10, 0, 0, 'C'),
  ].join('\n');

  it('index returns (object, 1-based) pairs in order', () => {
    const { call } = harness(pdb);
    expect(call('index', 'all')).toEqual([
      ['m', 1],
      ['m', 2],
      ['m', 3],
    ]);
  });

  it('id_atom returns the single atom id, and throws otherwise', () => {
    const { call } = harness(pdb);
    expect(call('id_atom', 'name CB')).toBe(2);
    expect(() => call('id_atom', 'all')).toThrow();
  });

  it('get_bonds / get_bond return internal bond tuples', () => {
    const { call } = harness(pdb);
    // CA-CB (1.5 A) are covalently connected; CG (10 A) is isolated.
    // get_bonds returns (atm1, atm2, order): atm1/atm2 are 0-based indices
    // enumerating the atoms WITHIN the selection (not the index property),
    // order is the bond order (1 = single). Verified against real PyMOL.
    expect(call('get_bonds', 'all')).toEqual([[0, 1, 1]]);
    // get_bond(name, selection1, selection2=None): real PyMOL returns a
    // per-object list `[model, [[idx1, idx2, value], ...]]` for every bond
    // spanning the two selections, with value=null when the per-bond setting
    // is unset (verified against the oracle).
    expect(call('get_bond', 'stick_radius', 'all')).toEqual([['m', [[1, 2, null]]]]);
    // A selection excluding CB has no internal bond -> empty list.
    expect(call('get_bonds', 'name CA')).toEqual([]);
    expect(call('get_bond', 'stick_radius', 'name CA')).toEqual([]);
  });
});

describe('indicate', () => {
  it('sets the "indicate" named selection like select', () => {
    const { ex, call } = harness(
      [
        atom(1, 'CA', 'ALA', 'A', 1, 0, 0, 0, 'C'),
        atom(2, 'CB', 'ALA', 'A', 1, 1.5, 0, 0, 'C'),
      ].join('\n'),
    );
    const n = call('indicate', 'name CA') as number;
    expect(n).toBe(1);
    expect(ex.hasSelection('indicate')).toBe(true);
    expect(ex.countAtoms('indicate')).toBe(1);
  });
});
