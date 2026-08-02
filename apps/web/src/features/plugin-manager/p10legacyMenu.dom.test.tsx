/**
 * Inventory row 76, option (b) — the client half.
 *
 * The bridge half is `packages/bridge/tests/test_p10_rest.py`, which drives the REAL
 * upstream `PmwMenuBar` in a subprocess and measures the JSON it produces. The
 * fixtures below are that JSON, copied from a run rather than invented:
 * `plugins.addmenuitem('My Tool|Run', fn)` plus a `-` separator plus a
 * top-level item.
 *
 * What is asserted here is the two things the client owes the row: the tree
 * renders with its structure intact, and a click on a leaf goes out as
 * `cmd.tenmol_plugins.invoke(key, index)` — the "clicks RPC'd back" half.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LegacyPlugins } from './LegacyPlugins';
import { flattenMenus, leafCount, type LegacyMenu } from './legacyMenu';

const MENUS: LegacyMenu[] = [
  {
    key: 'Plugin',
    label: 'Plugin',
    items: [
      {
        kind: 'menu',
        index: 0,
        label: 'My Tool',
        key: 'Plugin|My Tool',
        items: [
          { kind: 'command', index: 0, label: 'Run' },
          { kind: 'separator', index: 1, label: '' },
          { kind: 'command', index: 2, label: 'Second' },
        ],
      },
      { kind: 'command', index: 1, label: 'Top level' },
    ],
  },
  { key: 'PluginQt', label: 'PluginQt', items: [] },
  {
    key: 'Plugin|My Tool',
    label: 'My Tool',
    items: [
      { kind: 'command', index: 0, label: 'Run' },
      { kind: 'separator', index: 1, label: '' },
      { kind: 'command', index: 2, label: 'Second' },
    ],
  },
];

const calls: Array<{ fn: string; args: readonly unknown[] }> = [];
const ran: string[] = [];
let helloFails = false;
let menus: LegacyMenu[] = MENUS;
let invokeReply: unknown = { ok: true, label: 'Run' };

const SESSION = {
  call: vi.fn(async (fn: string, args: readonly unknown[] = []) => {
    calls.push({ fn, args });
    if (fn === 'cmd.tenmol_plugins.hello') {
      if (helloFails) throw new Error("NotAllowed: 'tenmol_plugins'");
      return { ok: true };
    }
    if (fn === 'cmd.tenmol_plugins.menu') return { ok: true, menus };
    if (fn === 'cmd.tenmol_plugins.invoke') return invokeReply;
    return null;
  }),
  run: vi.fn(async (line: string) => {
    ran.push(line);
  }),
  act: vi.fn(async () => {}),
  poller: { kick: vi.fn() },
  stores: { feedback: { appendClient: vi.fn() } },
};

vi.mock('../../app', () => ({ useSession: () => SESSION }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  calls.length = 0;
  ran.length = 0;
  helloFails = false;
  menus = MENUS;
  invokeReply = { ok: true, label: 'Run' };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(): Promise<void> {
  await act(async () => {
    root.render(<LegacyPlugins />);
  });
  await act(async () => {});
}

describe('flattenMenus', () => {
  it('walks the roots once, carrying depth, and never twice', () => {
    const rows = flattenMenus(MENUS);
    expect(rows.map((r) => [r.label, r.depth, r.kind])).toEqual([
      ['Plugin', 0, 'menu'],
      ['My Tool', 1, 'menu'],
      ['Run', 2, 'command'],
      ['', 2, 'separator'],
      ['Second', 2, 'command'],
      ['Top level', 1, 'command'],
      ['PluginQt', 0, 'menu'],
    ]);
    // `Plugin|My Tool` is also a top-level entry of the reply so it can be
    // addressed directly; rendering it again would show the submenu twice.
    expect(rows.filter((r) => r.label === 'Run')).toHaveLength(1);
  });

  it('addresses a leaf by (menu key, index), which is what invoke takes', () => {
    const run = flattenMenus(MENUS).find((r) => r.label === 'Run');
    expect(run).toMatchObject({ menuKey: 'Plugin|My Tool', index: 0, clickable: true });
    const top = flattenMenus(MENUS).find((r) => r.label === 'Top level');
    expect(top).toMatchObject({ menuKey: 'Plugin', index: 1 });
    expect(leafCount(MENUS)).toBe(3);
    expect(leafCount([])).toBe(0);
  });
});

describe('the Legacy Plugins tab', () => {
  it('renders the registry and says how many items it holds', async () => {
    await render();
    expect(container.querySelector('[data-legacy-count]')?.textContent).toBe('3 menu items');
    const labels = [...container.querySelectorAll('[data-legacy-leaf]')].map((b) =>
      b.textContent?.trim(),
    );
    expect(labels).toEqual(['Run', 'Second', 'Top level']);
    // The separator is rendered as one, not dropped and not as a leaf.
    expect(container.querySelectorAll('.plugmgr__legacysep')).toHaveLength(1);
  });

  it('bootstraps the bridge module only when the probe fails', async () => {
    await render();
    expect(ran).toEqual([]);
    calls.length = 0;
    helloFails = true;
    // `reread`, not a second `root.render`: the effect's dependency is stable,
    // so re-rendering the same element runs no effect at all and the assertion
    // below would be measuring the FIRST mount.
    await act(async () => {
      [...container.querySelectorAll('button')]
        .find((b) => b.textContent?.trim() === 'reread')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {});
    expect(ran).toEqual(['/import tenmol_bridge.panels.plugins as _p;_p.install()']);
    expect(calls.map((c) => c.fn)).toContain('cmd.tenmol_plugins.menu');
  });

  it('sends the click back as invoke(key, index)', async () => {
    await render();
    const leaf = container.querySelector('[data-legacy-leaf="Plugin|My Tool:0"]');
    expect(leaf).not.toBeNull();
    await act(async () => {
      leaf!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const invoke = calls.filter((c) => c.fn === 'cmd.tenmol_plugins.invoke');
    expect(invoke).toHaveLength(1);
    expect(invoke[0]?.args).toEqual(['Plugin|My Tool', 0]);
    expect(container.querySelector('[data-legacy-result]')?.textContent).toContain('ran Run');
    // A plugin can change anything; the panel poll is kicked afterwards.
    expect(SESSION.poller.kick).toHaveBeenCalled();
  });

  it('shows a plugin failure where the click was, not only in the console', async () => {
    invokeReply = {
      ok: false,
      label: 'Run',
      error: 'ImportError: pymol.Qt',
      note: "the plugin's own traceback was printed to the console",
    };
    await render();
    await act(async () => {
      container
        .querySelector('[data-legacy-leaf="Plugin|My Tool:0"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const result = container.querySelector('[data-legacy-result]');
    expect(result?.className).toContain('is-error');
    expect(result?.textContent).toContain('ImportError: pymol.Qt');
    expect(result?.textContent).toContain('printed to the console');
  });

  it('says plainly when no plugin has registered anything', async () => {
    menus = [
      { key: 'Plugin', label: 'Plugin', items: [] },
      { key: 'PluginQt', label: 'PluginQt', items: [] },
    ];
    await render();
    expect(container.querySelector('[data-legacy-empty]')).not.toBeNull();
    expect(container.querySelector('[data-legacy-count]')?.textContent).toBe('0 menu items');
  });

  it('reports a registry that cannot be reached instead of an empty list', async () => {
    helloFails = true;
    SESSION.run.mockImplementationOnce(async () => {
      throw new Error('NotAllowed: import');
    });
    await render();
    expect(container.querySelector('[data-legacy-error]')?.textContent).toContain(
      'NotAllowed: import',
    );
  });
});
