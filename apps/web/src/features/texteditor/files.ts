/**
 * The text editor's file access.
 *
 * `packages/engine/modules/pmg_qt/TextEditor.py` reads and writes with plain `open()` — the
 * localhost assumption of the whole product. A browser cannot do that, so the
 * bridge has to expose it, and the endpoints belong to WP-18
 * (`packages/bridge/tenmol_bridge/fs.py`, plan §6). They do not exist on this tree yet.
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

import { FILES_BOOTSTRAP, FILES_NS } from '@tenmol/protocol/topics/files';
import type { Session } from '../../app';
import { defaultPymolrcPath } from './syntax';

export type FileAccess = 'server' | 'browser';

/**
 * What the panel knows about its file access, INCLUDING "not yet".
 *
 * `FileAccess` alone cannot express the state the editor is actually in for the
 * first few round trips of its life, and pretending it can is what made this a
 * defect rather than a cosmetic wart: the panel initialised `access` to
 * `'browser'` and every action read that value, so a `Save` issued before
 * {@link probeServerFiles} answered went to ~/Downloads instead of to the PyMOL
 * host — silently, with a status line that said so in the past tense. The
 * window is ~30 ms on a warm developer machine (measured) and long enough to
 * fail an end-to-end spec on a shared CI runner drawing through a software
 * rasteriser, which is how it was found.
 */
export type AccessState = FileAccess | 'probing';

export interface ReadResult {
  path: string;
  text: string;
  access: FileAccess;
}

/** {@link openServerFile}: the file is not there yet, so the buffer is new. */
export interface OpenResult extends ReadResult {
  /** False when the path does not exist — an empty buffer aimed at it. */
  exists: boolean;
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

/**
 * `read_text`, but a MISSING file is an answer rather than an error.
 *
 * `File ▸ Edit pymolrc` on a machine with no rc file is the normal case, not a
 * failure: MEASURED on this tree, `cmd.tenmol_files.pymolrc()` answers
 * `{'paths': [], 'home': '/Users/…'}` and `read_text('~/.pymolrc')` answers
 * `ok: False, error: "[Errno 2] No such file or directory: '/Users/…/.pymolrc'"`.
 * Qt handles exactly this with a "Create new pymolrc?" prompt
 * (`TextEditor.py:168-182`); here the editor simply opens an empty buffer AIMED
 * at that path, says so, and `Save` creates it.
 *
 * Every other failure still throws — a permission error must not be mistaken
 * for "the file is empty", because saving would then overwrite it.
 */
export async function openServerFile(session: Session, path: string): Promise<OpenResult> {
  const value = await session.call<{
    path?: string;
    text?: string;
    ok?: boolean;
    error?: string | null;
  }>(`${FILES_NS}.read_text`, [path]);
  // `read_text` returns the EXPANDED path even when it failed, which is the
  // whole reason this does not go through `readServerFile`: `~/.pymolrc` has to
  // become `/Users/me/.pymolrc` before the editor can title itself or save.
  const full = value?.path || path;
  if (value?.ok === false) {
    const error = value.error ?? `could not read ${path}`;
    if (!NOT_FOUND.test(error)) throw new Error(error);
    return { path: full, text: '', access: 'server', exists: false };
  }
  return { path: full, text: value?.text ?? '', access: 'server', exists: true };
}

/**
 * "This file does not exist yet" as `read_text` reports it.
 *
 * The bridge returns `str(OSError)`, so the text is the platform's: POSIX
 * `[Errno 2] No such file or directory: '…'` (measured), Windows
 * `[Errno 2] No such file or directory` / `[WinError 3] The system cannot find
 * the path specified`.
 */
export const NOT_FOUND = /errno 2\b|no such file or directory|cannot find the (file|path)/i;

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

/**
 * Bootstrap-and-ask rounds before the probe concludes the bridge serves no
 * files, and the pause each round leaves BETWEEN its bootstrap and its ask
 * (`delay * round`, capped by {@link PROBE_MAX_DELAY_MS}).
 *
 * WHY A RETRY AT ALL, when the bootstrap is already awaited. `{t:'do'}` does
 * not run the command — it ENQUEUES it. `cmd.do` reaches `PParse`, which is
 * `OrthoCommandIn` (`packages/engine/layer1/P.cpp:2200-2203`); the queue is
 * drained by `PFlush` from `PyMOL_Idle`, and `PyMOL_Idle` opens with
 * `PYMOL_API_TRYLOCK` (`packages/engine/layer5/PyMOL.cpp:2407-2436`,
 * `:95`) — a TRY-lock, so a tick that loses the API lock to the bridge's own
 * status thread performs no flush at all. The bridge answers `ok` for the
 * `do` before that tick even starts (`pump.py:_execute` resolves the future,
 * then the loop breaks to `engine.tick()`), so "the bootstrap was
 * acknowledged" and "the module is installed" are two different facts. One
 * missed flush used to be permanent: the panel dropped to the browser picker
 * for the rest of that window's life, with no way back.
 *
 * The schedule is `armPluginDialogs`' (`files/FileDropTarget.tsx:95-106`)
 * shape — bounded attempts, no unbounded polling — front-loaded because the
 * common case answers on the first round trip.
 *
 * MEASURED, and the reason these are not smaller. With the bridge made to
 * behave like the CI runner's `Apple Software Renderer` (`Cmd_Draw` holds
 * `lock_api` for the whole draw, 140-158 ms there against ~0.3 ms here), one
 * `cmd.tenmol_files.read_text` round trip cost 583-2445 ms and one `{t:'do'}`
 * bootstrap took 1638 ms to be acknowledged — against 4-7 ms for both on an
 * idle machine. The single bootstrap-and-ask this replaced failed outright
 * under that simulation: `editor is not using the server fs (browser fs)`,
 * 3271 ms into the e2e spec.
 */
export const PROBE_ATTEMPTS = 5;
export const PROBE_DELAY_MS = 250;

/**
 * Ceiling on that pause, and why the back-off does not keep doubling.
 *
 * The pause is there to cover ENGINE TICKS, not slow hosts: on a fast machine
 * a round trip is 4-7 ms and the only thing between the bootstrap and its
 * effect is a `PyMOL_Idle` that may have lost one try-lock — tens of
 * milliseconds. On a loaded host the rounds pace THEMSELVES, two round trips
 * of up to 2445 ms each, so a back-off growing into seconds would add nothing
 * to the patience that matters and seconds to the `probing…` a user watches.
 */
export const PROBE_MAX_DELAY_MS = 500;

export interface ProbeOptions {
  attempts?: number;
  delayMs?: number;
  /** Stop retrying once the caller has gone away (the panel unmounted). */
  alive?: () => boolean;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Ask once. `true`/`false` is an answer; `null` means "not routed *yet*".
 *
 * An EMPTY path: the route exists and will simply dislike the argument, which
 * is the distinction this probe is drawing. `read_text` returns its errors
 * rather than raising, so a returned `ok:false` is a live route.
 */
async function askOnce(session: Session): Promise<true | null> {
  try {
    await session.call(`${FILES_NS}.read_text`, ['']);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return MISSING_ROUTE.test(message) ? null : true;
  }
}

export async function probeServerFiles(
  session: Session,
  options: ProbeOptions = {},
): Promise<boolean> {
  const attempts = Math.max(1, options.attempts ?? PROBE_ATTEMPTS);
  const delayMs = Math.max(0, options.delayMs ?? PROBE_DELAY_MS);
  const alive = options.alive ?? (() => true);

  const first = await askOnce(session);
  if (first !== null) return true;

  /*
   * THE NAMESPACE IS NOT ATTACHED YET, WHICH IS NOT THE SAME AS ABSENT.
   *
   * `cmd.tenmol_files` is bootstrapped by one `{t:'do'}` line and nothing in
   * the app runs it at startup: `features/files` calls `api.ensure()` inside
   * its handlers only (`FileDropTarget.tsx:99,143,211`). So an editor opened
   * before the user has touched a file dialog probed a symbol that PyMOL had
   * never imported, read `not an addressable namespace`, and fell back to the
   * browser picker — which cannot edit a pymolrc IN PLACE, the one thing this
   * editor exists for. Same two-step as `createFilesApi.bootstrap()`, but
   * repeated, because one `{t:'do'}` is not one execution (see above).
   */
  for (let round = 0; round < attempts; round += 1) {
    if (!alive()) return false;
    try {
      await session.conn.do(FILES_BOOTSTRAP);
    } catch {
      // A `do` that fails outright (socket re-opening, queue full) is not
      // evidence about the ROUTE; ask anyway, after the same pause.
    }
    /*
     * THE PAUSE GOES BETWEEN THE BOOTSTRAP AND THE ASK THAT JUDGES IT, not at
     * the end of the round. That is the whole point of having one: `do` is
     * acknowledged when the line is ENQUEUED, so an ask fired the microsecond
     * the ack lands is asking before the engine has had a chance to flush.
     * With the pause at the end instead, every ask but the first inherited its
     * settling time from the PREVIOUS round and the last one — the ask whose
     * answer becomes the verdict — got none at all.
     */
    if (delayMs > 0) await sleep(Math.min(delayMs * (round + 1), PROBE_MAX_DELAY_MS));
    if (!alive()) return false;
    const again = await askOnce(session);
    if (again !== null) return true;
  }
  return false;
}

/**
 * The cheap re-ask an ACTION does before it accepts the browser fallback.
 *
 * One bootstrap-and-ask, no schedule: by the time a user clicks Save the
 * question is no longer "is this bridge slow" but "has the namespace turned up
 * since the panel gave up asking" — and the app installs it itself
 * (`FileDropTarget`'s `armPluginDialogs`, five attempts a second apart), so on
 * a loaded host it routinely turns up after the editor has stopped.
 */
export const RECHECK: ProbeOptions = { attempts: 1, delayMs: 0 };

/**
 * Which file `File ▸ Edit pymolrc` should open.
 *
 * `edit_pymolrc` (`TextEditor.py:150-165`) reads
 * `pymol.invocation.options.pymolrc` — the rc files this process actually
 * loaded — and falls back to `$HOME/.pymolrc` (`$HOMEDRIVE$HOMEPATH\pymolrc.pml`
 * on Windows) when there are none. `cmd.tenmol_files.pymolrc()` is
 * `invocation.get_user_config()` plus `$HOME`, so both halves are one call.
 *
 * `candidates.length > 1` is Qt's `QInputDialog.getItem` case; the list is
 * returned so the panel can offer the same choice rather than silently taking
 * the first.
 */
export interface PymolrcTarget {
  path: string;
  candidates: readonly string[];
  home: string;
}

export async function resolvePymolrc(session: Session): Promise<PymolrcTarget> {
  const value = await session.call<{ paths?: unknown; home?: unknown }>(`${FILES_NS}.pymolrc`, []);
  const candidates = Array.isArray(value?.paths)
    ? value.paths.filter((p): p is string => typeof p === 'string' && p.length > 0)
    : [];
  const home = typeof value?.home === 'string' ? value.home : '';
  // The PyMOL host's platform, from the shape of its own home directory —
  // `defaultPymolrcPath` needs it and the bridge has no other reason to send
  // one. A Windows `$HOME` is `C:\Users\me`; a POSIX one never contains `\`.
  const platform = home.includes('\\') ? 'win32' : 'darwin';
  return { path: candidates[0] ?? defaultPymolrcPath(platform, home), candidates, home };
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
