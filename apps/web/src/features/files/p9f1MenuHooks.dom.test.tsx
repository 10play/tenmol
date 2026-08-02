/**
 * Inventory row 242 — FIRING the File menu's leaves, not just rendering them.
 *
 * Wave 4 verified the File menu's STRUCTURE in a browser and wrote down the
 * gap in one sentence: "most leaf ACTIONS were not fired". They could not be:
 * every entry under `File` is a `hook` action naming a `_gui.py:13-38` seam,
 * and with nothing registered `runAction` writes " …is not built yet — WP-18
 * owns it" to the console instead of doing anything (`menubar/actions.ts`).
 *
 * `menuHooks.ts` is WP-18 registering them. This test clicks the REAL leaves
 * of the REAL harvested tree (`generated/menudata.ts`, not a fixture) with the
 * real `FilesPanel` mounted the way `AppShell.OverlayLayer` mounts it, and
 * asserts what each click produced — the dialog Qt's handler opens, by its
 * accessible name.
 *
 * Deliberately NOT a mock of `runAction`: the thing that was broken was the
 * seam between two features, so the test spans both.
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
import type { MenuNode } from '@tenmol/protocol/topics/menus';
import { SessionContext, type Session } from '../../app';
import {
  isPanelOpen,
  panelMounted,
  panelUnmounted,
  panelsStore,
  resetPanelHooks,
} from '../../shell/panelHooks';
import { MENU_DATA } from '../menubar/generated/menudata';
import { MenuBar } from '../menubar/MenuBar';
import { FileDropTarget } from './FileDropTarget';
import { FilesPanel } from './FilesPanel';
import { FILE_MENU_HOOKS, UNBOUND_FILE_HOOKS, requestFilesOpen } from './menuHooks';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ------------------------------------------------------------------ *
 * A bridge that answers the RPCs the dialogs open with
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
  // The real five, in `panels/files.py::GEOMETRY_EXPORTS` order.
  geometryExports: [
    { label: 'VRML 2', filter: 'VRML 2 WRL File (*.wrl)', format: 'wrl' },
    { label: 'COLLADA', filter: 'COLLADA File (*.dae)', format: 'dae' },
    { label: 'GLTF', filter: 'GLTF File (*.gltf)', format: 'gltf' },
    { label: 'POV-Ray', filter: 'POV File (*.pov)', format: 'pov' },
    { label: 'STL', filter: 'STL File (*.stl)', format: 'stl' },
  ],
  pngRenderingModes: ['draw', 'ray'],
  maeMultiplex: [],
  encoderSupport: {},
  encoders: { ffmpeg: '/usr/bin/ffmpeg' },
  unavailable: {},
  refused: {},
  loadFormats: ['pdb'],
  saveFormats: ['pdb'],
};

const LISTING = {
  path: '/work',
  parent: '/',
  cwd: '/work',
  home: '/home/u',
  entries: [],
  error: null,
  truncated: false,
};

/** `fn` (without the `cmd.tenmol_files.` prefix) -> canned reply. */
const REPLIES: Record<string, unknown> = {
  hello: HELLO,
  install_tk_dialogs: { installed: true, already: false },
  dialog_pending: [],
  browse: LISTING,
  places: [{ label: 'Home', path: '/home/u' }],
  initialdir: '/work',
  set_initialdir: { initialdir: '/work' },
  stat: { path: '/work', exists: true, isDir: true, isFile: false, size: 0, mtime: 0, writable: true },
  session_file: { path: '', hasPath: false, filters: HELLO.filters.session },
  save_molecule_info: {
    objects: ['mol'],
    selections: [],
    states: 1,
    filters: HELLO.filters.saveMolecule,
    settings: {},
  },
  names_of_type: ['obj1'],
  movie_dialog_info: {
    width: 640,
    height: 480,
    quality: 90,
    ray: false,
    encoders: HELLO.encoders,
    defaultEncoder: 'ffmpeg',
    support: {},
    filters: HELLO.filters.movie,
    frames: 10,
  },
  log_status: { logging: 0, path: '', open: false, filters: HELLO.filters.log },
  fetch_info: {
    fetchPath: '/work',
    fetchPathRaw: '.',
    fetchPathWritable: true,
    fetchHost: 'pdb',
    fetchTypeDefault: 'cif',
    assembly: '',
  },
  render_info: { width: 800, height: 600, dpi: 0, dpiChoices: [300], units: ['cm'], opaqueBackground: true },
  recent: [],
  recent_add: { added: true },
  note_open: {},
};

let calls: Array<{ fn: string; args: readonly unknown[] }>;
let ran: string[];
let acted: Array<{ fn: string; args: readonly unknown[] }>;

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
    act: (request: { fn: string; args?: readonly unknown[] }) => {
      acted.push({ fn: request.fn, args: request.args ?? [] });
      return Promise.resolve(undefined);
    },
    call: (fn: string, args: readonly unknown[] = []) => {
      calls.push({ fn, args });
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

/**
 * `AppShell.OverlayLayer` + `FeatureSlot`, minus the lazy import.
 *
 * The two facts that matter are reproduced exactly: the panel does NOT exist
 * until `openPanel('files')` puts it in the store, and the mount is reported
 * through `panelMounted` from a component rendered BEFORE the panel — which is
 * why `requestFilesAction` defers its event by a microtask.
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

function MountMarker() {
  useEffect(() => {
    panelMounted('files');
    return () => panelUnmounted('files');
  }, []);
  return null;
}

let container: HTMLDivElement;
let root: Root;

function mount(): void {
  act(() =>
    root.render(
      <SessionContext.Provider value={makeSession()}>
        <Host />
      </SessionContext.Provider>,
    ),
  );
}

/** One macrotask + microtask drain, repeated: dialogs open after 1-2 awaits. */
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

/** The popup list currently rooted at the File button. */
function fileList(): HTMLElement {
  const list = container.querySelector<HTMLElement>('.menubar__item-wrap .menu');
  if (!list) throw new Error('the File menu is not open');
  return list;
}

/**
 * A row of ONE list, not of the whole document.
 *
 * `File ▸ Open…` and `File ▸ Log File ▸ Open…` have the same label, and a
 * document-wide search silently picked the first — which is how this test
 * nearly asserted that the Log leaf opened the structure-file picker.
 */
function row(scope: HTMLElement, label: string): HTMLElement {
  const found = [...scope.querySelectorAll<HTMLElement>(':scope > .menu__row')].find(
    (el) => el.querySelector(':scope > .menu__label')?.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no row ${JSON.stringify(label)} in this list`);
  return found;
}

/**
 * Open a submenu and return its list.
 *
 * `mouseover`, not `mouseenter`: React synthesises `onMouseEnter` from the
 * delegated `mouseover`/`mouseout` pair at the root, so a directly dispatched
 * `mouseenter` reaches no handler at all.
 */
function hover(scope: HTMLElement, label: string): HTMLElement {
  const parent = row(scope, label);
  act(() => parent.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  const sub = parent.querySelector<HTMLElement>(':scope > .menu');
  if (!sub) throw new Error(`submenu ${JSON.stringify(label)} did not open`);
  return sub;
}

/** Walk to a leaf: every step but the last is a submenu. */
function walkTo(path: readonly string[]): { scope: HTMLElement; label: string } {
  let scope = fileList();
  for (const step of path.slice(0, -1)) scope = hover(scope, step);
  return { scope, label: path[path.length - 1] as string };
}

/** Click a File leaf, optionally inside one submenu. */
async function fire(path: readonly string[]): Promise<void> {
  openMenu('File');
  const { scope, label } = walkTo(path);
  act(() => (row(scope, label) as HTMLButtonElement).click());
  await flush();
}

/** The accessible name of whatever modal is on screen (picker or dialog). */
function dialogLabels(): string[] {
  return [...container.querySelectorAll('[role="dialog"]')].map(
    (el) => el.getAttribute('aria-label') ?? '',
  );
}

function feedback(): string {
  return [...container.querySelectorAll('.menubar__note')].map((n) => n.textContent).join('');
}

beforeEach(() => {
  calls = [];
  ran = [];
  acted = [];
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

/* ------------------------------------------------------------------ *
 * 1. Every hook leaf under File is accounted for
 * ------------------------------------------------------------------ */

/** Every `hook` name reachable from the harvested `File` menu, in tree order. */
function fileMenuHookNames(): string[] {
  const file = MENU_DATA.menus.find((m) => m.kind === 'submenu' && m.label === 'File');
  if (!file || file.kind !== 'submenu') throw new Error('no File menu in the harvested tree');
  const out: string[] = [];
  const walk = (nodes: readonly MenuNode[]): void => {
    for (const node of nodes) {
      if (node.kind === 'submenu') walk(node.items);
      else if (node.kind === 'command' && node.action.type === 'hook') out.push(node.action.hook);
    }
  };
  walk(file.items);
  return out;
}

describe('row 242 — the File menu leaf inventory', () => {
  it('has a binding, or a stated reason, for every hook leaf', () => {
    const names = fileMenuHookNames();
    // A real tree, not a fixture: 24 hook leaves today.
    expect(names.length).toBeGreaterThan(20);
    const unexplained = names.filter(
      (hook) =>
        !(hook in FILE_MENU_HOOKS) &&
        !UNBOUND_FILE_HOOKS.includes(hook) &&
        // The menu bar implements this one itself (`MenuBar.tsx`).
        hook !== 'confirm_quit',
    );
    expect(unexplained).toEqual([]);
  });

  it('binds nothing that the File menu does not actually contain', () => {
    const names = new Set(fileMenuHookNames());
    expect(Object.keys(FILE_MENU_HOOKS).filter((hook) => !names.has(hook))).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * 2. The leaves are live
 * ------------------------------------------------------------------ */

describe('row 242 — the leaves are enabled', () => {
  it('no File leaf still says "not built yet — WP-18"', async () => {
    mount();
    await flush(2);
    openMenu('File');
    for (const label of ['Open...', 'Get PDB...', 'Save Session', 'Save Session As...',
                         'Export Molecule...', 'Export Map...', 'Export Alignment...',
                         'Run Script...']) {
      const item = row(fileList(), label);
      expect(item.className, label).not.toContain('is-disabled');
      expect(item.getAttribute('title') ?? '', label).not.toContain('WP-18');
    }
  });

  it('New PyMOL Window is still honestly impossible', async () => {
    mount();
    await flush(2);
    openMenu('File');
    expect(row(hover(fileList(), 'New PyMOL Window'), 'Default').className).toContain(
      'is-disabled',
    );
  });
});

/* ------------------------------------------------------------------ *
 * 3. Firing them — one assertion per leaf, on what the click produced
 * ------------------------------------------------------------------ */

describe('row 242 — firing the leaves', () => {
  /**
   * `path` -> the accessible name of the dialog the click must put on screen.
   * These are Qt's own window titles (`pymol_qt_gui.py` / `file_dialogs.py`),
   * which is what makes them assertions rather than restatements of our code.
   */
  const CASES: Array<{ path: string[]; dialog: string }> = [
    { path: ['Open...'], dialog: 'Open file' },
    { path: ['Get PDB...'], dialog: 'Get PDB' },
    { path: ['Save Session'], dialog: 'Save Session As...' },
    { path: ['Save Session As...'], dialog: 'Save Session As...' },
    { path: ['Export Molecule...'], dialog: 'Export Molecule' },
    { path: ['Export Map...'], dialog: 'Save object:map' },
    { path: ['Export Alignment...'], dialog: 'Save object:alignment' },
    { path: ['Export Image As', 'PNG...'], dialog: 'Save PNG image' },
    { path: ['Export Image As', 'VRML 2...'], dialog: 'Save As...' },
    { path: ['Export Image As', 'COLLADA...'], dialog: 'Save As...' },
    { path: ['Export Image As', 'GLTF...'], dialog: 'Save As...' },
    { path: ['Export Image As', 'POV-Ray...'], dialog: 'Save As...' },
    { path: ['Export Image As', 'STL...'], dialog: 'Save As...' },
    { path: ['Export Movie As', 'MPEG...'], dialog: 'Export Movie' },
    { path: ['Export Movie As', 'Quicktime...'], dialog: 'Export Movie' },
    { path: ['Export Movie As', 'PNG Images...'], dialog: 'Export Movie' },
    { path: ['Log File', 'Open...'], dialog: 'Open Logfile...' },
    { path: ['Log File', 'Resume...'], dialog: 'Open Logfile...' },
    { path: ['Log File', 'Append...'], dialog: 'Open Logfile...' },
    { path: ['Run Script...'], dialog: 'Open file' },
    { path: ['Working Directory', 'Change...'], dialog: 'Change Working Directory' },
  ];

  for (const { path, dialog } of CASES) {
    it(`File > ${path.join(' > ')} opens ${JSON.stringify(dialog)}`, async () => {
      mount();
      await flush(2);
      expect(isPanelOpen('files')).toBe(false);

      await fire(path);

      // The hook mounted the overlay slot…
      expect(isPanelOpen('files')).toBe(true);
      // …and the panel acted on the intent.
      expect(dialogLabels()).toContain(dialog);
      expect(feedback()).not.toContain('not built yet');
    });
  }

  it('Save Session with a session file skips the picker and saves it', async () => {
    REPLIES.session_file = { path: '/work/s.pse', hasPath: true, filters: [] };
    try {
      mount();
      await flush(2);
      await fire(['Save Session']);
      // `session_save` -> `cmd.save(cmd.get('session_file'), format='pse')`
      // with no dialog at all (`pymol_qt_gui.py:666-667`).
      expect(dialogLabels()).toEqual([]);
      expect(ran).toContain('save /work/s.pse, format=pse');
    } finally {
      REPLIES.session_file = { path: '', hasPath: false, filters: HELLO.filters.session };
    }
  });

  it('the three Log leaves ask for the same file with three different verbs', async () => {
    const accept = async (path: string[]): Promise<string> => {
      mount();
      await flush(2);
      await fire(path);
      const button = container.querySelector<HTMLButtonElement>('[data-testid="fpick-accept"]');
      const label = button?.textContent ?? '';
      act(() => root.unmount());
      container.remove();
      resetPanelHooks();
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      return label;
    };
    expect(await accept(['Log File', 'Open...'])).toBe('Open');
    expect(await accept(['Log File', 'Append...'])).toBe('Open');
    // Only `resume` differs, and it is the one that re-runs the file.
    expect(await accept(['Log File', 'Resume...'])).toBe('Resume');
  });

  it('Log File > Close needs no hook at all — it is a plain call', async () => {
    mount();
    await flush(2);
    await fire(['Log File', 'Close']);
    expect(calls.map((c) => c.fn)).toContain('cmd.log_close');
    expect(isPanelOpen('files')).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 4. The leaves that were already live, fired for the first time
 * ------------------------------------------------------------------ */

describe('row 242 — the non-hook leaves', () => {
  it('Reinitialize runs one call and three command lines', async () => {
    mount();
    await flush(2);

    await fire(['Reinitialize', 'Everything']);
    expect(calls.map((c) => c.fn)).toContain('cmd.reinitialize');

    for (const [label, line] of [
      ['Original Settings', 'reinitialize original_settings'],
      ['Stored Settings', 'reinitialize settings'],
      ['Store Current Settings', 'reinitialize store_defaults'],
    ] as const) {
      await fire(['Reinitialize', label]);
      expect(ran, label).toContain(line);
    }
    // …and none of them woke the dialog panel up.
    expect(isPanelOpen('files')).toBe(false);
  });

  it('Working Directory > File Browser is `cmd.system("open .")`', async () => {
    mount();
    await flush(2);
    await fire(['Working Directory', 'File Browser']);
    expect(calls.find((c) => c.fn === 'cmd.system')?.args).toEqual(['open .']);
  });
});

/* ------------------------------------------------------------------ *
 * 5. Row 246 — the seam Open Recent needs
 * ------------------------------------------------------------------ */

describe('row 246 — load_dialog for a path somebody else chose', () => {
  const CLASSIFY = {
    filename: '/work/1rx1.pdb',
    prefix: '1rx1',
    ext: 'pdb',
    format: 'pdb',
    zipped: '',
    isUrl: false,
    objectName: '1rx1',
    dialog: 'plain',
    mapType: null,
    alnFormat: null,
    cmsTraj: null,
    unavailable: null,
    refused: null,
    partial: 0,
  };

  afterEach(() => {
    delete REPLIES.plan_open;
    delete REPLIES.ask_partial_needed;
  });

  it('a plain structure goes through plan_open + note_open, not a bare `load`', async () => {
    REPLIES.plan_open = { steps: [CLASSIFY], count: 1 };
    mount();
    await flush(2);

    act(() => requestFilesOpen(['/work/1rx1.pdb']));
    await flush();

    expect(isPanelOpen('files')).toBe(true);
    const fns = calls.map((c) => c.fn);
    expect(fns).toContain('cmd.tenmol_files.plan_open');
    expect(fns).toContain('cmd.tenmol_files.note_open');
    // `cmd.load(f, quiet=0)` through `session.act`, which is what invalidates
    // the object list — and NOT `run('load …')`, the bare line the menu bar's
    // own Open Recent still emits.
    expect(acted).toEqual([{ fn: 'cmd.load', args: ['/work/1rx1.pdb'] }]);
    expect(ran).not.toContain('load /work/1rx1.pdb');
  });

  it('a .pse stops at the partial question — the difference load_dialog makes', async () => {
    REPLIES.plan_open = {
      steps: [{ ...CLASSIFY, filename: '/work/s.pse', ext: 'pse', format: 'pse', dialog: 'session' }],
      count: 1,
    };
    REPLIES.ask_partial_needed = {
      needed: true,
      names: ['1rx1'],
      autoRenameDuplicates: false,
    };
    mount();
    await flush(2);

    act(() => requestFilesOpen(['/work/s.pse']));
    await flush();

    expect(dialogLabels()).toContain('Load Session');
    expect(acted).toEqual([]);
  });
});
