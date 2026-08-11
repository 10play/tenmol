/**
 * RED parity tests — data-model gaps the in-browser TypeScript engine still has
 * relative to real PyMOL: bond orders, formal/partial charges, ANISOU (ADP)
 * tensors, crystal-symmetry-driven expansion, object groups, and the per-object
 * transformation matrix.
 *
 * Every expected value is derived from the vendored real-PyMOL sources under
 * packages/engine/modules/pymol and packages/engine/modules/chempy — never
 * invented. Each test asserts the DESIRED real-PyMOL observable, so it FAILS
 * against today's port (that is the point: it pins the parity target). The file
 * must COLLECT cleanly; a failing expect() is success, a crash at import is not.
 *
 * Reference map:
 *  - chempy Atom.formal_charge / .partial_charge / .u_aniso, Bond.order:
 *      packages/engine/modules/chempy/__init__.py (Atom ~l.64-65, Bond ~l.166),
 *      packages/engine/modules/chempy/mol.py (l.55-57 formal_charge, l.66 bond
 *      order, l.74-81 `M  CHG`), packages/engine/modules/chempy/cif.py (l.421
 *      u_aniso = [U11,U22,U33,U12,U13,U23]).
 *  - get_model returns a ChemPy Indexed with .atom[] and .bond[]:
 *      packages/engine/modules/pymol/querying.py (get_model l.1060, get_bonds
 *      l.1077 "(atm1, atm2, order)").
 *  - group / ungroup and object:group type:
 *      packages/engine/modules/pymol/creating.py (group l.84, ungroup l.155).
 *  - get_object_matrix returns the object's state matrix (row-major 4x4):
 *      packages/engine/modules/pymol/querying.py (l.89) +
 *      packages/engine/layer3/Executive.cpp ExecutiveGetObjectMatrix2 (l.2965);
 *      transform_object records the applied matrix into the coordinate-set
 *      matrix via CoordSetRecordTxfApplied → ObjectStateLeftCombineMatrixR44d
 *      (packages/engine/layer2/ObjectMolecule.cpp l.6339,
 *      packages/engine/layer2/CoordSet.cpp l.542-552), so get_object_matrix
 *      after transform_object returns the applied matrix, not identity.
 *  - crystal symmetry operators drive symexp:
 *      packages/engine/modules/pymol/creating.py symexp; space group P 2 (No. 3,
 *      unique axis b) has the two general positions (x,y,z) and (-x,y,-z).
 */
import { describe, it, expect } from 'vitest';
import { LocalBackend } from '@tenmol/engine-ts';

/* ------------------------------------------------------------------ helpers */

interface ModelAtom {
  name?: string;
  elem?: string;
  coord?: [number, number, number];
  formal_charge?: number;
  partial_charge?: number;
  u_aniso?: number[];
}
interface ModelBond {
  order?: number;
  index?: [number, number];
}
interface Model {
  atom: ModelAtom[];
  bond?: ModelBond[];
}

/** Column-exact placement into a fixed-width PDB/record line (1-based cols). */
function record(width: number, puts: Array<[number, string]>): string {
  const cols = ' '.repeat(width).split('');
  for (const [start, text] of puts) {
    for (let i = 0; i < text.length; i++) cols[start - 1 + i] = text[i]!;
  }
  return cols.join('').replace(/\s+$/, '');
}
const rjust = (s: string, w: number): string => s.slice(0, w).padStart(w);

/* --------------------------------------------------------------- bond order */

describe('parity: data-model — bond orders', () => {
  it('get_model exposes bond.order = 2 for a carbonyl C=O (MDL double bond)', async () => {
    const b = new LocalBackend();
    await b.connect();
    // Formaldehyde H2C=O: bond 1-2 is the C=O double bond (order 2), 1-3 & 1-4
    // are C-H single bonds. chempy/mol.py l.66 reads the order from cols 7-9 of
    // each bond record; cmd.get_model().bond[k].order therefore reports 2 for
    // the carbonyl (chempy Bond.order). The port's MOL reader drops the order
    // column and get_model emits no .bond array at all.
    const mol = [
      'formaldehyde',
      '  tenmol',
      '',
      '  4  3  0  0  0  0  0  0  0  0999 V2000',
      '    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
      '    1.2000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0',
      '   -0.5000    0.9000    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0',
      '   -0.5000   -0.9000    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0',
      '  1  2  2  0  0  0  0',
      '  1  3  1  0  0  0  0',
      '  1  4  1  0  0  0  0',
      'M  END',
      '',
    ].join('\n');
    await b.call('read_molstr', [mol, 'f']);

    const model = (await b.call('get_model', ['f'])) as unknown as Model;
    const bonds = model.bond ?? [];
    const doubleBonds = bonds.filter((bd) => bd.order === 2);
    // Exactly one double bond (the carbonyl), two single bonds.
    expect(bonds.length).toBe(3);
    expect(doubleBonds.length).toBe(1);
  });
});

/* ------------------------------------------------------------------ charges */

describe('parity: data-model — formal & partial charge', () => {
  it('get_model exposes per-atom formal_charge and partial_charge', async () => {
    const b = new LocalBackend();
    await b.connect();

    // (a) partial_charge: a MOL2 carries a per-atom charge in its final column;
    // PyMOL's mol2 reader stores it as atom.partial_charge (chempy Atom l.65).
    const mol2 = [
      '@<TRIPOS>MOLECULE',
      'ion',
      ' 1 0 0 0 0',
      'SMALL',
      'USER_CHARGES',
      '@<TRIPOS>ATOM',
      '      1 O1         0.0000    0.0000    0.0000 O.3     1  UNL1       -0.5000',
      '',
    ].join('\n');
    await b.call('read_mol2str', [mol2, 'q']);
    const qModel = (await b.call('get_model', ['q'])) as unknown as Model;
    expect(qModel.atom[0]!.partial_charge).toBeCloseTo(-0.5, 4);

    // (b) formal_charge: an MDL `M  CHG` record sets a formal charge (+1 here);
    // chempy/mol.py l.74-81 assigns it to atom.formal_charge (chempy Atom l.64).
    const molChg = [
      'ammonium-N',
      '  tenmol',
      '',
      '  1  0  0  0  0  0  0  0  0  0999 V2000',
      '    0.0000    0.0000    0.0000 N   0  0  0  0  0  0  0  0  0  0  0  0',
      'M  CHG  1   1   1',
      'M  END',
      '',
    ].join('\n');
    await b.call('read_molstr', [molChg, 'c']);
    const cModel = (await b.call('get_model', ['c'])) as unknown as Model;
    expect(cModel.atom[0]!.formal_charge).toBe(1);
  });
});

/* ------------------------------------------------------------------- ANISOU */

describe('parity: data-model — ANISOU / anisotropic displacement', () => {
  it('get_model exposes the ANISOU U tensor as atom.u_aniso (Å²)', async () => {
    const b = new LocalBackend();
    await b.connect();
    // ANISOU integers are U×1e4 Å²; get_model exposes u_aniso in Å² ordered
    // [U11,U22,U33,U12,U13,U23] (chempy/cif.py l.421). Here 1000→0.10, 2000→0.20,
    // 3000→0.30, 100→0.01, 200→0.02, 300→0.03. The port parses ANISOU into the
    // atom (for the ellipsoids rep) but get_model never surfaces it.
    const atom = record(80, [
      [1, 'ATOM  '],
      [7, rjust('1', 5)],
      [13, ' N  '],
      [18, 'ALA'],
      [22, 'A'],
      [23, rjust('1', 4)],
      [31, rjust('0.000', 8)],
      [39, rjust('0.000', 8)],
      [47, rjust('0.000', 8)],
      [55, rjust('1.00', 6)],
      [61, rjust('10.00', 6)],
      [77, ' N'],
    ]);
    const anisou = record(80, [
      [1, 'ANISOU'],
      [7, rjust('1', 5)],
      [13, ' N  '],
      [18, 'ALA'],
      [22, 'A'],
      [23, rjust('1', 4)],
      [29, rjust('1000', 7)],
      [36, rjust('2000', 7)],
      [43, rjust('3000', 7)],
      [50, rjust('100', 7)],
      [57, rjust('200', 7)],
      [64, rjust('300', 7)],
      [77, ' N'],
    ]);
    const pdb = [atom, anisou, 'END', ''].join('\n');
    await b.call('read_pdbstr', [pdb, 'a']);

    const model = (await b.call('get_model', ['a'])) as unknown as Model;
    const u = model.atom[0]!.u_aniso ?? [];
    expect(u.length).toBe(6);
    expect(u[0]).toBeCloseTo(0.1, 4);
    expect(u[1]).toBeCloseTo(0.2, 4);
    expect(u[2]).toBeCloseTo(0.3, 4);
    expect(u[3]).toBeCloseTo(0.01, 4);
    expect(u[4]).toBeCloseTo(0.02, 4);
    expect(u[5]).toBeCloseTo(0.03, 4);
  });
});

/* ------------------------------------------------------- crystal symmetry */

describe('parity: data-model — crystal symmetry drives expansion', () => {
  it('symexp uses the space-group operators (P 2 → the (-x,y,-z) 2-fold mate)', async () => {
    const b = new LocalBackend();
    await b.connect();
    // One atom in a 20 Å orthogonal P 2 cell. Space group P 2 (No. 3, unique
    // axis b) has two general positions, (x,y,z) and (-x,y,-z). For the atom at
    // Cartesian (2,3,4) the 2-fold image lies at (-2,3,-4), ~8.9 Å away — inside
    // a 10 Å cutoff — so real PyMOL's symexp materialises it. (The port only
    // embeds P1/P21/P212121/C2 operators and falls back to P1 for P 2, whose
    // only lattice images are ≥20 Å away, so it generates NO mate.)
    const pdb = [
      record(80, [
        [1, 'CRYST1'],
        [7, rjust('20.000', 9)],
        [16, rjust('20.000', 9)],
        [25, rjust('20.000', 9)],
        [34, rjust('90.00', 7)],
        [41, rjust('90.00', 7)],
        [48, rjust('90.00', 7)],
        [56, 'P 2'],
      ]),
      record(80, [
        [1, 'ATOM  '],
        [7, rjust('1', 5)],
        [13, ' C  '],
        [18, 'UNK'],
        [22, 'A'],
        [23, rjust('1', 4)],
        [31, rjust('2.000', 8)],
        [39, rjust('3.000', 8)],
        [47, rjust('4.000', 8)],
        [55, rjust('1.00', 6)],
        [61, rjust('0.00', 6)],
        [77, ' C'],
      ]),
      'END',
      '',
    ].join('\n');
    await b.call('read_pdbstr', [pdb, 'x']);
    // Confirm the cell round-trips (this part IS at parity) before expanding.
    const sym = (await b.call('get_symmetry', ['x'])) as unknown as number[];
    expect(sym[6]).toBe('P 2');

    const mates = (await b.call('symexp', ['sym_', 'x', 'x', 10.0])) as unknown as string[];
    // Real PyMOL creates the crystallographic 2-fold mate; the fallback makes none.
    expect(mates.length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------- groups */

describe('parity: data-model — object groups', () => {
  it('group() creates an object:group that appears in get_names and owns members', async () => {
    const b = new LocalBackend();
    await b.connect();
    await b.call('read_pdbstr', [
      // trivial one-atom object 'm' to place in a group
      [
        record(80, [
          [1, 'ATOM  '],
          [7, rjust('1', 5)],
          [13, ' C  '],
          [18, 'UNK'],
          [22, 'A'],
          [23, rjust('1', 4)],
          [31, rjust('0.000', 8)],
          [39, rjust('0.000', 8)],
          [47, rjust('0.000', 8)],
          [55, rjust('1.00', 6)],
          [61, rjust('0.00', 6)],
          [77, ' C'],
        ]),
        'END',
        '',
      ].join('\n'),
      'm',
    ]);

    // cmd.group('g','m') creates a group object 'g' and moves 'm' into it
    // (creating.py l.84). The port DOES create the named group (so it shows in
    // get_names), but a group is a distinct object kind: PyMOL's get_type
    // reports 'object:group' (Executive.cpp l.9014-9016, cObjectGroup). The
    // port has no group object type — get_type is a fixed 'object:molecule'
    // stub — so the type observable is the parity gap. Guard the call so the
    // test still reaches its assertion even if grouping ever regresses to a throw.
    try {
      await b.call('group', ['g', 'm']);
    } catch {
      /* the observable below is the parity target regardless */
    }

    const names = (await b.call('get_names', ['objects'])) as unknown as string[];
    // The group object is a first-class named object alongside its member.
    expect(names).toContain('g');
    // PyMOL reports its type as object:group (get_type), not a molecule.
    expect(await b.call('get_type', ['g'])).toBe('object:group');
  });
});

/* ------------------------------------------------------------- object matrix */

describe('parity: data-model — object transformation matrix', () => {
  it('get_object_matrix returns the matrix applied by transform_object', async () => {
    const b = new LocalBackend();
    await b.connect();
    await b.call('read_pdbstr', [
      [
        record(80, [
          [1, 'ATOM  '],
          [7, rjust('1', 5)],
          [13, ' C  '],
          [18, 'UNK'],
          [22, 'A'],
          [23, rjust('1', 4)],
          [31, rjust('0.000', 8)],
          [39, rjust('0.000', 8)],
          [47, rjust('0.000', 8)],
          [55, rjust('1.00', 6)],
          [61, rjust('0.00', 6)],
          [77, ' C'],
        ]),
        'END',
        '',
      ].join('\n'),
      'm',
    ]);

    // A homogeneous (row-major 4x4) scale+translate. transform_object applies it
    // and records it into the object's coordinate-set matrix
    // (CoordSetRecordTxfApplied → ObjectStateLeftCombineMatrixR44d); on a fresh
    // object whose matrix is identity, the recorded matrix equals the applied
    // one, so get_object_matrix (state 1) returns it verbatim. The port keeps a
    // hardcoded identity stub.
    const M = [2, 0, 0, 5, 0, 3, 0, 6, 0, 0, 4, 7, 0, 0, 0, 1];
    // args: name, matrix, state=1, log=0, selection='', homogenous=1
    await b.call('transform_object', ['m', M, 1, 0, '', 1]);

    const got = (await b.call('get_object_matrix', ['m', 1])) as unknown as number[];
    expect(got).toEqual(M);
  });
});
