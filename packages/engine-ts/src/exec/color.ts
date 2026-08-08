/**
 * The named-colour table — `cmd.get_color_index` / `cmd.get_color_tuple` and the
 * name resolution `cmd.color` performs.
 *
 * Ports the standard palette from `packages/engine/layer1/Color.cpp`
 * (`ColorInit` / `ColorGetNamed`). The RGB triples are PyMOL's exact values;
 * these are what the differential suite gates colour parity on (per-atom colour
 * is recorded as the resolved RGB, which is stable across PyMOL versions).
 *
 * Indices below the palette length are the reserved named-colour indices;
 * PyMOL also stores dynamic/extended colours above them, which the covered
 * slice does not touch.
 */

export type RGB = readonly [number, number, number];

/** Ordered standard palette. Index = position; name = key. Grey aliases below. */
const PALETTE: ReadonlyArray<readonly [string, RGB]> = [
  ['white', [1, 1, 1]],
  ['black', [0, 0, 0]],
  ['blue', [0, 0, 1]],
  ['green', [0, 1, 0]],
  ['red', [1, 0, 0]],
  ['cyan', [0, 1, 1]],
  ['yellow', [1, 1, 0]],
  ['magenta', [1, 0, 1]],
  ['orange', [1, 0.5, 0]],
  ['gray', [0.5, 0.5, 0.5]],
  ['marine', [0, 0.5, 1]],
  ['purple', [0.75, 0, 0.75]],
  ['pink', [1, 0.65, 0.85]],
  ['salmon', [1, 0.6, 0.6]],
  ['limon', [0.75, 1, 0.25]],
  ['slate', [0.5, 0.5, 1]],
  ['violet', [1, 0.5, 1]],
  ['teal', [0, 0.75, 0.75]],
  ['forest', [0.2, 0.6, 0.2]],
  ['firebrick', [0.698, 0.13, 0.13]],
  ['deepblue', [0.25, 0.25, 0.65]],
  ['wheat', [0.99, 0.82, 0.65]],
  ['carbon', [0.2, 1, 0.2]],
];

const NAME_TO_INDEX = new Map<string, number>();
const INDEX_TO_RGB = new Map<number, RGB>();
for (let i = 0; i < PALETTE.length; i++) {
  const [name, rgb] = PALETTE[i]!;
  NAME_TO_INDEX.set(name, i);
  INDEX_TO_RGB.set(i, rgb);
}
// Aliases PyMOL accepts.
NAME_TO_INDEX.set('grey', NAME_TO_INDEX.get('gray')!);

/** Next index for a runtime-defined colour (`cmd.set_color`). */
let nextColorIndex = PALETTE.length;

/**
 * `cmd.set_color(name, rgb)` — define or redefine a named colour. Returns its
 * table index. Values in `rgb` are 0..1. An existing name keeps its index.
 */
export function setColor(name: string, rgb: RGB): number {
  const key = name.trim().toLowerCase();
  const existing = NAME_TO_INDEX.get(key);
  const idx = existing ?? nextColorIndex++;
  NAME_TO_INDEX.set(key, idx);
  INDEX_TO_RGB.set(idx, [rgb[0], rgb[1], rgb[2]]);
  return idx;
}

/**
 * CPK element → colour name (`packages/engine/layer1/AtomInfo.cpp` element
 * colours). Used by `util.cbag`/`cbac`/… and the by-element default. Carbon is
 * left to the caller (cbag=green, cbac=cyan, …); everything else is CPK.
 */
export const ELEMENT_COLOR: Readonly<Record<string, string>> = {
  N: 'blue',
  O: 'red',
  S: 'yellow',
  H: 'white',
  P: 'orange',
  F: 'green',
  Cl: 'green',
  Br: 'firebrick',
  I: 'purple',
  Ca: 'green',
  Mg: 'forest',
  Zn: 'slate',
  Fe: 'orange',
  Na: 'purple',
};

/**
 * `cmd.get_color_index(name)` — resolve a colour name to its table index, or
 * `-1` when unknown (PyMOL returns -1 for an unknown colour name).
 */
export function getColorIndex(name: string): number {
  const idx = NAME_TO_INDEX.get(name.trim().toLowerCase());
  return idx === undefined ? -1 : idx;
}

/**
 * `cmd.get_color_tuple(index)` — the RGB triple for a colour index, or `null`
 * when the index has no entry.
 */
export function getColorTuple(index: number): RGB | null {
  return INDEX_TO_RGB.get(index) ?? null;
}

/** RGB for a colour index, defaulting to grey for an out-of-table index. */
export function rgbForIndex(index: number): RGB {
  return INDEX_TO_RGB.get(index) ?? [0.5, 0.5, 0.5];
}

export function colorNames(): string[] {
  return [...NAME_TO_INDEX.keys()];
}
