/**
 * The React binding for `@tenmol/stores`. Thirty lines of `useSyncExternalStore`
 * instead of a state library.
 *
 * `useSyncExternalStore` demands one thing of `getSnapshot`: calling it twice in
 * a row without a store change must return the SAME value, or React re-renders
 * forever. `createStore` guarantees a stable state identity between `set`s, and
 * the selector result is memoised against that identity plus an equality check,
 * so `useStore(store, (s) => s.rows.filter(...))` is safe even with an inline
 * selector.
 */

import { useCallback, useContext, useDebugValue, useRef, useSyncExternalStore } from 'react';
import type { Store } from '@tenmol/stores';
import { shallowEqual } from '@tenmol/stores';

import { SessionContext } from './BridgeProvider';
import type { Session } from './session';

/** The whole session: transport, stores and the three action helpers. */
export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession() must be used inside <BridgeProvider>');
  return session;
}

/** Subscribe to a slice of a store. */
export function useStore<T extends object, S>(
  store: Store<T>,
  selector: (state: T) => S,
  isEqual: (a: S, b: S) => boolean = Object.is,
): S {
  const cache = useRef<{ source: T; value: S } | null>(null);

  const getSnapshot = useCallback(() => {
    const source = store.get();
    const previous = cache.current;
    if (previous && previous.source === source) return previous.value;

    const value = selector(source);
    if (previous && isEqual(previous.value, value)) {
      // Same value, new source object: keep the old identity so React bails out.
      cache.current = { source, value: previous.value };
      return previous.value;
    }
    cache.current = { source, value };
    return value;
  }, [store, selector, isEqual]);

  const value = useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
  useDebugValue(value);
  return value;
}

/** `useStore` with the shallow comparator — for selectors returning arrays/objects. */
export function useShallowStore<T extends object, S>(
  store: Store<T>,
  selector: (state: T) => S,
): S {
  return useStore(store, selector, shallowEqual as (a: S, b: S) => boolean);
}

/** The entire state of a store. Cheap: the identity only changes on a real `set`. */
export function useStoreState<T extends object>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
