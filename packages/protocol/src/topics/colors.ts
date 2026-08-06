/**
 * Topic `colors` — the colour table, the special indices, and ramps.
 * OWNER: WP-22.
 *
 * Every `color` field on every other topic (`ObjectRow.color`,
 * `IndexedMeshHeader.oneColor`, CGO colour arrays) is a PyMOL colour INDEX.
 * Without this table the client cannot render any of them, so this topic is a
 * hard dependency of the object panel and of Mode G.
 *
 * WHAT IS AND IS NOT A LOOKUP
 * ---------------------------
 * A PyMOL colour index is not simply an offset into a table. `ColorGetIndex`
 * (`packages/engine/layer1/Color.cpp:661-750`) hands back four *different kinds* of number and
 * the client has to be able to tell them apart before it can produce an RGB:
 *
 *   `0 .. 5387`     a real slot in `CColor::Color` (`packages/engine/layer1/Color.cpp:825-1322`)
 *   `-1 .. -7`      the seven keywords (`packages/engine/layer1/Color.h:36-44`)
 *   `<= -10`        a **ramp object**; `ext = -10 - index` (`Color.h:46`)
 *   `& 0xC0000000 == 0x40000000`  an INLINE RGB, 8 bits per channel, packed by
 *                   `Color3fToInt` (`Color.cpp:1883`) and by `spectrumany`
 *                   (`packages/engine/modules/pymol/viewing.py:2053`)
 *
 * The decoders below are the client half of that, and they are pure: the wire
 * carries indices, this module turns the two *self-describing* kinds (inline
 * RGB, ramp slot) into something renderable with no round trip, and names the
 * two that genuinely need the backend (table slots, and `front`/`back`, which
 * depend on `bg_rgb` — `ColorUpdateFront`, `Color.cpp:1754`).
 */

/* ------------------------------------------------------------------ *
 * The table
 * ------------------------------------------------------------------ */

export interface ColorEntry {
  index: number;
  name: string;
  /** 0..1 floats, as `cmd.get_color_tuple()` returns them. */
  rgb: readonly [number, number, number];
}

/** A named colour ramp and the object it lives on (`object:ramp`). */
export interface ColorRamp {
  name: string;
  /** Object name of the ramp (`object:ramp`). */
  object: string;
}

/** The colour table plus ramps, as a full snapshot or an incremental patch. */
export interface ColorsPayload {
  /** `cmd.get_color_indices()` enriched with `cmd.get_color_tuple()`. */
  colors: ColorEntry[];
  ramps: ColorRamp[];
  /** True when this replaces the whole table rather than patching it. */
  full: boolean;
}

/**
 * `ColorReset` registers 188 explicit + 5200 generated slots
 * (`packages/engine/layer1/Color.cpp:825-1322`). Measured against this tree:
 * `len(cmd.get_color_indices(all=1)) == 5388`.
 */
export const COLOR_TABLE_SIZE = 5388;

/**
 * `ColorGetStatus` returns 1 only for names with no digits
 * (`packages/engine/layer1/Color.cpp:784-807`), and `cmd.get_color_indices()` (mode 1) returns
 * exactly those. Measured: 178.
 */
export const NAMED_COLOR_COUNT = 178;

/**
 * Index landmarks the Qt menus hardcode. Kept here because they are the cheap
 * runtime proof that the table we fetched is the table PyMOL built — a shifted
 * table would silently mis-colour every object row.
 * (`_gui.py:456-461`, `:632`; `packages/engine/layer1/Color.cpp:35-75`.)
 */
export const COLOR_LANDMARKS: Readonly<Record<string, number>> = {
  white: 0,
  black: 1,
  grey50: 104,
  grey80: 134,
  lightmagenta: 154,
  gray80: 4236,
  deepteal: 5262,
  darksalmon: 5280,
};

/* ------------------------------------------------------------------ *
 * Special indices — packages/engine/layer1/Color.h:36-47
 * ------------------------------------------------------------------ */

/** Inherit the colour from the enclosing scope (unset). */
export const C_COLOR_DEFAULT = -1;
/** The next auto colour a new object would receive. */
export const C_COLOR_NEW_AUTO = -2;
/** The current auto colour. */
export const C_COLOR_CUR_AUTO = -3;
/** Per-atom colour. */
export const C_COLOR_ATOMIC = -4;
/** The object's own colour. */
export const C_COLOR_OBJECT = -5;
/** Contrast-with-background colour. */
export const C_COLOR_FRONT = -6;
/** The background colour. */
export const C_COLOR_BACK = -7;
/** Indices <= this are ramp objects. `packages/engine/layer1/Color.h:46`. */
export const C_COLOR_EXT_CUTOFF = -10;

/** High bit marking an index as an inline `0x40RRGGBB` colour. */
export const C_COLOR_TRGB_BITS = 0x40000000;
/** Mask isolating the inline-colour marker bits. */
export const C_COLOR_TRGB_MASK = 0xc0000000;

/** The seven reserved colour keywords `ColorGetIndex` matches exactly. */
export type SpecialColorKeyword =
  'default' | 'auto' | 'current' | 'atomic' | 'object' | 'front' | 'back';

/**
 * The seven keywords `ColorGetIndex` matches EXACTLY (prefix matching was
 * removed in 2.5 — `packages/engine/layer1/Color.cpp:715-729`).
 *
 * `constant` is false for `auto` and `current`: those two are not constants at
 * all. `ColorGetIndex` runs `ColorGetNext()` / `ColorGetCurrent()`
 * (`Color.cpp:140,156`) and returns a REAL table index that changes as objects
 * are created — measured on a fresh session, `cmd.get_color_index('auto')`
 * answered 26 and `'current'` answered 5, not -2 and -3. So the client must
 * never cache those two and must never assume their sign.
 */
export const SPECIAL_COLORS: readonly {
  keyword: SpecialColorKeyword;
  index: number;
  constant: boolean;
  help: string;
}[] = [
  { keyword: 'default', index: C_COLOR_DEFAULT, constant: true, help: 'inherit (unset)' },
  { keyword: 'auto', index: C_COLOR_NEW_AUTO, constant: false, help: 'next auto colour' },
  { keyword: 'current', index: C_COLOR_CUR_AUTO, constant: false, help: 'current auto colour' },
  { keyword: 'atomic', index: C_COLOR_ATOMIC, constant: true, help: 'per-atom colour' },
  { keyword: 'object', index: C_COLOR_OBJECT, constant: true, help: 'object colour' },
  { keyword: 'front', index: C_COLOR_FRONT, constant: true, help: 'contrast with background' },
  { keyword: 'back', index: C_COLOR_BACK, constant: true, help: 'background colour' },
];

/* ------------------------------------------------------------------ *
 * Decoders
 * ------------------------------------------------------------------ */

/** Is this an inline `0x40RRGGBB` colour rather than a table slot? */
export function isInlineColor(index: number): boolean {
  if (!Number.isFinite(index) || index < 0) return false;
  // Unsigned throughout: JS bitwise ops are signed 32-bit and the 0xC0000000
  // mask would otherwise compare as a negative number.
  return ((index >>> 0) & C_COLOR_TRGB_MASK) >>> 0 === C_COLOR_TRGB_BITS;
}

/** `0x40RRGGBB` -> 0..1 floats. Inverse of `Color3fToInt` (`Color.cpp:1883`). */
export function decodeInlineColor(index: number): [number, number, number] {
  const packed = index >>> 0;
  return [((packed >>> 16) & 0xff) / 255, ((packed >>> 8) & 0xff) / 255, (packed & 0xff) / 255];
}

/**
 * 0..1 floats -> `0x40RRGGBB`, exactly as `spectrumany` does it
 * (`packages/engine/modules/pymol/viewing.py:2053`: `0x40000000 + r*0x10000 + g*0x100 + b`).
 */
export function encodeInlineColor(rgb: readonly [number, number, number]): number {
  return (
    (C_COLOR_TRGB_BITS + byte255(rgb[0]) * 0x10000 + byte255(rgb[1]) * 0x100 + byte255(rgb[2])) >>>
    0
  );
}

/** Is this a ramp-object colour (`index <= -10`)? */
export function isRampColor(index: number): boolean {
  return index <= C_COLOR_EXT_CUTOFF;
}

/** The colour-extension slot behind a ramp index. `ext = -10 - index`. */
export function rampSlot(index: number): number {
  return C_COLOR_EXT_CUTOFF - index;
}

/** The distinct kinds of value a colour index can encode. */
export type ColorKind = 'slot' | 'inline' | 'ramp' | 'special' | 'invalid';

/** Which of the four kinds of number is this? */
export function colorKind(index: number): ColorKind {
  if (!Number.isFinite(index) || !Number.isInteger(index)) return 'invalid';
  if (isInlineColor(index)) return 'inline';
  if (index >= 0) return index < COLOR_TABLE_SIZE ? 'slot' : 'invalid';
  if (index <= C_COLOR_EXT_CUTOFF) return 'ramp';
  if (index >= C_COLOR_BACK) return 'special';
  return 'invalid';
}

/**
 * `ColorGetName` (`packages/engine/layer1/Color.cpp:759-782`) inverted for the one kind the
 * client can name with no backend at all. Returns null otherwise.
 */
export function inlineColorName(index: number): string | null {
  if (!isInlineColor(index)) return null;
  return '0x' + (((index >>> 0) & 0xffffff) >>> 0).toString(16).padStart(6, '0');
}

/* ------------------------------------------------------------------ *
 * RGB formatting — shared by the picker, the swatch grid and the ramps
 * ------------------------------------------------------------------ */

function byte255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

/** 0..1 floats -> `#rrggbb`, for CSS. */
export function rgbToCss(rgb: readonly [number, number, number]): string {
  return (
    '#' +
    byte255(rgb[0]).toString(16).padStart(2, '0') +
    byte255(rgb[1]).toString(16).padStart(2, '0') +
    byte255(rgb[2]).toString(16).padStart(2, '0')
  );
}

/** `#rrggbb` / `0xrrggbb` / `rrggbb` -> 0..1 floats, or null. */
export function cssToRgb(text: string): [number, number, number] | null {
  const hex = text.trim().replace(/^#/, '').replace(/^0x/i, '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  return [
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
  ];
}

/**
 * PyMOL menu labels embed one-digit-per-channel colour escapes — `\900` is
 * red, `\555` mid grey (`packages/engine/modules/pymol/menu.py:519-618`, drawn by
 * `packages/engine/layer1/Text.cpp`). The swatch grid's tile colours are those triples.
 */
export function menuSwatchToRgb(three: string): [number, number, number] {
  const digit = (i: number) => {
    const c = three.charCodeAt(i) - 48;
    return c >= 0 && c <= 9 ? c / 9 : 0;
  };
  return [digit(0), digit(1), digit(2)];
}
