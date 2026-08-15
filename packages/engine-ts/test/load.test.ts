/**
 * The real `load` verb and the `read_<fmt>str` convenience verbs: structured
 * content of every supported format (PDB/CIF/MOL/SDF/MOL2/XYZ) reaches the
 * executive as a molecule, dispatched by an explicit format or by sniffing.
 * Plus `get_str('xyz', ...)` round-trips coordinates back out.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { LocalBackend } from '@tenmol/engine-ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DATA = join(REPO, 'packages', 'engine', 'testing', 'data');
const read = (rel: string): string => readFileSync(join(DATA, rel), 'utf8');

async function boot() {
  const b = new LocalBackend();
  await b.connect();
  return b;
}

describe('load — explicit format', () => {
  it('loads a CIF by explicit format', async () => {
    const b = await boot();
    const name = await b.call('load', [read('1pup.cif'), 'p', 0, 'cif']);
    expect(name).toBe('p');
    expect(await b.call('count_atoms', ['all'])).toBe(338);
  });

  it('loads a MOL2 by explicit format', async () => {
    const b = await boot();
    await b.call('load', [read('ligs3d.mol2'), 'lig', 0, 'mol2']);
    // ligs3d.mol2 holds 10 MOLECULE blocks; PyMOL reads them all into one
    // discrete multi-state object (verified against the real-PyMOL oracle:
    // count_atoms=337, count_states=10, count_discrete=1).
    expect(await b.call('count_atoms', ['all'])).toBe(337);
  });

  it('loads an XYZ by explicit format', async () => {
    const b = await boot();
    await b.call('load', [read('elements.xyz'), 'x', 0, 'xyz']);
    expect(await b.call('count_atoms', ['all'])).toBe(113);
  });
});

describe('load — format sniffing (no explicit format)', () => {
  it('sniffs CIF from content', async () => {
    const b = await boot();
    await b.call('load', [read('1pup.cif'), 'p']);
    expect(await b.call('count_atoms', ['all'])).toBe(338);
  });

  it('sniffs MOL2 from the @<TRIPOS> marker', async () => {
    const b = await boot();
    await b.call('load', [read('ligs3d.mol2'), 'lig']);
    // All 10 MOLECULE blocks are read into one object (337 atoms total); see
    // the explicit-format case above.
    expect(await b.call('count_atoms', ['all'])).toBe(337);
  });

  it('rejects a bare path with an honest filesystem error', async () => {
    const b = await boot();
    await expect(b.call('load', ['1abc.pdb'])).rejects.toThrow(/no filesystem/);
  });
});

describe('read_<fmt>str convenience verbs', () => {
  it('read_cifstr / read_mol2str / read_xyzstr each load one object', async () => {
    const b = await boot();
    await b.call('read_cifstr', [read('1pup.cif'), 'c']);
    await b.call('read_mol2str', [read('ligs3d.mol2'), 'm']);
    await b.call('read_xyzstr', [read('elements.xyz'), 'x']);
    expect(await b.call('get_names', ['objects'])).toEqual(['c', 'm', 'x']);
  });
});

describe('get_str xyz round-trip', () => {
  it('serializes loaded coordinates back to an XYZ block', async () => {
    const b = await boot();
    await b.call('load', [read('elements.xyz'), 'x', 0, 'xyz']);
    const xyz = (await b.call('get_str', ['xyz', 'all'])) as string;
    const lines = xyz.trim().split('\n');
    expect(Number(lines[0])).toBe(113);
    // Every atom row is `elem x y z`.
    expect(lines.length).toBe(113 + 2);
    expect(lines[2]).toMatch(/^\S{1,2}\s+-?\d/);
  });
});
