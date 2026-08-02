/**
 * How one feature is reached from another: the panel/hook seam.
 *
 * THE PROBLEM THIS EXISTS TO SOLVE. `features/registry.ts` is frozen and gives
 * every feature a slot, but nothing gives a feature a HANDLE on another one.
 * `PyMOLDesktopGUI` leaves 20-odd toolkit seams as `= None`
 * (`modules/pymol/_gui.py:13-40`) and Qt fills each of them with a bound method
 * of the main window (`pymol_qt_gui.py:878-897`: `settings_edit_all_dialog`,
 * `shortcut_menu_edit_dialog`, `edit_colors_dialog`, `scene_panel_menu_dialog`,
 * …). Here the menu bar is one feature and the dialogs are others, so the menu
 * leaf had nothing to call and rendered DISABLED — for four waves the parity
 * inventory recorded the same sentence against six different rows: "the panel
 * exists but there is no cross-feature hook registry to bind it".
 *
 * This module is that registry, and it lives in the shell rather than in
 * `features/menubar` deliberately: the shell is what mounts overlay slots, and
 * a registry inside the consumer would make every provider import its consumer.
 * A feature registers from its OWN directory —
 *
 *     import { registerMenuHook } from '../../shell/panelHooks';
 *     registerMenuHook('file_open', () => openMyDialog());
 *
 * — and `MenuBar` merges whatever is registered on top of the hooks it
 * implements itself, so a leaf becomes live the moment its owner lands. No
 * shared file is edited by two work packages.
 *
 * TWO PIECES, because opening a panel needs both:
 *
 *   1. `openPanel(id)` — an overlay slot is not mounted until it is open
 *      (`AppShell.OverlayLayer`), so "open the colours window" means "mount the
 *      slot" first.
 *   2. an INTENT queued against the mount. The slot is a `React.lazy` behind a
 *      `Suspense`: at the moment `openPanel` returns, the module has not been
 *      fetched, the component has not mounted and any event dispatched at it
 *      would land on nobody. `FeatureSlot` reports the mount here and the queue
 *      drains then — which is why `openPanel('builder', …)` can dispatch
 *      `tenmol:open-builder` and be sure the listener exists.
 */

import { createStore, type Store } from '@tenmol/stores';

export interface PanelsState {
  /** Overlay slot ids currently mounted by the shell. */
  open: readonly string[];
}

export type PanelsStore = Store<PanelsState>;

/** What a hook does. The argument list is a menu action's `args` (usually []). */
export type MenuHook = (args: unknown[]) => void | Promise<void>;

const store: PanelsStore = createStore<PanelsState>({ open: [] });

/** Slots whose component is mounted right now, reported by `FeatureSlot`. */
const mounted = new Set<string>();
/** Intents waiting for their slot to mount, in registration order. */
const pending = new Map<string, Array<() => void>>();
/** Hooks registered by features other than the menu bar. */
const hooks = new Map<string, MenuHook>();

const hookListeners = new Set<() => void>();
/** Identity-stable view of `hooks`; invalidated by `notify`. */
let snapshot: Readonly<Record<string, MenuHook>> | null = null;

export function panelsStore(): PanelsStore {
  return store;
}

export function isPanelOpen(id: string): boolean {
  return store.get().open.includes(id);
}

/**
 * Mount an overlay slot, and run `intent` once its component exists.
 *
 * Idempotent: opening an already-open panel does not remount it, and the intent
 * runs immediately in that case rather than waiting for a mount that already
 * happened.
 */
export function openPanel(id: string, intent?: () => void): void {
  if (!isPanelOpen(id)) store.set((state) => ({ open: [...state.open, id] }));
  if (!intent) return;
  if (mounted.has(id)) {
    intent();
    return;
  }
  const queue = pending.get(id);
  if (queue) queue.push(intent);
  else pending.set(id, [intent]);
}

export function closePanel(id: string): void {
  if (!isPanelOpen(id)) return;
  store.set((state) => ({ open: state.open.filter((x) => x !== id) }));
}

export function togglePanel(id: string): void {
  if (isPanelOpen(id)) closePanel(id);
  else openPanel(id);
}

/** `FeatureSlot` mounted a slot's component: drain everything waiting on it. */
export function panelMounted(id: string): void {
  mounted.add(id);
  const queue = pending.get(id);
  if (!queue) return;
  pending.delete(id);
  // A copy, because an intent may itself call `openPanel(id, …)`.
  for (const intent of [...queue]) intent();
}

export function panelUnmounted(id: string): void {
  mounted.delete(id);
}

export function isPanelMounted(id: string): boolean {
  return mounted.has(id);
}

/* ------------------------------------------------------------------ *
 * Menu hooks
 * ------------------------------------------------------------------ */

/**
 * Bind one of `_gui.py`'s `= None` seams. Returns an unregister function, so a
 * feature can register from an effect and clean up on unmount.
 *
 * Last registration wins, as `pymol_qt_gui.py`'s assignment to the attribute
 * does; re-registering the same name is how a hot reload stays correct.
 */
export function registerMenuHook(name: string, hook: MenuHook): () => void {
  hooks.set(name, hook);
  notify();
  return () => {
    if (hooks.get(name) === hook) {
      hooks.delete(name);
      notify();
    }
  };
}

/**
 * The registered hooks as a plain object.
 *
 * CACHED, and that is not an optimisation: this is a `useSyncExternalStore`
 * snapshot in `MenuBar`, and React compares snapshots with `Object.is`. A fresh
 * `Object.fromEntries` per call is a new identity every render and React loops
 * for ever ("The result of getSnapshot should be cached").
 */
export function menuHooks(): Readonly<Record<string, MenuHook>> {
  snapshot ??= Object.fromEntries(hooks);
  return snapshot;
}

export function hasMenuHook(name: string): boolean {
  return hooks.has(name);
}

/** Subscribe to registrations, so a mounted menu re-renders when one lands. */
export function subscribeMenuHooks(listener: () => void): () => void {
  hookListeners.add(listener);
  return () => hookListeners.delete(listener);
}

function notify(): void {
  snapshot = null;
  for (const listener of [...hookListeners]) if (hookListeners.has(listener)) listener();
}

/** Exported for tests only: forget every panel, intent and hook. */
export function resetPanelHooks(): void {
  store.set({ open: [] });
  mounted.clear();
  pending.clear();
  hooks.clear();
  notify();
}
