/**
 * `state N` selector — port of Selector.cpp SELE_STAs: an atom matches when its
 * object owns a coordinate set for the 1-based state N (present in that state);
 * `-1` is the current state. Ground truth is the oracle (real PyMOL 3.2.0a); see
 * the committed probe selection__state.json.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LocalBackend } from '@tenmol/engine-ts';

const REPO = join(__dirname, '../../..');
const PEPT = readFileSync(join(REPO, 'packages/engine/test/dat/pept.pdb'), 'utf8');

const count = (b: LocalBackend, sel: string) => b.call('count_atoms', [sel]) as Promise<number>;

describe('state selector', () => {
  it('matches per-object coordinate-state presence', async () => {
    const b = new LocalBackend();
    await b.connect();
    await b.call('read_pdbstr', [PEPT, 'p']);
    await b.call('create', ['multi', 'p', 1, 1]);
    await b.call('create', ['multi', 'p', 1, 2]);
    await b.call('create', ['multi', 'p', 1, 3]);
    const natom = (await count(b, 'p')) as number;

    expect(await count(b, 'multi and state 1')).toBe(natom);
    expect(await count(b, 'multi and state 3')).toBe(natom);
    // Beyond the object's state count nothing is present.
    expect(await count(b, 'multi and state 4')).toBe(0);
    // A single-state object contributes nothing to state 2.
    expect(await count(b, 'p and state 2')).toBe(0);
    // state -1 is the current state: every atom of a loaded object.
    expect(await count(b, 'p and state -1')).toBe(natom);
    b.close();
  });
});
