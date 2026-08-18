/**
 * The dialog window manager for area 10 (volume / properties / text editor /
 * advanced settings).
 *
 * A MODULE SINGLETON, like `app/session.ts` and for the same reason: the four
 * dialogs live in four different registry slots, all of which render
 * independently under `AppShell`'s `overlay` region, and they must agree about
 * what is open. A React context would have to be mounted above all four, and
 * the shell — which nobody in this work package owns — is the only place that
 * could do it.
 *
 * The key format is `<kind>` for singletons and `<kind>:<arg>` for the ones
 * PyMOL itself caches per object: `colorramping._volume_windows_qt` keeps ONE
 * volume panel per volume name (`packages/engine/modules/pymol/colorramping.py:170-179`), and
 * so does this.
 */

import { createStore, type Store } from '@tenmol/stores';
import { WINDOW_Z_FLOOR, nextWindowZ, topWindowZ } from '../../ui/windowZ';

/** The four dialog window kinds hosted in area 10. */
export const DIALOG_KINDS = ['volume', 'properties', 'texteditor', 'advanced-settings'] as const;
/** One of the four dialog kinds the manager can open. */
export type DialogKind = (typeof DIALOG_KINDS)[number];

/** Geometry, identity, and stacking state of one open floating dialog window. */
export interface DialogWindowSpec {
  key: string;
  kind: DialogKind;
  /** Volume object name for `volume`; unused elsewhere. */
  arg: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  minimised: boolean;
}

/** The full set of open dialog windows plus the current top z-index. */
export interface DialogsState {
  windows: readonly DialogWindowSpec[];
  /** Monotonic, so `raise` is a single `set`. */
  topZ: number;
}

/**
 * Default geometry per kind. The volume panel is 600x200 in Qt
 * (`VolumeEditorWidget.sizeHint`, `volume.py:93-94`) plus the button row; the
 * rest are sized to their content, not to Qt's, because Qt's are screen-sized
 * dialogs and this is a floating panel inside one window.
 */
const GEOMETRY: Record<DialogKind, { width: number; height: number }> = {
  volume: { width: 640, height: 300 },
  properties: { width: 560, height: 520 },
  texteditor: { width: 720, height: 520 },
  'advanced-settings': { width: 620, height: 520 },
};

const TITLES: Record<DialogKind, (arg: string) => string> = {
  // `_VolumePanel.__init__` — `name + ' - Volume Color Map Editor'` (volume.py:822).
  volume: (arg) => `${arg} - Volume Color Map Editor`,
  properties: () => 'Properties',
  texteditor: (arg) => (arg ? `${arg} - PyMOL Text Editor` : 'PyMOL Text Editor'),
  'advanced-settings': () => 'Advanced Settings',
};

/** Store of open dialog windows with open/close/raise/move/resize commands. */
export interface DialogsStore extends Store<DialogsState> {
  open(kind: DialogKind, arg?: string): string;
  close(key: string): void;
  raise(key: string): void;
  move(key: string, x: number, y: number): void;
  resize(key: string, width: number, height: number): void;
  toggleMinimised(key: string): void;
  isOpen(kind: DialogKind, arg?: string): boolean;
  windowsOfKind(kind: DialogKind): readonly DialogWindowSpec[];
}

/** The window key for a kind: `<kind>` for singletons, `<kind>:<arg>` per-arg. */
export function dialogKey(kind: DialogKind, arg = ''): string {
  return arg ? `${kind}:${arg}` : kind;
}

/** Build a fresh dialogs store with its own window list and z-index counter. */
export function createDialogsStore(): DialogsStore {
/*
 * STACKING. z-indices come from `ui/windowZ`, the ONE allocator every floating
 * window in the app shares — the newer `FloatingWindow` panels (builder,
 * colours, settings, …) and these dialog windows both draw from it, so a panel
 * and a dialog opened in the same session can never tie and stack by DOM order.
 * Both start from `WINDOW_Z_FLOOR = 30`, which clears the viewport HUD (10) and
 * the seqview Seq block (20): the floor was once 10, the first window opened at
 * 11 BELOW the sequence viewer, and the Seq block covered its title bar so
 * File/Save were unclickable (`DialogWindow` writes `zIndex` INLINE from this
 * number and inline wins over CSS). `topZ` mirrors the last z this store took;
 * the raise no-op below compares against the SHARED top so a dialog under a
 * `FloatingWindow` still lifts above it.
 */
const store = createStore<DialogsState>({ windows: [], topZ: WINDOW_Z_FLOOR });

  const patch = (key: string, fn: (w: DialogWindowSpec) => DialogWindowSpec) =>
    store.set((s) => ({ windows: s.windows.map((w) => (w.key === key ? fn(w) : w)) }));

  const api: DialogsStore = {
    ...store,

    open(kind, arg = ''): string {
      const key = dialogKey(kind, arg);
      const state = store.get();
      const z = nextWindowZ();
      const existing = state.windows.find((w) => w.key === key);
      if (existing) {
        // Cached per name, exactly like `_volume_windows_qt`: show and raise,
        // never a second instance.
        store.set({
          topZ: z,
          windows: state.windows.map((w) => (w.key === key ? { ...w, z, minimised: false } : w)),
        });
        return key;
      }
      const size = GEOMETRY[kind];
      // Cascade so two panels are never exactly on top of each other.
      const offset = state.windows.length * 24;
      store.set({
        topZ: z,
        windows: [
          ...state.windows,
          {
            key,
            kind,
            arg,
            title: TITLES[kind](arg),
            x: 80 + offset,
            y: 70 + offset,
            width: size.width,
            height: size.height,
            z,
            minimised: false,
          },
        ],
      });
      return key;
    },

    close(key): void {
      store.set((s) => ({ windows: s.windows.filter((w) => w.key !== key) }));
    },

    raise(key): void {
      const state = store.get();
      const window = state.windows.find((w) => w.key === key);
      // Already the top-most window across BOTH window systems — nothing to do.
      // Compared against the SHARED top (not this store's `topZ`) so a dialog
      // sitting under a `FloatingWindow` panel still lifts above it on raise.
      if (!window || window.z === topWindowZ()) return;
      const z = nextWindowZ();
      store.set({ topZ: z, windows: state.windows.map((w) => (w.key === key ? { ...w, z } : w)) });
    },

    move(key, x, y): void {
      patch(key, (w) => ({ ...w, x, y }));
    },

    resize(key, width, height): void {
      patch(key, (w) => ({ ...w, width, height }));
    },

    toggleMinimised(key): void {
      patch(key, (w) => ({ ...w, minimised: !w.minimised }));
    },

    isOpen(kind, arg = ''): boolean {
      const key = dialogKey(kind, arg);
      return store.get().windows.some((w) => w.key === key);
    },

    windowsOfKind(kind): readonly DialogWindowSpec[] {
      return store.get().windows.filter((w) => w.kind === kind);
    },
  };

  return api;
}

/** The one instance every dialogs slot shares. */
export const dialogsStore: DialogsStore = createDialogsStore();

/* ------------------------------------------------------------------ *
 * Who draws the windows
 * ------------------------------------------------------------------ */

/**
 * Four registry slots can draw these windows — `dialogs`, `volume`,
 * `properties`, `texteditor` — and the shell decides which of them is mounted.
 * `AppShell`'s overlay region now mounts a slot only while the user has toggled
 * it on, so "the volume slot hosts volume windows" is not a safe assumption:
 * a user who opens a volume panel from the `dialogs` launcher would get
 * nothing, because the component that would have drawn it is not mounted.
 *
 * So hosting is CLAIMED, not assigned. The first mounted slot to ask for a kind
 * draws it; the others draw nothing; when the holder unmounts the claim is
 * released and the next asker takes over. That makes the feature correct for
 * every subset of slots the shell chooses to mount, without this work package
 * reaching into `shell/AppShell.tsx`, which it does not own.
 */
type HostToken = symbol;

const hostClaims = new Map<DialogKind, HostToken>();
const hostListeners = new Set<() => void>();

function notifyHosts(): void {
  for (const listener of [...hostListeners]) listener();
}

/** Subscribe to host-claim changes; returns an unsubscribe function. */
export function subscribeHosts(listener: () => void): () => void {
  hostListeners.add(listener);
  return () => {
    hostListeners.delete(listener);
  };
}

/** True if `token` now holds (or already held) the claim for `kind`. */
export function claimHost(kind: DialogKind, token: HostToken): boolean {
  const current = hostClaims.get(kind);
  if (current === token) return true;
  if (current !== undefined) return false;
  hostClaims.set(kind, token);
  notifyHosts();
  return true;
}

/** Release `token`'s claim on `kind` so the next asker can host it. */
export function releaseHost(kind: DialogKind, token: HostToken): void {
  if (hostClaims.get(kind) !== token) return;
  hostClaims.delete(kind);
  notifyHosts();
}

/** True if `token` currently holds the host claim for `kind`. */
export function isHost(kind: DialogKind, token: HostToken): boolean {
  return hostClaims.get(kind) === token;
}
