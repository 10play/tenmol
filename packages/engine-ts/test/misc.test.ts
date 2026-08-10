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

// vdw(C) = 1.7, probe = 1.4 -> R = 3.1; a lone carbon's full sphere area.
const R = 1.7 + 1.4;
const LONE_C_AREA = 4 * Math.PI * R * R; // ~120.7628

/* --------------------------------- tests --------------------------------- */

describe('get_area', () => {
  it('an isolated atom is the full 4*pi*(vdw+probe)^2 sphere', () => {
    const { call } = harness(atom(1, 'CA', 'ALA', 'A', 1, 0, 0, 0, 'C'));
    const area = call('get_area', 'all') as number;
    expect(area).toBeCloseTo(LONE_C_AREA, 6);
    expect(LONE_C_AREA).toBeCloseTo(120.7628, 3);
  });

  it('two fused atoms occlude each other: single < total < 2*single', () => {
    const pdb = [
      atom(1, 'CA', 'ALA', 'A', 1, 0, 0, 0, 'C'),
      atom(2, 'CB', 'ALA', 'A', 1, 1.5, 0, 0, 'C'),
    ].join('\n');
    const { call } = harness(pdb);
    const total = call('get_area', 'all') as number;
    // Context = selection: a single-atom selection is fully exposed.
    const single = call('get_area', 'name CA') as number;
    expect(single).toBeCloseTo(LONE_C_AREA, 6);
    expect(total).toBeGreaterThan(single); // both still largely exposed
    expect(total).toBeLessThan(2 * single); // but each loses its buried cap
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
  it('a fully exposed lone residue is over-exposed relative to its max ASA', () => {
    // Lone glycine CA: SASA ~120.76, max ASA(GLY)=104 -> rel > 1.
    const { call } = harness(atom(1, 'CA', 'GLY', 'A', 7, 0, 0, 0, 'C'));
    const map = call('get_sasa_relative', 'all') as Record<string, number>;
    const key = 'm//A/7/GLY'; // empty segi
    expect(map[key]).toBeCloseTo(LONE_C_AREA / 104, 6);
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

  it('get_bonds / get_bond return internal 1-based bond pairs', () => {
    const { call } = harness(pdb);
    // CA-CB (1.5 A) are covalently connected; CG (10 A) is isolated.
    expect(call('get_bonds', 'all')).toEqual([[1, 2]]);
    expect(call('get_bond', 'all')).toEqual([1, 2]);
    // A selection excluding CB has no internal bond.
    expect(call('get_bonds', 'name CA')).toEqual([]);
    expect(call('get_bond', 'name CA')).toBeNull();
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
