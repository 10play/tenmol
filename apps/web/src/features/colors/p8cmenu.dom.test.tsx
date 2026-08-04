/**
 * The two pieces of the C menu waves 4-7 left out.
 *
 * row 230  the ten fixed-carbon shortcuts `util.cbag`..`cbak` as their own
 *          entries. They are not aliases of the by-element tiles: `cba` ends
 *          with `cmd.color(color, sel, flags=1)` and they do not, so they leave
 *          the OBJECT colour alone — measured in
 *          `packages/bridge/tests/test_p8_a5.py::test_the_fixed_carbon_shortcuts_leave_the_object_colour_alone`.
 * row 231  `pymol.menu.mesh_color`'s negative-colour submenu (menu.py:696-712),
 *          which is what a mesh or surface object's C button really opens
 *          (`packages/engine/layer3/Executive.cpp:15249-15256`).
 *
 * What this file pins is the WIRE: which call, which arguments, in which order.
 * That the engine then does what the call says is the bridge test's job.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ColorEntry } from '@tenmol/protocol';
import { SessionContext, type Session } from '../../app';
import { SwatchGrid } from './SwatchGrid';
import { FIXED_CARBON_SHORTCUTS, negativeSettings } from './menuData';
import { EMPTY_PALETTE, type PaletteState } from './palette';
import { resetPaletteStore } from './usePalette';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The real slot indices for the eleven colours this file names, read off the
 * live engine and pinned there by
 * `test_p8_a5.py::test_the_ten_shortcut_colours_resolve_to_these_slots`.
 */
const NAMED: Record<string, number> = {
  carbon: 26,
  cyan: 5,
  lightmagenta: 154,
  yellow: 6,
  salmon: 9,
  hydrogen: 29,
  slate: 11,
  brightorange: 30,
  purple: 19,
  pink: 48,
  tv_red: 32,
};

function palette(): PaletteState {
  const entries: ColorEntry[] = [];
  for (let i = 0; i <= 5387; i++) entries.push({ index: i, name: `slot${i}`, rgb: [0, 0, 0] });
  for (const [name, index] of Object.entries(NAMED)) {
    entries[index] = { index, name, rgb: [0.1, 0.2, 0.3] };
  }
  return { ...EMPTY_PALETTE, status: 'ready', entries, named: [], revision: 1 };
}

const call = vi.fn(async () => null);
const appendClient = vi.fn();
const session = {
  call,
  stores: { feedback: { appendClient } },
  objectsSource: { invalidate: vi.fn() },
  poller: { kick: vi.fn() },
} as unknown as Session;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  call.mockClear();
  appendClient.mockClear();
  resetPaletteStore();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(sele = '(all)'): void {
  act(() => {
    root.render(
      <SessionContext.Provider value={session}>
        <SwatchGrid palette={palette()} sele={sele} />
      </SessionContext.Provider>,
    );
  });
}

const tab = (label: string) =>
  [...container.querySelectorAll<HTMLElement>('.cmenu__tab')].find(
    (el) => el.textContent?.trim() === label,
  );

const shortcutTile = (fn: string) =>
  [...container.querySelectorAll<HTMLElement>('.cmenu__tile--shortcut')].find(
    (el) => el.textContent?.trim() === fn,
  );

const row = (text: string) =>
  [...container.querySelectorAll<HTMLElement>('.cmenu__row')].find((el) =>
    el.textContent?.includes(text),
  );

/** Wait for the `useColorAction` promise chain (it awaits the call, then kicks). */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('the ten fixed-carbon shortcuts', () => {
  it('are all on the by-element page, labelled by verb', () => {
    mount();
    act(() => tab('by element')?.click());
    const labels = [...container.querySelectorAll<HTMLElement>('.cmenu__tile--shortcut')].map(
      (el) => el.textContent?.trim(),
    );
    expect(labels).toEqual(FIXED_CARBON_SHORTCUTS.map((s) => s.fn));
    expect(labels).toHaveLength(10);
  });

  it('calls util.<verb>(selection) — one call, no colour argument', async () => {
    mount('chain B');
    act(() => tab('by element')?.click());
    act(() => shortcutTile('cbam')?.click());
    await settle();
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith('util.cbam', ['chain B'], {});
    expect(appendClient).toHaveBeenCalledWith('util.cbam("chain B")');
  });

  it('is a different call from the by-element tile with the same colour', async () => {
    mount();
    act(() => tab('by element')?.click());
    // `lightmagenta` appears twice on this page: as cba(154) and as cbam.
    const tile = [...container.querySelectorAll<HTMLElement>('.cmenu__tile')].find(
      (el) => el.textContent?.trim() === 'lightmagenta',
    );
    act(() => tile?.click());
    await settle();
    expect(call).toHaveBeenCalledWith('util.cba', [154, '(all)'], {});
    call.mockClear();
    act(() => shortcutTile('cbam')?.click());
    await settle();
    expect(call).toHaveBeenCalledWith('util.cbam', ['(all)'], {});
  });
});

describe('the negative-colour submenu (mesh_color)', () => {
  it('names the two settings the menu writes, per rep', () => {
    expect(negativeSettings('mesh')).toEqual({
      visible: 'mesh_negative_visible',
      color: 'mesh_negative_color',
    });
    expect(negativeSettings('surface')).toEqual({
      visible: 'surface_negative_visible',
      color: 'surface_negative_color',
    });
  });

  it('`off` is one write: <rep>_negative_visible = 0', async () => {
    mount('myMesh');
    act(() => tab('negative')?.click());
    act(() => row('off')?.click());
    await settle();
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith('set', ['mesh_negative_visible', 0, 'myMesh'], { quiet: 0 });
  });

  it('a colour is TWO writes, visible first, then the colour', async () => {
    mount('myMesh');
    act(() => tab('negative')?.click());
    act(() => row('pick a colour below')?.click());
    // now any swatch writes the negative colour instead of colouring atoms
    const tile = [...container.querySelectorAll<HTMLElement>('.cmenu__tile')].find(
      (el) => el.textContent?.trim() === 'tv_red',
    );
    act(() => tile?.click());
    await settle();
    expect(call.mock.calls.map((c) => c.slice(0, 2))).toEqual([
      ['set', ['mesh_negative_visible', 1, 'myMesh']],
      ['set', ['mesh_negative_color', 'tv_red', 'myMesh']],
    ]);
  });

  it('follows the rep switch, because a surface object gets mesh_color too', async () => {
    mount('mySurface');
    act(() => tab('negative')?.click());
    const surface = [...container.querySelectorAll<HTMLElement>('.cmenu__page')].find(
      (el) => el.textContent?.trim() === 'surface',
    );
    act(() => surface?.click());
    act(() => row('off')?.click());
    await settle();
    expect(call).toHaveBeenCalledWith('set', ['surface_negative_visible', 0, 'mySurface'], {
      quiet: 0,
    });
  });

  it('does not hijack the swatch grid when it is not armed', async () => {
    mount('myMesh');
    act(() => tab('negative')?.click());
    const tile = [...container.querySelectorAll<HTMLElement>('.cmenu__tile')].find(
      (el) => el.textContent?.trim() === 'tv_red',
    );
    act(() => tile?.click());
    await settle();
    expect(call).toHaveBeenCalledWith('color_deep', ['tv_red', 'myMesh'], { quiet: 0 });
  });
});
