/**
 * The React binding for `dialogsStore`.
 *
 * `app/hooks.ts` already has a general `useStore`, but it needs `useSession()`
 * only for its siblings — this store is a module singleton with no session in
 * it, and the four slots that read it are mounted independently. A little
 * `useSyncExternalStore` keeps the dependency direction honest.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  claimHost,
  dialogsStore,
  isHost,
  releaseHost,
  subscribeHosts,
  type DialogKind,
  type DialogWindowSpec,
} from './store';

/** Subscribe to the open dialog windows, optionally filtered to one kind. */
export function useDialogWindows(kind?: DialogKind): readonly DialogWindowSpec[] {
  const windows = useSyncExternalStore(
    dialogsStore.subscribe,
    () => dialogsStore.get().windows,
    () => dialogsStore.get().windows,
  );
  // `filter` allocates, but only when `windows` changed — the snapshot itself
  // is stable, which is the invariant `useSyncExternalStore` actually demands.
  return kind ? windows.filter((w) => w.kind === kind) : windows;
}

/**
 * "Am I the component that draws windows of these kinds?"
 *
 * See `store.ts` for why hosting is claimed rather than assigned: the shell
 * mounts overlay slots on demand, so any one of them may be absent.
 *
 * Returns the subset of `kinds` this component owns. StrictMode's double mount
 * is safe — the claim is keyed by a token that is stable for the component
 * instance, and the effect releases it on unmount.
 */
export function useWindowHost(kinds: readonly DialogKind[]): readonly DialogKind[] {
  const token = useMemo(() => Symbol('dialog-host'), []);
  const [, bump] = useState(0);
  // A literal array at every call site, so its identity changes on every render
  // while its contents never do. Keying the effect on the CONTENTS is what stops
  // the claim being released and re-taken once per render.
  const key = kinds.join(',');
  const list = useMemo(() => key.split(',') as DialogKind[], [key]);

  useEffect(() => {
    for (const kind of list) claimHost(kind, token);
    bump((n) => n + 1);
    const off = subscribeHosts(() => bump((n) => n + 1));
    return () => {
      off();
      for (const kind of list) releaseHost(kind, token);
    };
  }, [token, list]);

  return list.filter((kind) => isHost(kind, token));
}

/** The windows this component is responsible for drawing. */
export function useHostedWindows(kinds: readonly DialogKind[]): readonly DialogWindowSpec[] {
  const owned = useWindowHost(kinds);
  const windows = useDialogWindows();
  return windows.filter((w) => owned.includes(w.kind));
}
