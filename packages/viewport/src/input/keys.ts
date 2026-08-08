/**
 * Browser `KeyboardEvent` -> PyMOL key codes.
 *
 * The reference implementation is `packages/engine/modules/pmg_qt/keymapping.py:10-97`; every
 * branch below names the line it reproduces. Nothing here decides what a key
 * DOES — that is `PyMOL_Key`/`PyMOL_Special` -> `OrthoKey`/`OrthoSpecial` ->
 * `cmd._ctrl`/`_alt`/`_ctsh`/`_special` -> `cmd.key_mappings`
 * (`packages/engine/modules/pymol/internal.py:426-511`). The client only translates and
 * forwards, exactly as the Qt widget does.
 *
 * The transport is the same `_button` call the mouse uses, multiplexed on
 * `state` (`packages/engine/layer5/PyMOL.cpp:2896-2917`):
 *
 *     state -1  ascii key      -> PyMOL_Key
 *     state -2  GLUT special   -> PyMOL_Special
 *     state  0  mouse down
 *     state  1  mouse up
 */

import { Modifier, modifierMask } from '@tenmol/protocol';

/** `_button` state for a printable/ascii key press (`keymapping.py:74`). */
export const KEY_STATE_ASCII = -1;
/** `_button` state for a GLUT special key press (`keymapping.py:67`). */
export const KEY_STATE_SPECIAL = -2;

/**
 * `keyMap` (`packages/engine/modules/pmg_qt/keymapping.py:10-17`), keyed by `KeyboardEvent.key`
 * instead of by Qt key enum.
 */
export const KEY_MAP: Readonly<Record<string, number>> = {
  Escape: 27,
  Tab: 9,
  Backspace: 8,
  Enter: 13,
  Return: 13,
  Delete: 127,
};

/**
 * `specialMap` (`packages/engine/modules/pmg_qt/keymapping.py:19-41`) — the GLUT special codes,
 * identical to `internal.special_key_codes` (`packages/engine/modules/pymol/internal.py:398-421`)
 * and `packages/engine/layer0/os_gl_glut_pretend.h:14-21`.
 */
export const SPECIAL_MAP: Readonly<Record<string, number>> = {
  ArrowLeft: 100,
  ArrowUp: 101,
  ArrowRight: 102,
  ArrowDown: 103,
  PageUp: 104,
  PageDown: 105,
  Home: 106,
  End: 107,
  Insert: 108,
  F1: 1,
  F2: 2,
  F3: 3,
  F4: 4,
  F5: 5,
  F6: 6,
  F7: 7,
  F8: 8,
  F9: 9,
  F10: 10,
  F11: 11,
  F12: 12,
};

/** GLUT special code -> the name `_special` builds (`internal.py:398-421`). */
export const SPECIAL_KEY_NAMES: Readonly<Record<number, string>> = {
  1: 'F1',
  2: 'F2',
  3: 'F3',
  4: 'F4',
  5: 'F5',
  6: 'F6',
  7: 'F7',
  8: 'F8',
  9: 'F9',
  10: 'F10',
  11: 'F11',
  12: 'F12',
  100: 'left',
  101: 'up',
  102: 'right',
  103: 'down',
  104: 'pgup',
  105: 'pgdn',
  106: 'home',
  107: 'end',
  108: 'insert',
};

/** `internal.modifier_keys` (`packages/engine/modules/pymol/internal.py:390-396`), mask-indexed. */
export const MODIFIER_KEYS: readonly string[] = ['', 'SHFT', 'CTRL', 'CTSH', 'ALT'];

/**
 * The uppercase-ASCII code `keymapping.py` needs for the Ctrl/Alt fallbacks.
 *
 * Qt's key enum for a letter IS its uppercase ASCII code, which is what
 * `key - 64` (Ctrl-A -> 1) and `k = key` (Alt) rely on
 * (`keymapping.py:85-89`). `KeyboardEvent.keyCode` is the same number but is
 * deprecated and layout-dependent, so we derive it from `event.code`, which is
 * physical and standardised: `KeyA` -> 65, `Digit0` -> 48.
 */
export function asciiUpperFromCode(code: string): number {
  if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3);
  if (/^Digit[0-9]$/.test(code)) return code.charCodeAt(5);
  if (/^Numpad[0-9]$/.test(code)) return code.charCodeAt(6);
  return -1;
}

/** The subset of `KeyboardEvent` the key-mapping helpers read. */
export interface KeyEventLike {
  key: string;
  code?: string;
  keyCode?: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/** What to send: `_button(k, state, 0, 0, mod)`. */
export interface KeyButtonArgs {
  k: number;
  state: number;
  mod: number;
}

/**
 * `keyPressEventToPyMOLButtonArgs` (`packages/engine/modules/pmg_qt/keymapping.py:61-97`).
 *
 * Returns `null` when Qt would drop the event (`k > 255 or k < 0`,
 * `keymapping.py:91-93`) — including a bare modifier press, which Qt never
 * delivers as a key at all.
 */
export function keyEventToButtonArgs(ev: KeyEventLike): KeyButtonArgs | null {
  const mod = modifierMask(ev);

  const special = SPECIAL_MAP[ev.key];
  if (special !== undefined) {
    return { k: special, state: KEY_STATE_SPECIAL, mod };
  }

  // A lone modifier keydown is not a key press.
  if (ev.key === 'Shift' || ev.key === 'Control' || ev.key === 'Alt' || ev.key === 'Meta') {
    return null;
  }

  // `keyMap.get(key, -1)`, then `ord(ev.text())` (`keymapping.py:78-83`).
  let k = KEY_MAP[ev.key] ?? -1;
  if (k === -1 && [...ev.key].length === 1) {
    k = ev.key.codePointAt(0) ?? -1;
  }

  const upper =
    ev.code !== undefined && ev.code !== ''
      ? asciiUpperFromCode(ev.code)
      : (ev.keyCode ?? -1);

  // Ctrl held and unresolved -> `k = key - 64` (Ctrl-A -> 1). Qt reaches this
  // because Ctrl-letter produces no text; browsers DO give `key === 'a'`, so we
  // must run it whenever Ctrl is held, not only when `k` is still -1, or
  // Ctrl-A would be sent as 97 and `OrthoKey` would insert the letter 'a' into
  // the command line instead of invoking CTRL-A.
  if (mod & Modifier.Ctrl && upper >= 0) k = upper - 64;
  // Alt held -> `k = key` (the raw uppercase code) (`keymapping.py:88-89`).
  else if (mod & Modifier.Alt && upper >= 0) k = upper;

  if (k > 255 || k < 0) return null;
  return { k, state: KEY_STATE_ASCII, mod };
}

/* ------------------------------------------------------------------ *
 * Shortcut-editor notation
 * ------------------------------------------------------------------ */

/**
 * The modifier prefix `set_key`/`_special` use, from the mask
 * (`internal.py:390-396`, `:456-457`).
 *
 * Note that this is NOT a bitmask lookup: PyMOL indexes `modifier_keys` by the
 * raw mask value, so 1 -> SHFT, 2 -> CTRL, 3 -> CTSH, 4 -> ALT, and anything
 * above 4 has no name at all (Alt+Shift = 5 falls off the end of the list —
 * upstream would IndexError, so we return null).
 */
export function modifierPrefix(mod: number): string | null {
  return MODIFIER_KEYS[mod] ?? null;
}

/**
 * A key event -> PyMOL shortcut notation (`CTRL-A`, `ALT-3`, `CTSH-pgup`,
 * `left`), mirroring `shortcut_menu_gui.keyevent_to_string` /
 * `process_keyevent_string` (`packages/engine/modules/pmg_qt/shortcut_menu_gui.py:32-41,300-342`).
 *
 * Returns null for a key PyMOL cannot bind.
 */
export function keyEventToShortcutName(ev: KeyEventLike): string | null {
  const mod = modifierMask(ev);
  const prefix = modifierPrefix(mod);
  if (prefix === null) return null;
  const withPrefix = (name: string): string => (prefix === '' ? name : `${prefix}-${name}`);

  const special = SPECIAL_MAP[ev.key];
  if (special !== undefined) {
    const name = SPECIAL_KEY_NAMES[special];
    if (name === undefined) return null;
    // Bare F1..F12 are unbound upstream and fall through to scene/view lookup,
    // but they ARE nameable, so the editor may show them.
    return withPrefix(name);
  }
  if (ev.key === 'ArrowUp') return withPrefix('up');
  if (ev.key === 'ArrowDown') return withPrefix('down');

  if ([...ev.key].length === 1) {
    const ch = ev.key;
    if (/^[a-zA-Z]$/.test(ch)) {
      // `set_key` rejects a bare letter and SHFT+letter (`controlling.py:781-790`).
      if (prefix === '' || prefix === 'SHFT') return null;
      return `${prefix}-${ch.toUpperCase()}`;
    }
    if (/^[0-9]$/.test(ch)) {
      if (prefix === '' || prefix === 'SHFT') return null;
      return `${prefix}-${ch}`;
    }
  }
  return null;
}

/**
 * `ShortcutManager.reserved_keys` (`packages/engine/modules/pymol/shortcut_manager.py:21`).
 * The Create-New dialog silently rejects these (`shortcut_menu_gui.py:288-290`).
 */
export const RESERVED_KEYS: readonly string[] = [
  'CTRL-S',
  'CTRL-E',
  'CTRL-O',
  'CTRL-M',
  'up',
  'down',
];

/** True for a shortcut name the Create-New dialog silently refuses. */
export function isReservedKey(name: string): boolean {
  return RESERVED_KEYS.includes(name);
}

/**
 * `cmd.set_key`'s validation (`packages/engine/modules/pymol/controlling.py:771-797`), so the
 * editor can refuse before the round trip instead of after it.
 */
export function validateShortcutName(name: string): string | null {
  const dash = name.indexOf('-');
  const prefix = dash < 0 ? '' : name.slice(0, dash);
  const bare = dash < 0 ? name : name.slice(dash + 1);
  if (dash >= 0 && !MODIFIER_KEYS.includes(prefix)) {
    return `unknown modifier "${prefix}" (expected one of ${MODIFIER_KEYS.filter(Boolean).join(', ')})`;
  }
  if ([...bare].length > 1) {
    const canonical = bare.startsWith('F') ? bare : bare.toLowerCase();
    if (!Object.values(SPECIAL_KEY_NAMES).includes(canonical)) {
      return `unknown special key "${bare}"`;
    }
    return null;
  }
  if (prefix === '') return 'a single letter needs a modifier';
  if (prefix === 'SHFT') return 'SHFT alone cannot be used with a letter';
  return null;
}
