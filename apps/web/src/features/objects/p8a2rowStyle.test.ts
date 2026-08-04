/**
 * Wave 8 — the four row fills and `getNameColor`'s background test.
 *
 * The inventory row said the pressed 0.7 fill and the "within 0.1 of the
 * button colour" fallback were unverified. Both are here as numbers taken from
 * `packages/engine/layer3/Executive.cpp:16176-16190` and `:16155-16160`, and `within3f` is
 * checked against the SPHERE it really is — the row text ("within 0.1") reads
 * like a per-channel test and it is not.
 */

import { describe, expect, it } from 'vitest';
import {
  NAME_COLOR_CUTOFF,
  ROW_FILL,
  nameTextColor,
  rowFillCss,
  rowFillName,
  within3f,
} from './rowStyle';

describe('the four button fills (Executive.cpp:16176-16190)', () => {
  it('are 0.7 / 0.5 / 0.35 / 0.25', () => {
    expect(ROW_FILL).toEqual({ pressed: 0.7, enabled: 0.5, cloaked: 0.35, disabled: 0.25 });
    expect(rowFillCss('pressed')).toBe('rgb(179, 179, 179)');
    expect(rowFillCss('enabled')).toBe('rgb(128, 128, 128)');
    expect(rowFillCss('cloaked')).toBe('rgb(89, 89, 89)');
    expect(rowFillCss('disabled')).toBe('rgb(64, 64, 64)');
  });

  it('pressed wins over every other state (`rec->hilight == 1` is tested first)', () => {
    expect(rowFillName({ enabled: false, cloaked: false, pressed: true })).toBe('pressed');
    expect(rowFillName({ enabled: true, cloaked: true, pressed: true })).toBe('pressed');
  });

  it('otherwise: not visible -> disabled, ancestor off -> cloaked, else enabled', () => {
    expect(rowFillName({ enabled: false, cloaked: false })).toBe('disabled');
    // `cloaked` only exists for a VISIBLE row: the C code reaches the
    // group walk only inside `else if (rec->visible)`.
    expect(rowFillName({ enabled: false, cloaked: true })).toBe('disabled');
    expect(rowFillName({ enabled: true, cloaked: true })).toBe('cloaked');
    expect(rowFillName({ enabled: true, cloaked: false })).toBe('enabled');
  });
});

describe('within3f (packages/engine/layer0/Vector.h:480-495)', () => {
  it('is Euclidean and INCLUSIVE, not per-channel', () => {
    // exactly on the sphere
    expect(within3f([0.5, 0.5, 0.5], [0.6, 0.5, 0.5], 0.1)).toBe(true);
    expect(within3f([0.5, 0.5, 0.5], [0.60001, 0.5, 0.5], 0.1)).toBe(false);
    // 0.09 on all three channels: a per-channel test would call this "within",
    // the real one does not (distance 0.1559).
    expect(within3f([0.5, 0.5, 0.5], [0.59, 0.59, 0.59], 0.1)).toBe(false);
    // 0.05 on all three: distance 0.0866, inside.
    expect(within3f([0.5, 0.5, 0.5], [0.55, 0.55, 0.55], 0.1)).toBe(true);
  });

  it('the cutoff is 0.1', () => {
    expect(NAME_COLOR_CUTOFF).toBe(0.1);
  });
});

describe('getNameColor fallback (Executive.cpp:16155-16160)', () => {
  const grey = [0.5, 0.5, 0.5];

  it('mode 0 (no colour on the wire) is always the default', () => {
    expect(nameTextColor(undefined, 'enabled')).toBeNull();
    expect(nameTextColor([0.5], 'enabled')).toBeNull();
  });

  it('a colour far from the fill is used', () => {
    expect(nameTextColor([1, 0, 0], 'enabled')).toEqual([1, 0, 0]);
  });

  it('a colour within 0.1 of the fill falls back to the default text colour', () => {
    expect(nameTextColor(grey, 'enabled')).toBeNull();
    expect(nameTextColor([0.55, 0.5, 0.5], 'enabled')).toBeNull();
  });

  it('the SAME colour is used or dropped depending on the row state', () => {
    // PyMOL's grey50 is {0.5,0.5,0.5}: invisible on an enabled row, legible on
    // a disabled one (0.25) and on a pressed one (0.7 — distance 0.346).
    expect(nameTextColor(grey, 'enabled')).toBeNull();
    expect(nameTextColor(grey, 'disabled')).toEqual(grey);
    expect(nameTextColor(grey, 'pressed')).toEqual(grey);
    // grey35 vanishes on a cloaked row and only there.
    const grey35 = [0.35, 0.35, 0.35];
    expect(nameTextColor(grey35, 'cloaked')).toBeNull();
    expect(nameTextColor(grey35, 'enabled')).toEqual(grey35);
    expect(nameTextColor(grey35, 'disabled')).toEqual(grey35);
  });
});
