/**
 * The plugin registry reader.
 *
 * Fixtures are the REAL shapes observed over the wire against a PyMOL built
 * from this tree — `plugins.get_startup_path` returned 2 paths and
 * `plugins.findPlugins` returned `{lightingsettings_gui, apbs_gui}` — not
 * invented ones.
 */
import { describe, expect, it, vi } from 'vitest';

import { loadPluginRegistry, longestOwningPath, type CallFn } from './usePluginRegistry';

const PMG = '/repo/.venv/lib/python3.13/site-packages/pmg_tk/startup';
const DATA = '/repo/.venv/lib/python3.13/site-packages/pymol/pymol_path/data/startup';
const STARTUP = [PMG, DATA];
const FOUND = {
  lightingsettings_gui: `${DATA}/lightingsettings_gui/__init__.py`,
  apbs_gui: `${DATA}/apbs_gui/__init__.py`,
};

const happy: CallFn = (async (fn: string, args?: readonly unknown[]) => {
  if (fn === 'plugins.get_startup_path') return STARTUP;
  if (fn === 'plugins.findPlugins') return FOUND;
  if (fn === 'plugins.pref_get') return args?.[0] === 'instantsave';
  throw new Error(`unexpected ${fn}`);
}) as CallFn;

describe('longestOwningPath', () => {
  it('picks the deepest match, not the first', () => {
    // Attributing to the first match would mislabel which startup directory a
    // plugin came from, which is the only thing that column communicates.
    const nested = `${DATA}/x/__init__.py`;
    expect(longestOwningPath(nested, ['/repo', DATA])).toBe(DATA);
    expect(longestOwningPath(nested, [DATA, '/repo'])).toBe(DATA);
  });

  it('returns empty when nothing matches, so the caller shows the full path', () => {
    expect(longestOwningPath('/elsewhere/p.py', STARTUP)).toBe('');
  });
});

describe('loadPluginRegistry', () => {
  it('lists discovered plugins sorted by name', async () => {
    const reg = await loadPluginRegistry(happy);
    expect(reg.plugins.map((p) => p.name)).toEqual(['apbs_gui', 'lightingsettings_gui']);
    expect(reg.startupPaths).toEqual(STARTUP);
  });

  it('attributes every plugin to its owning startup path', async () => {
    const reg = await loadPluginRegistry(happy);
    for (const p of reg.plugins) expect(p.startupPath).toBe(DATA);
  });

  it('reads both preferences independently', async () => {
    const reg = await loadPluginRegistry(happy);
    expect(reg.preferences).toEqual({ verbose: false, instantsave: true });
  });

  it('passes the startup paths to findPlugins rather than letting it default', async () => {
    const spy = vi.fn(happy as (fn: string, args?: readonly unknown[]) => Promise<unknown>);
    await loadPluginRegistry(spy as unknown as CallFn);
    expect(spy).toHaveBeenCalledWith('plugins.findPlugins', [STARTUP]);
  });

  it('propagates a refusal instead of resolving to an empty list', async () => {
    const denied: CallFn = (async (fn: string) => {
      if (fn === 'plugins.get_startup_path') return STARTUP;
      throw new Error('NotAllowed: plugins.findPlugins');
    }) as CallFn;
    await expect(loadPluginRegistry(denied)).rejects.toThrow('NotAllowed');
  });

  it('tolerates a backend that returns nothing', async () => {
    const empty: CallFn = (async () => undefined) as CallFn;
    const reg = await loadPluginRegistry(empty);
    expect(reg.plugins).toEqual([]);
    expect(reg.startupPaths).toEqual([]);
  });
});
