/**
 * `?open=<path>` — the seam an OS document handler would call (row 293).
 *
 * WHAT THIS IS FOR. `PyMOLApplication.handle_file_open_active`
 * (`pymol_qt_gui.py:1136-1160`) is macOS's Finder "Open With" / app-icon drop
 * arriving as a Qt `FileOpen` event: the OS hands a running application a
 * PATH, and the application runs `load_dialog` on it (after the `.psw`
 * presentation preset). A browser tab receives no such event, and the row's
 * remaining gap — registering the bridge as the document handler — is
 * PACKAGING: a macOS `.app` bundle with `CFBundleDocumentTypes` plus
 * `LSRegisterURL`, which this repo has no step for.
 *
 * What a bundle like that would need from the client is a way to hand a path to
 * the running app, and the row's own plan column says so: "register the backend
 * as the OS handler so double-clicking a file starts/focuses the local server
 * and loads it". That is this. A three-line handler stub can `open
 * "http://<host>/?open=/Users/me/demo.psw"`, which focuses the existing tab (or
 * starts one) and puts the file through the SAME pipeline the File menu uses —
 * `requestFilesOpen` -> `plan_open` -> the partial question / the reflection
 * dialog / `cmd.load`, and for a show file the presentation preset.
 *
 * TAKEN, NOT READ. The parameter is removed from the address bar in the same
 * breath, exactly like `?token=` (`app/config.ts`), and for a sharper reason:
 * without that, RELOADING the tab would load the file again, and React's
 * StrictMode double-invokes mount effects, which would load it twice on the
 * first paint. Stripping first makes both idempotent.
 *
 * NO NEW AUTHORITY. The path goes through `plan_open`, so the bridge classifies
 * it and `FilesPanel.runStep` applies the same refusals a drag-and-drop gets —
 * a `.pwg` is refused rather than executed (`globalDrop.ts::refusalFor`), a
 * `.pse` still asks the partial question. A deep link can therefore do nothing
 * that the File ▸ Open… picker could not already do.
 */

/** The query parameter. Repeatable: `?open=a.pdb&open=b.pdb` is a multi-open. */
export const OPEN_PARAM = 'open';

/** Every non-empty `?open=` value of a query string, in order. */
export function openPathsFromQuery(search: string): string[] {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return params
    .getAll(OPEN_PARAM)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

/** The same query with every `open` removed, `''` when nothing is left. */
export function queryWithoutOpen(search: string): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (!params.has(OPEN_PARAM)) return search;
  params.delete(OPEN_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

/**
 * Consume `?open=` from the address bar and return the paths.
 *
 * Empty array when there is none, so the caller does nothing at all in the
 * ordinary case — this must not open the files panel on every start-up.
 */
export function takeOpenFromLocation(): string[] {
  if (typeof window === 'undefined') return [];
  const paths = openPathsFromQuery(window.location.search);
  if (paths.length === 0) return [];
  const clean = `${window.location.pathname}${queryWithoutOpen(window.location.search)}${window.location.hash}`;
  try {
    window.history.replaceState(null, '', clean);
  } catch {
    /* `file://` and sandboxed iframes forbid it; the parameter stays visible */
  }
  return paths;
}
