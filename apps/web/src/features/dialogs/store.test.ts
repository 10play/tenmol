/**
 * The dialog window manager.
 *
 * The one behaviour that is not generic window bookkeeping is the per-name
 * cache: `colorramping.volume_panel` keeps ONE panel per volume name in
 * `_volume_windows_qt` and calls `show()` + `raise_()` on the second request
 * (`packages/engine/modules/pymol/colorramping.py:170-190`). Opening the same volume twice must
 * therefore raise, not duplicate.
 */

import { describe, expect, it } from 'vitest';
import { createDialogsStore, dialogKey } from './store';

describe('dialogKey', () => {
  it('is the kind alone for singletons and kind:arg for per-object panels', () => {
    expect(dialogKey('properties')).toBe('properties');
    expect(dialogKey('volume', 'vol')).toBe('volume:vol');
  });
});

describe('open', () => {
  it('adds one window and titles it as Qt does', () => {
    const store = createDialogsStore();
    store.open('volume', 'vol');
    const windows = store.get().windows;
    expect(windows.length).toBe(1);
    expect(windows[0]!.title).toBe('vol - Volume Color Map Editor');
    expect(windows[0]!.arg).toBe('vol');
  });

  it('caches one panel per volume NAME and raises instead of duplicating', () => {
    const store = createDialogsStore();
    store.open('volume', 'a');
    store.open('volume', 'b');
    const zBefore = store.get().windows.find((w) => w.key === 'volume:a')!.z;
    store.open('volume', 'a');
    const windows = store.get().windows;
    expect(windows.length).toBe(2);
    expect(windows.find((w) => w.key === 'volume:a')!.z).toBeGreaterThan(zBefore);
  });

  it('un-shades a minimised window when re-opened', () => {
    const store = createDialogsStore();
    const key = store.open('properties');
    store.toggleMinimised(key);
    expect(store.get().windows[0]!.minimised).toBe(true);
    store.open('properties');
    expect(store.get().windows[0]!.minimised).toBe(false);
  });

  it('cascades so two panels are never exactly on top of each other', () => {
    const store = createDialogsStore();
    store.open('properties');
    store.open('texteditor');
    const [a, b] = store.get().windows;
    expect(b!.x).toBeGreaterThan(a!.x);
    expect(b!.y).toBeGreaterThan(a!.y);
  });
});

describe('raise / move / resize / close', () => {
  it('raise puts a window on top exactly once', () => {
    const store = createDialogsStore();
    store.open('properties');
    const top = store.open('texteditor');
    const before = store.get();
    store.raise(top); // already on top: no state change at all
    expect(store.get()).toBe(before);
    store.raise('properties');
    const windows = store.get().windows;
    expect(windows.find((w) => w.key === 'properties')!.z).toBeGreaterThan(
      windows.find((w) => w.key === 'texteditor')!.z,
    );
  });

  it('moves and resizes only the addressed window', () => {
    const store = createDialogsStore();
    store.open('properties');
    store.open('texteditor');
    store.move('properties', 11, 22);
    store.resize('properties', 333, 444);
    const props = store.get().windows.find((w) => w.key === 'properties')!;
    const other = store.get().windows.find((w) => w.key === 'texteditor')!;
    expect(props).toMatchObject({ x: 11, y: 22, width: 333, height: 444 });
    expect(other.x).not.toBe(11);
  });

  it('close removes it and isOpen reports honestly', () => {
    const store = createDialogsStore();
    store.open('volume', 'vol');
    expect(store.isOpen('volume', 'vol')).toBe(true);
    store.close('volume:vol');
    expect(store.isOpen('volume', 'vol')).toBe(false);
    expect(store.get().windows.length).toBe(0);
  });

  it('windowsOfKind filters', () => {
    const store = createDialogsStore();
    store.open('volume', 'a');
    store.open('volume', 'b');
    store.open('properties');
    expect(store.windowsOfKind('volume').map((w) => w.arg)).toEqual(['a', 'b']);
    expect(store.windowsOfKind('advanced-settings')).toEqual([]);
  });
});

describe('subscribers', () => {
  it('notifies on every real change and never on a no-op', () => {
    const store = createDialogsStore();
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.open('properties');
    expect(calls).toBe(1);
    store.raise('properties'); // already top
    expect(calls).toBe(1);
    store.move('properties', 5, 5);
    expect(calls).toBe(2);
    off();
    store.close('properties');
    expect(calls).toBe(2);
  });
});
