/**
 * RED parity tests — `editor.*` builder: nucleic acids & low-level topology.
 *
 * These pin what REAL PyMOL does for build/edit verbs the TS port either throws
 * `NotPorted` for, registers as a silent no-op, or implements only approximately
 * (`cmd/builder.ts`). Every expected value is derived from the vendored PyMOL
 * source under `packages/engine/modules/pymol/` (editor.py / editing.py) and is
 * the DESIRED result, so each test FAILS today and documents the parity target.
 *
 * Verbs that currently `throw` NotPorted (attach_nuc_acid, extend_nuc_acid,
 * bond_single_stranded, bond_double_stranded, combine_fragment) are
 * wrapped in try/catch so the test still runs to its observable assertion; the
 * post-condition (nothing was built) is what makes it red.
 *
 * DEFERRED (it.fails / xfail): the nucleic-acid builders (fnab/attach/extend/
 * bond_ss/ds), combine_fragment (fuse) and the valence-chemistry edits
 * (protonate/replace/cycle_valence/set_geometry/invert) need subsystems the port
 * lacks — a nucleic monomer-geometry library and a bond-order/valence-perception
 * engine. They are `it.fails` so CI stays green while the parity target stays
 * pinned; flip each back to `it(` when its subsystem lands. `fab` and `torsion`
 * are real (plain `it`).
 */
import { describe, expect, it } from 'vitest';

import { LocalBackend } from '@tenmol/engine-ts';
import { SMALL_PDB } from './fixture';

/** Backend with the 9-atom ALA(A/1)+GLY(B/2) di-peptide loaded as object `m`. */
async function boot(): Promise<LocalBackend> {
  const b = new LocalBackend();
  await b.connect();
  await b.call('read_pdbstr', [SMALL_PDB, 'm']);
  return b;
}

/** Backend with nothing loaded (for the from-sequence builders). */
async function bootEmpty(): Promise<LocalBackend> {
  const b = new LocalBackend();
  await b.connect();
  return b;
}

/** Run a verb that may throw NotPorted; swallow so the test reaches its assert. */
async function attempt(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    /* verb not ported yet — the post-condition assertion is what makes it red */
  }
}

const count = (b: LocalBackend, sel: string): Promise<number> =>
  b.call('count_atoms', [sel]) as Promise<number>;

describe('parity: editor.* nucleic-acid builders', () => {
  it.fails('fnab: builds one nucleotide per input letter (single strand)', async () => {
    const b = await bootEmpty();
    // PyMOL ref: editor.py fnab() (line ~1100) loops over `input` calling
    // attach_nuc_acid once per one-letter code, growing an object of that length.
    // 'ATGC' single-stranded (dbl_helix=0) => 4 residues => 4 sugar C1' atoms.
    await attempt(() => b.call('fnab', ['ATGC', 'dna1', 'DNA', 'B', 0]));
    expect(await count(b, "dna1 and name C1'")).toBe(4); // RED: no-op builds nothing
  });

  it.fails('attach_nuc_acid / extend_nuc_acid: grows a phosphodiester-linked dimer', async () => {
    const b = await bootEmpty();
    // PyMOL ref: editor.py attach_nuc_acid() (line ~789) builds the first
    // nucleotide; a second call routes through extend_nuc_acid() (line ~856) to
    // add and backbone-bond the next base. Two adenines => two sugar C1' atoms.
    await attempt(() => b.call('attach_nuc_acid', ['?pk1', 'atp', 'DNA', 'na', 'B']));
    await attempt(() => b.call('attach_nuc_acid', ['?pk1', 'atp', 'DNA', 'na', 'B']));
    expect(await count(b, "na and name C1'")).toBe(2); // RED: throws NotPorted
  });

  it.fails('bond_single_stranded / bond_double_stranded: double helix gets the complement strand', async () => {
    const b = await bootEmpty();
    // PyMOL ref: editor.py bond_single_stranded() (line ~708) closes each strand's
    // O3'(i)->P(i+1) backbone; bond_double_stranded() (line ~740) builds and pairs
    // the antiparallel complement. 'AT' with dbl_helix=1 => 2 bases x 2 strands =
    // 4 sugar C1' atoms.
    await attempt(() => b.call('fnab', ['AT', 'ds', 'DNA', 'B', 1]));
    expect(await count(b, "ds and name C1'")).toBe(4); // RED: no-op builds nothing
  });
});

describe('parity: editor.* peptide & fragment builders', () => {
  it('fab: builds a peptide with one CA per residue of the sequence', async () => {
    const b = await bootEmpty();
    // PyMOL ref: editor.py fab()/_fab() (line ~1062/325) expand a one-letter code
    // into fragments and attach_amino_acid each. 'ACD' => ALA-CYS-ASP => 3 CA.
    await attempt(() => b.call('fab', ['ACD', 'pep']));
    expect(await count(b, 'pep and name CA')).toBe(3); // RED: no-op builds nothing
  });

  it.fails('combine_fragment: fuses a fragment INTO the object, adding its atoms', async () => {
    const b = await boot();
    // PyMOL ref: editor.py combine_fragment() (line ~88) loads `fragment` and
    // `fuse(..., mode 3)` joins it to the selection's object WITHOUT consuming an
    // atom, so the object gains the fragment's atoms.
    await attempt(() => b.call('combine_fragment', ['m and name CB', 'ala', 0, 0]));
    expect(await count(b, 'm')).toBeGreaterThan(9); // RED: throws NotPorted, stays 9
  });
});

describe('parity: editor.* low-level topology edits', () => {
  it('protonate / h_fix: a backbone carbonyl oxygen is never protonated', async () => {
    const b = await boot();
    // PyMOL ref: editing.py protonate()/h_add() fill each atom to its perceived
    // valence. Backbone carbonyl O is double-bonded (valence 2 satisfied) so it
    // gets ZERO hydrogens. The TS port ignores the C=O double bond and wrongly
    // adds one H to every O.
    await b.call('protonate', ['m']);
    expect(await count(b, 'elem H and neighbor name O')).toBe(0); // RED: TS adds 2
  });

  it('replace: strips old H and refills the new element to a valid valence', async () => {
    const b = await boot();
    // PyMOL ref: editing.py replace() (line ~1572) with h_fill=1 removes the
    // picked atom's neighbour hydrogens, then _cmd.replace re-fills to the given
    // valence. CB (a methyl, 3 H) -> N (valence 3, one heavy bond to CA) becomes
    // an -NH2: exactly 2 hydrogens. The TS port only swaps element/name.
    await b.call('protonate', ['m and name CB']); // CB methyl => 3 H (both engines)
    await b.call('replace', ['N', 4, 3], { name: '', selection: 'm and name CB' });
    expect(await count(b, 'elem H')).toBe(2); // RED: TS keeps the 3 methyl H
  });

  it('cycle_valence: promoting CA=CB to a double bond removes a methyl H (h_fill)', async () => {
    const b = await boot();
    // PyMOL ref: editing.py cycle_valence() (line ~876) cycles the bond order and,
    // with h_fill=1 (default), calls h_fill so hydrogens satisfy the new valence.
    // CA=CB double bond => CB (valence 4) now has bond-order-sum 2 => 4-2 = 2 H,
    // one fewer than its methyl 3. The TS port changes the order but never h_fills.
    await b.call('protonate', ['m and name CB']); // CB => 3 H
    await b.call('cycle_valence', ['m and name CA and resi 1', 'm and name CB']);
    expect(await count(b, 'elem H and neighbor name CB')).toBe(2); // RED: TS leaves 3
  });

  it('set_geometry: raising an amide N to valence 4 makes h_add place two H', async () => {
    const b = await boot();
    // PyMOL ref: editing.py set_geometry() (line ~473) changes the assumed valence
    // /geometry of the atoms; a later h_add then fills to the NEW valence. Forcing
    // the GLY amide N (2 heavy neighbours) to valence 4 => 4-2 = 2 hydrogens. The
    // TS port registers set_geometry as a no-op, so h_add still sees valence 3 (1 H).
    await b.call('set_geometry', ['m and name N and resi 2', 4, 4]);
    await b.call('h_add', ['m and name N and resi 2']);
    expect(await count(b, 'elem H and neighbor (name N and resi 2)')).toBe(2); // RED: 1
  });

  it('invert: stereo inversion about CA is rigid — bond lengths are preserved', async () => {
    const b = await boot();
    // PyMOL ref: editing.py invert() (line ~739) inverts stereochemistry "holding
    // attached atoms immobile" — a rigid reflection that never changes a bond
    // length. |CA-N| must stay 1.458 A. The TS port instead swaps the raw
    // coordinates of the two lightest neighbours (H<->N), which corrupts |CA-N|.
    await b.call('protonate', ['m and resi 1']); // give CA its HA so a swap moves N
    await b.call('invert', ['m and name CA and resi 1']);
    const d = (await b.call('get_distance', [
      'm and name CA and resi 1',
      'm and name N and resi 1',
    ])) as number;
    expect(d).toBeCloseTo(1.458, 1); // RED: TS collapses it toward the C-H length
  });

  it('torsion / set_dihedral: torsion(angle) advances the picked bond dihedral', async () => {
    const b = await boot();
    // PyMOL ref: editing.py torsion() (line ~1135) rotates the torsion on the
    // currently picked bond by `angle` degrees. Picking the ALA CA-C bond and
    // torsion(45) must change psi (N-CA-C-N') by 45 deg. torsion throws NotPorted
    // and edit is a no-op in the port, so psi does not move.
    const psiSel = [
      'm and name N and resi 1',
      'm and name CA and resi 1',
      'm and name C and resi 1',
      'm and name N and resi 2',
    ] as const;
    const before = (await b.call('get_dihedral', [...psiSel])) as number;
    await b.do('edit m and name CA and resi 1, m and name C and resi 1');
    await attempt(() => b.call('torsion', [45.0]));
    const after = (await b.call('get_dihedral', [...psiSel])) as number;
    const delta = Math.abs(((after - before + 540) % 360) - 180);
    expect(delta).toBeCloseTo(45, 0); // RED: torsion unported, delta stays 0
  });
});
