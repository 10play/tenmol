/**
 * The wizard panel — ONE generic renderer for every wizard there is.
 *
 * In PyMOL this block is drawn by C++ inside the GL viewport, between the
 * object list and the mouse-mode block (`OrthoLayoutPanel`,
 * `packages/engine/layer1/Ortho.cpp:2286-2300`), and its height is
 * `internal_gui_control_size * NLine + 4` (`packages/engine/layer1/Wizard.cpp:254-259`), which
 * is 0 rows -> 0 pixels: an inactive wizard is invisible, not an empty box.
 *
 * Row types (`packages/engine/layer1/Wizard.cpp:44-47`, drawn at `:685-771`):
 *   0 blank   nothing drawn, the row still exists (`security.py:37-45`)
 *   1 text    flat label (`text_color2`)
 *   2 button  raised; fires `code` on RELEASE INSIDE the row (`:568-580`);
 *             pressing highlights (`:490-494`) and dragging off cancels (`:519-548`)
 *   3 popup   raised; opens `get_menu(code)` on PRESS (`:495-511`)
 *
 * Rules this renderer obeys, each from a real wizard:
 *   - the panel may be `None` (`dragging.py:104`) or `[]` (`message.py:36`);
 *   - the ROW COUNT changes with state (`appearance.py:163-183` swaps the
 *     middle row), so rows are keyed by index and nothing is assumed;
 *   - button TEXT is dynamic (`pair_fit.py:30` — `'Fit %d Pairs'`);
 *   - `code` is command language, never JavaScript (`sculpting.py:175-176`
 *     carries raw inline Python), so it is always sent back as a string;
 *   - menus are re-fetched on every open, never cached
 *     (`density.py:160`, `filter.py:236`, `command.py:87`);
 *   - a wizard can push another wizard (`demo.py:42`) or dismiss itself
 *     (`dragging.py:52`), so the stack comes from the snapshot, never from
 *     optimistic local state.
 */

import { useCallback, useRef, useState } from 'react';
import type { WizardMenuItem, WizardPanelRow, WizardSnapshot } from '@tenmol/protocol';
import { ColorCodedText } from './ColorCodedText';
import { stripColorCodes } from './colorCodes';
import { WizardPopupMenu } from './WizardPopupMenu';

/** Setting `internal_gui_control_size`, default 18 (`packages/engine/layer1/SettingInfo.h:411`). */
export const CONTROL_SIZE = 18;

/** Props for {@link WizardPanel}: the wizard snapshot and the exec/menu callbacks. */
export interface WizardPanelProps {
  snapshot: WizardSnapshot;
  /** Runs a `code` string server-side. NEVER evaluated here. */
  onExec(code: string): void;
  /** Fetches `get_menu(tag)` at open time. */
  onMenu(tag: string): Promise<WizardMenuItem[] | null>;
}

interface OpenMenu {
  tag: string;
  title: string;
  items: WizardMenuItem[];
  anchor: { x: number; y: number };
}

/** The generic wizard panel: renders any wizard's rows from its snapshot, or nothing when inactive. */
export function WizardPanel({ snapshot, onExec, onMenu }: WizardPanelProps) {
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [pressed, setPressed] = useState<number | null>(null);
  const pressedRef = useRef<number | null>(null);

  const setPress = (index: number | null) => {
    pressedRef.current = index;
    setPressed(index);
  };

  const openMenu = useCallback(
    async (row: WizardPanelRow, anchor: { x: number; y: number }) => {
      setMenuError(null);
      try {
        const items = await onMenu(row.code);
        if (items === null) {
          // get_menu returned None: PyMOL opens no popup at all
          // (`packages/engine/layer1/Wizard.cpp:503-509`). Say so rather than flashing nothing.
          setMenuError(`${row.code}: this wizard has no menu for that row`);
          return;
        }
        setMenu({ tag: row.code, title: row.text, items, anchor });
      } catch (error) {
        setMenuError(error instanceof Error ? error.message : String(error));
      }
    },
    [onMenu],
  );

  if (snapshot.depth === 0) return null;

  return (
    <div className="wizpanel modern:bg-pm-panel modern:text-pm-text" data-testid="wizard-panel">
      <div className="wizpanel__head modern:border-b modern:border-line">
        <span className="wizpanel__head-title modern:text-pm-text-dim">
          {snapshot.cls ?? 'Wizard'}
        </span>
        {snapshot.depth > 1 && (
          <span
            className="wizpanel__depth"
            title={snapshot.stack.map((entry) => entry.cls).join(' > ')}
          >
            stack {snapshot.depth}
          </span>
        )}
      </div>

      {snapshot.errors.map((error, index) => (
        <div className="wizpanel__error" key={index}>
          {error}
        </div>
      ))}
      {menuError && <div className="wizpanel__error">{menuError}</div>}

      <div className="wizpanel__rows">
        {snapshot.panel.map((row) => (
          <PanelRow
            key={row.index}
            row={row}
            pressed={pressed === row.index}
            onPressStart={() => {
              if (row.type === 2) setPress(row.index);
            }}
            onPressEnd={(inside) => {
              const wasPressed = pressedRef.current === row.index;
              setPress(null);
              // "execute on release inside the row" — Wizard.cpp:568-580.
              if (row.type === 2 && wasPressed && inside) onExec(row.code);
            }}
            onPopup={(anchor) => void openMenu(row, anchor)}
          />
        ))}
        {snapshot.panel.length === 0 && (
          <div className="wizpanel__promptonly">
            prompt-only wizard — no panel rows (get_panel returned {'None'} or [])
          </div>
        )}
      </div>

      {menu && (
        <WizardPopupMenu
          title={menu.title}
          items={menu.items}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          onPick={(command) => {
            setMenu(null);
            if (command) onExec(command);
          }}
        />
      )}
    </div>
  );
}

function PanelRow({
  row,
  pressed,
  onPressStart,
  onPressEnd,
  onPopup,
}: {
  row: WizardPanelRow;
  pressed: boolean;
  onPressStart(): void;
  onPressEnd(inside: boolean): void;
  onPopup(anchor: { x: number; y: number }): void;
}) {
  const style = { minHeight: CONTROL_SIZE };

  if (row.type === 0) {
    // cWizBlank falls through `default:` at Wizard.cpp:771 — nothing is drawn,
    // but the row still occupies internal_gui_control_size pixels.
    return <div className="wizrow wizrow--blank" style={style} aria-hidden="true" />;
  }

  if (row.type === 1) {
    return (
      <div className="wizrow wizrow--text modern:text-pm-text" style={style}>
        <ColorCodedText text={row.text} />
      </div>
    );
  }

  if (row.type === 3) {
    return (
      <button
        type="button"
        className="wizrow wizrow--popup modern:rounded-md modern:border modern:border-btn-border modern:bg-btn modern:text-pm-text modern:hover:border-btn-border-strong modern:hover:bg-btn-hover modern:hover:text-pm-text-bright"
        style={style}
        aria-haspopup="menu"
        title={`get_menu(${row.code})`}
        onPointerDown={(event) => {
          // Popups open on PRESS (Wizard.cpp:495-511), buttons fire on release.
          const rect = event.currentTarget.getBoundingClientRect();
          onPopup({ x: rect.left, y: rect.bottom });
        }}
      >
        <ColorCodedText text={row.text} />
        <span className="wizrow__caret modern:text-pm-text-dim">▾</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className={
        'wizrow wizrow--button modern:rounded-md modern:border modern:border-btn-border modern:bg-btn modern:text-pm-text modern:hover:border-btn-border-strong modern:hover:bg-btn-hover modern:hover:text-pm-text-bright' +
        (pressed ? ' is-pressed' : '')
      }
      style={style}
      title={row.code}
      aria-label={stripColorCodes(row.text)}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        onPressStart();
      }}
      onPointerUp={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const inside =
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom;
        onPressEnd(inside);
      }}
      onPointerCancel={() => onPressEnd(false)}
      // Keyboard activation has no pointer geometry; treat it as inside.
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onPressStart();
          onPressEnd(true);
        }
      }}
    >
      <ColorCodedText text={row.text} />
    </button>
  );
}
