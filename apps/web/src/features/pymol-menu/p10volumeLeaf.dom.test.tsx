/**
 * The menu-leaf interception seam, and the one leaf that needed it.
 *
 * Wave 9 measured the problem exactly: "every `pymol.menu` leaf in this client
 * is executed by one line, `session.run(command)` in
 * `features/pymol-menu/PopupMenu.tsx`, and there is no interception seam beside
 * it". `leafHooks.ts` is that seam and this file is its test — including the
 * property that matters most, which is that a client with NOTHING registered
 * behaves exactly as it did before.
 *
 * The rows are not invented. `[1, 'panel', "cmd.volume_panel('p10leafvol')"]`
 * is what `packages/engine/modules/pymol/menu.py:648` builds and what
 * `packages/bridge/tests/test_p10_volume.py` reads back off a real socket.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionContext } from '../../app';
import type { Session } from '../../app';
import { dialogsStore } from '../dialogs/store';
import { isPanelOpen, resetPanelHooks } from '../../shell/panelHooks';
import { MenuHost } from './MenuHost';
import { PopupMenu } from './PopupMenu';
import { dispatchLeaf, leafHookIds, registerLeafHook, resetLeafHooks } from './leafHooks';
import { pymolMenu } from './menuStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VOLUME = 'p10leafvol';
/** `menu.vol_color(None, 'p10leafvol')` rows 0-3, verbatim from the engine. */
const VOL_COLOR_ROWS = [
  [2, 'Coloring:', ''],
  [1, 'panel', `cmd.volume_panel('${VOLUME}')`],
  [0, '', ''],
  [1, '2fofc', `cmd.volume_color('${VOLUME}', "2fofc")`],
] as const;

let container: HTMLDivElement;
let root: Root;

const run = vi.fn(async () => undefined);
const call = vi.fn(async () => {
  throw new Error('no cmd.tenmol_volume in this double');
});
/** A socket that records subscriptions but never delivers one. */
const listeners = new Map<string, Set<(payload: unknown) => void>>();
const conn = {
  isOpen: true,
  on(event: string, listener: (payload: unknown) => void) {
    const set = listeners.get(event) ?? new Set();
    set.add(listener);
    listeners.set(event, set);
    return () => set.delete(listener);
  },
};

const SESSION = { run, call, conn } as unknown as Session;

function mount(node: React.ReactNode): void {
  act(() => {
    root.render(<SessionContext.Provider value={SESSION}>{node}</SessionContext.Provider>);
  });
}

function clickLeaf(label: string): void {
  const button = [...container.querySelectorAll('button')].find(
    (node) => node.textContent === label,
  );
  if (!button) throw new Error(`no leaf labelled ${label}`);
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

beforeEach(() => {
  run.mockClear();
  call.mockClear();
  listeners.clear();
  resetLeafHooks();
  resetPanelHooks();
  for (const window of dialogsStore.get().windows) dialogsStore.close(window.key);
  pymolMenu.close();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetLeafHooks();
  resetPanelHooks();
  for (const window of dialogsStore.get().windows) dialogsStore.close(window.key);
});

describe('dispatchLeaf', () => {
  it('falls back to the engine when nothing is registered', () => {
    const fallback = vi.fn();
    expect(dispatchLeaf('cmd.zoom()', fallback)).toBeNull();
    expect(fallback).toHaveBeenCalledWith('cmd.zoom()');
  });

  it('gives the command to the FIRST hook that claims it, and only that one', () => {
    const order: string[] = [];
    registerLeafHook('a', (c) => {
      order.push(`a:${c}`);
      return false;
    });
    registerLeafHook('b', () => {
      order.push('b');
      return true;
    });
    registerLeafHook('c', () => {
      order.push('c');
      return true;
    });
    const fallback = vi.fn();
    expect(dispatchLeaf('cmd.x()', fallback)).toBe('b');
    expect(order).toEqual(['a:cmd.x()', 'b']);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('treats a throwing hook as "not handled" rather than killing the menu', () => {
    registerLeafHook('boom', () => {
      throw new Error('hook is broken');
    });
    const fallback = vi.fn();
    expect(dispatchLeaf('cmd.zoom()', fallback)).toBeNull();
    expect(fallback).toHaveBeenCalledWith('cmd.zoom()');
  });

  it('unregisters, and re-registering the same id replaces rather than stacks', () => {
    const off = registerLeafHook('one', () => false);
    registerLeafHook('one', () => true);
    expect(leafHookIds()).toEqual(['one']);
    expect(dispatchLeaf('cmd.x()', vi.fn())).toBe('one');
    off();
    // The unregister belongs to the REPLACED hook and must not remove the live
    // one — last-registration-wins, like `registerMenuHook`.
    expect(leafHookIds()).toEqual(['one']);
  });
});

describe('PopupMenu', () => {
  it('is unchanged with no hook: the leaf string goes to the engine verbatim', () => {
    mount(<PopupMenu />);
    act(() => pymolMenu.openAt(10, 10, VOL_COLOR_ROWS, 'Coloring'));
    clickLeaf('2fofc');
    expect(run).toHaveBeenCalledWith(`cmd.volume_color('${VOLUME}', "2fofc")`);
  });

  it('sends nothing to the engine when a hook claims the leaf', () => {
    const seen: string[] = [];
    registerLeafHook('test', (command) => {
      seen.push(command);
      return command.startsWith('cmd.volume_panel(');
    });
    mount(<PopupMenu />);
    act(() => pymolMenu.openAt(10, 10, VOL_COLOR_ROWS, 'Coloring'));
    clickLeaf('panel');
    expect(seen).toEqual([`cmd.volume_panel('${VOLUME}')`]);
    expect(run).not.toHaveBeenCalled();
    // ...and the pop-up still closes, which is `PopUp.cpp`'s own behaviour.
    expect(container.querySelector('[data-testid="pymol-menu"]')).toBeNull();
  });
});

describe('MenuHost — the always-mounted registration point', () => {
  it('registers the volume leaf hook on mount and drops it on unmount', () => {
    expect(leafHookIds()).toEqual([]);
    mount(<MenuHost />);
    expect(leafHookIds()).toEqual(['volume-panel']);
    act(() => root.unmount());
    expect(leafHookIds()).toEqual([]);
    // re-create the root so `afterEach`'s unmount is still legal
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it('A > volume > panel opens the React editor instead of reaching PyMOL', () => {
    mount(<MenuHost />);
    act(() => pymolMenu.openAt(10, 10, VOL_COLOR_ROWS, 'Coloring'));
    clickLeaf('panel');

    // The command PyMOL's own menu emits never left the browser...
    expect(run).not.toHaveBeenCalled();
    // ...and the window it names is open, titled the way `_VolumePanel.__init__`
    // titles it (`packages/engine/modules/pmg_qt/volume.py:822`).
    const windows = dialogsStore.get().windows;
    expect(windows.map((w) => w.key)).toEqual([`volume:${VOLUME}`]);
    expect(windows[0]!.title).toBe(`${VOLUME} - Volume Color Map Editor`);
    // ...and the overlay slot that draws it is mounted, which is the half that
    // `dialogsStore` alone cannot do.
    expect(isPanelOpen('volume')).toBe(true);
  });

  it('raises the cached window rather than making a second, like _volume_windows_qt', () => {
    mount(<MenuHost />);
    act(() => pymolMenu.openAt(10, 10, VOL_COLOR_ROWS, 'Coloring'));
    clickLeaf('panel');
    const firstZ = dialogsStore.get().windows[0]!.z;

    act(() => pymolMenu.openAt(10, 10, VOL_COLOR_ROWS, 'Coloring'));
    clickLeaf('panel');
    const windows = dialogsStore.get().windows;
    expect(windows).toHaveLength(1);
    expect(windows[0]!.z).toBeGreaterThan(firstZ);
  });

  it('leaves every OTHER leaf of the same menu alone', () => {
    mount(<MenuHost />);
    act(() => pymolMenu.openAt(10, 10, VOL_COLOR_ROWS, 'Coloring'));
    clickLeaf('2fofc');
    expect(run).toHaveBeenCalledWith(`cmd.volume_color('${VOLUME}', "2fofc")`);
    expect(dialogsStore.get().windows).toEqual([]);
  });
});
