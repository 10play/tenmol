/**
 * HSV, transcribed from the implementation PyMOL itself uses.
 *
 * The parity row asks for "HSV/RGB picker replacing 3 sliders + 3 spinboxes",
 * and the only thing that makes an HSV control in a molecular viewer more than
 * decoration is that its colour space is the SAME ONE the program reasons in.
 * PyMOL's is Python's `colorsys`:
 *
 *     import colorsys
 *     _spectrumany_interpolations = {
 *         'hls': (colorsys.rgb_to_hls, colorsys.hls_to_rgb),
 *         'hsv': (colorsys.rgb_to_hsv, colorsys.hsv_to_rgb),
 *         'rgb': ((lambda *rgb: rgb), (lambda *rgb: rgb)),
 *     }
 *
 * — `packages/engine/modules/pymol/viewing.py:1971-1976`, the table behind
 * `spectrum … interpolation=hsv`. So `spectrumany` walking from red to blue
 * through HSV and this editor's H slider move through the same intermediate
 * colours, and neither is an approximation of the other.
 *
 * The two functions below are `Lib/colorsys.py` line for line, including the
 * details that a "clean" rewrite silently changes:
 *
 *   * `h` is 0..1, NOT 0..360 (the UI multiplies for display only);
 *   * grey is `h = 0, s = 0`, decided by `minc == maxc`, so a round trip through
 *     grey loses the hue rather than inventing one — which is why the editor
 *     keeps its own H while the user is dragging S or V;
 *   * `h = (h / 6.0) % 1.0` — Python's `%` on a negative float returns a
 *     POSITIVE remainder, and JavaScript's does not. `(x % 1 + 1) % 1` is that
 *     difference, and getting it wrong turns magenta (h ≈ 0.83) into h ≈ -0.17.
 *
 * PINNED ACROSS BOTH LANGUAGES: `__fixtures__/p9a1hsv.json` holds the vectors,
 * `packages/bridge/tests/test_p9_shell.py` asserts `colorsys` produces them INSIDE the
 * engine, and `p9a1hsv.test.ts` asserts these functions do. Neither side owns a
 * private copy of the answers.
 */

import type { Rgb } from './palette';

/** `(h, s, v)`, each 0..1 — `colorsys`' convention, not the UI's. */
export type Hsv = readonly [number, number, number];

/** `colorsys.rgb_to_hsv` (`Lib/colorsys.py`). */
export function rgbToHsv(rgb: Rgb): Hsv {
  const [r, g, b] = rgb;
  const maxc = Math.max(r, g, b);
  const minc = Math.min(r, g, b);
  const rangec = maxc - minc;
  const v = maxc;
  if (minc === maxc) return [0, 0, v];
  const s = rangec / maxc;
  const rc = (maxc - r) / rangec;
  const gc = (maxc - g) / rangec;
  const bc = (maxc - b) / rangec;
  let h: number;
  if (r === maxc) h = bc - gc;
  else if (g === maxc) h = 2.0 + rc - bc;
  else h = 4.0 + gc - rc;
  h = h / 6.0;
  // Python's `% 1.0` never returns a negative; JavaScript's does.
  h = ((h % 1) + 1) % 1;
  return [h, s, v];
}

/** `colorsys.hsv_to_rgb` (`Lib/colorsys.py`). */
export function hsvToRgb(hsv: Hsv): Rgb {
  const [h, s, v] = hsv;
  if (s === 0) return [v, v, v];
  // `int()` truncates toward zero; `h` is normalised first so the two agree.
  const hue = ((h % 1) + 1) % 1;
  const i = Math.trunc(hue * 6.0);
  const f = hue * 6.0 - i;
  const p = v * (1.0 - s);
  const q = v * (1.0 - s * f);
  const t = v * (1.0 - s * (1.0 - f));
  switch (((i % 6) + 6) % 6) {
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    default:
      return [v, p, q];
  }
}

/* ------------------------------------------------------------------ *
 * The editor's units
 * ------------------------------------------------------------------ */

/**
 * What the three HSV rows show: H in degrees (0..360), S and V in per cent.
 *
 * The RGB rows are 0..1 numbers over 0..100 sliders because `colors.ui`'s
 * `QDoubleSpinBox` are 0..1 and its `QSlider`s are 0..100. Hue has no such
 * upstream widget to copy, and 0..360 is what every other tool shows.
 */
export const HSV_RANGES = { h: 360, s: 100, v: 100 } as const;

/** Convert a 0..1 HSV triple to the display units H(deg)/S/V(%) the rows show. */
export function hsvToDisplay(hsv: Hsv): [number, number, number] {
  return [
    Math.round(hsv[0] * HSV_RANGES.h),
    Math.round(hsv[1] * HSV_RANGES.s),
    Math.round(hsv[2] * HSV_RANGES.v),
  ];
}

/** Convert display units back to a 0..1 HSV triple, wrapping hue and clamping S/V. */
export function displayToHsv(display: readonly [number, number, number]): Hsv {
  const clamp = (value: number, max: number) =>
    Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0)) / max;
  return [
    // 360 is 0: a hue dial wraps, and clamping it would make the last degree of
    // the strip unreachable.
    (((display[0] % HSV_RANGES.h) + HSV_RANGES.h) % HSV_RANGES.h) / HSV_RANGES.h,
    clamp(display[1], HSV_RANGES.s),
    clamp(display[2], HSV_RANGES.v),
  ];
}

/**
 * The CSS for the hue strip behind the H slider: the six primaries, in order.
 *
 * Generated from {@link hsvToRgb} rather than written out, so a change to the
 * conversion moves the strip with it instead of leaving it lying.
 */
export function hueStripCss(stops = 7): string {
  const parts: string[] = [];
  for (let i = 0; i < stops; i += 1) {
    const h = i / (stops - 1);
    const [r, g, b] = hsvToRgb([h >= 1 ? 0.999999 : h, 1, 1]);
    parts.push(
      `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}) ` +
        `${Math.round((i / (stops - 1)) * 100)}%`,
    );
  }
  return `linear-gradient(to right, ${parts.join(', ')})`;
}
