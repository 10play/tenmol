/**
 * `delocalized`/`deloc.` selector (Selector.cpp SELE_DESz): atoms whose
 * explicit degree ÷ explicit valence is non-integer — i.e. they carry a
 * partial/multiple bond. Exercises the bond-order half of the
 * assign_pdb_known_residue port (packages/engine-ts/src/model/pdb-chem.ts).
 * Ground truth is the oracle (real PyMOL 3.2.0a) on 1tii.pdb; see the committed
 * probe selection__delocalized.json.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LocalBackend } from '@tenmol/engine-ts';

const REPO = join(__dirname, '../../..');
const PDB = readFileSync(join(REPO, 'packages/engine/test/dat/1tii.pdb'), 'utf8');
const count = (b: LocalBackend, sel: string) => b.call('count_atoms', [sel]) as Promise<number>;

describe('delocalized selector', () => {
  it('selects atoms in multiple/aromatic bonds via perceived bond orders', async () => {
    const b = new LocalBackend();
    await b.connect();
    await b.call('read_pdbstr', [PDB, 'm']);
    expect(await count(b, 'delocalized')).toBe(2427);
    expect(await count(b, 'deloc.')).toBe(2427);
    // Backbone carbonyl O (C=O double bond) — one per residue.
    expect(await count(b, 'delocalized and name O')).toBe(927);
    // Aromatic rings and guanidinium.
    expect(await count(b, 'delocalized and resn PHE')).toBe(152);
    expect(await count(b, 'delocalized and name NH1 and resn ARG')).toBe(44);
    // An all-single-bond atom (e.g. CB of ALA) is NOT delocalized.
    expect(await count(b, 'delocalized and name CB and resn ALA')).toBe(0);
    b.close();
  });
});
