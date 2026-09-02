/**
 * `donor`/`acceptor` (+ `don.`/`acc.`/`hbd.`/`hba.`/plural) selectors, backed by
 * PyMOL's H-bond chemistry perception ported in
 * packages/engine-ts/src/model/chem-perception.ts (InferChemFromBonds →
 * InferHBondFromChem). Ground truth is the oracle (real PyMOL 3.2.0a) on
 * 1tii.pdb; see the committed probes selection__donors/acceptors.json.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LocalBackend } from '@tenmol/engine-ts';

const REPO = join(__dirname, '../../..');
const PDB = readFileSync(join(REPO, 'packages/engine/test/dat/1tii.pdb'), 'utf8');
const count = (b: LocalBackend, sel: string) => b.call('count_atoms', [sel]) as Promise<number>;

describe('donor / acceptor perception', () => {
  it('matches PyMOL hb_donor/hb_acceptor, not the raw N/O element heuristic', async () => {
    const b = new LocalBackend();
    await b.connect();
    await b.call('read_pdbstr', [PDB, 'm']);
    // Perceived totals (element heuristic would give 2234 / 2279).
    expect(await count(b, 'donor')).toBe(1276);
    expect(await count(b, 'acceptor')).toBe(1282);
    // Aliases.
    expect(await count(b, 'don.')).toBe(1276);
    expect(await count(b, 'hbd.')).toBe(1276);
    expect(await count(b, 'acceptors')).toBe(1282);
    expect(await count(b, 'hba.')).toBe(1282);
    // Breakdowns: carbonyl O accepts but does not donate; amide N donates.
    expect(await count(b, 'acceptor and elem O')).toBe(1278);
    expect(await count(b, 'acceptor and elem N')).toBe(4);
    expect(await count(b, 'donor and name N')).toBe(684);
    // Backbone carbonyl O never donates; the O-named donors are the 215 waters.
    expect(await count(b, 'donor and name O and not solvent')).toBe(0);
    expect(await count(b, 'donor and name O')).toBe(215);
    b.close();
  });
});
