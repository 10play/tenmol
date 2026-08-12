/**
 * A per-story session + decorators that drive the {@link FilesPanel} the way a
 * live bridge would, so its File menu and the load/save DIALOGS behind it open
 * POPULATED instead of as empty chrome.
 *
 * WHY THE PANEL IS HOLLOW ON THE STUB. Every dialog in this area is gated on
 * `api.ensure()`, which bootstraps the bridge module by calling
 * `cmd.tenmol_files.hello`. The global `withSession` decorator answers every
 * `call()` with `null`, so `ensure()` resolves to a falsy hello and each menu
 * item returns early (`if (!(await ensure())) return;`) — no dialog ever opens,
 * and the geometry-export leaves that come from `hello.geometryExports` never
 * appear either. The strip renders, but the surfaces the panel exists to host
 * do not.
 *
 * WHAT THIS SUPPLIES. A bridge whose `hello` returns a realistic filter/format
 * snapshot (so the menu is fully built) and whose per-dialog reads
 * (`fetch_info`, `save_molecule_info`, `recent`, `log_status`, …) return the
 * shapes an engine with a couple of structures loaded would return. Paired with
 * {@link openFilesDialog} / {@link openFilesMenu}, a story shows the panel doing
 * its real job — hosting a populated dialog — rather than just the idle button.
 *
 * The `cmd.tenmol_files.*` payloads are inlined literals: the stories dir cannot
 * resolve `@tenmol/protocol`, so nothing here imports its types or constants.
 *
 * Not a `*.stories.tsx` file, so Storybook does not index it as a story.
 */

import { useEffect } from 'react';
import type { Decorator } from '@storybook/react-vite';
import { SessionContext, type Session } from '@web/app';

import { mockSession } from '../../.storybook/decorators';

/** Dotted prefix every file-service call carries (`FILES_NS`). */
const NS = 'cmd.tenmol_files';
/** The window event `FilesPanel` listens on (`menuHooks.ts` `FILES_ACTION_EVENT`). */
const FILES_ACTION_EVENT = 'tenmol:files-action';

const HOME = '/home/ada';
const CWD = '/home/ada/structures';

/** `hello()` — the snapshot that builds the whole File menu, geometry leaves and all. */
const HELLO = {
  installed: true,
  cwd: CWD,
  home: HOME,
  sep: '/',
  initialdir: CWD,
  filters: {
    load: [
      'All Loadable (*.pdb *.cif *.sdf *.mol2 *.mae *.ccp4 *.mtz *.pse)',
      'PDB (*.pdb *.pdb.gz *.ent)',
      'mmCIF (*.cif *.cif.gz)',
      'MOL2 (*.mol2)',
      'All Files (*)',
    ],
    saveMolecule: [
      'PDB (*.pdb)',
      'mmCIF (*.cif)',
      'MOL2 (*.mol2)',
      'SDF (*.sdf)',
      'By Extension (*.*)',
    ],
    session: ['PyMOL Session (*.pse *.pse.gz)', 'PyMOL Show (*.psw)'],
    log: ['PyMOL Command Script (*.pml)', 'Python Script (*.py *.pym)', 'All Files (*)'],
    run: ['Python/PyMOL Script (*.py *.pym *.pml)', 'All Files (*)'],
    movie: { mp4: 'MPEG-4 (*.mp4)', mov: 'QuickTime (*.mov)', png: 'PNG frames (*.png)' },
    map: ['CCP4 (*.ccp4 *.map)'],
    alignment: ['clustalw (*.aln)'],
    png: ['PNG File (*.png)'],
  },
  geometryExports: [
    { label: 'VRML 2', filter: 'VRML 2 (*.wrl)', format: 'wrl' },
    { label: 'COLLADA', filter: 'COLLADA (*.dae)', format: 'dae' },
    { label: 'glTF', filter: 'glTF (*.gltf)', format: 'gltf' },
    { label: 'POV-Ray', filter: 'POV-Ray (*.pov)', format: 'pov' },
    { label: 'STL', filter: 'STL (*.stl)', format: 'stl' },
  ],
  pngRenderingModes: [
    'capture current display',
    'draw antialiased OpenGL image',
    'ray trace with opaque background',
    'ray trace with transparent background',
  ],
  maeMultiplex: [],
  encoderSupport: {},
  encoders: { ffmpeg: '/usr/bin/ffmpeg' },
  unavailable: {
    '.mae': 'Maestro import is Schrödinger-only and compiled out of this build',
    '.mtz': 'the reflection loader is Incentive-only',
  },
  refused: { pwg: 'a .pwg can open ports and import arbitrary modules — refused' },
  loadFormats: ['pdb', 'cif', 'sdf', 'mol2', 'ccp4', 'mtz', 'pse'],
  saveFormats: ['pdb', 'cif', 'mol2', 'sdf', 'png', 'pse', 'wrl', 'dae'],
};

/** `fetch_info()` — Get PDB dialog defaults. */
const FETCH_INFO = {
  fetchPath: '/home/ada/.pymol/fetch',
  fetchPathRaw: '$FETCH_PATH',
  fetchPathWritable: true,
  fetchHost: 'https://files.rcsb.org',
  fetchTypeDefault: 'cif',
  assembly: '',
};

/** `save_molecule_info()` — Export Molecule dialog inputs. */
const SAVE_MOLECULE_INFO = {
  objects: ['1ubq', '4hhb', 'ligand'],
  selections: ['polymer', 'organic'],
  states: 12,
  filters: ['PDB (*.pdb)', 'mmCIF (*.cif)', 'MOL2 (*.mol2)', 'SDF (*.sdf)', 'By Extension (*.*)'],
  settings: {
    no_pdb_conect_nodup: true,
    pdb_conect_all: false,
    no_ignore_pdb_segi: true,
    pdb_retain_ids: false,
    retain_order: false,
  },
};

/** `log_status()` — an open `.pml` log, so the Log dialog shows its live state. */
const LOG_STATUS = {
  logging: 1,
  path: '/home/ada/structures/session.pml',
  open: true,
  filters: ['PyMOL Command Script (*.pml)', 'Python Script (*.py *.pym)', 'All Files (*)'],
};

/** `session_file()` — a session with a known path, so Save Session skips the picker. */
const SESSION_FILE = {
  path: '/home/ada/structures/complex_v3.pse',
  hasPath: true,
  filters: ['PyMOL Session (*.pse *.pse.gz)', 'PyMOL Show (*.psw)'],
};

/** `recent()` — the `~/.pymol/recent.db` list, newest first, one row already missing. */
const RECENT = [
  { path: '/home/ada/structures/1ubq.pdb', display: '~/structures/1ubq.pdb', exists: true },
  { path: '/home/ada/structures/4hhb.cif', display: '~/structures/4hhb.cif', exists: true },
  { path: '/home/ada/work/complex_v3.pse', display: '~/work/complex_v3.pse', exists: true },
  { path: '/home/ada/downloads/2fofc.ccp4', display: '~/downloads/2fofc.ccp4', exists: true },
  { path: '/home/ada/work/apo_vs_holo.aln', display: '~/work/apo_vs_holo.aln', exists: true },
  { path: '/home/ada/old/trajectory_run7.dcd', display: '~/old/trajectory_run7.dcd', exists: false },
];

/** Answer one `cmd.tenmol_files.*` call the way a connected engine would. */
function filesCall(fn: string, args?: unknown[]): unknown {
  const method = fn.startsWith(`${NS}.`) ? fn.slice(NS.length + 1) : fn;
  switch (method) {
    case 'hello':
      return HELLO;
    case 'fetch_info':
    case 'set_fetch_path':
      return FETCH_INFO;
    case 'save_molecule_info':
      return SAVE_MOLECULE_INFO;
    case 'log_status':
      return LOG_STATUS;
    case 'session_file':
      return SESSION_FILE;
    case 'recent':
      return RECENT;
    case 'names_of_type':
      return ['emap.ccp4'];
    case 'initialdir':
      return CWD;
    case 'set_initialdir':
      return { initialdir: String((args ?? [])[0] ?? CWD) };
    case 'chdir':
      return { cwd: CWD, initialdir: CWD };
    case 'pdbe_result':
      return { code: '', started: true, pending: false, assemblies: [], chains: [], error: null };
    case 'recent_add':
    case 'recent_remove':
    case 'note_open':
    case 'pdbe_start':
      return null;
    default:
      return null;
  }
}

/** Wrap a story in a session that answers the Files panel's bridge calls. */
export const withFilesData: Decorator = (Story) => {
  const base = mockSession();
  const session: Session = {
    ...base,
    call: ((fn: string, args?: unknown[]) =>
      Promise.resolve(filesCall(fn, args))) as Session['call'],
  } as Session;
  return (
    <SessionContext.Provider value={session}>
      <Story />
    </SessionContext.Provider>
  );
};

/**
 * Open one of the panel's dialogs on mount by firing the same window event the
 * menu bar uses (`FILES_ACTION_EVENT`) — so the story shows the panel hosting a
 * real, populated dialog instead of the idle strip. `action` is a `FilesPanel`
 * menu id (`fetch`, `export-molecule`, `recent`, `log`, …).
 */
export function openFilesDialog(action: string): Decorator {
  const Dialog: Decorator = (Story) => {
    useEffect(() => {
      const id = window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent(FILES_ACTION_EVENT, { detail: { action } }));
      }, 0);
      return () => window.clearTimeout(id);
    }, []);
    return <Story />;
  };
  return Dialog;
}

/** Open the File dropdown on mount, so the launcher shows its full item list. */
export const openFilesMenu: Decorator = (Story) => {
  useEffect(() => {
    const id = window.setTimeout(() => {
      const button = document.querySelector<HTMLButtonElement>(
        '[data-testid="files-menu-button"]',
      );
      button?.click();
    }, 0);
    return () => window.clearTimeout(id);
  }, []);
  return <Story />;
};
