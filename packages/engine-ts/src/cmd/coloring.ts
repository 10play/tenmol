/**
 * The `coloring` command subsystem — `set_color`, `spectrum`, and the `util.cb*`
 * / `util.rainbow` colour helpers. Registers its `cmd.*` handlers via the
 * {@link RegistrarCtx}. See docs/engine-port-gaps.md.
 *
 * The gradient maths port PyMOL exactly:
 *   - the named palettes of `modules/pymol/constants_palette.py` (`palette_dict`),
 *   - the `s/r/c/w/o` spectrum colour ramps of `layer1/Color.cpp` (`ColorInit`),
 *   - the per-atom slot selection of `ExecutiveSpectrum` /
 *     `ObjectMolecule.cpp:OMOP_Spectrum`.
 * The by-element helpers port `modules/pymol/util.py` (`cbag`/`cbac`/… and
 * `cbc`), and `set_color` ports `cmd.set_color`.
 */

import type { Json } from '@tenmol/protocol';
import type { AtomInfo } from '../model/atom';
import {
  ELEMENT_COLOR,
  getColorIndex,
  getColorTuple,
  setColor,
  type RGB,
} from '../exec/color';
import type { RegistrarCtx } from './registrar';

/* --------------------------------------------------------------------------
 * PyMOL spectrum ramps (layer1/Color.cpp). Each is a list of RGB control
 * points; a spectrum index 0..999 is interpolated across them with a fixed
 * divisor, exactly as `ColorInit` fills the `sNNN`/`rNNN`/`cNNN`/`wNNN`/`oNNN`
 * named-colour ranges.
 * ------------------------------------------------------------------------ */

type Vec3 = readonly [number, number, number];

const SPECTRUM_S: Vec3[] = [
  [1, 0, 1], [0.5, 0, 1], [0, 0, 1], [0, 0.5, 1], [0, 1, 1],
  [0, 1, 0.5], [0, 1, 0], [0.5, 1, 0], [1, 1, 0], [1, 0.5, 0],
  [1, 0, 0], [1, 0, 0.5], [1, 0, 1],
];
const SPECTRUM_R: Vec3[] = [
  [1, 1, 0], [0.5, 1, 0], [0, 1, 0], [0, 1, 0.5], [0, 1, 1],
  [0, 0.5, 1], [0, 0, 1], [0.5, 0, 1], [1, 0, 1], [1, 0, 0.5],
  [1, 0, 0], [1, 0.5, 0], [1, 1, 0],
];
const SPECTRUM_C: Vec3[] = [
  [1, 1, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0], [1, 0, 1],
  [0, 1, 1], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1],
  [1, 1, 0], [1, 0, 0], [0, 1, 1],
];
const SPECTRUM_W: Vec3[] = [
  [1, 1, 0], [1, 1, 1], [0, 0, 1], [1, 1, 1], [1, 0, 0],
  [1, 1, 1], [0, 1, 0], [1, 1, 1], [1, 0, 1], [1, 1, 1],
  [0, 1, 1], [1, 1, 1], [1, 1, 0], [1, 1, 1], [0, 1, 0],
  [1, 1, 1], [0, 0, 1], [1, 1, 1], [1, 0, 1], [1, 1, 1],
  [1, 1, 0], [1, 1, 1], [1, 0, 0], [1, 1, 1], [0, 1, 1],
];
const SPECTRUM_O: Vec3[] = [
  [1, 0, 1], [0.8, 0, 1], [0.5, 0, 1], [0, 0, 1], [0, 0, 1],
  [0, 0.2, 1], [0, 0.5, 1], [0, 0.8, 1], [0, 1, 1], [0, 1, 0.8],
  [0, 1, 0.5], [0, 1, 0.2], [0, 1, 0], [0.2, 1, 0], [0.5, 1, 0],
  [0.8, 1, 0], [1, 1, 0], [1, 0.9, 0], [1, 0.75, 0], [1, 0.6, 0],
  [1, 0.5, 0], [1, 0.4, 0], [1, 0.3, 0], [1, 0.2, 0], [1, 0, 0],
  [1, 0, 0], [1, 0, 0.5], [1, 0, 0.8], [1, 0, 1],
];

const A_DIV = 83.333333333;
const W_DIV = 41.666666667;
const B_DIV = 35.7143;

interface Ramp {
  table: Vec3[];
  div: number;
}
const RAMPS: Readonly<Record<string, Ramp>> = {
  s: { table: SPECTRUM_S, div: A_DIV },
  r: { table: SPECTRUM_R, div: A_DIV },
  c: { table: SPECTRUM_C, div: A_DIV },
  w: { table: SPECTRUM_W, div: W_DIV },
  o: { table: SPECTRUM_O, div: B_DIV },
};

/** RGB for a spectrum index (0..999) under a ramp prefix (Color.cpp reg loop). */
function spectrumRgb(prefix: string, index: number): RGB {
  const ramp = RAMPS[prefix] ?? RAMPS.o!;
  const { table, div } = ramp;
  let set1 = Math.floor(index / div);
  if (set1 >= table.length - 1) set1 = table.length - 2;
  if (set1 < 0) set1 = 0;
  const f = 1 - (index - set1 * div) / div;
  const g = 1 - f;
  const a = table[set1]!;
  const b = table[set1 + 1]!;
  return [f * a[0] + g * b[0], f * a[1] + g * b[1], f * a[2] + g * b[2]];
}

/* --------------------------------------------------------------------------
 * Palette table (constants_palette.py). Tuple = [prefix, digits, first, last].
 * ------------------------------------------------------------------------ */

type PaletteDef = readonly [prefix: string, digits: number, first: number, last: number];

const PALETTE_DICT: Readonly<Record<string, PaletteDef>> = {
  rainbow_cycle: ['o', 3, 0, 999],
  rainbow_cycle_rev: ['o', 3, 999, 0],
  rainbow: ['o', 3, 107, 893],
  rainbow_rev: ['o', 3, 893, 107],
  rainbow2: ['s', 3, 167, 833],
  rainbow2_rev: ['s', 3, 833, 167],
  gcbmry: ['r', 3, 166, 999],
  yrmbcg: ['r', 3, 999, 166],
  cbmr: ['r', 3, 166, 833],
  rmbc: ['r', 3, 833, 166],
  green_yellow_red: ['s', 3, 500, 833],
  red_yellow_green: ['s', 3, 833, 500],
  yellow_white_blue: ['w', 3, 0, 83],
  blue_white_yellow: ['w', 3, 83, 0],
  blue_white_red: ['w', 3, 83, 167],
  red_white_blue: ['w', 3, 167, 83],
  red_white_green: ['w', 3, 167, 250],
  green_white_red: ['w', 3, 250, 167],
  green_white_magenta: ['w', 3, 250, 333],
  magenta_white_green: ['w', 3, 333, 250],
  magenta_white_cyan: ['w', 3, 333, 417],
  cyan_white_magenta: ['w', 3, 417, 333],
  cyan_white_yellow: ['w', 3, 417, 500],
  yellow_cyan_white: ['w', 3, 500, 417],
  yellow_white_green: ['w', 3, 500, 583],
  green_white_yellow: ['w', 3, 583, 500],
  green_white_blue: ['w', 3, 583, 667],
  blue_white_green: ['w', 3, 667, 583],
  blue_white_magenta: ['w', 3, 667, 750],
  magenta_white_blue: ['w', 3, 750, 667],
  magenta_white_yellow: ['w', 3, 750, 833],
  yellow_white_magenta: ['w', 3, 833, 750],
  yellow_white_red: ['w', 3, 833, 917],
  red_white_yellow: ['w', 3, 817, 833],
  red_white_cyan: ['w', 3, 916, 999],
  cyan_white_red: ['w', 3, 999, 916],
  yellow_blue: ['c', 3, 0, 83],
  blue_yellow: ['c', 3, 83, 0],
  blue_red: ['c', 3, 83, 167],
  red_blue: ['c', 3, 167, 83],
  red_green: ['c', 3, 167, 250],
  green_red: ['c', 3, 250, 167],
  green_magenta: ['c', 3, 250, 333],
  magenta_green: ['c', 3, 333, 250],
  magenta_cyan: ['c', 3, 333, 417],
  cyan_magenta: ['c', 3, 417, 333],
  cyan_yellow: ['c', 3, 417, 500],
  yellow_cyan: ['c', 3, 500, 417],
  yellow_green: ['c', 3, 500, 583],
  green_yellow: ['c', 3, 583, 500],
  green_blue: ['c', 3, 583, 667],
  blue_green: ['c', 3, 667, 583],
  blue_magenta: ['c', 3, 667, 750],
  magenta_blue: ['c', 3, 750, 667],
  magenta_yellow: ['c', 3, 750, 833],
  yellow_magenta: ['c', 3, 833, 750],
  yellow_red: ['c', 3, 833, 917],
  red_yellow: ['c', 3, 817, 833],
  red_cyan: ['c', 3, 916, 999],
  cyan_red: ['c', 3, 999, 916],
};

function zpad(n: number, width: number): string {
  const s = String(Math.abs(n));
  return s.length >= width ? s : '0'.repeat(width - s.length) + s;
}

/* --------------------------------------------------------------------------
 * spectrumany fallback (viewing.py `spectrumany`). `spectrum` delegates here
 * when the expression is not purely alphabetic OR the palette is not a known
 * palette name — the pure-Python path that accepts an arbitrary colour list
 * and rgb/hls/hsv interpolation, writing packed `0x40RRGGBB` inline colours.
 * ------------------------------------------------------------------------ */

/** Maps the 10 rainbow-family palette names to explicit colour-name strings
 *  (viewing.py `palette_colors_dict`). Used when `colors` has no space. */
const PALETTE_COLORS_DICT: Readonly<Record<string, string>> = {
  rainbow_cycle: 'magenta blue cyan green yellow orange red magenta',
  rainbow_cycle_rev: 'magenta red orange yellow green cyan blue magenta',
  rainbow: 'blue cyan green yellow orange red',
  rainbow_rev: 'red orange yellow green cyan blue',
  rainbow2: 'blue cyan green yellow orange red',
  rainbow2_rev: 'red orange yellow green cyan blue',
  gcbmry: 'green cyan blue magenta red yellow',
  yrmbcg: 'yellow red magenta blue cyan green',
  cbmr: 'cyan blue magenta red',
  rmbc: 'red magenta blue cyan',
};

type ColorFn = (a: number, b: number, c: number) => Vec3;

/** Python `colorsys.rgb_to_hls`. */
function rgbToHls(r: number, g: number, b: number): Vec3 {
  const maxc = Math.max(r, g, b);
  const minc = Math.min(r, g, b);
  const sumc = maxc + minc;
  const rangec = maxc - minc;
  const l = sumc / 2;
  if (minc === maxc) return [0, l, 0];
  const s = l <= 0.5 ? rangec / sumc : rangec / (2 - maxc - minc);
  const rc = (maxc - r) / rangec;
  const gc = (maxc - g) / rangec;
  const bc = (maxc - b) / rangec;
  let h: number;
  if (r === maxc) h = bc - gc;
  else if (g === maxc) h = 2 + rc - bc;
  else h = 4 + gc - rc;
  h = ((h / 6) % 1 + 1) % 1;
  return [h, l, s];
}

function hlsV(m1: number, m2: number, hueIn: number): number {
  const hue = ((hueIn % 1) + 1) % 1;
  if (hue < 1 / 6) return m1 + (m2 - m1) * hue * 6;
  if (hue < 0.5) return m2;
  if (hue < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - hue) * 6;
  return m1;
}

/** Python `colorsys.hls_to_rgb`. */
function hlsToRgb(h: number, l: number, s: number): Vec3 {
  if (s === 0) return [l, l, l];
  const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s;
  const m1 = 2 * l - m2;
  return [hlsV(m1, m2, h + 1 / 3), hlsV(m1, m2, h), hlsV(m1, m2, h - 1 / 3)];
}

/** Python `colorsys.rgb_to_hsv`. */
function rgbToHsv(r: number, g: number, b: number): Vec3 {
  const maxc = Math.max(r, g, b);
  const minc = Math.min(r, g, b);
  const v = maxc;
  if (minc === maxc) return [0, 0, v];
  const rangec = maxc - minc;
  const s = rangec / maxc;
  const rc = (maxc - r) / rangec;
  const gc = (maxc - g) / rangec;
  const bc = (maxc - b) / rangec;
  let h: number;
  if (r === maxc) h = bc - gc;
  else if (g === maxc) h = 2 + rc - bc;
  else h = 4 + gc - rc;
  h = ((h / 6) % 1 + 1) % 1;
  return [h, s, v];
}

/** Python `colorsys.hsv_to_rgb`. */
function hsvToRgb(h: number, s: number, v: number): Vec3 {
  if (s === 0) return [v, v, v];
  let i = Math.trunc(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  i = ((i % 6) + 6) % 6;
  switch (i) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

const IDENTITY_RGB: ColorFn = (a, b, c) => [a, b, c];

/** `_spectrumany_interpolations`: [from_rgb, to_rgb] per interpolation mode. */
const INTERP: Readonly<Record<string, readonly [ColorFn, ColorFn]>> = {
  rgb: [IDENTITY_RGB, IDENTITY_RGB],
  hls: [rgbToHls, hlsToRgb],
  hsv: [rgbToHsv, hsvToRgb],
};

/**
 * Resolve a palette name the way `palette_sc` (a `Shortcut` over
 * `palette_dict`) does: an exact key, or a unique prefix of exactly one key.
 * Returns the resolved key or `null` (the `not palette_hit` signal that sends
 * `spectrum` to the `spectrumany` fallback).
 */
function resolvePaletteHit(name: string): string | null {
  if (PALETTE_DICT[name]) return name;
  let hit: string | null = null;
  for (const key of Object.keys(PALETTE_DICT)) {
    if (key.startsWith(name)) {
      if (hit !== null) return null; // ambiguous prefix
      hit = key;
    }
  }
  return hit;
}

/* --------------------------------------------------------------------------
 * Argument coercion.
 * ------------------------------------------------------------------------ */

/** Parse an rgb argument: an array, a bracketed string, or comma-split args. */
function parseRgb(args: unknown[], kwargs: Record<string, unknown>): [number, number, number] {
  const raw = kwargs.rgb ?? kwargs.color;
  let nums: number[];
  if (Array.isArray(raw)) {
    nums = raw.map(Number);
  } else if (Array.isArray(args[1])) {
    nums = (args[1] as unknown[]).map(Number);
  } else {
    // The console splits on commas, so `[1, 0, 0]` arrives as several string
    // args; gather everything after the name, strip brackets, and split.
    const joined = args
      .slice(1)
      .map((v) => String(v))
      .join(' ')
      .replace(/[[\]()]/g, ' ');
    nums = joined
      .split(/[\s,]+/)
      .filter((s) => s.length > 0)
      .map(Number);
  }
  const [r = 0, g = 0, b = 0] = nums;
  // 0..255 inputs -> normalise (PyMOL accepts either; anything >1 means 8-bit).
  if (r > 1 || g > 1 || b > 1) return [r / 255, g / 255, b / 255];
  return [r, g, b];
}

/** A finite number from a kwarg or positional string, else undefined. */
function optNum(v: unknown): number | undefined {
  if (v == null || v === '' || v === 'None') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/* --------------------------------------------------------------------------
 * Per-atom value extraction for `spectrum`.
 * ------------------------------------------------------------------------ */

/** Numeric-per-atom value for a spectrum expression, or `null` if enumerated. */
function numericValue(expr: string, atom: AtomInfo, order: number, localIndex: number): number | null {
  switch (expr) {
    case 'count':
      return order + 1;
    case 'b':
      return atom.b;
    case 'q':
      return atom.q;
    case 'resi':
    case 'resv':
      return atom.resv;
    case 'id':
      return atom.id;
    case 'index':
      return localIndex + 1;
    case 'formal_charge':
    case 'partial_charge':
    case 'pc':
      return 0;
    default:
      return null;
  }
}

/** Enumerated (0-based, first-seen order) value for a non-numeric expression. */
function enumeratedValue(expr: string, atom: AtomInfo): string {
  switch (expr) {
    case 'chain':
      return atom.chain;
    case 'resn':
      return atom.resn;
    case 'elem':
      return atom.elem;
    case 'segi':
      return atom.segi;
    case 'ss':
      return atom.ss;
    case 'name':
      return atom.name;
    case 'resi_str':
      return atom.resi;
    default:
      return String((atom as unknown as Record<string, unknown>)[expr] ?? '');
  }
}

/* --------------------------------------------------------------------------
 * Chain-colour cycle (util.cbc). The exact 40-entry `_color_cycle` from
 * util.py (mirror of layer1/Color.cpp's AutoColor), by name — every name is
 * present in the ported colour table and resolves to its real PyMOL index
 * (e.g. lightmagenta -> 154), so `c % 40` matches `_color_cycle[c % 40]`.
 * ------------------------------------------------------------------------ */

const CHAIN_COLOR_CYCLE = [
  'carbon', 'cyan', 'lightmagenta', 'yellow', 'salmon', 'hydrogen', 'slate',
  'orange', 'lime', 'deepteal', 'hotpink', 'yelloworange', 'violetpurple',
  'grey70', 'marine', 'olive', 'smudge', 'teal', 'dirtyviolet', 'wheat',
  'deepsalmon', 'lightpink', 'aquamarine', 'paleyellow', 'limegreen',
  'skyblue', 'warmpink', 'limon', 'violet', 'bluewhite', 'greencyan',
  'sand', 'forest', 'lightteal', 'darksalmon', 'splitpea', 'raspberry',
  'grey50', 'deepblue', 'brown',
];

/** Resolve a colour name to an index, defining it from `rgb` if not present. */
function resolveOrDefine(name: string, rgb: RGB): number {
  const idx = getColorIndex(name);
  return idx >= 0 ? idx : setColor(name, rgb);
}

/* --------------------------------------------------------------------------
 * Registration.
 * ------------------------------------------------------------------------ */

export function registerColoring(ctx: RegistrarCtx): void {
  const { executive: ex, str } = ctx;

  /* ------------------------------ set_color ----------------------------- */

  ctx.command('set_color', (args, kwargs): Json => {
    const name = str(args[0] ?? kwargs.name);
    const rgb = parseRgb(args, kwargs);
    const idx = setColor(name, rgb);
    ctx.publish();
    return idx;
  });

  /* ------------------------------ spectrum ------------------------------ */

  /**
   * The pure-Python `spectrumany` fallback (viewing.py:1978): arbitrary colour
   * lists + rgb/hls/hsv interpolation. Reached from `spectrum` when the
   * expression is non-alphabetic or the palette is not a known palette name.
   */
  const spectrumany = (
    expr: string,
    colorsArg: string,
    selection: string,
    minimum: number | undefined,
    maximum: number | undefined,
    interpolation: string,
  ): Json => {
    const interp = INTERP[interpolation] ?? INTERP.rgb!;
    const [fromRgb, toRgb] = interp;

    // A palette-name colours string, or split the given colour list.
    let colorsStr = colorsArg;
    if (!colorsStr.includes(' ')) {
      colorsStr = PALETTE_COLORS_DICT[colorsStr.toLowerCase()] ?? colorsStr.replace(/_/g, ' ');
    }
    const colorNames = colorsStr.split(/\s+/).filter((s) => s.length > 0);
    const nColors = colorNames.length;
    if (nColors < 2) throw new Error('please provide at least 2 colors');

    const colTuples = colorNames.map((c) => {
      const idx = getColorIndex(c);
      const t = idx >= 0 ? getColorTuple(idx) : null;
      if (!t) throw new Error('unknown color');
      return fromRgb(t[0], t[1], t[2]);
    });

    // Alias the expression (pc/fc/resi) exactly as spectrumany does.
    const aliasExpr =
      ({ pc: 'partial_charge', fc: 'formal_charge', resi: 'resv' } as Record<string, string>)[
        expr
      ] ?? expr;

    const uaList = ex.atomsMatching(selection);

    // Per-atom values: `count` -> 0-based order; numeric expr -> its value;
    // non-numeric expr -> enumerate by sorted-unique index (spectrumany uses
    // `sorted(set(e_list)).index`, NOT first-seen).
    let eList: number[];
    if (aliasExpr === 'count') {
      eList = uaList.map((_, i) => i);
    } else {
      const raw = uaList.map((ua, i) => numericValue(aliasExpr, ua.atom, i, ua.index));
      if (raw.every((v) => v !== null)) {
        eList = raw as number[];
      } else {
        const strs = uaList.map((ua) => enumeratedValue(aliasExpr, ua.atom));
        const uniqueSorted = [...new Set(strs)].sort();
        const indexOf = new Map(uniqueSorted.map((s, i) => [s, i] as const));
        eList = strs.map((s) => indexOf.get(s)!);
      }
    }

    if (eList.length === 0) return [0, 0];

    let mn = minimum;
    let mx = maximum;
    if (mn === undefined) mn = Math.min(...eList);
    if (mx === undefined) mx = Math.max(...eList);

    const valRange = mx - mn;
    if (valRange === 0) {
      // Degenerate range: colour everything the first colour (as PyMOL's
      // `_self.color(colors[0], selection)`).
      const idx0 = getColorIndex(colorNames[0]!);
      for (const ua of uaList) if (idx0 >= 0) ua.atom.color = idx0;
      ctx.publish();
      return [mn, mx];
    }

    // Interpolate + pack a `0x40RRGGBB` inline TRGB colour per atom.
    for (let i = 0; i < uaList.length; i++) {
      const v = Math.min(1, Math.max(0, (eList[i]! - mn) / valRange)) * (nColors - 1);
      const ci = Math.min(Math.trunc(v), nColors - 2);
      const p = v - ci;
      const c0 = colTuples[ci]!;
      const c1 = colTuples[ci + 1]!;
      const [rr, gg, bb] = toRgb(
        c1[0] * p + c0[0] * (1 - p),
        c1[1] * p + c0[1] * (1 - p),
        c1[2] * p + c0[2] * (1 - p),
      );
      const r = Math.trunc(0xff * rr);
      const g = Math.trunc(0xff * gg);
      const b = Math.trunc(0xff * bb);
      uaList[i]!.atom.color = 0x40000000 + r * 0x10000 + g * 0x100 + b;
    }
    ctx.publish();
    return [mn, mx];
  };

  const spectrum = (args: unknown[], kwargs: Record<string, unknown>): Json => {
    const expr = (str(args[0] ?? kwargs.expression, 'count') || 'count').toLowerCase();
    const paletteArg = str(args[1] ?? kwargs.palette, 'rainbow') || 'rainbow';
    const paletteName = paletteArg.toLowerCase();
    const selection = str(args[2] ?? kwargs.selection, 'all') || 'all';
    let minimum = optNum(args[3] ?? kwargs.minimum);
    let maximum = optNum(args[4] ?? kwargs.maximum);
    const byres = Boolean(optNum(args[5] ?? kwargs.byres) ?? 0);
    const interpolation = (str(args[7] ?? kwargs.interpolation, 'rgb') || 'rgb').toLowerCase();

    // Dispatch to spectrumany when the expression is not purely alphabetic or
    // the palette is not a known palette name (viewing.py:2133).
    const strippedExpr = expr.replace(/_/g, '');
    const exprAlpha = strippedExpr.length > 0 && /^[a-z]+$/.test(strippedExpr);
    const paletteHit = resolvePaletteHit(paletteName);
    if (!exprAlpha || !paletteHit) {
      return spectrumany(expr, paletteArg, selection, minimum, maximum, interpolation);
    }

    const def = PALETTE_DICT[paletteHit] ?? PALETTE_DICT.rainbow!;
    const [prefix, digits, first, last] = def;

    // Build the discrete palette of colour indices (ExecutiveSpectrum loop).
    const nColor = Math.abs(first - last) + 1;
    const colorIndex: number[] = new Array(nColor);
    for (let a = 0; a < nColor; a++) {
      const b = nColor === 1 ? first : first + Math.trunc(((last - first) * a) / (nColor - 1));
      colorIndex[a] = resolveOrDefine(prefix + zpad(b, digits), spectrumRgb(prefix, b));
    }

    const atoms = ex.atomsMatching(selection);
    if (atoms.length === 0) return [0, 0];

    // Per-atom values (numeric, or enumerated first-seen for non-numeric exprs).
    const values: number[] = new Array(atoms.length);
    let enumerated = false;
    const seen = new Map<string, number>();
    for (let a = 0; a < atoms.length; a++) {
      const ua = atoms[a]!;
      const num = numericValue(expr, ua.atom, a, ua.index);
      if (num !== null) {
        values[a] = num;
      } else {
        enumerated = true;
        const key = enumeratedValue(expr, ua.atom);
        let e = seen.get(key);
        if (e === undefined) {
          e = seen.size;
          seen.set(key, e);
        }
        values[a] = e;
      }
    }
    void enumerated;

    // Range (ExecutiveSpectrum): auto from data unless min/max supplied.
    if (minimum === undefined || maximum === undefined) {
      let mn = values[0]!;
      let mx = values[0]!;
      for (const v of values) {
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      if (minimum === undefined) minimum = mn;
      if (maximum === undefined) maximum = mx;
    }
    let range = maximum - minimum;
    if (range === 0) range = 1;

    // Slot selection (OMOP_Spectrum): c = int(0.49999 + (n-1)*(v-min)/range),
    // clamped to [0, (n-1)-1]. The last palette slot is intentionally unused.
    const iMax = nColor - 1;
    const assign = (atom: AtomInfo, value: number): void => {
      let c = Math.trunc(0.49999 + iMax * ((value - minimum!) / range));
      if (c < 0) c = 0;
      if (c >= iMax) c = iMax > 0 ? iMax - 1 : 0;
      atom.color = colorIndex[c]!;
    };

    if (byres) {
      // Colour the whole residue by its first-seen atom's value.
      let prev: AtomInfo | null = null;
      for (let a = 0; a < atoms.length; a++) {
        const ua = atoms[a]!;
        if (prev && sameResidue(prev, ua.atom)) continue;
        assign(ua.atom, values[a]!);
        prev = ua.atom;
      }
      // Second pass: propagate each atom's colour across its residue neighbours.
      for (const mol of ex.moleculesInOrder()) {
        for (let i = 1; i < mol.atoms.length; i++) {
          const cur = mol.atoms[i]!;
          const before = mol.atoms[i - 1]!;
          if (sameResidue(before, cur)) cur.color = before.color;
        }
      }
    } else {
      for (let a = 0; a < atoms.length; a++) assign(atoms[a]!.atom, values[a]!);
    }

    ctx.publish();
    return [minimum, maximum];
  };
  ctx.command('spectrum', spectrum);

  /* ----------------------------- util.cb* ------------------------------- */

  /** Colour by element (CPK); carbon gets `carbonColor`. Ports util `cbXX`. */
  const colorByElement = (selection: string, carbonColor: number): number => {
    const atoms = ex.atomsMatching(selection);
    for (const ua of atoms) {
      const a = ua.atom;
      if (a.elem === 'C') {
        a.color = carbonColor;
        continue;
      }
      const cpk = ELEMENT_COLOR[a.elem];
      if (cpk) {
        const idx = getColorIndex(cpk);
        if (idx >= 0) a.color = idx;
      }
    }
    ctx.publish();
    return atoms.length;
  };

  const cbVariants: Array<[string, string, RGB]> = [
    ['util.cbag', 'carbon', [0.2, 1, 0.2]],
    ['util.cbac', 'cyan', [0, 1, 1]],
    ['util.cbay', 'yellow', [1, 1, 0]],
    ['util.cbas', 'salmon', [1, 0.6, 0.6]],
    ['util.cbap', 'purple', [0.75, 0, 0.75]],
    // cbaw colours carbons like hydrogen (light grey) in PyMOL.
    ['util.cbaw', 'hydrogen', [0.9, 0.9, 0.9]],
  ];
  for (const [name, carbonName, carbonRgb] of cbVariants) {
    ctx.command(name, (args): Json => {
      const selection = str(args[0], 'all') || 'all';
      const carbon = resolveOrDefine(carbonName, carbonRgb);
      return colorByElement(selection, carbon);
    });
  }

  /* --------------------------- util.cbc (chain) ------------------------- */

  ctx.command('util.cbc', (args): Json => {
    const selection = str(args[0], 'all') || 'all';
    const atoms = ex.atomsMatching(selection);
    // Distinct chains in first-seen order.
    const chainOrder: string[] = [];
    const chainSeen = new Set<string>();
    for (const ua of atoms) {
      const ch = ua.atom.chain;
      if (!chainSeen.has(ch)) {
        chainSeen.add(ch);
        chainOrder.push(ch);
      }
    }
    const chainColor = new Map<string, number>();
    chainOrder.forEach((ch, i) => {
      const name = CHAIN_COLOR_CYCLE[i % CHAIN_COLOR_CYCLE.length]!;
      chainColor.set(ch, getColorIndex(name));
    });
    for (const ua of atoms) {
      const idx = chainColor.get(ua.atom.chain);
      if (idx !== undefined && idx >= 0) ua.atom.color = idx;
    }
    ctx.publish();
    return chainOrder.length;
  });

  /* --------------------------- util.rainbow ----------------------------- */

  ctx.command('util.rainbow', (args, kwargs): Json => {
    const selection = str(args[0], 'all') || 'all';
    // Legacy wrapper around `spectrum count, rainbow` (util.py). Prefer Cα when
    // the selection has any, matching util.rainbow's `name CA` default spirit.
    const caSel = `(${selection}) and name CA`;
    const target = ex.countAtoms(caSel) > 0 ? caSel : selection;
    return spectrum(['count', 'rainbow', target], kwargs);
  });
}

/** Same-residue test mirroring AtomInfoSameResidue (chain/segi/resi identity). */
function sameResidue(a: AtomInfo, b: AtomInfo): boolean {
  return a.chain === b.chain && a.segi === b.segi && a.resi === b.resi && a.resn === b.resn;
}

// Referenced by tests / potential callers to read back a resolved colour.
export { getColorTuple };
