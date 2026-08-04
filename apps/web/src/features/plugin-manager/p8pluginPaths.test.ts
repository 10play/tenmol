/**
 * Wave 8 — the pure half of inventory rows 461 and 462.
 *
 * `p8pluginWrites.dom.test.tsx` drives the panel; this file pins the four
 * decisions that panel makes, including the ones its UI makes unreachable (an
 * out-of-range move, a blank path) but a future caller could still hit.
 *
 * Every engine fact quoted below is measured in `packages/bridge/tests/test_p8_a10.py`.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  addPath,
  movePath,
  readStartupPaths,
  removePath,
  setStartupPaths,
  writeReachesDisk,
  type CallFn,
} from './pluginSystem';

const A = '/a';
const B = '/b';
const C = '/c';

describe('writeReachesDisk (pref_set -> set_pref_changed)', () => {
  it('an ordinary preference follows the CURRENT instantsave', () => {
    expect(writeReachesDisk('verbose', true, true)).toBe(true);
    expect(writeReachesDisk('verbose', true, false)).toBe(false);
  });

  it('instantsave follows its own NEW value, because set_pref_changed reads it after', () => {
    // `pref_set` is `preferences[k] = v; set_pref_changed()`, and
    // `set_pref_changed` is `if pref_get('instantsave', True): pref_save()`.
    // So switching it off never writes, and switching it on always does —
    // regardless of what it was.
    expect(writeReachesDisk('instantsave', false, true)).toBe(false);
    expect(writeReachesDisk('instantsave', true, false)).toBe(true);
  });
});

describe('the startup-path list editors', () => {
  it('movePath swaps with the neighbour', () => {
    expect(movePath([A, B, C], 0, 1)).toEqual([B, A, C]);
    expect(movePath([A, B, C], 2, -1)).toEqual([A, C, B]);
  });

  it('movePath is a no-op off either end, and never drops an entry', () => {
    expect(movePath([A, B], 0, -1)).toEqual([A, B]);
    expect(movePath([A, B], 1, 1)).toEqual([A, B]);
    expect(movePath([A, B], -1, 1)).toEqual([A, B]);
    expect(movePath([A, B], 9, -1)).toEqual([A, B]);
  });

  it('movePath returns a copy, so a staged edit cannot mutate the engine state', () => {
    const original = [A, B];
    expect(movePath(original, 0, 1)).not.toBe(original);
    expect(original).toEqual([A, B]);
  });

  it('removePath removes exactly one position, not every equal string', () => {
    expect(removePath([A, B, A], 0)).toEqual([B, A]);
  });

  it('addPath trims, and refuses blanks and duplicates', () => {
    expect(addPath([A], `  ${B}  `)).toEqual([A, B]);
    expect(addPath([A], '   ')).toEqual([A]);
    // findPlugins takes the FIRST match for a name, so a second copy of an
    // entry can never win anything — it is a rule that has already fired.
    expect(addPath([A, B], A)).toEqual([A, B]);
  });
});

describe('readStartupPaths', () => {
  it('splits the list at the boundary set_startup_path may not cross', async () => {
    const call = vi.fn(async (fn: string, args: readonly unknown[] = []) => {
      if (fn !== 'plugins.get_startup_path') throw new Error(fn);
      return args[0] === true ? [A] : [A, B, C];
    }) as unknown as CallFn;

    expect(await readStartupPaths(call)).toEqual({ user: [A], installation: [B, C] });
  });

  it('reports every entry as installation when there is no user slice', async () => {
    // This build's real state: `get_startup_path()` has 2 entries and
    // `get_startup_path(True)` has none, so nothing on screen is removable.
    const call = (async (_fn: string, args: readonly unknown[] = []) =>
      args[0] === true ? [] : [B, C]) as unknown as CallFn;
    expect(await readStartupPaths(call)).toEqual({ user: [], installation: [B, C] });
  });
});

describe('setStartupPaths verifies by reading back', () => {
  it('sends the whole list plus the autosave flag', async () => {
    const seen: unknown[][] = [];
    const call = (async (fn: string, args: readonly unknown[] = []) => {
      seen.push([fn, ...args]);
      return fn === 'plugins.get_startup_path' ? [A, B] : null;
    }) as unknown as CallFn;

    expect(await setStartupPaths(call, [A, B], false)).toEqual([A, B]);
    expect(seen[0]).toEqual(['plugins.set_startup_path', [A, B], false]);
    expect(seen[1]![0]).toBe('plugins.get_startup_path');
  });

  it('THROWS when the engine accepted the call and did not apply it', async () => {
    // `set_startup_path` prints ' Error: set_startup_path failed' for a
    // non-list and returns the same None a success returns. Without the
    // read-back the panel would report a change that never happened.
    const call = (async (fn: string) =>
      fn === 'plugins.get_startup_path' ? [A] : null) as unknown as CallFn;

    await expect(setStartupPaths(call, [A, B], true)).rejects.toThrow(
      'set_startup_path did not apply: asked for [/a, /b], engine has [/a]',
    );
  });

  it('THROWS on a reorder that silently did not take, not just a length change', async () => {
    const call = (async (fn: string) =>
      fn === 'plugins.get_startup_path' ? [A, B] : null) as unknown as CallFn;
    await expect(setStartupPaths(call, [B, A], true)).rejects.toThrow('did not apply');
  });
});
