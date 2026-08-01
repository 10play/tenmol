/**
 * The client-side colour table.
 *
 * PyMOL has no bulk colour accessor: `CmdGetColor` (`layer4/Cmd.cpp:1321-1391`)
 * returns the 5388 `(name, index)` pairs in one call (mode 2) and the RGB one
 * colour at a time (mode 0). So the palette is 1 + 5388 calls.
 *
 * MEASURED, against the real bridge on this machine (`scripts/dev-bridge.sh`,
 * PyMOL 3.2.0a): pipelining all 5388 `cmd.get_color_tuple` calls over the
 * WebSocket costs **184 ms** (29k calls/s) — the pump batches up to 256 tasks
 * per 60 Hz tick (`bridge/tenmol_bridge/pump.py:_max_batch`), so the whole
 * table lands in ~21 ticks. That is why this fetches everything instead of
 * lazily sampling: an index that is not in the cache is a colour the object
 * panel or Mode G cannot draw, and 184 ms once per session is cheaper than
 * being wrong.
 *
 * It has to happen more than once per session, which is the other reason the
 * loader lives here rather than in a `useEffect`: `cmd.space()` rewrites
 * `ColorRec::LutColor` (`layer1/Color.cpp:1680`) and `get_color_tuple` then
 * returns the LUT-mapped value, so EVERY entry can change. Verified: after
 * `space greyscale`, `red` reads `(0.343, 0.331, 0.331)` instead of
 * `(1, 0, 0)`.
 */

import {
  COLOR_TABLE_SIZE,
  NAMED_COLOR_COUNT,
  SPECIAL_COLORS,
  colorKind,
  decodeInlineColor,
  inlineColorName,
  rampSlot,
  rgbToCss,
  type ColorEntry,
  type ColorKind,
} from '@tenmol/protocol';

export type Rgb = readonly [number, number, number];

export interface SpecialColor {
  keyword: string;
  /** What `cmd.get_color_index(keyword)` answered, resolved live. */
  index: number;
  /** `get_color_tuple(index, 4)`; R is negative for a genuine special. */
  raw: Rgb | null;
  /** A drawable colour, or null when only the renderer knows (front/back). */
  rgb: Rgb | null;
}

export interface RampInfo {
  name: string;
  /** `-10 - slot`; the colour index this ramp can be used AS. */
  index: number;
}

export interface PaletteState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  /** Every registered slot, ordered by index. */
  entries: readonly ColorEntry[];
  /** The digit-free names only — what the Qt editor's `list_colors` shows. */
  named: readonly ColorEntry[];
  specials: readonly SpecialColor[];
  ramps: readonly RampInfo[];
  /** ms the last full fetch took; shown in the panel so the cost is visible. */
  loadedMs: number | null;
  /** Bumped on every successful load, so views can key off it. */
  revision: number;
}

export const EMPTY_PALETTE: PaletteState = {
  status: 'idle',
  error: null,
  entries: [],
  named: [],
  specials: [],
  ramps: [],
  loadedMs: null,
  revision: 0,
};

/** The one call shape this module needs from the session. */
export type CallFn = <T>(
  fn: string,
  args?: readonly unknown[],
  kwargs?: Readonly<Record<string, unknown>>,
) => Promise<T>;

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

/** How many `get_color_tuple` calls to have in flight at once. */
const CHUNK = 512;

function toRgb(value: unknown): Rgb | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const [r, g, b] = value as unknown[];
  if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') return null;
  return [r, g, b];
}

/**
 * `cmd.get_color_indices(all=1)` -> `[(name, index), ...]`.
 * Tolerant of the tuple arriving as a 2-array (it always does over JSON).
 */
export function parseColorIndices(value: unknown): { name: string; index: number }[] {
  if (!Array.isArray(value)) return [];
  const out: { name: string; index: number }[] = [];
  for (const pair of value) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const name = pair[0];
    const index = pair[1];
    if (typeof name !== 'string' || typeof index !== 'number') continue;
    out.push({ name, index });
  }
  return out;
}

export interface LoadedPalette {
  entries: ColorEntry[];
  named: ColorEntry[];
  specials: SpecialColor[];
  ramps: RampInfo[];
  ms: number;
}

/** Fetch the whole table, the seven keywords and the live ramps. */
export async function loadPalette(
  call: CallFn,
  now: () => number = Date.now,
): Promise<LoadedPalette> {
  const started = now();

  const all = parseColorIndices(await call('get_color_indices', [], { all: 1 }));
  const namedPairs = parseColorIndices(await call('get_color_indices', [], { all: 0 }));
  const namedSet = new Set(namedPairs.map((p) => p.index));

  const entries: ColorEntry[] = [];
  for (let i = 0; i < all.length; i += CHUNK) {
    const slice = all.slice(i, i + CHUNK);
    const rgbs = await Promise.all(
      slice.map((p) => call<unknown>('get_color_tuple', [p.index]).catch(() => null)),
    );
    slice.forEach((pair, k) => {
      const rgb = toRgb(rgbs[k]);
      entries.push({ index: pair.index, name: pair.name, rgb: rgb ?? [0, 0, 0] });
    });
  }

  const specials = await loadSpecials(call);
  const ramps = await loadRamps(call);

  return {
    entries,
    named: entries.filter((entry) => namedSet.has(entry.index)),
    specials,
    ramps,
    ms: now() - started,
  };
}

/**
 * The seven keywords, resolved through the backend every time.
 *
 * `auto` and `current` are not constants: `ColorGetIndex` runs `ColorGetNext`
 * / `ColorGetCurrent` (`layer1/Color.cpp:140,156`) and returns a real table
 * index that moves as objects are created. Measured on a fresh session,
 * `get_color_index('auto')` answered **26**, not -2. `front`/`back` are
 * genuine specials whose RGB depends on `bg_rgb` (`ColorUpdateFront`,
 * `Color.cpp:1754`); mode 4 flags those with a negative red component
 * (`ColorGetSpecial`, `Color.cpp:1789`), which is how this tells them apart.
 */
export async function loadSpecials(call: CallFn): Promise<SpecialColor[]> {
  const out: SpecialColor[] = [];
  const indices = await Promise.all(
    SPECIAL_COLORS.map((s) => call<unknown>('get_color_index', [s.keyword]).catch(() => null)),
  );
  const tuples = await Promise.all(
    indices.map((index) =>
      typeof index === 'number'
        ? call<unknown>('get_color_tuple', [index, 4]).catch(() => null)
        : Promise.resolve(null),
    ),
  );
  SPECIAL_COLORS.forEach((special, i) => {
    const index = indices[i];
    const raw = toRgb(tuples[i]);
    out.push({
      keyword: special.keyword,
      index: typeof index === 'number' ? index : special.index,
      raw,
      // A negative red means "this is a marker, not a colour" — do not draw it.
      rgb: raw && raw[0] >= 0 ? raw : null,
    });
  });
  return out;
}

/**
 * Live `object:ramp` objects. There is no `cmd.get_ramps()`; `pymol.menu`'s
 * own `menucontext` does exactly this scan (`modules/pymol/menu.py:33-36`).
 */
export async function loadRamps(call: CallFn): Promise<RampInfo[]> {
  const names = await call<unknown>('get_names', ['objects']).catch(() => null);
  if (!Array.isArray(names)) return [];
  const strings = names.filter((n): n is string => typeof n === 'string');
  const types = await Promise.all(
    strings.map((n) => call<unknown>('get_type', [n]).catch(() => null)),
  );
  const ramps: RampInfo[] = [];
  const rampNames = strings.filter((_n, i) => types[i] === 'object:ramp');
  const indices = await Promise.all(
    rampNames.map((n) => call<unknown>('get_color_index', [n]).catch(() => null)),
  );
  rampNames.forEach((name, i) => {
    const index = indices[i];
    ramps.push({ name, index: typeof index === 'number' ? index : 0 });
  });
  return ramps;
}

/* ------------------------------------------------------------------ *
 * Lookup
 * ------------------------------------------------------------------ */

export interface ResolvedColor {
  kind: ColorKind;
  /** Drawable RGB, or null when only PyMOL can say (front/back, unknown). */
  rgb: Rgb | null;
  /** What PyMOL would print for this index (`ColorGetName`, Color.cpp:759). */
  label: string;
  css: string | null;
}

/**
 * Index -> colour, covering all four kinds of index PyMOL hands out.
 *
 * This is the function every other feature needs: `ObjectRow.color`,
 * `IndexedMeshHeader.oneColor` and the CGO colour arrays are all raw indices,
 * and three of the four kinds cannot be looked up in a table at all.
 */
export function resolveColor(state: PaletteState, index: number): ResolvedColor {
  const kind = colorKind(index);
  if (kind === 'inline') {
    const rgb = decodeInlineColor(index);
    return { kind, rgb, label: inlineColorName(index) ?? '', css: rgbToCss(rgb) };
  }
  if (kind === 'ramp') {
    // Ramp colour is evaluated PER VERTEX from (position, state)
    // (`ColorGetRamped`, layer1/Color.cpp:189-218), so there is no single RGB
    // and the client must not invent one. Naming it is all we can honestly do.
    const slot = rampSlot(index);
    const ramp = state.ramps.find((r) => r.index === index);
    return { kind, rgb: null, label: ramp ? ramp.name : `ramp#${slot}`, css: null };
  }
  if (kind === 'special') {
    const special = state.specials.find((s) => s.index === index);
    const keyword = SPECIAL_COLORS.find((s) => s.index === index)?.keyword ?? String(index);
    const rgb = special?.rgb ?? null;
    return { kind, rgb, label: keyword, css: rgb ? rgbToCss(rgb) : null };
  }
  if (kind === 'slot') {
    const entry = state.entries[index];
    // entries[] is dense and index-ordered, but only once loaded; fall back to
    // a search rather than showing black for a colour we simply have not
    // fetched yet.
    const found =
      entry && entry.index === index ? entry : state.entries.find((e) => e.index === index);
    if (found) return { kind, rgb: found.rgb, label: found.name, css: rgbToCss(found.rgb) };
    return { kind, rgb: null, label: String(index), css: null };
  }
  return { kind: 'invalid', rgb: null, label: String(index), css: null };
}

/** Name -> entry, exact then case-insensitive, like `ColorGetIndex`'s order. */
export function findByName(state: PaletteState, name: string): ColorEntry | null {
  const exact = state.entries.find((e) => e.name === name);
  if (exact) return exact;
  const lower = name.toLowerCase();
  return state.entries.find((e) => e.name.toLowerCase() === lower) ?? null;
}

/**
 * The generated bands. `ColorReset` lays them out contiguously
 * (`layer1/Color.cpp:1089-1185`); the picker shows them behind an "advanced"
 * toggle because 5000 swatches is not a palette, it is a wall.
 */
export const GENERATED_BANDS: readonly { prefix: string; first: number; count: number }[] = [
  { prefix: 's', first: 155, count: 1000 },
  { prefix: 'r', first: 1155, count: 1000 },
  { prefix: 'c', first: 2155, count: 1000 },
  { prefix: 'w', first: 3155, count: 1000 },
  { prefix: 'o', first: 4256, count: 1000 },
];

/** Sample `n` evenly spaced colours out of a band, for a palette preview. */
export function sampleBand(
  state: PaletteState,
  prefix: string,
  first: number,
  last: number,
  n: number,
): (ColorEntry | null)[] {
  const band = GENERATED_BANDS.find((b) => b.prefix === prefix);
  if (!band || n < 1) return [];
  const out: (ColorEntry | null)[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const offset = Math.round(first + (last - first) * t);
    const index = band.first + Math.max(0, Math.min(band.count - 1, offset));
    out.push(state.entries[index] ?? null);
  }
  return out;
}

/**
 * Cheap proof that the table we fetched is the table PyMOL built. A shifted or
 * truncated table would silently mis-colour every object row, so the panel
 * shows this rather than assuming.
 *
 * The check is about the BUILT-IN region 0..5387 only. `set_color` with a name
 * PyMOL has never seen APPENDS a slot — measured: the first `set_color` in a
 * session lands at index 5388 and the table is 5389 long from then on — so an
 * equality test here would light a false alarm the moment the user defines
 * their first colour. It fired exactly that way in the browser before this
 * was fixed. `custom` is reported instead, because "5389 slots" with no
 * explanation looks like corruption.
 */
export function paletteIntegrity(state: PaletteState): {
  ok: boolean;
  problems: string[];
  /** Slots beyond the built-in table, i.e. user `set_color` definitions. */
  custom: number;
} {
  const problems: string[] = [];
  const custom = Math.max(0, state.entries.length - COLOR_TABLE_SIZE);
  if (state.entries.length < COLOR_TABLE_SIZE) {
    problems.push(`${state.entries.length} slots, expected at least ${COLOR_TABLE_SIZE}`);
  }
  if (state.named.length < NAMED_COLOR_COUNT) {
    problems.push(`${state.named.length} named colours, expected at least ${NAMED_COLOR_COUNT}`);
  }
  for (const [name, index] of Object.entries(LANDMARKS)) {
    const entry = state.entries[index];
    if (!entry || entry.name !== name) {
      problems.push(`slot ${index} is ${entry ? entry.name : 'missing'}, expected ${name}`);
    }
  }
  return { ok: problems.length === 0, problems, custom };
}

const LANDMARKS: Record<string, number> = {
  white: 0,
  black: 1,
  grey50: 104,
  grey80: 134,
  lightmagenta: 154,
  gray80: 4236,
  deepteal: 5262,
  darksalmon: 5280,
};
