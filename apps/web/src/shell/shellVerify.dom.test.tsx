/**
 * Wave-6 ADVERSARIAL re-verification of parity rows 53, 54 and 103.
 *
 * `shell.dom.test.tsx` and `orthoPanel.test.ts` pin the shell's own behaviour.
 * This file exists because two of their claims turned out to be pinned by
 * nothing:
 *
 *  1. **Row 103, the double-click timer anchor.** `CControl::click` writes
 *     `I->LastClickTime` ONLY in the branch that arms a drag
 *     (`packages/engine/layer1/Control.cpp:466-467`); the collapse/restore branch sets
 *     `I->SkipRelease = true`, which also skips the second write in
 *     `CControl::release` (`:377-380`). `gutterClick` used to restart the timer
 *     on every click, and the whole existing suite passed either way — so the
 *     divergence below is the test that would have caught it. FIXED in
 *     `orthoPanel.ts`; this is the pin.
 *
 *  2. **Row 54, "preventDefault is what stops `features/keyboard` forwarding
 *     Ctrl+E to PyMOL".** `shell.dom.test.tsx` mocks the feature registry out
 *     entirely, so it asserts `defaultPrevented` and nothing more: it would
 *     pass just as well if `KeyboardService` ignored the flag. Here both
 *     listeners are mounted for real and the assertion is on
 *     `conn.sendInput` — no `{t:'input'}` frame leaves the browser.
 *
 * Everything else in those two rows was re-measured over the socket
 * (`packages/bridge/tests/test_wf_shellverify.py`) and in a real headless browser, and
 * held.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  createConnectionStore,
  createFeedbackStore,
  createObjectsStore,
  createUiStore,
} from '@tenmol/stores';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionContext, type Session } from '../app';
import { AppShell } from './AppShell';
import { KeyboardService } from '../features/keyboard/KeyboardService';
import { GUTTER_DOUBLE_CLICK_MS, GUTTER_INITIAL, ORTHO, gutterClick } from './orthoPanel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ------------------------------------------------------------------ row 103 */

describe('the gutter timer is anchored on the ARMING click (row 103)', () => {
  it('does not restart the 0.35 s window when a click collapses or restores', () => {
    // CControl::click assigns LastClickTime in the `else` branch only.
    const armed = gutterClick(GUTTER_INITIAL, 1000);
    expect(armed.changed).toBe(false);
    expect(armed.state.lastClickAt).toBe(1000);

    const collapsed = gutterClick(armed.state, 1100);
    expect(collapsed.changed).toBe(true);
    expect(collapsed.state.width).toBe(ORTHO.controlMinWidth);
    // THE POINT: still 1000, not 1100.
    expect(collapsed.state.lastClickAt).toBe(1000);

    const restored = gutterClick(collapsed.state, 1200);
    expect(restored.changed).toBe(true);
    expect(restored.state.width).toBe(220);
    expect(restored.state.lastClickAt).toBe(1000);
  });

  it('re-arms instead of restoring once the window has run out', () => {
    // Clicks 0.30 s apart. PyMOL: arm at 0, collapse at 0.30, and at 0.60 the
    // anchor is still 0 — 0.60 >= 0.35 — so the third click ARMS A DRAG and the
    // panel STAYS collapsed. Restarting the timer on every click restored it
    // here instead, which is the bug this pins.
    const armed = gutterClick(GUTTER_INITIAL, 0).state;
    const collapsed = gutterClick(armed, 300);
    expect(collapsed.state.width).toBe(ORTHO.controlMinWidth);

    const third = gutterClick(collapsed.state, 600);
    expect(third.changed).toBe(false);
    expect(third.state.width).toBe(ORTHO.controlMinWidth);
    expect(third.state.savedWidth).toBe(220); // still remembered, for later

    // ...and a genuine second double click, anchored on that third click, does
    // restore.
    const fourth = gutterClick(third.state, 600 + GUTTER_DOUBLE_CLICK_MS - 1);
    expect(fourth.changed).toBe(true);
    expect(fourth.state.width).toBe(220);
    expect(fourth.state.savedWidth).toBe(0);
  });
});

/* ------------------------------------------------------------------- row 54 */

vi.mock('../features/registry', () => ({
  FEATURE_SLOTS: [],
  UNDECLARED_FEATURES: [],
  getSlot: () => undefined,
  isInstalled: () => false,
  loadFeature: () => undefined,
  installedFeatureIds: () => [],
  slotsForRegion: () => [],
}));

let container: HTMLDivElement;
let root: Root;
let sendInput: ReturnType<typeof vi.fn>;
let session: Session;

function makeSession(): Session {
  sendInput = vi.fn();
  return {
    config: {} as Session['config'],
    conn: { sendInput, isOpen: true } as unknown as Session['conn'],
    stores: {
      connection: createConnectionStore('ws://test/ws', true),
      feedback: createFeedbackStore(),
      objects: createObjectsStore(),
      ui: createUiStore(null),
    },
    objectsSource: { poll: vi.fn(), invalidate: vi.fn() } as unknown as Session['objectsSource'],
    poller: { stats: () => ({ hz: 30 }) } as unknown as Session['poller'],
    run: vi.fn(),
    act: vi.fn(),
    call: () => Promise.resolve(null),
    reconnect: vi.fn(),
    disconnect: vi.fn(),
    useToken: vi.fn(),
    probeHealth: vi.fn(),
  } as unknown as Session;
}

beforeEach(async () => {
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  session = makeSession();
  await act(async () => {
    root.render(
      <SessionContext.Provider value={session}>
        <AppShell />
        {/* The real global key bridge, mounted alongside the shell exactly as
            `features/keyboard/register.ts` mounts it in the running app. */}
        <KeyboardService />
      </SessionContext.Provider>,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function press(init: KeyboardEventInit & { key: string }): void {
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
    );
  });
}

describe('Ctrl+E is consumed by the shell, not forwarded to PyMOL (row 54)', () => {
  it('toggles the dock and sends NO input frame', () => {
    expect(document.querySelector('[data-testid="extgui"]')?.getAttribute('data-dock')).toBe(
      'bottom',
    );

    press({ key: 'e', ctrlKey: true });

    expect(document.querySelector('[data-testid="extgui"]')?.getAttribute('data-dock')).toBe(
      'float',
    );
    // `KeyboardService` returns early on `ev.defaultPrevented`
    // (`features/keyboard/KeyboardService.tsx:64`), which is only true because
    // the shell listens in the CAPTURE phase on `window`. Qt's window-level
    // QShortcut consumes the key the same way.
    expect(sendInput).not.toHaveBeenCalled();
  });

  it('still forwards an ordinary key, so the guard is not just "nothing works"', () => {
    // Without this the test above would pass with the whole keyboard bridge
    // broken. `k` is unmodified and not browser-reserved, so it must reach the
    // transport as a `{t:'input', kind:'button'}` frame.
    press({ key: 'k' });
    expect(sendInput).toHaveBeenCalledTimes(1);
    expect(sendInput.mock.calls[0]?.[0]).toMatchObject({ t: 'input', kind: 'button' });
  });
});
