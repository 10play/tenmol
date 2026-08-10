/**
 * Isolated tests for the `measurement` subsystem (geometry queries).
 *
 * All expected values are hand-derived from small fixtures with exactly-known
 * geometry, replicating PyMOL's `get_angle3f` / `get_dihedral3f` sign
 * conventions (`packages/engine/layer0/Vector.cpp`).
 */
import { describe, expect, it } from 'vitest';
import type { Json } from '@tenmol/protocol';
import { Executive } from '../src/exec/executive';
import { parsePdb } from '../src/model/pdb';
import { registerMeasurement } from '../src/cmd/measurement';

/* ------------------------------ PDB builder ------------------------------ */

interface AtomSpec {
  serial: number;
  name: string;
  resn: string;
  chain: string;
  resi: number;
  x: number;
  y: number;
  z: number;
  elem: string;
  occ?: number;
  hetatm?: boolean;
}

function pdbLine(a: AtomSpec): string {
  const rec = a.hetatm ? 'HETATM' : 'ATOM  ';
  return (
    rec +
    String(a.serial).padStart(5) +
    ' ' +
    a.name.padEnd(4).slice(0, 4) + // cols 13-16
    ' ' + // altloc
    a.resn.padEnd(3).slice(0, 3) + // 18-20
    ' ' + // 21
    a.chain.slice(0, 1) + // 22
    String(a.resi).padStart(4) + // 23-26
    ' ' + // 27 icode
    '   ' + // 28-30
    a.x.toFixed(3).padStart(8) +
    a.y.toFixed(3).padStart(8) +
    a.z.toFixed(3).padStart(8) +
    (a.occ ?? 1.0).toFixed(2).padStart(6) +
    (0).toFixed(2).padStart(6) +
    '          ' + // 67-76
    a.elem.padStart(2) // 77-78
  );
}

function pdb(atoms: AtomSpec[]): string {
  return atoms.map(pdbLine).join('\n') + '\nEND\n';
}

/* ------------------------------- harness -------------------------------- */

function setup(molecules: Array<{ name: string; text: string }>) {
  const ex = new Executive();
  for (const m of molecules) ex.addMolecule(parsePdb(m.text, m.name));
  const handlers = new Map<string, (a: unknown[], k: Record<string, unknown>) => Json>();
  const ctx = {
    command: (n: string, f: (a: unknown[], k: Record<string, unknown>) => Json) => handlers.set(n, f),
    executive: ex,
    publish() {},
    emitView() {},
    str: (v: unknown, d = '') => (v == null ? d : String(v)),
  };
  registerMeasurement(ctx);
  const call = (name: string, ...args: unknown[]): Json => handlers.get(name)!(args, {});
  return { ex, handlers, call };
}

/* ------------------------------- fixtures -------------------------------- */

// Geometry fixture: 5 carbons at exactly-known positions.
//   A(0,0,0) B(1,0,0) C(1,1,0) D(1,1,1) E(1,1,-1)
const GEOM = pdb([
  { serial: 1, name: 'AX', resn: 'LIG', chain: 'A', resi: 1, x: 0, y: 0, z: 0, elem: 'C', hetatm: true },
  { serial: 2, name: 'BX', resn: 'LIG', chain: 'A', resi: 1, x: 1, y: 0, z: 0, elem: 'C', hetatm: true },
  { serial: 3, name: 'CX', resn: 'LIG', chain: 'A', resi: 1, x: 1, y: 1, z: 0, elem: 'C', hetatm: true },
  { serial: 4, name: 'DX', resn: 'LIG', chain: 'A', resi: 1, x: 1, y: 1, z: 1, elem: 'C', hetatm: true },
  { serial: 5, name: 'EX', resn: 'LIG', chain: 'A', resi: 1, x: 1, y: 1, z: -1, elem: 'C', hetatm: true },
]);

// Planar (extended, trans) tripeptide backbone. All atoms in z=0; the middle
// residue's phi and psi are therefore both +/-180 degrees.
//   C1(0,0)  N2(1.30,0.70)  CA2(2.60,0)  C2(3.90,0.70)  N3(5.20,0)
const PEP = pdb([
  { serial: 1, name: 'C', resn: 'ALA', chain: 'A', resi: 1, x: 0.0, y: 0.0, z: 0, elem: 'C' },
  { serial: 2, name: 'N', resn: 'ALA', chain: 'A', resi: 2, x: 1.3, y: 0.7, z: 0, elem: 'N' },
  { serial: 3, name: 'CA', resn: 'ALA', chain: 'A', resi: 2, x: 2.6, y: 0.0, z: 0, elem: 'C' },
  { serial: 4, name: 'C', resn: 'ALA', chain: 'A', resi: 2, x: 3.9, y: 0.7, z: 0, elem: 'C' },
  { serial: 5, name: 'N', resn: 'ALA', chain: 'A', resi: 3, x: 5.2, y: 0.0, z: 0, elem: 'N' },
]);

// Center-of-mass fixtures.
const COM_CO = pdb([
  { serial: 1, name: 'C', resn: 'LIG', chain: 'A', resi: 1, x: 0, y: 0, z: 0, elem: 'C', hetatm: true },
  { serial: 2, name: 'O', resn: 'LIG', chain: 'A', resi: 1, x: 3, y: 0, z: 0, elem: 'O', hetatm: true },
]);
// Two carbons with occupancy 0 -> PyMOL treats q as 1.0, so equal weights.
const COM_Q0 = pdb([
  { serial: 1, name: 'C1', resn: 'LIG', chain: 'A', resi: 1, x: 0, y: 0, z: 0, elem: 'C', occ: 0, hetatm: true },
  { serial: 2, name: 'C2', resn: 'LIG', chain: 'A', resi: 1, x: 2, y: 0, z: 0, elem: 'C', occ: 0, hetatm: true },
]);

/* --------------------------------- tests -------------------------------- */

const asNum = (v: Json): number => v as number;
const asArr = (v: Json): number[] => v as number[];

describe('get_distance', () => {
  it('returns the Euclidean distance between two single atoms', () => {
    const { call } = setup([{ name: 'g', text: GEOM }]);
    expect(asNum(call('get_distance', 'name AX', 'name BX'))).toBeCloseTo(1.0, 6);
    // A(0,0,0) -> D(1,1,1) = sqrt(3)
    expect(asNum(call('get_distance', 'name AX', 'name DX'))).toBeCloseTo(Math.sqrt(3), 5);
  });

  it('throws when a selection is not a single atom', () => {
    const { call } = setup([{ name: 'g', text: GEOM }]);
    expect(() => call('get_distance', 'g', 'name BX')).toThrow();
  });
});

describe('get_angle', () => {
  it('measures the angle at the middle atom (vertex = atom2)', () => {
    const { call } = setup([{ name: 'g', text: GEOM }]);
    // BA = (-1,0,0), BC = (0,1,0) -> 90 degrees
    expect(asNum(call('get_angle', 'name AX', 'name BX', 'name CX'))).toBeCloseTo(90, 4);
  });

  it('measures a 180 degree (collinear) angle', () => {
    // P(-1,0,0) Q(0,0,0) R(1,0,0)
    const line = pdb([
      { serial: 1, name: 'P', resn: 'L', chain: 'A', resi: 1, x: -1, y: 0, z: 0, elem: 'C', hetatm: true },
      { serial: 2, name: 'Q', resn: 'L', chain: 'A', resi: 1, x: 0, y: 0, z: 0, elem: 'C', hetatm: true },
      { serial: 3, name: 'R', resn: 'L', chain: 'A', resi: 1, x: 1, y: 0, z: 0, elem: 'C', hetatm: true },
    ]);
    const { call } = setup([{ name: 'l', text: line }]);
    expect(asNum(call('get_angle', 'name P', 'name Q', 'name R'))).toBeCloseTo(180, 4);
  });
});

describe('get_dihedral', () => {
  it('returns the signed torsion (PyMOL sign convention)', () => {
    const { call } = setup([{ name: 'g', text: GEOM }]);
    // A,B,C,D -> +90 per get_dihedral3f
    expect(asNum(call('get_dihedral', 'name AX', 'name BX', 'name CX', 'name DX'))).toBeCloseTo(90, 4);
    // A,B,C,E (mirror of D through z) -> -90
    expect(asNum(call('get_dihedral', 'name AX', 'name BX', 'name CX', 'name EX'))).toBeCloseTo(-90, 4);
  });

  it('is invariant to reversing the atom order', () => {
    const { call } = setup([{ name: 'g', text: GEOM }]);
    const fwd = asNum(call('get_dihedral', 'name AX', 'name BX', 'name CX', 'name DX'));
    const rev = asNum(call('get_dihedral', 'name DX', 'name CX', 'name BX', 'name AX'));
    expect(rev).toBeCloseTo(fwd, 5);
  });
});

describe('get_atom_coords / get_coords', () => {
  it('get_atom_coords returns one [x,y,z]', () => {
    const { call } = setup([{ name: 'g', text: GEOM }]);
    expect(asArr(call('get_atom_coords', 'name CX'))).toEqual([1, 1, 0]);
  });

  it('get_coords returns a row per atom in selection order', () => {
    const { call } = setup([{ name: 'g', text: GEOM }]);
    const rows = call('get_coords', 'g') as number[][];
    expect(rows).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 1, -1],
    ]);
  });
});

describe('get_extent', () => {
  it('returns [[min],[max]] over the selection', () => {
    const { call } = setup([{ name: 'g', text: GEOM }]);
    expect(call('get_extent', 'all')).toEqual([
      [0, 0, -1],
      [1, 1, 1],
    ]);
  });

  it('returns null for an empty selection', () => {
    const { call } = setup([{ name: 'g', text: GEOM }]);
    expect(call('get_extent', 'name ZZ')).toBeNull();
  });
});

describe('centerofmass', () => {
  it('is mass-weighted (C at 0, O at 3 -> ~1.7136)', () => {
    const { call } = setup([{ name: 'co', text: COM_CO }]);
    const com = asArr(call('centerofmass', 'co'));
    // (15.9994*3) / (12.0107 + 15.9994)
    expect(com[0]).toBeCloseTo((15.9994 * 3) / (12.0107 + 15.9994), 4);
    expect(com[1]).toBeCloseTo(0, 6);
    expect(com[2]).toBeCloseTo(0, 6);
  });

  it('treats zero occupancy as 1.0 (equal weights -> midpoint)', () => {
    const { call } = setup([{ name: 'q0', text: COM_Q0 }]);
    const com = asArr(call('centerofmass', 'q0'));
    expect(com[0]).toBeCloseTo(1.0, 6);
  });
});

describe('get_position', () => {
  it('is the model-space origin for the default view', () => {
    const { call } = setup([]);
    expect(asArr(call('get_position'))).toEqual([0, 0, 0]);
  });

  it('follows the view origin under identity rotation', () => {
    const { ex, call } = setup([]);
    const v = ex.view.get();
    v[12] = 5;
    v[13] = 6;
    v[14] = 7;
    ex.view.set(v);
    const p = asArr(call('get_position'));
    expect(p[0]).toBeCloseTo(5, 5);
    expect(p[1]).toBeCloseTo(6, 5);
    expect(p[2]).toBeCloseTo(7, 5);
  });

  it('applies rotation + camera offset (SceneGetCenter)', () => {
    const { ex, call } = setup([]);
    // Rz(90) column-major, origin (2,0,0), camera xy = (3,4).
    const v = ex.view.get();
    v[0] = 0; v[1] = 1; v[2] = 0;
    v[3] = -1; v[4] = 0; v[5] = 0;
    v[6] = 0; v[7] = 0; v[8] = 1;
    v[9] = 3; v[10] = 4; v[11] = -40;
    v[12] = 2; v[13] = 0; v[14] = 0;
    ex.view.set(v);
    const p = asArr(call('get_position'));
    // Hand-derived: R^-1 * (R*origin - camXY) = [-2, 3, 0]
    expect(p[0]).toBeCloseTo(-2, 5);
    expect(p[1]).toBeCloseTo(3, 5);
    expect(p[2]).toBeCloseTo(0, 5);
  });
});

describe('phi_psi', () => {
  it('returns backbone torsions for interior residues only', () => {
    const { call } = setup([{ name: 'pep', text: PEP }]);
    const r = call('phi_psi', 'all') as Record<string, [number, number]>;
    const keys = Object.keys(r);
    // Only residue 2 (the CA with both neighbors) is reported.
    expect(keys).toEqual(['pep/2']);
    const [phi, psi] = r['pep/2']!;
    // Fully extended, planar backbone -> |phi| = |psi| = 180.
    expect(Math.abs(phi)).toBeCloseTo(180, 2);
    expect(Math.abs(psi)).toBeCloseTo(180, 2);
  });
});
