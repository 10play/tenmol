/**
 * Tests for the `topics` subsystem (packages/engine-ts/src/cmd/topics.ts):
 * the flat help/topic verbs (`commands`, `show_help`, `help_setting`,
 * `editing_ring`), the minimal `check` structure summary, and the trivial
 * aliases (`fork`→`spawn`, `dist`→`distance`, and the British colour verbs).
 *
 * Driven through a real `LocalBackend` so the aliases resolve their targets via
 * the full engine registry — both the `cmd/*` registrars and the verbs
 * registered directly on the Engine (`color`, `bg_color`).
 */

import { describe, expect, it } from 'vitest';
import { LocalBackend, getColorIndex } from '@tenmol/engine-ts';
import { SMALL_PDB, EXPECTED } from './fixture';

/** A connected backend with SMALL_PDB loaded as object `m`. */
async function loaded(): Promise<LocalBackend> {
  const backend = new LocalBackend();
  await backend.connect();
  await backend.call('read_pdbstr', [SMALL_PDB, 'm']);
  return backend;
}

describe('help / topic verbs', () => {
  it('return non-empty descriptive help text (never NotPorted)', async () => {
    const backend = await loaded();
    for (const verb of ['commands', 'show_help', 'help_setting', 'editing_ring']) {
      const text = (await backend.call(verb, [])) as string;
      expect(typeof text).toBe('string');
      expect(text.trim().length).toBeGreaterThan(0);
    }
    // The `commands` listing mentions the overview banner and a real verb.
    const commands = (await backend.call('commands', [])) as string;
    expect(commands).toMatch(/COMMANDS/);
    expect(commands).toMatch(/color/);
  });
});

describe('check', () => {
  it('reports the atom and bond counts of a selection', async () => {
    const backend = await loaded();
    const all = (await backend.call('check', ['all'])) as string;
    // 9 atoms; the fixture is a fully-bonded di-peptide (>=1 bond) in 1 object.
    expect(all).toMatch(new RegExp(`${EXPECTED.total} atom\\(s\\)`));
    expect(all).toMatch(/bond\(s\)/);
    expect(all).toMatch(/1 object\(s\)/);
    expect(all).toMatch(/\[m\]/);

    // A narrower selection reports fewer atoms.
    const ca = (await backend.call('check', ['name CA'])) as string;
    expect(ca).toMatch(new RegExp(`${EXPECTED.ca} atom\\(s\\)`));
  });
});

describe('fork -> spawn', () => {
  it('behaves exactly like spawn (a sandboxed no-op returning null)', async () => {
    const backend = await loaded();
    const spawn = await backend.call('spawn', []);
    const fork = await backend.call('fork', []);
    expect(fork).toBe(spawn);
    expect(fork).toBeNull();
  });
});

describe('dist -> distance', () => {
  it('creates a measurement and returns the same value as distance', async () => {
    const backend = await loaded();
    // N(0,0,0)-CA(1.458,0,0) in chain A: distance is 1.458 A.
    const viaDist = (await backend.call('dist', [
      'd1',
      'chain A and name N',
      'chain A and name CA',
    ])) as number;
    const viaDistance = (await backend.call('distance', [
      'd2',
      'chain A and name N',
      'chain A and name CA',
    ])) as number;
    expect(viaDist).toBeCloseTo(1.458, 3);
    expect(viaDist).toBeCloseTo(viaDistance, 6);
    // The measurement object exists (dist is a full distance, not a stub).
    expect(await backend.call('get_names', ['objects'])).toContain('d1');
  });
});

describe('British-spelling colour aliases', () => {
  it('colour colours atoms just like color', async () => {
    const backend = await loaded();
    await backend.call('colour', ['red', 'all']);
    expect(getColorIndex('red')).toBeGreaterThanOrEqual(0);
    expect(await backend.call('count_atoms', ['color red'])).toBe(EXPECTED.total);
  });

  it('set_colour defines a colour like set_color (returns a usable index)', async () => {
    const backend = await loaded();
    const idx = (await backend.call('set_colour', ['mygreen', [0, 1, 0]])) as number;
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(getColorIndex('mygreen')).toBe(idx);
    // The freshly defined colour is usable by (British) colour.
    await backend.call('colour', ['mygreen', 'chain A']);
    expect(await backend.call('count_atoms', ['color mygreen'])).toBe(EXPECTED.chainA);
  });

  it('recolour and bg_colour forward without error, matching their targets', async () => {
    const backend = await loaded();
    expect(await backend.call('recolour', [])).toBe(await backend.call('recolor', []));
    // bg_colour forwards to bg_color (both return null); must not reject (NotPorted).
    await expect(backend.call('bg_colour', ['black'])).resolves.toBe(
      await backend.call('bg_color', ['black']),
    );
  });
});
