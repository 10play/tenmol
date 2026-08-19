/**
 * `byfragment`/`byfrag`/`bf.` selector (Selector.cpp SELE_BYF1): expands to the
 * editor's picked fragments (EditorGetNFrag). engine-ts models no editor
 * fragments, so — exactly like PyMOL with no fragments defined — it selects
 * nothing, and must NOT behave like `bymolecule`. Ground truth is the oracle;
 * see the committed probe selection__byfragment.json.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LocalBackend } from '@tenmol/engine-ts';

const REPO = join(__dirname, '../../..');
const PDB = readFileSync(join(REPO, 'packages/engine/test/dat/1tii.pdb'), 'utf8');
const count = (b: LocalBackend, sel: string) => b.call('count_atoms', [sel]) as Promise<number>;

describe('byfragment selector', () => {
  it('selects nothing without editor fragments, and is not bymolecule', async () => {
    const b = new LocalBackend();
    await b.connect();
    await b.call('read_pdbstr', [PDB, 'm']);
    expect(await count(b, 'byfragment (resi 5)')).toBe(0);
    expect(await count(b, 'byfrag (chain A)')).toBe(0);
    expect(await count(b, 'bf. (all)')).toBe(0);
    // bymolecule is unaffected and still expands the connected molecule.
    expect(await count(b, 'bymolecule (resi 5)')).toBe(4071);
    b.close();
  });
});
