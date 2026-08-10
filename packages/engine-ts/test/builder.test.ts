import { describe, expect, it } from 'vitest';

import { Executive } from '../src/exec/executive';
import { parsePdb } from '../src/model/pdb';
import { registerBuilder, getBondOrder } from '../src/cmd/builder';
import type { CommandHandler } from '../src/cmd/registrar';
import type { ObjectMolecule } from '../src/model/molecule';

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

/** Build a PDB from explicit (name, elem, coord) rows. */
function pdbOf(rows: Array<[string, string, [number, number, number]]>, conects: string[] = []): string {
  const lines = rows.map(([name, elem, c], i) =>
    atomLine(i + 1, name, 'UNK', 'A', 1, c[0], c[1], c[2], elem),
  );
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
  registerBuilder(ctx as never);
  return { ex, h };
}

/* --------------------------------- vec3 --------------------------------- */

type V = [number, number, number];
const dist = (a: V, b: V): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function angle(center: V, a: V, b: V): number {
  const u: V = [a[0] - center[0], a[1] - center[1], a[2] - center[2]];
  const w: V = [b[0] - center[0], b[1] - center[1], b[2] - center[2]];
  const d = u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
  const lu = Math.hypot(...u);
  const lw = Math.hypot(...w);
  return (Math.acos(Math.max(-1, Math.min(1, d / (lu * lw)))) * 180) / Math.PI;
}

/** Indices of the hydrogen atoms of `mol`, in order. */
function hIdx(mol: ObjectMolecule): number[] {
  const out: number[] = [];
  for (let i = 0; i < mol.natom; i++) if (mol.atoms[i]!.elem === 'H') out.push(i);
  return out;
}

/* -------------------------------- add_bond ------------------------------ */

describe('add_bond', () => {
  it('adds a bond to mol.bonds with the given order and dedups', () => {
    // Two carbons 5 Å apart — no distance auto-bond.
    const { ex, h } = setup(pdbOf([['C1', 'C', [0, 0, 0]], ['C2', 'C', [5, 0, 0]]]));
    const mol = ex.molecule('m')!;
    expect(mol.bonds.length).toBe(0);

    // 1-based indices, order 2.
    expect(h.get('add_bond')!(['m', 1, 2, 2], {})).toBe(1);
    expect(mol.bonds).toEqual([[0, 1]]);
    expect(getBondOrder(mol, 0, 1)).toBe(2);

    // Second call is a no-op (bond already present).
    expect(h.get('add_bond')!(['m', 1, 2, 2], {})).toBe(0);
    expect(mol.bonds.length).toBe(1);
  });

  it('rejects out-of-range indices', () => {
    const { ex, h } = setup(pdbOf([['C1', 'C', [0, 0, 0]], ['C2', 'C', [5, 0, 0]]]));
    expect(h.get('add_bond')!(['m', 1, 9], {})).toBe(0);
    expect(ex.molecule('m')!.bonds.length).toBe(0);
  });
});

/* --------------------------------- h_add -------------------------------- */

describe('h_add', () => {
  it('adds 4 tetrahedral hydrogens to a bare carbon at equal bond lengths', () => {
    // A single carbon, no neighbours — methane's central atom.
    const { ex, h } = setup(pdbOf([['C', 'C', [0, 0, 0]]]));
    const mol = ex.molecule('m')!;
    expect(mol.natom).toBe(1);

    expect(h.get('h_add')!(['all'], {})).toBe(4);
    // Observable via count_atoms('elem H').
    expect(ex.countAtoms('elem H')).toBe(4);
    expect(mol.natom).toBe(5);

    const c: V = mol.coord(0, 1);
    const hs = hIdx(mol).map((i) => mol.coord(i, 1) as V);
    expect(hs.length).toBe(4);

    // All four C–H bonds are the idealised length (1.09 Å) and mutually equal.
    for (const p of hs) expect(dist(c, p)).toBeCloseTo(1.09, 4);

    // Tetrahedral H–C–H angles ~109.47° for every pair.
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        expect(angle(c, hs[i]!, hs[j]!)).toBeCloseTo(109.4712, 2);
      }
    }

    // The four new hydrogens are bonded to the carbon.
    for (const i of hIdx(mol)) {
      expect(mol.bonds.some(([a, b]) => (a === 0 && b === i) || (a === i && b === 0))).toBe(true);
    }
  });

  it('completes an existing neighbour: methyl carbon gets 3 hydrogens', () => {
    // C1 bonded to C2 (1.5 Å); C1 should gain 3 H, C2 excluded from selection.
    const { ex, h } = setup(pdbOf([['C1', 'C', [0, 0, 0]], ['C2', 'C', [1.5, 0, 0]]]));
    const mol = ex.molecule('m')!;
    expect(mol.bonds).toEqual([[0, 1]]); // auto-bonded on load

    expect(h.get('h_add')!(['index 1'], {})).toBe(3);
    expect(ex.countAtoms('elem H')).toBe(3);

    const c: V = mol.coord(0, 1);
    for (const i of hIdx(mol)) {
      expect(dist(c, mol.coord(i, 1) as V)).toBeCloseTo(1.09, 4);
      // Each new H makes ~109.47° with the existing C1–C2 bond direction.
      expect(angle(c, mol.coord(1, 1) as V, mol.coord(i, 1) as V)).toBeCloseTo(109.4712, 1);
    }
  });

  it('honours bond order: a double bond leaves fewer open valences', () => {
    // Carbonyl-like: C double-bonded to O, so C wants 4 - 2(C=O) = 2 H.
    const { ex, h } = setup(pdbOf([['C', 'C', [0, 0, 0]], ['O', 'O', [1.2, 0, 0]]]));
    const mol = ex.molecule('m')!;
    expect(mol.bonds).toEqual([[0, 1]]);
    // Make the C–O bond a double bond.
    h.get('valence')!([2, 'index 1', 'index 2'], {});

    expect(h.get('h_add')!(['index 1'], {})).toBe(2);
    expect(ex.countAtoms('elem H')).toBe(2);
  });

  it('gives nitrogen 3 and oxygen 2 hydrogens', () => {
    const { ex, h } = setup(pdbOf([['N', 'N', [0, 0, 0]], ['O', 'O', [10, 0, 0]]]));
    // Far apart -> no auto-bond, so each keeps its full valence.
    expect(h.get('h_add')!(['all'], {})).toBe(5); // 3 (N) + 2 (O)
    expect(ex.countAtoms('elem H')).toBe(5);
  });
});

/* --------------------------------- h_fill ------------------------------- */

describe('h_fill', () => {
  it('removes then re-adds hydrogens on the picked atom', () => {
    const { ex, h } = setup(pdbOf([['C', 'C', [0, 0, 0]]]));
    const mol = ex.molecule('m')!;
    // First fill: 4 H.
    expect(h.get('h_add')!(['index 1'], {})).toBe(4);
    expect(ex.countAtoms('elem H')).toBe(4);

    // h_fill discards those and re-adds them; count is stable and the carbon is
    // still present with exactly 4 hydrogens.
    expect(h.get('h_fill')!(['index 1'], {})).toBe(4);
    expect(ex.countAtoms('elem H')).toBe(4);
    expect(mol.natom).toBe(5);
    const c: V = mol.coord(0, 1);
    for (const i of hIdx(mol)) expect(dist(c, mol.coord(i, 1) as V)).toBeCloseTo(1.09, 4);
  });
});

/* --------------------------- valence / cycle_valence -------------------- */

describe('valence', () => {
  it('sets the order of an existing bond', () => {
    const { ex, h } = setup(pdbOf([['C1', 'C', [0, 0, 0]], ['C2', 'C', [1.5, 0, 0]]]));
    const mol = ex.molecule('m')!;
    expect(getBondOrder(mol, 0, 1)).toBe(1);
    expect(h.get('valence')!([3, 'index 1', 'index 2'], {})).toBe(1);
    expect(getBondOrder(mol, 0, 1)).toBe(3);
  });

  it('creates the bond if it does not exist yet', () => {
    const { ex, h } = setup(pdbOf([['C1', 'C', [0, 0, 0]], ['C2', 'C', [5, 0, 0]]]));
    const mol = ex.molecule('m')!;
    expect(mol.bonds.length).toBe(0);
    h.get('valence')!([2, 'index 1', 'index 2'], {});
    expect(mol.bonds).toEqual([[0, 1]]);
    expect(getBondOrder(mol, 0, 1)).toBe(2);
  });
});

describe('cycle_valence', () => {
  it('cycles the picked bond 1 -> 2 -> 3 -> 1', () => {
    const { ex, h } = setup(pdbOf([['C1', 'C', [0, 0, 0]], ['C2', 'C', [1.5, 0, 0]]]));
    const mol = ex.molecule('m')!;
    expect(h.get('cycle_valence')!(['index 1', 'index 2'], {})).toBe(2);
    expect(getBondOrder(mol, 0, 1)).toBe(2);
    expect(h.get('cycle_valence')!(['index 1', 'index 2'], {})).toBe(3);
    expect(h.get('cycle_valence')!(['index 1', 'index 2'], {})).toBe(1);
    expect(getBondOrder(mol, 0, 1)).toBe(1);
  });
});

/* ------------------------------- replace -------------------------------- */

describe('replace', () => {
  it("changes the picked atom's element and name", () => {
    const { ex, h } = setup(pdbOf([['C1', 'C', [0, 0, 0]]]));
    const mol = ex.molecule('m')!;
    expect(mol.atoms[0]!.elem).toBe('C');
    expect(h.get('replace')!(['N', 'planar', 3, 'NX'], { selection: 'index 1' })).toBe(1);
    expect(mol.atoms[0]!.elem).toBe('N');
    expect(mol.atoms[0]!.name).toBe('NX');
    expect(ex.countAtoms('elem N')).toBe(1);
    expect(ex.countAtoms('elem C')).toBe(0);
  });
});

/* -------------------------------- attach -------------------------------- */

describe('attach', () => {
  it('adds one atom bonded to the picked atom at the covalent bond length', () => {
    const { ex, h } = setup(pdbOf([['C', 'C', [0, 0, 0]]]));
    const mol = ex.molecule('m')!;
    h.get('attach')!(['O', 1, 1], { selection: 'index 1' });
    expect(mol.natom).toBe(2);
    expect(mol.atoms[1]!.elem).toBe('O');
    // Bonded, at covalent(C)=0.76 + covalent(O)=0.66 = 1.42 Å.
    expect(mol.bonds.some(([a, b]) => (a === 0 && b === 1) || (a === 1 && b === 0))).toBe(true);
    expect(dist(mol.coord(0, 1) as V, mol.coord(1, 1) as V)).toBeCloseTo(1.42, 4);
  });
});

/* --------------------------------- invert ------------------------------- */

describe('invert', () => {
  it('swaps the two lightest substituents of the picked atom', () => {
    // Central C bonded to N (heavy) and two H; invert swaps the two H positions.
    const rows: Array<[string, string, [number, number, number]]> = [
      ['C', 'C', [0, 0, 0]],
      ['N', 'N', [1.5, 0, 0]],
      ['H1', 'H', [-0.5, 1.0, 0]],
      ['H2', 'H', [-0.5, -1.0, 0]],
    ];
    const { ex, h } = setup(pdbOf(rows, [conect(1, 2), conect(1, 3), conect(1, 4)]));
    const mol = ex.molecule('m')!;
    const before1 = mol.coord(2, 1);
    const before2 = mol.coord(3, 1);
    h.get('invert')!([], { selection: 'index 1' });
    // The two hydrogens exchanged coordinates; N (heavier) stayed put.
    expect(mol.coord(2, 1)).toEqual(before2);
    expect(mol.coord(3, 1)).toEqual(before1);
    expect(mol.coord(1, 1)).toEqual([1.5, 0, 0]);
  });
});

/* --------------------------------- rebond ------------------------------- */

describe('rebond', () => {
  it('recomputes distance-based bonds after coordinates change', () => {
    // Two carbons initially 5 Å apart -> no bonds on load.
    const { ex, h } = setup(pdbOf([['C1', 'C', [0, 0, 0]], ['C2', 'C', [5, 0, 0]]]));
    const mol = ex.molecule('m')!;
    expect(mol.bonds.length).toBe(0);

    // Move C2 to bonding distance and rebond.
    const set = mol.states[0]!;
    set[3] = 1.5;
    expect(h.get('rebond')!(['m'], {})).toBe(1);
    expect(mol.bonds).toEqual([[0, 1]]);

    // Moving them apart again and rebonding removes the bond.
    set[3] = 6;
    expect(h.get('rebond')!(['m'], {})).toBe(0);
    expect(mol.bonds.length).toBe(0);
  });
});

/* ---------------------------------- fuse -------------------------------- */

describe('fuse', () => {
  it('bonds two atoms of the same object', () => {
    const { ex, h } = setup(pdbOf([['C1', 'C', [0, 0, 0]], ['C2', 'C', [5, 0, 0]]]));
    const mol = ex.molecule('m')!;
    expect(h.get('fuse')!(['index 1', 'index 2'], {})).toBe(1);
    expect(mol.bonds).toEqual([[0, 1]]);
  });
});
