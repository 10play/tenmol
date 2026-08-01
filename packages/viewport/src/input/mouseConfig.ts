/**
 * Mouse configuration: mode -> 80-slot table, ring stepping, and the exact
 * `cmd` calls the ButMode block issues.
 *
 * Everything here is pure. It computes what PyMOL WILL have in `ButMode` after
 * `cmd.mouse(mode)` ran, so the block can draw the grid; the state of record is
 * still `cmd.get('button_mode')` / `cmd.get('button_mode_name')` /
 * `cmd.get('mouse_selection_mode')`, read back after every write.
 */

import {
  BUT_ACT_CODE,
  buttonSlot,
  emptyButModeTable,
  BUT_MODE_NOTHING,
} from './butmode';
import {
  MODE_DICT,
  MODE_NAME_DICT,
  MODE_NAME_LIST,
  RING_DICT,
  type ModeName,
  type RingName,
} from './modes';

/**
 * Apply a mode's bindings into a fresh 80-slot table, in list order.
 *
 * `cmd.mouse()` loops `for a in mode_list: button(*a)` (`controlling.py:672`)
 * over a table the C core does NOT clear first — but every mode listed in
 * `mode_dict` writes every slot it cares about, and the modes are only ever
 * reached through `cmd.mouse`, which has just run the previous mode's rows.
 * Starting from "unbound" is therefore what the user sees for the grid: a slot
 * this mode does not mention is drawn blank, which is what `ButMode::draw`
 * does for `Mode[a] < 0`.
 *
 * Duplicate rows overwrite, matching PyMOL: `three_button_motions` binds
 * `double_left` twice and the second (`torf`) wins.
 */
export function tableForMode(mode: ModeName): number[] {
  const table = emptyButModeTable();
  for (const [button, modifier, action] of MODE_DICT[mode]) {
    const slot = buttonSlot(button, modifier);
    const code = BUT_ACT_CODE[action.toLowerCase()];
    table[slot] = code === undefined ? BUT_MODE_NOTHING : code;
  }
  return table;
}

/** `mode_name_dict.get(mode, mode)` (`controlling.py:652`). */
export function displayName(mode: string): string {
  return MODE_NAME_DICT[mode] ?? mode;
}

export function isModeName(value: string): value is ModeName {
  return Object.prototype.hasOwnProperty.call(MODE_DICT, value);
}

export function isRingName(value: string): value is RingName {
  return Object.prototype.hasOwnProperty.call(RING_DICT, value);
}

/**
 * Resolve `button_mode` against a ring exactly as `cmd.mouse(None)` does
 * (`controlling.py:646-661`).
 *
 * `bm >= 0` indexes the ring modulo its length. `bm < 0` encodes a mode that is
 * NOT in the ring, as `-1 - index_into(mode_name_list)`; PyMOL then takes
 * `(-1 - bm) % len(mode_name_list)`.
 */
export function modeForButtonMode(buttonMode: number, ring: RingName): ModeName {
  const ringModes = RING_DICT[ring];
  if (buttonMode >= 0) {
    const index = ((buttonMode % ringModes.length) + ringModes.length) % ringModes.length;
    return ringModes[index] as ModeName;
  }
  const raw = -1 - buttonMode;
  const index = ((raw % MODE_NAME_LIST.length) + MODE_NAME_LIST.length) % MODE_NAME_LIST.length;
  return MODE_NAME_LIST[index] as ModeName;
}

/** `mouse('forward'|'backward')` — `(bm ± 1) % len(mouse_ring)` (`:628-636`). */
export function stepButtonMode(buttonMode: number, ring: RingName, forward: boolean): number {
  const length = RING_DICT[ring].length;
  const next = (buttonMode + (forward ? 1 : -1)) % length;
  return next < 0 ? next + length : next;
}

/** `mouse('select_forward'|'select_backward')` — wraps 0..6 (`:637-646`). */
export function stepSelectionMode(selectionMode: number, forward: boolean): number {
  if (forward) return selectionMode + 1 > 6 ? 0 : selectionMode + 1;
  return selectionMode - 1 < 0 ? 6 : selectionMode - 1;
}

/**
 * The `mouse_config` pop-up, verbatim from `modules/pymol/menu.py:82-101`.
 *
 * Nine entries in this exact order, including the separator, and note that
 * three of them call `cmd.mouse` rather than `cmd.config_mouse` — those jump to
 * a mode OUTSIDE the ring (the negative `button_mode` encoding) instead of
 * replacing the ring.
 */
export interface MouseConfigItem {
  /** PyMOL's popup item kind: 1 = command, 0 = separator (`layer4/PopUp.cpp`). */
  kind: 0 | 1;
  label: string;
  /** The command string the leaf returns. Executed verbatim through `t:'do'`. */
  command: string;
}

export const MOUSE_CONFIG_MENU: readonly MouseConfigItem[] = [
  { kind: 1, label: '3-Button Motions', command: 'cmd.config_mouse("three_button_motions")' },
  { kind: 1, label: '3-Button Editing', command: 'cmd.config_mouse("three_button_editing")' },
  { kind: 1, label: '3-Button Viewing', command: 'cmd.mouse("three_button_viewing")' },
  { kind: 1, label: '3-Button Lights', command: 'cmd.mouse("three_button_lights")' },
  { kind: 1, label: '3-Button All Modes', command: 'cmd.config_mouse("three_button_all_modes")' },
  { kind: 0, label: '', command: '' },
  { kind: 1, label: '2-Button Editing', command: 'cmd.config_mouse("two_button_editing")' },
  { kind: 1, label: '2-Button Viewing', command: 'cmd.config_mouse("two_button_viewing")' },
  { kind: 1, label: '2-Button Lights', command: 'cmd.mouse("two_button_lights")' },
];
