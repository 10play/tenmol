/**
 * The key/mouse multiplexing contract.
 *
 * PyMOL has no separate key channel: a keypress rides `_button(k, state, x, y,
 * mod)` with state -1 for ASCII and -2 for a special key. Getting the state
 * wrong sends a printable character down the special-key table, where it
 * resolves to an unrelated action rather than failing.
 */
import { describe, expect, it } from 'vitest';

import {
  KEY_STATE_ASCII,
  KEY_STATE_SPECIAL,
  MODIFIER_KEYS,
  keyEventToButtonArgs,
  keyEventToShortcutName,
  modifierPrefix,
} from './keys';

const ev = (over: Record<string, unknown>) => ({
  key: '',
  code: '',
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...over,
}) as never;

describe('key/mouse multiplexing', () => {
  it('uses -1 for ASCII and -2 for special', () => {
    expect(KEY_STATE_ASCII).toBe(-1);
    expect(KEY_STATE_SPECIAL).toBe(-2);
  });

  it('sends a function key down the SPECIAL path', () => {
    expect(keyEventToButtonArgs(ev({ key: 'F1', code: 'F1' }))).toMatchObject({
      state: KEY_STATE_SPECIAL,
    });
  });

  it('sends an arrow down the SPECIAL path with its GLUT code', () => {
    expect(keyEventToButtonArgs(ev({ key: 'ArrowRight', code: 'ArrowRight' }))).toMatchObject({
      k: 102,
      state: KEY_STATE_SPECIAL,
    });
  });

  it('encodes Ctrl+A as the CONTROL CHARACTER, not the letter', () => {
    // 0x01, PyMOL's convention. Sending 65 ("A") with mod=2 would be a
    // different keypress entirely.
    expect(keyEventToButtonArgs(ev({ key: 'a', code: 'KeyA', ctrlKey: true }))).toMatchObject({
      k: 1,
      state: KEY_STATE_ASCII,
      mod: 2,
    });
  });

  it('names modifiers the way cmd.button and set_key expect', () => {
    expect([...MODIFIER_KEYS]).toEqual(['', 'SHFT', 'CTRL', 'CTSH', 'ALT']);
    expect([0, 1, 2, 3, 4].map(modifierPrefix)).toEqual(['', 'SHFT', 'CTRL', 'CTSH', 'ALT']);
  });

  it('renders a shortcut name PyMOL would accept', () => {
    expect(keyEventToShortcutName(ev({ key: 'a', code: 'KeyA', ctrlKey: true }))).toBe('CTRL-A');
  });
});
