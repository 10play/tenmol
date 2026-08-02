/**
 * Wave 13 — row 465, **"APBS Electrostatics — menu entry stays visible"**.
 *
 * The row exists for one reason, and it says so in its own text: *"a feature
 * that silently disappears is indistinguishable from one that is broken"*. So
 * the assertion that matters is that `Plugin ▸ APBS Electrostatics` is STILL
 * THERE and still opens something that explains itself.
 *
 * That was the one clause nothing checked. `apbsProbe.test.ts` and
 * `ApbsPanel.dom.test.tsx` are real tests and they cover the probe well —
 * shortening `APBS_CANDIDATES`, reordering the `pdb2pqr` names, weakening
 * `pipelineIsRunnable` or swallowing a probe error all turn them red. But
 * deleting
 *
 *     { kind: 'command', label: 'APBS Electrostatics', dialog: 'apbs' }
 *
 * from `layout/menuData.ts`, and deleting the `apbs` slot from
 * `features/registry.ts`, both left the entire menubar + layout + shell + apbs
 * suite (215 tests) green. The entry could have vanished exactly as the row
 * warns, and the row's own citations would still have looked healthy.
 *
 * Also covered here: the panel's "no" branch for
 * `pluginOnStartupPath`. `ApbsPanel.dom.test.tsx` asserts the "yes (apbs_gui)"
 * case only, so hard-coding the flag to `true` was green — and a hard-coded
 * "yes" is precisely the unfalsifiable claim the panel's own header comment
 * says it exists to avoid.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MENU_BAR, type MenuItem } from '../../layout/menuData';
import { FEATURE_SLOTS } from '../registry';
import { ApbsPanel } from './ApbsPanel';

const SESSION = { call: vi.fn() };
vi.mock('../../app', () => ({ useSession: () => SESSION }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type CommandItem = Extract<MenuItem, { kind: 'command' }>;

/** Every command leaf of the menu bar, flattened (separators dropped). */
function leaves(items: readonly MenuItem[]): CommandItem[] {
  return items.flatMap<CommandItem>((item) =>
    item.kind === 'menu' ? leaves(item.items) : item.kind === 'command' ? [item] : [],
  );
}

const pluginMenu = () => MENU_BAR.find((m) => m.label === 'Plugin');

describe('row 465 — the menu entry is still in the menu bar', () => {
  it('Plugin ▸ APBS Electrostatics exists, with that exact label', () => {
    const menu = pluginMenu();
    expect(menu).toBeDefined();
    const entry = leaves(menu!.items).find((i) => i.label === 'APBS Electrostatics');
    expect(entry).toBeDefined();
    // `addmenuitemqt('APBS Electrostatics', ...)`
    // (`packages/engine/data/startup/apbs_gui/__init__.py:448-450`) puts it under
    // Plugin, and that is where a returning PyMOL user will look for it.
    expect(entry!.dialog).toBe('apbs');
  });

  it('the dialog it names is a real slot, so the click cannot be a dead end', () => {
    const entry = leaves(pluginMenu()!.items).find((i) => i.label === 'APBS Electrostatics')!;
    const slot = FEATURE_SLOTS.find((s) => s.id === entry.dialog);
    expect(slot).toBeDefined();
    expect(slot!.absent).toBe('');
  });
});

/* ------------------------------------------------------------------ panel */

function backend(options: { onPath?: boolean; found?: Record<string, string> } = {}) {
  const found =
    options.found ??
    (options.onPath === false ? {} : { apbs_gui: '/x/startup/apbs_gui/__init__.py' });
  return vi.fn(async (fn: string) => {
    if (fn === 'plugins.get_startup_path') return ['/x/startup'];
    if (fn === 'plugins.findPlugins') return found;
    if (fn === 'cmd.exp_path') return '$SCHRODINGER/utilities/apbs';
    if (fn === 'subproc.which') return null;
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

async function render() {
  await act(async () => {
    root.render(<ApbsPanel />);
  });
  for (let i = 0; i < 8; i += 1) await act(async () => {});
}

const text = () => container.textContent ?? '';

describe('row 465 — the panel MEASURES whether the plugin is on the startup path', () => {
  it('says "no" when findPlugins does not report apbs_gui', async () => {
    SESSION.call.mockImplementation(backend({ onPath: false }));
    await render();

    expect(text()).toContain('Plugin file on the startup path: no');
    expect(text()).not.toContain('yes (apbs_gui)');
  });

  it('says "yes (apbs_gui)" when it does — the same read, the other answer', async () => {
    SESSION.call.mockImplementation(backend({ onPath: true }));
    await render();

    expect(text()).toContain('Plugin file on the startup path: yes (apbs_gui)');
  });

  it('is not fooled by some OTHER plugin being on the path', async () => {
    // A hard-coded `true` — or a truthiness check on the whole map — reads any
    // populated startup directory as "APBS is installed".
    SESSION.call.mockImplementation(backend({ found: { lightingsettings_gui: '/x/l.py' } }));
    await render();

    expect(text()).toContain('Plugin file on the startup path: no');
  });

  it('still explains itself when the plugin is absent — the entry never goes blank', async () => {
    SESSION.call.mockImplementation(backend({ onPath: false }));
    await render();

    // The row's requirement, in the DOM: the entry exists AND says why the
    // dialog is not here.
    expect(text()).toContain('APBS Electrostatics');
    expect(text()).toContain('Not available in the web client yet');
    expect(text()).toContain('pdb2pqr');
    expect(text()).toContain('apbs');
  });
});
