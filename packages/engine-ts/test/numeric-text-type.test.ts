/**
 * `numeric_type`/`nt.` and `text_type`/`tt.` selectors — ports of Selector.cpp
 * SELE_NTYs (WordMatchInteger on `customType`) and SELE_TTYs (alpha/wildcard list
 * on `textType`), with the matching `alter` write-back (P.cpp ATOM_PROP_*).
 *
 * Ground truth is the oracle (real PyMOL 3.2.0a) on 1tii.pdb; see the committed
 * probes selection__numeric_type.json / selection__text_type.json.
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

describe('numeric_type / nt. selector', () => {
  it('matches customType as an integer list/range set by alter', async () => {
    const b = await boot();
    await b.call('alter', ['resi 1-10', 'numeric_type=7']);
    await b.call('alter', ['resi 11-20', 'numeric_type=8']);
    expect(await count(b, 'numeric_type 7')).toBe(482);
    expect(await count(b, 'nt. 8')).toBe(445);
    expect(await count(b, 'numeric_type 7+8')).toBe(927);
    expect(await count(b, 'numeric_type 5-9')).toBe(927);
    // Untouched atoms carry the NoType sentinel and never match a query.
    expect(await count(b, 'numeric_type 0')).toBe(0);
    b.close();
  });
});

describe('text_type / tt. selector', () => {
  it('matches textType as an alpha/wildcard list set by alter', async () => {
    const b = await boot();
    await b.call('alter', ['resi 1-5', "text_type='C.ar'"]);
    await b.call('alter', ['name CA', "text_type='C.3'"]);
    expect(await count(b, 'text_type C.ar')).toBe(200);
    expect(await count(b, 'tt. C.3')).toBe(712);
    expect(await count(b, 'text_type C.*')).toBe(912);
    b.close();
  });
});
