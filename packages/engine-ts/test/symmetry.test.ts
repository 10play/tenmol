/**
 * Isolated tests for the symmetry / crystallography subsystem.
 *
 * Reference values are hand-derived from the standard PDB orthogonalisation
 * convention. Fixtures use an orthogonal 10x10x10 Å cell, so fractional->
 * Cartesian is simply `cart = 10 · frac` and every mate coordinate is an exact
 * (float32-representable) integer.
 */
import { describe, expect, it } from 'vitest';
import { Executive } from '../src/exec/executive';
import { parsePdb } from '../src/model/pdb';
import { registerSymmetry } from '../src/cmd/symmetry';
import type { RegistrarCtx, CommandHandler } from '../src/cmd/registrar';

/* --------------------------- PDB fixture builders ------------------------ */

function cryst1(
  a: number, b: number, c: number,
  al: number, be: number, ga: number, sg: string,
): string {
  return (
    'CRYST1' +
    a.toFixed(3).padStart(9) +
    b.toFixed(3).padStart(9) +
    c.toFixed(3).padStart(9) +
    al.toFixed(2).padStart(7) +
    be.toFixed(2).padStart(7) +
    ga.toFixed(2).padStart(7) +
    ' ' +
    sg.padEnd(11) +
    '   1'
  );
}

function atomLine(serial: number, name: string, x: number, y: number, z: number, elem: string): string {
  return (
    'ATOM  ' +
    String(serial).padStart(5) + // 7-11
    ' ' + // 12
    (' ' + name).padEnd(4).slice(0, 4) + // 13-16
    ' ' + // 17 altloc
    'ALA' + // 18-20
    ' ' + // 21
    'A' + // 22 chain
    String(1).padStart(4) + // 23-26 resSeq
    ' ' + // 27 iCode
    '   ' + // 28-30
    x.toFixed(3).padStart(8) + // 31-38
    y.toFixed(3).padStart(8) + // 39-46
    z.toFixed(3).padStart(8) + // 47-54
    '  1.00' + // 55-60
    '  0.00' + // 61-66
    '          ' + // 67-76
    elem.padStart(2) // 77-78
  );
}

/** One carbon at (1,1,1) in the given cell / space group. */
function fixture(sg: string): string {
  return [
    cryst1(10, 10, 10, 90, 90, 90, sg),
    atomLine(1, 'C', 1, 1, 1, 'C'),
    'END',
  ].join('\n');
}

/* -------------------------------- harness -------------------------------- */

function harness(pdb: string): { ex: Executive; call: (cmd: string, ...args: unknown[]) => unknown } {
  const ex = new Executive();
  ex.addMolecule(parsePdb(pdb, 'm'));
  const handlers = new Map<string, CommandHandler>();
  const ctx: RegistrarCtx = {
    command: (n, f) => handlers.set(n, f),
    executive: ex,
    publish() {},
    emitView() {},
    str: (v, d = '') => (v == null ? d : String(v)),
  };
  registerSymmetry(ctx);
  const call = (cmd: string, ...args: unknown[]): unknown => {
    const h = handlers.get(cmd);
    if (!h) throw new Error(`no handler ${cmd}`);
    return h(args, {});
  };
  return { ex, call };
}

/** A mate's single atom's state-1 coordinate, rounded to kill fp fuzz. */
function mateCoord(ex: Executive, name: string): [number, number, number] {
  const mol = ex.molecule(name)!;
  const [x, y, z] = mol.coord(0, 1);
  return [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4, Math.round(z * 1e4) / 1e4];
}

function coordSet(ex: Executive, names: string[]): Set<string> {
  return new Set(names.map((n) => mateCoord(ex, n).join(',')));
}

/* --------------------------------- tests --------------------------------- */

describe('CRYST1 parsing', () => {
  it('reads the unit cell and space group from CRYST1', () => {
    const mol = parsePdb(fixture('P 1'), 'm');
    expect(mol.cell).toEqual({ a: 10, b: 10, c: 10, alpha: 90, beta: 90, gamma: 90 });
    expect(mol.spacegroup).toBe('P 1');
  });

  it('leaves cell undefined when there is no CRYST1', () => {
    const mol = parsePdb(atomLine(1, 'C', 1, 1, 1, 'C'), 'm');
    expect(mol.cell).toBeUndefined();
    expect(mol.spacegroup).toBeUndefined();
  });
});

describe('get_symmetry / set_symmetry / symmetry_copy', () => {
  it('get_symmetry returns the six cell params plus the space group', () => {
    const { call } = harness(fixture('P 1'));
    expect(call('get_symmetry', 'm')).toEqual([10, 10, 10, 90, 90, 90, 'P 1']);
  });

  it('get_symmetry returns null for a cell-free object', () => {
    const { call } = harness(atomLine(1, 'C', 1, 1, 1, 'C'));
    expect(call('get_symmetry', 'm')).toBeNull();
  });

  it('set_symmetry round-trips', () => {
    const { call } = harness(fixture('P 1'));
    expect(call('set_symmetry', 'm', 20, 30, 40, 90, 90, 120, 'P 21 21 21')).toBe(1);
    expect(call('get_symmetry', 'm')).toEqual([20, 30, 40, 90, 90, 120, 'P 21 21 21']);
  });

  it('symmetry_copy copies cell + space group to a target', () => {
    const { ex, call } = harness(fixture('P 21 21 21'));
    ex.addMolecule(parsePdb(atomLine(1, 'C', 0, 0, 0, 'C'), 't'));
    expect(ex.molecule('t')!.cell).toBeUndefined();
    expect(call('symmetry_copy', 'm', 't')).toBe(1);
    expect(ex.molecule('t')!.cell).toEqual({ a: 10, b: 10, c: 10, alpha: 90, beta: 90, gamma: 90 });
    expect(ex.molecule('t')!.spacegroup).toBe('P 21 21 21');
  });

  it('get_assembly_ids is a stub returning []', () => {
    const { call } = harness(fixture('P 1'));
    expect(call('get_assembly_ids', 'm')).toEqual([]);
  });
});

describe('symexp', () => {
  it('P1: generates the six face-adjacent translational lattice mates', () => {
    const { ex, call } = harness(fixture('P 1'));
    // Atom at (1,1,1); a=b=c=10. The ±1 lattice neighbours along one axis sit at
    // distance 10 (kept, cutoff 10.5); ±1 in two axes at distance √200≈14.1
    // (dropped). Exactly six mates, each a translate of the source.
    const names = call('symexp', 'sym', 'm', 'm', 10.5) as string[];
    expect(names.length).toBe(6);
    // Each mate is a full copy of the object (same atom count).
    for (const n of names) expect(ex.molecule(n)!.natom).toBe(1);
    expect(coordSet(ex, names)).toEqual(
      new Set([
        '11,1,1', '-9,1,1',
        '1,11,1', '1,-9,1',
        '1,1,11', '1,1,-9',
      ]),
    );
    // Mates are named prefix + zero-padded counter.
    expect(names).toContain('sym00');
  });

  it('P1: source copy (identity, zero translation) is excluded', () => {
    const { ex, call } = harness(fixture('P 1'));
    const names = call('symexp', 'sym', 'm', 'm', 10.5) as string[];
    // No mate coincides with the original atom position.
    expect(coordSet(ex, names).has('1,1,1')).toBe(false);
  });

  it('P21: applies the 2-fold screw operator (-x, y+1/2, -z)', () => {
    const { ex, call } = harness(fixture('P 21'));
    // Op2 of atom (1,1,1): frac (0.1,0.1,0.1) -> (-0.1,0.6,-0.1) -> cart (-1,6,-1).
    // The identity operator's lattice neighbours (distance 10) fall outside a
    // 6 Å cutoff, so only op2 mates survive: L=(0,0,0) at (-1,6,-1) and
    // L=(0,-1,0) at (-1,-4,-1), both √33≈5.74 Å from the source.
    const names = call('symexp', 'sym', 'm', 'm', 6.0) as string[];
    expect(names.length).toBe(2);
    expect(coordSet(ex, names)).toEqual(new Set(['-1,6,-1', '-1,-4,-1']));
  });

  it('returns [] for an object without a unit cell', () => {
    const { call } = harness(atomLine(1, 'C', 1, 1, 1, 'C'));
    expect(call('symexp', 'sym', 'm', 'm', 5.0)).toEqual([]);
  });
});
