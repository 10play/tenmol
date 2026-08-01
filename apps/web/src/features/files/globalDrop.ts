/**
 * Drag & drop onto the window, decided as pure functions.
 *
 * `modules/pmg_qt/pymol_gl_widget.py:256-270` accepts URL mime data on the GL
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

import type { FileClassification } from '@tenmol/protocol/topics/files';

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
