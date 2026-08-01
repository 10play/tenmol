/**
 * Key translation, checked branch by branch against
 * `modules/pmg_qt/keymapping.py` and against the GLUT special codes in
 * `modules/pymol/internal.py`, plus a diff of the default binding table against
 * `modules/pymol/shortcut_dict.py`.
 */

import { describe, expect, it } from 'vitest';

import {
  KEY_STATE_ASCII,
  KEY_STATE_SPECIAL,
  MODIFIER_KEYS,
  RESERVED_KEYS,
  SPECIAL_KEY_NAMES,
  SPECIAL_MAP,
  asciiUpperFromCode,
  isReservedKey,
  keyEventToButtonArgs,
  keyEventToShortcutName,
  modifierPrefix,
  validateShortcutName,
  type KeyEventLike,
} from './keys';
import { DEFAULT_SHORTCUTS, DEFAULT_SHORTCUT_BY_KEY, shortcutGroup } from './shortcuts';
import { hasPython, pyJson } from './butmode.test';

const ev = (partial: Partial<KeyEventLike> & { key: string }): KeyEventLike => partial;

describe('special keys (state -2)', () => {
  it('uses the GLUT codes internal.special_key_codes declares', () => {
    if (!hasPython) return;
    const python = pyJson<Record<string, string>>(
      'import json;from pymol import internal;' +
        'print(json.dumps({str(k): v for k, v in internal.special_key_codes.items()}))',
    );
    const mine: Record<string, string> = {};
    for (const [code, name] of Object.entries(SPECIAL_KEY_NAMES)) mine[code] = name;
    expect(mine).toEqual(python);
  });

  it('maps the arrows, paging keys and F1..F12', () => {
    expect(keyEventToButtonArgs(ev({ key: 'ArrowLeft' }))).toEqual({
      k: 100,
      state: KEY_STATE_SPECIAL,
      mod: 0,
    });
    expect(keyEventToButtonArgs(ev({ key: 'ArrowDown' }))?.k).toBe(103);
    expect(keyEventToButtonArgs(ev({ key: 'PageUp' }))?.k).toBe(104);
    expect(keyEventToButtonArgs(ev({ key: 'End' }))?.k).toBe(107);
    expect(keyEventToButtonArgs(ev({ key: 'Insert' }))?.k).toBe(108);
    expect(keyEventToButtonArgs(ev({ key: 'F1' }))?.k).toBe(1);
    expect(keyEventToButtonArgs(ev({ key: 'F12' }))?.k).toBe(12);
    expect(Object.keys(SPECIAL_MAP)).toHaveLength(21);
  });

  it('carries the modifier mask with a special key', () => {
    expect(keyEventToButtonArgs(ev({ key: 'PageUp', ctrlKey: true }))).toEqual({
      k: 104,
      state: KEY_STATE_SPECIAL,
      mod: 2,
    });
    expect(keyEventToButtonArgs(ev({ key: 'PageUp', ctrlKey: true, shiftKey: true }))?.mod).toBe(3);
    expect(keyEventToButtonArgs(ev({ key: 'Home', altKey: true }))?.mod).toBe(4);
    // Meta folds into CTRL, exactly as keymapping.py:51-52 does.
    expect(keyEventToButtonArgs(ev({ key: 'Home', metaKey: true }))?.mod).toBe(2);
  });
});

describe('ascii keys (state -1)', () => {
  it('maps the five keyMap entries', () => {
    expect(keyEventToButtonArgs(ev({ key: 'Escape' }))).toEqual({
      k: 27,
      state: KEY_STATE_ASCII,
      mod: 0,
    });
    expect(keyEventToButtonArgs(ev({ key: 'Tab' }))?.k).toBe(9);
    expect(keyEventToButtonArgs(ev({ key: 'Backspace' }))?.k).toBe(8);
    expect(keyEventToButtonArgs(ev({ key: 'Enter' }))?.k).toBe(13);
    expect(keyEventToButtonArgs(ev({ key: 'Delete' }))?.k).toBe(127);
  });

  it('sends printable characters as their code point', () => {
    expect(keyEventToButtonArgs(ev({ key: 'a', code: 'KeyA' }))?.k).toBe(97);
    expect(keyEventToButtonArgs(ev({ key: 'A', code: 'KeyA', shiftKey: true }))).toEqual({
      k: 65,
      state: KEY_STATE_ASCII,
      mod: 1,
    });
    expect(keyEventToButtonArgs(ev({ key: ' ', code: 'Space' }))?.k).toBe(32);
    expect(keyEventToButtonArgs(ev({ key: '@', code: 'Digit2', shiftKey: true }))?.k).toBe(64);
  });

  it('turns Ctrl-letter into the control code (keymapping.py:85-86)', () => {
    expect(keyEventToButtonArgs(ev({ key: 'a', code: 'KeyA', ctrlKey: true }))).toEqual({
      k: 1,
      state: KEY_STATE_ASCII,
      mod: 2,
    });
    expect(keyEventToButtonArgs(ev({ key: 'z', code: 'KeyZ', ctrlKey: true }))?.k).toBe(26);
    // Ctrl+Shift-D -> 4 with mod 3, which OrthoKey turns into cmd._ctsh('D').
    expect(
      keyEventToButtonArgs(ev({ key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true })),
    ).toEqual({ k: 4, state: KEY_STATE_ASCII, mod: 3 });
  });

  it('sends the raw uppercase code for Alt-letter (keymapping.py:88-89)', () => {
    expect(keyEventToButtonArgs(ev({ key: 'a', code: 'KeyA', altKey: true }))).toEqual({
      k: 65,
      state: KEY_STATE_ASCII,
      mod: 4,
    });
    // ALT-3 attaches a sulfone; the digit must arrive as 51, not as 0x33 mangled.
    expect(keyEventToButtonArgs(ev({ key: '3', code: 'Digit3', altKey: true }))?.k).toBe(51);
  });

  it('derives the uppercase code from event.code, not the deprecated keyCode', () => {
    expect(asciiUpperFromCode('KeyA')).toBe(65);
    expect(asciiUpperFromCode('KeyZ')).toBe(90);
    expect(asciiUpperFromCode('Digit0')).toBe(48);
    expect(asciiUpperFromCode('Numpad7')).toBe(55);
    expect(asciiUpperFromCode('Space')).toBe(-1);
    // With a dead-key layout the browser still reports the physical code, so
    // Ctrl-A works on AZERTY where `key` would be 'q'.
    expect(keyEventToButtonArgs(ev({ key: 'q', code: 'KeyA', ctrlKey: true }))?.k).toBe(1);
  });

  it('drops what Qt drops', () => {
    expect(keyEventToButtonArgs(ev({ key: 'Shift', shiftKey: true }))).toBeNull();
    expect(keyEventToButtonArgs(ev({ key: 'Control', ctrlKey: true }))).toBeNull();
    expect(keyEventToButtonArgs(ev({ key: 'Alt', altKey: true }))).toBeNull();
    expect(keyEventToButtonArgs(ev({ key: 'AudioVolumeUp' }))).toBeNull();
    // out of the 0..255 window (keymapping.py:91-93)
    expect(keyEventToButtonArgs(ev({ key: '中' }))).toBeNull();
  });
});

describe('shortcut notation', () => {
  it('indexes modifier_keys by the raw mask, as internal.py does', () => {
    if (!hasPython) return;
    const python = pyJson<string[]>(
      'import json;from pymol import internal;print(json.dumps(internal.modifier_keys))',
    );
    expect(MODIFIER_KEYS).toEqual(python);
    expect(modifierPrefix(0)).toBe('');
    expect(modifierPrefix(1)).toBe('SHFT');
    expect(modifierPrefix(2)).toBe('CTRL');
    expect(modifierPrefix(3)).toBe('CTSH');
    expect(modifierPrefix(4)).toBe('ALT');
    // 5 = Alt+Shift has no name upstream (the list ends at 4).
    expect(modifierPrefix(5)).toBeNull();
  });

  it('renders a captured key the way the Qt capture field does', () => {
    expect(keyEventToShortcutName(ev({ key: 'a', code: 'KeyA', ctrlKey: true }))).toBe('CTRL-A');
    expect(keyEventToShortcutName(ev({ key: 'a', code: 'KeyA', metaKey: true }))).toBe('CTRL-A');
    expect(
      keyEventToShortcutName(ev({ key: 'a', code: 'KeyA', ctrlKey: true, shiftKey: true })),
    ).toBe('CTSH-A');
    expect(keyEventToShortcutName(ev({ key: '3', code: 'Digit3', altKey: true }))).toBe('ALT-3');
    expect(keyEventToShortcutName(ev({ key: 'PageUp' }))).toBe('pgup');
    expect(keyEventToShortcutName(ev({ key: 'PageDown', ctrlKey: true }))).toBe('CTRL-pgdn');
    expect(keyEventToShortcutName(ev({ key: 'ArrowUp' }))).toBe('up');
    expect(keyEventToShortcutName(ev({ key: 'Insert' }))).toBe('insert');
    // a bare letter and SHFT+letter are rejected by set_key
    expect(keyEventToShortcutName(ev({ key: 'a', code: 'KeyA' }))).toBeNull();
    expect(keyEventToShortcutName(ev({ key: 'A', code: 'KeyA', shiftKey: true }))).toBeNull();
  });

  it('knows the six reserved keys', () => {
    if (hasPython) {
      const python = pyJson<string[]>(
        'import json, ast\n' +
          'src = open("modules/pymol/shortcut_manager.py").read()\n' +
          'head = "reserved_keys = "\n' +
          'i = src.index(head) + len(head)\n' +
          'j = src.index(")", i) + 1\n' +
          'print(json.dumps(list(ast.literal_eval(src[i:j]))))',
      );
      expect(RESERVED_KEYS).toEqual(python);
    }
    expect(isReservedKey('CTRL-S')).toBe(true);
    expect(isReservedKey('up')).toBe(true);
    expect(isReservedKey('CTRL-A')).toBe(false);
  });

  it('validates the way cmd.set_key validates', () => {
    expect(validateShortcutName('CTRL-A')).toBeNull();
    expect(validateShortcutName('ALT-9')).toBeNull();
    expect(validateShortcutName('pgup')).toBeNull();
    expect(validateShortcutName('F5')).toBeNull();
    expect(validateShortcutName('CTRL-F12')).toBeNull();
    expect(validateShortcutName('A')).toMatch(/needs a modifier/);
    expect(validateShortcutName('SHFT-A')).toMatch(/SHFT alone/);
    expect(validateShortcutName('HYPER-A')).toMatch(/unknown modifier/);
    expect(validateShortcutName('CTRL-nosuchkey')).toMatch(/unknown special key/);
  });
});

describe('default shortcut table', () => {
  it('is shortcut_dict_ref, entry for entry and in order', () => {
    if (!hasPython) return;
    const python = pyJson<[string, string, string][]>(
      'import json;from pymol.shortcut_dict import shortcut_dict_ref;' +
        'print(json.dumps([[k, v[0], v[1]] for k, v in shortcut_dict_ref.items()]))',
    );
    expect(
      DEFAULT_SHORTCUTS.map((entry) => [entry.key, entry.command, entry.description]),
    ).toEqual(python);
    expect(DEFAULT_SHORTCUTS.length).toBeGreaterThan(100);
  });

  it('carries the bindings the inventory names explicitly', () => {
    expect(DEFAULT_SHORTCUT_BY_KEY.get('CTRL-A')?.command).toBe('select sele, all, 1');
    expect(DEFAULT_SHORTCUT_BY_KEY.get('left')?.command).toBe('_ backward');
    expect(DEFAULT_SHORTCUT_BY_KEY.get('home')?.command).toBe('zoom animate=-1');
    expect(DEFAULT_SHORTCUT_BY_KEY.get('CTSH-R')?.command).toBe('h_fill');
    expect(DEFAULT_SHORTCUT_BY_KEY.get('ALT-9')?.command).toContain('benzene');
    for (let n = 1; n <= 12; n++) {
      expect(DEFAULT_SHORTCUT_BY_KEY.get(`CTRL-F${n}`)?.command).toBe(`scene F${n}, store`);
      expect(DEFAULT_SHORTCUT_BY_KEY.get(`CTSH-F${n}`)?.command).toBe(`scene SHFT-F${n}, store`);
    }
    // Bare F-keys are NOT bound: they fall through to scene/view name lookup.
    expect(DEFAULT_SHORTCUT_BY_KEY.has('F1')).toBe(false);
    expect(DEFAULT_SHORTCUT_BY_KEY.has('SHFT-F1')).toBe(false);
    // ALT-O, ALT-U and ALT-X are the three gaps in the amino-acid ring.
    for (const missing of ['ALT-O', 'ALT-U', 'ALT-X']) {
      expect(DEFAULT_SHORTCUT_BY_KEY.has(missing)).toBe(false);
    }
  });

  it('groups rows for the editor', () => {
    expect(shortcutGroup('CTRL-A')).toBe('editing');
    expect(shortcutGroup('ALT-A')).toBe('amino-acid attach');
    expect(shortcutGroup('CTSH-R')).toBe('chemical editing');
    expect(shortcutGroup('ALT-3')).toBe('fragment attach');
    expect(shortcutGroup('CTRL-F7')).toBe('function keys');
    expect(shortcutGroup('pgup')).toBe('navigation / movie / scene');
  });
});
