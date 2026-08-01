/**
 * The colour store, and the hook that gives a component the table.
 *
 * MODULE SINGLETON, like `app/session.ts` and for the same reason: there is one
 * PyMOL process and one colour table, and 5388 `get_color_tuple` calls is not
 * something two components should each pay for. `packages/stores/src/colors.ts`
 * is where this belongs long-term (plan §6 assigns it to WP-22 as well), but
 * this task's file ownership stops at `features/colors/**`, so it lives here
 * and exports the same shape a store module would.
 */

import { useCallback, useEffect } from 'react';
import { createStore, type Store } from '@tenmol/stores';
import { useSession, useStore, type Session } from '../../app';
import { EMPTY_PALETTE, loadPalette, loadRamps, type CallFn, type PaletteState } from './palette';

export type PaletteStore = Store<PaletteState>;

let store: PaletteStore | null = null;
let inFlight: Promise<void> | null = null;

export function paletteStore(): PaletteStore {
  if (!store) store = createStore<PaletteState>({ ...EMPTY_PALETTE });
  return store;
}

/** Exported for tests: forget everything, including the in-flight guard. */
export function resetPaletteStore(): void {
  store = null;
  inFlight = null;
}

/**
 * Fetch the table. Concurrent callers share one fetch; a `force` refetch after
 * `set_color` / `space` / `ramp_new` waits for any fetch already running rather
 * than interleaving 5388 calls with another 5388.
 */
export function refreshPalette(call: CallFn, force = false): Promise<void> {
  const target = paletteStore();
  if (inFlight) return force ? inFlight.then(() => refreshPalette(call, true)) : inFlight;
  if (!force && target.get().status === 'ready') return Promise.resolve();

  target.set({ status: 'loading', error: null });
  const run = loadPalette(call)
    .then((loaded) => {
      target.set((previous) => ({
        status: 'ready',
        error: null,
        entries: loaded.entries,
        named: loaded.named,
        specials: loaded.specials,
        ramps: loaded.ramps,
        loadedMs: loaded.ms,
        revision: previous.revision + 1,
      }));
    })
    .catch((error: unknown) => {
      target.set({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      inFlight = null;
    });
  inFlight = run;
  return run;
}

/** Re-scan `object:ramp` objects only — cheap, and the part that changes most. */
export async function refreshRamps(call: CallFn): Promise<void> {
  const ramps = await loadRamps(call);
  paletteStore().set({ ramps });
}

/**
 * Subscribe to the table and make sure it is being fetched.
 *
 * The fetch is tied to the socket being open, not to mount: the panel is in the
 * `overlay` region and therefore mounted from the first frame, long before the
 * bridge says hello.
 */
export function usePalette(): PaletteState {
  const session = useSession();
  const phase = useStore(session.stores.connection, (s) => s.phase);
  const state = useStore(paletteStore(), (s) => s);

  useEffect(() => {
    if (phase !== 'open') return;
    void refreshPalette(callOf(session));
  }, [phase, session]);

  return state;
}

/** `session.call` narrowed to the shape `palette.ts` asks for. */
export function callOf(session: Session): CallFn {
  return <T>(
    fn: string,
    args: readonly unknown[] = [],
    kwargs: Readonly<Record<string, unknown>> = {},
  ) => session.call<T>(fn, args, kwargs);
}

/**
 * Run a colour action, echo it like the object panel does, then refresh what it
 * invalidated. Returns the error text, or null.
 *
 * `invalidate: 'palette'` is for writes that change RGB values themselves
 * (`set_color`, `space`), `'ramps'` for `ramp_new` / `ramp_update` / `delete`.
 * Everything else only recolours atoms and leaves the table alone.
 */
export function useColorAction(): (
  echo: string,
  run: (call: CallFn) => Promise<unknown>,
  invalidate?: 'palette' | 'ramps' | null,
) => Promise<string | null> {
  const session = useSession();
  return useCallback(
    async (echo, run, invalidate = null) => {
      const call = callOf(session);
      session.stores.feedback.appendClient(echo);
      try {
        await run(call);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        session.stores.feedback.appendClient(` ${text}`, 'error');
        return text;
      }
      if (invalidate === 'palette') await refreshPalette(call, true);
      if (invalidate === 'ramps') await refreshRamps(call);
      // Any colour write can change what the object panel shows.
      session.objectsSource.invalidate();
      session.poller.kick();
      return null;
    },
    [session],
  );
}
