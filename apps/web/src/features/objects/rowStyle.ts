/**
 * The four row-button fills and the name-colour rule, as data.
 *
 * `CExecutive::draw` (`layer3/Executive.cpp:16176-16190`) declares the fills
 * once and picks one per row (`:16443-16463`):
 *
 *   pressed   {0.7,0.7,0.7}   `rec->hilight == 1`, or the pointer is over the
 *                             row's name button (`OverWhat == 1`)
 *   enabled   {0.5,0.5,0.5}   visible, and every ancestor group is visible
 *   cloaked   {0.35,0.35,0.35} visible, but an ancestor group is not
 *   disabled  {0.25,0.25,0.25} not visible
 *
 * That fill is then handed to `getNameColor` as its **background**
 * (`:16469`, `bg_rgb = but_color`), and the mode-1/2 colour is used only when
 * it is far enough from it:
 *
 *     if (color != cColorDefault) {
 *       const float* rgb = ColorGet(obj->G, color);
 *       if (!within3f(bg_rgb, rgb, 0.1f))  return rgb;   // :16155-16160
 *     }
 *     return default_rgb;
 *
 * `within3f` (`layer0/Vector.h:480-495`) is a EUCLIDEAN test with per-axis
 * early-outs — `sqrt(dr^2+dg^2+db^2) <= 0.1`, not a per-channel one — so a
 * colour can differ by 0.09 on all three channels (distance 0.156) and still
 * be used. This file reproduces exactly that, including the `<=`.
 */

/** `float pressedColor[3] = {0.7F, 0.7F, 0.7F}` and friends. */
export const ROW_FILL = {
  pressed: 0.7,
  enabled: 0.5,
  cloaked: 0.35,
  disabled: 0.25,
} as const;

export type RowFillName = keyof typeof ROW_FILL;

export interface RowFillInput {
  enabled: boolean;
  cloaked: boolean;
  /** `rec->hilight == 1 || (row == I->Over && I->OverWhat == 1)`. */
  pressed?: boolean;
}

/** Which of the four fills `CExecutive::draw` would use for this row. */
export function rowFillName(row: RowFillInput): RowFillName {
  if (row.pressed) return 'pressed';
  if (!row.enabled) return 'disabled';
  return row.cloaked ? 'cloaked' : 'enabled';
}

/** The same fill as a CSS colour, so a test can compare against the DOM. */
export function rowFillCss(name: RowFillName): string {
  const channel = Math.round(ROW_FILL[name] * 255);
  return `rgb(${channel}, ${channel}, ${channel})`;
}

/**
 * `within3f(v1, v2, dist)` — Euclidean distance within `dist`, inclusive.
 * Ported literally so the early-out axes cannot drift from the C version.
 */
export function within3f(
  a: readonly number[],
  b: readonly number[],
  dist: number,
): boolean {
  const dx = Math.abs((a[0] ?? 0) - (b[0] ?? 0));
  if (dx > dist) return false;
  const dy = Math.abs((a[1] ?? 0) - (b[1] ?? 0));
  if (dy > dist) return false;
  const dz = Math.abs((a[2] ?? 0) - (b[2] ?? 0));
  if (dz > dist) return false;
  return dx * dx + dy * dy + dz * dz <= dist * dist;
}

/** `getNameColor`'s cutoff (`Executive.cpp:16157`). */
export const NAME_COLOR_CUTOFF = 0.1;

/**
 * `getNameColor(obj, mode, bg_rgb=but_color, default_rgb=TextColor)`.
 *
 * Returns the 0..1 RGB the name should be drawn in, or `null` for "the default
 * text colour" — which is what the caller renders by NOT setting `color`, so
 * the stylesheet keeps owning it.
 *
 * `nameColor` is what `panels/objects.py:_name_color` resolved for mode 1 (the
 * first carbon atom) or mode 2 (the object colour); `undefined` is mode 0, a
 * non-molecule under mode 1, or `cColorDefault`.
 */
export function nameTextColor(
  nameColor: readonly number[] | undefined,
  fill: RowFillName,
): readonly number[] | null {
  if (!nameColor || nameColor.length < 3) return null;
  const background = [ROW_FILL[fill], ROW_FILL[fill], ROW_FILL[fill]];
  return within3f(background, nameColor, NAME_COLOR_CUTOFF) ? null : nameColor;
}
