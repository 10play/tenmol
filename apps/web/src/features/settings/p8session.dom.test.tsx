/**
 * Session / defaults lifecycle — row 212's two open items.
 *
 * The row's plan: "File menu items Reinitialize > Everything / Original
 * Settings / Stored Settings / Store Current Settings; full catalogue+value
 * re-fetch after any of them", plus `is_session_blacklisted`.
 *
 * The word each label sends is the interesting part, because the labels lie:
 * "Stored Settings" is `reinitialize settings` and "Original Settings" is
 * `reinitialize original_settings`. That pairing is diffed against `_gui.py` in
 * `packages/bridge/tests/test_p8_a5.py::test_the_reinit_codes_and_menu_labels_are_pymols_own`,
 * and the blacklist against `packages/engine/layer1/Setting.cpp` plus a live session dump.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingCatalogue, SettingMeta } from '@tenmol/protocol';
import { createSettingsStore, type SettingsSource } from '@tenmol/stores/settings';
import { AdvancedSettingsTable } from './AdvancedSettingsTable';
import {
  REINITIALIZE_MENU,
  REINIT_CODES,
  SESSION_BLACKLIST,
  isSessionBlacklisted,
} from './sessionLifecycle';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeResizeObserver {
  observe(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;

const SETTINGS: SettingMeta[] = [
  { name: 'internal_gui', index: 220, kind: 'boolean', level: 'global' },
  { name: 'sphere_scale', index: 155, kind: 'float', level: 'atom' },
  { name: 'ray_blend_colors', index: 0, kind: 'boolean', level: 'unused' },
] as SettingMeta[];

function catalogue(): SettingCatalogue {
  return {
    version: 1,
    count: SETTINGS.length,
    settings: SETTINGS,
    aliases: {},
    counts: {},
    levelCounts: {},
    meta: {
      cSettingInit: 798,
      indexDictSize: 780,
      nameListSize: 779,
      defaultsSource: 'packages/engine/layer1/SettingInfo.h',
      defaultsNote: '',
      minMaxEnforced: false,
      minMaxNote: '',
      helpSource: null,
      helpRows: 0,
    },
  };
}

const bootstrap = vi.fn(async () => undefined);
const source = {
  bootstrap,
  write: vi.fn(async () => undefined),
  reset: vi.fn(async () => undefined),
  refresh: vi.fn(async () => undefined),
  scope: vi.fn(async () => ({ object: '', state: 0, objectSettings: [], atoms: [] })),
  getBonds: vi.fn(async () => ({ bonds: [] })),
  setBond: vi.fn(async () => undefined),
  unsetBond: vi.fn(async () => undefined),
} as unknown as SettingsSource;

const call = vi.fn(async () => null);

let container: HTMLDivElement;
let root: Root;
let store: ReturnType<typeof createSettingsStore>;

beforeEach(() => {
  call.mockClear();
  bootstrap.mockClear();
  store = createSettingsStore();
  store.applyCatalogue(catalogue());
  store.setPhase('ready');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<AdvancedSettingsTable store={store} source={source} objects={[]} call={call} />);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const button = (what: string) =>
  container.querySelector<HTMLButtonElement>(`.setadv__reinit button[data-what="${what}"]`)!;

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('is_session_blacklisted, ported', () => {
  it('covers the named system-dependent settings and the whole unused level', () => {
    expect(SESSION_BLACKLIST).toHaveLength(45);
    expect(isSessionBlacklisted({ name: 'internal_gui', level: 'global' })).toBe(true);
    expect(isSessionBlacklisted({ name: 'sphere_scale', level: 'atom' })).toBe(false);
    // by level, not by name — 18 records are `unused` and none of them are listed
    expect(isSessionBlacklisted({ name: 'anything_at_all', level: 'unused' })).toBe(true);
    expect(SESSION_BLACKLIST).not.toContain('ray_blend_colors');
  });

  it('marks the blacklisted rows in the table and no others', () => {
    const marked = [...container.querySelectorAll('.setadv__row')]
      .filter((row) => row.querySelector('.setadv__nopse'))
      .map((row) => row.getAttribute('data-name'));
    expect(marked).toEqual(['internal_gui', 'ray_blend_colors']);
  });
});

describe('File ▸ Reinitialize', () => {
  it('offers PyMOL’s four entries, with PyMOL’s labels', () => {
    const labels = [...container.querySelectorAll('.setadv__reinit button')].map(
      (el) => el.textContent,
    );
    expect(labels).toEqual([
      'Everything',
      'Original Settings',
      'Stored Settings',
      'Store Current Settings',
    ]);
    expect(REINITIALIZE_MENU.map((e) => e.what)).toEqual([
      'everything',
      'original_settings',
      'settings',
      'store_defaults',
    ]);
    // every word is one `cmd.reinitialize` accepts
    for (const entry of REINITIALIZE_MENU) expect(REINIT_CODES[entry.what]).toBeTypeOf('number');
  });

  it('sends the WORD, not the code, and re-bootstraps afterwards', async () => {
    act(() => button('settings').click());
    await settle();
    expect(call).toHaveBeenCalledWith('reinitialize', ['settings']);
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  it('does not confuse Stored Settings with Original Settings', async () => {
    act(() => button('original_settings').click());
    await settle();
    expect(call).toHaveBeenCalledWith('reinitialize', ['original_settings']);
  });

  it('makes the one destructive entry ask first', async () => {
    act(() => button('everything').click());
    await settle();
    expect(call).not.toHaveBeenCalled();
    expect(button('everything').textContent).toBe('Everything?');
    act(() => button('everything').click());
    await settle();
    expect(call).toHaveBeenCalledWith('reinitialize', ['everything']);
  });
});
