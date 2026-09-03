/**
 * Drag & drop onto the window, decided as pure functions.
 *
 * `packages/engine/modules/pmg_qt/pymol_gl_widget.py:256-270` accepts URL mime data on the GL
 * widget: local URLs go through `toLocalFile()`, remote ones are passed as
 * strings, and each is handed to `gui.load_dialog(url)`.
 *
 * WHY THIS IS NOT JUST THE FILES PANEL'S EXISTING HANDLER. That handler lives
 * inside `FilesPanel`, which is an OVERLAY slot — `AppShell.OverlayLayer`
 * renders overlay panels only while the user has toggled them open. So
 * dropping a structure on the window did nothing at all unless the File
 * dialogs panel happened to be open first, and nothing said so. The listeners
 * belong somewhere always mounted.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. `load_dialog` routes six formats to
 * MODAL dialogs (trajectory, map, mtz, alignment, mae, session) whose queue and
 * state live in `FilesPanel`. Reproducing that here would mean a second copy of
 * the modal machinery. Instead a drop that needs a dialog is reported, by name,
 * with the panel to open — which is worse than Qt and much better than the
 * silent nothing it replaces. Plain structures, the overwhelming case, load
 * directly.
 */

import type { FileClassification, LoadDialogKind } from '@tenmol/protocol/topics/files';

/** What a drop resolved to, before anything is sent to PyMOL. */
export type DropPlan =
  | { kind: 'none' }
  /** A remote URL: `cmd.load` handles it via `file_read`, no filesystem. */
  | { kind: 'url'; url: string }
  /** Local files the browser handed us; they need uploading first. */
  | { kind: 'files'; files: readonly File[] };

/**
 * Read a `DataTransfer` the way the Qt widget reads its mime data.
 *
 * URI-list wins over files, because a drag from a browser address bar carries
 * both and the URL is the more faithful thing to load. A `file://` URI is NOT
 * treated as a URL: the browser will not let us read the path behind it, and
 * `cmd.load('file:///...')` on the server would resolve it against the SERVER's
 * filesystem — which is a different machine's idea of that path.
 */
export function planFromDataTransfer(data: DataTransfer | null): DropPlan {
  if (!data) return { kind: 'none' };

  const uri = (data.getData('text/uri-list') || '').trim().split(/\r?\n/)[0]?.trim() ?? '';
  if (uri && uri.includes('://') && !uri.startsWith('file://')) {
    return { kind: 'url', url: uri };
  }

  const files = Array.from(data.files ?? []);
  return files.length > 0 ? { kind: 'files', files } : { kind: 'none' };
}

/** Dialog kinds `load_dialog` routes to a modal rather than a plain load. */
const NEEDS_DIALOG: Record<string, string> = {
  traj: 'trajectory',
  map: 'map',
  mtz: 'MTZ',
  aln: 'alignment',
  mae: 'Maestro',
  session: 'session',
};

/**
 * Can this file just be loaded, or does it need one of the modals?
 *
 * Returns null when a plain `cmd.load` is right, or the human name of the
 * dialog it needs. `script` is deliberately absent from the modal list: a
 * `.pml`/`.py` drop is a `cd`-then-run, which needs no user input.
 */
export function dialogNeededFor(info: Pick<FileClassification, 'dialog'>): string | null {
  return NEEDS_DIALOG[info.dialog] ?? null;
}

/**
 * Must this file be turned away before anything is sent to `cmd.load`?
 *
 * TWO independent reasons, and the drop path used to check NEITHER:
 *
 *  * `refused` — the client declines on purpose. Today that is `.pwg`, and it
 *    is not a theoretical worry: `cmd.load` on a file whose whole content is
 *    the word `delete` DELETES THAT FILE, measured over the socket in
 *    `packages/bridge/tests/test_wf_files.py`. The same parser opens ports, imports
 *    arbitrary modules and starts a second HTTP server
 *    (`packages/engine/modules/pymol/importing.py:516-615`). A drag-and-drop is exactly how a
 *    hostile `.pwg` would arrive.
 *  * `unavailable` — the loader raises in this build (`.stl`, `.vis`, `.mae`…).
 *    `FilesPanel` already refuses these; the drop handler did not, so a dropped
 *    `.stl` produced a raw `IncentiveOnlyException` in the console.
 *
 * Returns the message to show, or null to proceed.
 */
export function refusalFor(
  info: Pick<FileClassification, 'refused' | 'unavailable'>,
  name: string,
): string | null {
  if (info.refused) return ` ${name} was not loaded. ${info.refused}`;
  if (info.unavailable) return ` ${name}: ${info.unavailable}`;
  return null;
}

/**
 * The client-side refusal set, keyed by extension — the browser-only twin of
 * the bridge's `panels/files.py::REFUSED_FORMATS`.
 *
 * The browser Open… / drop paths load file CONTENTS through the engine and
 * never call `cmd.tenmol_files.classify`, so nothing populates a
 * `FileClassification.refused` for them. They recognise the one refused format
 * from the file's own name instead. Today that is `.pwg`; the message mirrors
 * `panels/files.py::PWG_REFUSAL` verbatim so the console line is identical on
 * both paths.
 */
const CLIENT_REFUSED_FORMATS: Record<string, string> = {
  pwg:
    "'.pwg' is refused by the web client. A .pwg file is a script that can open " +
    'a listening port, add HTTP headers, publish a document root, import and ' +
    'run an arbitrary Python module, launch a web browser, report the port to a ' +
    'remote URL, delete itself, and start a second HTTP server inside this ' +
    'process (packages/engine/modules/pymol/importing.py:516-615). Run it from a desktop PyMOL ' +
    'if you trust it.',
};

/**
 * Extension → the load-dialog branch `classify_filename` would route it to
 * (`panels/files.py::classify_filename`, mirroring `file_dialogs.py:33-77`).
 *
 * The browser Open… / drop paths never call `cmd.tenmol_files.classify`, so
 * they cannot ask the bridge which modal a file needs. This is the client-side
 * twin of that dispatch, keyed by extension: every entry here is a format whose
 * loader wants OPTIONS (traj/map/mtz/aln/mae) or a session decision
 * (pse/psw) — none of which the content-only `file.text()` + `cmd.load` path
 * can supply, and most of which are BINARY (mtz/ccp4/dsn6/dcd/mae) that
 * UTF-8-decoding would silently corrupt. Anything not listed classifies as
 * `plain` (a single-molecule text format the engine can sniff) or `script`.
 */
const EXT_TO_DIALOG: Record<string, LoadDialogKind> = {
  // trajectory (`file_dialogs.py:46` tests the last four characters)
  dcd: 'traj',
  dtr: 'traj',
  xtc: 'traj',
  trr: 'traj',
  // alignment
  aln: 'aln',
  fasta: 'aln',
  fa: 'aln',
  // Maestro (also `unavailable` — the loader raises in this build)
  mae: 'mae',
  // volumetric maps (`ccp4`/`map`, and `brix`/`dsn6`/`o` via the 'o' branch)
  ccp4: 'map',
  map: 'map',
  mrc: 'map',
  dx: 'map',
  brix: 'map',
  omap: 'map',
  dsn6: 'map',
  o: 'map',
  // reflection data
  mtz: 'mtz',
  // sessions
  pse: 'session',
  psw: 'session',
  // scripts — no modal, but not a molecule to text-decode either
  pml: 'script',
  py: 'script',
  pym: 'script',
};

/**
 * The `dialog` branch a browser File would take, derived from its name with no
 * `classify` RPC — the client-side twin of `cmd.tenmol_files.classify` so
 * {@link dialogNeededFor} can gate a browser open exactly as it gates a
 * classified server open. Unknown/plain-text formats return `dialog: 'plain'`.
 */
export function classify(name: string): Pick<FileClassification, 'dialog'> {
  const base = name.replace(/^.*[/\\]/, '').replace(/\.(gz|bz2)$/i, '');
  const ext = (/\.([a-z0-9]+)$/i.exec(base)?.[1] ?? '').toLowerCase();
  return { dialog: EXT_TO_DIALOG[ext] ?? 'plain' };
}

/**
 * The `refused`/`unavailable` fields for a browser File, derived from its name
 * with no `classify` RPC, so {@link refusalFor} can gate a browser open exactly
 * as it gates a classified server open.
 */
export function browserClassification(
  name: string,
): Pick<FileClassification, 'refused' | 'unavailable'> {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
  return { refused: CLIENT_REFUSED_FORMATS[ext] ?? null, unavailable: null };
}

/**
 * Object name for a browser-opened File: basename minus one extension (and a
 * `.gz`/`.bz2` wrapper), with the characters PyMOL disallows in object names
 * mapped to `_`. Mirrors the engine's `filenameToObjectname` (`fileio.ts`) so a
 * browser open names its object the same way a path load would.
 */
export function objectNameForFile(name: string): string {
  let base = name.replace(/^.*[/\\]/, '');
  const zip = /\.(gz|bz2)$/i.exec(base);
  if (zip) base = base.slice(0, -zip[0].length);
  const dot = base.lastIndexOf('.');
  return (dot > 0 ? base.slice(0, dot) : base).replace(/[\s'"();:]/g, '_');
}

/**
 * The console line for a drop that cannot be completed here.
 *
 * Named rather than generic: "this needs the trajectory dialog" tells the user
 * which of the six it hit and what to do, where "could not load" would leave
 * them guessing whether the file was even readable.
 */
export function dialogRequiredMessage(name: string, dialog: string): string {
  return (
    ` ${name} needs the ${dialog} dialog — open File dialogs and use Open…, ` +
    'which asks for the options this format requires.'
  );
}


/**
 * Is this keypress one of the two window-level accelerators?
 *
 * `pymol_qt_gui.py:387-388` registers Ctrl+O (file_open) and Ctrl+S
 * (session_save) as window QShortcuts — described there as "MacPyMOL
 * compatible", which is why Meta counts as well as Control.
 *
 * They are NOT PyMOL `set_key` bindings, so a match must be swallowed rather
 * than forwarded: reaching the viewport key handler would send CTRL-O to
 * PyMOL as well as opening the picker.
 *
 * ALT DISQUALIFIES. Ctrl+Alt+O is a different chord, and on some layouts it is
 * how AltGr characters arrive — treating it as Open would hijack typing.
 */
export function windowAccelerator(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): 'open' | 'save' | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === 'o') return 'open';
  if (key === 's') return 'save';
  return null;
}
