/**
 * The quick-button grid's three unbuilt buttons and its progress row (row 58).
 *
 * The row's gap sentence was: "Draw/Ray, Builder and Properties ship as
 * labelled TODO buttons (those panels exist but have no hook registry to open
 * them), and the progress bar was never exercised under a long ray."
 *
 * Builder and Properties are now wired through `shell/panelHooks.ts`; Draw/Ray
 * still is not, because `features/render` publishes no open seam, and the test
 * for it asserts that it SAYS so rather than pretending. The progress row's
 * numbers come from a real ray, measured in `packages/bridge/tests/test_p8_a1.py`
 * (idle -1.0; 0.35 after 0.16 s of an async 900x700 surface ray).
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
import {
  isPanelOpen,
  panelMounted,
  registerMenuHook,
  resetPanelHooks,
} from '../../shell/panelHooks';
import { dialogsStore } from '../dialogs/store';
import { OPEN_EVENT } from '../builder/BuilderPanel';
import { QuickButtons, live, progressPercent } from './QuickButtons';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let session: Session;
let calls: string[];

function makeSession(): Session {
  const stores = {
    connection: createConnectionStore('ws://test/ws', true),
    feedback: createFeedbackStore(),
    objects: createObjectsStore(),
    ui: createUiStore(null),
  };
  return {
    config: {} as Session['config'],
    conn: { sendInput: vi.fn(), isOpen: true },
    stores,
    objectsSource: { poll: vi.fn(), invalidate: vi.fn() },
    poller: { stats: () => ({ hz: 30 }) },
    run: vi.fn(() => Promise.resolve()),
    act: vi.fn(),
    call: (fn: string) => {
      calls.push(fn);
      return Promise.resolve(null);
    },
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
        <QuickButtons />
      </SessionContext.Provider>,
    ),
  );
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll<HTMLButtonElement>('.quickbutton')].find(
    (el) => el.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no quick button ${label}`);
  return found;
}

async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function feedback(): string[] {
  return session.stores.feedback.get().lines.map((line) => line.text);
}

beforeEach(() => {
  calls = [];
  resetPanelHooks();
  session = makeSession();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetPanelHooks();
  for (const win of dialogsStore.get().windows) dialogsStore.close(win.key);
});

describe('Builder and Properties (row 58)', () => {
  it('opens the dock on the FIRST click even though the listener registers after the mount edge (D4)', async () => {
    // D4 REGRESSION. `FeatureSlot` renders `<MountMarker/>` before `<Panel/>`, so
    // in the commit that mounts the builder slot React runs the marker's effect —
    // which drains this intent via `panelMounted` — BEFORE `BuilderPanel`'s effect
    // adds its OPEN_EVENT listener. A synchronous dispatch on the drain hits
    // nobody: the panel stays collapsed and only a SECOND click opens it. The
    // intent now defers the dispatch to a microtask, so a listener that registers
    // AFTER the drain still receives the open on the first click. (Retargeted from
    // the old test that dispatched synchronously on the drain — that ordering was
    // the bug.)
    const opened = vi.fn();
    try {
      mount();
      expect(button('Builder').className).not.toContain('todo');
      act(() => button('Builder').click());
      await flush();

      // Slot open, intent queued, but the lazy panel is not mounted yet.
      expect(isPanelOpen('builder')).toBe(true);
      expect(opened).not.toHaveBeenCalled();

      // The mount edge drains the intent (MountMarker's effect)...
      act(() => panelMounted('builder'));
      // ...and only THEN does the panel's own effect add its listener, exactly as
      // BuilderPanel's effect runs after MountMarker's. The microtask has not run
      // yet, so a synchronous dispatch would already have been lost.
      window.addEventListener(OPEN_EVENT, opened);
      expect(opened).not.toHaveBeenCalled();

      // Once the queued microtask flushes, the late listener still gets the open.
      await flush();
      expect(opened).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(OPEN_EVENT, opened);
    }
  });

  it('Properties mounts the slot and opens the window in the dialogs store', async () => {
    mount();
    act(() => button('Properties').click());
    await flush();
    expect(isPanelOpen('properties')).toBe(true);
    expect(dialogsStore.isOpen('properties')).toBe(false);
    act(() => panelMounted('properties'));
    expect(dialogsStore.isOpen('properties')).toBe(true);
  });
});

describe('Draw/Ray, which is still unwired', () => {
  it('is marked TODO and names the missing seam instead of doing nothing', async () => {
    mount();
    const draw = button('Draw/Ray');
    expect(draw.className).toContain('quickbutton--todo');
    expect(draw.getAttribute('title')).toContain('TODO (WP-19)');

    act(() => draw.click());
    await flush(1);
    const said = feedback().join('\n');
    expect(said).toContain('features/render');
    expect(said).toContain('registerMenuHook');
  });

  it('goes live the moment a `render_dialog` hook is registered', async () => {
    const open = vi.fn();
    registerMenuHook('render_dialog', open);
    mount();
    const draw = button('Draw/Ray');
    expect(draw.className).not.toContain('todo');
    expect(live({ label: 'Draw/Ray', cmd: null, action: 'render', title: '' })).toBe(true);
    act(() => draw.click());
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('the progress row (row 58)', () => {
  it('is absent while idle — cmd.get_progress() is -1.0', () => {
    mount();
    expect(session.stores.connection.get().progress).toBeLessThan(0);
    expect(container.querySelector('.quickbuttons__progress')).toBeNull();
  });

  it('appears with the ray running and fills to int(progress*100)', () => {
    mount();
    // The number a real async `ray 900, 700` of a protein surface reported
    // 0.16 s in (`packages/bridge/tests/test_p8_a1.py`).
    act(() => {
      session.stores.connection.set({ progress: 0.35262593626976013 });
    });
    const row = container.querySelector('.quickbuttons__progress');
    expect(row).toBeTruthy();
    const bar = row?.querySelector<HTMLElement>('.progressbar');
    expect(bar?.getAttribute('aria-valuenow')).toBe('35');
    expect(row?.querySelector<HTMLElement>('.progressbar__fill')?.style.width).toBe('35%');
  });

  it('Abort sends cmd.interrupt while the job runs, and then the row goes away', () => {
    mount();
    act(() => {
      session.stores.connection.set({ progress: 0.5 });
    });
    const abort = button('Abort');
    expect(abort.disabled).toBe(false);
    act(() => abort.click());
    expect(calls).toEqual(['interrupt']);
    expect(feedback()).toContain('interrupt');

    // `cmd.interrupt` ends the ray, the status thread pushes -1.0 again, and
    // the row disappears — the state the old always-visible bar could not show.
    act(() => {
      session.stores.connection.set({ progress: -1 });
    });
    expect(container.querySelector('.quickbuttons__progress')).toBeNull();
  });

  it('reproduces Qt`s int() truncation, not a rounding of its own', () => {
    // `progress = int(cmd.get_progress() * 100)` (`pymol_qt_gui.py:931`).
    expect(progressPercent(0.999)).toBe(99);
    expect(progressPercent(0.0)).toBe(0); // a job that has just started IS shown
    expect(progressPercent(-1)).toBe(-100); // idle: any negative hides the row
    expect(progressPercent(Number.NaN)).toBe(-1);
  });
});
