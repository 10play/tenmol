/**
 * The full 80-slot mouse configuration matrix: 8 modifier rows x 10 button
 * columns, every cell a dropdown over the 56 nameable actions.
 *
 * Writes go through `cmd.button(button, modifier, action)` with STRING names
 * (`packages/engine/modules/pymol/controlling.py:799-868`) — never through a re-implemented bit
 * packing — so Python owns both the arithmetic and the `Shortcut` abbreviation
 * matcher. `buttonSlot()` is used here only to place a value in the grid.
 *
 * HONESTY NOTE, and it is a real limitation: there is no getter for the C
 * `ButMode` table (`ButModeGet` is not exposed to Python; grepped `packages/engine/modules/`).
 * The matrix therefore shows what `cmd.mouse(<current mode>)` PUT there, plus
 * the edits made in this panel this session, and it says so on screen. A cell
 * changed by a script or a plugin cannot be seen. Fixing that needs a bridge
 * endpoint over `ButModeGet` — reported, not faked.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ACTION_DESCRIPTION,
  ACTION_LABEL,
  ACTION_NAME,
  BUT_MOD_CODE,
  BUTTON_CODE,
  buttonSlot,
  BUT_ACT_CODE,
} from './tables';
import { useSession } from '../../app';
import { useMouseMode } from './useMouseMode';
import { Select } from '../../ui';
import './mouse.css';

/** Column order: the ten `button_code` names (`controlling.py:30-41`). */
const BUTTONS: readonly { name: string; label: string }[] = [
  { name: 'left', label: 'L' },
  { name: 'middle', label: 'M' },
  { name: 'right', label: 'R' },
  { name: 'wheel', label: 'Wheel' },
  { name: 'single_left', label: 'Sgl L' },
  { name: 'single_middle', label: 'Sgl M' },
  { name: 'single_right', label: 'Sgl R' },
  { name: 'double_left', label: 'Dbl L' },
  { name: 'double_middle', label: 'Dbl M' },
  { name: 'double_right', label: 'Dbl R' },
];

/** Row order: the eight `but_mod_code` names (`controlling.py:44-53`). */
const MODIFIERS: readonly { name: string; label: string }[] = [
  { name: 'none', label: '—' },
  { name: 'shft', label: 'Shft' },
  { name: 'ctrl', label: 'Ctrl' },
  { name: 'ctsh', label: 'CtSh' },
  { name: 'alt', label: 'Alt' },
  { name: 'alsh', label: 'AlSh' },
  { name: 'ctal', label: 'CtAl' },
  { name: 'ctas', label: 'CtAS' },
];

const ACTION_OPTIONS: readonly string[] = Object.keys(BUT_ACT_CODE).sort();

/** The 8-modifier x 10-button matrix of mouse-action dropdowns. */
export function MouseConfigPanel() {
  const session = useSession();
  const mode = useMouseMode();
  const [overrides, setOverrides] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState<string | null>(null);

  // A mode switch rewrites every slot from mode_dict, so this session's
  // per-cell edits are gone; drop them rather than showing a lie.
  useEffect(() => {
    setOverrides({});
  }, [mode.mode]);

  const write = useCallback(
    async (button: string, modifier: string, action: string): Promise<void> => {
      setBusy(`${button}/${modifier}`);
      try {
        await session.act({
          fn: 'button',
          args: [button, modifier, action],
          echo: `cmd.button("${button}","${modifier}","${action}")`,
        });
        const code = BUT_ACT_CODE[action];
        if (code !== undefined) {
          setOverrides((previous) => ({ ...previous, [buttonSlot(button, modifier)]: code }));
        }
      } finally {
        setBusy(null);
      }
    },
    [session],
  );

  const codeAt = (button: string, modifier: string): number => {
    const slot = buttonSlot(button, modifier);
    return overrides[slot] ?? mode.table[slot] ?? -1;
  };

  return (
    <div className="mousecfg modern:bg-pm-panel modern:text-pm-text">
      <div className="mousecfg__head">
        <span>
          Mouse configuration — {mode.loaded ? mode.displayName : '…'} (
          {mode.mode ?? 'unknown mode'})
        </span>
        <span className="mousecfg__note">
          {Object.keys(BUTTON_CODE).length} buttons x {Object.keys(BUT_MOD_CODE).length} modifiers =
          80 slots. Every change is a <code>cmd.button</code> call. PyMOL exposes no reader for the
          table, so these cells show what the current mouse mode wrote plus your edits in this
          session.
        </span>
      </div>
      <table className="mousecfg__table">
        <thead>
          <tr>
            <th />
            {BUTTONS.map((button) => (
              <th key={button.name} title={button.name} className="modern:text-pm-text-dim">
                {button.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MODIFIERS.map((modifier) => (
            <tr key={modifier.name}>
              <th scope="row" title={modifier.name} className="modern:text-pm-text-dim">
                {modifier.label}
              </th>
              {BUTTONS.map((button) => {
                const code = codeAt(button.name, modifier.name);
                const name = code >= 0 ? (ACTION_NAME[code] ?? '') : '';
                const cellId = `${button.name}/${modifier.name}`;
                return (
                  <td key={button.name}>
                    <Select
                      className="mousecfg__select"
                      data-testid={`cell-${cellId}`}
                      value={name}
                      disabled={busy !== null}
                      title={
                        name === ''
                          ? 'unbound'
                          : `${ACTION_LABEL[code]?.trim()} — ${ACTION_DESCRIPTION[name] ?? ''}`
                      }
                      onChange={(e) => void write(button.name, modifier.name, e.target.value)}
                    >
                      {name === '' && <option value="">(unset)</option>}
                      {ACTION_OPTIONS.map((option) => (
                        <option value={option} key={option}>
                          {ACTION_LABEL[BUT_ACT_CODE[option] as number]?.trim()} · {option}
                        </option>
                      ))}
                    </Select>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
