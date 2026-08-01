/**
 * The window.
 *
 * Layout is PyMOL's, not a web app's. Qt PyMOL has no splitters: the main window
 * is a `QMainWindow` with the GL widget as the central widget and the External
 * GUI as a dock (`modules/pmg_qt/pymol_qt_gui.py:184-193`). Everything on the
 * right — object panel, mouse-mode block, movie controls — is not Qt at all:
 * PyMOL draws it itself inside the GL viewport as 2D `Block`s stacked bottom-up
 * by `OrthoLayoutPanel()` (`layer1/Ortho.cpp:2261-2340`):
 *
 *      Executive (object panel)   <- fills the remaining height
 *      Wizard                     <- only when a wizard is active
 *      ButMode (mouse mode)       <- 40px, or 124px with mouse_grid
 *      Control (movie buttons)    <- 20px
 *
 * Here those blocks are real DOM in a right-hand column of width
 * `internal_gui_width` (default 220, `layer1/Ortho.h:24`), and the whole column
 * disappears when `internal_gui` is 0. Every child comes from the feature
 * registry, so this file never needs to change as features land.
 *
 * The External GUI is docked at the BOTTOM rather than Qt's default top: the
 * in-viewport prompt and scrollback it duplicates are drawn at the bottom of the
 * scene (`OrthoDrawText`, `layer1/Ortho.cpp:1623-1693`).
 */

import { useCallback, useRef, useState } from 'react';
import { useSession, useStore } from '../app';
import { FeatureSlot } from './FeatureSlot';
import { StatusBar } from './StatusBar';
import { ConnectionOverlay } from './ConnectionOverlay';
import { UNDECLARED_FEATURES, isInstalled, slotsForRegion } from '../features/registry';
import './shell.css';

export function AppShell() {
  const session = useSession();
  const ui = session.stores.ui;
  const panelWidth = useStore(ui, (s) => s.panelWidth);
  const consoleHeight = useStore(ui, (s) => s.consoleHeight);
  const internalGui = useStore(ui, (s) => s.internalGui);
  const rootRef = useRef<HTMLDivElement>(null);

  const dragColumn = useDrag(
    useCallback(
      (e: PointerEvent) => {
        const root = rootRef.current;
        if (!root) return;
        const right = root.getBoundingClientRect().right;
        // Floor of 5 mirrors cControlMinWidth (layer1/Control.cpp:263-276).
        ui.set({ panelWidth: Math.min(600, Math.max(5, Math.round(right - e.clientX))) });
      },
      [ui],
    ),
  );

  const dragConsole = useDrag(
    useCallback(
      (e: PointerEvent) => {
        const root = rootRef.current;
        if (!root) return;
        const bottom = root.getBoundingClientRect().bottom;
        ui.set({ consoleHeight: Math.min(700, Math.max(60, Math.round(bottom - e.clientY - 18))) });
      },
      [ui],
    ),
  );

  return (
    <div className="shell" ref={rootRef}>
      <ShellHeader />

      <div className="shell__main">
        <div className="shell__viewport">
          {slotsForRegion('viewport').map((slot) => (
            <FeatureSlot key={slot.id} id={slot.id} />
          ))}
        </div>

        {internalGui && (
          <>
            <div
              className="splitter splitter--v"
              onPointerDown={dragColumn}
              role="separator"
              aria-orientation="vertical"
              title="internal_gui_width"
            />
            <div className="internal-gui" style={{ width: panelWidth }}>
              {slotsForRegion('internal-gui').map((slot) => (
                <FeatureSlot key={slot.id} id={slot.id} />
              ))}
            </div>
          </>
        )}
      </div>

      <div
        className="splitter splitter--h"
        onPointerDown={dragConsole}
        role="separator"
        aria-orientation="horizontal"
        title="External GUI height"
      />

      <div className="extgui" style={{ height: consoleHeight }}>
        {slotsForRegion('external-gui').map((slot) => (
          <FeatureSlot key={slot.id} id={slot.id} />
        ))}
      </div>

      <StatusBar />

      <OverlayLayer />
      {slotsForRegion('service').map((slot) => (
        <FeatureSlot key={slot.id} id={slot.id} />
      ))}
      <ConnectionOverlay />
    </div>
  );
}

/**
 * The top strip. When WP-14 lands `features/menubar/`, it takes this space
 * whole; until then the strip carries the shell's own controls (which are NOT
 * PyMOL menus and are labelled as such) so the window is operable today.
 */
function ShellHeader() {
  const session = useSession();
  const ui = session.stores.ui;
  const internalGui = useStore(ui, (s) => s.internalGui);
  const echoActions = useStore(ui, (s) => s.echoActions);

  if (isInstalled('menubar')) {
    return (
      <div className="menubar">
        <FeatureSlot id="menubar" />
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
      <button
        type="button"
        className="menubar__item"
        title="setting internal_gui — the right-hand block column"
        onClick={() => ui.set({ internalGui: !internalGui })}
      >
        {internalGui ? '✓' : ' '} internal_gui
      </button>
      <button
        type="button"
        className="menubar__item"
        title="echo the command line equivalent of every button press into the console"
        onClick={() => ui.set({ echoActions: !echoActions })}
      >
        {echoActions ? '✓' : ' '} echo actions
      </button>
    </div>
  );
}

/** Minimal pointer-capture drag. No library. */
function useDrag(onMove: (e: PointerEvent) => void) {
  return useCallback(
    (down: React.PointerEvent<HTMLDivElement>) => {
      down.preventDefault();
      const move = (e: PointerEvent) => onMove(e);
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.classList.remove('is-dragging');
      };
      document.body.classList.add('is-dragging');
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [onMove],
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
  const [open, setOpen] = useState<readonly string[]>([]);
  const slots = slotsForRegion('overlay').filter((slot) => isInstalled(slot.id));
  if (slots.length === 0) return null;

  const toggle = (id: string) =>
    setOpen((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <>
      <div className="overlay-launcher" role="toolbar" aria-label="panels">
        {slots.map((slot) => (
          <button
            key={slot.id}
            type="button"
            className={`overlay-launcher__btn${open.includes(slot.id) ? ' is-on' : ''}`}
            aria-pressed={open.includes(slot.id)}
            onClick={() => toggle(slot.id)}
          >
            {slot.title}
          </button>
        ))}
      </div>
      {open.length > 0 && (
        <div className="overlay-layer">
          {slots
            .filter((slot) => open.includes(slot.id))
            .map((slot) => (
              <div key={slot.id} className="overlay-panel">
                <button
                  type="button"
                  className="overlay-panel__close"
                  aria-label={`close ${slot.title}`}
                  onClick={() => toggle(slot.id)}
                >
                  x
                </button>
                <FeatureSlot id={slot.id} />
              </div>
            ))}
        </div>
      )}
    </>
  );
}
