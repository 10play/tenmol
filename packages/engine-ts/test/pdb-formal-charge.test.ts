/**
 * Native formal-charge perception on PDB load — the TS port of
 * `assign_pdb_known_residue` (packages/engine/layer2/ObjectMolecule2.cpp:837).
 *
 * A plain PDB has no charge column, yet real PyMOL assigns integer formal
 * charges to the ionisable atoms of standard residues while it perceives
 * connectivity. Ground truth is the oracle (real PyMOL 3.2.0a) on
 * packages/engine/test/dat/1tii.pdb: 69 atoms at fc=+1 (ARG NH1 ×44, LYS NZ ×25)
 * and 74 at fc=-1 (ASP OD2 ×38, GLU OE2 ×36). Verified by the committed probe
 * packages/graph/verify/probes/selection__formal_charge.json.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LocalBackend } from '@tenmol/engine-ts';

const REPO = join(__dirname, '../../..');
const PDB = readFileSync(join(REPO, 'packages/engine/test/dat/1tii.pdb'), 'utf8');

async function boot() {
  const b = new LocalBackend();
  await b.connect();
  await b.call('read_pdbstr', [PDB, 'm']);
  return b;
}
const count = (b: LocalBackend, sel: string) => b.call('count_atoms', [sel]) as Promise<number>;

describe('PDB native formal-charge perception (1tii)', () => {
  it('assigns +1 to LYS NZ and ARG NH1', async () => {
    const b = await boot();
    expect(await count(b, 'formal_charge = 1')).toBe(69);
    expect(await count(b, 'fc. = 1 and name NZ and resn LYS')).toBe(25);
    expect(await count(b, 'fc. = 1 and name NH1 and resn ARG')).toBe(44);
    // NH2 is explicitly forced back to 0 (PYMOL-5019).
    expect(await count(b, 'fc. = 0 and name NH2 and resn ARG')).toBe(44);
    b.close();
  });

  it('assigns -1 to ASP OD2 and GLU OE2 carboxylate oxygens', async () => {
    const b = await boot();
    expect(await count(b, 'formal_charge < 0')).toBe(74);
    expect(await count(b, 'fc. = -1 and name OD2 and resn ASP')).toBe(38);
    expect(await count(b, 'fc. = -1 and name OE2 and resn GLU')).toBe(36);
    b.close();
  });

  it('leaves waters and other atoms neutral', async () => {
    const b = await boot();
    expect(await count(b, 'formal_charge = 0')).toBe(5684 - 69 - 74);
    expect(await count(b, 'fc. != 0 and solvent')).toBe(0);
    b.close();
  });
});
