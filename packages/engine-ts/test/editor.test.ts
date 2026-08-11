import { describe, expect, it } from 'vitest';

import { LocalBackend } from '@tenmol/engine-ts';
import { registerEditor } from '../src/cmd/editor';
import type { CommandHandler } from '../src/cmd/registrar';
import { Executive } from '../src/exec/executive';
import { buildFragment } from '../src/model/fragments';
import type { ObjectMolecule } from '../src/model/molecule';
import { ObjectMolecule as ObjMol } from '../src/model/molecule';
import { defaultVisRep } from '../src/model/atom';

/* ------------------------------ harness --------------------------------- */

function makeCtx(ex: Executive): Map<string, CommandHandler> {
  const h = new Map<string, CommandHandler>();
  const ctx = {
    command: (n: string, f: CommandHandler) => h.set(n, f),
    call: () => null,
    executive: ex,
    publish() {},
    emitView() {},
    str: (v: unknown, d = '') => (v == null ? d : String(v)),
  };
  registerEditor(ctx as never);
  return h;
}

type V = [number, number, number];
const dist = (a: V, b: V): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The bond (as index pair) between the two named atoms, or undefined. */
function bondBetween(mol: ObjectMolecule, i: number, j: number): boolean {
  return mol.bonds.some(([a, b]) => (a === i && b === j) || (a === j && b === i));
}

/** Minimum interatomic distance across every pair in state 1. */
function minPairDistance(mol: ObjectMolecule): number {
  let m = Infinity;
  for (let i = 0; i < mol.natom; i++) {
    for (let j = i + 1; j < mol.natom; j++) {
      m = Math.min(m, dist(mol.coord(i, 1) as V, mol.coord(j, 1) as V));
    }
  }
  return m;
}

const nameIndex = (mol: ObjectMolecule, name: string, resv: number): number =>
  mol.atoms.findIndex((a) => a.name.toUpperCase() === name && a.resv === resv);

const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V, b: V): V => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V): number => Math.hypot(a[0], a[1], a[2]);

/** The bond angle a-b-c in degrees. */
function angle(a: V, b: V, c: V): number {
  const u = sub(a, b);
  const v = sub(c, b);
  return (Math.acos(dot(u, v) / (norm(u) * norm(v))) * 180) / Math.PI;
}

/** The signed dihedral a-b-c-d in degrees (-180..180). */
function dihedral(a: V, b: V, c: V, d: V): number {
  const b1 = sub(b, a);
  const b2 = sub(c, b);
  const b3 = sub(d, c);
  const n1 = cross(b1, b2);
  const n2 = cross(b2, b3);
  const m1 = cross(n1, [b2[0] / norm(b2), b2[1] / norm(b2), b2[2] / norm(b2)]);
  const x = dot(n1, n2);
  const y = dot(m1, n2);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/** The signed CA(i)-C(i)-N(i+1)-CA(i+1) omega dihedral for a C(rPrev)-N(rNext) join. */
function omega(mol: ObjectMolecule, rPrev: number, rNext: number): number {
  const c = (name: string, r: number): V => mol.coord(nameIndex(mol, name, r), 1) as V;
  return dihedral(c('CA', rPrev), c('C', rPrev), c('N', rNext), c('CA', rNext));
}

/* --------------------------- attach_amino_acid -------------------------- */

describe('attach_amino_acid', () => {
  it('grows a glycine onto an alanine C-terminus with a ~1.33 Å peptide bond', () => {
    const ex = new Executive();
    ex.addMolecule(buildFragment('ala', 'm')!);
    const h = makeCtx(ex);
    const mol = ex.molecule('m')!;
    const before = mol.natom; // 5: N, CA, C, O, CB (no OXT, no H)
    expect(before).toBe(5);

    const ret = h.get('editor.attach_amino_acid')!(['m and name C', 'gly'], {});
    expect(ret).toBe('m');

    // gly fragment is 7 atoms (N, CA, C, O, H, HA, 3HA); nothing removed.
    expect(mol.natom).toBe(before + 7);

    // A new C(ala)–N(gly) peptide bond exists, ~1.33 Å.
    const cAla = nameIndex(mol, 'C', 1);
    const nGly = nameIndex(mol, 'N', 2);
    expect(cAla).toBeGreaterThanOrEqual(0);
    expect(nGly).toBeGreaterThanOrEqual(0);
    expect(bondBetween(mol, cAla, nGly)).toBe(true);
    const cn = dist(mol.coord(cAla, 1) as V, mol.coord(nGly, 1) as V);
    expect(cn).toBeGreaterThan(1.2);
    expect(cn).toBeLessThan(1.5);
    expect(cn).toBeCloseTo(1.33, 2);

    // The new residue is numbered one past the terminus.
    expect(mol.atoms[nGly]!.resv).toBe(2);
    expect(mol.atoms[nGly]!.resn).toBe('GLY');

    // The peptide is PLANAR-TRANS, not cis or arbitrary: omega ≈ ±180°. This is
    // the property the ~1.33 Å length alone cannot prove (that is fixed by the
    // superposition origin), so assert it explicitly.
    expect(Math.abs(omega(mol, 1, 2)), 'omega should be trans (~180)').toBeGreaterThan(170);
    // Ideal backbone bond angle C–N–CA ≈ 121.7° (rules out a garbage placement
    // whose atoms merely avoid the 0.7 Å clash floor).
    const cnca = angle(
      mol.coord(cAla, 1) as V,
      mol.coord(nGly, 1) as V,
      mol.coord(nameIndex(mol, 'CA', 2), 1) as V,
    );
    expect(cnca, 'C–N–CA angle').toBeGreaterThan(114);
    expect(cnca, 'C–N–CA angle').toBeLessThan(129);

    // No two atoms sit inside a bond length of each other (min real contact is
    // an O–H ~0.96 Å; a backbone clash would be well under that but the angle/
    // omega checks above are what actually rule out a wrong conformation).
    expect(minPairDistance(mol)).toBeGreaterThan(0.7);
  });

  it('grows a residue BACKWARD onto an N-terminus (resi decremented)', () => {
    const ex = new Executive();
    ex.addMolecule(buildFragment('ala', 'm')!);
    const h = makeCtx(ex);
    const mol = ex.molecule('m')!;
    // Selecting the backbone N grows the chain the other way: a new residue at
    // resv 0 whose C bonds to the existing N, again a trans ~1.33 Å peptide.
    h.get('editor.attach_amino_acid')!(['m and name N', 'gly'], {});
    const nAla = nameIndex(mol, 'N', 1);
    const cGly = nameIndex(mol, 'C', 0);
    expect(cGly, 'new residue numbered resv 0').toBeGreaterThanOrEqual(0);
    expect(mol.atoms[cGly]!.resn).toBe('GLY');
    expect(bondBetween(mol, cGly, nAla)).toBe(true);
    const cn = dist(mol.coord(cGly, 1) as V, mol.coord(nAla, 1) as V);
    expect(cn).toBeCloseTo(1.33, 2);
    expect(Math.abs(omega(mol, 0, 1)), 'backward omega trans').toBeGreaterThan(170);
    expect(minPairDistance(mol)).toBeGreaterThan(0.7);
  });

  it('falls back to the last object C-terminus when the selection is empty', () => {
    const ex = new Executive();
    ex.addMolecule(buildFragment('ala', 'm')!);
    const h = makeCtx(ex);
    const mol = ex.molecule('m')!;
    h.get('editor.attach_amino_acid')!(['', 'ala'], {});
    expect(mol.natom).toBe(5 + 10); // ALA fragment is 10 atoms
    expect(nameIndex(mol, 'N', 2)).toBeGreaterThanOrEqual(0);
    expect(bondBetween(mol, nameIndex(mol, 'C', 1), nameIndex(mol, 'N', 2))).toBe(true);
    expect(minPairDistance(mol)).toBeGreaterThan(0.7);
  });

  it('chains three residues, each with a valid peptide bond', () => {
    const ex = new Executive();
    ex.addMolecule(buildFragment('ala', 'm')!);
    const h = makeCtx(ex);
    const mol = ex.molecule('m')!;
    h.get('editor.attach_amino_acid')!(['m and name C', 'gly'], {});
    h.get('editor.attach_amino_acid')!(['m and name C', 'ala'], {});

    for (const [rPrev, rNext] of [
      [1, 2],
      [2, 3],
    ] as const) {
      const c = nameIndex(mol, 'C', rPrev);
      const n = nameIndex(mol, 'N', rNext);
      expect(bondBetween(mol, c, n)).toBe(true);
      const cn = dist(mol.coord(c, 1) as V, mol.coord(n, 1) as V);
      expect(cn).toBeCloseTo(1.33, 2);
      // Every peptide in the chain is trans — no drift/kink accumulates.
      expect(Math.abs(omega(mol, rPrev, rNext)), `omega ${rPrev}-${rNext}`).toBeGreaterThan(170);
    }
    expect(minPairDistance(mol)).toBeGreaterThan(0.7);
  });

  it('works across a spread of amino acids', () => {
    for (const aa of ['ala', 'gly', 'ser', 'phe', 'leu', 'val', 'trp', 'pro', 'lys']) {
      const ex = new Executive();
      ex.addMolecule(buildFragment('ala', 'm')!);
      const h = makeCtx(ex);
      const mol = ex.molecule('m')!;
      const before = mol.natom;
      h.get('editor.attach_amino_acid')!(['m and name C', aa], {});
      expect(mol.natom).toBeGreaterThan(before);
      const c = nameIndex(mol, 'C', 1);
      const n = nameIndex(mol, 'N', 2);
      expect(bondBetween(mol, c, n)).toBe(true);
      const cn = dist(mol.coord(c, 1) as V, mol.coord(n, 1) as V);
      expect(cn, `${aa} peptide bond`).toBeCloseTo(1.33, 2);
      expect(Math.abs(omega(mol, 1, 2)), `${aa} omega trans`).toBeGreaterThan(170);
      expect(minPairDistance(mol), `${aa} clash`).toBeGreaterThan(0.7);
    }
  });

  /* ------------------------------ error paths --------------------------- */

  it('throws on an unknown amino acid', () => {
    const ex = new Executive();
    ex.addMolecule(buildFragment('ala', 'm')!);
    const h = makeCtx(ex);
    expect(() => h.get('editor.attach_amino_acid')!(['m and name C', 'xyz'], {})).toThrow(
      /unknown amino acid/i,
    );
  });

  it('throws when there is no attachable backbone terminus', () => {
    const ex = new Executive();
    // A lone oxygen: no backbone N or C to attach to.
    const mol = new ObjMol('blob');
    mol.states.push(new Float32Array([0, 0, 0]));
    mol.atoms.push({
      id: 1,
      name: 'O1',
      resn: 'HOH',
      resi: '1',
      resv: 1,
      chain: 'A',
      segi: '',
      alt: '',
      elem: 'O',
      hetatm: true,
      b: 0,
      q: 1,
      color: 0,
      ss: '',
      visRep: defaultVisRep(),
    });
    ex.addMolecule(mol);
    const h = makeCtx(ex);
    expect(() => h.get('editor.attach_amino_acid')!(['', 'ala'], {})).toThrow(
      /attachable backbone terminus/i,
    );
  });
});

/* ----------------------------- build_peptide ---------------------------- */

describe('build_peptide', () => {
  it('builds a peptide from a one-letter sequence', () => {
    const ex = new Executive();
    const h = makeCtx(ex);
    const name = h.get('editor.build_peptide')!(['AGA'], {}) as string;
    const mol = ex.molecule(name)!;
    // Three residues present, resv 1..3.
    expect(nameIndex(mol, 'N', 1)).toBeGreaterThanOrEqual(0);
    expect(nameIndex(mol, 'N', 2)).toBeGreaterThanOrEqual(0);
    expect(nameIndex(mol, 'N', 3)).toBeGreaterThanOrEqual(0);
    // Two peptide bonds C(i)-N(i+1).
    expect(bondBetween(mol, nameIndex(mol, 'C', 1), nameIndex(mol, 'N', 2))).toBe(true);
    expect(bondBetween(mol, nameIndex(mol, 'C', 2), nameIndex(mol, 'N', 3))).toBe(true);
    expect(minPairDistance(mol)).toBeGreaterThan(0.7);
  });
});

/* ---------------------------- attach_fragment --------------------------- */

/* ---------------------- end-to-end through LocalBackend ----------------- */

describe('cmd.editor.attach_amino_acid — the real dispatch (the screenshot call)', () => {
  it('grows a residue via cmd.editor.* instead of throwing NotPorted', async () => {
    const b = new LocalBackend();
    await b.connect();
    await b.do('fragment ala');
    const before = (await b.call('count_atoms', ['all'])) as number;

    // The exact namespaced call that previously reported "not ported".
    const ret = await b.call('editor.attach_amino_acid', ['name C', 'gly']);
    expect(ret).not.toBeNull();
    const after = (await b.call('count_atoms', ['all'])) as number;
    expect(after).toBeGreaterThan(before); // atoms were actually added
    expect(await b.call('count_atoms', ['resn GLY'])).toBeGreaterThan(0);
  });

  it('also works typed into the console (editor.attach_amino_acid(...))', async () => {
    const b = new LocalBackend();
    await b.connect();
    await b.do('fragment ala');
    const before = (await b.call('count_atoms', ['all'])) as number;
    const seen: string[] = [];
    b.on('feedback', ({ lines }) => seen.push(...lines));
    // Typed as a JS console call — routes through the namespace proxy, not a
    // ReferenceError, and actually builds.
    await b.do("editor.attach_amino_acid('name C', 'gly')");
    expect(seen.join('\n')).not.toMatch(/not ported|is not defined/);
    expect((await b.call('count_atoms', ['all'])) as number).toBeGreaterThan(before);
  });
});

describe('attach_fragment', () => {
  it('loads a new object when the selection matches nothing', () => {
    const ex = new Executive();
    const h = makeCtx(ex);
    const name = h.get('editor.attach_fragment')!(['', 'ala'], {}) as string;
    const mol = ex.molecule(name)!;
    expect(mol.natom).toBe(10); // ALA fragment
  });

  it('grows a residue onto an existing terminus', () => {
    const ex = new Executive();
    ex.addMolecule(buildFragment('ala', 'm')!);
    const h = makeCtx(ex);
    const mol = ex.molecule('m')!;
    h.get('editor.attach_fragment')!(['m and name C', 'gly'], {});
    expect(mol.natom).toBe(5 + 7);
    expect(bondBetween(mol, nameIndex(mol, 'C', 1), nameIndex(mol, 'N', 2))).toBe(true);
  });
});
