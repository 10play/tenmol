/**
 * `toggle_ext_window_dockable`, transcribed and checked.
 *
 * Parity inventory row 54. The Qt method is four lines whose meaning is carried
 * entirely by "is there a custom title bar widget installed", which is the
 * opposite of what it reads like — so it is worth a table.
 *
 * The backend half (that `pymol.gui.ext_hide`/`ext_show` are PRINTED no-ops and
 * that `gui` is not addressable over `{t:'call'}`) is measured in
 * `bridge/tests/test_wf_shell.py`.
 */

import { describe, expect, it } from 'vitest';

import {
  DOCK_STORAGE_KEY,
  EXT_GUI_DOCK_INITIAL,
  dockModifier,
  isDockShortcut,
  isSideDock,
  loadDock,
  saveDock,
  setArea,
  toggleDockable,
  toggleVisible,
  type ExtGuiDockState,
  type StorageLike,
} from './extGuiDock';

const key = (ev: Partial<KeyboardEvent> & { key: string }) =>
  isDockShortcut({
    key: ev.key,
    ctrlKey: ev.ctrlKey ?? false,
    metaKey: ev.metaKey ?? false,
    altKey: ev.altKey ?? false,
    shiftKey: ev.shiftKey ?? false,
  });

function memoryStorage(): StorageLike & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe('the dockable toggle', () => {
  it('starts docked with the title bar REPLACED, as options.external_gui does', () => {
    // `if options.external_gui: dockWidget.setTitleBarWidget(QtWidgets.QWidget())`
    expect(EXT_GUI_DOCK_INITIAL).toEqual({
      visible: true,
      floating: false,
      titleBar: false,
      area: 'bottom',
    });
  });

  it('Ctrl+E floats it with a title bar, and again re-docks it without one', () => {
    const floated = toggleDockable(EXT_GUI_DOCK_INITIAL);
    expect(floated).toMatchObject({ titleBar: true, floating: true, visible: true });
    const redocked = toggleDockable(floated);
    expect(redocked).toMatchObject({ titleBar: false, floating: false, visible: true });
  });

  it('the frame double click passes neverfloat=True: title bar, still docked', () => {
    // `ExtGuiFrame.mouseDoubleClickEvent` -> `toggle_ext_window_dockable(True)`.
    const grabbable = toggleDockable(EXT_GUI_DOCK_INITIAL, true);
    expect(grabbable).toMatchObject({ titleBar: true, floating: false });
  });

  it('un-hides whatever it does, because the Qt method ends in .show()', () => {
    const hidden: ExtGuiDockState = { ...EXT_GUI_DOCK_INITIAL, visible: false };
    expect(toggleDockable(hidden).visible).toBe(true);
    expect(toggleDockable(hidden, true).visible).toBe(true);
  });

  it('Visible is a separate axis (QDockWidget.toggleViewAction)', () => {
    expect(toggleVisible(EXT_GUI_DOCK_INITIAL).visible).toBe(false);
    expect(toggleVisible(toggleVisible(EXT_GUI_DOCK_INITIAL))).toEqual(EXT_GUI_DOCK_INITIAL);
  });
});

describe('dock area', () => {
  it('re-docks a floating panel', () => {
    const floated = toggleDockable(EXT_GUI_DOCK_INITIAL);
    const docked = setArea(floated, 'left');
    expect(docked).toMatchObject({ area: 'left', floating: false, visible: true });
  });

  it('treats left and right as the BottomToTop side dock, bottom as normal', () => {
    // `dockLocationChanged`: Left/Right flips the layout direction and drops the
    // quickbutton stretch (pymol_qt_gui.py:196-204).
    expect(isSideDock(setArea(EXT_GUI_DOCK_INITIAL, 'left'))).toBe(true);
    expect(isSideDock(setArea(EXT_GUI_DOCK_INITIAL, 'right'))).toBe(true);
    expect(isSideDock(EXT_GUI_DOCK_INITIAL)).toBe(false);
    // A floating panel is in no dock area at all.
    expect(isSideDock({ ...EXT_GUI_DOCK_INITIAL, area: 'left', floating: true })).toBe(false);
  });

  it('names the class modifier the stylesheet keys off', () => {
    expect(dockModifier(EXT_GUI_DOCK_INITIAL)).toBe('bottom');
    expect(dockModifier(setArea(EXT_GUI_DOCK_INITIAL, 'right'))).toBe('right');
    expect(dockModifier(toggleDockable(EXT_GUI_DOCK_INITIAL))).toBe('float');
  });
});

describe('persistence', () => {
  it('round-trips through its own key, not the shared UI store', () => {
    const storage = memoryStorage();
    const state = setArea(toggleDockable(EXT_GUI_DOCK_INITIAL), 'right');
    saveDock(storage, state);
    expect(Object.keys(storage.data)).toEqual([DOCK_STORAGE_KEY]);
    expect(loadDock(storage)).toEqual(state);
  });

  it('falls back to the initial state for junk, and never throws', () => {
    const storage = memoryStorage();
    expect(loadDock(null)).toEqual(EXT_GUI_DOCK_INITIAL);
    expect(loadDock(storage)).toEqual(EXT_GUI_DOCK_INITIAL);
    storage.data[DOCK_STORAGE_KEY] = 'not json';
    expect(loadDock(storage)).toEqual(EXT_GUI_DOCK_INITIAL);
    storage.data[DOCK_STORAGE_KEY] = '{"area":"ceiling","visible":"yes"}';
    expect(loadDock(storage)).toEqual(EXT_GUI_DOCK_INITIAL);
    // A storage that refuses to write must not take the app down with it.
    expect(() =>
      saveDock(
        {
          getItem: () => null,
          setItem: () => {
            throw new Error('QuotaExceededError');
          },
        },
        EXT_GUI_DOCK_INITIAL,
      ),
    ).not.toThrow();
  });
});

describe('the Ctrl+E shortcut', () => {
  it('matches Ctrl+E and Cmd+E, and nothing else', () => {
    expect(key({ key: 'e', ctrlKey: true })).toBe(true);
    expect(key({ key: 'E', ctrlKey: true })).toBe(true);
    // Qt maps Ctrl+E to Cmd+E on macOS.
    expect(key({ key: 'e', metaKey: true })).toBe(true);

    expect(key({ key: 'e' })).toBe(false);
    expect(key({ key: 'e', ctrlKey: true, shiftKey: true })).toBe(false);
    expect(key({ key: 'e', ctrlKey: true, altKey: true })).toBe(false);
    expect(key({ key: 'o', ctrlKey: true })).toBe(false);
  });
});
