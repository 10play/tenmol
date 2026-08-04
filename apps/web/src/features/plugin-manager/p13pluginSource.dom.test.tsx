/**
 * Wave 13 — row 460's third clause, **"with the file it came from"**.
 *
 * The row's other two clauses are genuinely covered by
 * `usePluginRegistry.test.ts`, and mutation testing says so: making
 * `longestOwningPath` take the FIRST match, calling `plugins.findPlugins` with
 * no paths, or dropping the name sort each turn that file red.
 *
 * The FILE column did not. Replacing `filename` with `''` on every registry
 * entry left the whole `features/plugin-manager` suite (61 tests) green — the
 * table would have rendered a blank third column and nothing would have said
 * so. That column is the one that answers "which of these two identically
 * named modules is actually loading", so it is worth a test.
 *
 * The interesting part is not that a string survives a map; it is the DISPLAY
 * rule. The cell shows the path RELATIVE to the owning startup directory, and
 * the FULL path when no startup directory owns it — the two branches of
 * `p.startupPath === '' ? p.filename : p.filename.slice(...)`. Getting the
 * slice off by one eats the first character of every filename.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PluginManager } from './PluginManager';
import { loadPluginRegistry, type CallFn } from './usePluginRegistry';

const SESSION = { call: vi.fn() };
vi.mock('../../app', () => ({ useSession: () => SESSION }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PMG = '/x/pmg_tk/startup';
const DATA = '/x/pymol/pymol_path/data/startup';
/** A plugin on neither startup path — `findPlugins` can report one. */
const STRAY = '/somewhere/else/stray_plugin.py';

const FOUND: Record<string, string> = {
  apbs_gui: `${DATA}/apbs_gui/__init__.py`,
  lightingsettings_gui: `${PMG}/lightingsettings_gui/__init__.py`,
  stray_plugin: STRAY,
};

function backend() {
  return vi.fn(async (fn: string, args: readonly unknown[] = []) => {
    if (fn === 'plugins.initialize') return null;
    if (fn === 'plugins.get_startup_path') return args[0] === true ? [] : [PMG, DATA];
    if (fn === 'plugins.findPlugins') return FOUND;
    if (fn === 'plugins.pref_get') return args[0] === 'instantsave';
    if (fn === 'plugins.autoload.copy') return {};
    throw new Error(`unexpected ${fn}`);
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  SESSION.call.mockReset();
});

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function render() {
  SESSION.call.mockImplementation(backend());
  await act(async () => {
    root.render(<PluginManager />);
  });
  await settle();
}

const fileCells = () =>
  [...container.querySelectorAll('.plugmgr__path')].map((td) => ({
    text: td.textContent,
    title: td.getAttribute('title'),
  }));

describe('row 460 — the File column carries what findPlugins returned', () => {
  it('keeps every filename verbatim on the registry entries', async () => {
    const reg = await loadPluginRegistry(backend() as unknown as CallFn);
    const byName = Object.fromEntries(reg.plugins.map((p) => [p.name, p.filename]));
    expect(byName).toEqual(FOUND);
  });

  it('renders the path RELATIVE to the startup directory that owns it', async () => {
    await render();
    const cells = fileCells();
    // sorted by name: apbs_gui, lightingsettings_gui, stray_plugin
    expect(cells[0]!.text).toBe('apbs_gui/__init__.py');
    expect(cells[1]!.text).toBe('lightingsettings_gui/__init__.py');
    // The slice must drop the separator too: a leading '/' here means the
    // offset is wrong, and every row reads `/apbs_gui/...`.
    expect(cells[0]!.text!.startsWith('/')).toBe(false);
  });

  it('falls back to the FULL path when no startup directory owns the plugin', async () => {
    await render();
    // Truncating this one against a path that does not contain it would show a
    // fragment of an unrelated directory — worse than the whole path.
    expect(fileCells()[2]!.text).toBe(STRAY);
  });

  it('keeps the absolute path in the cell title, so nothing is lost by truncating', async () => {
    await render();
    expect(fileCells().map((c) => c.title)).toEqual([
      FOUND.apbs_gui,
      FOUND.lightingsettings_gui,
      STRAY,
    ]);
  });

  it('attributes to the DEEPEST owning path when the startup paths nest', async () => {
    // `/x` and `/x/pymol/pymol_path/data/startup` both prefix the apbs file;
    // the deepest must win or the relative path is nonsense.
    const nested: CallFn = (async (fn: string, args: readonly unknown[] = []) => {
      if (fn === 'plugins.initialize') return null;
      if (fn === 'plugins.get_startup_path') return args[0] === true ? [] : ['/x', DATA];
      if (fn === 'plugins.findPlugins') return { apbs_gui: FOUND.apbs_gui };
      if (fn === 'plugins.pref_get') return false;
      if (fn === 'plugins.autoload.copy') return {};
      throw new Error(`unexpected ${fn}`);
    }) as CallFn;

    const reg = await loadPluginRegistry(nested);
    expect(reg.plugins[0]!.startupPath).toBe(DATA);
    expect(reg.plugins[0]!.filename.slice(reg.plugins[0]!.startupPath.length + 1)).toBe(
      'apbs_gui/__init__.py',
    );
  });
});
