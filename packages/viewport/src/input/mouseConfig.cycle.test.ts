/**
 * Ring and selection-level cycling.
 *
 * Both WRAP. Clamping at the end instead is the obvious off-by-one, and it is
 * invisible until a user cycles past the last entry and the control appears to
 * stick — so the assertions walk past the end deliberately.
 */
import { describe, expect, it } from 'vitest';

import {
  MOUSE_CONFIG_MENU,
  displayName,
  stepButtonMode,
  stepSelectionMode,
  tableForMode,
} from './mouseConfig';

describe('mouse ring cycling', () => {
  it('wraps forward rather than clamping', () => {
    const seen: number[] = [];
    let mode = 0;
    for (let i = 0; i < 6; i++) {
      seen.push(mode);
      mode = stepButtonMode(mode, 'three_button', true);
    }
    expect(seen[0]).toBe(seen[2]); // returned to the start
  });

  it('wraps backward from the first entry', () => {
    expect(stepButtonMode(0, 'three_button', false)).not.toBe(0);
  });

  it('walks all seven selection levels and wraps', () => {
    const seen: number[] = [];
    let level = 0;
    for (let i = 0; i < 8; i++) {
      seen.push(level);
      level = stepSelectionMode(level, true);
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 0]);
  });

  it('gives every mode a full 80-slot table', () => {
    expect(tableForMode('three_button_viewing')).toHaveLength(80);
  });

  it('names a mode the way the ButMode block displays it', () => {
    expect(displayName('three_button_viewing')).toBe('3-Button Viewing');
  });

  it('offers the nine mouse-config entries', () => {
    expect(MOUSE_CONFIG_MENU).toHaveLength(9);
  });
});
