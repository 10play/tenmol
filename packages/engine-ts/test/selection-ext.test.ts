/**
 * Selection-language extensions (packages/engine-ts/src/select/selector.ts):
 * numeric comparisons, proximity set-ops, neighbour/by-group expanders, ss,
 * chemistry/flag keywords and slash notation.
 *
 * Isolated: builds an Executive + parsePdb directly (no Engine/LocalBackend), so
 * only the selector subsystem is exercised. All expected counts are hand-derived
 * from the fixture geometry below.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Executive } from '../src/exec/executive';
import { parsePdb } from '../src/model/pdb';

/* ------------------------------- fixture -------------------------------- */

interface Row {
  rec: 'ATOM  ' | 'HETATM';
  serial: number;
  name: string;
  resn: string;
  chain: string;
  resi: number;
  x: number;
  y: number;
  z: number;
  elem: string;
}

/** Place a value into a fixed 1-based inclusive column range of an 80-col line. */
function put(cols: string[], start: number, end: number, text: string, right = false): void {
  const width = end - start + 1;
  const t = text.length > width ? text.slice(0, width) : text;
  const padded = right ? t.padStart(width) : t.padEnd(width);
  for (let i = 0; i < width; i++) cols[start - 1 + i] = padded[i]!;
}

function pdbLine(r: Row): string {
  const cols = new Array(80).fill(' ');
  put(cols, 1, 6, r.rec);
  put(cols, 7, 11, String(r.serial), true);
  put(cols, 13, 16, r.name);
  put(cols, 18, 20, r.resn);
  put(cols, 22, 22, r.chain);
  put(cols, 23, 26, String(r.resi), true);
  put(cols, 31, 38, r.x.toFixed(3), true);
  put(cols, 39, 46, r.y.toFixed(3), true);
  put(cols, 47, 54, r.z.toFixed(3), true);
  put(cols, 55, 60, '1.00', true);
  put(cols, 61, 66, '0.00', true);
  put(cols, 77, 78, r.elem, true);
  return cols.join('');
}

function toPdb(rows: Row[]): string {
  return rows.map(pdbLine).join('\n') + '\nEND\n';
}

// Object `m`: two chains. Chain A = ALA(1)+GLY(2) peptide, then a Zn ion and a
// water (both isolated); chain B = a lone SER. Coordinates are axis-aligned so
// distances are exact and derivable.
const M_ROWS: Row[] = [
  { rec: 'ATOM  ', serial: 1, name: 'N', resn: 'ALA', chain: 'A', resi: 1, x: 0.0, y: 0.0, z: 0, elem: 'N' },
  { rec: 'ATOM  ', serial: 2, name: 'CA', resn: 'ALA', chain: 'A', resi: 1, x: 1.5, y: 0.0, z: 0, elem: 'C' },
  { rec: 'ATOM  ', serial: 3, name: 'C', resn: 'ALA', chain: 'A', resi: 1, x: 3.0, y: 0.0, z: 0, elem: 'C' },
  { rec: 'ATOM  ', serial: 4, name: 'O', resn: 'ALA', chain: 'A', resi: 1, x: 3.0, y: 1.2, z: 0, elem: 'O' },
  { rec: 'ATOM  ', serial: 5, name: 'CB', resn: 'ALA', chain: 'A', resi: 1, x: 1.5, y: 1.5, z: 0, elem: 'C' },
  { rec: 'ATOM  ', serial: 6, name: 'N', resn: 'GLY', chain: 'A', resi: 2, x: 4.5, y: 0.0, z: 0, elem: 'N' },
  { rec: 'ATOM  ', serial: 7, name: 'CA', resn: 'GLY', chain: 'A', resi: 2, x: 6.0, y: 0.0, z: 0, elem: 'C' },
  { rec: 'ATOM  ', serial: 8, name: 'C', resn: 'GLY', chain: 'A', resi: 2, x: 7.5, y: 0.0, z: 0, elem: 'C' },
  { rec: 'ATOM  ', serial: 9, name: 'O', resn: 'GLY', chain: 'A', resi: 2, x: 7.5, y: 1.2, z: 0, elem: 'O' },
  { rec: 'HETATM', serial: 10, name: 'ZN', resn: 'ZN', chain: 'A', resi: 100, x: 10.0, y: 0.0, z: 0, elem: 'ZN' },
  { rec: 'HETATM', serial: 11, name: 'O', resn: 'HOH', chain: 'A', resi: 200, x: 13.0, y: 0.0, z: 0, elem: 'O' },
  { rec: 'ATOM  ', serial: 12, name: 'N', resn: 'SER', chain: 'B', resi: 1, x: 20.0, y: 0.0, z: 0, elem: 'N' },
  { rec: 'ATOM  ', serial: 13, name: 'CA', resn: 'SER', chain: 'B', resi: 1, x: 21.5, y: 0.0, z: 0, elem: 'C' },
  { rec: 'ATOM  ', serial: 14, name: 'C', resn: 'SER', chain: 'B', resi: 1, x: 23.0, y: 0.0, z: 0, elem: 'C' },
  { rec: 'ATOM  ', serial: 15, name: 'O', resn: 'SER', chain: 'B', resi: 1, x: 23.0, y: 1.2, z: 0, elem: 'O' },
  { rec: 'ATOM  ', serial: 16, name: 'OG', resn: 'SER', chain: 'B', resi: 1, x: 21.5, y: 1.5, z: 0, elem: 'O' },
];

// Object `lig`: a two-atom HETATM fragment far from `m`.
const LIG_ROWS: Row[] = [
  { rec: 'HETATM', serial: 1, name: 'C1', resn: 'LIG', chain: 'X', resi: 1, x: 50.0, y: 0.0, z: 0, elem: 'C' },
  { rec: 'HETATM', serial: 2, name: 'O1', resn: 'LIG', chain: 'X', resi: 1, x: 51.2, y: 0.0, z: 0, elem: 'O' },
];

function build(): Executive {
  const ex = new Executive();
  const m = parsePdb(toPdb(M_ROWS), 'm');
  const lig = parsePdb(toPdb(LIG_ROWS), 'lig');

  // Per-atom b/q/ss/visRep overrides (deterministic, independent of columns).
  const bByIndex = [80, 80, 80, 80, 80, 20, 20, 20, 20, 100, 5, 50, 50, 50, 50, 50];
  const ssByIndex = ['H', 'H', 'H', 'H', 'H', 'S', 'S', 'S', 'S', '', '', '', '', '', '', ''];
  m.atoms.forEach((a, i) => {
    a.b = bByIndex[i]!;
    a.ss = ssByIndex[i]!;
    a.q = a.name === 'ZN' ? 0.5 : 1.0;
  });
  m.atoms[0]!.visRep = 0; // one atom made invisible for `visible`
  lig.atoms.forEach((a) => {
    a.b = 0;
    a.q = 1.0;
  });

  ex.addMolecule(m);
  ex.addMolecule(lig);
  lig.enabled = false; // for `enabled`
  return ex;
}

let ex: Executive;
beforeEach(() => {
  ex = build();
});
const count = (sel: string): number => ex.countAtoms(sel);
const names = (sel: string): string[] =>
  ex.atomsMatching(sel).map((u) => `${u.objName}:${u.atom.id}`);

/* -------------------------- sanity / regression -------------------------- */

describe('fixture + existing selectors', () => {
  it('loads the expected universe', () => {
    expect(count('all')).toBe(18);
    expect(count('name CA')).toBe(3);
    expect(count('elem C')).toBe(8);
    expect(count('elem O')).toBe(6);
    expect(count('elem N')).toBe(3);
    expect(count('chain A')).toBe(11);
    expect(count('chain B')).toBe(5);
    expect(count('resi 1-2 and chain A')).toBe(9);
  });
});

/* ------------------------- numeric comparisons -------------------------- */

describe('numeric property comparisons', () => {
  it('b-factor thresholds', () => {
    expect(count('b > 50')).toBe(6); // res1 (5 @80) + ZN (100)
    expect(count('b < 10')).toBe(3); // HOH(5) + 2 lig(0)
    expect(count('b >= 50')).toBe(11); // res1(5) + ZN + SER(5)
    expect(count('b > 50 and b < 90')).toBe(5); // res1 only (ZN=100 excluded)
    expect(count('b != 20')).toBe(14); // all but GLY res2 (4 @20)
    expect(count('b <= 20')).toBe(7); // res2(4) + HOH + 2 lig
  });

  it('occupancy equality', () => {
    expect(count('q = 1')).toBe(17); // all but ZN (0.5)
    expect(count('q < 1')).toBe(1); // ZN
    expect(count('q != 1')).toBe(1);
  });

  it('operators glue to operands without spaces', () => {
    expect(count('b>50')).toBe(6);
    expect(count('q=1')).toBe(17);
    expect(count('q!=1')).toBe(1);
  });

  it('formal/partial charge treated as 0', () => {
    expect(count('fc. = 0')).toBe(18);
    expect(count('fc. > 0')).toBe(0);
    expect(count('pc. = 0')).toBe(18);
    expect(count('formal_charge != 0')).toBe(0);
  });
});

/* ---------------------------- secondary struct --------------------------- */

describe('ss selector', () => {
  it('matches H / S / L (loop) and H+S grouping', () => {
    expect(count('ss H')).toBe(5);
    expect(count('ss S')).toBe(4);
    // PyMOL's `ss L` matches only the literal 'L' ssType, NOT unassigned ''
    // (SELE_SSTs alpha match). The fixture assigns no 'L', so `ss L` is empty
    // and the 9 unassigned atoms are selected by `ss ''` instead.
    expect(count('ss L')).toBe(0);
    expect(count("ss ''")).toBe(9);
    expect(count('ss H+S')).toBe(9);
  });
});

/* ----------------------------- proximity -------------------------------- */

describe('proximity operators', () => {
  const probe = '(name CA and resi 1 and chain A)'; // CA of ALA-1 @ (1.5,0,0)

  it('within / around / expand around a single atom', () => {
    // Neighbours within 1.6 A of CA: N, C, CB (each 1.5 A); O is 1.92 A away.
    expect(count(`within 1.6 of ${probe}`)).toBe(4); // + CA itself
    expect(count(`around 1.6 of ${probe}`)).toBe(3); // excludes CA
    expect(count(`${probe} around 1.6`)).toBe(3); // postfix form
    expect(count(`${probe} expand 1.6`)).toBe(4); // selection + shell
    expect(count(`expand 1.6 of ${probe}`)).toBe(4);
  });

  it('binary within / near_to / beyond', () => {
    expect(count(`chain A within 1.6 of ${probe}`)).toBe(4);
    expect(count(`chain A near_to 1.6 of ${probe}`)).toBe(3); // excl probe
    expect(count(`near_to 1.6 of ${probe}`)).toBe(3);
    expect(count(`chain A beyond 1.6 of ${probe}`)).toBe(7); // 11 chain-A − 4 near
    expect(count(`beyond 1.6 of ${probe}`)).toBe(14); // 18 − 4 within
  });

  it('gap clears the selection by its vdw surface', () => {
    const g = new Set(names('name ZN gap 3'));
    expect(g.has('m:10')).toBe(false); // ZN itself excluded
    expect(g.has('m:11')).toBe(false); // HOH 3 A away — surfaces overlap
    expect(g.has('lig:1')).toBe(true); // far lig atoms clear easily
    expect(g.has('lig:2')).toBe(true);
  });
});

/* --------------------------- bonds / by-groups --------------------------- */

describe('neighbor / bound_to', () => {
  it('selects the directly bonded shell, excluding the selection', () => {
    expect(count('neighbor (name CA and resi 1 and chain A)')).toBe(3); // N,C,CB
    expect(count('bound_to (name CA and resi 1 and chain A)')).toBe(3);
    expect(count('neighbor name ZN')).toBe(0); // isolated ion
  });
});

describe('by-group expanders', () => {
  it('bymol expands to the covalent component', () => {
    expect(count('bymol name OG')).toBe(5); // whole SER
    expect(count('bymol (name N and resi 1 and chain A)')).toBe(9); // ALA+GLY peptide
    expect(count('bm. name ZN')).toBe(1); // isolated
  });
  it('byobject / bychain expand to whole object / chain', () => {
    expect(count('byobject name O1')).toBe(2); // lig object
    expect(count('byobject name ZN')).toBe(16); // object m
    expect(count('bychain (name CA and resi 1 and chain A)')).toBe(11); // chain A
  });
});

/* --------------------------- flags / chemistry --------------------------- */

describe('flag and chemistry keywords', () => {
  it('bonded / visible / enabled / present', () => {
    expect(count('bonded')).toBe(16); // all but ZN, HOH
    expect(count('not bonded')).toBe(2);
    expect(count('visible')).toBe(17); // atom m:1 set invisible
    expect(count('enabled')).toBe(16); // lig object disabled
    expect(count('present')).toBe(18);
  });

  it('metals / donor / acceptor (element heuristics)', () => {
    expect(count('metals')).toBe(1); // Zn
    expect(count('donor')).toBe(9); // N + O
    expect(count('acceptor')).toBe(9); // N + O + S (no S here)
  });

  it('hetatm / solvent / polymer / backbone / sidechain still hold', () => {
    expect(count('hetatm')).toBe(4); // ZN, HOH, 2 lig
    expect(count('solvent')).toBe(1); // HOH
    expect(count('polymer')).toBe(14); // chain A protein (9) + SER (5)
    expect(count('backbone')).toBe(12);
    expect(count('sidechain')).toBe(2); // CB, OG
  });
});

/* ----------------------------- slash notation ---------------------------- */

describe('slash notation and model qualifier', () => {
  it('left-aligned /object/segi/chain/resi/name', () => {
    expect(names('/m//A/1/CA')).toEqual(['m:2']);
    expect(count('/m//A/1')).toBe(5); // ALA-1 residue
    expect(count('/m//B')).toBe(5); // chain B
    expect(count('/m')).toBe(16); // whole object
  });
  it('right-aligned partial macros', () => {
    expect(names('A/1/CA')).toEqual(['m:2']); // chain/resi/name
    expect(count('1/N')).toBe(2); // resi 1 name N: ALA A1 + SER B1
  });
  it('model qualifier', () => {
    expect(count('model m')).toBe(16);
    expect(count('model m and name CA')).toBe(3);
  });
});

/* -------------------------------- errors --------------------------------- */

describe('error handling', () => {
  it('within without of throws', () => {
    expect(() => count('within 5 chain A')).toThrow();
  });
});
