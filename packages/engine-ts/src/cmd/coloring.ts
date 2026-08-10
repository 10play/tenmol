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
 * Chain-colour cycle (util.cbc). Names from util.py `_color_cycle`, restricted
 * to colours present in the ported table so each resolves to a real index.
 * ------------------------------------------------------------------------ */

const CHAIN_COLOR_CYCLE = [
  'carbon', 'cyan', 'magenta', 'yellow', 'salmon', 'slate', 'orange',
  'green', 'teal', 'pink', 'marine', 'forest', 'violet', 'wheat', 'purple',
  'limon', 'firebrick', 'deepblue', 'gray', 'red',
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

  const spectrum = (args: unknown[], kwargs: Record<string, unknown>): Json => {
    const expr = (str(args[0] ?? kwargs.expression, 'count') || 'count').toLowerCase();
    const paletteName = (str(args[1] ?? kwargs.palette, 'rainbow') || 'rainbow').toLowerCase();
    const selection = str(args[2] ?? kwargs.selection, 'all') || 'all';
    let minimum = optNum(args[3] ?? kwargs.minimum);
    let maximum = optNum(args[4] ?? kwargs.maximum);
    const byres = Boolean(optNum(args[5] ?? kwargs.byres) ?? 0);

    const def = PALETTE_DICT[paletteName] ?? PALETTE_DICT.rainbow!;
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
