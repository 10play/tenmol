/**
 * Colour-table unit tests.
 *
 * The values asserted here are not invented: every expectation was read off a
 * live PyMOL 3.2.0a built from this tree (see `packages/bridge/tests/test_colors.py`,
 * which asserts the same facts against the engine instead of against a fake).
 * Duplication is deliberate — this file proves the CLIENT logic, that one
 * proves the FACTS.
 */

import { describe, expect, it } from 'vitest';
import {
  COLOR_TABLE_SIZE,
  NAMED_COLOR_COUNT,
  colorKind,
  cssToRgb,
  decodeInlineColor,
  encodeInlineColor,
  inlineColorName,
  isInlineColor,
  menuSwatchToRgb,
  rampSlot,
  rgbToCss,
} from '@tenmol/protocol';
import {
  EMPTY_PALETTE,
  findByName,
  loadPalette,
  paletteIntegrity,
  parseColorIndices,
  resolveColor,
  sampleBand,
  type PaletteState,
} from './palette';
import {
  ALL_COLORS_LIST,
  BY_ELEM_PAGES,
  COLOR_CYCLE,
  PALETTES,
  REP_SETTING_LISTS,
} from './menuData';

/* ------------------------------------------------------------------ *
 * A fake PyMOL, faithful to the four modes of CmdGetColor.
 * ------------------------------------------------------------------ */

function fakeTable(size: number): { name: string; rgb: [number, number, number] }[] {
  // The landmark indices PyMOL's menus hardcode, then exactly enough further
  // digit-free names to reach the real count of 178, then filler whose names
  // contain digits — which is precisely what `ColorGetStatus` uses to decide
  // whether a slot appears in `get_color_indices()` (packages/engine/layer1/Color.cpp:784-807).
  const named: Record<number, string> = {
    0: 'white',
    1: 'black',
    2: 'blue',
    4: 'red',
    104: 'grey50',
    134: 'grey80',
    154: 'lightmagenta',
    4236: 'gray80',
    5262: 'deepteal',
    5280: 'darksalmon',
  };
  // NOTE `grey50`, `grey80` and `gray80` contain digits, so PyMOL itself leaves
  // them out of `get_color_indices()` even though they are named slots. The
  // count below is therefore of DIGIT-FREE names, not of entries in this map.
  const digitFree = () => Object.values(named).filter((n) => !/\d/.test(n)).length;
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  for (let i = 0, slot = 5; digitFree() < NAMED_COLOR_COUNT; i++, slot++) {
    if (slot in named) continue;
    named[slot] = `n${letters[i % 26] ?? 'z'}${letters[(i / 26) | 0] ?? 'z'}`;
  }
  const table: { name: string; rgb: [number, number, number] }[] = [];
  for (let i = 0; i < size; i++) {
    const name = named[i] ?? `s${String(i).padStart(3, '0')}`;
    table.push({ name, rgb: [i / size, 0.5, 1 - i / size] });
  }
  return table;
}

function fakeCall(size = COLOR_TABLE_SIZE) {
  const table = fakeTable(size);
  const calls: string[] = [];
  const call = async <T>(
    fn: string,
    args: readonly unknown[] = [],
    kwargs: Readonly<Record<string, unknown>> = {},
  ): Promise<T> => {
    calls.push(fn);
    if (fn === 'get_color_indices') {
      const all = kwargs['all'] === 1;
      const pairs = table
        .map((entry, index) => [entry.name, index] as [string, number])
        .filter(([name]) => all || !/\d/.test(name));
      return pairs as unknown as T;
    }
    if (fn === 'get_color_tuple') {
      const index = Number(args[0]);
      const mode = Number(args[1] ?? 0);
      if (mode === 4 && index < 0) return [index, -1, -1] as unknown as T;
      return (table[index]?.rgb ?? null) as unknown as T;
    }
    if (fn === 'get_color_index') {
      const word = String(args[0]);
      const specials: Record<string, number> = {
        default: -1,
        auto: 26,
        current: 5,
        atomic: -4,
        object: -5,
        front: -6,
        back: -7,
      };
      if (word in specials) return specials[word] as unknown as T;
      return table.findIndex((e) => e.name === word) as unknown as T;
    }
    if (fn === 'get_names') return ['ala', 'r1'] as unknown as T;
    if (fn === 'get_type')
      return (args[0] === 'r1' ? 'object:ramp' : 'object:molecule') as unknown as T;
    throw new Error(`unexpected call ${fn}`);
  };
  return { call, calls, table };
}

/* ------------------------------------------------------------------ *
 * Encoding — packages/engine/layer1/Color.h:36-47
 * ------------------------------------------------------------------ */

describe('special and encoded colour indices', () => {
  it('recognises the 0x40RRGGBB inline encoding', () => {
    // Measured against PyMOL: cmd.get_color_index('0xff8800') == 0x40ff8800
    // and get_color_tuple of it == (1.0, 0.5333.., 0.0).
    const index = 0x40ff8800;
    expect(isInlineColor(index)).toBe(true);
    expect(colorKind(index)).toBe('inline');
    const [r, g, b] = decodeInlineColor(index);
    expect(r).toBeCloseTo(1, 6);
    expect(g).toBeCloseTo(0x88 / 255, 6);
    expect(b).toBeCloseTo(0, 6);
    expect(inlineColorName(index)).toBe('0xff8800');
  });

  it('round-trips through the packing spectrumany uses (viewing.py:2053)', () => {
    for (const rgb of [
      [0, 0, 0],
      [1, 1, 1],
      [0.2, 0.4, 0.6],
    ] as const) {
      const packed = encodeInlineColor(rgb);
      expect(isInlineColor(packed)).toBe(true);
      const back = decodeInlineColor(packed);
      expect(back[0]).toBeCloseTo(rgb[0], 2);
      expect(back[1]).toBeCloseTo(rgb[1], 2);
      expect(back[2]).toBeCloseTo(rgb[2], 2);
    }
    // The exact packed values PyMOL produced for a `spectrum b, blue white red`
    // run on this tree: 0x400000ff, 0x400071ff, 0x4000e2ff, 0x4000ff38.
    for (const observed of [0x400000ff, 0x400071ff, 0x4000e2ff, 0x4000ff38]) {
      expect(isInlineColor(observed)).toBe(true);
      expect(encodeInlineColor(decodeInlineColor(observed))).toBe(observed >>> 0);
    }
  });

  it('classifies table slots, ramps and the seven keywords apart', () => {
    expect(colorKind(0)).toBe('slot');
    expect(colorKind(COLOR_TABLE_SIZE - 1)).toBe('slot');
    expect(colorKind(COLOR_TABLE_SIZE)).toBe('invalid');
    expect(colorKind(-1)).toBe('special');
    expect(colorKind(-7)).toBe('special');
    // -8 and -9 are neither a keyword nor a ramp (Color.h:36-47).
    expect(colorKind(-8)).toBe('invalid');
    expect(colorKind(-10)).toBe('ramp');
    expect(colorKind(-11)).toBe('ramp');
    // ext = -10 - index; PyMOL gave the first ramp index -10 => slot 0.
    expect(rampSlot(-10)).toBe(0);
    expect(rampSlot(-13)).toBe(3);
  });

  it('formats and parses hex both ways', () => {
    expect(rgbToCss([1, 0, 0])).toBe('#ff0000');
    expect(cssToRgb('0xFF8800')?.[0]).toBeCloseTo(1, 6);
    expect(cssToRgb('#00ff00')?.[1]).toBeCloseTo(1, 6);
    expect(cssToRgb('nonsense')).toBeNull();
  });

  it('decodes the menu swatch digits PyMOL draws', () => {
    // \900 is red, \999 white, \000 black (menu.py:519-618).
    expect(menuSwatchToRgb('900')).toEqual([1, 0, 0]);
    expect(menuSwatchToRgb('999')).toEqual([1, 1, 1]);
    expect(menuSwatchToRgb('000')).toEqual([0, 0, 0]);
  });
});

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

describe('loadPalette', () => {
  it('fetches every slot and separates the digit-free names', async () => {
    const { call, calls } = fakeCall();
    const loaded = await loadPalette(call, () => 0);
    expect(loaded.entries).toHaveLength(COLOR_TABLE_SIZE);
    expect(loaded.entries[0]).toMatchObject({ index: 0, name: 'white' });
    expect(loaded.entries[4236]).toMatchObject({ index: 4236, name: 'gray80' });
    // one get_color_tuple per slot, plus the 7 specials
    expect(calls.filter((c) => c === 'get_color_tuple')).toHaveLength(COLOR_TABLE_SIZE + 7);
    expect(loaded.named.every((entry) => !/\d/.test(entry.name))).toBe(true);
  });

  it('resolves auto/current live instead of trusting -2/-3', async () => {
    const { call } = fakeCall();
    const loaded = await loadPalette(call, () => 0);
    const auto = loaded.specials.find((s) => s.keyword === 'auto');
    const front = loaded.specials.find((s) => s.keyword === 'front');
    // PyMOL answered 26 for `auto` on a fresh session, not -2.
    expect(auto?.index).toBe(26);
    expect(auto?.rgb).not.toBeNull();
    // front is a genuine special: mode 4 flags it with a negative red, so it
    // must NOT become a drawable colour.
    expect(front?.index).toBe(-6);
    expect(front?.raw?.[0]).toBe(-6);
    expect(front?.rgb).toBeNull();
  });

  it('finds object:ramp objects and their negative index', async () => {
    const { call } = fakeCall();
    const loaded = await loadPalette(call, () => 0);
    expect(loaded.ramps.map((r) => r.name)).toEqual(['r1']);
  });

  it('parses the (name, index) pair list defensively', () => {
    expect(
      parseColorIndices([
        ['white', 0],
        ['black', 1],
      ]),
    ).toEqual([
      { name: 'white', index: 0 },
      { name: 'black', index: 1 },
    ]);
    expect(parseColorIndices(null)).toEqual([]);
    expect(parseColorIndices([['bad'], [1, 'x'], 'nope'])).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Lookup
 * ------------------------------------------------------------------ */

describe('resolveColor', () => {
  const state: PaletteState = {
    ...EMPTY_PALETTE,
    status: 'ready',
    entries: [
      { index: 0, name: 'white', rgb: [1, 1, 1] },
      { index: 1, name: 'black', rgb: [0, 0, 0] },
    ],
    specials: [{ keyword: 'front', index: -6, raw: [-6, -1, -1], rgb: null }],
    ramps: [{ name: 'r1', index: -10 }],
  };

  it('handles all four kinds of index', () => {
    expect(resolveColor(state, 0)).toMatchObject({ kind: 'slot', label: 'white', css: '#ffffff' });
    expect(resolveColor(state, 0x40ff0000)).toMatchObject({ kind: 'inline', css: '#ff0000' });
    expect(resolveColor(state, -10)).toMatchObject({ kind: 'ramp', label: 'r1', rgb: null });
    expect(resolveColor(state, -6)).toMatchObject({ kind: 'special', label: 'front', rgb: null });
  });

  it('never invents an RGB for a ramp', () => {
    // ColorGetRamped evaluates per vertex from (position, state) — there is no
    // single colour, and pretending otherwise is how Mode G would draw a lie.
    expect(resolveColor(state, -10).rgb).toBeNull();
    expect(resolveColor(state, -10).css).toBeNull();
  });

  it('falls back to a name search when the array is not dense', () => {
    const sparse: PaletteState = {
      ...EMPTY_PALETTE,
      entries: [{ index: 4236, name: 'gray80', rgb: [0.8, 0.8, 0.8] }],
    };
    expect(resolveColor(sparse, 4236).label).toBe('gray80');
  });

  it('looks up by name, case-insensitively as a fallback', () => {
    expect(findByName(state, 'white')?.index).toBe(0);
    expect(findByName(state, 'WHITE')?.index).toBe(0);
    expect(findByName(state, 'nope')).toBeNull();
  });
});

describe('paletteIntegrity', () => {
  it('accepts a table with the right size and landmarks', async () => {
    const { call } = fakeCall();
    const loaded = await loadPalette(call, () => 0);
    const state: PaletteState = { ...EMPTY_PALETTE, ...loaded, status: 'ready' };
    const result = paletteIntegrity(state);
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.custom).toBe(0);
    expect(state.named).toHaveLength(NAMED_COLOR_COUNT);
  });

  it('reports a shifted table instead of silently mis-colouring', () => {
    const state: PaletteState = {
      ...EMPTY_PALETTE,
      entries: [{ index: 0, name: 'notwhite', rgb: [0, 0, 0] }],
    };
    const result = paletteIntegrity(state);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('expected white');
    expect(result.problems.join(' ')).toContain(`expected at least ${COLOR_TABLE_SIZE}`);
  });

  it('does not cry corruption when the user has defined a colour', async () => {
    // `set_color` APPENDS: measured in the browser, one user colour made the
    // table 5389 long and the panel showed a red "does not match this PyMOL
    // build" banner. It must report the extra slot, not a fault.
    const { call } = fakeCall();
    const loaded = await loadPalette(call, () => 0);
    const withCustom: PaletteState = {
      ...EMPTY_PALETTE,
      ...loaded,
      entries: [
        ...loaded.entries,
        { index: COLOR_TABLE_SIZE, name: 'mycolour', rgb: [0.1, 0.2, 0.3] },
      ],
      named: [...loaded.named, { index: COLOR_TABLE_SIZE, name: 'mycolour', rgb: [0.1, 0.2, 0.3] }],
    };
    const result = paletteIntegrity(withCustom);
    expect(result.ok).toBe(true);
    expect(result.custom).toBe(1);
  });
});

describe('sampleBand', () => {
  it('samples inside the generated band a palette names', async () => {
    const { call } = fakeCall();
    const loaded = await loadPalette(call, () => 0);
    const state: PaletteState = { ...EMPTY_PALETTE, ...loaded };
    // rainbow = ('o', 3, 107, 893); the o band starts at index 4256.
    const stops = sampleBand(state, 'o', 107, 893, 8);
    expect(stops).toHaveLength(8);
    expect(stops[0]?.index).toBe(4256 + 107);
    expect(stops[7]?.index).toBe(4256 + 893);
    expect(stops.every((s) => s !== null)).toBe(true);
  });

  it('handles a reversed palette (first > last)', () => {
    const state: PaletteState = {
      ...EMPTY_PALETTE,
      entries: Array.from({ length: COLOR_TABLE_SIZE }, (_v, i) => ({
        index: i,
        name: `c${i}`,
        rgb: [0, 0, 0] as const,
      })),
    };
    const stops = sampleBand(state, 'o', 893, 107, 4);
    expect(stops[0]?.index).toBe(4256 + 893);
    expect(stops[3]?.index).toBe(4256 + 107);
  });

  it('returns nothing for a band prefix that does not exist', () => {
    expect(sampleBand(EMPTY_PALETTE, 'z', 0, 999, 4)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * The ported menu tables — shape only; the VALUES are diffed against the
 * running PyMOL in packages/bridge/tests/test_colors.py.
 * ------------------------------------------------------------------ */

describe('ported menu tables', () => {
  it('has PyMOL’s nine swatch groups with the right sizes', () => {
    expect(ALL_COLORS_LIST.map(([name]) => name)).toEqual([
      'reds',
      'greens',
      'blues',
      'yellows',
      'magentas',
      'cyans',
      'oranges',
      'tints',
      'grays',
    ]);
    expect(ALL_COLORS_LIST.map(([, list]) => list.length)).toEqual([11, 10, 9, 7, 10, 7, 7, 8, 11]);
  });

  it('carries all 60 palettes of constants_palette.py', () => {
    expect(PALETTES).toHaveLength(60);
    expect(PALETTES.find((p) => p.name === 'rainbow')).toEqual({
      name: 'rainbow',
      prefix: 'o',
      digits: 3,
      first: 107,
      last: 893,
    });
    expect(new Set(PALETTES.map((p) => p.prefix))).toEqual(new Set(['o', 's', 'r', 'c', 'w']));
  });

  it('carries the 40-entry auto-colour cycle', () => {
    expect(COLOR_CYCLE).toHaveLength(40);
    expect(COLOR_CYCLE[0]).toBe(26); // carbon
    expect(COLOR_CYCLE[9]).toBe(5262); // deepteal
    expect(COLOR_CYCLE[34]).toBe(5280); // darksalmon
  });

  it('carries the three rep-setting lists, ending with an unsettable name', () => {
    expect(REP_SETTING_LISTS).toHaveLength(3);
    expect(REP_SETTING_LISTS[0]?.filter(([, s]) => s)).toHaveLength(9);
    expect(REP_SETTING_LISTS[1]).toHaveLength(4);
    expect(REP_SETTING_LISTS[2]).toHaveLength(9);
    expect(REP_SETTING_LISTS[2]?.every(([, s]) => s.endsWith('_color'))).toBe(true);
  });

  it('has six by-element pages, the last of which colours hydrogens', () => {
    expect(BY_ELEM_PAGES).toHaveLength(6);
    expect(BY_ELEM_PAGES.every((p) => p.choices.length === 8)).toBe(true);
    expect(BY_ELEM_PAGES[5]?.kind).toBe('cbh');
    expect(BY_ELEM_PAGES.slice(0, 5).every((p) => p.kind === 'cba')).toBe(true);
    // cba takes an index, cbh takes a name — mixing them up is a silent no-op.
    expect(BY_ELEM_PAGES[0]?.choices.every((c) => typeof c.index === 'number')).toBe(true);
    expect(BY_ELEM_PAGES[5]?.choices.every((c) => typeof c.name === 'string')).toBe(true);
  });
});
