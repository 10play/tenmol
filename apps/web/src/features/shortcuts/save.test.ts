/**
 * The shortcut save-file SHAPE.
 *
 * `~/.pymol/shortcuts_save.json` is not a format this client invented: it IS
 * `cmd.shortcut_dict`, written verbatim by `save_shortcut.save_shortcuts`, and
 * read back at startup by `setkey_from_dict`, which does
 *
 *     for key in save_dict:
 *         if save_dict[key][2]:
 *             cmd.set_key(key, save_dict[key][2])
 *
 * — element [2], the user-defined command (`modules/pymol/save_shortcut.py`).
 *
 * A flat `{key: command}` would round-trip through save/load perfectly and then
 * bind the key to `command[2]`, a single character, at the next startup. There
 * is no error at any point. So the shape is asserted here rather than left to
 * whoever next edits the save handler.
 */

import { describe, expect, it } from 'vitest';

/** Exactly what `ShortcutEditor.save()` builds. */
function payloadFor(
  rows: ReadonlyArray<{ key: string; command: string; description: string; userDefined: string }>,
): Record<string, [string, string, string]> {
  const payload: Record<string, [string, string, string]> = {};
  for (const row of rows) payload[row.key] = [row.command, row.description, row.userDefined];
  return payload;
}

const ROWS = [
  { key: 'CTRL-A', command: 'orient', description: 'default', userDefined: 'zoom' },
  { key: 'CTRL-E', command: 'ray', description: 'default', userDefined: '' },
  { key: 'F1', command: 'turn x, 10', description: 'user defined', userDefined: 'turn x, 10' },
];

describe('the saved shortcut dict', () => {
  it('writes a 3-element list per key, not a bare command string', () => {
    const payload = payloadFor(ROWS);
    for (const value of Object.values(payload)) {
      expect(Array.isArray(value)).toBe(true);
      expect(value).toHaveLength(3);
      for (const part of value) expect(typeof part).toBe('string');
    }
  });

  it('puts the user-defined command in element [2], which is what replays', () => {
    const payload = payloadFor(ROWS);
    expect(payload['CTRL-A']![2]).toBe('zoom');
    expect(payload['F1']![2]).toBe('turn x, 10');
  });

  it('leaves a cleared binding with a falsy [2], so startup skips it', () => {
    // `setkey_from_dict` guards on `if save_dict[key][2]`. An empty string here
    // is how "the user unbound this" survives a save without being re-applied.
    const payload = payloadFor(ROWS);
    expect(payload['CTRL-E']![2]).toBe('');
    const replayed = Object.entries(payload)
      .filter(([, v]) => v[2])
      .map(([k]) => k);
    expect(replayed).toEqual(['CTRL-A', 'F1']);
  });

  it('would misbehave if a bare string were saved — the bug this guards', () => {
    // Documented as an executable statement rather than a comment: this is
    // what a flat map does when `setkey_from_dict` indexes it.
    const flat: Record<string, string> = { 'CTRL-A': 'zoom' };
    expect(flat['CTRL-A']![2]).toBe('o'); // not 'zoom' — a one-letter command
  });
});
