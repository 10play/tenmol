/**
 * Tests for the `misc2` flat verbs (packages/engine-ts/src/cmd/misc2.ts):
 * the top-level preset aliases (pretty/simple/technical/publication), `label2`,
 * `get_phipsi`, the `dirty`/`dirty_wizard`/`finish_object` redraw flags, and the
 * colorection (named colour-scheme) save/restore set.
 *
 * Everything is exercised through the full engine via a `LocalBackend`: boot,
 * `read_pdbstr` a structure, then drive the verb and read the visible effect
 * back with `count_atoms('rep <rep>')`, `get_label`, or `iterate`.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { LocalBackend } from '@tenmol/engine-ts';
import { SMALL_PDB } from './fixture';

/** A richer, real single-chain peptide (needed by the cartoon presets). */
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

/** Rep membership across the reps the presets touch — the observable signature. */
const REPS = ['cartoon', 'sticks', 'ribbon', 'nonbonded', 'lines', 'spheres'] as const;
async function repSignature(b: LocalBackend): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const r of REPS) out[r] = await count(b, `rep ${r}`);
  return out;
}

describe('misc2 — preset aliases / label2 / get_phipsi / dirty / colorection', () => {
  it('pretty aliases preset.pretty (same rep signature)', async () => {
    const viaAlias = await boot(PEPT_PDB);
    await viaAlias.call('pretty', ['all']);
    const viaPreset = await boot(PEPT_PDB);
    await viaPreset.call('preset.pretty', ['all']);
    const sig = await repSignature(viaAlias);
    expect(sig).toEqual(await repSignature(viaPreset));
    // ...and it actually did something (pretty shows cartoon).
    expect(sig.cartoon).toBeGreaterThan(0);
  });

  it('simple aliases preset.simple (same rep signature, shows ribbon)', async () => {
    const viaAlias = await boot(PEPT_PDB);
    await viaAlias.call('simple', ['all']);
    const viaPreset = await boot(PEPT_PDB);
    await viaPreset.call('preset.simple', ['all']);
    const sig = await repSignature(viaAlias);
    expect(sig).toEqual(await repSignature(viaPreset));
    expect(sig.ribbon).toBeGreaterThan(0);
  });

  it('technical and publication aliases match their preset.* targets', async () => {
    for (const name of ['technical', 'publication'] as const) {
      const viaAlias = await boot(PEPT_PDB);
      await viaAlias.call(name, ['all']);
      const viaPreset = await boot(PEPT_PDB);
      await viaPreset.call(`preset.${name}`, ['all']);
      expect(await repSignature(viaAlias)).toEqual(await repSignature(viaPreset));
    }
  });

  it('every preset alias defaults its selection to all and is callable', async () => {
    for (const name of ['pretty', 'simple', 'technical', 'publication'] as const) {
      const b = await boot();
      await expect(b.call(name)).resolves.not.toThrow();
    }
  });

  it('label2 labels exactly like label', async () => {
    const viaAlias = await boot();
    const nAlias = await viaAlias.call('label2', ['chain A', '"L"']);
    const viaLabel = await boot();
    const nLabel = await viaLabel.call('label', ['chain A', '"L"']);
    expect(nAlias).toBe(nLabel);
    expect(await viaAlias.call('get_label', ['all'])).toEqual(
      await viaLabel.call('get_label', ['all']),
    );
    // `label`/`label2` return None (matches the oracle), so parity is by effect:
    // chain A of the fixture is 5 atoms — the Label rep is set on all of them,
    // identically via the alias and the base command.
    expect(nAlias).toBeNull();
    expect(await count(viaAlias, 'rep labels')).toBe(await count(viaLabel, 'rep labels'));
    expect(await count(viaAlias, 'rep labels')).toBe(5);
  });

  it('get_phipsi returns an (object, index) -> (phi, psi) dict', async () => {
    const b = await boot(PEPT_PDB);
    // Real PyMOL returns a dict keyed by the (object, index) tuple, one entry
    // per interior CA whose full backbone resolves — NOT a bare [phi, psi] list.
    const pp = (await b.call('get_phipsi', ['name CA'])) as Record<string, [number, number]>;
    expect(Array.isArray(pp)).toBe(false);
    expect(typeof pp).toBe('object');
    const keys = Object.keys(pp);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(k.startsWith('m,')).toBe(true); // "<object>,<1-based index>"
      const pair = pp[k]!;
      expect(pair).toHaveLength(2);
      expect(typeof pair[0]).toBe('number');
      expect(typeof pair[1]).toBe('number');
    }
    // Empty selection -> empty dict (matches real PyMOL over the bridge).
    expect(await b.call('get_phipsi', ['none'])).toEqual({});
  });

  it('dirty / dirty_wizard / finish_object are callable and return null', async () => {
    const b = await boot();
    for (const v of ['dirty', 'dirty_wizard', 'finish_object'] as const) {
      expect(await b.call(v, [])).toBeNull();
    }
  });

  it('colorection round-trips atom colours by prefix', async () => {
    const b = await boot();
    // Distinct colours per chain (chain A = 5 atoms, chain B = 4).
    await b.call('alter', ['chain A', 'color=5']);
    await b.call('alter', ['chain B', 'color=3']);
    // Snapshot the scheme.
    const snap = await b.call('get_colorection', ['scheme']);
    expect(Array.isArray(snap)).toBe(true);
    expect((snap as unknown[]).length).toBe(9);
    // Recolour everything differently.
    await b.call('alter', ['all', 'color=9']);
    const nine = { colors: [] as number[] };
    await b.call('iterate', ['all', 'stored.colors.push(color)'], { stored: nine });
    expect(nine.colors.every((c) => c === 9)).toBe(true);
    // Restore from the stored prefix.
    expect(await b.call('set_colorection', [null, 'scheme'])).toBeNull();
    const a = { colors: [] as number[] };
    const bcol = { colors: [] as number[] };
    await b.call('iterate', ['chain A', 'stored.colors.push(color)'], { stored: a });
    await b.call('iterate', ['chain B', 'stored.colors.push(color)'], { stored: bcol });
    expect(a.colors.every((c) => c === 5)).toBe(true);
    expect(bcol.colors.every((c) => c === 3)).toBe(true);
  });

  it('colorection state is per-engine, not shared across instances', async () => {
    // Regression: the store must be instance-scoped. Saving a scheme under the
    // default prefix in one engine must not be visible to a second engine.
    const b1 = await boot();
    await b1.call('alter', ['all', 'color=5']);
    await b1.call('get_colorection', ['']); // save under default prefix on b1

    const b2 = await boot();
    const snap2 = await b2.call('get_colorection', ['']); // b2's own default prefix
    // b2 never saved a '' scheme, so its snapshot reflects b2's atoms (colour 0),
    // not b1's colour-5 scheme leaking through a shared module Map.
    const colors = (snap2 as Array<[string, number, number]>).map((e) => e[2]);
    expect(colors.every((c) => c === 0)).toBe(true);
  });

  it('set_colorection also restores from a passed snapshot array', async () => {
    const b = await boot();
    await b.call('alter', ['all', 'color=7']);
    const snap = await b.call('get_colorection', ['x']);
    await b.call('alter', ['all', 'color=2']);
    // Pass the snapshot directly (dict_or_name arg) rather than by prefix.
    await b.call('set_colorection', [snap]);
    const seen = { colors: [] as number[] };
    await b.call('iterate', ['all', 'stored.colors.push(color)'], { stored: seen });
    expect(seen.colors.every((c) => c === 7)).toBe(true);
  });

  it('del_colorection removes a stored scheme (later restore is a no-op)', async () => {
    const b = await boot();
    await b.call('alter', ['all', 'color=4']);
    await b.call('get_colorection', ['gone']);
    expect(await b.call('del_colorection', ['gone'])).toBeNull();
    await b.call('alter', ['all', 'color=1']);
    // Nothing stored under the prefix now, so colours stay at 1.
    await b.call('set_colorection', [null, 'gone']);
    const seen = { colors: [] as number[] };
    await b.call('iterate', ['all', 'stored.colors.push(color)'], { stored: seen });
    expect(seen.colors.every((c) => c === 1)).toBe(true);
  });
});
