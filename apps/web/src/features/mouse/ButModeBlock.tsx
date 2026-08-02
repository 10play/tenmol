/**
 * The ButMode block — PyMOL's mouse-mode panel, as DOM.
 *
 * It is a faithful port of `CButMode::draw` / `CButMode::click`
 * (`layer1/ButMode.cpp:196-360`, `:147-188`), not a re-imagining:
 *
 *   line 1        `Mouse Mode  <button_mode_name>`
 *   lines 2-7     the 5-char action grid, only when `mouse_grid` is set
 *                 (`Buttons  L  M  R  Wheel` / `& Keys` / `Shft` / `Ctrl` /
 *                 `CtSh` / `SnglClk` / `DblClk`)
 *   last line     `Selecting <level>`, or `Picking Atoms (and Joints)` when
 *                 single-left resolves to `pkat`
 *
 * CLICK SEMANTICS, verbatim from `CButMode::click`:
 *   * `dy = (y - rect.bottom) / lineHeight`; `dy < 2` — the BOTTOM two lines —
 *     cycles the SELECTION LEVEL, everything above cycles the MOUSE MODE;
 *   * `forward` starts true and is inverted by the right button, by
 *     scroll-backward, and by Shift (each independently, so Shift+right is
 *     forward again);
 *   * right button above the bottom two lines opens the `mouse_config` menu
 *     instead of cycling;
 *   * when single-left is `pkat` the bottom line does not cycle at all
 *     (`ButMode.cpp:163-173`).
 *
 * Every mutation is a `cmd` call and is followed by a re-read; nothing is
 * predicted locally (see `./useMouseMode.ts`).
 */

import { useCallback } from 'react';
import {
  BUT_ACT_CODE,
  GRID_COLUMNS,
  GRID_ROWS,
  MOUSE_CONFIG_MENU,
  SELECTION_LEVELS,
  selectionLine,
  slotLabel,
} from './tables';
import { useSession } from '../../app';
import { pymolMenu, type PymolMenuRow } from '../pymol-menu/menuStore';
import { useMouseMode } from './useMouseMode';
import './mouse.css';

/** `menu.mouse_config()` in the shape the pop-up host takes. */
const MOUSE_CONFIG_ROWS: readonly PymolMenuRow[] = MOUSE_CONFIG_MENU.map(
  (item) => [item.kind, item.label, item.command] as PymolMenuRow,
);

export function ButModeBlock() {
  const session = useSession();
  const mode = useMouseMode();

  const mouse = useCallback(
    (action: string) => {
      void session
        .act({
          fn: 'mouse',
          args: [action],
          kwargs: { quiet: 1 },
          // PyMOL logs exactly this line when the block is clicked
          // (`PLog(m_G, "cmd.mouse('forward')", cPLog_pym)`).
          echo: `cmd.mouse('${action}')`,
        })
        .then(() => mode.refresh());
    },
    [session, mode],
  );

  /** `forward` is inverted by right button, scroll-backward and Shift. */
  const isForward = (event: { button?: number; shiftKey?: boolean }, scrollBack = false) => {
    let forward = true;
    if (scrollBack || event.button === 2) forward = !forward;
    if (event.shiftKey) forward = !forward;
    return forward;
  };

  const cycleMode = useCallback(
    (event: React.MouseEvent) => {
      if (event.button === 2) {
        pymolMenu.openAt(event.clientX, event.clientY, MOUSE_CONFIG_ROWS, 'Mouse Config');
        return;
      }
      mouse(isForward(event) ? 'forward' : 'backward');
    },
    [mouse],
  );

  const line = selectionLine(mode.table, mode.selectionMode);

  const cycleSelection = useCallback(
    (event: React.MouseEvent) => {
      // The block ignores clicks on this line while single-left is `pkat`.
      if (!line.cycles) return;
      // `CButMode::click` does NOT open `mouse_config` here: the `dy < 2`
      // branch (`ButMode.cpp:163-173`) has no right-button case at all, so the
      // right button only flips `forward` and the line cycles BACKWARD. Only
      // the `else` branch — everything above the bottom two lines — opens the
      // menu (`:174-176`). This used to open the menu and never cycled back.
      mouse(isForward(event) ? 'select_forward' : 'select_backward');
    },
    [mouse, line.cycles],
  );

  const onWheel = useCallback(
    (event: React.WheelEvent) => {
      if (event.deltaY === 0) return;
      mouse(isForward({ shiftKey: event.shiftKey }, event.deltaY > 0) ? 'forward' : 'backward');
    },
    [mouse],
  );

  return (
    <div
      className="butmode"
      data-testid="butmode"
      onWheel={onWheel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        className="butmode__line butmode__mode"
        data-testid="butmode-mode"
        title="click to cycle the mouse mode; Shift or right-click reverses; right-click opens the mouse configuration menu"
        onMouseDown={cycleMode}
        // `mousedown` has ALREADY run for button 2 by the time `contextmenu`
        // fires; acting again here made every right-click count twice.
        onContextMenu={(e) => e.preventDefault()}
      >
        <span className="butmode__label">Mouse Mode</span>
        <span className="butmode__value" data-testid="butmode-name">
          {mode.loaded ? mode.displayName : '…'}
        </span>
      </button>

      {mode.grid && (
        <div className="butmode__grid" data-testid="butmode-grid" onMouseDown={cycleMode}>
          <div className="butmode__row butmode__row--head">
            <span className="butmode__rowlabel butmode__rowlabel--head">Buttons</span>
            {GRID_COLUMNS.map((column) => (
              <span className="butmode__cell butmode__cell--head" key={column}>
                {column}
              </span>
            ))}
          </div>
          {GRID_ROWS.map((row) => (
            <div className="butmode__row" key={row.label}>
              <span className="butmode__rowlabel">{row.label}</span>
              {row.buttons.map((slot) => (
                <span className="butmode__cell" key={slot} data-slot={slot}>
                  {slotLabel(mode.table, slot)}
                </span>
              ))}
              <span className="butmode__cell">
                {row.wheel === null ? '' : slotLabel(mode.table, row.wheel)}
              </span>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        className="butmode__line butmode__sele"
        data-testid="butmode-selection"
        disabled={!line.cycles}
        title={
          line.cycles
            ? `mouse_selection_mode — click to cycle: ${SELECTION_LEVELS.map((l) => l.label).join(', ')}; Shift or right-click reverses`
            : 'single-left is bound to PkAt, so this line shows the picking state and does not cycle'
        }
        onMouseDown={cycleSelection}
        onContextMenu={(e) => e.preventDefault()}
      >
        <span className="butmode__label">{line.prefix.trim()}</span>
        <span className="butmode__value butmode__value--sele" data-testid="butmode-level">
          {line.value}
        </span>
      </button>

      {mode.loaded && mode.mode === null && (
        <div className="butmode__warn">
          unknown mode &quot;{mode.displayName}&quot; — the grid mirrors
          controlling.mode_dict and has no row for it
        </div>
      )}
      {mode.error !== null && <div className="butmode__warn">{mode.error}</div>}
    </div>
  );
}

/** Exported for the tests: the action code the grid renders for a slot. */
export const PKAT = BUT_ACT_CODE['pkat'];
