/**
 * Open Recent runs `load_dialog`, not a bare `load` — parity row 71.
 *
 * Row 71's gap: "picking an entry runs `load <file>` rather than WP-18's
 * `load_dialog`, so .mtz, .pse and multi-object formats still bypass their
 * importers". `features/files` now publishes that pipeline as
 * `requestFilesOpen(paths)` — the module's own doc comment names this call site
 * — and the far end of it (plan_open, the partial question, `cmd.load` through
 * `session.act`) is asserted in `features/files/p9f1MenuHooks.dom.test.tsx`.
 * What is asserted HERE is the half that lives in the menu bar: the submenu is
 * still Qt's (rebuilt per `aboutToShow`, truncated at 128 characters), and the
 * click reaches the pipeline instead of the command line.
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
import { isPanelOpen, panelMounted, resetPanelHooks } from '../../shell/panelHooks';
import { resetSettingsTap } from '../../shell/settingsTap';
import {
  FILES_ACTION_EVENT,
  FILES_OPEN_PATHS,
  type FilesActionDetail,
} from '../files/menuHooks';
import { MenuBar } from './MenuBar';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** `~/.pymol/recent.db`, newest first — one row long enough to be truncated. */
const LONG = '/very/long/' + 'x'.repeat(140) + '/session.pse';
const RECENT = ['/work/1rx1.pdb', '/work/s.pse', LONG];

let container: HTMLDivElement;
let root: Root;
let session: Session;
let ran: string[];
let actions: FilesActionDetail[];

function makeSession(): Session {
  return {
    config: {} as Session['config'],
    conn: {
      sendInput: vi.fn(),
      isOpen: true,
      do: () => Promise.reject(new Error('offline')),
    } as unknown as Session['conn'],
    stores: {
      connection: createConnectionStore('ws://test/ws', true),
      feedback: createFeedbackStore(),
      objects: createObjectsStore(),
      ui: createUiStore(null),
    },
    objectsSource: { poll: vi.fn(), invalidate: vi.fn() } as unknown as Session['objectsSource'],
    poller: { stats: () => ({ hz: 30 }) } as unknown as Session['poller'],
    run: (line: string) => {
      ran.push(line);
      return Promise.resolve();
    },
    act: vi.fn(),
    call: (fn: string, args: readonly unknown[] = []) => {
      if (fn === 'tenmol_menus' && args[0] === 'recent') return Promise.resolve(RECENT);
      // Everything else — the live tree, the settings tap — stays refused, so
      // the assertions run against the checked-in generated tree.
      return Promise.reject(new Error(`offline: ${fn}`));
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
        <MenuBar />
      </SessionContext.Provider>,
    ),
  );
}

async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function openMenu(label: string): void {
  const button = [...container.querySelectorAll<HTMLButtonElement>('.menubar__item')].find(
    (el) => el.textContent?.trim() === label,
  );
  if (!button) throw new Error(`no menu ${label}`);
  act(() => button.click());
}

function row(label: string): HTMLElement {
  const found = [...container.querySelectorAll<HTMLElement>('.menu__row')].find(
    (el) => el.querySelector('.menu__label')?.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no row ${JSON.stringify(label)}`);
  return found;
}

/** Hover the submenu open, the way `MenuList` opens one. */
async function openRecent(): Promise<HTMLElement[]> {
  mount();
  await flush(1);
  openMenu('File');
  act(() => row('Open Recent...').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  await flush(2);
  return [...container.querySelectorAll<HTMLElement>('.menu--sub .menu__row')];
}

const listener = (event: Event): void => {
  actions.push((event as CustomEvent<FilesActionDetail>).detail);
};

beforeEach(() => {
  ran = [];
  actions = [];
  resetPanelHooks();
  session = makeSession();
  window.addEventListener(FILES_ACTION_EVENT, listener);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  window.removeEventListener(FILES_ACTION_EVENT, listener);
  act(() => root.unmount());
  container.remove();
  resetSettingsTap(session);
  resetPanelHooks();
});

describe('Open Recent (row 71)', () => {
  it('lists the DB newest-first with the >= 128 truncation rule', async () => {
    const rows = await openRecent();
    const labels = rows.map((el) => el.querySelector('.menu__label')?.textContent);
    expect(labels[0]).toBe('/work/1rx1.pdb');
    expect(labels[1]).toBe('/work/s.pse');
    // `fname if len(fname) < 128 else '...' + fname[-120:]` (`:346`).
    expect(labels[2]).toBe('...' + LONG.slice(-120));
    expect(rows[2]?.getAttribute('title')).toBe(LONG);
  });

  it('picking an entry runs load_dialog, not `load <file>`', async () => {
    const rows = await openRecent();
    act(() => (rows[1] as HTMLButtonElement).click());
    await flush(2);

    // Step 1: the files slot is mounted…
    expect(isPanelOpen('files')).toBe(true);
    // …step 2: the intent drains on the MOUNT edge, which no test harness
    // without `AppShell` reaches on its own.
    expect(actions).toEqual([]);
    act(() => panelMounted('files'));
    await flush(2);

    expect(actions).toEqual([{ action: FILES_OPEN_PATHS, paths: ['/work/s.pse'] }]);
    // The bare command line is what this row asked us to stop doing: a `.pse`
    // sent that way skips the partial question entirely.
    expect(ran).toEqual([]);
  });

  it('closes the menu on the pick, as Qt does', async () => {
    const rows = await openRecent();
    act(() => (rows[0] as HTMLButtonElement).click());
    expect(container.querySelector('.menu')).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Row 61 — the ~20 QFileDialog seams, from the MENU's side
 * ------------------------------------------------------------------ */

/**
 * Row 61's gap was "one line per seam inside `features/files` (~20 of them)".
 * Those lines exist now (`features/files/menuHooks.ts`, installed from
 * `FileDropTarget`'s effect, which is mounted for the life of the app). What is
 * asserted here is the half a menu bar can assert: with them installed, NO File
 * leaf still renders "not built yet", and the two that do not are the two whose
 * absence is a recorded decision. Whether each dialog then behaves is row 242,
 * asserted leaf by leaf in `features/files/p9f1MenuHooks.dom.test.tsx`.
 */
describe('File menu leaves (row 61)', () => {
  it('none of them says "not built yet" once features/files installs its hooks', async () => {
    const { installFileMenuHooks, UNBOUND_FILE_HOOKS } = await import('../files/menuHooks');
    const off = installFileMenuHooks();
    try {
      mount();
      await flush(1);
      openMenu('File');
      // Walk every leaf of the File tree, submenus included.
      const seen: string[] = [];
      const walk = (): void => {
        for (const el of container.querySelectorAll<HTMLElement>('.menu__row')) {
          const label = el.querySelector('.menu__label')?.textContent?.trim() ?? '';
          if (el.getAttribute('aria-haspopup') === 'menu') {
            if (!seen.includes(label)) {
              seen.push(label);
              act(() => el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
              walk();
            }
            continue;
          }
          const title = el.getAttribute('title') ?? '';
          const disabled = (el as HTMLButtonElement).disabled;
          if (!disabled) continue;
          // The only refusals left are the recorded ones.
          expect(
            title.includes('one PyMOL process per bridge') ||
              UNBOUND_FILE_HOOKS.some((hook) => title.includes(hook)) ||
              /pymolrc/i.test(label),
            `${label} — ${title}`,
          ).toBe(true);
          expect(title, label).not.toContain('WP-18');
        }
      };
      walk();
      // The walk really did descend: Export Image As, Log File, …
      expect(seen.length).toBeGreaterThanOrEqual(5);
    } finally {
      off();
    }
  });

  it('and every one of them is dead again when nothing is installed', async () => {
    mount();
    await flush(1);
    openMenu('File');
    const open = row('Open...') as HTMLButtonElement;
    expect(open.disabled).toBe(true);
    expect(open.getAttribute('title')).toContain('WP-18');
  });
});
