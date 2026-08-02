/**
 * Row 61 — the File tree as a CENSUS, not a spot check.
 *
 * Row 61 enumerates "25+ leaf items" and wave 9 closed the gap it named (the
 * ~20 QFileDialog seams that rendered disabled naming WP-18). What it asserted
 * was a NEGATIVE — "no leaf whose tooltip still says not built yet" — which is
 * mute the moment a leaf disappears from the tree: a submenu that fails to open
 * passes that test with flying colours.
 *
 * So this file pins the whole thing. It walks File with the real hooks
 * installed and asserts the EXACT leaf list of the real harvested tree
 * (`generated/menudata.ts`, harvested from `PyMOLDesktopGUI.get_menudata`) and
 * the EXACT set of leaves that are still refused, each with the sentence it
 * refuses with. MEASURED: 32 leaves, 4 refusals, and the refusals are
 * `New PyMOL Window ▸ Default`, `New PyMOL Window ▸ Ignore .pymolrc and plugins
 * (-k)` (both row 294, impossible by construction), the empty `Open Recent…`
 * placeholder (this session refuses `tenmol_menus`, so the DB is unreachable —
 * it is a placeholder, not a leaf), and `Edit pymolrc`, which is the ONE File
 * leaf still saying "not built yet".
 *
 * That last one is the whole of row 61's remainder and it is quantified here so
 * nobody has to re-derive it: `features/texteditor/TextEditorPanel.tsx:44`
 * takes a `DialogWindowSpec` and never reads `spec.arg`, so binding the hook
 * would open an EMPTY editor titled `~/.pymolrc`. The bridge half it needs is
 * already built and already called from that feature
 * (`panels/files.py::pymolrc` at :2132, `read_text` at :2242, `write_text`).
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
import { FILE_MENU_HOOKS } from '../files/menuHooks';
import { MENU_DATA } from './generated/menudata';
import { MenuBar } from './MenuBar';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Every leaf of `File`, in tree order, submenu paths joined with ` > `.
 *
 * This is upstream's list (`modules/pymol/_gui.py:80-140`) as harvested, plus
 * the `Open Recent…` placeholder row that stands in for the recent-files DB.
 */
const FILE_LEAVES = [
  'New PyMOL Window > Default',
  'New PyMOL Window > Ignore .pymolrc and plugins (-k)',
  'Open...',
  'Open Recent... > no recent files',
  'Get PDB...',
  'Save Session',
  'Save Session As...',
  'Export Molecule...',
  'Export Map...',
  'Export Alignment...',
  'Export Image As > PNG...',
  'Export Image As > VRML 2...',
  'Export Image As > COLLADA...',
  'Export Image As > GLTF...',
  'Export Image As > POV-Ray...',
  'Export Image As > STL...',
  'Export Movie As > MPEG...',
  'Export Movie As > Quicktime...',
  'Export Movie As > PNG Images...',
  'Log File > Open...',
  'Log File > Resume...',
  'Log File > Append...',
  'Log File > Close',
  'Run Script...',
  'Working Directory > Change...',
  'Working Directory > File Browser',
  'Edit pymolrc',
  'Reinitialize > Everything',
  'Reinitialize > Original Settings',
  'Reinitialize > Stored Settings',
  'Reinitialize > Store Current Settings',
  'Quit',
];

/** The four leaves that are still refused, with the reason each gives. */
const REFUSALS: Record<string, string> = {
  'New PyMOL Window > Default':
    'hook new_window — one PyMOL process per bridge — a second window would need a second engine',
  'New PyMOL Window > Ignore .pymolrc and plugins (-k)':
    'hook new_window — one PyMOL process per bridge — a second window would need a second engine',
  // Not a leaf: `DynamicList`'s empty row. The DB is server-side and this
  // session refuses `tenmol_menus`.
  'Open Recent... > no recent files': '',
  'Edit pymolrc': 'hook edit_pymolrc — not built yet — WP-22 owns it (text editor dialog)',
};

function makeSession(): Session {
  return {
    config: {} as Session['config'],
    conn: { sendInput: vi.fn(), isOpen: true, do: () => Promise.reject(new Error('offline')) },
    stores: {
      connection: createConnectionStore('ws://test/ws', true),
      feedback: createFeedbackStore(),
      objects: createObjectsStore(),
      ui: createUiStore(null),
    },
    objectsSource: { poll: vi.fn(), invalidate: vi.fn() },
    poller: { stats: () => ({ hz: 30 }) },
    run: () => Promise.resolve(),
    act: () => Promise.resolve(undefined),
    // Everything refused: the assertions are about the CHECKED-IN tree, so no
    // reply may reshape it.
    call: (fn: string) => Promise.reject(new Error(`offline: ${fn}`)),
    reconnect: vi.fn(),
    disconnect: vi.fn(),
    useToken: vi.fn(),
    probeHealth: vi.fn(),
  } as unknown as Session;
}

function MountMarker() {
  useEffect(() => {
    panelMounted('files');
    return () => panelUnmounted('files');
  }, []);
  return null;
}

function Host() {
  const open = useSyncExternalStore(
    (listener) => panelsStore().subscribe(listener),
    () => panelsStore().get().open,
  );
  return (
    <>
      <MenuBar />
      {/* installs FILE_MENU_HOOKS for the life of the app */}
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

beforeEach(() => {
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

/** Mount, open File, and walk it. Returns leaf path -> disabled reason (or null). */
async function census(): Promise<Map<string, string | null>> {
  act(() =>
    root.render(
      <SessionContext.Provider value={makeSession()}>
        <Host />
      </SessionContext.Provider>,
    ),
  );
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  const button = [...container.querySelectorAll<HTMLButtonElement>('.menubar__item')].find(
    (el) => el.textContent?.trim() === 'File',
  );
  if (!button) throw new Error('no File menu');
  act(() => button.click());

  const out = new Map<string, string | null>();
  const walk = (scope: ParentNode, prefix: readonly string[]): void => {
    for (const el of scope.querySelectorAll<HTMLElement>(':scope > .menu__row')) {
      const label = el.querySelector(':scope > .menu__label')?.textContent?.trim() ?? '';
      const path = [...prefix, label];
      if (el.getAttribute('aria-haspopup') === 'menu') {
        act(() => el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
        const sub = el.querySelector<HTMLElement>(':scope > .menu');
        if (!sub) throw new Error(`submenu ${label} did not open`);
        walk(sub, path);
        continue;
      }
      const key = path.join(' > ');
      const off = (el as HTMLButtonElement).disabled || el.className.includes('is-disabled');
      out.set(key, off ? (el.getAttribute('title') ?? '') : null);
    }
  };
  const list = container.querySelector<HTMLElement>('.menubar__item-wrap .menu');
  if (!list) throw new Error('the File menu did not open');
  walk(list, []);
  return out;
}

describe('row 61 — every leaf of the File tree', () => {
  it('renders exactly the 32 leaves of the harvested tree, in order', async () => {
    const seen = await census();
    expect([...seen.keys()]).toEqual(FILE_LEAVES);
  });

  it('refuses exactly four of them, each with its own sentence', async () => {
    const seen = await census();
    const refused = Object.fromEntries([...seen].filter(([, why]) => why !== null));
    expect(refused).toEqual(REFUSALS);
  });

  it('Edit pymolrc is the ONLY leaf still saying "not built yet"', async () => {
    const seen = await census();
    const notBuilt = [...seen]
      .filter(([, why]) => (why ?? '').includes('not built yet'))
      .map(([label]) => label);
    expect(notBuilt).toEqual(['Edit pymolrc']);
    // …and it is unbound on purpose: `FILE_MENU_HOOKS` never claims it.
    expect(Object.keys(FILE_MENU_HOOKS)).not.toContain('edit_pymolrc');
  });

  it('the 21 bound hooks are all real leaves of that tree', async () => {
    // `FILE_MENU_HOOKS` is a table; this proves it against the harvested tree
    // rather than against itself.
    const hooks: string[] = [];
    const walk = (nodes: readonly unknown[]): void => {
      for (const node of nodes as Array<Record<string, unknown>>) {
        if (node.kind === 'submenu') {
          walk(node.items as unknown[]);
          continue;
        }
        const action = node.action as { type?: string; hook?: string } | undefined;
        if (node.kind === 'command' && action?.type === 'hook' && action.hook) {
          hooks.push(action.hook);
        }
      }
    };
    const file = (MENU_DATA.menus as unknown as Array<Record<string, unknown>>).find(
      (menu) => menu.label === 'File',
    );
    walk((file?.items ?? []) as unknown[]);
    // MEASURED, and wave 9's annotation says 19: there are 21 (the five
    // geometry exporters plus PNG are six, not five).
    expect(Object.keys(FILE_MENU_HOOKS)).toHaveLength(21);
    for (const hook of Object.keys(FILE_MENU_HOOKS)) expect(hooks).toContain(hook);
    // The three that are NOT bound, and nothing else.
    expect(hooks.filter((h) => !(h in FILE_MENU_HOOKS)).sort()).toEqual([
      'confirm_quit',
      'edit_pymolrc',
      'new_window',
      'new_window',
    ]);
  });
});
