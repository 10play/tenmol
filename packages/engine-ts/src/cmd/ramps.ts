/**
 * The `ramps` command subsystem — colour ramps, gradients and volume ramps.
 *
 * Ports the pieces of PyMOL's `ObjectGadgetRamp` (`layer2/ObjectGadgetRamp.cpp`)
 * and the `cmd.ramp_new` / `cmd.gradient` / `cmd.volume_ramp_new` /
 * `cmd.volume_color` API that the covered slice needs: a piecewise-linear map
 * from scalar breakpoints (`range`) to colours (`color`).
 *
 *   - `ramp_new(name, map_name, range, color, ...)` defines a colour ramp; its
 *     value → RGB map is linear between adjacent breakpoints and clamps at the
 *     ends (PyMOL `ObjectGadgetRampInterpolate` / `RampInterpolateColor`).
 *   - `ramp_color(name, value)` reads that map back.
 *   - `ramp_update(name, range, color)` replaces the map in place.
 *   - `gradient(name, map_name, ...)` stores a gradient as a ramp.
 *   - `volume_ramp_new` / `volume_color` store a value → RGBA map;
 *     `volume_ramp_color(name, value)` reads it back.
 *   - `color_by_ramp(ramp_name, expr, selection)` recolours atoms by running a
 *     per-atom scalar (`b`/`q`) through a ramp, defining one named colour per
 *     distinct value (`cmd.set_color`) and assigning it.
 *
 * The ramp store is module-local (PyMOL keeps ramps as named gadget objects in
 * the executive; here a small map suffices for the covered commands).
 */

import type { Json } from '@tenmol/protocol';
import { getColorIndex, rgbForIndex, setColor, type RGB } from '../exec/color';
import type { RegistrarCtx } from './registrar';

type RGBA = readonly [number, number, number, number];

/** A colour ramp: sorted scalar breakpoints paired with RGB colours. */
interface ColorRamp {
  range: number[];
  colors: RGB[];
}

/** A volume ramp: scalar breakpoints paired with RGBA colours. */
interface VolumeRamp {
  range: number[];
  colors: RGBA[];
}

// Module-local stores (shared across every registerRamps binding).
const RAMPS = new Map<string, ColorRamp>();
const VOLUME_RAMPS = new Map<string, VolumeRamp>();

/* --------------------------------------------------------------------------
 * Argument coercion. The console passes everything as strings; programmatic
 * callers pass real arrays. Accept both.
 * ------------------------------------------------------------------------ */

/** Parse a flat list of numbers from an array or a bracketed/comma string. */
function parseNumberList(v: unknown): number[] {
  if (Array.isArray(v)) return v.map(Number).filter((n) => Number.isFinite(n));
  if (v == null) return [];
  return String(v)
    .replace(/[[\]()]/g, ' ')
    .split(/[\s,]+/)
    .filter((s) => s.length > 0)
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

/** Resolve one colour spec (a name or an [r,g,b] triple) to an RGB. */
function coerceColor(spec: unknown): RGB {
  if (Array.isArray(spec)) {
    const r = Number(spec[0] ?? 0);
    const g = Number(spec[1] ?? 0);
    const b = Number(spec[2] ?? 0);
    // 0..255 inputs normalise to 0..1 (PyMOL accepts either).
    if (r > 1 || g > 1 || b > 1) return [r / 255, g / 255, b / 255];
    return [r, g, b];
  }
  const name = String(spec).trim();
  // A bracketed triple that arrived as a string, e.g. "[1, 0, 0]".
  if (/[[(]/.test(name)) {
    const nums = parseNumberList(name);
    if (nums.length >= 3) return coerceColor([nums[0]!, nums[1]!, nums[2]!]);
  }
  const idx = getColorIndex(name);
  return idx >= 0 ? rgbForIndex(idx) : [0.5, 0.5, 0.5];
}

/**
 * Parse a list of colour specs. Accepts an array whose entries are names or
 * triples, or a flat numeric array (chunked into RGB triples), or a bracketed
 * string of names / numbers.
 */
function parseColorList(v: unknown): RGB[] {
  if (Array.isArray(v)) {
    // A flat numeric array like [0,0,1, 1,1,1] -> triples.
    if (v.length > 0 && v.every((e) => typeof e === 'number')) {
      const out: RGB[] = [];
      for (let i = 0; i + 2 < v.length; i += 3) {
        out.push(coerceColor([v[i], v[i + 1], v[i + 2]]));
      }
      return out;
    }
    return v.map(coerceColor);
  }
  if (v == null) return [];
  // A string: split top-level items on commas, but keep bracketed triples whole.
  const s = String(v).trim().replace(/^\[|\]$/g, '');
  const items: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '[' || ch === '(') depth++;
    if (ch === ']' || ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      if (cur.trim()) items.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) items.push(cur.trim());
  return items.map(coerceColor);
}

/** Linear interpolation between two RGBs. */
function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Linear interpolation between two RGBAs. */
function lerpRgba(a: RGBA, b: RGBA, t: number): RGBA {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
  ];
}

/**
 * Evaluate a piecewise-linear breakpoint map at `value`. Clamps to the end
 * colours outside the range (PyMOL's ramp behaviour). `lerp` interpolates the
 * colour type; the map must have at least one breakpoint.
 */
function interpolate<C>(
  range: number[],
  colors: C[],
  value: number,
  lerp: (a: C, b: C, t: number) => C,
): C {
  const n = Math.min(range.length, colors.length);
  const first = colors[0]!;
  if (n === 1) return first;
  if (value <= range[0]!) return first;
  const lastIdx = n - 1;
  if (value >= range[lastIdx]!) return colors[lastIdx]!;
  for (let i = 0; i < lastIdx; i++) {
    const lo = range[i]!;
    const hi = range[i + 1]!;
    if (value >= lo && value <= hi) {
      const span = hi - lo;
      const t = span === 0 ? 0 : (value - lo) / span;
      return lerp(colors[i]!, colors[i + 1]!, t);
    }
  }
  return colors[lastIdx]!;
}

/* --------------------------------------------------------------------------
 * Registration.
 * ------------------------------------------------------------------------ */

export function registerRamps(ctx: RegistrarCtx): void {
  const { executive: ex, str } = ctx;

  /* ------------------------------- ramp_new ----------------------------- */

  const defineRamp = (name: string, range: number[], colors: RGB[]): void => {
    RAMPS.set(name, { range, colors });
  };

  ctx.command('ramp_new', (args, kwargs): Json => {
    const name = str(args[0] ?? kwargs.name);
    const range = parseNumberList(args[2] ?? kwargs.range);
    const colors = parseColorList(args[3] ?? kwargs.color);
    defineRamp(name, range, colors);
    ex.registerGadget(name, 'object:ramp');
    ctx.publish();
    // colorramping.py `ramp_new` returns the `_cmd` result (None), not the name.
    return null;
  });

  /* ----------------------------- ramp_update ---------------------------- */

  ctx.command('ramp_update', (args, kwargs): Json => {
    const name = str(args[0] ?? kwargs.name);
    const existing = RAMPS.get(name);
    const rangeArg = args[1] ?? kwargs.range;
    const colorArg = args[2] ?? kwargs.color;
    const range = rangeArg != null ? parseNumberList(rangeArg) : (existing?.range ?? []);
    const colors = colorArg != null ? parseColorList(colorArg) : (existing?.colors ?? []);
    defineRamp(name, range, colors);
    ctx.publish();
    return name;
  });

  /* ------------------------------ ramp_color ---------------------------- */

  ctx.command('ramp_color', (args, kwargs): Json => {
    const name = str(args[0] ?? kwargs.name);
    const value = Number(args[1] ?? kwargs.value ?? 0);
    const ramp = RAMPS.get(name);
    if (!ramp || ramp.colors.length === 0) return [0.5, 0.5, 0.5];
    const rgb = interpolate(ramp.range, ramp.colors, value, lerpRgb);
    return [rgb[0], rgb[1], rgb[2]];
  });

  /* ------------------------------- gradient ----------------------------- */

  // A gradient is stored like a ramp: PyMOL's `cmd.gradient` builds a gadget
  // with a colour ramp over the map's value range. When explicit range/color
  // are supplied we honour them; otherwise a default blue→white→red ramp.
  ctx.command('gradient', (args, kwargs): Json => {
    const name = str(args[0] ?? kwargs.name);
    const rangeArg = args[2] ?? kwargs.range;
    const colorArg = args[3] ?? kwargs.color;
    const range = rangeArg != null ? parseNumberList(rangeArg) : [0, 0.5, 1];
    const colors =
      colorArg != null
        ? parseColorList(colorArg)
        : [coerceColor('blue'), coerceColor('white'), coerceColor('red')];
    defineRamp(name, range, colors);
    // PyMOL's gradient builds an ObjectMesh gadget over the map's value range.
    ex.registerGadget(name, 'object:mesh');
    ctx.publish();
    return name;
  });

  /* --------------------------- volume_ramp_new -------------------------- */

  // The volume ramp is a flat list of (value, r, g, b, alpha) quintuples.
  const defineVolumeRamp = (name: string, flat: number[]): void => {
    const range: number[] = [];
    const colors: RGBA[] = [];
    for (let i = 0; i + 4 < flat.length; i += 5) {
      range.push(flat[i]!);
      let r = flat[i + 1]!;
      let g = flat[i + 2]!;
      let b = flat[i + 3]!;
      const a = flat[i + 4]!;
      if (r > 1 || g > 1 || b > 1) {
        r /= 255;
        g /= 255;
        b /= 255;
      }
      colors.push([r, g, b, a]);
    }
    VOLUME_RAMPS.set(name, { range, colors });
  };

  ctx.command('volume_ramp_new', (args, kwargs): Json => {
    const name = str(args[0] ?? kwargs.name);
    const flat = parseNumberList(args[1] ?? kwargs.ramp);
    defineVolumeRamp(name, flat);
    ctx.publish();
    // colorramping.py `volume_ramp_new` returns the `_cmd` result (None), not the
    // name — matches the oracle.
    return null;
  });

  ctx.command('volume_color', (args, kwargs): Json => {
    const name = str(args[0] ?? kwargs.name);
    const rampArg = args[1] ?? kwargs.ramp ?? kwargs.color;
    // Empty `ramp` ⇒ getter (colorramping.py:123 `volume_color(name)`): return
    // the volume's value→RGBA transfer function as a flat [value, r, g, b, alpha]
    // * N list with RGB in 0..1, exactly the shape `_cmd.volume_color` reads back.
    if (rampArg == null || (typeof rampArg === 'string' && rampArg.trim() === '')) {
      const ramp = VOLUME_RAMPS.get(name);
      if (!ramp) return [];
      const out: number[] = [];
      for (let i = 0; i < ramp.colors.length; i++) {
        const c = ramp.colors[i]!;
        out.push(ramp.range[i]!, c[0], c[1], c[2], c[3]);
      }
      return out;
    }
    const flat = parseNumberList(rampArg);
    defineVolumeRamp(name, flat);
    ctx.publish();
    return name;
  });

  ctx.command('volume_ramp_color', (args, kwargs): Json => {
    const name = str(args[0] ?? kwargs.name);
    const value = Number(args[1] ?? kwargs.value ?? 0);
    const ramp = VOLUME_RAMPS.get(name);
    if (!ramp || ramp.colors.length === 0) return [0, 0, 0, 0];
    const rgba = interpolate(ramp.range, ramp.colors, value, lerpRgba);
    return [rgba[0], rgba[1], rgba[2], rgba[3]];
  });

  /* ---------------------------- color_by_ramp --------------------------- */

  ctx.command('color_by_ramp', (args, kwargs): Json => {
    const rampName = str(args[0] ?? kwargs.ramp_name ?? kwargs.name);
    const expr = (str(args[1] ?? kwargs.expression, 'b') || 'b').toLowerCase();
    const selection = str(args[2] ?? kwargs.selection, 'all') || 'all';
    const ramp = RAMPS.get(rampName);
    if (!ramp || ramp.colors.length === 0) return 0;

    const atoms = ex.atomsMatching(selection);
    // One named colour per distinct value keeps the palette small and stable.
    const colorForValue = new Map<number, number>();
    for (const ua of atoms) {
      const value = expr === 'q' ? ua.atom.q : ua.atom.b;
      let idx = colorForValue.get(value);
      if (idx === undefined) {
        const rgb = interpolate(ramp.range, ramp.colors, value, lerpRgb);
        idx = setColor(`0x_ramp_${rampName}_${value}`, [rgb[0], rgb[1], rgb[2]]);
        colorForValue.set(value, idx);
      }
      ua.atom.color = idx;
    }
    ctx.publish();
    return atoms.length;
  });
}
