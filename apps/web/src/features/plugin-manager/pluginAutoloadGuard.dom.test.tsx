/**
 * Wave 6 verification pass, inventory row 463 — the AUTOLOAD CHECKBOX, rendered.
 *
 * `pluginSystem.test.ts` and `usePluginRegistry.test.ts` exercise the two plain
 * async functions with a recorder. Neither touches `usePluginRegistry` itself,
 * so the two claims that carry the safety of this feature were unpinned:
 *
 *  1. **A missing key means ENABLED.** `PluginInfo.autoload` is
 *     `autoload.get(self.name, True)` (`modules/pymol/plugins/__init__.py`), and
 *     the live bridge answered `plugins.autoload.copy() == {}` with both shipped
 *     plugins reporting `i.autoload == True`
 *     (`bridge/tests/test_wf_plugins.py`, console tags TENMOLWF29/30). A
 *     checkbox that defaulted to unchecked would tell the user every plugin is
 *     switched off.
 *  2. **The write is refused when the scan failed.** `setAutoload` ends in
 *     `plugins.set_pref_changed()`, which serialises the WHOLE in-memory
 *     `autoload` dict into `~/.pymolpluginsrc.py`. If `plugins.initialize(-2)`
 *     did not run, that dict is PyMOL's compiled-in `{}` and the save destroys
 *     every choice the user had stored — measured server-side in
 *     `test_initialize_reads_the_rc_file_and_skipping_it_CLOBBERS_the_user`.
 *     The hook guards this with a ref; nothing asserted that the guard fires,
 *     and a guard nobody tests is a guard that gets deleted.
 *
 * The backend double answers the exact shapes observed over the wire while
 * `test_wf_plugins.py` was written: two startup paths, two plugins, `pref_get`
 * per key, `plugins.autoload.copy` as a plain object.
 */

import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PluginManager } from './PluginManager';
import { usePluginRegistry, type PluginRegistry } from './usePluginRegistry';

/** ONE stable object: `useSession()` is an effect dependency in the hook. */
const SESSION = { call: vi.fn() };
vi.mock('../../app', () => ({ useSession: () => SESSION }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PMG = '/x/pmg_tk/startup';
const DATA = '/x/pymol/pymol_path/data/startup';

function backend(options: { autoload?: Record<string, boolean>; initFails?: boolean } = {}) {
  return vi.fn(async (fn: string, args: readonly unknown[] = []) => {
    if (fn === 'plugins.initialize') {
      if (options.initFails) throw new Error("NotAllowed: 'plugins.initialize'");
      return null;
    }
    if (fn === 'plugins.get_startup_path') return [PMG, DATA];
    if (fn === 'plugins.findPlugins') {
      return {
        apbs_gui: `${DATA}/apbs_gui/__init__.py`,
        lightingsettings_gui: `${DATA}/lightingsettings_gui/__init__.py`,
      };
    }
    if (fn === 'plugins.pref_get') return args[0] === 'instantsave';
    if (fn === 'plugins.autoload.copy') return options.autoload ?? {};
    if (fn === 'plugins.autoload.update') return null;
    if (fn === 'plugins.set_pref_changed') return null;
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

async function render(node: React.ReactElement) {
  await act(async () => {
    root.render(node);
  });
  await settle();
}

function boxes(): HTMLInputElement[] {
  return Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
}

/** `fn` names in call order, so ORDER is assertable and not just membership. */
function calls(): string[] {
  return SESSION.call.mock.calls.map((c) => String(c[0]));
}

describe('autoload checkbox', () => {
  it('renders a plugin the autoload dict does not mention as ENABLED', async () => {
    SESSION.call.mockImplementation(backend({ autoload: {} }));
    await render(<PluginManager />);

    expect(boxes()).toHaveLength(2);
    expect(boxes().map((b) => b.checked)).toEqual([true, true]);
    expect(boxes().map((b) => b.getAttribute('aria-label'))).toEqual([
      'load apbs_gui at startup',
      'load lightingsettings_gui at startup',
    ]);
  });

  it('renders an explicit false as disabled, and only that row', async () => {
    SESSION.call.mockImplementation(backend({ autoload: { apbs_gui: false } }));
    await render(<PluginManager />);
    expect(boxes().map((b) => b.checked)).toEqual([false, true]);
  });

  it('writes update then set_pref_changed, in that order, and flips the row', async () => {
    SESSION.call.mockImplementation(backend({ autoload: {} }));
    await render(<PluginManager />);
    SESSION.call.mockClear();

    await act(async () => {
      boxes()[0]!.click();
    });
    await settle();

    expect(calls()).toEqual(['plugins.autoload.update', 'plugins.set_pref_changed']);
    expect(SESSION.call.mock.calls[0]![1]).toEqual([{ apbs_gui: false }]);
    expect(boxes().map((b) => b.checked)).toEqual([false, true]);
  });

  it('REFUSES to write when initialize failed — the clobber guard', async () => {
    // The whole load rejects, so `ready` is never armed. Anything that reached
    // `set_pref_changed()` here would rewrite ~/.pymolpluginsrc.py from an
    // empty dict.
    let reg: PluginRegistry | null = null;
    function Probe() {
      reg = usePluginRegistry();
      useEffect(() => {}, []);
      return null;
    }
    SESSION.call.mockImplementation(backend({ initFails: true }));
    await render(<Probe />);

    const captured = reg as PluginRegistry | null;
    expect(captured).not.toBeNull();
    expect(captured!.error).toMatch(/NotAllowed/);
    expect(captured!.plugins).toEqual([]);

    // wave 8: the guard now also SETS the visible write error before it
    // rejects (rejecting alone was invisible, because every caller swallows
    // it), so the call is a state update and has to be inside act().
    await act(async () => {
      await expect(captured!.setAutoload('apbs_gui', false)).rejects.toThrow(
        /refusing to write ~\/\.pymolpluginsrc\.py/,
      );
    });
    expect(calls()).not.toContain('plugins.autoload.update');
    expect(calls()).not.toContain('plugins.set_pref_changed');
  });

  it('surfaces the failure on screen instead of an empty plugin list', async () => {
    SESSION.call.mockImplementation(backend({ initFails: true }));
    await render(<PluginManager />);
    expect(container.textContent).toContain('plugin scan failed');
    expect(boxes()).toHaveLength(0);
  });
});
