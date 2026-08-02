/**
 * One settings store + source + poller per session.
 *
 * The session (`app/session.ts`) is a module singleton owned by another work
 * package and cannot be extended from here, so this module keeps the settings
 * machinery beside it in a `WeakMap` keyed by session. Effect: mounting the
 * panel twice (React 19 StrictMode does exactly that in development) still
 * bootstraps once, polls once and holds one catalogue.
 *
 * The poll is 5 Hz, not 30. It is a poll of a TAP, not of PyMOL: the bridge's
 * status thread is the only consumer of `cmd.get_setting_updates()` and the tap
 * accumulates what it saw, so a slow poll delays a checkbox by 200 ms and loses
 * nothing. Polling the drain itself at any rate would steal updates from the
 * bridge (plan §1.2, measured).
 *
 * THE POLL IS NOW A BACKSTOP, NOT THE CHANNEL. `BridgeServer._on_status`
 * publishes the `settings` topic (wave 10; for four waves it accepted a
 * subscription and nothing published to it), so a write is pushed within one
 * 10 Hz status interval instead of waiting up to 200 ms for the next poll. The
 * push KICKS the same poll rather than applying the payload directly, and that
 * is deliberate: the store's apply path lives in `@tenmol/stores/settings`
 * behind `source.poll()`, the tap is cursor-addressed and therefore idempotent,
 * and a kicked poll cannot lose an index the push happened to miss. Two
 * channels, one cursor, no double-drain — the invariant this whole area exists
 * to protect is untouched, because neither channel calls
 * `cmd.get_setting_updates()`; both are fan-outs of the one call the status
 * thread makes.
 */

import { createPoller, type Poller } from '@tenmol/stores';
import {
  createSettingsSource,
  createSettingsStore,
  type SettingsSource,
  type SettingsStore,
} from '@tenmol/stores/settings';
import type { Session } from '../../app';

export interface SettingsService {
  store: SettingsStore;
  source: SettingsSource;
  poller: Poller;
  /** How many `settings` topic events this service has received. */
  pushes(): number;
  /** Bootstrap once; safe to call on every mount and after a reconnect. */
  ensure(): Promise<void>;
}

const BY_SESSION = new WeakMap<Session, SettingsService>();

export function getSettingsService(session: Session): SettingsService {
  const existing = BY_SESSION.get(session);
  if (existing) return existing;

  const store = createSettingsStore();
  const source = createSettingsSource({
    call: (fn, args, kwargs) => session.call(fn, args, kwargs),
    do: (line) => session.conn.do(line),
    store,
    onChanged: (indices, full) => {
      // A setting write is NOT cosmetic: SettingGenerateSideEffects
      // (`layer1/Setting.cpp:1872-1930`) invalidates reps, reloads shaders and
      // rebuilds scene members. The object panel's poller is the cheapest
      // handle we have on "re-read what PyMOL now thinks", so kick it.
      if (full || indices.length > 0) session.poller.kick();
    },
  });

  let inflight: Promise<void> | undefined;

  const poller = createPoller({
    focusedHz: 5,
    hiddenHz: 1,
    isEnabled: () => session.conn.isOpen && store.get().phase === 'ready',
    run: () => source.poll(),
    onError: () => {
      /* a failed tap poll is not fatal: the next one re-reads the same cursor */
    },
  });

  // The push. Subscribed once per session, next to the poller it accelerates.
  // `sub` is queued while the socket is down and flushed on open, and the
  // client re-sends live subscriptions itself after a reconnect, so this must
  // happen exactly once (the double-subscribe fix in WP-05).
  let pushes = 0;
  session.conn.on('settings', () => {
    pushes += 1;
    poller.kick();
  });
  void session.conn.sub('settings').catch(() => undefined);

  const service: SettingsService = {
    store,
    source,
    poller,
    /** Test/diagnostic: how many `settings` topic events have arrived. */
    pushes: () => pushes,
    ensure(): Promise<void> {
      const phase = store.get().phase;
      if (phase === 'ready') return Promise.resolve();
      if (inflight) return inflight;
      inflight = source
        .bootstrap()
        .catch(() => undefined)
        .finally(() => {
          inflight = undefined;
        });
      return inflight;
    },
  };

  BY_SESSION.set(session, service);
  return service;
}
