/**
 * The window.
 *
 * Layout is PyMOL's, not a web app's. Qt PyMOL has no splitters: the main window
 * is a `QMainWindow` with the GL widget as the central widget and the External
 * GUI as a dock (`packages/engine/modules/pmg_qt/pymol_qt_gui.py:184-193`). Everything on the
 * right — object panel, mouse-mode block, movie controls — is not Qt at all:
 * PyMOL draws it itself inside the GL viewport as 2D `Block`s stacked bottom-up
 * by `OrthoLayoutPanel()` (`packages/engine/layer1/Ortho.cpp:2261-2340`):
 *
 *      Executive (object panel)   <- fills the remaining height
 *      Wizard                     <- only when a wizard is active
 *      ButMode (mouse mode)       <- 40px, or 124px with mouse_grid
 *      Control (movie buttons)    <- 20px
 *
 * Here those blocks are real DOM in a right-hand column of width
 * `internal_gui_width` (default 220, `packages/engine/layer1/Ortho.h:24`), and the whole column
 * disappears when `internal_gui` is 0. Every child comes from the feature
 * registry, so this file never needs to change as features land. The DOM order
 * of the column is pinned by CSS `order` from `INTERNAL_GUI_ORDER`, because the
 * ButMode block is portalled in by `features/shortcuts` and would otherwise land
 * below the Control bar — upside down relative to `OrthoLayoutPanel`.
 *
 * The External GUI is docked at the BOTTOM rather than Qt's default top: the
 * in-viewport prompt and scrollback it duplicates are drawn at the bottom of the
 * scene (`OrthoDrawText`, `packages/engine/layer1/Ortho.cpp:1623-1693`). Its dockable/visible
 * state machine is `shell/extGuiDock.ts` and is a transcription of
 * `toggle_ext_window_dockable`, Ctrl+E and all.
 *
 * THE ONE VALUE THE SHELL WRITES TO `internal_gui` IS 0. MEASURED
 * (`packages/bridge/tests/test_wf_shell.py`) — with `internal_gui 1` and the default
 * width, an 800x600 window reports a 580x600 scene, and every mouse coordinate
 * the browser forwards is then wrong by 220 px. The column is OUR DOM; PyMOL's
 * own copy of it must stay off. The client toggle therefore never writes the
 * setting at all, and a non-zero value arriving FROM PyMOL (someone typed `set
 * internal_gui, 1`) turns our column on and is pushed straight back to 0 — see
 * `shellSettingWriteBacks`, and note that the damage it prevents is delayed:
 * MEASURED, the write changes nothing until the next canvas resize.
 * `internal_gui_width` IS written back as-is, so a `.pse` and a headless
 * `pymol -c` see the width the browser is showing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession, useStore } from '../app';
import type { Session } from '../app';
import { FeatureSlot } from './FeatureSlot';
import { StatusBar } from './StatusBar';
import { ConnectionOverlay } from './ConnectionOverlay';
import { UNDECLARED_FEATURES, isInstalled, slotsForRegion } from '../features/registry';
import {
  GUTTER_INITIAL,
  ORTHO,
  adoptShellSettings,
  clampInternalGuiWidth,
  gutterClick,
  gutterDrag,
  internalGuiOrder,
  shellSettingWriteBacks,
  windowTitle,
  type GutterState,
  type ShellSettings,
} from './orthoPanel';
import { panelsStore, togglePanel } from './panelHooks';
import {
  AppWindow,
  Blocks,
  Box,
  Cpu,
  FolderOpen,
  Palette,
  Puzzle,
  Settings,
  SlidersHorizontal,
  SquarePen,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { Button, IconButton, ToggleButton, ThemeToggle } from '../ui';

/** Lucide icons for the overlay-launcher panels, keyed by feature slot id. */
const LAUNCHER_ICONS: Record<string, LucideIcon> = {
  settings: Settings,
  files: FolderOpen,
  dialogs: AppWindow,
  builder: Blocks,
  colors: Palette,
  volume: Box,
  properties: SlidersHorizontal,
  texteditor: SquarePen,
  compute: Cpu,
  'plugin-manager': Puzzle,
  apbs: Zap,
};
import { SESSION_FILE_INDEX, getSettingsTap } from './settingsTap';
import {
  dockModifier,
  isDockShortcut,
  isSideDock,
  loadDock,
  saveDock,
  setArea,
  toggleDockable,
  toggleVisible,
  type ExtGuiDockState,
} from './extGuiDock';
// shell.css is imported into the `legacy` cascade layer via styles/legacy.css
// (see main.tsx), so the modern theme's Tailwind utilities can win over it.

/** How often the shell re-reads the three PyMOL values it mirrors. */
const SHELL_POLL_MS = 1000;

export function AppShell() {
  const session = useSession();
  const ui = session.stores.ui;
  const panelWidth = useStore(ui, (s) => s.panelWidth);
  const consoleHeight = useStore(ui, (s) => s.consoleHeight);
  const internalGui = useStore(ui, (s) => s.internalGui);
  const rootRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  useOrthoStackOrder(columnRef, internalGui);

  const [dock, setDock] = useState<ExtGuiDockState>(() => loadDock(browserStorage()));
  useEffect(() => saveDock(browserStorage(), dock), [dock]);

  useShellSettings(session);
  useWindowTitle(session);

  /* ---- the control-bar gutter (parity row 103) ---------------------- */

  // `I->SaveWidth` / `I->LastClickTime` live outside React state on purpose:
  // a pointerdown must read the PREVIOUS click time synchronously, and a state
  // update scheduled by the previous click has not necessarily flushed.
  const gutter = useRef<GutterState>({ ...GUTTER_INITIAL, width: panelWidth });

  const applyWidth = useCallback(
    (width: number, write: boolean) => {
      gutter.current.width = width;
      ui.set({ panelWidth: width });
      if (write) {
        // Mirror it outward. Inert while `internal_gui` is 0 — MEASURED: the
        // scene rectangle stays 800x600 at every width — but it is what keeps a
        // saved session and a headless CLI agreeing with the browser.
        void session.call('cmd.set', ['internal_gui_width', width]).catch(() => undefined);
      }
    },
    [session, ui],
  );

  /** The width the pointer went down on, so a click that moved nothing writes nothing. */
  const dragFrom = useRef(panelWidth);

  const dragColumn = useDrag(
    useCallback(
      (e: PointerEvent) => {
        const root = rootRef.current;
        if (!root) return;
        const right = root.getBoundingClientRect().right;
        gutter.current = gutterDrag(gutter.current, right - e.clientX);
        ui.set({ panelWidth: gutter.current.width });
      },
      [ui],
    ),
    // The write-back is on RELEASE, not on every pointermove: `CControl::drag`
    // calls `SettingSetGlobal_i` per pixel because it is in-process, and a
    // WebSocket round trip per pixel is not the same thing. And only if the
    // width actually moved — a bare click in the gutter is not an edit.
    useCallback(() => {
      if (gutter.current.width !== dragFrom.current) applyWidth(gutter.current.width, true);
    }, [applyWidth]),
  );

  const onGutterDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const { state, changed } = gutterClick(gutter.current, e.timeStamp);
      gutter.current = state;
      if (changed) {
        // A double click collapsed or restored: `I->SkipRelease = true`, no drag
        // follows (`packages/engine/layer1/Control.cpp:461`).
        e.preventDefault();
        applyWidth(state.width, true);
        return;
      }
      dragFrom.current = state.width;
      dragColumn(e);
    },
    [applyWidth, dragColumn],
  );

  /* ---- the External GUI dock (parity row 54) ------------------------ */

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent): void => {
      if (ev.defaultPrevented || !isDockShortcut(ev)) return;
      // Capture phase + preventDefault is what stops `features/keyboard`
      // forwarding the same keystroke to PyMOL; it returns early on
      // `ev.defaultPrevented`. Qt's window-level QShortcut wins the same way.
      ev.preventDefault();
      setDock((state) => toggleDockable(state));
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, []);

  const dragConsole = useDrag(
    useCallback(
      (e: PointerEvent) => {
        const root = rootRef.current;
        if (!root) return;
        const box = root.getBoundingClientRect();
        ui.set({
          consoleHeight: Math.min(700, Math.max(60, Math.round(box.bottom - e.clientY - 18))),
        });
      },
      [ui],
    ),
  );

  const extGui = dock.visible ? (
    <div
      className={`extgui extgui--${dockModifier(dock)}${isSideDock(dock) ? ' extgui--side' : ''}`}
      data-dock={dockModifier(dock)}
      data-testid="extgui"
      // Only the BOTTOM dock has a user-dragged size; the side and floating
      // forms take theirs from the stylesheet, as Qt's dock areas do.
      style={!dock.floating && !isSideDock(dock) ? { height: consoleHeight } : undefined}
      // `ExtGuiFrame.mouseDoubleClickEvent` -> `toggle_ext_window_dockable(True)`
      // (`pymol_qt_gui.py:171-173`): never floats, so a double click on the
      // panel gives it a title bar without detaching it.
      onDoubleClick={(e) => {
        if (e.target === e.currentTarget) setDock((state) => toggleDockable(state, true));
      }}
    >
      {dock.titleBar && <ExtGuiTitleBar dock={dock} onChange={setDock} />}
      <div className="extgui__body">
        {slotsForRegion('external-gui').map((slot) => (
          <FeatureSlot key={slot.id} id={slot.id} />
        ))}
      </div>
    </div>
  ) : null;

  const docked = dock.visible && !dock.floating;

  return (
    <div className="shell" ref={rootRef}>
      <ShellHeader dock={dock} onDock={setDock} />

      <div className="shell__main">
        {docked && dock.area === 'left' && extGui}

        <div className="shell__viewport">
          {slotsForRegion('viewport').map((slot) => (
            <FeatureSlot key={slot.id} id={slot.id} />
          ))}
        </div>

        {internalGui && (
          <>
            <div
              className="splitter splitter--v"
              onPointerDown={onGutterDown}
              role="separator"
              aria-orientation="vertical"
              aria-label="internal_gui_width"
              data-testid="gutter"
              title={`internal_gui_width — drag to resize, double-click to collapse to ${ORTHO.controlMinWidth} px`}
            />
            <div className="internal-gui" ref={columnRef} style={{ width: panelWidth }}>
              {slotsForRegion('internal-gui').map((slot) => (
                <FeatureSlot key={slot.id} id={slot.id} />
              ))}
            </div>
          </>
        )}

        {docked && dock.area === 'right' && extGui}
      </div>

      {docked && dock.area === 'bottom' && (
        <div
          className="splitter splitter--h"
          onPointerDown={dragConsole}
          role="separator"
          aria-orientation="horizontal"
          title="External GUI height"
        />
      )}
      {docked && dock.area === 'bottom' && extGui}

      <StatusBar />

      {dock.visible && dock.floating && extGui}
      <OverlayLayer />
      {slotsForRegion('service').map((slot) => (
        <FeatureSlot key={slot.id} id={slot.id} />
      ))}
      <ConnectionOverlay />
    </div>
  );
}

/**
 * The dock's own title bar — the widget Qt REMOVES when the panel is locked.
 *
 * Qt's is a real `QDockWidget` title bar with a drag handle and a float/close
 * button; this is the same three affordances as buttons, because a browser has
 * no window manager to drag a dock into.
 */
function ExtGuiTitleBar({
  dock,
  onChange,
}: {
  dock: ExtGuiDockState;
  onChange: (next: (state: ExtGuiDockState) => ExtGuiDockState) => void;
}) {
  return (
    <div className="extgui__titlebar" data-testid="extgui-titlebar">
      <span className="extgui__title">External GUI</span>
      <span className="extgui__spacer" />
      {(['bottom', 'left', 'right'] as const).map((area) => (
        <Button
          key={area}
          variant="extgui"
          className={!dock.floating && dock.area === area ? 'is-on' : undefined}
          onClick={() => onChange((state) => setArea(state, area))}
          title={`dock ${area}`}
        >
          {area[0]?.toUpperCase()}
        </Button>
      ))}
      <Button
        variant="extgui"
        onClick={() => onChange((state) => toggleDockable(state))}
        title="Toggle dockable [Ctrl+E]"
      >
        {dock.floating ? 'dock' : 'float'}
      </Button>
      <IconButton variant="extgui" icon={X} onClick={() => onChange(toggleVisible)} title="Visible">
        ×
      </IconButton>
    </div>
  );
}

/**
 * The top strip. When WP-14 lands `features/menubar/`, it takes this space
 * whole; until then the strip carries the shell's own controls (which are NOT
 * PyMOL menus and are labelled as such) so the window is operable today.
 *
 * The External GUI toggles live here regardless, because Qt puts them in
 * `Display > External GUI` (`pymol_qt_gui.py:377-384`) and that menu belongs to
 * `features/menubar`, which the shell does not own. Reported, not smuggled in.
 */
function ShellHeader({
  dock,
  onDock,
}: {
  dock: ExtGuiDockState;
  onDock: (next: (state: ExtGuiDockState) => ExtGuiDockState) => void;
}) {
  const session = useSession();
  const ui = session.stores.ui;
  const internalGui = useStore(ui, (s) => s.internalGui);
  const echoActions = useStore(ui, (s) => s.echoActions);

  const extGuiButton = (
    <Button
      variant="menubar"
      data-testid="extgui-visible"
      title="Display > External GUI > Visible"
      onClick={() => onDock(toggleVisible)}
    >
      {dock.visible ? '✓' : ' '} ext gui
    </Button>
  );

  if (isInstalled('menubar')) {
    return (
      <div className="menubar">
        <FeatureSlot id="menubar" />
        <span className="menubar__spacer" />
        {extGuiButton}
        <ThemeToggle />
      </div>
    );
  }

  return (
    <div className="menubar">
      <span className="menubar__title">PyMOL</span>
      <span className="shell-chrome__note" title="WP-14 owns apps/web/src/features/menubar/**">
        menu bar not installed
      </span>
      <span className="menubar__spacer" />
      {UNDECLARED_FEATURES.length > 0 && (
        <span className="shell-chrome__warn">
          undeclared feature dirs: {UNDECLARED_FEATURES.join(', ')}
        </span>
      )}
      {extGuiButton}
      <Button
        variant="menubar"
        title="the right-hand block column. CLIENT-SIDE ONLY: setting internal_gui must stay 0 in PyMOL or the scene rectangle shrinks under the canvas"
        onClick={() => ui.set({ internalGui: !internalGui })}
      >
        {internalGui ? '✓' : ' '} internal_gui
      </Button>
      <Button
        variant="menubar"
        title="echo the command line equivalent of every button press into the console"
        onClick={() => ui.set({ echoActions: !echoActions })}
      >
        {echoActions ? '✓' : ' '} echo actions
      </Button>
      <ThemeToggle />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Mirroring PyMOL
 * ------------------------------------------------------------------ */

/**
 * Keep the column in step with `internal_gui` and `internal_gui_width`.
 *
 * A slow poll, not a subscription: PyMOL has no settings push, and the one
 * drain that reports changes (`cmd.get_setting_updates`) is destructive and
 * owned by the bridge's status thread (`policy/base.py: EXCLUSIVE_TO_BRIDGE`).
 * `features/settings` owns the cumulative tap; the shell must not depend on
 * another feature being installed, so it reads the two values it needs
 * directly. Two calls a second against a poller already running at 30 Hz.
 *
 * The adoption rule is in `orthoPanel.ts` and is not obvious: the bridge forces
 * `internal_gui` to 0 at boot, so a first sample of 0 must be IGNORED or the
 * column disappears one second after connecting.
 */
function useShellSettings(session: Session): void {
  const ui = session.stores.ui;
  useEffect(() => {
    let alive = true;
    let remote: Partial<ShellSettings> = {};
    let seeded = false;

    const tick = async (): Promise<void> => {
      const read = async (name: string): Promise<number | null> => {
        try {
          return Number(await session.call<number>('cmd.get_setting_int', [name]));
        } catch {
          return null;
        }
      };
      const [gui, width] = await Promise.all([read('internal_gui'), read('internal_gui_width')]);
      if (!alive) return;

      const { patch, remote: next } = adoptShellSettings(remote, [
        ['internal_gui', gui],
        ['internal_gui_width', width],
      ]);
      remote = next;

      if (!seeded && typeof width === 'number') {
        // First answer: push the width the browser remembers, so the setting
        // agrees with the DOM instead of the other way round.
        seeded = true;
        const mine = clampInternalGuiWidth(ui.get().panelWidth);
        if (mine !== width) {
          void session.call('cmd.set', ['internal_gui_width', mine]).catch(() => undefined);
          remote.internal_gui_width = mine;
        }
      }

      if (patch.internal_gui !== undefined) ui.set({ internalGui: patch.internal_gui !== 0 });
      if (patch.internal_gui_width !== undefined) {
        ui.set({ panelWidth: clampInternalGuiWidth(patch.internal_gui_width) });
      }

      // `set internal_gui, 1` typed at the prompt turns OUR column on and then
      // has to be refused in PyMOL, or the next canvas resize hands the engine
      // a scene 220 px narrower than the canvas. `remote` is updated in the
      // same breath so the poll that observes the 0 does not read it as the
      // user turning the column back off.
      for (const [name, value] of Object.entries(shellSettingWriteBacks(patch))) {
        void session.call('cmd.set', [name, value]).catch(() => undefined);
        remote[name as keyof ShellSettings] = value;
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), SHELL_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [session, ui]);
}

/**
 * `document.title` <- setting 440, `session_file`.
 *
 * Qt registers `setting_callbacks[440]` and sets
 * `"PyMOL (" + os.path.basename(v) + ")"` (`pymol_qt_gui.py:112-115`). MEASURED:
 * 440 really is `session_file`, and `cmd.save(*.pse)` sets it to the absolute
 * path, so this is the whole title mechanism.
 *
 * A PUSH, and the 1 Hz `cmd.get` it replaces is now only the cold path.
 * `settingsTap.watch(440, …)` is `setting_callbacks[440].append(cb)`: the
 * bridge's tap reports that 440 changed and the tap reads it back, which is
 * exactly the two steps `update_feedback` performs. The poll below survives for
 * the seconds before the tap installs, and for a bridge where it never does —
 * it STOPS ISSUING CALLS the moment the drain answers (`tap.live`), so this is
 * not a poll with a subscription bolted beside it.
 */
function useWindowTitle(session: Session): void {
  useEffect(() => {
    let alive = true;
    const apply = (file: string | null): void => {
      if (!alive) return;
      const title = windowTitle(file);
      if (document.title !== title) document.title = title;
    };

    const tap = getSettingsTap(session);
    const detach = tap.attach();
    const unwatch = tap.watch(SESSION_FILE_INDEX, (value) =>
      apply(typeof value === 'string' ? value : value === null ? null : String(value)),
    );

    const tick = async (): Promise<void> => {
      if (tap.live) return; // the tap owns the title now
      let file: string | null = null;
      try {
        file = await session.call<string>('cmd.get', ['session_file']);
      } catch {
        return; // offline: leave the last title alone rather than resetting it
      }
      apply(file);
    };
    void tick();
    const timer = setInterval(() => void tick(), SHELL_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
      unwatch();
      detach();
    };
  }, [session]);
}

/**
 * Keep the column stacked the way `OrthoLayoutPanel` stacks it.
 *
 * Executive, Wizard, ButMode, Control — top to bottom. The registry's slot
 * order already gets the first, second and fourth right; the ButMode block is
 * PORTALLED in by `features/shortcuts` (the registry is frozen and declares no
 * slot for it) and `createPortal` appends, so it arrives last, below the movie
 * Control bar. A `MutationObserver` is what makes this survive that: panels
 * mount lazily and the portal can arrive several frames after the column does.
 *
 * `style.order` rather than a stylesheet rule: the inline value is observable,
 * a computed one is not (vitest stubs CSS imports; jsdom implements no computed
 * `order`). See `INTERNAL_GUI_ORDER`.
 */
function useOrthoStackOrder(ref: React.RefObject<HTMLDivElement | null>, enabled: boolean): void {
  useEffect(() => {
    const column = ref.current;
    if (!enabled || !column) return undefined;
    const stamp = (): void => {
      for (const child of Array.from(column.children)) {
        if (!(child instanceof HTMLElement)) continue;
        const order = internalGuiOrder(child.classList);
        child.style.order = order === null ? '' : String(order);
      }
    };
    stamp();
    const observer = new MutationObserver(stamp);
    observer.observe(column, { childList: true });
    return () => observer.disconnect();
  }, [ref, enabled]);
}

function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // storage disabled by policy
  }
}

/** Minimal pointer-capture drag. No library. */
function useDrag(onMove: (e: PointerEvent) => void, onUp?: () => void) {
  return useCallback(
    (down: React.PointerEvent<HTMLDivElement>) => {
      down.preventDefault();
      const move = (e: PointerEvent) => onMove(e);
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.classList.remove('is-dragging');
        onUp?.();
      };
      document.body.classList.add('is-dragging');
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [onMove, onUp],
  );
}

/**
 * Overlay panels — dialogs and floating tools.
 *
 * These used to render UNCONDITIONALLY, straight into the document flow after
 * the status bar. With one or two slots installed that merely looked odd; by
 * the time the wave shipped ten (settings, files, dialogs, builder, colours,
 * volume, properties, text editor, compute, plugin manager, APBS) they stacked
 * down the page and pushed the 3-D viewport off screen entirely — the app was
 * unusable and every slot still "mounted", so the mount check stayed green.
 *
 * A dialog is closed until you open it. The launcher keeps every installed
 * panel reachable, so nothing becomes invisible in the process — the same rule
 * the registry applies to absent slots.
 */
function OverlayLayer() {
  // The open set is a MODULE store, not local state: `Setting > Colors…` and
  // the Properties quick button open these panels from other features, and a
  // `useState` here could only ever be reached by this component's own
  // children (`shell/panelHooks.ts`).
  const open = useStore(panelsStore(), (state) => state.open);
  const slots = slotsForRegion('overlay').filter((slot) => isInstalled(slot.id));
  if (slots.length === 0) return null;

  const toggle = (id: string) => togglePanel(id);

  return (
    <>
      <div className="overlay-launcher" role="toolbar" aria-label="panels">
        {slots.map((slot) => (
          <ToggleButton
            key={slot.id}
            variant="launcher"
            icon={LAUNCHER_ICONS[slot.id]}
            pressed={open.includes(slot.id)}
            onClick={() => toggle(slot.id)}
          >
            {slot.title}
          </ToggleButton>
        ))}
      </div>
      {/*
       * Rendered WITHOUT a wrapper. These panels bring their own positioning —
       * `features/settings` is `position: absolute; right: 8px`, anchored to
       * the app root. Wrapping each in a `position: relative` box made that box
       * their containing block; it then collapsed to zero size (its only child
       * was absolutely positioned) and threw the panel's own controls to
       * x = -134, off screen left. The launcher decides WHETHER a panel
       * renders; the panel decides WHERE.
       */}
      {slots
        .filter((slot) => open.includes(slot.id))
        .map((slot) => (
          <FeatureSlot key={slot.id} id={slot.id} />
        ))}
    </>
  );
}
