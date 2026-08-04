/**
 * The Draw/Ray open seam — rows 00:58 and 00:73, which were the SAME line.
 *
 * `RenderDialog` shipped both pages and the reducer four waves ago, but kept
 * `expanded` in local `useState`, took no props, published no event and
 * registered no hook. So Qt's one-click Draw/Ray quick button (a `WidgetMenu`
 * wrapping `render_dialog`, `pymol_qt_gui.py:222,232`) had nothing to call:
 * `features/console/QuickButtons.tsx` looked for a registered `render_dialog`
 * hook, drew a labelled TODO when there was none, and printed the exact missing
 * line. Wave 8 found it, wave 9 re-confirmed it, and neither could fix it
 * because the two ends are different agents' directories.
 *
 * What is asserted here is the whole chain, not just the registration: mount
 * order in both directions, the button going live WITHOUT a remount (the
 * reactive-snapshot half — a plain `menuHooks()` read leaves it TODO for ever),
 * one click opening the form, idempotence, and the hook disappearing again if
 * the component ever unmounts.
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
import { hasMenuHook, menuHooks, resetPanelHooks } from '../../shell/panelHooks';
import { QuickButtons, live } from '../console/QuickButtons';
import { RenderDialog, RENDER_HOOK, OPEN_EVENT } from './RenderDialog';

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
      // `image_dots_per_inch`, which the form seeds its dpi from.
      return Promise.resolve(fn === 'cmd.get_setting_int' ? 300 : null);
    },
    reconnect: vi.fn(),
    disconnect: vi.fn(),
    useToken: vi.fn(),
    probeHealth: vi.fn(),
  } as unknown as Session;
}

/** The shell mounts `viewport`-region slots unconditionally, so both exist. */
function mount(withRender: boolean): void {
  act(() =>
    root.render(
      <SessionContext.Provider value={session}>
        <QuickButtons />
        {withRender ? <RenderDialog /> : null}
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

async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function formOpen(): boolean {
  return container.querySelector('.render__body') !== null;
}

function feedback(): string {
  return session.stores.feedback
    .get()
    .lines.map((line) => line.text)
    .join('\n');
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
});

describe('the render_dialog seam (rows 58 and 73)', () => {
  it('registers the hook Qt fills with a bound method', async () => {
    expect(hasMenuHook(RENDER_HOOK)).toBe(false);
    mount(true);
    await flush();
    expect(hasMenuHook(RENDER_HOOK)).toBe(true);
    expect(typeof menuHooks()[RENDER_HOOK]).toBe('function');
  });

  it('turns Draw/Ray live WITHOUT remounting the quick buttons', async () => {
    // The registration happens in `RenderDialog`'s effect, i.e. AFTER
    // `QuickButtons` has already painted. This is the half a plain
    // `menuHooks()` read gets wrong: the button would stay TODO until some
    // unrelated state change forced a re-render.
    mount(false);
    expect(button('Draw/Ray').className).toContain('quickbutton--todo');

    mount(true);
    await flush();
    const draw = button('Draw/Ray');
    expect(draw.className).not.toContain('todo');
    expect(draw.getAttribute('title')).not.toContain('TODO');
    expect(live({ label: 'Draw/Ray', cmd: null, action: 'render', title: '' })).toBe(true);
  });

  it('opens the two-page form in ONE click, as the WidgetMenu does', async () => {
    mount(true);
    await flush();
    expect(formOpen()).toBe(false); // collapsed to its `Ray / Draw` tab

    act(() => button('Draw/Ray').click());
    await flush();
    expect(formOpen()).toBe(true);
    expect(container.querySelector('.render__title')?.textContent).toContain('Ray / Draw');
    // Page 1 of `forms/render.ui`: width/height/dpi and the two actions.
    expect(container.querySelector('#rd-w')).toBeTruthy();
    expect(container.querySelector('#rd-h')).toBeTruthy();
    expect(container.querySelector('#rd-dpi')).toBeTruthy();
    // Nothing was printed about a missing seam.
    expect(feedback()).not.toContain('registerMenuHook');
  });

  it('is idempotent: a second click re-shows the same form, it does not stack', async () => {
    mount(true);
    await flush();
    act(() => button('Draw/Ray').click());
    await flush();
    act(() => button('Draw/Ray').click());
    await flush();
    expect(container.querySelectorAll('.render__body')).toHaveLength(1);
    expect(formOpen()).toBe(true);
  });

  it('also answers the `tenmol:open-render` event, like features/builder', async () => {
    mount(true);
    await flush();
    act(() => {
      window.dispatchEvent(new Event(OPEN_EVENT));
    });
    await flush();
    expect(formOpen()).toBe(true);
  });

  it('unregisters on unmount, so the button goes back to saying what is missing', async () => {
    mount(true);
    await flush();
    expect(hasMenuHook(RENDER_HOOK)).toBe(true);

    mount(false);
    await flush();
    expect(hasMenuHook(RENDER_HOOK)).toBe(false);
    expect(button('Draw/Ray').className).toContain('quickbutton--todo');

    act(() => button('Draw/Ray').click());
    await flush(1);
    expect(feedback()).toContain('features/render');
  });
});
