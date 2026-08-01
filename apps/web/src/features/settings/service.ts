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

  const service: SettingsService = {
    store,
    source,
    poller,
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
