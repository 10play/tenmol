import { describe, expect, it } from 'vitest';
import { colorFromCode, isColorCodeAt, parseColorCodes, stripColorCodes } from './colorCodes';

/**
 * Grammar from `layer1/Text.cpp:507-548`. The literals below are the real
 * strings the wizards emit: `appearance.py:38-53` builds every colour label
 * with its own swatch, `cleanup.py:133` uses `\999Ligand:\000 `,
 * `renaming.py:12` uses `\999<old>\--- to: \999`.
 */
describe('parseColorCodes', () => {
  it('leaves plain text alone', () => {
    expect(parseColorCodes('Measurement')).toEqual([{ text: 'Measurement', color: null }]);
  });

  it('splits a leading colour code off appearance.py swatches', () => {
    expect(parseColorCodes('\\900red')).toEqual([{ text: 'red', color: 'rgb(255, 0, 0)' }]);
    expect(parseColorCodes('\\090green')).toEqual([{ text: 'green', color: 'rgb(0, 255, 0)' }]);
    expect(parseColorCodes('\\559slate')).toEqual([
      { text: 'slate', color: 'rgb(142, 142, 255)' },
    ]);
  });

  it('handles \\--- as a reset to the default colour (renaming.py:12)', () => {
    expect(parseColorCodes('Renaming \\999ala\\--- to: \\999gly_')).toEqual([
      { text: 'Renaming ', color: null },
      { text: 'ala', color: 'rgb(255, 255, 255)' },
      { text: ' to: ', color: null },
      { text: 'gly_', color: 'rgb(255, 255, 255)' },
    ]);
  });

  it('handles two codes back to back (cleanup.py:133)', () => {
    expect(parseColorCodes('\\999Ligand:\\000 lig')).toEqual([
      { text: 'Ligand:', color: 'rgb(255, 255, 255)' },
      { text: ' lig', color: 'rgb(0, 0, 0)' },
    ]);
  });

  it('is not fooled by a backslash that is not a code', () => {
    // `label.py:16-17` templates contain a literal backtick and backslashes.
    expect(parseColorCodes('{chain}/{resn}\\`{resi}')).toEqual([
      { text: '{chain}/{resn}\\`{resi}', color: null },
    ]);
    expect(parseColorCodes('\\12')).toEqual([{ text: '\\12', color: null }]);
    expect(parseColorCodes('\\--')).toEqual([{ text: '\\--', color: null }]);
  });

  it('always returns at least one span', () => {
    expect(parseColorCodes('')).toEqual([{ text: '', color: null }]);
    expect(parseColorCodes('\\900')).toEqual([{ text: '', color: null }]);
  });

  it('maps each digit to d/9 of full scale (Text.cpp:540-543)', () => {
    expect(colorFromCode('\\888')).toBe('rgb(227, 227, 227)');
    expect(colorFromCode('\\---')).toBeNull();
  });

  it('detects codes positionally', () => {
    expect(isColorCodeAt('ab\\900c', 2)).toBe(true);
    expect(isColorCodeAt('ab\\900c', 1)).toBe(false);
  });
});

describe('stripColorCodes', () => {
  it('matches message.py:7 _nuke_color_re for the digit form', () => {
    expect(stripColorCodes('\\955note \\595here')).toBe('note here');
  });

  it('also strips \\--- , which PyMOL own stripper misses', () => {
    expect(stripColorCodes('a\\---b')).toBe('ab');
  });
});
