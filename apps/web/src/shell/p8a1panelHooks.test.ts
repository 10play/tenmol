/**
 * The cross-feature seam (`shell/panelHooks.ts`).
 *
 * Six parity rows in area 1 said the same thing for four waves — "the panel
 * exists but there is no cross-feature hook registry to bind it" — so the rules
 * that make the binding WORK are worth pinning, and only two of them are
 * obvious:
 *
 *   * an intent queued against a slot that is not mounted yet must survive
 *     until it mounts (the slot is a `React.lazy`; at click time the module has
 *     not even been fetched), and
 *   * `menuHooks()` must be identity-stable, because `MenuBar` reads it through
 *     `useSyncExternalStore` and React compares snapshots with `Object.is`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  closePanel,
  hasMenuHook,
  isPanelMounted,
  isPanelOpen,
  menuHooks,
  openPanel,
  panelMounted,
  panelUnmounted,
  panelsStore,
  registerMenuHook,
  resetPanelHooks,
  subscribeMenuHooks,
  togglePanel,
} from './panelHooks';

afterEach(() => resetPanelHooks());

describe('opening a panel', () => {
  it('adds the slot once, and toggling removes it', () => {
    openPanel('colors');
    openPanel('colors');
    expect(panelsStore().get().open).toEqual(['colors']);
    expect(isPanelOpen('colors')).toBe(true);

    togglePanel('colors');
    expect(isPanelOpen('colors')).toBe(false);
    togglePanel('colors');
    expect(panelsStore().get().open).toEqual(['colors']);
    closePanel('colors');
    expect(panelsStore().get().open).toEqual([]);
  });

  it('notifies subscribers so the shell re-renders', () => {
    const seen: number[] = [];
    const stop = panelsStore().subscribe((state) => seen.push(state.open.length));
    openPanel('dialogs');
    closePanel('dialogs');
    stop();
    expect(seen).toEqual([1, 0]);
  });
});

describe('the mount edge', () => {
  it('holds an intent until the slot mounts, then runs it exactly once', () => {
    const intent = vi.fn();
    openPanel('dialogs', intent);
    // The slot is lazy: nothing has mounted, so nothing has run.
    expect(intent).not.toHaveBeenCalled();
    expect(isPanelMounted('dialogs')).toBe(false);

    panelMounted('dialogs');
    expect(intent).toHaveBeenCalledTimes(1);

    // A second mount (StrictMode remounts, a reconnect) must not replay it.
    panelUnmounted('dialogs');
    panelMounted('dialogs');
    expect(intent).toHaveBeenCalledTimes(1);
  });

  it('runs immediately when the slot is already mounted', () => {
    panelMounted('properties');
    const intent = vi.fn();
    openPanel('properties', intent);
    expect(intent).toHaveBeenCalledTimes(1);
  });

  it('keeps queued intents in order and runs them all', () => {
    const order: string[] = [];
    openPanel('dialogs', () => order.push('first'));
    openPanel('dialogs', () => order.push('second'));
    panelMounted('dialogs');
    expect(order).toEqual(['first', 'second']);
  });

  it('lets an intent open another panel without losing the queue', () => {
    const inner = vi.fn();
    openPanel('dialogs', () => openPanel('builder', inner));
    panelMounted('dialogs');
    expect(inner).not.toHaveBeenCalled();
    panelMounted('builder');
    expect(inner).toHaveBeenCalledTimes(1);
  });
});

describe('the hook registry', () => {
  it('registers, overrides and unregisters', () => {
    const first = vi.fn();
    const second = vi.fn();
    const off = registerMenuHook('file_open', first);
    expect(hasMenuHook('file_open')).toBe(true);
    menuHooks()['file_open']?.([]);
    expect(first).toHaveBeenCalledTimes(1);

    registerMenuHook('file_open', second);
    menuHooks()['file_open']?.([]);
    expect(second).toHaveBeenCalledTimes(1);

    // The stale unregister must not remove the newer binding.
    off();
    expect(hasMenuHook('file_open')).toBe(true);
  });

  it('returns an identity-stable snapshot until something changes', () => {
    const a = menuHooks();
    expect(menuHooks()).toBe(a);
    const off = registerMenuHook('file_run', vi.fn());
    const b = menuHooks();
    expect(b).not.toBe(a);
    expect(menuHooks()).toBe(b);
    off();
    expect(menuHooks()).not.toBe(b);
  });

  it('tells subscribers about every registration', () => {
    const listener = vi.fn();
    const stop = subscribeMenuHooks(listener);
    const off = registerMenuHook('log_open', vi.fn());
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    registerMenuHook('log_open', vi.fn());
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
