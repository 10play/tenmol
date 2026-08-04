/**
 * The settings PUSH channel — `setting_callbacks` without Qt.
 *
 * WHAT QT DOES, and why anything is needed at all. `update_feedback`
 * (`packages/engine/modules/pmg_qt/pymol_qt_gui.py:941-968`) runs on a timer that re-arms at
 * 500 ms and, after draining the console, does this:
 *
 *     for index in cmd.get_setting_updates():
 *         value = cmd.get_setting_tuple(index)[1][0]
 *         for callback in self.setting_callbacks[index]:
 *             callback(value)
 *
 * That loop is the ONLY mechanism that moves a checkable menu item, a radio dot
 * or the window title when something other than the widget itself changed the
 * setting — `set orthoscopic, 1` typed at the prompt, `util.performance`, a
 * plugin, a session load. Note the shape: PyMOL reports WHICH INDICES changed,
 * and the consumer then READS those settings. This module is that shape.
 *
 * WHY IT IS NOT `cmd.get_setting_updates`. That call is destructive — it clears
 * the flags while iterating (`packages/engine/layer1/Setting.cpp:1121-1147`) — and the bridge's
 * status thread owns it (`policy/base.py: EXCLUSIVE_TO_BRIDGE`). What the
 * client reads is `panels/settings.py`'s TAP: a cumulative, cursor-addressed
 * log of what the status thread saw. Two facts make a second consumer safe, and
 * both were measured over the socket before this module was written:
 *
 *   * the cursor is an ARGUMENT, not server state — `tenmol_settings_drain(c)`
 *     answers "everything since c" — so `features/settings` and this module
 *     hold independent cursors and neither steals from the other;
 *   * `install()` is idempotent and does NOT build the catalogue
 *     (`status.catalogueBuilt` stays false after it), so the shell pays for a
 *     drain and nothing else. `features/settings`' `bootstrap()` — catalogue
 *     plus every value — is still that feature's business, not the shell's.
 *
 * MEASURED, and the reason `cmd.do` is called with `echo=0`: the same import
 * sent as a `{t:'do'}` frame puts
 * `PyMOL>/import tenmol_bridge.panels.settings as _s;_s.install()` in the
 * console. `cmd.do(line, echo=0)` installs with no console line at all.
 *
 * IT DEGRADES. A bridge whose settings panel will not install leaves `live`
 * false for ever after three attempts, and every consumer here keeps the poll
 * it had before. The shell must not depend on another feature being installed
 * — hence a shell-owned tap that talks to the bridge module directly rather
 * than a `getSettingsService` import.
 */

import { createPoller, type Poller } from '@tenmol/stores';
import type { Session } from '../app';

/** `panels/settings.py`'s API, as the dispatcher addresses it. */
const FN = {
  status: 'setting.tenmol_settings_status',
  drain: 'setting.tenmol_settings_drain',
  values: 'setting.tenmol_settings_values',
} as const;

/** `/` makes PyMOL's parser treat the rest as Python (`packages/engine/modules/pymol/parser.py`). */
export const SETTINGS_TAP_BOOTSTRAP = '/import tenmol_bridge.panels.settings as _s;_s.install()';

/** `session_file`, MEASURED: `setting._get_index('session_file')` is 440. */
export const SESSION_FILE_INDEX = 440;

/** Qt re-arms its timer at 500 ms; 5 Hz is the rate `features/settings` uses. */
const TAP_HZ = 5;

/** After this many failed installs the tap gives up and consumers keep polling. */
const MAX_INSTALL_ATTEMPTS = 3;

/** One batch of changed indices, as `get_setting_updates()` would report it. */
export interface TapBatch {
  indices: readonly number[];
  /** A session-load-sized batch: assume everything changed. */
  full: boolean;
}

/** `values[0]`, exactly as Qt compares it (`pymol_qt_gui.py:337`). */
export type TapValue = number | string | null;

export interface SettingsTap {
  /**
   * Start polling. Reference-counted: the LAST consumer to detach stops it, so
   * the menu bar unmounting does not blind the window title.
   */
  attach(): () => void;
  /** Every non-empty batch, in arrival order. */
  subscribe(listener: (batch: TapBatch) => void): () => void;
  /**
   * Follow one index the way `setting_callbacks[i].append(cb)` does: the
   * listener is called with the value now (one read) and again on every change.
   */
  watch(index: number, listener: (value: TapValue) => void): () => void;
  /** Setting NAME -> index, cached for the session. `null` when unresolvable. */
  indices(names: readonly string[]): Promise<ReadonlyMap<string, number>>;
  /** True once a drain has answered: consumers may then drop their polls. */
  readonly live: boolean;
  /** For tests: pass count, so "the tap is doing the work" is observable. */
  stats(): { batches: number; passes: number; installAttempts: number };
}

const BY_SESSION = new WeakMap<Session, SettingsTap>();

export function getSettingsTap(session: Session): SettingsTap {
  const existing = BY_SESSION.get(session);
  if (existing) return existing;
  const tap = createSettingsTap(session);
  BY_SESSION.set(session, tap);
  return tap;
}

/** Exported for tests only: forget the tap bound to this session. */
export function resetSettingsTap(session: Session): void {
  BY_SESSION.delete(session);
}

function createSettingsTap(session: Session): SettingsTap {
  let installed = false;
  let installAttempts = 0;
  let cursor = 0;
  let live = false;
  let batches = 0;
  let refs = 0;

  const batchListeners = new Set<(batch: TapBatch) => void>();
  const watchers = new Map<number, Set<(value: TapValue) => void>>();
  const resolved = new Map<string, number>();

  async function ensureInstalled(): Promise<boolean> {
    if (installed) return true;
    if (installAttempts >= MAX_INSTALL_ATTEMPTS) return false;
    installAttempts += 1;
    try {
      const status = await session.call<{ installed?: boolean }>(FN.status);
      if (status?.installed) {
        installed = true;
        return true;
      }
    } catch {
      /* not installed yet — the normal first-run path, `no such symbol` */
    }
    try {
      // `echo=0`: a `{t:'do'}` frame would print the import into the console.
      await session.call('cmd.do', [SETTINGS_TAP_BOOTSTRAP], { echo: 0 });
      const status = await session.call<{ installed?: boolean }>(FN.status);
      installed = !!status?.installed;
    } catch {
      installed = false;
    }
    return installed;
  }

  async function readValues(indices: readonly number[]): Promise<void> {
    if (indices.length === 0) return;
    const reply = await session.call<{ values?: [number, unknown, string][] }>(FN.values, [
      [...indices],
      '',
      0,
    ]);
    for (const row of reply?.values ?? []) {
      const [index, raw] = row;
      // float3 arrives as three numbers and Qt compares `values[0]`.
      const value = Array.isArray(raw) ? (raw[0] as TapValue) : (raw as TapValue);
      for (const listener of watchers.get(index) ?? []) listener(value ?? null);
    }
  }

  async function pass(): Promise<void> {
    if (!(await ensureInstalled())) {
      // A transient failure during startup must not disable the tap for the
      // life of the tab, and a bridge with no settings panel must not be asked
      // for ever. Three tries, then every consumer keeps the poll it had.
      if (installAttempts >= MAX_INSTALL_ATTEMPTS) poller.stop();
      return;
    }
    const drained = await session.call<{
      cursor?: number;
      indices?: number[];
      full?: boolean;
      lost?: boolean;
    }>(FN.drain, [cursor]);
    if (!drained || typeof drained.cursor !== 'number') return;
    cursor = drained.cursor;
    live = true;
    const full = !!drained.full || !!drained.lost;
    const indices = drained.indices ?? [];
    if (!full && indices.length === 0) return;
    batches += 1;
    for (const listener of [...batchListeners]) listener({ indices, full });
    // A `full` batch does list its indices, but the safe reading of it is "a
    // session-load-sized change arrived": re-read everything anyone watches.
    await readValues(full ? [...watchers.keys()] : indices.filter((i) => watchers.has(i)));
  }

  const poller: Poller = createPoller({
    focusedHz: TAP_HZ,
    hiddenHz: 1,
    isEnabled: () => session.conn.isOpen,
    run: pass,
    onError: () => {
      /* a failed drain is not fatal: the next one re-reads the same cursor */
    },
  });

  return {
    attach() {
      refs += 1;
      if (refs === 1) poller.start();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        refs -= 1;
        if (refs === 0) poller.stop();
      };
    },

    subscribe(listener) {
      batchListeners.add(listener);
      return () => batchListeners.delete(listener);
    },

    watch(index, listener) {
      const set = watchers.get(index) ?? new Set();
      set.add(listener);
      watchers.set(index, set);
      // The initial read, which is what `_addmenu` does at BUILD time before
      // registering the callback (`pymol_qt_gui.py:337`).
      void (async () => {
        if (!(await ensureInstalled())) return;
        await readValues([index]).catch(() => undefined);
      })().catch(() => undefined);
      return () => {
        set.delete(listener);
        if (set.size === 0) watchers.delete(index);
      };
    },

    async indices(names) {
      const wanted = names.filter((name) => !resolved.has(name));
      if (wanted.length > 0 && (await ensureInstalled())) {
        // ONE call for the whole list. `_resolve_index` SILENTLY DROPS a name it
        // cannot resolve (`panels/settings.py:702-710`), so a short answer is
        // ambiguous and the only honest recovery is name-by-name.
        const batch = await session
          .call<{ values?: [number, unknown, string][] }>(FN.values, [[...wanted], '', 0])
          .catch(() => null);
        const rows = batch?.values ?? [];
        if (rows.length === wanted.length) {
          wanted.forEach((name, i) => {
            const index = rows[i]?.[0];
            if (typeof index === 'number') resolved.set(name, index);
          });
        } else {
          const one = await Promise.all(
            wanted.map((name) =>
              session
                .call<{ values?: [number, unknown, string][] }>(FN.values, [[name], '', 0])
                .then((reply) => reply?.values?.[0]?.[0] ?? null)
                .catch(() => null),
            ),
          );
          wanted.forEach((name, i) => {
            const index = one[i];
            if (typeof index === 'number') resolved.set(name, index);
          });
        }
      }
      const out = new Map<string, number>();
      for (const name of names) {
        const index = resolved.get(name);
        if (index !== undefined) out.set(name, index);
      }
      return out;
    },

    get live() {
      return live;
    },

    stats() {
      return { batches, passes: poller.stats().passes, installAttempts };
    },
  };
}
