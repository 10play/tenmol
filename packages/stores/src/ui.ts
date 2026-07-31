/**
 * Local-only UI state: panel geometry, fonts, "don't ask again".
 *
 * This is the ONE store that is allowed to be optimistic, because none of it is
 * PyMOL state — nothing here round-trips. Everything that IS PyMOL state (a
 * setting, an object's visibility, the view matrix) goes through a `cmd.*` call
 * and comes back on a poll or a topic.
 *
 * Persisted to `localStorage` under a single key, best-effort: a private window,
 * a full quota or a disabled storage API must degrade to "settings do not stick",
 * never to a crash.
 */

import { createStore, type Store } from './createStore';

export interface UiState {
  /** `internal_gui_width` (default 220, `layer1/Ortho.h:24`). */
  panelWidth: number;
  /** Height of the External GUI dock (feedback + command line). */
  consoleHeight: number;
  /** `internal_gui` — the whole right-hand column. */
  internalGui: boolean;
  /** Console font size in px; PyMOL's own is user-settable too. */
  consoleFontSize: number;
  /** Scroll the feedback pane to the bottom on new output while already there. */
  followOutput: boolean;
  /** Show the client's own echo of button-issued commands in the scrollback. */
  echoActions: boolean;
  /** Command history, newest first, slot 0 = scratch (see useCommandHistory). */
  history: readonly string[];
}

const STORAGE_KEY = 'tenmol.ui.v1';

export const UI_DEFAULTS: UiState = {
  panelWidth: 220,
  consoleHeight: 210,
  internalGui: true,
  consoleFontSize: 11.5,
  followOutput: true,
  echoActions: true,
  history: [],
};

export interface UiStore extends Store<UiState> {
  reset(): void;
}

export function createUiStore(storage: StorageLike | null = defaultStorage()): UiStore {
  const store = createStore<UiState>({ ...UI_DEFAULTS, ...load(storage) });

  store.subscribe((state) => save(storage, state));

  return {
    ...store,
    reset() {
      store.set({ ...UI_DEFAULTS });
    },
  };
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    const storage = (globalThis as { localStorage?: StorageLike }).localStorage;
    return storage ?? null;
  } catch {
    return null; // storage disabled by policy
  }
}

function load(storage: StorageLike | null): Partial<UiState> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Partial<UiState> = {};
    const source = parsed as Record<string, unknown>;
    for (const key of Object.keys(UI_DEFAULTS) as Array<keyof UiState>) {
      const value = source[key];
      if (typeof value === typeof UI_DEFAULTS[key]) {
        (out as Record<string, unknown>)[key] = value;
      } else if (key === 'history' && Array.isArray(value)) {
        out.history = value.filter((v): v is string => typeof v === 'string');
      }
    }
    return out;
  } catch {
    return {};
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function save(storage: StorageLike | null, state: UiState): void {
  if (!storage) return;
  // Coalesce: a splitter drag sets state on every pointermove.
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* quota, private mode, disabled storage: settings simply do not stick */
    }
  }, 250);
}
