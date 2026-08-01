/**
 * Parity rows 112-113, the wiring half.
 *
 * `orthoOverlays.dom.test.tsx` mounts `<BusyOverlay>` and `<OrthoLoopRect>`
 * directly and drives the `showSplash` helper as a function.  All of that
 * still passes with every one of them deleted from `ConsolePanel` — measured:
 * removing `<BusyOverlay />` and `<OrthoLoopRect />` from the panel, and
 * removing the `splash` button, leaves the whole web suite at 771 passed.
 *
 * So this file pins the thing the product actually needs: that the console
 * feature MOUNTS them and that the button is wired to `cmd.splash(0)`.  The
 * children that need a live socket are stubbed; the three things under test
 * are real.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConnectionStore, createFeedbackStore, createUiStore } from '@tenmol/stores';
import { createConsoleStore, type ConsoleStore } from '@tenmol/stores/console';
import { SessionContext, type Session } from '../../app';

/* The three panes that need a socket, a canvas or the ortho ring are not what
 * is under test here. */
vi.mock('./FeedbackLog', () => ({ FeedbackLog: () => null }));
vi.mock('./CommandLine', () => ({ CommandLine: () => null }));
vi.mock('./QuickButtons', () => ({ QuickButtons: () => null }));
vi.mock('./OrthoConsole', () => ({ OrthoConsole: () => null }));

/* `getConsoleSource()` is a module singleton that builds a real `Session` via
 * `getSession()`, which opens a WebSocket.  The panel only needs the store and
 * the settings refresh. */
let consoleStore: ConsoleStore;
const refreshSettings = vi.fn(async () => undefined);
vi.mock('./consoleSource', () => ({
  getConsoleSource: () => ({
    store: consoleStore,
    refreshSettings,
    stop: () => undefined,
  }),
}));

const { ConsolePanel } = await import('./ConsolePanel');

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let viewport: HTMLDivElement;
let root: Root;
let connection: ReturnType<typeof createConnectionStore>;
const call = vi.fn(async (fn: string, args: readonly unknown[] = []) => {
  if (fn === 'cmd.get_setting_int') return 1;
  if (fn === 'cmd.get_setting_text') return '3-Button Viewing';
  void args;
  return null;
});

function session(): Session {
  return {
    call,
    stores: {
      connection,
      feedback: createFeedbackStore(),
      ui: createUiStore(),
    },
  } as unknown as Session;
}

beforeEach(async () => {
  call.mockClear();
  refreshSettings.mockClear();
  consoleStore = createConsoleStore();
  connection = createConnectionStore('ws://test/ws', false);
  container = document.createElement('div');
  viewport = document.createElement('div');
  viewport.className = 'shell__viewport';
  viewport.getBoundingClientRect = () =>
    ({ left: 40, top: 25, width: 800, height: 600, right: 840, bottom: 625 }) as DOMRect;
  document.body.append(container, viewport);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <SessionContext.Provider value={session()}>{<ConsolePanel />}</SessionContext.Provider>,
    );
    // The overlays' mount effects each fire an RPC; let both settle inside
    // `act` so the panel is quiet before a test touches it.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  viewport.remove();
});

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function bar(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as
    HTMLButtonElement | undefined;
}

describe('the console feature mounts the two ortho overlays', () => {
  it('portals the busy box over the viewport once a job reports', async () => {
    await settle();
    expect(viewport.querySelector('[data-testid="ortho-busy"]')).toBeNull();

    act(() => connection.setProgress(0.5));
    await settle();
    const box = viewport.querySelector<HTMLElement>('[data-testid="ortho-busy"]');
    expect(box).not.toBeNull();
    expect(box?.style.width).toBe('240px');
  });

  it('portals the marquee over the viewport for a shift+left drag', async () => {
    await settle();
    act(() => {
      viewport.dispatchEvent(
        new MouseEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          clientX: 140,
          clientY: 125,
          shiftKey: true,
        }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new MouseEvent('pointermove', {
          bubbles: true,
          clientX: 340,
          clientY: 425,
          shiftKey: true,
        }),
      );
    });
    const rect = viewport.querySelector<HTMLElement>('[data-testid="ortho-loop"]');
    expect(rect).not.toBeNull();
    expect([rect?.style.left, rect?.style.top]).toEqual(['100px', '100px']);
    expect(rect?.dataset['kind']).toBe('add');
  });
});

describe('the splash button', () => {
  it('exists in the console bar', async () => {
    await settle();
    expect(bar('splash')).toBeDefined();
  });

  it('runs the REAL cmd.splash(0) and raises the flag that shows it', async () => {
    await settle();
    expect(consoleStore.get().splash).toBe(false); // the bridge boots show_splash=0
    act(() => consoleStore.setVisible(false));

    act(() => bar('splash')?.click());
    await settle();

    expect(call).toHaveBeenCalledWith('cmd.splash', [0]);
    expect(consoleStore.get().splash).toBe(true);
    expect(consoleStore.get().visible).toBe(true);
  });
});
