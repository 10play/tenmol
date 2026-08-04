/**
 * Row 246, END TO END: the File menu's own Open Recent submenu runs
 * `load_dialog(fname)`, and the proof is the DIALOG, not the event.
 *
 * WHAT WAS MISSING. Wave 9 wrote the gap as one line: "MenuBar.tsx line 419
 * (renderDynamic's onPick) still hard-codes session.run('load ' + file), so the
 * File menu's own Open Recent submenu bypasses the pipeline for
 * .pse/.mtz/.dcd/.aln". That line now calls `requestFilesOpen`, but the two
 * halves were still asserted in two different files against two different
 * harnesses: `p9a1recent.dom.test.tsx` stops at the CustomEvent (no files
 * panel mounted at all) and `p9f1MenuHooks.dom.test.tsx` starts at
 * `requestFilesOpen(paths)` (no menu bar click). Between them sat the seam
 * that has broken twice before — the overlay slot is not mounted when the
 * intent is queued, so the event has to survive `openPanel` -> `MountMarker`
 * -> `FilesPanel`'s own listener.
 *
 * So this file clicks the REAL row of the REAL harvested submenu with the REAL
 * `FilesPanel` mounted the way `AppShell.OverlayLayer` mounts it, and asserts
 * what Qt's `load_dialog` would have put on screen: a `.pse` stops at the
 * partial question, a `.mtz` opens the reflection dialog, and a `.pdb` reaches
 * `cmd.load` through `session.act` (which invalidates the object list) rather
 * than as a bare `load <file>` command line.
 *
 * MUTATION-TESTED: restoring `session.run('load ' + file)` in
 * `MenuBar.renderDynamic` turns all four behavioural tests red (the two dialog
 * ones on "expected [] to contain 'Load Session'/'Load Reflections (MTZ)'",
 * the plain one on the `act` assertion, the truncation one on `plan_open`).
 */

import { act, useEffect, useSyncExternalStore } from 'react';
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
  panelMounted,
  panelUnmounted,
  panelsStore,
  resetPanelHooks,
} from '../../shell/panelHooks';
import { FileDropTarget } from '../files/FileDropTarget';
import { FilesPanel } from '../files/FilesPanel';
import { MenuBar } from './MenuBar';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ------------------------------------------------------------------ *
 * `~/.pymol/recent.db`, newest first
 * ------------------------------------------------------------------ */

/** 149 characters: past the `< 128` cut, so the LABEL is not the path. */
const LONG = '/very/long/' + 'x'.repeat(129) + '/deep.pdb';
const RECENT = ['/work/1rx1.pdb', '/work/s.pse', '/work/4rwb.mtz', LONG];

/** What `tenmol_menus('recent')` answers RIGHT NOW — the DB can change. */
let recentDb: string[];

/* ------------------------------------------------------------------ *
 * A bridge that answers the RPCs this route opens with
 * ------------------------------------------------------------------ */

const HELLO = {
  installed: true as const,
  cwd: '/work',
  home: '/home/u',
  sep: '/',
  initialdir: '/work',
  filters: {
    load: ['All Files (*)'],
    saveMolecule: ['PDB File (*.pdb)'],
    session: ['PyMOL Session File (*.pse *.pze *.pse.gz)'],
    log: ['PyMOL Script (*.pml)'],
    run: ['All Runnable (*.pml *.py *.pym)'],
    movie: { mpg: 'MPEG (*.mpg)', mov: 'Quicktime (*.mov)', png: 'PNG (*.png)' },
    map: ['CCP4 (*.ccp4 *.map)'],
    alignment: ['clustalw (*.aln)'],
    png: ['PNG File (*.png)'],
  },
  geometryExports: [],
  pngRenderingModes: ['draw', 'ray'],
  maeMultiplex: [],
  encoderSupport: {},
  encoders: {},
  unavailable: {},
  refused: {},
  loadFormats: ['pdb'],
  saveFormats: ['pdb'],
};

/** A `classify` row, defaulted to the plain-structure case. */
function step(filename: string, over: Record<string, unknown> = {}) {
  return {
    filename,
    prefix: 'x',
    ext: 'pdb',
    format: 'pdb',
    zipped: '',
    isUrl: false,
    objectName: 'x',
    dialog: 'plain',
    mapType: null,
    alnFormat: null,
    cmsTraj: null,
    unavailable: null,
    refused: null,
    partial: 0,
    ...over,
  };
}

let REPLIES: Record<string, unknown>;

function baseReplies(): Record<string, unknown> {
  return {
    hello: HELLO,
    install_tk_dialogs: { installed: true, already: false },
    dialog_pending: [],
    note_open: {},
    initialdir: '/work',
  };
}

let calls: Array<{ fn: string; args: readonly unknown[] }>;
let ran: string[];
let acted: Array<{ fn: string; args: readonly unknown[]; invalidatesNames?: boolean | undefined }>;

function makeSession(): Session {
  return {
    config: {} as Session['config'],
    // The menu TREE stays the checked-in generated copy: refusing the
    // bootstrap `do` is what `p9f1MenuHooks` does for the same reason.
    conn: {
      sendInput: vi.fn(),
      isOpen: true,
      do: () => Promise.reject(new Error('offline')),
      // `PluginDialogHost` (row 295) subscribes to the `dialog` topic on mount.
      on: () => () => {},
      sub: () => Promise.resolve(),
    },
    stores: {
      connection: createConnectionStore('ws://test/ws', true),
      feedback: createFeedbackStore(),
      objects: createObjectsStore(),
      ui: createUiStore(null),
    },
    objectsSource: { poll: vi.fn(), invalidate: vi.fn() },
    poller: { stats: () => ({ hz: 30 }) },
    run: (line: string) => {
      ran.push(line);
      return Promise.resolve();
    },
    act: (request: { fn: string; args?: readonly unknown[]; invalidatesNames?: boolean }) => {
      acted.push({
        fn: request.fn,
        args: request.args ?? [],
        invalidatesNames: request.invalidatesNames,
      });
      return Promise.resolve(undefined);
    },
    call: (fn: string, args: readonly unknown[] = []) => {
      calls.push({ fn, args });
      // `menuSource.recent()` — `cmd.tenmol_menus('recent')`.
      if (fn === 'tenmol_menus' && args[0] === 'recent') return Promise.resolve([...recentDb]);
      const method = fn.startsWith('cmd.tenmol_files.') ? fn.slice('cmd.tenmol_files.'.length) : fn;
      if (method in REPLIES) return Promise.resolve(REPLIES[method]);
      return Promise.reject(new Error(`offline: ${fn}`));
    },
    reconnect: vi.fn(),
    disconnect: vi.fn(),
    useToken: vi.fn(),
    probeHealth: vi.fn(),
  } as unknown as Session;
}

/* ------------------------------------------------------------------ *
 * The shell, reduced to the part this seam depends on
 * ------------------------------------------------------------------ */

function MountMarker() {
  useEffect(() => {
    panelMounted('files');
    return () => panelUnmounted('files');
  }, []);
  return null;
}

/**
 * `AppShell.OverlayLayer` + `FeatureSlot`, minus the lazy import: the files
 * panel does NOT exist until `openPanel('files')` puts it in the store, and the
 * mount is reported from a component rendered BEFORE it.
 */
function Host() {
  const open = useSyncExternalStore(
    (listener) => panelsStore().subscribe(listener),
    () => panelsStore().get().open,
  );
  return (
    <>
      <MenuBar />
      <FileDropTarget />
      {open.includes('files') && (
        <>
          <MountMarker />
          <FilesPanel />
        </>
      )}
    </>
  );
}

let container: HTMLDivElement;
let root: Root;

async function flush(times = 6): Promise<void> {
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

function row(scope: ParentNode, label: string): HTMLElement {
  const found = [...scope.querySelectorAll<HTMLElement>('.menu__row')].find(
    (el) => el.querySelector('.menu__label')?.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no row ${JSON.stringify(label)}`);
  return found;
}

/** Hover File ▸ Open Recent… open and return its rows, newest first. */
async function openRecent(): Promise<HTMLElement[]> {
  act(() =>
    root.render(
      <SessionContext.Provider value={makeSession()}>
        <Host />
      </SessionContext.Provider>,
    ),
  );
  await flush(2);
  openMenu('File');
  act(() => row(container, 'Open Recent...').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  await flush(2);
  return [...container.querySelectorAll<HTMLElement>('.menu--sub .menu__row')];
}

/** Click entry `index` of Open Recent and let the whole pipeline settle. */
async function pickRecent(index: number): Promise<void> {
  const rows = await openRecent();
  act(() => (rows[index] as HTMLButtonElement).click());
  await flush();
}

/** Hover the already-open File menu's Open Recent submenu. */
async function hoverRecent(): Promise<HTMLElement[]> {
  act(() =>
    row(container, 'Open Recent...').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })),
  );
  await flush(2);
  return [...container.querySelectorAll<HTMLElement>('.menu--sub .menu__row')];
}

/** The accessible name of every modal on screen. */
function dialogLabels(): string[] {
  return [...container.querySelectorAll('[role="dialog"]')].map(
    (el) => el.getAttribute('aria-label') ?? '',
  );
}

function fns(): string[] {
  return calls.map((c) => c.fn);
}

beforeEach(() => {
  calls = [];
  ran = [];
  acted = [];
  REPLIES = baseReplies();
  recentDb = [...RECENT];
  resetPanelHooks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetPanelHooks();
});

describe('row 246 — Open Recent runs load_dialog, proved at the dialog', () => {
  it('a .pse stops at the session question instead of loading blind', async () => {
    REPLIES.plan_open = {
      steps: [step('/work/s.pse', { ext: 'pse', format: 'pse', dialog: 'session' })],
      count: 1,
    };
    REPLIES.ask_partial_needed = { needed: true, names: ['1rx1'], autoRenameDuplicates: false };

    await pickRecent(1);

    // The question upstream's `load_dialog` asks, on screen.
    expect(dialogLabels()).toContain('Load Session');
    // …and NOTHING was loaded while it is up: no `cmd.load`, no command line.
    expect(acted).toEqual([]);
    expect(ran).toEqual([]);
    // The route really was the pipeline, in its order.
    const seen = fns();
    expect(seen).toContain('cmd.tenmol_files.plan_open');
    expect(seen).toContain('cmd.tenmol_files.note_open');
    expect(seen).toContain('cmd.tenmol_files.ask_partial_needed');
    expect(calls.find((c) => c.fn === 'cmd.tenmol_files.plan_open')?.args).toEqual([
      ['/work/s.pse'],
    ]);
  });

  it('a .mtz opens the reflection dialog', async () => {
    REPLIES.plan_open = {
      steps: [step('/work/4rwb.mtz', { ext: 'mtz', format: 'mtz', dialog: 'mtz' })],
      count: 1,
    };
    REPLIES.mtz_dialog_info = {
      supported: true,
      unavailable: null,
      datasets: [{ name: 'cryst_1/data_1', amplitudes: ['FC'], phases: ['PHIC'], weights: [] }],
      amplitudes: ['FC'],
      phases: ['PHIC'],
      weights: [],
      guess: { amplitudes: 'FC', phases: 'PHIC', weights: 'None' },
      error: null,
    };

    await pickRecent(2);

    expect(dialogLabels()).toContain('Load Reflections (MTZ)');
    expect(acted).toEqual([]);
    expect(ran).toEqual([]);
  });

  it('a plain structure reaches cmd.load through act, not a `load <file>` line', async () => {
    REPLIES.plan_open = { steps: [step('/work/1rx1.pdb', { prefix: '1rx1' })], count: 1 };

    await pickRecent(0);

    expect(acted).toEqual([
      { fn: 'cmd.load', args: ['/work/1rx1.pdb'], invalidatesNames: true },
    ]);
    // The bare command line is exactly what this row asked us to stop doing;
    // `session.run` would not invalidate the object list either.
    expect(ran).toEqual([]);
    expect(dialogLabels()).toEqual([]);
  });

  it('is rebuilt on every open, the way Qt rebuilds it on aboutToShow', async () => {
    // `menu.aboutToShow.connect(...)` clears the submenu and re-reads
    // `recent_filenames` EVERY time (`pymol_qt_gui.py:341-347`), because the DB
    // is server-side and another client — or `recent_filenames_add` after a
    // save — can have changed it since the last look.
    const rows = await openRecent();
    expect(rows[0]?.querySelector('.menu__label')?.textContent).toBe('/work/1rx1.pdb');
    const reads = () => calls.filter((c) => c.fn === 'tenmol_menus' && c.args[0] === 'recent').length;
    expect(reads()).toBe(1);

    // Close the menu (a second click on the File button), change the DB, and
    // open it again.
    openMenu('File');
    await flush(1);
    expect(container.querySelector('.menu')).toBeNull();
    recentDb = ['/work/later.pdb', ...RECENT];
    openMenu('File');
    const again = await hoverRecent();

    expect(reads()).toBe(2);
    expect(again[0]?.querySelector('.menu__label')?.textContent).toBe('/work/later.pdb');
    expect(again).toHaveLength(5);
  });

  it('the truncated label is a LABEL: the full path is what goes to the bridge', async () => {
    REPLIES.plan_open = { steps: [step(LONG, { prefix: 'deep' })], count: 1 };

    const rows = await openRecent();
    // `fname if len(fname) < 128 else '...' + fname[-120:]` (`:346`).
    expect(LONG.length).toBe(149);
    expect(rows[3]?.querySelector('.menu__label')?.textContent).toBe('...' + LONG.slice(-120));
    act(() => (rows[3] as HTMLButtonElement).click());
    await flush();

    expect(calls.find((c) => c.fn === 'cmd.tenmol_files.plan_open')?.args).toEqual([[LONG]]);
    expect(acted).toEqual([{ fn: 'cmd.load', args: [LONG], invalidatesNames: true }]);
  });
});
