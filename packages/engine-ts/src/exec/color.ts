/**
 * The named-colour table — `cmd.get_color_index` / `cmd.get_color_tuple` and the
 * name resolution `cmd.color` performs.
 *
 * Ports PyMOL's full colour table from `packages/engine/layer1/Color.cpp`
 * (`ColorInit`). PyMOL registers colours sequentially, so a name's index is its
 * position in the registration order: the standard palette, then the generated
 * ramps (`greybow` grey00-99, the `s`/`r`/`c`/`w`/`o` spectra of 1000 each, the
 * `gray00-99` ramp), then the full periodic-table element palette. Reproducing
 * that order verbatim is what makes `get_color_index` match real PyMOL exactly
 * (e.g. `aluminum` → 5289), not just the RGB tuple. The RGB triples are PyMOL's
 * exact values; the differential suite gates colour parity on them.
 */

import { CMYK_TABLE_B64 } from './cmyk_table';

export type RGB = readonly [number, number, number];

/** Mutable RGB used while generating ramp colours. */
type RGB3 = [number, number, number];

/**
 * Standard/primary palette — PyMOL's first `reg_named_color` block
 * (`white` … `violet`), in registration order so indices match (white=0,
 * black=1, blue=2, green=3, red=4, …).
 */
const STANDARD: ReadonlyArray<readonly [string, RGB]> = [
  ['white', [1, 1, 1]],
  ['black', [0, 0, 0]],
  ['blue', [0, 0, 1]],
  ['green', [0, 1, 0]],
  ['red', [1, 0, 0]],
  ['cyan', [0, 1, 1]],
  ['yellow', [1, 1, 0]],
  ['dash', [1, 1, 0]],
  ['magenta', [1, 0, 1]],
  ['salmon', [1, 0.6, 0.6]],
  ['lime', [0.5, 1, 0.5]],
  ['slate', [0.5, 0.5, 1]],
  ['hotpink', [1, 0, 0.5]],
  ['orange', [1, 0.5, 0]],
  ['chartreuse', [0.5, 1, 0]],
  ['limegreen', [0, 1, 0.5]],
  ['purpleblue', [0.5, 0, 1]],
  ['marine', [0, 0.5, 1]],
  ['olive', [0.77, 0.7, 0]],
  ['purple', [0.75, 0, 0.75]],
  ['teal', [0, 0.75, 0.75]],
  ['ruby', [0.6, 0.2, 0.2]],
  ['forest', [0.2, 0.6, 0.2]],
  ['deepblue', [0.25, 0.25, 0.65]],
  ['grey', [0.5, 0.5, 0.5]],
  ['gray', [0.5, 0.5, 0.5]],
  ['carbon', [0.2, 1, 0.2]],
  ['nitrogen', [0.2, 0.2, 1]],
  ['oxygen', [1, 0.3, 0.3]],
  ['hydrogen', [0.9, 0.9, 0.9]],
  ['brightorange', [1, 0.7, 0.2]],
  ['sulfur', [0.9, 0.775, 0.25]],
  ['tv_red', [1, 0.2, 0.2]],
  ['tv_green', [0.2, 1, 0.2]],
  ['tv_blue', [0.3, 0.3, 1]],
  ['tv_yellow', [1, 1, 0.2]],
  ['yelloworange', [1, 0.87, 0.37]],
  ['tv_orange', [1, 0.55, 0.15]],
  ['br0', [0.1, 0.1, 1]],
  ['br1', [0.2, 0.1, 0.9]],
  ['br2', [0.3, 0.1, 0.8]],
  ['br3', [0.4, 0.1, 0.7]],
  ['br4', [0.5, 0.1, 0.6]],
  ['br5', [0.6, 0.1, 0.5]],
  ['br6', [0.7, 0.1, 0.4]],
  ['br7', [0.8, 0.1, 0.3]],
  ['br8', [0.9, 0.1, 0.2]],
  ['br9', [1, 0.1, 0.1]],
  ['pink', [1, 0.65, 0.85]],
  ['firebrick', [0.698, 0.13, 0.13]],
  ['chocolate', [0.555, 0.222, 0.111]],
  ['brown', [0.65, 0.32, 0.17]],
  ['wheat', [0.99, 0.82, 0.65]],
  ['violet', [1, 0.5, 1]],
];

/**
 * Periodic-table element palette + remaining extended colours — PyMOL's final
 * `reg_named_color` block (`paleyellow` … `pseudoatom`), registered after the
 * generated ramps.
 */
const ELEMENTS: ReadonlyArray<readonly [string, RGB]> = [
  ['paleyellow', [1, 1, 0.5]],
  ['aquamarine', [0.5, 1, 1]],
  ['deepsalmon', [1, 0.5, 0.5]],
  ['palegreen', [0.65, 0.9, 0.65]],
  ['deepolive', [0.6, 0.6, 0.1]],
  ['deeppurple', [0.6, 0.1, 0.6]],
  ['deepteal', [0.1, 0.6, 0.6]],
  ['lightblue', [0.75, 0.75, 1]],
  ['lightorange', [1, 0.8, 0.5]],
  ['palecyan', [0.8, 1, 1]],
  ['lightteal', [0.4, 0.7, 0.7]],
  ['splitpea', [0.52, 0.75, 0]],
  ['raspberry', [0.7, 0.3, 0.4]],
  ['sand', [0.72, 0.55, 0.3]],
  ['smudge', [0.55, 0.7, 0.4]],
  ['violetpurple', [0.55, 0.25, 0.6]],
  ['dirtyviolet', [0.7, 0.5, 0.5]],
  ['_deepsalmon', [1, 0.42, 0.42]],
  ['lightpink', [1, 0.75, 0.87]],
  ['greencyan', [0.25, 1, 0.75]],
  ['limon', [0.75, 1, 0.25]],
  ['skyblue', [0.2, 0.5, 0.8]],
  ['bluewhite', [0.85, 0.85, 1]],
  ['warmpink', [0.85, 0.2, 0.5]],
  ['darksalmon', [0.73, 0.55, 0.52]],
  ['helium', [0.850980392, 1, 1]],
  ['lithium', [0.8, 0.501960784, 1]],
  ['beryllium', [0.760784314, 1, 0]],
  ['boron', [1, 0.709803922, 0.709803922]],
  ['fluorine', [0.701960784, 1, 1]],
  ['neon', [0.701960784, 0.890196078, 0.960784314]],
  ['sodium', [0.670588235, 0.360784314, 0.949019608]],
  ['magnesium', [0.541176471, 1, 0]],
  ['aluminum', [0.749019608, 0.650980392, 0.650980392]],
  ['silicon', [0.941176471, 0.784313725, 0.62745098]],
  ['phosphorus', [1, 0.501960784, 0]],
  ['chlorine', [0.121568627, 0.941176471, 0.121568627]],
  ['argon', [0.501960784, 0.819607843, 0.890196078]],
  ['potassium', [0.560784314, 0.250980392, 0.831372549]],
  ['calcium', [0.239215686, 1, 0]],
  ['scandium', [0.901960784, 0.901960784, 0.901960784]],
  ['titanium', [0.749019608, 0.760784314, 0.780392157]],
  ['vanadium', [0.650980392, 0.650980392, 0.670588235]],
  ['chromium', [0.541176471, 0.6, 0.780392157]],
  ['manganese', [0.611764706, 0.478431373, 0.780392157]],
  ['iron', [0.878431373, 0.4, 0.2]],
  ['cobalt', [0.941176471, 0.564705882, 0.62745098]],
  ['nickel', [0.31372549, 0.815686275, 0.31372549]],
  ['copper', [0.784313725, 0.501960784, 0.2]],
  ['zinc', [0.490196078, 0.501960784, 0.690196078]],
  ['gallium', [0.760784314, 0.560784314, 0.560784314]],
  ['germanium', [0.4, 0.560784314, 0.560784314]],
  ['arsenic', [0.741176471, 0.501960784, 0.890196078]],
  ['selenium', [1, 0.631372549, 0]],
  ['bromine', [0.650980392, 0.160784314, 0.160784314]],
  ['krypton', [0.360784314, 0.721568627, 0.819607843]],
  ['rubidium', [0.439215686, 0.180392157, 0.690196078]],
  ['strontium', [0, 1, 0]],
  ['yttrium', [0.580392157, 1, 1]],
  ['zirconium', [0.580392157, 0.878431373, 0.878431373]],
  ['niobium', [0.450980392, 0.760784314, 0.788235294]],
  ['molybdenum', [0.329411765, 0.709803922, 0.709803922]],
  ['technetium', [0.231372549, 0.619607843, 0.619607843]],
  ['ruthenium', [0.141176471, 0.560784314, 0.560784314]],
  ['rhodium', [0.039215686, 0.490196078, 0.549019608]],
  ['palladium', [0, 0.411764706, 0.521568627]],
  ['silver', [0.752941176, 0.752941176, 0.752941176]],
  ['cadmium', [1, 0.850980392, 0.560784314]],
  ['indium', [0.650980392, 0.458823529, 0.450980392]],
  ['tin', [0.4, 0.501960784, 0.501960784]],
  ['antimony', [0.619607843, 0.388235294, 0.709803922]],
  ['tellurium', [0.831372549, 0.478431373, 0]],
  ['iodine', [0.580392157, 0, 0.580392157]],
  ['xenon', [0.258823529, 0.619607843, 0.690196078]],
  ['cesium', [0.341176471, 0.090196078, 0.560784314]],
  ['barium', [0, 0.788235294, 0]],
  ['lanthanum', [0.439215686, 0.831372549, 1]],
  ['cerium', [1, 1, 0.780392157]],
  ['praseodymium', [0.850980392, 1, 0.780392157]],
  ['neodymium', [0.780392157, 1, 0.780392157]],
  ['promethium', [0.639215686, 1, 0.780392157]],
  ['samarium', [0.560784314, 1, 0.780392157]],
  ['europium', [0.380392157, 1, 0.780392157]],
  ['gadolinium', [0.270588235, 1, 0.780392157]],
  ['terbium', [0.188235294, 1, 0.780392157]],
  ['dysprosium', [0.121568627, 1, 0.780392157]],
  ['holmium', [0, 1, 0.611764706]],
  ['erbium', [0, 0.901960784, 0.458823529]],
  ['thulium', [0, 0.831372549, 0.321568627]],
  ['ytterbium', [0, 0.749019608, 0.219607843]],
  ['lutetium', [0, 0.670588235, 0.141176471]],
  ['hafnium', [0.301960784, 0.760784314, 1]],
  ['tantalum', [0.301960784, 0.650980392, 1]],
  ['tungsten', [0.129411765, 0.580392157, 0.839215686]],
  ['rhenium', [0.149019608, 0.490196078, 0.670588235]],
  ['osmium', [0.149019608, 0.4, 0.588235294]],
  ['iridium', [0.090196078, 0.329411765, 0.529411765]],
  ['platinum', [0.815686275, 0.815686275, 0.878431373]],
  ['gold', [1, 0.819607843, 0.137254902]],
  ['mercury', [0.721568627, 0.721568627, 0.815686275]],
  ['thallium', [0.650980392, 0.329411765, 0.301960784]],
  ['lead', [0.341176471, 0.349019608, 0.380392157]],
  ['bismuth', [0.619607843, 0.309803922, 0.709803922]],
  ['polonium', [0.670588235, 0.360784314, 0]],
  ['astatine', [0.458823529, 0.309803922, 0.270588235]],
  ['radon', [0.258823529, 0.509803922, 0.588235294]],
  ['francium', [0.258823529, 0, 0.4]],
  ['radium', [0, 0.490196078, 0]],
  ['actinium', [0.439215686, 0.670588235, 0.980392157]],
  ['thorium', [0, 0.729411765, 1]],
  ['protactinium', [0, 0.631372549, 1]],
  ['uranium', [0, 0.560784314, 1]],
  ['neptunium', [0, 0.501960784, 1]],
  ['plutonium', [0, 0.419607843, 1]],
  ['americium', [0.329411765, 0.360784314, 0.949019608]],
  ['curium', [0.470588235, 0.360784314, 0.890196078]],
  ['berkelium', [0.541176471, 0.309803922, 0.890196078]],
  ['californium', [0.631372549, 0.211764706, 0.831372549]],
  ['einsteinium', [0.701960784, 0.121568627, 0.831372549]],
  ['fermium', [0.701960784, 0.121568627, 0.729411765]],
  ['mendelevium', [0.701960784, 0.050980392, 0.650980392]],
  ['nobelium', [0.741176471, 0.050980392, 0.529411765]],
  ['lawrencium', [0.780392157, 0, 0.4]],
  ['rutherfordium', [0.8, 0, 0.349019608]],
  ['dubnium', [0.819607843, 0, 0.309803922]],
  ['seaborgium', [0.850980392, 0, 0.270588235]],
  ['bohrium', [0.878431373, 0, 0.219607843]],
  ['hassium', [0.901960784, 0, 0.180392157]],
  ['meitnerium', [0.921568627, 0, 0.149019608]],
  ['deuterium', [0.9, 0.9, 0.9]],
  ['lonepair', [0.5, 0.5, 0.5]],
  ['pseudoatom', [0.9, 0.9, 0.9]],
];

// Spectrum control points for the generated ramps (Color.cpp `spectrum{S,R,C,W,O}`).
const spectrumS: RGB[] = [
  [1, 0, 1], [0.5, 0, 1], [0, 0, 1], [0, 0.5, 1], [0, 1, 1], [0, 1, 0.5],
  [0, 1, 0], [0.5, 1, 0], [1, 1, 0], [1, 0.5, 0], [1, 0, 0], [1, 0, 0.5], [1, 0, 1],
];
const spectrumR: RGB[] = [
  [1, 1, 0], [0.5, 1, 0], [0, 1, 0], [0, 1, 0.5], [0, 1, 1], [0, 0.5, 1],
  [0, 0, 1], [0.5, 0, 1], [1, 0, 1], [1, 0, 0.5], [1, 0, 0], [1, 0.5, 0], [1, 1, 0],
];
const spectrumC: RGB[] = [
  [1, 1, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0], [1, 0, 1], [0, 1, 1],
  [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 0], [1, 0, 0], [0, 1, 1],
];
const spectrumW: RGB[] = [
  [1, 1, 0], [1, 1, 1], [0, 0, 1], [1, 1, 1], [1, 0, 0], [1, 1, 1],
  [0, 1, 0], [1, 1, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1], [1, 1, 1],
  [1, 1, 0], [1, 1, 1], [0, 1, 0], [1, 1, 1], [0, 0, 1], [1, 1, 1],
  [1, 0, 1], [1, 1, 1], [1, 1, 0], [1, 1, 1], [1, 0, 0], [1, 1, 1], [0, 1, 1],
];
const spectrumO: RGB[] = [
  [1, 0, 1], [0.8, 0, 1], [0.5, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0.2, 1],
  [0, 0.5, 1], [0, 0.8, 1], [0, 1, 1], [0, 1, 0.8], [0, 1, 0.5], [0, 1, 0.2],
  [0, 1, 0], [0.2, 1, 0], [0.5, 1, 0], [0.8, 1, 0], [1, 1, 0], [1, 0.9, 0],
  [1, 0.75, 0], [1, 0.6, 0], [1, 0.5, 0], [1, 0.4, 0], [1, 0.3, 0], [1, 0.2, 0],
  [1, 0, 0], [1, 0, 0], [1, 0, 0.5], [1, 0, 0.8], [1, 0, 1],
];

const A_DIV = 83.333333333;
const W_DIV = 41.666666667;
const B_DIV = 35.7143;

const pad2 = (a: number): string => String(a).padStart(2, '0');
const pad3 = (a: number): string => String(a).padStart(3, '0');

/**
 * Build the full colour table in PyMOL's exact `ColorInit` registration order.
 * Index === position, so every named colour resolves to its real PyMOL index.
 */
function buildPalette(): Array<readonly [string, RGB]> {
  const out: Array<readonly [string, RGB]> = [];
  const add = (name: string, rgb: RGB): void => {
    out.push([name, rgb]);
  };

  for (const e of STANDARD) add(e[0], e[1]);

  // greybow (grey00-grey99)
  for (let a = 0; a < 100; a++) add(`grey${pad2(a)}`, [a / 99, a / 99, a / 99]);
  add('lightmagenta', [1, 0.2, 0.8]);

  // Interpolated spectrum ramps.
  const ramp = (prefix: string, spec: RGB[], div: number): void => {
    for (let a = 0; a < 1000; a++) {
      const set1 = Math.floor(a / div);
      const f = 1 - (a - set1 * div) / div;
      const lo = spec[set1]!;
      const hi = spec[set1 + 1]!;
      const rgb: RGB3 = [
        f * lo[0] + (1 - f) * hi[0],
        f * lo[1] + (1 - f) * hi[1],
        f * lo[2] + (1 - f) * hi[2],
      ];
      add(`${prefix}${pad3(a)}`, rgb);
    }
  };
  ramp('s', spectrumS, A_DIV);
  ramp('r', spectrumR, A_DIV);
  ramp('c', spectrumC, A_DIV);
  ramp('w', spectrumW, W_DIV);
  add('density', [0.1, 0.1, 0.6]);
  // gray ramp (gray00-gray99)
  for (let a = 0; a < 100; a++) add(`gray${pad2(a)}`, [a / 99, a / 99, a / 99]);
  ramp('o', spectrumO, B_DIV);

  for (const e of ELEMENTS) add(e[0], e[1]);

  return out;
}

const PALETTE: ReadonlyArray<readonly [string, RGB]> = buildPalette();

const NAME_TO_INDEX = new Map<string, number>();
const INDEX_TO_RGB = new Map<number, RGB>();
const INDEX_TO_NAME = new Map<number, string>();

/** Next index for a runtime-defined colour (`cmd.set_color`). */
let nextColorIndex = PALETTE.length;

/**
 * (Re)load the built-in palette into the lookup tables, discarding any colours a
 * previous session defined with `set_color`. Runs at module load and from
 * {@link resetColorTable}.
 */
function loadPalette(): void {
  NAME_TO_INDEX.clear();
  INDEX_TO_RGB.clear();
  INDEX_TO_NAME.clear();
  for (let i = 0; i < PALETTE.length; i++) {
    const [name, rgb] = PALETTE[i]!;
    NAME_TO_INDEX.set(name, i);
    INDEX_TO_RGB.set(i, rgb);
    // First name registered for an index wins, so aliases (`grey`/`gray`) resolve
    // back to their canonical spelling — matching PyMOL's `ColorGetName`.
    if (!INDEX_TO_NAME.has(i)) INDEX_TO_NAME.set(i, name);
  }
  nextColorIndex = PALETTE.length;
}
loadPalette();

/**
 * Reset the colour table to the built-in palette, as PyMOL's `ColorReset` does for a
 * fresh session. The lookup tables and the `set_color` cursor are module-level
 * singletons — deliberately, since PyMOL's colour table is one flat global namespace —
 * so without this a colour defined by one {@link Engine} would leak into the next one
 * built in the same process. Called once per session from `registerColoring`, which
 * keeps each engine's colour table independent (and per-probe replay deterministic).
 */
export function resetColorTable(): void {
  loadPalette();
}

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
  if (!INDEX_TO_NAME.has(idx)) INDEX_TO_NAME.set(idx, key);
  return idx;
}

/**
 * Element → PyMOL element-colour name (`packages/engine/layer1/AtomInfo.cpp`
 * `AtomInfoGetColorWithVDW`). Used by `util.cbag`/`cbac`/… and the by-element
 * default. Non-carbon atoms get their element colour (e.g. N → the `nitrogen`
 * colour, NOT plain `blue`), which is what real PyMOL assigns — so a per-atom
 * `color nitrogen` count and RGB match. Carbon is left to the caller (each
 * `cbXX` variant picks a different carbon colour).
 */
export const ELEMENT_COLOR: Readonly<Record<string, string>> = {
  N: 'nitrogen',
  O: 'oxygen',
  S: 'sulfur',
  H: 'hydrogen',
  P: 'phosphorus',
  F: 'fluorine',
  Cl: 'chlorine',
  Br: 'bromine',
  I: 'iodine',
  Ca: 'calcium',
  Mg: 'magnesium',
  Zn: 'zinc',
  Fe: 'iron',
  Na: 'sodium',
  K: 'potassium',
};

/**
 * The special negative colour indices (`packages/engine/layer1/Color.h`). These
 * are resolved by name in `ColorGetIndex` (`Color.cpp:711`) and are part of the
 * single flat integer namespace all colour references share. `auto` (-2) /
 * `current` (-3) are intentionally omitted: real PyMOL resolves them through
 * `ColorGetNext`/`ColorGetCurrent` (the auto-colour cycle), not to the raw
 * sentinel, so leaving them to fall through to the name lookup avoids returning
 * a wrong-but-quiet value here.
 */
const SPECIAL_COLOR_INDEX: Readonly<Record<string, number>> = {
  default: -1, // cColorDefault
  atomic: -4, // cColorAtomic
  object: -5, // cColorObject
  front: -6, // cColorFront
  back: -7, // cColorBack
};

/** `0x40000000` — the high bits that tag an inline 24-bit RGB colour (TRGB). */
const TRGB_BITS = 0x40000000;

/**
 * `cmd.get_color_index(name)` — resolve a colour reference to its table index,
 * mirroring `ColorGetIndex` (`packages/engine/layer1/Color.cpp:661`): a raw
 * numeric index, a `0xRRGGBB` inline TRGB literal, one of the special words
 * (`default`/`atomic`/`object`/`front`/`back`), or a named-table entry. Returns
 * `-1` when unknown (PyMOL's `cColorDefault`, also its unknown-name sentinel).
 */
export function getColorIndex(name: string): number {
  const key = name.trim().toLowerCase();

  // Pure numeric string -> a raw index into the flat table, or a special.
  if (/^-?[0-9]+$/.test(key)) {
    const i = Number(key);
    if (i >= 0 && i < nextColorIndex) return i;
    if (i === -1 || i === -4 || i === -5 || i === -6 || i === -7) return i;
    if ((i & TRGB_BITS) !== 0) return i;
  }

  // `0xRRGGBB` explicit hex -> packed inline TRGB colour (transparency in the
  // top 6 bits), exactly as `ColorGetIndex` computes it.
  if (key.startsWith('0x')) {
    const v = parseInt(key.slice(2), 16);
    if (Number.isFinite(v)) return TRGB_BITS | (v & 0x00ffffff) | ((v >> 2) & 0x3f000000);
  }

  const special = SPECIAL_COLOR_INDEX[key];
  if (special !== undefined) return special;

  const idx = NAME_TO_INDEX.get(key);
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

/* --------------------------- colour space (`space`) --------------------- */
/**
 * The `space` command's colour-lookup table (LUT), ported from
 * `ColorTableLoad` / `lookup_color` in `packages/engine/layer1/Color.cpp`.
 *
 * `space cmyk|pymol|greyscale` loads a 64x64x64 colour table; every palette
 * colour is then re-mapped through it (`ColorGet` returns the LUT colour when
 * `clamp_colors` is on, which is the default), so `get_color_tuple` reports the
 * print/video-safe RGB instead of the raw palette value. `space rgb` (or an
 * empty argument) clears the table. A non-unit `gamma` applies PyMOL's
 * floating-point gamma correction on top.
 */

/** A decoded colour table: 3 bytes (R,G,B) per grid entry, flat index
 *  `(r6<<12)|(g6<<6)|b6`, matching PyMOL's `CColor::ColorTable`. */
export type ColorTable = Uint8Array;

/** Portable base64 → bytes (`atob` exists in Node ≥16 and every browser). */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let CMYK_TABLE: ColorTable | undefined;
/** The CMYK LUT, decoded from the embedded `cmyk.png` asset on first use. */
function cmykTable(): ColorTable {
  if (CMYK_TABLE === undefined) CMYK_TABLE = base64ToBytes(CMYK_TABLE_B64);
  return CMYK_TABLE;
}

/**
 * Generate the `greyscale` table (the `!strcmp(fname, "greyscale")` branch of
 * `ColorTableLoad`): each grid entry maps to the average of its R/G/B.
 */
function greyscaleTable(): ColorTable {
  const t = new Uint8Array(512 * 512 * 3);
  let r = 0,
    g = 0,
    b = 0;
  for (let i = 0; i < 512 * 512; i++) {
    const rc = ((r + g + b) / 3) | 0;
    t[i * 3] = rc;
    t[i * 3 + 1] = rc;
    t[i * 3 + 2] = rc;
    b += 4;
    if (!(0xff & b)) {
      b = 0;
      g += 4;
      if (!(0xff & g)) {
        g = 0;
        r += 4;
      }
    }
  }
  return t;
}

/**
 * Generate the `pymol` table (the `!strcmp(fname, "pymol")` branch of
 * `ColorTableLoad`): tames over-saturated colours for video/YUV. The clamp
 * limits are the compiled defaults of the `pymol_space_max_*`/`min_factor`
 * settings (`layer1/SettingInfo.h`).
 */
function pymolTable(): ColorTable {
  const redMax = 0.95,
    greenMax = 0.75,
    blueMax = 0.97,
    minFactor = 0.15;
  const t = new Uint8Array(512 * 512 * 3);
  let r = 0,
    g = 0,
    b = 0;
  for (let i = 0; i < 512 * 512; i++) {
    let rc = r,
      gc = g,
      bc = b;
    if (r >= g && r >= b) {
      if (rc > 255 * redMax) {
        rc = (redMax * 255) | 0;
        bc = r === 0 ? bc : ((bc * rc) / r) | 0;
        gc = r === 0 ? gc : ((gc * rc) / r) | 0;
      }
    } else if (g >= b && g >= r) {
      if (gc > 255 * greenMax) {
        gc = (greenMax * 255) | 0;
        bc = g === 0 ? bc : ((bc * gc) / g) | 0;
        rc = g === 0 ? rc : ((rc * gc) / g) | 0;
      }
    } else if (b >= g && b >= r) {
      if (bc > 255 * blueMax) {
        bc = (blueMax * 255) | 0;
        gc = b === 0 ? gc : ((gc * bc) / b) | 0;
        rc = b === 0 ? rc : ((rc * bc) / b) | 0;
      }
    }
    const rf = (minFactor * rc + 0.49999) | 0;
    const gf = (minFactor * gc + 0.49999) | 0;
    const bf = (minFactor * bc + 0.49999) | 0;
    if (rc < gf) rc = gf;
    if (bc < gf) bc = gf;
    if (rc < bf) rc = bf;
    if (gc < bf) gc = bf;
    if (gc < rf) gc = rf;
    if (bc < rf) bc = rf;
    if (rc > 255) rc = 255;
    if (bc > 255) bc = 255;
    if (gc > 255) gc = 255;
    t[i * 3] = rc;
    t[i * 3 + 1] = gc;
    t[i * 3 + 2] = bc;
    b += 4;
    if (!(0xff & b)) {
      b = 0;
      g += 4;
      if (!(0xff & g)) {
        g = 0;
        r += 4;
      }
    }
  }
  return t;
}

/**
 * Resolve a `space` name to its LUT, or `null` for the default RGB space (an
 * empty string, `rgb`, or any unrecognised palette). Mirrors PyMOL's
 * `space_dict`: `cmyk` loads the bundled table, `pymol`/`greyscale` are
 * generated.
 */
export function buildColorTable(space: string): ColorTable | null {
  switch (space.trim().toLowerCase()) {
    case 'cmyk':
      return cmykTable();
    case 'pymol':
      return pymolTable();
    case 'greyscale':
      return greyscaleTable();
    default:
      return null;
  }
}

/**
 * Port of `lookup_color` (`layer1/Color.cpp`): trilinear interpolation of an
 * input RGB through a colour `table`, plus the optional `gamma` correction.
 * A `null` table with `gamma === 1` is the identity. Input/output are 0..1.
 */
export function lookupColor(table: ColorTable | null, gamma: number, inp: RGB): RGB {
  const out: RGB3 = [inp[0], inp[1], inp[2]];
  if (table) {
    const r = ((255 * inp[0] + 0.5) | 0) & 0xff;
    const g = ((255 * inp[1] + 0.5) | 0) & 0xff;
    const b = ((255 * inp[2] + 0.5) | 0) & 0xff;
    const rr = r & 0x3,
      gr = g & 0x3,
      br = b & 0x3;
    const r6 = r >> 2,
      g6 = g >> 2,
      b6 = b >> 2;
    const frm1x = rr / 4,
      fgm1 = gr / 4,
      fbm1 = br / 4;
    const fr = 1 - frm1x,
      fg = 1 - fgm1,
      fb = 1 - fbm1;
    let rct = 0.4999,
      gct = 0.4999,
      bct = 0.4999;
    for (let x = 0; x < 2; x++) {
      const ra = Math.min(r6 + x, 63);
      for (let y = 0; y < 2; y++) {
        const ga = Math.min(g6 + y, 63);
        for (let z = 0; z < 2; z++) {
          const ba = Math.min(b6 + z, 63);
          const e = ((ra << 12) + (ga << 6) + ba) * 3;
          const w = (x ? frm1x : fr) * (y ? fgm1 : fg) * (z ? fbm1 : fb);
          rct += w * table[e]!;
          gct += w * table[e + 1]!;
          bct += w * table[e + 2]!;
        }
      }
    }
    if (r6 >= 63) rct += rr;
    if (g6 >= 63) gct += gr;
    if (b6 >= 63) bct += br;
    if (rct <= 2) rct = 0; // keep black black
    if (gct <= 2) gct = 0;
    if (bct <= 2) bct = 0;
    out[0] = rct / 255;
    out[1] = gct / 255;
    out[2] = bct / 255;
  }
  if (gamma !== 1 && gamma > 1e-4) {
    const invGamma = 1 / gamma;
    const inAvg = (out[0] + out[1] + out[2]) / 3;
    if (inAvg >= 1e-4) {
      const sig = Math.pow(inAvg, invGamma) / inAvg;
      out[0] *= sig;
      out[1] *= sig;
      out[2] *= sig;
    }
  }
  if (out[0] > 1) out[0] = 1;
  if (out[1] > 1) out[1] = 1;
  if (out[2] > 1) out[2] = 1;
  return out;
}

/**
 * `ColorGetName(G, color)` — the canonical name for a colour index, or `null`
 * for an index with no palette entry. Used to render colour-typed settings
 * (e.g. `bg_rgb`) as text: `get_setting_text('bg_rgb')` → `"white"`, not `"0"`.
 */
export function colorNameForIndex(index: number): string | null {
  return INDEX_TO_NAME.get(index) ?? null;
}

/**
 * Colour-typed settings (`REC_c` in `packages/engine/layer1/SettingInfo.h`).
 * They store a colour INDEX but read back as a colour NAME through
 * `get_setting_text` — real PyMOL's `SettingGetTextPtr` runs the `cSetting_color`
 * branch and returns `ColorGetName`, so `bg_rgb` set to white reads `"white"`.
 */
export const COLOR_SETTINGS: ReadonlySet<string> = new Set([
  'bg_rgb',
  'label_color',
  'surface_color',
  'mesh_color',
  'sphere_color',
  'dot_color',
  'ribbon_color',
  'cartoon_color',
  'ray_interior_color',
  'cartoon_highlight_color',
  'seq_view_color',
  'stick_color',
  'cartoon_ring_color',
  'cartoon_ladder_color',
  'cartoon_nucleic_acid_color',
  'label_outline_color',
  'seq_view_unaligned_color',
  'seq_view_fill_color',
  'seq_view_label_color',
  'line_color',
  'surface_negative_color',
  'mesh_negative_color',
  'ray_trace_color',
  'ellipsoid_color',
  'dash_color',
  'angle_color',
  'dihedral_color',
  'stick_ball_color',
  'volume_color',
  'bg_rgb_top',
  'bg_rgb_bottom',
  'label_connector_color',
  'label_bg_color',
  'cell_color',
]);

/**
 * Render a colour-typed setting's stored value as text, mirroring PyMOL's
 * `SettingGetTextPtr` `cSetting_color` branch: a stored colour index reads back
 * as its colour NAME. Falls back to the raw string for a non-palette index.
 */
export function colorSettingText(value: number | string | undefined): string {
  const idx = value === undefined ? -1 : Number(value);
  if (Number.isFinite(idx)) return colorNameForIndex(idx) ?? String(value ?? '');
  return String(value ?? '');
}

export function colorNames(): string[] {
  return [...NAME_TO_INDEX.keys()];
}

/**
 * The object/atom-level colour settings `color_deep` clears (PyMOL's
 * `menu.rep_setting_lists`), each mapped to its compiled default colour index
 * (`layer1/SettingInfo.h`, the `REC_c` rows). `color_deep` `unset`s all of
 * these over its selection; once unset, `get_setting_*` resolves the setting to
 * the default here (mostly `-1` = "follow atom colour", `-6` = "front" for the
 * label/ray-trace pair). Registered so a colour-typed setting reads back its
 * real PyMOL default rather than a bare `0`.
 */
export const REP_COLOR_SETTING_DEFAULTS: Readonly<Record<string, number>> = {
  line_color: -1,
  stick_color: -1,
  ribbon_color: -1,
  cartoon_color: -1,
  label_color: -6,
  dot_color: -1,
  sphere_color: -1,
  mesh_color: -1,
  surface_color: -1,
  dash_color: -1,
  angle_color: -1,
  dihedral_color: -1,
  cartoon_highlight_color: -1,
  cartoon_ladder_color: -1,
  cartoon_nucleic_acid_color: -1,
  cartoon_ring_color: -1,
  ellipsoid_color: -1,
  label_outline_color: -1,
  ray_interior_color: -1,
  ray_trace_color: -6,
  stick_ball_color: -1,
};
