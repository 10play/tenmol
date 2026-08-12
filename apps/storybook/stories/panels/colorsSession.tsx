/**
 * Seeds the process-wide colour store so the Colours overlay renders the way it
 * does against a live engine — a full 5388-slot table with 178+ digit-free
 * "named" colours, the seven reserved keywords resolved, and a couple of live
 * `object:ramp`s — instead of the empty, "not connected" shell it shows on the
 * bare stub session.
 *
 * WHY SEED THE STORE, NOT `session.call`: the table lives in a MODULE SINGLETON
 * (`features/colors/usePalette.ts#paletteStore`), like the real app's colour
 * store, and it is only refetched when the connection phase is `open`. The
 * Storybook stub never opens a socket (phase stays pre-open), so the panel's
 * mount effect never fires a fetch — which means a value written into that
 * singleton is stable and is exactly what `usePalette()` hands the panel.
 *
 * The numbers are the ones this repo documents as MEASURED against PyMOL 3.2.0a:
 * 5388 slots, 178 named, the full fetch costing ~184 ms — so the header reads
 * "5388 slots / 178 named in 184 ms" and `paletteIntegrity()` is satisfied (no
 * "table does not match this build" warning). The landmark slots the integrity
 * check pins (white@0, grey50@104, deepteal@5262, …) are placed at their real
 * indices; the rest of the table is a smooth filler gradient the panel never
 * labels, so nothing fake is ever shown to the eye.
 *
 * Not a `*.stories.tsx` file, so Storybook does not index it as a story.
 */

import type { Decorator } from '@storybook/react-vite';
import { paletteStore } from '@web/features/colors/usePalette';
import type { PaletteState } from '@web/features/colors/palette';
import { ALL_COLORS_LIST } from '@web/features/colors/menuData';

type Rgb = readonly [number, number, number];
type Entry = { index: number; name: string; rgb: Rgb };

const COLOR_TABLE_SIZE = 5388;

/** `#rrggbb` → three 0..1 floats. */
function hex(h: string): Rgb {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** PyMOL's `rgb` swatch digits ('900' = red) → three 0..1 floats. */
function digits(d: string): Rgb {
  return [Number(d[0]) / 9, Number(d[1]) / 9, Number(d[2]) / 9];
}

/**
 * The X11 / CSS names PyMOL registers alongside its own — enough of them, unioned
 * with the swatch grid's own names, to clear the 178 digit-free-name floor the
 * integrity check pins. Values are the standard CSS hex, so every editor dot is a
 * real colour.
 */
const CSS_NAMED: readonly (readonly [string, string])[] = [
  ['aliceblue', '#f0f8ff'], ['antiquewhite', '#faebd7'], ['aquamarine', '#7fffd4'],
  ['azure', '#f0ffff'], ['beige', '#f5f5dc'], ['bisque', '#ffe4c4'],
  ['blanchedalmond', '#ffebcd'], ['blueviolet', '#8a2be2'], ['burlywood', '#deb887'],
  ['cadetblue', '#5f9ea0'], ['coral', '#ff7f50'], ['cornflowerblue', '#6495ed'],
  ['cornsilk', '#fff8dc'], ['crimson', '#dc143c'], ['darkblue', '#00008b'],
  ['darkcyan', '#008b8b'], ['darkgoldenrod', '#b8860b'], ['darkgray', '#a9a9a9'],
  ['darkgreen', '#006400'], ['darkkhaki', '#bdb76b'], ['darkmagenta', '#8b008b'],
  ['darkolivegreen', '#556b2f'], ['darkorange', '#ff8c00'], ['darkorchid', '#9932cc'],
  ['darkred', '#8b0000'], ['darkseagreen', '#8fbc8f'], ['darkslateblue', '#483d8b'],
  ['darkslategray', '#2f4f4f'], ['darkturquoise', '#00ced1'], ['darkviolet', '#9400d3'],
  ['deeppink', '#ff1493'], ['deepskyblue', '#00bfff'], ['dimgray', '#696969'],
  ['dodgerblue', '#1e90ff'], ['floralwhite', '#fffaf0'], ['forestgreen', '#228b22'],
  ['gainsboro', '#dcdcdc'], ['ghostwhite', '#f8f8ff'], ['gold', '#ffd700'],
  ['goldenrod', '#daa520'], ['greenyellow', '#adff2f'], ['honeydew', '#f0fff0'],
  ['indianred', '#cd5c5c'], ['indigo', '#4b0082'], ['ivory', '#fffff0'],
  ['khaki', '#f0e68c'], ['lavender', '#e6e6fa'], ['lavenderblush', '#fff0f5'],
  ['lawngreen', '#7cfc00'], ['lemonchiffon', '#fffacd'], ['lightcoral', '#f08080'],
  ['lightcyan', '#e0ffff'], ['lightgoldenrod', '#fafad2'], ['lightgray', '#d3d3d3'],
  ['lightgreen', '#90ee90'], ['lightsalmon', '#ffa07a'], ['lightseagreen', '#20b2aa'],
  ['lightskyblue', '#87cefa'], ['lightslategray', '#778899'], ['lightsteelblue', '#b0c4de'],
  ['lightyellow', '#ffffe0'], ['maroon', '#800000'], ['mediumaquamarine', '#66cdaa'],
  ['mediumblue', '#0000cd'], ['mediumorchid', '#ba55d3'], ['mediumpurple', '#9370db'],
  ['mediumseagreen', '#3cb371'], ['mediumslateblue', '#7b68ee'], ['mediumspringgreen', '#00fa9a'],
  ['mediumturquoise', '#48d1cc'], ['mediumvioletred', '#c71585'], ['midnightblue', '#191970'],
  ['mintcream', '#f5fffa'], ['mistyrose', '#ffe4e1'], ['moccasin', '#ffe4b5'],
  ['navajowhite', '#ffdead'], ['navy', '#000080'], ['oldlace', '#fdf5e6'],
  ['olivedrab', '#6b8e23'], ['orangered', '#ff4500'], ['orchid', '#da70d6'],
  ['palegoldenrod', '#eee8aa'], ['paleturquoise', '#afeeee'], ['palevioletred', '#db7093'],
  ['papayawhip', '#ffefd5'], ['peachpuff', '#ffdab9'], ['peru', '#cd853f'],
  ['plum', '#dda0dd'], ['powderblue', '#b0e0e6'], ['rosybrown', '#bc8f8f'],
  ['royalblue', '#4169e1'], ['saddlebrown', '#8b4513'], ['sandybrown', '#f4a460'],
  ['seagreen', '#2e8b57'], ['seashell', '#fff5ee'], ['sienna', '#a0522d'],
  ['silver', '#c0c0c0'], ['slateblue', '#6a5acd'], ['slategray', '#708090'],
  ['snow', '#fffafa'], ['springgreen', '#00ff7f'], ['steelblue', '#4682b4'],
  ['tan', '#d2b48c'], ['thistle', '#d8bfd8'], ['tomato', '#ff6347'],
  ['turquoise', '#40e0d0'], ['whitesmoke', '#f5f5f5'], ['yellowgreen', '#9acd32'],
  ['gray', '#808080'], ['aqua', '#00ffff'], ['fuchsia', '#ff00ff'],
  ['rebeccapurple', '#663399'], ['lightgoldenrodyellow', '#fafad2'],
  ['grey', '#808080'], ['darkgrey', '#a9a9a9'], ['lightgrey', '#d3d3d3'],
  ['dimgrey', '#696969'], ['slategrey', '#708090'], ['darkslategrey', '#2f4f4f'],
  ['lightslategrey', '#778899'], ['mediumspringgreen', '#00fa9a'],
];

/** The seven reserved keywords, resolved the way a fresh live session resolves them. */
const SPECIALS: PaletteState['specials'] = [
  { keyword: 'default', index: -1, raw: null, rgb: null },
  { keyword: 'auto', index: 26, raw: null, rgb: [0.3, 0.9, 0.3] },
  { keyword: 'current', index: 5, raw: null, rgb: [0.85, 0.85, 0.35] },
  { keyword: 'atomic', index: -4, raw: null, rgb: [0.9, 0.9, 0.9] },
  { keyword: 'object', index: -5, raw: null, rgb: [0.35, 0.7, 0.95] },
  { keyword: 'front', index: -6, raw: null, rgb: null },
  { keyword: 'back', index: -7, raw: null, rgb: null },
];

/** Two live `object:ramp`s (`index = -10 - slot`). */
const RAMPS: PaletteState['ramps'] = [
  { name: 'e_pot_map', index: -10 },
  { name: '2fofc_map', index: -11 },
];

/** Build the full snapshot once — the table is stable for the session. */
function buildPalette(): PaletteState {
  // The swatch grid's own digit-free names (real PyMOL RGB), kept ordered so the
  // low "core names" slots of the band browser read as real, varied colours.
  const swatchNamed: [string, Rgb][] = [];
  const seen = new Set<string>();
  for (const [, swatches] of ALL_COLORS_LIST) {
    for (const [d, name] of swatches) {
      if (!/\d/.test(name) && name !== 'white' && name !== 'black' && !seen.has(name)) {
        seen.add(name);
        swatchNamed.push([name, digits(d)]);
      }
    }
  }
  // The X11 / CSS set on top, minus anything the swatch grid already named.
  const cssNamed: [string, Rgb][] = [];
  for (const [name, h] of CSS_NAMED) {
    if (name === 'white' || name === 'black' || seen.has(name)) continue;
    seen.add(name);
    cssNamed.push([name, hex(h)]);
  }

  // A high-frequency hue sweep for every slot the named colours and landmarks
  // don't claim — so the advanced band regions read as a live rainbow table
  // rather than a flat filler. The panel only ever labels these `g<i>`.
  const entries: Entry[] = new Array(COLOR_TABLE_SIZE);
  for (let i = 0; i < COLOR_TABLE_SIZE; i++) {
    entries[i] = {
      index: i,
      name: `g${i}`,
      rgb: [
        0.5 + 0.45 * Math.sin(i * 0.7),
        0.5 + 0.45 * Math.sin(i * 0.7 + 2.1),
        0.5 + 0.45 * Math.sin(i * 0.7 + 4.2),
      ],
    };
  }

  const white: Entry = { index: 0, name: 'white', rgb: [1, 1, 1] };
  const black: Entry = { index: 1, name: 'black', rgb: [0, 0, 0] };
  entries[0] = white;
  entries[1] = black;

  const named: Entry[] = [white, black];
  // The real swatch names fill the low "core names" band (slots 2…), clear of
  // the first landmark (grey50@104); the CSS names follow from slot 300.
  let lo = 2;
  for (const [name, rgb] of swatchNamed) {
    const e: Entry = { index: lo, name, rgb };
    entries[lo] = e;
    named.push(e);
    lo++;
  }
  let idx = 300;
  for (const [name, rgb] of cssNamed) {
    const e: Entry = { index: idx, name, rgb };
    entries[idx] = e;
    named.push(e);
    idx++;
  }

  // The exact slots `paletteIntegrity()` pins (`features/colors/palette.ts`).
  const landmarks: readonly [number, string, Rgb][] = [
    [104, 'grey50', [0.5, 0.5, 0.5]],
    [134, 'grey80', [0.8, 0.8, 0.8]],
    [154, 'lightmagenta', [1, 0.2, 0.8]],
    [4236, 'gray80', [0.8, 0.8, 0.8]],
    [5262, 'deepteal', [0.1, 0.6, 0.6]],
    [5280, 'darksalmon', [0.73, 0.55, 0.52]],
  ];
  for (const [i, name, rgb] of landmarks) entries[i] = { index: i, name, rgb };

  return {
    status: 'ready',
    error: null,
    entries,
    named,
    specials: SPECIALS,
    ramps: RAMPS,
    loadedMs: 184,
    revision: 1,
  };
}

const PALETTE = buildPalette();

// Seed at import time so the very first render of the panel already reads a full
// table (the store is the module singleton `usePalette()` subscribes to).
paletteStore().set(PALETTE);

/** Wrap a story in a session whose colour store holds a full, ready table. */
export const withColorsData: Decorator = (Story) => {
  paletteStore().set(PALETTE);
  return <Story />;
};
