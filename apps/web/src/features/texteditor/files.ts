/**
 * The text editor's file access.
 *
 * `modules/pmg_qt/TextEditor.py` reads and writes with plain `open()` — the
 * localhost assumption of the whole product. A browser cannot do that, so the
 * bridge has to expose it, and the endpoints belong to WP-18
 * (`bridge/tenmol_bridge/fs.py`, plan §6). They do not exist on this tree yet.
 *
 * So this module has TWO paths and is explicit about which one ran:
 *
 *   server  `_bridge.read_text_file` / `_bridge.write_text_file`, tried first.
 *           This is the contract WP-18 should implement; the shape is
 *           deliberately minimal so it is cheap to satisfy.
 *   browser `<input type="file">` to open and a download to save. Real, works
 *           today, and honest about what it is: the file lands in ~/Downloads,
 *           not at the path PyMOL would have written.
 *
 * `cmd.run(path)` and `cmd.do('@path')` DO exist and are used unchanged, so a
 * script the user edits can still be executed by PyMOL.
 */

import { FILES_NS } from '@tenmol/protocol/topics/files';
import type { Session } from '../../app';

export type FileAccess = 'server' | 'browser';

export interface ReadResult {
  path: string;
  text: string;
  access: FileAccess;
}

/** `_bridge.read_text_file(path) -> {path, text}` (WP-18). */
export async function readServerFile(session: Session, path: string): Promise<ReadResult> {
  /*
   * WAS `_bridge.read_text_file`, which DOES NOT EXIST — measured, the bridge
   * answers `no render route for '_bridge.read_text_file'`. Every attempt to
   * open a file on the PyMOL host therefore failed and the panel silently fell
   * back to the browser file picker, which cannot edit a pymolrc IN PLACE —
   * the one thing this editor is for.
   *
   * `cmd.tenmol_files` is the file service that does exist: same work package,
   * already policy-reachable as a three-segment `cmd.*` path, already
   * bootstrapped by `filesApi.ensure()`.
   */
  const value = await session.call<{ path?: string; text?: string; ok?: boolean; error?: string | null }>(
    `${FILES_NS}.read_text`,
    [path],
  );
  if (value?.ok === false) throw new Error(value.error ?? `could not read ${path}`);
  return { path: value?.path ?? path, text: value?.text ?? '', access: 'server' };
}

/** `cmd.tenmol_files.write_text(path, text)` (WP-18). */
export async function writeServerFile(
  session: Session,
  path: string,
  text: string,
): Promise<void> {
  const value = await session.call<{ ok?: boolean; error?: string | null }>(
    `${FILES_NS}.write_text`,
    [path, text],
  );
  // Errors are RETURNED rather than raised, so that the path that failed
  // survives; turn that back into a throw for the panel's catch.
  if (value?.ok === false) throw new Error(value.error ?? `could not write ${path}`);
}

/**
 * Is the server path available at all? Cached per session by the caller.
 *
 * A path error means the route EXISTS and simply disliked the empty argument;
 * a routing error means it does not. Getting that distinction wrong is not
 * cosmetic — it decides whether the panel claims to have written to the PyMOL
 * host. The strings are the bridge's actual ones, measured on this tree:
 * `_bridge.read_text_file` answers `no render route for
 * '_bridge.read_text_file'` (`server.py`'s `_bridge.*` table), and an
 * un-granted symbol answers `... is not an addressable namespace`
 * (`policy/base.py`).
 */
export const MISSING_ROUTE =
  /no (render )?route|not an addressable namespace|no such symbol|not implemented|not allowed/i;

export async function probeServerFiles(session: Session): Promise<boolean> {
  try {
    // An EMPTY path: the route exists and will simply dislike the argument,
    // which is the distinction this probe is drawing. `read_text` returns its
    // errors rather than raising, so a returned `ok:false` is a live route.
    await session.call(`${FILES_NS}.read_text`, ['']);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return !MISSING_ROUTE.test(message);
  }
}

/** Open a local file through the browser's own picker. */
export function pickBrowserFile(): Promise<ReadResult | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.py,.pml,.pymolrc,text/plain';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      void file.text().then((text) => resolve({ path: file.name, text, access: 'browser' }));
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Save through the browser. Returns the name the file was given. */
export function downloadFile(name: string, text: string): string {
  const filename = name || 'untitled.pml';
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.split('/').pop() ?? filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return anchor.download;
}

/** `cmd.run(path)` for `.py`, `cmd.do('@path')` for everything else. */
export async function runScript(session: Session, path: string): Promise<void> {
  if (path.endsWith('.py')) {
    await session.call('run', [path]);
    return;
  }
  await session.conn.do(`@${path}`);
}
