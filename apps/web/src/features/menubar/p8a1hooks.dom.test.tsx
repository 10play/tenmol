/**
 * The menu leaves that used to render DISABLED because nothing could bind them.
 *
 * Parity rows 66 (`Setting > Edit All… / Keyboard Shortcuts… / Colors…`), 67
 * (`Scene > Scenes…`) and 72 (the colours editor's entry point). Each of those
 * rows carried the same gap sentence: the panel exists, the menu item does not
 * reach it, because `runtime.hooks` was a literal only WP-14 could extend.
 *
 * The tests below click the real leaves of the real harvested tree, so a
 * regression in either half — the hook table or the tree — fails here.
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
import { dialogsStore } from '../dialogs/store';
import {
  isPanelOpen,
  panelMounted,
  registerMenuHook,
  resetPanelHooks,
} from '../../shell/panelHooks';
import { MenuBar } from './MenuBar';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let calls: Array<{ fn: string; args: readonly unknown[] }>;
let ran: string[];

function makeSession(): Session {
  const stores = {
    connection: createConnectionStore('ws://test/ws', true),
    feedback: createFeedbackStore(),
    objects: createObjectsStore(),
    ui: createUiStore(null),
  };
  return {
    config: {} as Session['config'],
    // `menuSource` bootstraps with a `do`; refusing it keeps the checked-in
    // generated tree, which is what these assertions are written against.
    conn: { sendInput: vi.fn(), isOpen: true, do: () => Promise.reject(new Error('offline')) },
    stores,
    objectsSource: { poll: vi.fn(), invalidate: vi.fn() },
    poller: { stats: () => ({ hz: 30 }) },
    run: (line: string) => {
      ran.push(line);
      return Promise.resolve();
    },
    act: vi.fn(),
    call: (fn: string, args: readonly unknown[] = []) => {
      calls.push({ fn, args });
      return Promise.reject(new Error('offline'));
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
      <SessionContext.Provider value={makeSession()}>
        <MenuBar />
      </SessionContext.Provider>,
    ),
  );
}

/** Open a top-level menu by its label. */
function openMenu(label: string): void {
  const button = [...container.querySelectorAll<HTMLButtonElement>('.menubar__item')].find(
    (el) => el.textContent?.trim() === label,
  );
  if (!button) throw new Error(`no menu ${label}`);
  act(() => button.click());
}

/**
 * Let a `React.lazy` land. The dialogs are lazy on purpose (`toolkitHooks.tsx`
 * — the colour table is 5388 entries and must not be fetched because the menu
 * bar mounted), and one macrotask is not enough: the dynamic import resolves,
 * then React re-renders, then the child's own effects run.
 */
async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Flush until `selector` exists, or fail loudly with what IS in the dialog. */
async function waitFor(selector: string, tries = 40): Promise<Element> {
  for (let i = 0; i < tries; i += 1) {
    const found = container.querySelector(selector);
    if (found) return found;
    await flush(1);
  }
  throw new Error(
    `${selector} never appeared; dialog body was ` +
      JSON.stringify(container.querySelector('.toolkit-dialog__body')?.innerHTML ?? null),
  );
}

function rows(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.menu__row')];
}

function leaf(label: string): HTMLButtonElement {
  const found = rows().find(
    (el) => el.querySelector('.menu__label')?.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no leaf ${JSON.stringify(label)}`);
  return found as HTMLButtonElement;
}

beforeEach(() => {
  calls = [];
  ran = [];
  resetPanelHooks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetPanelHooks();
  for (const window of dialogsStore.get().windows) dialogsStore.close(window.key);
});

describe('Setting > the three dialog entries (row 66)', () => {
  it('are enabled, not "not built yet"', () => {
    mount();
    openMenu('Setting');
    for (const label of ['Edit All...', 'Keyboard Shortcuts...', 'Colors...']) {
      const item = leaf(label);
      expect(item.disabled, label).toBe(false);
      expect(item.getAttribute('title'), label).not.toContain('not built yet');
    }
  });

  it('Colors... opens the colour editor, the same window forms/colors.ui is', async () => {
    mount();
    openMenu('Setting');
    act(() => leaf('Colors...').click());

    const dialog = container.querySelector('[data-dialog="colors"]');
    expect(dialog).toBeTruthy();
    expect(dialog?.getAttribute('aria-label')).toBe('Color Editor');

    // The body is `features/colors`' own `ColorEditor`, loaded lazily exactly
    // as Qt's handler does its `from .colors_gui import …` at click time.
    expect(await waitFor('[data-dialog="colors"] .cedit')).toBeTruthy();
  });

  it('Keyboard Shortcuts... opens the shortcut editor', async () => {
    mount();
    openMenu('Setting');
    act(() => leaf('Keyboard Shortcuts...').click());
    expect(container.querySelector('[data-dialog="shortcuts"]')).toBeTruthy();
    // `ShortcutEditor` brings its own modal chrome, so it is hosted bare — one
    // dialog, one scrim.
    const editor = await waitFor('[data-dialog="shortcuts"] [data-testid="shortcut-editor"]');
    expect(editor?.textContent).toContain('Keyboard Shortcut Menu');
    expect(container.querySelectorAll('[data-dialog="shortcuts"] .about__scrim')).toHaveLength(0);
  });

  it('Edit All... opens the advanced-settings window through the dialogs store', async () => {
    mount();
    openMenu('Setting');
    act(() => leaf('Edit All...').click());

    // Two steps: mount the slot, then open the window on the mount edge.
    await flush();
    expect(isPanelOpen('dialogs')).toBe(true);
    expect(dialogsStore.isOpen('advanced-settings')).toBe(false);

    // The shell has not mounted the slot in this test (no `AppShell` here), so
    // the intent is still queued — this is the edge `FeatureSlot` reports.
    act(() => panelMounted('dialogs'));
    expect(dialogsStore.isOpen('advanced-settings')).toBe(true);
  });

  it('closes on the × and on the scrim', () => {
    mount();
    openMenu('Setting');
    act(() => leaf('Colors...').click());
    expect(container.querySelector('[data-dialog="colors"]')).toBeTruthy();
    act(() => container.querySelector<HTMLButtonElement>('.toolkit-dialog__x')?.click());
    expect(container.querySelector('[data-dialog="colors"]')).toBeNull();

    openMenu('Setting');
    act(() => leaf('Colors...').click());
    act(() => {
      container
        .querySelector('.about__scrim')
        ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(container.querySelector('[data-dialog="colors"]')).toBeNull();
  });
});

describe('Scene > Scenes... (row 67)', () => {
  it('is enabled and opens the scene panel', () => {
    mount();
    openMenu('Scene');
    const item = leaf('Scenes...');
    expect(item.disabled).toBe(false);
    act(() => item.click());
    const dialog = container.querySelector('[data-dialog="scenes"]');
    expect(dialog).toBeTruthy();
    expect(dialog?.getAttribute('aria-label')).toBe('Scene Panel');
  });
});

describe('hooks registered by other features', () => {
  it('turn a disabled leaf live without editing MenuBar.tsx', () => {
    mount();
    openMenu('File');
    // Not registered: the leaf names its owner and refuses the click.
    expect(leaf('Open...').disabled).toBe(true);
    expect(leaf('Open...').getAttribute('title')).toContain('WP-18');

    const opened = vi.fn();
    act(() => {
      registerMenuHook('file_open', opened);
    });
    // Still open, and now live — a registration while the menu is showing must
    // re-render it (`useSyncExternalStore`), not wait for the next click.
    expect(leaf('Open...').disabled).toBe(false);
    act(() => leaf('Open...').click());
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('override the menu bar’s own stand-in, last registration wins', () => {
    const mine = vi.fn();
    registerMenuHook('edit_colors_dialog', mine);
    mount();
    openMenu('Setting');
    act(() => leaf('Colors...').click());
    expect(mine).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-dialog="colors"]')).toBeNull();
  });
});

describe('Plugin > Initialize Plugin System (row 76)', () => {
  it('opens the plugin manager and says what it is NOT', () => {
    mount();
    openMenu('Plugin');
    const item = leaf('Initialize Plugin System');
    expect(item.disabled).toBe(false);
    act(() => item.click());
    expect(isPanelOpen('plugin-manager')).toBe(true);
  });
});
