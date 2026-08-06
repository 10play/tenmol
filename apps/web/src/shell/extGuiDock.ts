/**
 * The External GUI dock, as a state machine.
 *
 * Parity inventory row 54. The Qt original is a `QDockWidget` whose "dockable"
 * toggle is four lines that read like a puzzle
 * (`packages/engine/modules/pmg_qt/pymol_qt_gui.py:457-467`):
 *
 *     if dockWidget.titleBarWidget() is None:   # the REAL title bar is showing
 *         tbw = QtWidgets.QWidget()             # ...replace it with an empty one
 *     else:
 *         tbw = None                            # ...or take the empty one away
 *     dockWidget.setFloating(tbw is None and not neverfloat)
 *     dockWidget.setTitleBarWidget(tbw)
 *     dockWidget.show()
 *
 * So it is a TWO-state toggle, not four:
 *
 *     docked, no title bar   <--Ctrl+E-->   floating, with a title bar
 *                            <--dbl-click-> docked, with a title bar
 *
 * and `.show()` at the end means either transition also un-hides it. Startup is
 * "docked, no title bar" when `options.external_gui`, and hidden otherwise
 * (`:186-191`).
 *
 * MEASURED (`packages/bridge/tests/test_wf_shell.py`): the bridge reports
 * `options.external_gui == 0` and `options.ext_y == 168`. `external_gui` is
 * forced off by `engine.py` because PyMOL's own external GUI is a Tk/Qt window
 * — the web client IS the external GUI — so the option is NOT read as "start
 * hidden". The dock is client state, persisted here.
 *
 * `pymol.gui.ext_hide()` / `ext_show()` stay callable and are PRINTED no-ops
 * ("ignoring gui.ext_hide"), because `tenmol_bridge/shims.py` makes
 * `gui.get_qtwindow()` return a `BridgeWindow` and PyMOL takes the
 * "a Qt window exists" branch (`packages/engine/modules/pymol/gui.py:42-64`). They are not
 * reachable over `{t:'call'}`: `gui` is not in `policy/base.py: DEFAULT_ROOTS`.
 * Reported upstream; the browser has no use for them.
 */

/**
 * Where a docked panel sits.
 *
 * Qt adds it to `TopDockWidgetArea`. The shell docks it at the BOTTOM instead,
 * on purpose: the in-viewport prompt and scrollback it duplicates are drawn at
 * the bottom of the scene (`OrthoDrawText`, `packages/engine/layer1/Ortho.cpp:1623-1693`).
 * `left`/`right` reproduce Qt's `dockLocationChanged` re-orientation.
 */
export type DockArea = 'bottom' | 'left' | 'right';

/** The External GUI dock's position and visibility, mirroring `QDockWidget`. */
export interface ExtGuiDockState {
  /** `QDockWidget.isVisible()` — the menu's `Visible` checkbox. */
  visible: boolean;
  /** `QDockWidget.isFloating()`. */
  floating: boolean;
  /** True when the REAL title bar is showing (`titleBarWidget() is None`). */
  titleBar: boolean;
  area: DockArea;
}

/** `options.external_gui` true: docked, title bar replaced by an empty widget. */
export const EXT_GUI_DOCK_INITIAL: ExtGuiDockState = {
  visible: true,
  floating: false,
  titleBar: false,
  area: 'bottom',
};

/**
 * `toggle_ext_window_dockable`, transcribed.
 *
 * @param neverFloat the `ExtGuiFrame` double click passes `True`; the Ctrl+E
 *   menu action passes nothing, so it floats.
 */
export function toggleDockable(state: ExtGuiDockState, neverFloat = false): ExtGuiDockState {
  const titleBar = !state.titleBar;
  return {
    ...state,
    titleBar,
    floating: titleBar && !neverFloat,
    // `dockWidget.show()` is unconditional at the end of the Qt method.
    visible: true,
  };
}

/** The `Visible` item — `QDockWidget.toggleViewAction()`. */
export function toggleVisible(state: ExtGuiDockState): ExtGuiDockState {
  return { ...state, visible: !state.visible };
}

/** Moving a docked panel. Floating panels have no area, so this re-docks. */
export function setArea(state: ExtGuiDockState, area: DockArea): ExtGuiDockState {
  return { ...state, area, floating: false, visible: true };
}

/**
 * `dockLocationChanged`: Left/Right flips the box layout to `BottomToTop` and
 * takes the quickbutton stretch out (`pymol_qt_gui.py:196-204`).
 *
 * In the DOM the console and the quickbutton column are siblings in that order,
 * so `BottomToTop` is `flex-direction: column-reverse` — which puts the
 * quickbuttons ABOVE the console, exactly as Qt does.
 */
export function isSideDock(state: ExtGuiDockState): boolean {
  return !state.floating && (state.area === 'left' || state.area === 'right');
}

/** The class suffix the stylesheet keys off. */
export function dockModifier(state: ExtGuiDockState): string {
  if (state.floating) return 'float';
  return state.area;
}

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

/** The minimal `localStorage` surface the dock persistence needs. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Its own key, not `tenmol.ui.v1`.
 *
 * `packages/stores/src/ui.ts` is shared and its `UiState` has no dock fields;
 * adding them there would be a cross-package edit for state nothing outside the
 * shell reads. Best-effort, like the UI store: a private window or a full quota
 * must degrade to "the dock does not remember", never to a crash.
 */
export const DOCK_STORAGE_KEY = 'tenmol.shell.extgui.v1';

const AREAS: readonly DockArea[] = ['bottom', 'left', 'right'];

/** Read the persisted dock state, falling back to the initial state on any fault. */
export function loadDock(storage: StorageLike | null): ExtGuiDockState {
  if (!storage) return EXT_GUI_DOCK_INITIAL;
  try {
    const raw = storage.getItem(DOCK_STORAGE_KEY);
    if (!raw) return EXT_GUI_DOCK_INITIAL;
    const parsed = JSON.parse(raw) as Partial<ExtGuiDockState> | null;
    if (typeof parsed !== 'object' || parsed === null) return EXT_GUI_DOCK_INITIAL;
    return {
      visible: typeof parsed.visible === 'boolean' ? parsed.visible : EXT_GUI_DOCK_INITIAL.visible,
      floating:
        typeof parsed.floating === 'boolean' ? parsed.floating : EXT_GUI_DOCK_INITIAL.floating,
      titleBar:
        typeof parsed.titleBar === 'boolean' ? parsed.titleBar : EXT_GUI_DOCK_INITIAL.titleBar,
      area: AREAS.includes(parsed.area as DockArea)
        ? (parsed.area as DockArea)
        : EXT_GUI_DOCK_INITIAL.area,
    };
  } catch {
    return EXT_GUI_DOCK_INITIAL;
  }
}

/** Persist the dock state best-effort; storage failures are swallowed. */
export function saveDock(storage: StorageLike | null, state: ExtGuiDockState): void {
  if (!storage) return;
  try {
    storage.setItem(DOCK_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota, private mode, disabled storage: the dock simply does not stick */
  }
}

/**
 * `Ctrl+E` — the window-level `QShortcut` bound to `toggle_ext_window_dockable`
 * (`pymol_qt_gui.py:379-380`).
 *
 * A window-level Qt shortcut fires whatever has focus, so this does too; the
 * shell listens in the CAPTURE phase and calls `preventDefault()`, which is
 * what stops `features/keyboard` forwarding the same keystroke to PyMOL (it
 * returns early on `ev.defaultPrevented`).
 *
 * `metaKey` counts because Qt maps `Ctrl+E` to Cmd+E on macOS.
 */
export function isDockShortcut(ev: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  return (ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey && ev.key.toLowerCase() === 'e';
}
