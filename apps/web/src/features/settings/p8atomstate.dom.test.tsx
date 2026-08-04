/**
 * The advanced table's atom-state scope — row 211's other half.
 *
 * Before this, `OFFERED_SCOPES` stopped at `atom` with the comment "offering
 * [atom-state] would be offering a no-op", which was true of `cmd.set` and not
 * of PyMOL: `cmd.alter_state`'s `s[...]` reaches it, and nothing else does.
 * MEASURED over the WebSocket (`packages/bridge/tests/test_p8_a5.py`), on one setting:
 *
 *     cmd.set(name, v, sele)                     -> ATOM level      (iterate sees it)
 *     cmd.alter(sele, "s[..]=v")                 -> ATOM level      (iterate sees it)
 *     cmd.alter_state(1, sele, "s[..]=v")        -> ATOM-STATE      (only iterate_state)
 *
 * so the scope is real, the write has to be a different verb, and the strip has
 * to say that the overrides cannot be listed back.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingCatalogue, SettingMeta } from '@tenmol/protocol';
import { createSettingsStore, type SettingsSource } from '@tenmol/stores/settings';
import { AdvancedSettingsTable } from './AdvancedSettingsTable';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The table measures its viewport; jsdom has no ResizeObserver.
class FakeResizeObserver {
  observe(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;

const SETTINGS: SettingMeta[] = [
  { name: 'label_screen_point', index: 728, kind: 'float3', level: 'atom-state' },
  { name: 'sphere_scale', index: 155, kind: 'float', level: 'atom' },
  { name: 'ray_trace_mode', index: 442, kind: 'int', level: 'global' },
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
      minMaxNote: 'PyMOL clamps int min/max on global writes',
      helpSource: 'packages/engine/data/setting_help.csv',
      helpRows: 875,
    },
  };
}

const write = vi.fn(async () => undefined);
const reset = vi.fn(async () => undefined);
const source = {
  write,
  reset,
  refresh: vi.fn(async () => undefined),
  scope: vi.fn(async () => ({ object: '', state: 0, objectSettings: [], atoms: [] })),
  getBonds: vi.fn(async () => ({ bonds: [] })),
  setBond: vi.fn(async () => undefined),
  unsetBond: vi.fn(async () => undefined),
} as unknown as SettingsSource;

const call = vi.fn(async () => 3);

let container: HTMLDivElement;
let root: Root;
let store: ReturnType<typeof createSettingsStore>;

beforeEach(() => {
  write.mockClear();
  call.mockClear();
  store = createSettingsStore();
  store.applyCatalogue(catalogue());
  store.setPhase('ready');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(): void {
  act(() => {
    root.render(
      <AdvancedSettingsTable store={store} source={source} objects={['obj']} call={call} />,
    );
  });
}

const scopeSelect = () => container.querySelector<HTMLSelectElement>('.setadv__scope select')!;
const selectionBox = () => container.querySelector<HTMLInputElement>('.setadv__sel')!;

function pick(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(select) as object,
    'value',
  )?.set;
  setter?.call(select, value);
  act(() => select.dispatchEvent(new Event('change', { bubbles: true })));
}

function type(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el) as object, 'value')?.set;
  setter?.call(el, value);
  act(() => el.dispatchEvent(new Event('input', { bubbles: true })));
}

/** React 19 delegates `onBlur` from the bubbling `focusout`, not from `blur`. */
function commit(name: string, value: string): void {
  const box = container.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
  type(box, value);
  act(() => box.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('the atom-state scope', () => {
  it('is offered', () => {
    mount();
    expect([...scopeSelect().options].map((o) => o.value)).toEqual([
      'global',
      'object',
      'object-state',
      'atom',
      'atom-state',
      'bond',
    ]);
  });

  it('writes through cmd.alter_state, not cmd.set', async () => {
    mount();
    pick(scopeSelect(), 'atom-state');
    type(selectionBox(), 'name CB');
    commit('label_screen_point', '1 2 3');
    await settle();
    expect(write).not.toHaveBeenCalled();
    expect(call).toHaveBeenCalledWith('alter_state', [
      1,
      'name CB',
      "s['label_screen_point']=(1.0, 2.0, 3.0)",
    ]);
  });

  it('reports the atom count alter_state answered', async () => {
    mount();
    pick(scopeSelect(), 'atom-state');
    type(selectionBox(), 'name CB');
    commit('label_screen_point', '1 2 3');
    await settle();
    expect(container.querySelector('[data-scope="atom-state"]')?.textContent).toContain(
      'alter_state: 3 atoms',
    );
  });

  it('deletes with del s[...] rather than cmd.unset', async () => {
    mount();
    pick(scopeSelect(), 'atom-state');
    type(selectionBox(), '*');
    const row = container.querySelector<HTMLElement>('[data-name="label_screen_point"]')!;
    act(() => row.querySelector<HTMLButtonElement>('.setadv__c-reset button')?.click());
    await settle();
    expect(reset).not.toHaveBeenCalled();
    expect(call).toHaveBeenCalledWith('alter_state', [1, '*', "del s['label_screen_point']"]);
  });

  it('locks the rows that are not atom-state level', () => {
    mount();
    pick(scopeSelect(), 'atom-state');
    type(selectionBox(), '*');
    const atomLevel = container.querySelector<HTMLElement>('[data-name="sphere_scale"]')!;
    expect(atomLevel.className).toContain('is-locked');
    expect(
      container.querySelector<HTMLInputElement>('input[aria-label="sphere_scale"]')?.disabled,
    ).toBe(true);
    const astate = container.querySelector<HTMLElement>('[data-name="label_screen_point"]')!;
    expect(astate.className).not.toContain('is-locked');
  });

  it('says the overrides cannot be listed back, instead of "none"', async () => {
    mount();
    pick(scopeSelect(), 'atom-state');
    type(selectionBox(), 'name CB');
    const strip = container.querySelector('[data-scope="atom-state"]')!;
    expect(strip.textContent).toContain('cmd.iterate_state');
    expect(strip.textContent).not.toContain('no per-atom overrides');
    // and the atom scope still gets the real enumeration
    pick(scopeSelect(), 'atom');
    expect(container.querySelector('[data-scope="atom"]')).not.toBeNull();
    await settle();
  });

  it('refuses rather than pretending when no session was passed', async () => {
    act(() => {
      root.render(<AdvancedSettingsTable store={store} source={source} objects={['obj']} />);
    });
    pick(scopeSelect(), 'atom-state');
    type(selectionBox(), '*');
    commit('label_screen_point', '1 2 3');
    await settle();
    expect(store.get().rejected[728]).toMatch(/need a session/);
  });

  it('rejects a malformed value instead of building a broken expression', async () => {
    mount();
    pick(scopeSelect(), 'atom-state');
    type(selectionBox(), '*');
    commit('label_screen_point', 'not three numbers');
    await settle();
    expect(call).not.toHaveBeenCalled();
    expect(store.get().rejected[728]).toMatch(/three numbers/);
  });
});
