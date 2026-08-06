/**
 * The whole state library. ~60 lines, no dependencies, no framework.
 *
 * Plan §6 WP-08 names Zustand; the product owner's instruction for this wave is
 * "keep it small and explicit — no heavyweight state library". The surface below
 * is the subset of Zustand this application actually uses (`get` / `set` /
 * `subscribe`, immutable snapshots, shallow merge) with the semantics React's
 * `useSyncExternalStore` requires:
 *
 *   * `get()` returns a STABLE object identity until something changes, so a
 *     render-phase snapshot read cannot loop;
 *   * `set()` replaces the object (never mutates it) and notifies synchronously;
 *   * a listener added during a notification is not called for that notification,
 *     and a listener removed during one is not called at all.
 *
 * The React binding lives in the app (`apps/web/src/app/hooks.ts`), deliberately
 * NOT here: this package stays framework-free so the bridge-facing logic can be
 * unit-tested under vitest's node environment with no DOM and no React.
 */

export type Listener<T> = (state: T, previous: T) => void;
/** Detaches a previously registered listener. */
export type Unsubscribe = () => void;

/** A patch to merge, either a partial value or a function of the previous state. */
export type Updater<T> = Partial<T> | ((previous: T) => Partial<T>);

/** A minimal observable state container: read, shallow-merge, and subscribe. */
export interface Store<T extends object> {
  /** The current snapshot. Stable identity until the next `set`. */
  get(): T;
  /** Shallow-merge a patch (or the result of a function of the previous state). */
  set(updater: Updater<T>): T;
  /** Subscribe to every change. Returns the unsubscribe function. */
  subscribe(listener: Listener<T>): Unsubscribe;
  /**
   * Number of live listeners — used by tests and leak checks. A method, not a
   * getter, so `{...store, extra}` (how the stores below are composed) keeps
   * working instead of freezing a stale number.
   */
  listenerCount(): number;
}

/** Creates a framework-free store with immutable snapshots and synchronous notification. */
export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<Listener<T>>();

  return {
    get(): T {
      return state;
    },

    set(updater: Updater<T>): T {
      const patch = typeof updater === 'function' ? updater(state) : updater;
      // An empty patch is a no-op, not a re-render.
      let changed = false;
      for (const key of Object.keys(patch) as Array<keyof T>) {
        if (!Object.is(state[key], patch[key])) {
          changed = true;
          break;
        }
      }
      if (!changed) return state;

      const previous = state;
      state = { ...state, ...patch };
      // Snapshot the set: a listener may unsubscribe (or subscribe) inside the
      // notification without corrupting this pass.
      for (const listener of [...listeners]) {
        if (listeners.has(listener)) listener(state, previous);
      }
      return state;
    },

    subscribe(listener: Listener<T>): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    listenerCount(): number {
      return listeners.size;
    },
  };
}

/**
 * Reference-equality over one level of an object/array. The default comparator
 * for selectors that build a new object or array on every call.
 */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!Object.is(a[i], b[i])) return false;
    }
    return true;
  }

  const ka = Object.keys(a as Record<string, unknown>);
  const kb = Object.keys(b as Record<string, unknown>);
  if (ka.length !== kb.length) return false;
  for (const key of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false;
    }
  }
  return true;
}
