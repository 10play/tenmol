/**
 * The window shell, mounted.
 *
 * Parity inventory rows 53 (main window shell), 54 (External GUI dock), 88
 * (internal GUI column) and 103 (control gutter). The pure arithmetic lives in
 * `orthoPanel.test.ts`; this file is the WIRING — what actually reaches
 * `cmd.set`, what `document.title` becomes, what Ctrl+E does to the dock, and
 * the stack order the stylesheet imposes on the column.
 *
 * The session is faked (real stores, a stub transport) so nothing here opens a
 * socket; `apps/web/src/app/session.ts` is a module singleton and importing it
 * would connect.
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
import { DOCK_STORAGE_KEY } from './extGuiDock';
import { INTERNAL_GUI_ORDER, ORTHO } from './orthoPanel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * NO FEATURES.
 *
 * `AppShell` renders every registry slot, and the registry is a lazy
 * `import.meta.glob` over twenty-odd directories other work packages own. The
 * first version of this file mounted them for real and died in
 * `features/movie/MoviePanel.tsx:53` reading a field off the stub transport's
 * `null` — a failure that says nothing about the shell and that any other
 * agent's next commit could re-introduce. The shell's contract is the FRAME:
 * where the regions are, what the gutter writes, what Ctrl+E does. Features
 * test themselves.
 */
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
let calls: Array<{ fn: string; args: readonly unknown[] }>;
let sessionFile: string;
let settings: Record<string, number>;

/** A session with real stores and a stub transport. */
function makeSession(): Session {
  const stores = {
    connection: createConnectionStore('ws://test/ws', true),
    feedback: createFeedbackStore(),
    objects: createObjectsStore(),
    // `null` storage: the UI store must not leak panelWidth between tests.
    ui: createUiStore(null),
  };
  return {
    config: {} as Session['config'],
    conn: { sendInput: vi.fn(), isOpen: true } as unknown as Session['conn'],
    stores,
    objectsSource: { poll: vi.fn(), invalidate: vi.fn() } as unknown as Session['objectsSource'],
    poller: { stats: () => ({ hz: 30 }) } as unknown as Session['poller'],
    run: vi.fn(),
    act: vi.fn(),
    call: (fn: string, args: readonly unknown[] = []) => {
      calls.push({ fn, args });
      if (fn === 'cmd.get' && args[0] === 'session_file') return Promise.resolve(sessionFile);
      if (fn === 'cmd.get_setting_int') return Promise.resolve(settings[String(args[0])] ?? 0);
      return Promise.resolve(null);
    },
    reconnect: vi.fn(),
    disconnect: vi.fn(),
    useToken: vi.fn(),
    probeHealth: vi.fn(),
  } as unknown as Session;
}

let session: Session;

async function mount(): Promise<void> {
  await act(async () => {
    root.render(
      <SessionContext.Provider value={session}>
        <AppShell />
      </SessionContext.Provider>,
    );
  });
}

/** Let the shell's `useEffect` polls resolve. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * Wait for a condition, driving React between checks.
 *
 * Real timers, not fake ones: the two polls are `setInterval` wrapping an
 * `async` body, and faking the clock without also flushing the promise chain
 * produces a test that passes for the wrong reason.
 */
async function waitFor(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
  }
  expect(check()).toBe(true);
}

function q<T extends Element = HTMLElement>(selector: string): T | null {
  return container.querySelector<T>(selector);
}

/**
 * A full click: down AND up.
 *
 * The up matters. A bare `pointerdown` arms a drag whose `pointermove`/
 * `pointerup` listeners live on `window` until the release, and leaving them
 * there leaked a stale handler from one test into the next — which showed up as
 * "two writes instead of one" three tests later. Real pointers always release.
 */
function pointerClick(el: Element): void {
  act(() => {
    el.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 500 }),
    );
    window.dispatchEvent(new MouseEvent('pointerup', {}));
  });
}

function press(init: KeyboardEventInit & { key: string }): boolean {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    window.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

beforeEach(async () => {
  calls = [];
  sessionFile = '';
  settings = { internal_gui: 0, internal_gui_width: 220 };
  window.localStorage.clear();
  document.title = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  session = makeSession();
  await mount();
  await settle();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/* ------------------------------------------------------------------ row 53 */

describe('main window shell (row 53)', () => {
  it('is a grid of menubar / main / dock / status, with the viewport in the middle', () => {
    // No QSplitter, QToolBar or QStatusBar exists in the Qt window
    // (asserted on the source in packages/bridge/tests/test_wf_shell.py); the shell is a
    // CSS grid with hand-rolled separators plus one deliberate ADDITION, the
    // status strip, which reports the transport a desktop PyMOL never had.
    expect(q('.shell')).not.toBeNull();
    expect(q('.menubar')).not.toBeNull();
    expect(q('.shell__main > .shell__viewport')).not.toBeNull();
    expect(q('.shell__main > .internal-gui')).not.toBeNull();
    expect(q('.extgui')).not.toBeNull();
    expect(q('.statusbar')).not.toBeNull();
  });

  it('tracks setting 440 into document.title', async () => {
    // Qt: setting_callbacks[440] -> setWindowTitle("PyMOL (" + basename + ")").
    // MEASURED: 440 IS session_file and cmd.save(*.pse) writes the absolute
    // path into it (packages/bridge/tests/test_wf_shell.py).
    expect(document.title).toBe('PyMOL');
    expect(calls.some((c) => c.fn === 'cmd.get' && c.args[0] === 'session_file')).toBe(true);

    sessionFile = '/tmp/wf/demo.pse';
    await waitFor(() => document.title === 'PyMOL (demo.pse)');
    expect(document.title).toBe('PyMOL (demo.pse)');
  }, 10_000);
});

/* ------------------------------------------------------------------ row 54 */

describe('External GUI dock (row 54)', () => {
  it('starts docked with NO title bar, like options.external_gui in Qt', () => {
    expect(q('[data-testid="extgui"]')?.getAttribute('data-dock')).toBe('bottom');
    expect(q('[data-testid="extgui-titlebar"]')).toBeNull();
  });

  it('Ctrl+E floats it and gives it a title bar, and Ctrl+E again re-docks it', () => {
    expect(press({ key: 'e', ctrlKey: true })).toBe(true); // preventDefault:
    // `features/keyboard` returns early on ev.defaultPrevented, so the same
    // keystroke is NOT also forwarded to PyMOL — Qt's window-level QShortcut
    // wins over the GL widget in exactly this way.
    expect(q('[data-testid="extgui"]')?.getAttribute('data-dock')).toBe('float');
    expect(q('[data-testid="extgui-titlebar"]')).not.toBeNull();

    press({ key: 'e', ctrlKey: true });
    expect(q('[data-testid="extgui"]')?.getAttribute('data-dock')).toBe('bottom');
    expect(q('[data-testid="extgui-titlebar"]')).toBeNull();
  });

  it('leaves other keystrokes alone', () => {
    expect(press({ key: 'e' })).toBe(false);
    expect(press({ key: 'e', ctrlKey: true, shiftKey: true })).toBe(false);
    expect(press({ key: 'o', ctrlKey: true })).toBe(false);
    expect(q('[data-testid="extgui"]')?.getAttribute('data-dock')).toBe('bottom');
  });

  it('hides and re-shows on the Visible toggle, and persists the choice', () => {
    const toggle = q<HTMLButtonElement>('[data-testid="extgui-visible"]');
    expect(toggle).not.toBeNull();
    act(() => toggle?.click());
    expect(q('[data-testid="extgui"]')).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(DOCK_STORAGE_KEY) ?? '{}')).toMatchObject({
      visible: false,
    });
    act(() => toggle?.click());
    expect(q('[data-testid="extgui"]')).not.toBeNull();
  });

  it('re-orients the quickbutton column when docked to a side', () => {
    press({ key: 'e', ctrlKey: true }); // float, so the title bar exists
    const side = [...container.querySelectorAll<HTMLButtonElement>('.extgui__btn')].find(
      (b) => b.title === 'dock right',
    );
    act(() => side?.click());
    const dock = q('[data-testid="extgui"]');
    expect(dock?.getAttribute('data-dock')).toBe('right');
    // `extgui--side` is what the stylesheet hangs `flex-direction:
    // column-reverse` off — Qt's `BottomToTop`, which puts the quickbutton
    // column above the console. The state machine itself is unit-tested in
    // `extGuiDock.test.ts`; here it only has to reach the DOM.
    expect(dock?.classList.contains('extgui--side')).toBe(true);
    // ...and it moved out of the grid row into the main flex row.
    expect(q('.shell__main > .extgui')).not.toBeNull();
    expect(q('.shell > .extgui')).toBeNull();
  });
});

/* ------------------------------------------------------------- rows 88, 103 */

describe('internal GUI column (row 88)', () => {
  it('stamps the OrthoLayoutPanel stack order onto whatever lands in the column', async () => {
    // The ButMode block is PORTALLED into `.internal-gui` by
    // `features/shortcuts` and therefore appended LAST — below the movie
    // Control bar, upside down relative to OrthoLayoutPanel. A MutationObserver
    // re-stamps `style.order` whenever a child arrives, which is what makes a
    // late portal land in the right place.
    const column = q('.internal-gui');
    expect(column).not.toBeNull();

    // Appended in the WRONG order, ButMode last, exactly as it happens today.
    for (const cls of ['objpanel', 'wizards', 'mvpanel', 'scpanel', 'butmode-host']) {
      const child = document.createElement('div');
      child.className = cls;
      column?.appendChild(child);
    }
    // Plus a block the shell has never heard of.
    const stranger = document.createElement('div');
    stranger.className = 'some-future-block';
    column?.appendChild(stranger);

    await settle();

    const ordered = [...(column?.children ?? [])]
      .map((el) => ({ cls: el.className, order: Number((el as HTMLElement).style.order || 0) }))
      .sort((a, b) => a.order - b.order)
      .map((x) => x.cls);
    expect(ordered).toEqual([
      'some-future-block', // unknown blocks sort ABOVE, never hidden at the bottom
      'objpanel', // Executive
      'wizards', // Wizard
      'butmode-host', // ButMode  <- appended last, rendered third
      'mvpanel', // Control
      'scpanel',
    ]);
    expect((column?.querySelector('.butmode-host') as HTMLElement).style.order).toBe(
      String(INTERNAL_GUI_ORDER['butmode-host']),
    );
  });

  it('never writes internal_gui to PyMOL from the client toggle', async () => {
    // MEASURED: with internal_gui 1 an 800x600 window reports a 580x600 scene,
    // so every forwarded mouse coordinate would be 220px out. The column is our
    // DOM; PyMOL's own copy must stay off.
    const toggle = [...container.querySelectorAll<HTMLButtonElement>('.menubar__item')].find((b) =>
      b.textContent?.includes('internal_gui'),
    );
    act(() => toggle?.click());
    await settle();
    expect(q('.internal-gui')).toBeNull();
    expect(calls.filter((c) => c.fn === 'cmd.set' && c.args[0] === 'internal_gui')).toEqual([]);
  });

  it('pushes internal_gui back to 0 when PyMOL reports it ON, exactly once', async () => {
    // Someone typed `set internal_gui, 1` at the prompt. Our column obeys; the
    // engine's duplicate does not get to exist. MEASURED
    // (packages/bridge/tests/test_f7_layout.py): the write is inert until the next
    // canvas resize and only THEN takes 220px off the scene, so there is no
    // event at the point of damage to diagnose it by — the correction has to
    // happen when the value is first seen.
    settings.internal_gui = 1;
    await waitFor(
      () => calls.some((c) => c.fn === 'cmd.set' && c.args[0] === 'internal_gui'),
    );
    expect(calls.filter((c) => c.fn === 'cmd.set' && c.args[0] === 'internal_gui')).toEqual([
      { fn: 'cmd.set', args: ['internal_gui', 0] },
    ]);
    expect(q('.internal-gui')).not.toBeNull();

    // ...and the 0 that comes back on the next poll is NOT read as the user
    // turning the column off again, nor does it re-trigger the write.
    settings.internal_gui = 0;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1400));
    });
    expect(q('.internal-gui')).not.toBeNull();
    expect(calls.filter((c) => c.fn === 'cmd.set' && c.args[0] === 'internal_gui')).toHaveLength(1);
  }, 10_000);

  it('reads internal_gui and internal_gui_width back from the engine', () => {
    const names = calls
      .filter((c) => c.fn === 'cmd.get_setting_int')
      .map((c) => String(c.args[0]));
    expect(names).toContain('internal_gui');
    expect(names).toContain('internal_gui_width');
  });

  it('pushes the width the browser remembers instead of adopting PyMOL’s', async () => {
    // localStorage says 300, PyMOL comes up at 220 every launch. Row 53's plan
    // makes the dock geometry client state, so the client wins on connect and
    // mirrors the value outward.
    act(() => root.unmount());
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    calls = [];
    session = makeSession();
    session.stores.ui.set({ panelWidth: 300 });
    await mount();
    await settle();
    expect(calls).toContainEqual({ fn: 'cmd.set', args: ['internal_gui_width', 300] });
    expect(q<HTMLElement>('.internal-gui')?.style.width).toBe('300px');
  });
});

describe('control gutter (row 103)', () => {
  it('collapses to 5 on a double click and restores on the next one', () => {
    const gutter = q('[data-testid="gutter"]');
    expect(gutter).not.toBeNull();
    expect(q<HTMLElement>('.internal-gui')?.style.width).toBe('220px');

    pointerClick(gutter as Element); // arms the drag; changes nothing
    expect(calls.filter((c) => c.fn === 'cmd.set')).toEqual([]);

    pointerClick(gutter as Element); // within 0.35 s -> collapse
    expect(q<HTMLElement>('.internal-gui')?.style.width).toBe(`${ORTHO.controlMinWidth}px`);
    expect(calls).toContainEqual({ fn: 'cmd.set', args: ['internal_gui_width', 5] });

    pointerClick(gutter as Element); // still within 0.35 s -> restore
    expect(q<HTMLElement>('.internal-gui')?.style.width).toBe('220px');
    expect(calls).toContainEqual({ fn: 'cmd.set', args: ['internal_gui_width', 220] });
  });

  it('writes the width back once, on release, not once per pointermove', () => {
    const gutter = q('[data-testid="gutter"]') as Element;
    // The shell measures from its OWN root, not from the test container.
    Object.defineProperty(q('.shell') as Element, 'getBoundingClientRect', {
      value: () => ({ right: 1000, bottom: 800 }),
    });
    act(() => {
      gutter.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 500 }),
      );
      for (const x of [800, 780, 760]) {
        window.dispatchEvent(new MouseEvent('pointermove', { clientX: x }));
      }
      window.dispatchEvent(new MouseEvent('pointerup', {}));
    });
    const writes = calls.filter((c) => c.fn === 'cmd.set' && c.args[0] === 'internal_gui_width');
    expect(writes).toEqual([{ fn: 'cmd.set', args: ['internal_gui_width', 240] }]);
    expect(q<HTMLElement>('.internal-gui')?.style.width).toBe('240px');
  });
});
