/**
 * Tests for the `preset.*` command subsystem (packages/engine-ts/src/cmd/preset.ts).
 *
 * Presets are pure orchestration, so we assert their *visible* effect through
 * the full engine: boot a LocalBackend, load a structure, run a preset, then
 * read back rep membership with `count_atoms('rep <rep>')` (and a couple of
 * settings). Every registered `preset.*` verb is also exercised in a loop to
 * prove it is callable without throwing — the presets swallow only the
 * not-yet-ported verbs/grammar internally, never a real error.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { LocalBackend } from '@tenmol/engine-ts';
import { SMALL_PDB } from './fixture';

/** A richer, real single-chain peptide (CYS/ASP/... with b-factors). */
const PEPT_PDB = readFileSync(
  new URL('../../../apps/web/public/visual/pept.pdb', import.meta.url),
  'utf8',
);

async function boot(pdb: string = SMALL_PDB): Promise<LocalBackend> {
  const b = new LocalBackend();
  await b.connect();
  await b.call('read_pdbstr', [pdb, 'm']);
  return b;
}

const count = async (b: LocalBackend, sel: string): Promise<number> =>
  Number(await b.call('count_atoms', [sel]));

/** Every `preset.*` verb, so the "callable" loop covers the whole namespace. */
const PRESET_NAMES = [
  'simple',
  'simple_no_solv',
  'ligands',
  'ligand_cartoon',
  'ligand_sites',
  'ligand_sites_hq',
  'ligand_sites_trans',
  'ligand_sites_trans_hq',
  'ligand_sites_mesh',
  'ligand_sites_dots',
  'ball_and_stick',
  'b_factor_putty',
  'technical',
  'pretty',
  'pretty_solv',
  'pretty_no_solv',
  'publication',
  'pub_solv',
  'pub_no_solv',
  'default',
  'interface',
  'classified',
];

describe('preset.*', () => {
  it('every preset is callable without throwing', async () => {
    for (const name of PRESET_NAMES) {
      const b = await boot();
      await expect(b.call(`preset.${name}`, ['all'])).resolves.not.toThrow();
    }
  });

  it('simple: shows ribbon over the whole structure', async () => {
    const b = await boot();
    await b.call('preset.simple', ['all']);
    expect(await count(b, 'rep ribbon')).toBeGreaterThan(0);
  });

  it('pretty: shows cartoon', async () => {
    const b = await boot();
    await b.call('preset.pretty', ['all']);
    expect(await count(b, 'rep cartoon')).toBeGreaterThan(0);
  });

  it('ball_and_stick: shows both sticks and spheres', async () => {
    const b = await boot();
    await b.call('preset.ball_and_stick', ['all']);
    expect(await count(b, 'rep sticks')).toBeGreaterThan(0);
    expect(await count(b, 'rep spheres')).toBeGreaterThan(0);
  });

  it('technical: shows ribbon and nonbonded', async () => {
    const b = await boot();
    await b.call('preset.technical', ['all']);
    expect(await count(b, 'rep ribbon')).toBeGreaterThan(0);
    expect(await count(b, 'rep nonbonded')).toBeGreaterThan(0);
  });

  it('default: shows lines and nonbonded', async () => {
    const b = await boot();
    await b.call('preset.default', ['all']);
    expect(await count(b, 'rep lines')).toBeGreaterThan(0);
    expect(await count(b, 'rep nonbonded')).toBeGreaterThan(0);
  });

  it('b_factor_putty: cartoons the CA trace and sets putty cartoon type', async () => {
    const b = await boot(PEPT_PDB);
    await b.call('preset.b_factor_putty', ['all']);
    // Only the CA/P backbone atoms get the cartoon rep.
    const cartoon = await count(b, 'rep cartoon');
    expect(cartoon).toBeGreaterThan(0);
    expect(cartoon).toBe(await count(b, 'name CA+P'));
    // cartoon('putty', ...) sets the global cartoon_type to 7 (putty).
    expect(Number(await b.call('get_setting', ['cartoon_type']))).toBe(7);
  });

  it('simple_no_solv: leaves the protein visible (no solvent to hide here)', async () => {
    const b = await boot(PEPT_PDB);
    await b.call('preset.simple_no_solv', ['all']);
    expect(await count(b, 'rep ribbon')).toBeGreaterThan(0);
  });

  it('classified: cartoons the polymer', async () => {
    const b = await boot(PEPT_PDB);
    await b.call('preset.classified', ['all']);
    expect(await count(b, 'rep cartoon')).toBeGreaterThan(0);
  });

  it('a preset re-applies cleanly after another (hide/show orchestration)', async () => {
    const b = await boot(PEPT_PDB);
    await b.call('preset.ball_and_stick', ['all']);
    await b.call('preset.pretty', ['all']);
    // pretty hides everything first, so spheres from ball_and_stick are gone.
    expect(await count(b, 'rep spheres')).toBe(0);
    expect(await count(b, 'rep cartoon')).toBeGreaterThan(0);
  });
});
