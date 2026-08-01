/**
 * Wiring for the in-viewport console: feedback in, settings in, commands out.
 *
 * TWO THINGS THIS FILE MUST NOT DO, both measured constraints:
 *
 *  1. It must not subscribe to the `feedback` topic itself. The drain
 *     (`cmd._get_feedback()`) is destructive and single-consumer — plan §1.2
 *     measured a second consumer splitting the stream (`consumerA saw: [468]`,
 *     `consumerB saw: []`). The bridge is the consumer; the session's feedback
 *     store is the client's single copy. So the ortho ring is fed FROM that
 *     store, by watching its tail, not from the socket.
 *
 *  2. It must not poll settings on the hot path. `cmd.get_setting_int` takes
 *     the API lock, and there is no push feed for these eight values: the
 *     `settings` topic is declared (`packages/protocol/src/topics/settings.ts`,
 *     WP-15) but `BridgeServer._on_status` only fans out `feedback` and
 *     `progress`, so `get_setting_updates()` is drained into
 *     `StatusPoller._settings` and goes nowhere. Until WP-15 lands that
 *     fan-out this polls at 1 Hz, pauses when the document is hidden, and
 *     kicks immediately after any command — which is when a console setting
 *     can actually have changed.
 *
 * Reported to WP-15 as `needsFromOthers`: emit the `settings` topic from
 * `_on_status` and this poller deletes itself.
 */

import {
  CONSOLE_SETTING_NAMES,
  type ConsoleSettingName,
  type ConsoleSettings,
} from '@tenmol/protocol/topics/console';
import { createConsoleStore, type ConsoleStore } from '@tenmol/stores/console';
import { adoptSettings } from './settingsAdopt';
import type { FeedbackState } from '@tenmol/stores';
import { getSession, type Session } from '../../app';

/** 1 Hz. See the header: this is a stopgap for a missing push feed. */
const SETTINGS_INTERVAL_MS = 1000;
/** Backed off to this while the tab is hidden (plan §1.5 uses the same idea). */
const HIDDEN_INTERVAL_MS = 5000;

export interface ConsoleSource {
  store: ConsoleStore;
  /** Read the eight settings now. Safe to call while one is already in flight. */
  refreshSettings(): Promise<void>;
  stop(): void;
}

let singleton: ConsoleSource | null = null;

/**
 * Module singleton, matching `getSession()`. The ortho console is one widget in
 * one window over one PyMOL process; two stores would be two scrollbacks
 * disagreeing about `CurLine`, and `auto_overlay` is computed from `CurLine`.
 */
export function getConsoleSource(): ConsoleSource {
  if (!singleton) singleton = createConsoleSource(getSession());
  return singleton;
}

export function createConsoleSource(session: Session): ConsoleSource {
  const store = createConsoleStore();

  /* ---------------- feedback -> the 256-line ortho ring ---------------- */

  // The feedback store hands out monotonic, never-reused sequence numbers and
  // already de-duplicates the bridge's replay-on-subscribe, so "everything
  // newer than the last seq I saw" is exactly right across a reconnect.
  let lastSeq = 0;
  const drain = (state: FeedbackState) => {
    const fresh: string[] = [];
    for (const entry of state.lines) {
      if (entry.seq > lastSeq) {
        fresh.push(entry.text);
        lastSeq = entry.seq;
      }
    }
    if (fresh.length > 0) store.addOutput(fresh);
  };
  drain(session.stores.feedback.get());
  const unsubscribe = session.stores.feedback.subscribe(drain);

  /* ---------------- settings ---------------- */

  let inFlight: Promise<void> | null = null;
  /** The last values PyMOL reported, for {@link adoptSettings}'s change test. */
  let remote: Partial<ConsoleSettings> = {};

  async function refreshSettings(): Promise<void> {
    if (inFlight) return inFlight;
    if (!session.conn.isOpen) return;
    inFlight = (async () => {
      try {
        const values = await Promise.all(
          CONSOLE_SETTING_NAMES.map(
            async (name): Promise<readonly [ConsoleSettingName, number | null]> => [
              name,
              // One failed setting must not lose the other nine, and it must not
              // write to the console: `session.call` rejects quietly on purpose
              // (see its doc comment).
              await session.call<number>('cmd.get_setting_int', [name]).catch(() => null),
            ],
          ),
        );
        if (values.every(([, v]) => v === null)) return; // whole batch failed
        const before = remote.auto_overlay;
        const result = adoptSettings(remote, values);
        remote = result.remote;
        store.setSettings(result.patch);
        // `SettingGenerateSideEffects` case `cSetting_auto_overlay`:
        // `OrthoRemoveAutoOverlay(G); /* always start clean */`
        // (`layer1/Setting.cpp:2816-2818`). Without this, turning auto_overlay
        // on reveals the whole backlog instead of only what is printed next.
        if (before !== undefined && result.remote.auto_overlay !== before)
          store.removeAutoOverlay();
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = () => {
    void refreshSettings();
    const hidden =
      typeof document !== 'undefined' && (document as Document | undefined)?.hidden === true;
    timer = setTimeout(tick, hidden ? HIDDEN_INTERVAL_MS : SETTINGS_INTERVAL_MS);
  };
  tick();

  const source: ConsoleSource = {
    store,
    refreshSettings,
    stop() {
      unsubscribe();
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };

  if (import.meta.env.DEV) {
    // Development handle, matching `getSession()`'s `__tenmol`. A headless
    // browser cannot read the eight polled settings any other way, and "what
    // does the console THINK internal_feedback is" is the first question when
    // the overlay draws the wrong number of lines.
    (globalThis as unknown as { __tenmolConsole?: ConsoleSource }).__tenmolConsole = source;
  }

  return source;
}
