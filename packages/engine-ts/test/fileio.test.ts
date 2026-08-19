import { describe, it, expect } from 'vitest';
import { Executive } from '../src/exec/executive';
import { parsePdb } from '../src/model/pdb';
import { registerFileio } from '../src/cmd/fileio';
import type { AtomInfo } from '../src/model/atom';

/** Column-precise ATOM/HETATM record composer (1-based PDB columns). */
function rec(o: {
  het?: boolean;
  serial: number;
  name: string; // already column-aligned within cols 13-16
  resn: string;
  chain: string;
  resi: number;
  x: number;
  y: number;
  z: number;
  occ?: number;
  b?: number;
  elem: string;
}): string {
  const p = (s: string, w: number) => (s.length >= w ? s : ' '.repeat(w - s.length) + s);
  const pR = (s: string, w: number) => (s.length >= w ? s : s + ' '.repeat(w - s.length));
  const f = (v: number) => p(v.toFixed(3), 8);
  return (
    (o.het ? 'HETATM' : 'ATOM  ') +
    p(String(o.serial), 5) +
    ' ' +
    pR(o.name.slice(0, 4), 4) +
    ' ' + // alt
    p(o.resn, 3) +
    ' ' +
    o.chain.slice(0, 1) +
    p(String(o.resi), 4) +
    '    ' + // inscode + 3 spaces
    f(o.x) +
    f(o.y) +
    f(o.z) +
    p((o.occ ?? 1).toFixed(2), 6) +
    p((o.b ?? 0).toFixed(2), 6) +
    ' '.repeat(10) +
    p(o.elem, 2)
  );
}

/** A tiny 3-residue peptide (ALA-GLY-SER) in chain A, plus a calcium ion and a
 * water (both HETATM) in chain B. Exact %8.3f coords -> bit-exact to 3 dp. */
const PDB = [
  rec({
    serial: 1,
    name: ' N',
    resn: 'ALA',
    chain: 'A',
    resi: 1,
    x: 11.104,
    y: 6.134,
    z: 7.065,
    occ: 1,
    b: 20,
    elem: 'N',
  }),
  rec({
    serial: 2,
    name: ' CA',
    resn: 'ALA',
    chain: 'A',
    resi: 1,
    x: 12.56,
    y: 6.13,
    z: 7.075,
    occ: 1,
    b: 20,
    elem: 'C',
  }),
  rec({
    serial: 3,
    name: ' C',
    resn: 'ALA',
    chain: 'A',
    resi: 1,
    x: 13.0,
    y: 4.7,
    z: 7.1,
    occ: 1,
    b: 20,
    elem: 'C',
  }),
  rec({
    serial: 4,
    name: ' CA',
    resn: 'GLY',
    chain: 'A',
    resi: 2,
    x: 14.5,
    y: 4.5,
    z: 7.2,
    occ: 1,
    b: 20,
    elem: 'C',
  }),
  rec({
    serial: 5,
    name: ' N',
    resn: 'GLY',
    chain: 'A',
    resi: 2,
    x: 15.0,
    y: 5.5,
    z: 7.3,
    occ: 1,
    b: 20,
    elem: 'N',
  }),
  rec({
    serial: 6,
    name: ' CA',
    resn: 'SER',
    chain: 'A',
    resi: 3,
    x: 16.0,
    y: 4.0,
    z: 7.4,
    occ: 1,
    b: 20,
    elem: 'C',
  }),
  rec({
    het: true,
    serial: 7,
    name: 'CA',
    resn: 'CA',
    chain: 'B',
    resi: 1,
    x: 20.0,
    y: 20.0,
    z: 20.0,
    occ: 1,
    b: 30,
    elem: 'CA',
  }),
  rec({
    het: true,
    serial: 8,
    name: ' O',
    resn: 'HOH',
    chain: 'B',
    resi: 2,
    x: 25.0,
    y: 25.0,
    z: 25.0,
    occ: 1,
    b: 40,
    elem: 'O',
  }),
  'END',
].join('\n');

function harness(ex: Executive) {
  const handlers = new Map<string, (a: unknown[], k: Record<string, unknown>) => unknown>();
  let published = 0;
  const ctx = {
    command: (n: string, f: (a: unknown[], k: Record<string, unknown>) => unknown) =>
      handlers.set(n, f),
    executive: ex,
    publish() {
      published++;
    },
    emitView() {},
    str: (v: unknown, d = '') => (v == null ? d : String(v)),
  };
  registerFileio(ctx as never);
  return {
    call: (name: string, args: unknown[] = [], kwargs: Record<string, unknown> = {}) =>
      handlers.get(name)!(args, kwargs),
    get published() {
      return published;
    },
  };
}

function newEx() {
  const ex = new Executive();
  ex.addMolecule(parsePdb(PDB, 'm'));
  return ex;
}

describe('get_pdbstr', () => {
  it('produces fixed-column ATOM/HETATM records that round-trip through parsePdb', () => {
    const ex = newEx();
    const h = harness(ex);
    const out = h.call('get_pdbstr', ['all']) as string;

    // Round trip: same atom count and coordinates (to float32 / 3-decimal).
    // PyMOL exports atoms in canonical order (AtomInfoCompare / priority), not
    // file order, so `GLY` here re-emits as N,CA even though the fixture loads
    // CA,N. Match atoms by identity (chain+resv+name) instead of by index.
    const re = parsePdb(out, 're');
    const orig = ex.molecule('m')!;
    expect(re.natom).toBe(orig.natom);
    const key = (a: AtomInfo): string => `${a.chain}/${a.resv}/${a.name}`;
    const origByKey = new Map<string, { atom: AtomInfo; xyz: [number, number, number] }>();
    for (let i = 0; i < orig.natom; i++) origByKey.set(key(orig.atoms[i]!), { atom: orig.atoms[i]!, xyz: orig.coord(i, 1) });
    for (let i = 0; i < re.natom; i++) {
      const match = origByKey.get(key(re.atoms[i]!));
      expect(match).toBeDefined();
      const b = re.coord(i, 1);
      for (let k = 0; k < 3; k++) expect(b[k]).toBeCloseTo(match!.xyz[k], 3);
      expect(re.atoms[i]!.resn).toBe(match!.atom.resn);
      expect(re.atoms[i]!.elem).toBe(match!.atom.elem);
      expect(re.atoms[i]!.hetatm).toBe(match!.atom.hetatm);
    }
  });

  it('places fields in the exact PDB columns (1-based)', () => {
    const ex = newEx();
    const h = harness(ex);
    const lines = (h.call('get_pdbstr', ['all']) as string).split('\n');
    const first = lines[0]!;
    // record name, serial, aligned name, resn, chain, resi, coords
    expect(first.slice(0, 6)).toBe('ATOM  ');
    expect(first.slice(6, 11)).toBe('    1');
    expect(first.slice(12, 16)).toBe(' N  '); // 1-letter element -> leading space
    expect(first.slice(17, 20)).toBe('ALA');
    expect(first.slice(21, 22)).toBe('A');
    expect(first.slice(22, 26)).toBe('   1');
    expect(first.slice(30, 38)).toBe('  11.104');
    expect(first.slice(38, 46)).toBe('   6.134');
    expect(first.slice(46, 54)).toBe('   7.065');
    expect(first.slice(54, 60)).toBe('  1.00'); // occupancy
    expect(first.slice(60, 66)).toBe(' 20.00'); // b-factor
    expect(first.slice(76, 78)).toBe(' N'); // element, right-justified
    expect(first.length).toBe(80);
  });

  it('aligns a 2-letter-element atom name flush-left (CA calcium vs CA carbon)', () => {
    const ex = newEx();
    const h = harness(ex);
    const lines = (h.call('get_pdbstr', ['all']) as string).split('\n');
    const carbonCA = lines.find(
      (l) => l.slice(17, 20) === 'ALA' && l.slice(12, 16).trim() === 'CA',
    )!;
    const calcium = lines.find((l) => l.slice(76, 78) === 'Ca')!; // element col == Ca
    expect(carbonCA.slice(12, 16)).toBe(' CA '); // carbon: leading space
    expect(calcium.slice(12, 16)).toBe('CA  '); // calcium: flush left
  });

  it('emits TER between polymer chains and terminates with END', () => {
    const ex = newEx();
    const h = harness(ex);
    const out = h.call('get_pdbstr', ['all']) as string;
    const lines = out.split('\n');
    expect(lines.filter((l) => l.startsWith('TER')).length).toBe(1); // one polymer chain (A)
    expect(lines[lines.length - 2]).toBe('END'); // last line before trailing newline
    expect(out.endsWith('\n')).toBe(true);
    // TER appears right after the last chain-A atom (before the calcium ion).
    const terIdx = lines.findIndex((l) => l.startsWith('TER'));
    expect(lines[terIdx - 1]!.slice(17, 20)).toBe('SER');
  });

  it('honours the selection', () => {
    const ex = newEx();
    const h = harness(ex);
    const out = h.call('get_pdbstr', ['resn ALA']) as string;
    const atomLines = out.split('\n').filter((l) => l.startsWith('ATOM') || l.startsWith('HETATM'));
    expect(atomLines.length).toBe(3);
    expect(parsePdb(out, 'x').natom).toBe(3);
  });
});

describe('get_fastastr', () => {
  it('emits one FASTA record per object/chain using CA-ordered 1-letter codes', () => {
    const ex = newEx();
    const h = harness(ex);
    const out = h.call('get_fastastr', ['all']) as string;
    // Chain A: ALA,GLY,SER -> AGS. Chain B calcium/water have no CA guide.
    expect(out).toContain('>m_A');
    const lines = out.split('\n');
    const header = lines.indexOf('>m_A');
    expect(lines[header + 1]).toBe('AGS');
    expect(out.endsWith('\n')).toBe(true);
  });

  it('maps unknown residues to X', () => {
    const ex = new Executive();
    const pdb = [
      rec({
        serial: 1,
        name: ' CA',
        resn: 'ALA',
        chain: 'A',
        resi: 1,
        x: 0,
        y: 0,
        z: 0,
        elem: 'C',
      }),
      rec({
        serial: 2,
        name: ' CA',
        resn: 'ZZZ',
        chain: 'A',
        resi: 2,
        x: 3.8,
        y: 0,
        z: 0,
        elem: 'C',
      }),
      'END',
    ].join('\n');
    ex.addMolecule(parsePdb(pdb, 'p'));
    const h = harness(ex);
    const out = h.call('get_fastastr', ['all']) as string;
    expect(out.split('\n')[1]).toBe('AX');
  });

  it('wraps sequences at 70 columns', () => {
    const ex = new Executive();
    const rows: string[] = [];
    for (let i = 0; i < 75; i++) {
      rows.push(
        rec({
          serial: i + 1,
          name: ' CA',
          resn: 'ALA',
          chain: 'A',
          resi: i + 1,
          x: i * 4,
          y: 0,
          z: 0,
          elem: 'C',
        }),
      );
    }
    rows.push('END');
    ex.addMolecule(parsePdb(rows.join('\n'), 'big'));
    const h = harness(ex);
    const lines = (h.call('get_fastastr', ['all']) as string).split('\n');
    expect(lines[0]).toBe('>big_A');
    expect(lines[1]!.length).toBe(70);
    expect(lines[2]!.length).toBe(5); // remaining 75 - 70
  });
});

// `get_str` is owned by `cmd/exporters.ts` (it registers after fileio and
// shadows it), so its format-dispatch is tested in exporters.test.ts. fileio
// keeps only the single-format `get_pdbstr`/`get_fastastr` exporters.

describe('load_coords', () => {
  it('overwrites a selection coordinates from an Nx3 array', () => {
    const ex = newEx();
    const h = harness(ex);
    const before = h.published;
    const n = h.call('load_coords', [
      [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ],
      'resn ALA',
    ]) as number;
    expect(n).toBe(3);
    const mol = ex.molecule('m')!;
    expect(mol.coord(0, 1)).toEqual([1, 2, 3]);
    expect(mol.coord(1, 1)).toEqual([4, 5, 6]);
    expect(mol.coord(2, 1)).toEqual([7, 8, 9]);
    // Untouched atom keeps its original coordinate. Atoms are stored in PyMOL's
    // canonical sorted order (`ObjectMoleculeSort` at load), so within GLY resi 2
    // the backbone N (priority 1) precedes CA (priority 2): index 3 is GLY N
    // (x=15.0) and index 4 is GLY CA (x=14.5).
    expect(mol.coord(3, 1)[0]).toBeCloseTo(15.0, 3);
    expect(mol.coord(4, 1)[0]).toBeCloseTo(14.5, 3);
    expect(h.published).toBe(before + 1);
  });
});

describe('read_molstr / read_sdfstr', () => {
  // A minimal V2000 MOL block: water (O + 2 H), 2 bonds.
  const MOL = [
    'water',
    '  ChemDraw',
    '',
    '  3  2  0  0  0  0  0  0  0  0999 V2000',
    '    0.0000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0',
    '    0.9572    0.0000    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0',
    '   -0.2400    0.9270    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0',
    '  1  2  1  0',
    '  1  3  1  0',
    'M  END',
  ].join('\n');

  it('parses a V2000 MOL block into a new molecule', () => {
    const ex = new Executive();
    const h = harness(ex);
    const name = h.call('read_molstr', [MOL, 'water']) as string;
    expect(name).toBe('water');
    const mol = ex.molecule('water')!;
    expect(mol.natom).toBe(3);
    expect(mol.atoms.map((a: AtomInfo) => a.elem)).toEqual(['O', 'H', 'H']);
    expect(mol.coord(1, 1)[0]).toBeCloseTo(0.9572, 4);
    expect(mol.coord(2, 1)[1]).toBeCloseTo(0.927, 4);
    // Bonds: O-H1 and O-H2 (0-based, normalised i<j), each a single bond (order 1).
    expect(mol.bonds).toEqual([
      [0, 1, 1],
      [0, 2, 1],
    ]);
  });

  it('assigns a unique name when the base is taken', () => {
    const ex = new Executive();
    const h = harness(ex);
    h.call('read_molstr', [MOL, 'lig']);
    const second = h.call('read_sdfstr', [MOL, 'lig']) as string;
    expect(second).toBe('lig_1');
    expect(ex.molecule('lig_1')!.natom).toBe(3);
  });
});
