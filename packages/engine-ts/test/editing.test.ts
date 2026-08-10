import { describe, expect, it } from 'vitest';

import { Executive } from '../src/exec/executive';
import { parsePdb } from '../src/model/pdb';
import { registerEditing } from '../src/cmd/editing';
import type { CommandHandler } from '../src/cmd/registrar';

/* --------------------------- test PDB builder --------------------------- */

/** Format one ATOM record into the exact PDB fixed columns. */
function atomLine(
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
  const buf = ' '.repeat(80).split('');
  const put = (start: number, s: string): void => {
    for (let i = 0; i < s.length; i++) buf[start - 1 + i] = s[i]!;
  };
  put(1, 'ATOM');
  put(7, serial.toString().padStart(5));
  put(name.length >= 4 ? 13 : 14, name);
  put(18, resn.padStart(3));
  put(22, chain);
  put(23, resi.toString().padStart(4));
  put(31, x.toFixed(3).padStart(8));
  put(39, y.toFixed(3).padStart(8));
  put(47, z.toFixed(3).padStart(8));
  put(55, '1.00');
  put(61, '0.00');
  put(77, elem.padStart(2));
  return buf.join('').replace(/\s+$/, '');
}

function conect(a: number, ...others: number[]): string {
  return 'CONECT' + a.toString().padStart(5) + others.map((o) => o.toString().padStart(5)).join('');
}

/** Build a PDB of carbons at the given coords (+ optional explicit CONECT). */
function carbonPdb(coords: Array<[number, number, number]>, conects: string[] = []): string {
  const lines = coords.map((c, i) => atomLine(i + 1, 'C' + (i + 1), 'UNK', 'A', 1, c[0], c[1], c[2], 'C'));
  return [...lines, ...conects, 'END'].join('\n');
}

/* ------------------------------ test harness ---------------------------- */

function setup(pdb: string, name = 'm'): { ex: Executive; h: Map<string, CommandHandler> } {
  const ex = new Executive();
  ex.addMolecule(parsePdb(pdb, name));
  const h = new Map<string, CommandHandler>();
  const ctx = {
    command: (n: string, f: CommandHandler) => h.set(n, f),
    executive: ex,
    publish() {},
    emitView() {},
    str: (v: unknown, d = '') => (v == null ? d : String(v)),
  };
  registerEditing(ctx as never);
  return { ex, h };
}

/* --------------------------------- vec3 --------------------------------- */

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V, b: V): V => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const nrm = (a: V): V => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
function dihedral(p1: V, p2: V, p3: V, p4: V): number {
  const b1 = sub(p2, p1);
  const b2 = sub(p3, p2);
  const b3 = sub(p4, p3);
  const n1 = cross(b1, b2);
  const n2 = cross(b2, b3);
  const m1 = cross(n1, nrm(b2));
  return (Math.atan2(dot(m1, n2), dot(n1, n2)) * 180) / Math.PI;
}

/* ---------------------------------- bond -------------------------------- */

describe('bond', () => {
  it('adds a bond between two unbonded atoms and dedups', () => {
    // Two carbons 5 Å apart — no distance auto-bond.
    const { ex, h } = setup(carbonPdb([[0, 0, 0], [5, 0, 0]]));
    const mol = ex.molecule('m')!;
    expect(mol.bonds.length).toBe(0);

    expect(h.get('bond')!(['index 1', 'index 2'], {})).toBe(1);
    expect(mol.bonds).toEqual([[0, 1]]);

    // Second call is a no-op (dedup).
    expect(h.get('bond')!(['index 1', 'index 2'], {})).toBe(0);
    expect(mol.bonds.length).toBe(1);
  });
});

/* --------------------------------- unbond ------------------------------- */

describe('unbond', () => {
  it('removes an existing bond', () => {
    // Two carbons 1.5 Å apart auto-bond on load.
    const { ex, h } = setup(carbonPdb([[0, 0, 0], [1.5, 0, 0]]));
    const mol = ex.molecule('m')!;
    expect(mol.bonds.length).toBe(1);

    expect(h.get('unbond')!(['index 1', 'index 2'], {})).toBe(1);
    expect(mol.bonds.length).toBe(0);
    // Removing a non-existent bond returns 0.
    expect(h.get('unbond')!(['index 1', 'index 2'], {})).toBe(0);
  });
});

/* --------------------------------- remove ------------------------------- */

describe('remove', () => {
  it('drops atoms, coords and reindexes bonds', () => {
    // Linear chain 0-1-2-3 (1.5 Å apart) -> bonds [0,1],[1,2],[2,3].
    const { ex, h } = setup(
      carbonPdb([[0, 0, 0], [1.5, 0, 0], [3, 0, 0], [4.5, 0, 0]]),
    );
    const mol = ex.molecule('m')!;
    expect(mol.bonds).toEqual([[0, 1], [1, 2], [2, 3]]);

    // Remove the atom at index 2 (local index 1).
    expect(h.get('remove')!(['index 2'], {})).toBe(1);
    expect(mol.natom).toBe(3);
    // Surviving atoms keep order: old 0,2,3 -> new 0,1,2.
    expect(mol.coord(0, 1)).toEqual([0, 0, 0]);
    expect(mol.coord(1, 1)).toEqual([3, 0, 0]);
    expect(mol.coord(2, 1)).toEqual([4.5, 0, 0]);
    // Bonds touching the removed atom dropped; the rest reindexed.
    expect(mol.bonds).toEqual([[1, 2]]);
    // State coordinate array was compacted to match the atom count.
    expect(mol.states[0]!.length).toBe(9);
  });

  it('reindexes bonds when removing the first atom', () => {
    const { ex, h } = setup(
      carbonPdb([[0, 0, 0], [1.5, 0, 0], [3, 0, 0]]),
    );
    const mol = ex.molecule('m')!;
    expect(mol.bonds).toEqual([[0, 1], [1, 2]]);
    expect(h.get('remove')!(['index 1'], {})).toBe(1);
    // old 1,2 -> new 0,1; bond [1,2] -> [0,1]; bond [0,1] dropped.
    expect(mol.bonds).toEqual([[0, 1]]);
    expect(mol.natom).toBe(2);
  });
});

/* --------------------------- protect / deprotect ------------------------ */

describe('protect / deprotect', () => {
  it('sets and clears the per-atom protected flag', () => {
    const { ex, h } = setup(carbonPdb([[0, 0, 0], [5, 0, 0], [10, 0, 0]]));
    const mol = ex.molecule('m')!;
    const flag = (i: number): boolean => Boolean((mol.atoms[i] as { protected?: boolean }).protected);

    expect(h.get('protect')!([], {})).toBe(3); // default (all)
    expect(mol.atoms.map((_, i) => flag(i))).toEqual([true, true, true]);

    expect(h.get('deprotect')!(['index 1'], {})).toBe(1);
    expect([flag(0), flag(1), flag(2)]).toEqual([false, true, true]);
  });
});

/* ------------------------------- alter_state ---------------------------- */

describe('alter_state', () => {
  it('runs a JS expression per atom and writes x/y/z back', () => {
    const { ex, h } = setup(carbonPdb([[1, 2, 3], [5, 6, 7]]));
    const mol = ex.molecule('m')!;
    expect(h.get('alter_state')!([1, 'all', 'x=x+10; y=y*2; z=z-1'], {})).toBe(2);
    expect(mol.coord(0, 1)).toEqual([11, 4, 2]);
    expect(mol.coord(1, 1)).toEqual([15, 12, 6]);
  });

  it('exposes atom fields to the expression', () => {
    const { ex, h } = setup(carbonPdb([[0, 0, 0], [5, 0, 0]]));
    const mol = ex.molecule('m')!;
    // index is 1-based inside the expression.
    h.get('alter_state')!([1, 'all', 'x=index*100'], {});
    expect(mol.coord(0, 1)[0]).toBe(100);
    expect(mol.coord(1, 1)[0]).toBe(200);
  });
});

/* ----------------------------- translate_atom --------------------------- */

describe('translate_atom', () => {
  it('shifts the matched atoms by a vector', () => {
    const { ex, h } = setup(carbonPdb([[0, 0, 0], [5, 0, 0]]));
    const mol = ex.molecule('m')!;
    expect(h.get('translate_atom')!(['index 1', 1, 2, 3], {})).toBe(1);
    expect(mol.coord(0, 1)).toEqual([1, 2, 3]);
    // The unselected atom is untouched.
    expect(mol.coord(1, 1)).toEqual([5, 0, 0]);
  });
});

/* ------------------------------ pseudoatom ------------------------------ */

describe('pseudoatom', () => {
  it('creates a new object holding one pseudo atom', () => {
    const { ex, h } = setup(carbonPdb([[0, 0, 0]]));
    expect(h.get('pseudoatom')!(['pt'], { pos: [1, 2, 3] })).toBe('pt');
    const pt = ex.molecule('pt')!;
    expect(pt).toBeDefined();
    expect(pt.natom).toBe(1);
    expect(pt.atoms[0]!.name).toBe('PS1');
    expect(pt.atoms[0]!.elem).toBe('PS');
    expect(pt.coord(0, 1)).toEqual([1, 2, 3]);
  });

  it('appends to an existing object', () => {
    const { ex, h } = setup(carbonPdb([[0, 0, 0]]));
    h.get('pseudoatom')!(['pt'], { pos: [1, 1, 1] });
    h.get('pseudoatom')!(['pt'], { pos: [4, 5, 6] });
    const pt = ex.molecule('pt')!;
    expect(pt.natom).toBe(2);
    expect(pt.coord(0, 1)).toEqual([1, 1, 1]);
    expect(pt.coord(1, 1)).toEqual([4, 5, 6]);
  });
});

/* ------------------------------ set_dihedral ---------------------------- */

describe('set_dihedral', () => {
  // Chain a1-a2-a3-a4 with an explicit backbone; large spacing so no spurious
  // distance bonds form. Current dihedral is 0 (a1 and a4 eclipsed).
  const coords: Array<[number, number, number]> = [
    [3, 0, 0], // a1
    [0, 0, 0], // a2
    [0, 0, 3], // a3
    [3, 0, 3], // a4
  ];
  const pdb = carbonPdb(coords, [conect(1, 2), conect(2, 3), conect(3, 4)]);

  it('starts at a 0 degree dihedral', () => {
    const { ex } = setup(pdb);
    const mol = ex.molecule('m')!;
    expect(dihedral(mol.coord(0, 1), mol.coord(1, 1), mol.coord(2, 1), mol.coord(3, 1)))
      .toBeCloseTo(0, 5);
  });

  it('rotates the atom3 side to reach the target angle', () => {
    const { ex, h } = setup(pdb);
    const mol = ex.molecule('m')!;
    h.get('set_dihedral')!(['index 1', 'index 2', 'index 3', 'index 4', 90], {});

    // a1, a2, a3 (upstream + on-axis) are untouched; a4 swung to (0,-3,3).
    expect(mol.coord(0, 1)).toEqual([3, 0, 0]);
    expect(mol.coord(1, 1)).toEqual([0, 0, 0]);
    expect(mol.coord(2, 1)).toEqual([0, 0, 3]);
    const a4 = mol.coord(3, 1);
    expect(a4[0]).toBeCloseTo(0, 4);
    expect(a4[1]).toBeCloseTo(-3, 4);
    expect(a4[2]).toBeCloseTo(3, 4);

    expect(dihedral(mol.coord(0, 1), mol.coord(1, 1), mol.coord(2, 1), mol.coord(3, 1)))
      .toBeCloseTo(90, 4);
  });

  it('reaches an arbitrary target angle', () => {
    for (const target of [-120, 45, 137.5]) {
      const { ex, h } = setup(pdb);
      const mol = ex.molecule('m')!;
      h.get('set_dihedral')!(['index 1', 'index 2', 'index 3', 'index 4', target], {});
      expect(dihedral(mol.coord(0, 1), mol.coord(1, 1), mol.coord(2, 1), mol.coord(3, 1)))
        .toBeCloseTo(target, 4);
    }
  });
});
