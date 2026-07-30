import { useCallback, useRef, useState } from 'react';
import { MenuBar } from './MenuBar';
import { Viewport } from './Viewport';
import { ObjectPanel } from './ObjectPanel';
import { MouseModeBlock } from './MouseModeBlock';
import { MovieControls } from './MovieControls';
import { FeedbackLog } from './FeedbackLog';
import { CommandLine } from './CommandLine';
import { QuickButtons } from './QuickButtons';
import { PLACEHOLDER_FRAME, PLACEHOLDER_MOUSE_MODE } from './placeholderData';
import { useBridge } from '../bridge/BridgeContext';

/**
 * The window shell.
 *
 * PyMOL/Qt has no QSplitter: the main window is a QMainWindow with the GL widget as
 * the central widget and the "External GUI" as a dock widget on top
 * (modules/pmg_qt/pymol_qt_gui.py:184-193). Everything on the right -- the object
 * panel, the mouse-mode block and the movie controls -- is not Qt at all: PyMOL draws
 * it itself inside the GL viewport as 2D "Blocks", stacked bottom-up by
 * `OrthoLayoutPanel()` (layer1/Ortho.cpp:2261-2340):
 *
 *      Executive (object panel)   <- fills the remaining height
 *      Wizard                     <- only when a wizard is active
 *      ButMode (mouse mode)       <- 40px, or 124px with mouse_grid
 *      Control (movie buttons)    <- 20px
 *
 * In this client those blocks become real DOM in a right-hand column of width
 * `internal_gui_width` (default cOrthoRightSceneMargin = 220px,
 * layer1/SettingInfo.h:182, layer1/Ortho.h:24). The whole column disappears when
 * `internal_gui` = 0.
 *
 * The External GUI (feedback + command line + quick buttons) is docked at the bottom
 * here rather than the top: PyMOL's default dock area is the top, but the in-viewport
 * prompt and scrollback that this panel duplicates are drawn at the *bottom* of the
 * scene (`OrthoDrawText`, layer1/Ortho.cpp:1623-1693), and the bottom reading order
 * matches every other console-bearing scientific tool.
 *
 * TODO(dock): the External GUI is dockable in Qt (top/left/right/floating/hidden, with
 * Ctrl+E toggling dockability, pymol_qt_gui.py:457-470). Only the bottom-docked mode
 * exists here.
 * TODO(wizard): the Wizard block (layer1/Wizard.cpp) belongs between the object panel
 * and the mouse-mode block. It is driven by `wizard.get_panel()`; another package owns
 * it. Its slot is marked below.
 */
export function AppShell() {
  const bridge = useBridge();
  const [panelWidth, setPanelWidth] = useState(220);
  const [extHeight, setExtHeight] = useState(190);
  const [internalGui, setInternalGui] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);

  const dragColumn = useDrag(
    useCallback((e: PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      const right = root.getBoundingClientRect().right;
      // min width 5 mirrors cControlMinWidth (layer1/Control.cpp:263-276)
      setPanelWidth(Math.min(600, Math.max(5, Math.round(right - e.clientX))));
    }, []),
  );

  const dragExt = useDrag(
    useCallback((e: PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      const bottom = root.getBoundingClientRect().bottom;
      setExtHeight(Math.min(600, Math.max(60, Math.round(bottom - e.clientY - 18))));
    }, []),
  );

  return (
    <div className="shell" ref={rootRef}>
      <MenuBar
        onDialog={(dialog) => {
          if (dialog === 'ext-gui-visible') setInternalGui((v) => !v);
        }}
      />

      <div className="shell__main">
        <Viewport />

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
              {/* Executive block -- fills the column */}
              <ObjectPanel buttonModeName={PLACEHOLDER_MOUSE_MODE.buttonModeName} />
              {/* Wizard block slot (layer1/Wizard.cpp) -- empty until a wizard is active */}
              <MouseModeBlock mode={PLACEHOLDER_MOUSE_MODE} frame={PLACEHOLDER_FRAME} />
              <MovieControls frame={PLACEHOLDER_FRAME} />
            </div>
          </>
        )}
      </div>

      <div
        className="splitter splitter--h"
        onPointerDown={dragExt}
        role="separator"
        aria-orientation="horizontal"
        title="External GUI height"
      />

      <div className="extgui" style={{ height: extHeight }}>
        <div className="extgui__console">
          <FeedbackLog />
          <CommandLine />
        </div>
        <QuickButtons />
      </div>

      {/*
        Not a PyMOL feature: Qt has no QStatusBar (docs/webclient/qt-main-window.md §5).
        A client/server product needs a visible transport state, so the shell adds one
        thin strip. Nothing else may grow here.
      */}
      <div className="statusbar">
        <span className={`statusbar__dot statusbar__dot--${bridge.status}`} />
        <span className="statusbar__text">
          {bridge.status} &middot; {bridge.url}
        </span>
        <span className="statusbar__spacer" />
        <span className="statusbar__text">
          {bridge.pymolVersion ? `PyMOL ${bridge.pymolVersion}` : 'PyMOL version unknown'}
        </span>
      </div>
    </div>
  );
}

/** Minimal pointer-capture drag. No library, no state manager. */
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
