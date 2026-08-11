/**
 * RED PARITY TESTS — silent no-op verbs that should have an observable effect.
 *
 * Every verb exercised here is registered in `src/cmd/extras.ts` as a DOCUMENTED
 * NO-OP (returns null/0 without mutating state) — see the `noop([...])` batch and
 * the backlog entry "Large batch of documented no-op verbs" in
 * docs/engine-backlog.md. Real PyMOL gives each a concrete, observable effect;
 * these tests pin that effect so a later implementation wave has a target. They
 * FAIL today (TDD red) because the stubs do nothing.
 *
 * Expected values are derived from the vendored real-PyMOL source under
 * packages/engine/modules/pymol/ (editing.py, editor.py) — never invented.
 */
import { describe, it, expect } from 'vitest';
import { LocalBackend } from '@tenmol/engine-ts';
import { SMALL_PDB, makePdb } from './fixture';

async function boot() {
  const b = new LocalBackend();
  await b.connect();
  await b.call('read_pdbstr', [SMALL_PDB, 'm']);
  return b;
}

/** Signed smallest difference between two angles in degrees, in (-180, 180]. */
function angDiff(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

describe('parity: silent no-op verbs with observable effects', () => {
  it('edit: picking an atom creates the "pk1" named selection', async () => {
    const b = await boot();
    // PyMOL ref: editing.py:1080 `def edit(...)`. With ONE selection it "picks
    // an atom for editing" — i.e. it defines the named selection `pk1`
    // containing exactly that atom (see the `unpick`/`remove_picked`/`torsion`
    // family that all consume pk1). So after editing one atom, pk1 has 1 atom.
    await b.do('edit (m and name CB and chain A)');
    const pk1 = (await b.call('count_atoms', ['pk1'])) as number;
    expect(pk1).toBe(1); // RED today: `edit` is a no-op, pk1 is never defined (0)
  });

  it('remove_picked: deletes the atom picked for editing (count drops)', async () => {
    const b = await boot();
    // PyMOL ref: editing.py:839 `def remove_picked(...)` — "removes the atom or
    // bond currently picked for editing". CB carries no hydrogens in this model,
    // so deleting the single picked atom takes the object from 9 atoms to 8.
    expect(await b.call('count_atoms', ['all'])).toBe(9);
    await b.do('edit (m and name CB and chain A)');
    await b.call('remove_picked', [1]); // hydrogens=1 (default)
    const after = (await b.call('count_atoms', ['all'])) as number;
    expect(after).toBe(8); // RED today: remove_picked is a no-op, still 9
  });

  it('uniquify: renames a colliding chain id to a fresh one', async () => {
    // Two residues that BOTH sit on chain A: residue 1 (N,CA,C) and residue 2
    // (N,CA). uniquify('chain', 'resi 1') must make resi-1's chain unique with
    // respect to its complement (reference defaults to '!(resi 1)', i.e. resi 2).
    const pdb = makePdb([
      { serial: 1, name: 'N', resn: 'ALA', chain: 'A', resi: 1, x: 0.0, y: 0.0, z: 0.0, elem: 'N' },
      { serial: 2, name: 'CA', resn: 'ALA', chain: 'A', resi: 1, x: 1.458, y: 0.0, z: 0.0, elem: 'C' },
      { serial: 3, name: 'C', resn: 'ALA', chain: 'A', resi: 1, x: 2.0, y: 1.42, z: 0.0, elem: 'C' },
      { serial: 4, name: 'N', resn: 'ALA', chain: 'A', resi: 2, x: 3.33, y: 1.5, z: 0.0, elem: 'N' },
      { serial: 5, name: 'CA', resn: 'ALA', chain: 'A', resi: 2, x: 4.0, y: 2.79, z: 0.0, elem: 'C' },
    ]);
    const b = new LocalBackend();
    await b.connect();
    await b.call('read_pdbstr', [pdb, 'u']);
    // PyMOL ref: editing.py:3052 `def uniquify(identifier, selection, ...)` with
    // editing.py:_base (uppercase+digits, counting from 0): the intersection {A}
    // gets the first free code — 'A' is taken, so resi-1's chain becomes 'B'.
    await b.call('uniquify', ['chain', 'resi 1']);
    expect(await b.call('count_atoms', ['u and chain B'])).toBe(3); // RED: still on A
    expect(await b.call('count_atoms', ['u and chain A'])).toBe(2); // resi 2 keeps A
  });

  it('fab: builds a peptide object from a one-letter sequence', async () => {
    const b = new LocalBackend();
    await b.connect();
    // PyMOL ref: editor.py:1062 `def fab(input, name, mode='peptide', ...)` —
    // "Build a peptide" from the one-letter code. 'AG' -> an ALA + GLY dipeptide,
    // so the new object 'pep' has two CA atoms, one ALA and one GLY residue.
    await b.call('fab', ['AG', 'pep']);
    expect(await b.call('count_atoms', ['pep and name CA'])).toBe(2); // RED: nothing built
    expect(await b.call('count_atoms', ['pep and resn ALA and name CA'])).toBe(1);
    expect(await b.call('count_atoms', ['pep and resn GLY and name CA'])).toBe(1);
  });

  it.fails('fnab: builds a nucleic-acid object from a sequence', async () => {
    const b = new LocalBackend();
    await b.connect();
    // PyMOL ref: editor.py `def fnab(input, name, mode='DNA', form='B',
    // dbl_helix=1)` and `_fnab`: DNA residues are named "D"+base (editor.py:433,
    // `new_name = "D" + new_name`). A single-strand 'AT' (dbl_helix=0) is two
    // nucleotides — one DA and one DT — each a full sugar-phosphate residue.
    await b.call('fnab', ['AT', 'na', 'DNA', 'B', 0]);
    expect(await b.call('count_atoms', ['na and resn DA'])).toBeGreaterThan(0); // RED: 0
    expect(await b.call('count_atoms', ['na and resn DT'])).toBeGreaterThan(0);
  });

  it('torsion: rotates the picked torsion by the given angle', async () => {
    const b = await boot();
    // PyMOL ref: editing.py:1135 `def torsion(angle)` — "rotates the torsion on
    // the bond currently picked for editing". Pick the CA-C backbone bond (its
    // CA side carries N and CB), then torsion 30 rotates that fragment 30 deg,
    // so the N-CA-C-O dihedral shifts by exactly 30 degrees.
    const before = (await b.call('get_dihedral', [
      'm and name N and chain A',
      'm and name CA and chain A',
      'm and name C and chain A',
      'm and name O and chain A',
    ])) as number;
    await b.do('edit (m and name CA and chain A), (m and name C and chain A)');
    await b.do('torsion 30');
    const after = (await b.call('get_dihedral', [
      'm and name N and chain A',
      'm and name CA and chain A',
      'm and name C and chain A',
      'm and name O and chain A',
    ])) as number;
    expect(Math.abs(angDiff(after, before))).toBeCloseTo(30, 1); // RED: no-op, delta 0
  });
});
