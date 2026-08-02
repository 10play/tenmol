/**
 * The menu bar's PUSH channel — parity row 57.
 *
 * Row 57 is Qt's `update_feedback` loop, whose second half is the only
 * mechanism that moves a checkable menu item when something OTHER than the
 * widget changed the setting:
 *
 *     for index in cmd.get_setting_updates():
 *         for callback in self.setting_callbacks[index]: callback(value)
 *
 * The wave-8 note narrowed the gap to: "features/menubar re-reads a menu's
 * settings on OPEN and 120 ms after each click … 'a poll instead of a push'".
 * These tests are the push: nobody clicks anything, the setting changes on the
 * server, and the tick moves while the menu is on screen.
 *
 * `tenmol_menus('menus')` is REFUSED here so the assertions run against the
 * checked-in generated tree, which is byte-identical to a fresh harvest
 * (`bridge/tests/test_menus.py`).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createConnectionStore,
  createFeedbackStore,
  createObjectsStore,
  createUiStore,
} from '@tenmol/stores';

import { SessionContext, type Session } from '../../app';
import { resetPanelHooks } from '../../shell/panelHooks';
import { getSettingsTap, resetSettingsTap } from '../../shell/settingsTap';
import { MenuBar } from './MenuBar';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** MEASURED over the socket, `bridge/tests/test_p9_shell.py`. */
const INDEX = { orthoscopic: 23, valence: 64, line_smooth: 43, bg_rgb: 6 } as const;

interface Fake {
  values: Map<number, number | string>;
  names: Map<string, number>;
  installed: boolean;
  refuseInstall: boolean;
  log: Array<{ indices: number[]; full: boolean }>;
  /** `tenmol_menus('settings', …)` calls — the round trips this row is about. */
  menuReads: number;
  change(index: number, value: number | string, full?: boolean): void;
}

let fake: Fake;
let container: HTMLDivElement;
let root: Root;
let session: Session;

function makeFake(): Fake {
  const state: Fake = {
    values: new Map<number, number | string>([
      [INDEX.orthoscopic, 0],
      [INDEX.valence, 0],
      [INDEX.line_smooth, 1],
      [INDEX.bg_rgb, 0],
    ]),
    names: new Map(Object.entries(INDEX)),
    installed: false,
    refuseInstall: false,
    log: [],
    menuReads: 0,
    change(index, value, full = false) {
      state.values.set(index, value);
      state.log.push({ indices: [index], full });
    },
  };
  return state;
}

/** `panels/settings.py` and `panels/menus.py`, as the dispatcher exposes them. */
function call(fn: string, args: readonly unknown[]): Promise<unknown> {
  if (fn === 'setting.tenmol_settings_status') {
    return fake.installed
      ? Promise.resolve({ installed: true })
      : Promise.reject(new Error('no such symbol'));
  }
  if (fn === 'cmd.do') {
    if (fake.refuseInstall) return Promise.reject(new Error('offline'));
    fake.installed = true;
    return Promise.resolve(null);
  }
  if (fn === 'setting.tenmol_settings_drain') {
    if (!fake.installed) return Promise.reject(new Error('no such symbol'));
    const since = fake.log.slice(Number(args[0] ?? 0));
    return Promise.resolve({
      cursor: fake.log.length,
      indices: [...new Set(since.flatMap((batch) => batch.indices))],
      full: since.some((batch) => batch.full),
      lost: false,
    });
  }
  if (fn === 'setting.tenmol_settings_values') {
    if (!fake.installed) return Promise.reject(new Error('no such symbol'));
    const rows: Array<[number, unknown, string]> = [];
    for (const item of (args[0] as unknown[]) ?? []) {
      const index = typeof item === 'number' ? item : fake.names.get(String(item));
      if (index === undefined) continue;
      const value = fake.values.get(index);
      if (value === undefined) continue;
      rows.push([index, value, String(value)]);
    }
    return Promise.resolve({ values: rows, failed: [] });
  }
  if (fn === 'tenmol_menus') {
    const verb = args[0];
    if (verb !== 'settings') return Promise.reject(new Error('offline'));
    fake.menuReads += 1;
    const names = (args[1] as string[]) ?? [];
    const out: Record<string, { type: number; value: number | string | null }> = {};
    for (const name of names) {
      const index = fake.names.get(name);
      out[name] = { type: 1, value: index === undefined ? null : (fake.values.get(index) ?? null) };
    }
    return Promise.resolve(out);
  }
  return Promise.reject(new Error(`offline: ${fn}`));
}

function makeSession(): Session {
  const stores = {
    connection: createConnectionStore('ws://test/ws', true),
    feedback: createFeedbackStore(),
    objects: createObjectsStore(),
    ui: createUiStore(null),
  };
  return {
    config: {} as Session['config'],
    conn: {
      sendInput: vi.fn(),
      isOpen: true,
      do: () => Promise.reject(new Error('offline')),
    } as unknown as Session['conn'],
    stores,
    objectsSource: { poll: vi.fn(), invalidate: vi.fn() } as unknown as Session['objectsSource'],
    poller: { stats: () => ({ hz: 30 }) } as unknown as Session['poller'],
    run: vi.fn(),
    act: vi.fn(),
    call: (fn: string, args: readonly unknown[] = []) => call(fn, args),
    reconnect: vi.fn(),
    disconnect: vi.fn(),
    useToken: vi.fn(),
    probeHealth: vi.fn(),
  } as unknown as Session;
}

function mount(): void {
  act(() =>
    root.render(
      <SessionContext.Provider value={session}>
        <MenuBar />
      </SessionContext.Provider>,
    ),
  );
}

function openMenu(label: string): void {
  const button = [...container.querySelectorAll<HTMLButtonElement>('.menubar__item')].find(
    (el) => el.textContent?.trim() === label,
  );
  if (!button) throw new Error(`no menu ${label}`);
  act(() => button.click());
}

function leaf(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll<HTMLElement>('.menu__row')].find(
    (el) => el.querySelector('.menu__label')?.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no leaf ${JSON.stringify(label)}`);
  return found as HTMLButtonElement;
}

/** '✓' when ticked, ' ' when not — `MenuList`'s `menu__mark`. */
function mark(label: string): string {
  return leaf(label).querySelector('.menu__mark')?.textContent ?? '';
}

async function waitFor(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
  expect(check()).toBe(true);
}

async function idle(ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

beforeEach(() => {
  fake = makeFake();
  resetPanelHooks();
  session = makeSession();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetSettingsTap(session);
  resetPanelHooks();
});

describe('setting_callbacks: the open menu follows the tap (row 57)', () => {
  it('ticks a check nobody clicked, while the menu is on screen', async () => {
    mount();
    openMenu('Display');
    await waitFor(() => mark('Orthoscopic View') === ' ');
    await waitFor(() => getSettingsTap(session).live);

    // `set orthoscopic, 1` at the prompt, a plugin, a session load — anything
    // but this menu. Qt learns about it from `get_setting_updates`; so do we.
    fake.change(INDEX.orthoscopic, 1);
    await waitFor(() => mark('Orthoscopic View') === '✓');

    fake.change(INDEX.orthoscopic, 0);
    await waitFor(() => mark('Orthoscopic View') === ' ');
  });

  it('a `full` batch re-reads even though no index of this menu was named', async () => {
    mount();
    openMenu('Display');
    await waitFor(() => getSettingsTap(session).live && fake.menuReads > 0);
    fake.values.set(INDEX.valence, 1);
    fake.log.push({ indices: [999], full: true }); // a session load
    await waitFor(() => mark('Show Valences') === '✓');
  });

  it('ignores a batch that names no setting of the open menu', async () => {
    mount();
    openMenu('Display');
    await waitFor(() => getSettingsTap(session).live && fake.menuReads > 0);
    const reads = fake.menuReads;

    // `sculpting_cycles` is in the Build menu, not this one.
    fake.names.set('sculpting_cycles', 1234);
    fake.change(1234, 10);
    await idle(700);
    expect(fake.menuReads).toBe(reads);

    // …and the very next batch that DOES name one still lands, so the filter
    // is a filter and not a mute button.
    fake.change(INDEX.valence, 1);
    await waitFor(() => fake.menuReads > reads);
  });

  it('reads nothing at all while every menu is closed', async () => {
    mount();
    await waitFor(() => getSettingsTap(session).live);
    const reads = fake.menuReads;
    fake.change(INDEX.orthoscopic, 1);
    await idle(600);
    expect(fake.menuReads).toBe(reads);
  });

  it('does not arm the 120 ms re-read while the tap is live', async () => {
    mount();
    openMenu('Display');
    await waitFor(() => getSettingsTap(session).live && fake.menuReads > 0);
    const reads = fake.menuReads;

    // A click whose write the fake bridge does NOT report through the tap:
    // if the 120 ms timer were still armed, this would re-read anyway.
    act(() => leaf('Orthoscopic View').click());
    await idle(600);
    expect(fake.menuReads).toBe(reads);
  });

  it('keeps the 120 ms re-read as the fallback when there is no tap', async () => {
    fake.refuseInstall = true;
    mount();
    openMenu('Display');
    await waitFor(() => fake.menuReads > 0);
    await waitFor(() => getSettingsTap(session).stats().installAttempts >= 3, 2000);
    expect(getSettingsTap(session).live).toBe(false);
    const reads = fake.menuReads;

    act(() => leaf('Orthoscopic View').click());
    await waitFor(() => fake.menuReads > reads);
  });
});
