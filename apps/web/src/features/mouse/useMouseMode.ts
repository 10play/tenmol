/**
 * The live mouse-mode state, read back from PyMOL.
 *
 * NOTHING HERE IS OPTIMISTIC. The block issues `cmd.mouse(...)` /
 * `cmd.config_mouse(...)` / `cmd.button(...)` and then re-reads the settings;
 * it never assumes the write landed. That matters because `cmd.mouse()` has
 * side effects beyond the table — it also calls `unpick()` or `deselect()` and
 * `refresh_wizard()` (`modules/pymol/controlling.py:679-685`) — and because a
 * script or a plugin can change the mode behind the UI's back.
 *
 * WHAT IS READ, AND WHY THOSE FOUR:
 *   button_mode           int  — index into the ring (negative = off-ring)
 *   button_mode_name      str  — the display string the block prints
 *   mouse_selection_mode  int  — 0..6, the selection level line
 *   mouse_grid            bool — whether the 5-char grid is shown at all
 *
 * The 80-slot ACTION TABLE itself is not readable: `ButModeGet` is C-only
 * (grepped `modules/`). Plan §A9 settles the answer — mirror `mode_dict` and
 * expand it locally (`@tenmol/viewport/input`), keyed by the mode name PyMOL
 * just told us. So the grid is derived from `button_mode_name`, which IS
 * authoritative.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MODE_NAME_DICT,
  emptyButModeTable,
  isModeName,
  tableForMode,
  type ModeName,
} from './tables';
import { useSession } from '../../app';

export interface MouseModeState {
  /** `mode_dict` key, e.g. `three_button_viewing`. */
  mode: ModeName | null;
  /** `button_mode_name` — what the block prints, e.g. `3-Button Viewing`. */
  displayName: string;
  buttonMode: number;
  selectionMode: number;
  grid: boolean;
  /** The 80-slot table, derived from `mode`. All -1 until the first read. */
  table: number[];
  loaded: boolean;
  error: string | null;
}

const INITIAL: MouseModeState = {
  mode: null,
  displayName: '',
  buttonMode: 0,
  selectionMode: 1,
  grid: false,
  table: emptyButModeTable(),
  loaded: false,
  error: null,
};

/** `button_mode_name` -> `mode_dict` key. The inverse of `mode_name_dict`. */
export function modeFromDisplayName(displayName: string): ModeName | null {
  for (const [key, label] of Object.entries(MODE_NAME_DICT)) {
    if (label === displayName && isModeName(key)) return key;
  }
  // `default` has no display name: cmd.mouse writes the raw key through.
  return isModeName(displayName) ? displayName : null;
}

/** 4 Hz. The mode only changes on a user action or a script, never per frame. */
const POLL_MS = 250;

export function useMouseMode(): MouseModeState & { refresh: () => void } {
  const session = useSession();
  const [state, setState] = useState<MouseModeState>(INITIAL);
  const alive = useRef(true);
  const inFlight = useRef(false);

  const read = useCallback(async (): Promise<void> => {
    if (inFlight.current || !session.conn.isOpen) return;
    inFlight.current = true;
    try {
      const [displayName, buttonMode, selectionMode, grid] = await Promise.all([
        session.call<string>('get_setting_text', ['button_mode_name']),
        session.call<number>('get_setting_int', ['button_mode']),
        session.call<number>('get_setting_int', ['mouse_selection_mode']),
        session.call<number>('get_setting_boolean', ['mouse_grid']),
      ]);
      if (!alive.current) return;
      const mode = modeFromDisplayName(displayName);
      setState({
        mode,
        displayName,
        buttonMode: Number(buttonMode),
        selectionMode: Number(selectionMode),
        grid: Boolean(Number(grid)),
        table: mode ? tableForMode(mode) : emptyButModeTable(),
        loaded: true,
        error: null,
      });
    } catch (error) {
      if (!alive.current) return;
      setState((previous) => ({
        ...previous,
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      inFlight.current = false;
    }
  }, [session]);

  useEffect(() => {
    alive.current = true;
    void read();
    const timer = setInterval(() => void read(), POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [read]);

  const refresh = useCallback(() => void read(), [read]);
  return { ...state, refresh };
}
