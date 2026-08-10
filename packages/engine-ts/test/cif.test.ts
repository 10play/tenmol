/**
 * mmCIF/CIF loader tests — exercise the `_atom_site` parser against real PDB
 * mmCIF fixtures (single-model, multi-model, DNA) and assert the resulting
 * {@link ObjectMolecule} has the shape the executive expects: a full atom table,
 * distance-inferred bonds, canonicalised elements, finite coordinates and one
 * state per `pdbx_PDB_model_num`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCif } from '../src/model/cif';
import type { ObjectMolecule } from '../src/model/molecule';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const load = (rel: string, name: string): ObjectMolecule =>
  parseCif(readFileSync(join(REPO, 'packages', 'engine', 'testing', 'data', rel), 'utf8'), name);

/** Every coordinate in every state is a finite number. */
function coordsFinite(mol: ObjectMolecule): boolean {
  return mol.states.every((s) => s.every((v) => Number.isFinite(v)));
}

describe('parseCif — single-model mmCIF', () => {
  for (const rel of ['1k5e.cif', '1pup.cif']) {
    it(`parses ${rel} into a populated atom table`, () => {
      const mol = load(rel, rel.replace('.cif', ''));
      expect(mol.natom).toBeGreaterThan(0);
      expect(mol.bonds.length).toBeGreaterThan(0);
      expect(mol.states).toHaveLength(1);
      expect(mol.states[0]!.length).toBe(mol.natom * 3);
      expect(coordsFinite(mol)).toBe(true);
      // Elements are canonicalised (title-case); a protein/DNA has carbon.
      expect(mol.atoms.map((a) => a.elem)).toContain('C');
      // resn/chain are populated for essentially every atom.
      expect(mol.atoms.every((a) => a.resn !== '')).toBe(true);
      expect(mol.atoms.every((a) => a.chain !== '')).toBe(true);
      // ids are 1-based load order.
      expect(mol.atoms[0]!.id).toBe(1);
      expect(mol.atoms.at(-1)!.id).toBe(mol.natom);
    });
  }

  it('reads the crystal cell + space group from 1pup.cif', () => {
    const mol = load('1pup.cif', '1pup');
    expect(mol.cell).toBeDefined();
    expect(mol.cell!.a).toBeCloseTo(17.97, 2);
    expect(mol.cell!.gamma).toBeCloseTo(82.5, 2);
    expect(mol.spacegroup).toBeTruthy();
  });
});

describe('parseCif — DNA / small structure', () => {
  it('parses 1bna.cif (no auth_seq_id — falls back to label_seq_id)', () => {
    const mol = load('1bna.cif', '1bna');
    expect(mol.natom).toBeGreaterThan(0);
    expect(mol.bonds.length).toBeGreaterThan(0);
    expect(coordsFinite(mol)).toBe(true);
    // DNA residue names (DC/DG/DA/DT) come through resn.
    expect(mol.atoms.some((a) => /^D[ACGT]$/.test(a.resn))).toBe(true);
    // resv is numeric and set from label_seq_id when auth_seq_id is absent.
    expect(mol.atoms.some((a) => a.resv > 0)).toBe(true);
    // Cell present in 1bna.
    expect(mol.cell).toBeDefined();
    expect(mol.spacegroup).toBe('P 21 21 21');
  });
});

describe('parseCif — multi-model mmCIF', () => {
  it('splits 1v5a-3models.cif into 3 states sharing one atom table', () => {
    const mol = load('1v5a-3models.cif', '1v5a');
    expect(mol.states).toHaveLength(3);
    expect(mol.natom).toBeGreaterThan(0);
    // Every state has exactly the first model's atom count.
    for (const s of mol.states) expect(s.length).toBe(mol.natom * 3);
    expect(mol.bonds.length).toBeGreaterThan(0);
    expect(coordsFinite(mol)).toBe(true);
    // Distinct models really carry distinct coordinates.
    expect(Array.from(mol.states[0]!)).not.toEqual(Array.from(mol.states[1]!));
  });
});
