/**
 * `bycell` selector (Selector.cpp SELE_BYX1): expands to every atom in the same
 * crystallographic unit cell (floor of fractional coordinates from CRYST1) as
 * the operand. Ground truth is the oracle (real PyMOL 3.2.0a) on 1tii.pdb; see
 * the committed probe selection__bycell.json.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LocalBackend } from '@tenmol/engine-ts';

const REPO = join(__dirname, '../../..');
const PDB = readFileSync(join(REPO, 'packages/engine/test/dat/1tii.pdb'), 'utf8');
const PEPT = readFileSync(join(REPO, 'packages/engine/test/dat/pept.pdb'), 'utf8');
const count = (b: LocalBackend, sel: string) => b.call('count_atoms', [sel]) as Promise<number>;

describe('bycell selector', () => {
  it('expands to atoms sharing the unit cell (needs a CRYST1 cell)', async () => {
    const b = new LocalBackend();
    await b.connect();
    await b.call('read_pdbstr', [PDB, 'm']);
    expect(await count(b, 'bycell (resi 5)')).toBe(5684);
    expect(await count(b, 'bycell (chain A)')).toBe(5397);
    b.close();
  });

  it('selects nothing for an object without a crystal cell', async () => {
    const b = new LocalBackend();
    await b.connect();
    await b.call('read_pdbstr', [PEPT, 'p']); // no CRYST1
    expect(await count(b, 'bycell (resi 5)')).toBe(0);
    b.close();
  });
});
