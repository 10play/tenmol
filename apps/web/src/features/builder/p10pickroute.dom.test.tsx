/**
 * Parity rows 418 and 412, the client halves.
 *
 * ROW 418 said: "nothing in apps/web routes a viewport pick into the builder
 * controller's pick() at all (only builder.test.ts calls it)". This mounts the
 * real `<BuilderPanel/>`, hands a hit to the viewport's own
 * `routeViewportPick()` — the exact function `viewport.ts` calls for a GL-free
 * click — and asserts `cmd.builder_pick` crossed the wire with the right
 * arguments, including the SECOND atom index for a bond.
 *
 * ROW 412 asked for "two toolbar buttons plus keyboard shortcuts". The buttons
 * were there and tested nowhere; the shortcuts did not exist.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuilderState } from '@tenmol/protocol/topics/builder';
import {
  routeViewportPick,
  resetPickRoutes,
  pickRouteCount,
  type PickHit,
} from './viewportPicking';
import { SessionContext, type Session } from '../../app';
import { BuilderPanel } from './BuilderPanel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = (over: Partial<BuilderState> = {}): BuilderState => ({
  editor: { picked: [], slots: [], hasBond: false, nFrag: 0, active: false, hasActiveSele: false },
  mouse: { button_mode: 2, mode_name: 'three_button_editing', editing: true },
  wizard: null,
  settings: {
    clean_electro_mode: 1,
    sculpt_vdw_vis_mode: 0,
    suspend_undo: 0,
    valence: 1,
    auto_overlay: 1,
    editor_auto_measure: 0,
    secondary_structure: 2,
    auto_remove_hydrogens: 0,
    sculpting: 0,
    sculpting_cycles: 10,
  },
  clean_available: false,
  clean_reason: 'Incentive-only',
  undo_is_noop: true,
  objects: ['eth'],
  ...over,
});

const tables = {
  elements: [],
  chemRow0Fragments: [],
  functionalGroups: [],
  rings: [],
  secondaryStructure: [],
  dnaBases: [],
  rnaBases: [],
  bondOrders: [],
  settingCheckboxes: [],
  fragments: [],
  missingFragments: [],
};

/** A stick hit: both ends of the C01-C02 bond, 0-based as the CGO payload is. */
const bondHit: PickHit = {
  object: 'eth',
  rep: 5,
  state: 0,
  index: 0,
  index2: 1,
  bond: -1,
  distance: 10,
  kind: 'cylinder',
  ringRadius: 0,
};

const atomHit: PickHit = { ...bondHit, index: 3, index2: null, kind: 'sphere', rep: 7 };

let container: HTMLDivElement;
let root: Root;
let current: BuilderState;
const call = vi.fn(async (fn: string) => {
  if (fn === 'cmd.builder_tables') return tables;
  return current;
});
const run = vi.fn(async () => undefined);

function session(): Session {
  return { call, run, stores: {} } as unknown as Session;
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Mount and open the panel, leaving `current` as the state it will report. */
async function open(next: BuilderState): Promise<void> {
  current = next;
  await act(async () => {
    root.render(<SessionContext.Provider value={session()}>{<BuilderPanel />}</SessionContext.Provider>);
  });
  const launch = container.querySelector<HTMLButtonElement>('button.builder-launch');
  await act(async () => launch?.click());
  await settle();
  call.mockClear();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  resetPickRoutes();
  call.mockClear();
  run.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetPickRoutes();
  vi.useRealTimers();
});

describe('a viewport pick reaches the Builder', () => {
  it('registers a route only while the panel is open, and drops it on unmount', async () => {
    expect(pickRouteCount()).toBe(0);
    await open(state());
    expect(pickRouteCount()).toBe(1);
    act(() => root.unmount());
    expect(pickRouteCount()).toBe(0);
    // React 18 double-invokes effects in StrictMode; the cleanup must leave
    // NOTHING behind, or an unmounted panel keeps swallowing clicks.
    root = createRoot(container);
  });

  it('sends an atom pick as cmd.builder_pick(object, index+1, null, multi)', async () => {
    await open(state());
    let taken = false;
    act(() => {
      taken = routeViewportPick(atomHit);
    });
    await settle();
    expect(taken).toBe(true);
    expect(call).toHaveBeenCalledWith('cmd.builder_pick', ['eth', 4, null, 'multi'], {});
  });

  it('sends BOTH atom indices when a bond wizard is armed', async () => {
    await open(state({ wizard: { name: 'UnbondWizard', mine: true, prompt: [], panel: [], repeating: false } }));
    act(() => {
      routeViewportPick(bondHit);
    });
    await settle();
    expect(call).toHaveBeenCalledWith('cmd.builder_pick', ['eth', 1, 2, 'bond'], {});
  });

  it('does the same for the ValenceWizard', async () => {
    await open(state({ wizard: { name: 'ValenceWizard', mine: true, prompt: [], panel: [], repeating: false } }));
    act(() => {
      routeViewportPick(bondHit);
    });
    await settle();
    expect(call).toHaveBeenCalledWith('cmd.builder_pick', ['eth', 1, 2, 'bond'], {});
  });

  it('refuses a single-atom hit while armed for a bond, and says why', async () => {
    await open(state({ wizard: { name: 'UnbondWizard', mine: true, prompt: [], panel: [], repeating: false } }));
    let taken = false;
    act(() => {
      taken = routeViewportPick(atomHit);
    });
    await settle();
    // Consumed — falling through would rewrite `sele` mid-gesture.
    expect(taken).toBe(true);
    expect(call).not.toHaveBeenCalledWith('cmd.builder_pick', expect.anything(), expect.anything());
    expect(container.querySelector('[data-testid="builder-error"]')?.textContent).toContain(
      'pick a BOND',
    );
  });

  it('leaves the click to the viewport when PyMOL is not in editing mode', async () => {
    await open(
      state({ mouse: { button_mode: 0, mode_name: 'three_button_viewing', editing: false } }),
    );
    let taken = true;
    act(() => {
      taken = routeViewportPick(atomHit);
    });
    await settle();
    expect(taken).toBe(false);
    expect(call).not.toHaveBeenCalledWith('cmd.builder_pick', expect.anything(), expect.anything());
  });

  it('follows the wizard the 4 Hz poll reports without re-registering', async () => {
    await open(state());
    // The route is registered once; the wizard arrives on a later poll.
    current = state({
      wizard: { name: 'UnbondWizard', mine: true, prompt: [], panel: [], repeating: false },
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });
    await settle();
    expect(pickRouteCount()).toBe(1);
    call.mockClear();
    act(() => {
      routeViewportPick(bondHit);
    });
    await settle();
    expect(call).toHaveBeenCalledWith('cmd.builder_pick', ['eth', 1, 2, 'bond'], {});
  });
});

describe('Undo / Redo', () => {
  const button = (label: string): HTMLButtonElement | undefined =>
    [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as
      | HTMLButtonElement
      | undefined;

  it('keeps the Qt tooltips exactly', async () => {
    await open(state());
    expect(button('Undo')?.title).toBe('Undo last change');
    expect(button('Redo')?.title).toBe('Redo last change');
  });

  it('runs cmd.undo and cmd.redo from the two buttons', async () => {
    await open(state());
    act(() => button('Undo')?.click());
    await settle();
    expect(call).toHaveBeenCalledWith('cmd.undo');
    act(() => button('Redo')?.click());
    await settle();
    expect(call).toHaveBeenCalledWith('cmd.redo');
  });

  it('runs them from Ctrl-Z / Ctrl-Shift-Z / Ctrl-Y inside the panel', async () => {
    await open(state());
    const dialog = container.querySelector<HTMLElement>('.builder');
    expect(dialog).not.toBeNull();
    const press = (key: string, shiftKey = false) => {
      const event = new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey, bubbles: true, cancelable: true });
      act(() => {
        dialog?.dispatchEvent(event);
      });
      return event;
    };

    const z = press('z');
    await settle();
    expect(call).toHaveBeenCalledWith('cmd.undo');
    expect(z.defaultPrevented).toBe(true);

    call.mockClear();
    press('z', true);
    await settle();
    expect(call).toHaveBeenCalledWith('cmd.redo');

    call.mockClear();
    press('y');
    await settle();
    expect(call).toHaveBeenCalledWith('cmd.redo');

    // A bare `z` must still type into whatever has focus.
    call.mockClear();
    act(() => {
      dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true, cancelable: true }));
    });
    await settle();
    expect(call).not.toHaveBeenCalled();
  });

  it('still says that editor.undocontext is a no-op, because it is', async () => {
    await open(state());
    expect(container.textContent).toContain('editor.undocontext is a no-op here');
  });
});
