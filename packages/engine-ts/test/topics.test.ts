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
    for (const verb of ['commands', 'show_help', 'editing_ring']) {
      const text = (await backend.call(verb, [])) as string;
      expect(typeof text).toBe('string');
      expect(text.trim().length).toBeGreaterThan(0);
    }
    // The `commands` listing mentions the overview banner and a real verb.
    const commands = (await backend.call('commands', [])) as string;
    expect(commands).toMatch(/COMMANDS/);
    expect(commands).toMatch(/color/);
  });

  it('help_setting raises IncentiveOnly, matching Open-Source PyMOL', async () => {
    // Real PyMOL's `help_setting` is incentive-only (helping.py:99 raises
    // `IncentiveOnlyException`); verified against the oracle differential.
    const backend = await loaded();
    await expect(backend.call('help_setting', ['cartoon_transparency'])).rejects.toThrow(
      /Incentive-Only-Error: "help_setting" is not available in Open-Source PyMOL/,
    );
  });
});

describe('check', () => {
  it('raises the same ModuleNotFoundError as Open-Source PyMOL', async () => {
    // Upstream `check` imports chempy.tinker.realtime -> the compiled `molobj`
    // module, which is absent from Open-Source PyMOL, so `cmd.check` raises
    // `ModuleNotFoundError: No module named 'molobj'` — verified vs the oracle.
    const backend = await loaded();
    await expect(backend.call('check', ['all'])).rejects.toThrow(/No module named 'molobj'/);
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
