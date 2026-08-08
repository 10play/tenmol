/**
 * The colour menu's DATA, ported one-for-one from PyMOL.
 *
 * WHY A PORT AND NOT AN RPC. `pymol.menu.mol_color(self_cmd, sele)`
 * (`packages/engine/modules/pymol/menu.py:672-686`) builds this whole tree already, and
 * `packages/bridge/tenmol_bridge/panels/colors.py:menu_tree` wraps it — but every
 * `pymol.menu` provider takes the cmd INSTANCE as its first positional
 * argument, and a WebSocket client has no way to pass one.
 * `Dispatcher.resolve` would bind `self_cmd='(all)'` and the call would
 * `TypeError`. Until a `_bridge.colors.menu` route exists (see
 * `needsFromOthers`), the tree is reconstructed here.
 *
 * EVERY TABLE BELOW IS CHECKED AGAINST ITS PYTHON ORIGINAL by
 * `packages/bridge/tests/test_colors.py::test_ts_port_matches_pymol_source`, which
 * parses this file and diffs it against `pymol.menu.all_colors_list`,
 * `pymol.menu.rep_setting_lists`, `pymol.util._color_cycle` and
 * `pymol.constants_palette.palette_dict` inside a live PyMOL. A drift here is
 * a red test, not a silently wrong menu.
 *
 * The shapes are deliberately tuple-like, mirroring the Python tuples, so that
 * parser stays trivial. Prettier is free to re-wrap them; do not restructure
 * them into object literals.
 */

/* ------------------------------------------------------------------ *
 * The swatch grid — menu.py:519-618, `all_colors_list`
 *
 * 9 groups. Each entry is PyMOL's own `(\RGB swatch, colour name)` pair; the
 * swatch is one digit per channel and is what the in-viewport menu draws, so
 * the grid looks like PyMOL's grid rather than like the true RGB of each
 * colour (they differ: `gray90` is drawn `999`, same as `white`).
 * ------------------------------------------------------------------ */

/** `[swatchDigits, colorName]`, exactly as PyMOL stores it. */
export type Swatch = readonly [string, string];
/** `[groupName, swatches]`. */
export type SwatchGroup = readonly [string, readonly Swatch[]];

/** The swatch grid: nine named colour groups, each an ordered list of PyMOL's `(swatchDigits, colorName)` pairs. */
export const ALL_COLORS_LIST: readonly SwatchGroup[] = [
  [
    'reds',
    [
      ['900', 'red'],
      ['922', 'tv_red'],
      ['634', 'raspberry'],
      ['755', 'darksalmon'],
      ['955', 'salmon'],
      ['944', 'deepsalmon'],
      ['824', 'warmpink'],
      ['611', 'firebrick'],
      ['522', 'ruby'],
      ['521', 'chocolate'],
      ['632', 'brown'],
    ],
  ],
  [
    'greens',
    [
      ['090', 'green'],
      ['292', 'tv_green'],
      ['490', 'chartreuse'],
      ['570', 'splitpea'],
      ['564', 'smudge'],
      ['686', 'palegreen'],
      ['094', 'limegreen'],
      ['494', 'lime'],
      ['792', 'limon'],
      ['252', 'forest'],
    ],
  ],
  [
    'blues',
    [
      ['009', 'blue'],
      ['339', 'tv_blue'],
      ['049', 'marine'],
      ['449', 'slate'],
      ['779', 'lightblue'],
      ['247', 'skyblue'],
      ['409', 'purpleblue'],
      ['226', 'deepblue'],
      ['115', 'density'],
    ],
  ],
  [
    'yellows',
    [
      ['990', 'yellow'],
      ['992', 'tv_yellow'],
      ['994', 'paleyellow'],
      ['983', 'yelloworange'],
      ['792', 'limon'],
      ['976', 'wheat'],
      ['653', 'sand'],
    ],
  ],
  [
    'magentas',
    [
      ['909', 'magenta'],
      ['927', 'lightmagenta'],
      ['904', 'hotpink'],
      ['968', 'pink'],
      ['978', 'lightpink'],
      ['644', 'dirtyviolet'],
      ['949', 'violet'],
      ['525', 'violetpurple'],
      ['707', 'purple'],
      ['515', 'deeppurple'],
    ],
  ],
  [
    'cyans',
    [
      ['099', 'cyan'],
      ['799', 'palecyan'],
      ['499', 'aquamarine'],
      ['297', 'greencyan'],
      ['077', 'teal'],
      ['155', 'deepteal'],
      ['466', 'lightteal'],
    ],
  ],
  [
    'oranges',
    [
      ['950', 'orange'],
      ['951', 'tv_orange'],
      ['962', 'brightorange'],
      ['985', 'lightorange'],
      ['983', 'yelloworange'],
      ['760', 'olive'],
      ['551', 'deepolive'],
    ],
  ],
  [
    'tints',
    [
      ['976', 'wheat'],
      ['686', 'palegreen'],
      ['779', 'lightblue'],
      ['994', 'paleyellow'],
      ['978', 'lightpink'],
      ['799', 'palecyan'],
      ['985', 'lightorange'],
      ['889', 'bluewhite'],
    ],
  ],
  [
    'grays',
    [
      ['999', 'white'],
      ['999', 'gray90'],
      ['888', 'gray80'],
      ['777', 'gray70'],
      ['666', 'gray60'],
      ['555', 'gray50'],
      ['444', 'gray40'],
      ['333', 'gray30'],
      ['222', 'gray20'],
      ['222', 'gray10'],
      ['222', 'black'],
    ],
  ],
];

/* ------------------------------------------------------------------ *
 * By representation — menu.py:482-517, `rep_setting_lists`
 *
 * These are SETTINGS WRITES, not atom colours. `by_rep_sub` (menu.py:436-444)
 * emits `cmd.set("<setting>", "<colour>", <sele>, quiet=0)` and closes every
 * submenu with `cmd.unset("<setting>", <sele>, quiet=0)`. `('', '')` is a
 * separator; `('', 'x_color')` in list 2 is a setting with no rep label.
 * ------------------------------------------------------------------ */

/** `[repLabel, settingName]`; both empty means a separator. */
export type RepSetting = readonly [string, string];

/** The three "by rep" sublists, each a run of `(repLabel, settingName)` colour-setting writes. */
export const REP_SETTING_LISTS: readonly (readonly RepSetting[])[] = [
  [
    ['lines', 'line_color'],
    ['sticks', 'stick_color'],
    ['ribbon', 'ribbon_color'],
    ['cartoon', 'cartoon_color'],
    ['', ''],
    ['labels', 'label_color'],
    ['', ''],
    ['dots', 'dot_color'],
    ['spheres', 'sphere_color'],
    ['', ''],
    ['mesh', 'mesh_color'],
    ['surface', 'surface_color'],
  ],
  [
    ['dashes', 'dash_color'],
    ['angles', 'angle_color'],
    ['dihedrals', 'dihedral_color'],
    ['labels', 'label_color'],
  ],
  [
    ['', 'cartoon_highlight_color'],
    ['', 'cartoon_ladder_color'],
    ['', 'cartoon_nucleic_acid_color'],
    ['', 'cartoon_ring_color'],
    ['', 'ellipsoid_color'],
    ['', 'label_outline_color'],
    ['', 'ray_interior_color'],
    ['', 'ray_trace_color'],
    ['', 'stick_ball_color'],
  ],
];

/** Display names for the three `REP_SETTING_LISTS` sublists. */
export const REP_SETTING_MODE_NAMES = ['molecule', 'measurement', 'extra'] as const;

/* ------------------------------------------------------------------ *
 * By element — menu.py:335-418
 *
 * Six pages. Pages 1-5 are `util.cba(<colorIndex>, sele)`: colour every
 * non-carbon atom `atomic`, every carbon with the chosen colour, and the
 * OBJECT with the same colour (`flags=1`, `util.py:518-524`). Page 6 is
 * `util.cbh(<colorName>, sele)`, the same trick on hydrogens
 * (`util.py:526-532`). The first entry of page 1 is `util.cnc` — non-carbon
 * only (`util.py:512-516`).
 * ------------------------------------------------------------------ */

/** One carbon-colour choice. `index` for cba pages, `name` for the cbh page. */
export interface ElemChoice {
  /** The `\RGB` swatch PyMOL draws for the C in `C H N O S...`. */
  swatch: string;
  label: string;
  index?: number;
  name?: string;
}

/** One "by element" page: a titled set of carbon-colour choices, applied by `cba` (index) or `cbh` (name). */
export interface ElemPage {
  title: string;
  /** 'cba' colours carbons by index, 'cbh' colours hydrogens by name. */
  kind: 'cba' | 'cbh';
  choices: readonly ElemChoice[];
}

/** The six "by element" pages — five `cba` index pages plus the `cbh` hydrogen page. */
export const BY_ELEM_PAGES: readonly ElemPage[] = [
  {
    title: 'set 1',
    kind: 'cba',
    choices: [
      { swatch: '292', label: 'tv_green', index: 33 },
      { swatch: '099', label: 'cyan', index: 5 },
      { swatch: '927', label: 'lightmagenta', index: 154 },
      { swatch: '990', label: 'yellow', index: 6 },
      { swatch: '955', label: 'salmon', index: 9 },
      { swatch: '888', label: 'grey90', index: 144 },
      { swatch: '449', label: 'slate', index: 11 },
      { swatch: '962', label: 'orange', index: 13 },
    ],
  },
  {
    title: 'set 2',
    kind: 'cba',
    choices: [
      { swatch: '494', label: 'lime', index: 10 },
      { swatch: '155', label: 'deepteal', index: 5262 },
      { swatch: '904', label: 'hotpink', index: 12 },
      { swatch: '983', label: 'yelloworange', index: 36 },
      { swatch: '525', label: 'violetpurple', index: 5271 },
      { swatch: '666', label: 'grey70', index: 124 },
      { swatch: '049', label: 'marine', index: 17 },
      { swatch: '760', label: 'olive', index: 18 },
    ],
  },
  {
    title: 'set 3',
    kind: 'cba',
    choices: [
      { swatch: '564', label: 'smudge', index: 5270 },
      { swatch: '077', label: 'teal', index: 20 },
      { swatch: '644', label: 'dirtyviolet', index: 5272 },
      { swatch: '976', label: 'wheat', index: 52 },
      { swatch: '944', label: 'deepsalmon', index: 5258 },
      { swatch: '978', label: 'lightpink', index: 5274 },
      { swatch: '499', label: 'aquamarine', index: 5257 },
      { swatch: '994', label: 'paleyellow', index: 5256 },
    ],
  },
  {
    title: 'set 4',
    kind: 'cba',
    choices: [
      { swatch: '094', label: 'limegreen', index: 15 },
      { swatch: '247', label: 'skyblue', index: 5277 },
      { swatch: '824', label: 'warmpink', index: 5279 },
      { swatch: '792', label: 'limon', index: 5276 },
      { swatch: '949', label: 'violet', index: 53 },
      { swatch: '889', label: 'bluewhite', index: 5278 },
      { swatch: '297', label: 'greencyan', index: 5275 },
      { swatch: '653', label: 'sand', index: 5269 },
    ],
  },
  {
    title: 'set 5',
    kind: 'cba',
    choices: [
      { swatch: '252', label: 'forest', index: 22 },
      { swatch: '466', label: 'lightteal', index: 5266 },
      { swatch: '755', label: 'darksalmon', index: 5280 },
      { swatch: '570', label: 'splitpea', index: 5267 },
      { swatch: '634', label: 'raspberry', index: 5268 },
      { swatch: '555', label: 'grey50', index: 104 },
      { swatch: '226', label: 'deepblue', index: 23 },
      { swatch: '632', label: 'brown', index: 51 },
    ],
  },
  {
    title: 'set 6/H',
    kind: 'cbh',
    choices: [
      { swatch: '911', label: 'tv_red', name: 'tv_red' },
      { swatch: '917', label: 'lightmagenta', name: 'lightmagenta' },
      { swatch: '119', label: 'tv_blue', name: 'tv_blue' },
      { swatch: '940', label: 'orange', name: 'orange' },
      { swatch: '870', label: 'olive', name: 'olive' },
      { swatch: '088', label: 'teal', name: 'teal' },
      { swatch: '521', label: 'chocolate', name: 'chocolate' },
      { swatch: '000', label: 'black', name: 'black' },
    ],
  },
];

/* ------------------------------------------------------------------ *
 * The ten fixed-carbon shortcuts — util.py:442-510
 *
 * `cbag`/`cbac`/`cbam`/`cbay`/`cbas`/`cbaw`/`cbab`/`cbao`/`cbap`/`cbak` are
 * NOT `pymol.menu` entries — no PyMOL GUI surface exposes them, they are
 * command-line verbs. They are here because they are the only carbon-colour
 * verbs a user can type, and because they are NOT `util.cba` in disguise:
 *
 *     cba(color, sel)   color atomic, not-C     color <color>, C
 *                       color <color>, sel, flags=1   <- ALSO the OBJECT colour
 *     cbaX(sel)         color atomic, not-C     color <fixed>, C
 *
 * `cba` has that third line (`util.py:518-524`) and the ten shortcuts do not
 * (`util.py:442-510`), so picking `cbag` and picking the `tv_green` tile on the
 * by-element page leave the object rec in different states. MEASURED on a `trp`
 * fragment coloured `grey50` first: after `util.cbag` the object colour was
 * still 104, after `util.cba(33, …)` it was 33 —
 * `packages/bridge/tests/test_p8_a5.py::test_the_ten_fixed_carbon_shortcuts_leave_the_object_colour_alone`.
 * ------------------------------------------------------------------ */

/** One fixed-carbon `util.cba*` verb and the colour it hard-codes for carbons. */
export interface CarbonShortcut {
  /** The `util.` function name, which is also what the user would type. */
  fn: string;
  /** The colour it hard-codes for carbons. */
  color: string;
}

/** The ten `cba<letter>` command-line carbon-colour shortcuts, in menu order. */
export const FIXED_CARBON_SHORTCUTS: readonly CarbonShortcut[] = [
  { fn: 'cbag', color: 'carbon' },
  { fn: 'cbac', color: 'cyan' },
  { fn: 'cbam', color: 'lightmagenta' },
  { fn: 'cbay', color: 'yellow' },
  { fn: 'cbas', color: 'salmon' },
  { fn: 'cbaw', color: 'hydrogen' },
  { fn: 'cbab', color: 'slate' },
  { fn: 'cbao', color: 'brightorange' },
  { fn: 'cbap', color: 'purple' },
  { fn: 'cbak', color: 'pink' },
];

/* ------------------------------------------------------------------ *
 * Negative colours — `pymol.menu.mesh_color`, menu.py:696-712
 *
 * The C menu of a mesh or surface object is NOT `mol_color`: `ExecutiveMenu`
 * routes `cObjectMesh` to `mesh_color(name)` and `cObjectSurface` to
 * `mesh_color(name, 'surface')` (`packages/engine/layer3/Executive.cpp:15249-15256`). The only
 * difference from the molecule menu is a `negative` submenu on top, whose
 * entries are two SETTINGS writes on the object, not atom colours:
 *
 *     off      cmd.set("<rep>_negative_visible", 0, name, quiet=0)
 *     <colour> cmd.set("<rep>_negative_visible", 1, name, quiet=0);
 *              cmd.set("<rep>_negative_color", "<colour>", name, quiet=0)
 *
 * so it goes through the settings store, exactly like "by rep".
 * ------------------------------------------------------------------ */

/** The reps (mesh, surface) whose colour menu carries a `negative` submenu. */
export const NEGATIVE_REPS = ['mesh', 'surface'] as const;
/** A single member of `NEGATIVE_REPS`. */
export type NegativeRep = (typeof NEGATIVE_REPS)[number];

/** The two setting names `mesh_color` writes, for a given rep. */
export function negativeSettings(rep: string): { visible: string; color: string } {
  return { visible: `${rep}_negative_visible`, color: `${rep}_negative_color` };
}

/* ------------------------------------------------------------------ *
 * By secondary structure — menu.py:420-426
 * ------------------------------------------------------------------ */

/** The three "by secondary structure" helix/sheet/loop colour presets. */
export const BY_SS_PRESETS: readonly {
  helix: string;
  sheet: string;
  loop: string;
}[] = [
  { helix: 'red', sheet: 'yellow', loop: 'green' },
  { helix: 'cyan', sheet: 'magenta', loop: 'salmon' },
  { helix: 'cyan', sheet: 'red', loop: 'magenta' },
];

/* ------------------------------------------------------------------ *
 * `util._color_cycle` — util.py:27-70, identical to C `AutoColor`
 * (`packages/engine/layer1/Color.cpp:35-76`). 40 indices. Used by `util.cbc` /
 * `util.color_objs` as `_color_cycle[c % 40]`, and shown here as the preview
 * strip next to "by chain" so the user can see what they are about to get.
 * ------------------------------------------------------------------ */

/** `util._color_cycle` — the 40 auto-colour indices, shown as the "by chain" preview strip. */
export const COLOR_CYCLE: readonly number[] = [
  26, 5, 154, 6, 9, 29, 11, 13, 10, 5262, 12, 36, 5271, 124, 17, 18, 5270, 20, 5272, 52, 5258, 5274,
  5257, 5256, 15, 5277, 5279, 5276, 53, 5278, 5275, 5269, 22, 5266, 5280, 5267, 5268, 104, 23, 51,
];

/* ------------------------------------------------------------------ *
 * Palettes — packages/engine/modules/pymol/constants_palette.py:1-89
 *
 * `(prefix, digits, first, last)`; prefix picks one of the generated
 * 1000-colour bands (o/s/r/c/w) and first..last are indices inside it, so a
 * palette preview is `get_color_tuple('<prefix><nnn>')` sampled between them.
 * The inventory says 57; the file in THIS tree has 60 — asserted in
 * `packages/bridge/tests/test_colors.py`.
 * ------------------------------------------------------------------ */

/** One spectrum palette: a colour-band prefix and the index range sampled from it. */
export interface Palette {
  name: string;
  prefix: string;
  digits: number;
  first: number;
  last: number;
}

/** Every spectrum palette, ported from `constants_palette.palette_dict`. */
export const PALETTES: readonly Palette[] = [
  { name: 'rainbow_cycle', prefix: 'o', digits: 3, first: 0, last: 999 },
  { name: 'rainbow_cycle_rev', prefix: 'o', digits: 3, first: 999, last: 0 },
  { name: 'rainbow', prefix: 'o', digits: 3, first: 107, last: 893 },
  { name: 'rainbow_rev', prefix: 'o', digits: 3, first: 893, last: 107 },
  { name: 'rainbow2', prefix: 's', digits: 3, first: 167, last: 833 },
  { name: 'rainbow2_rev', prefix: 's', digits: 3, first: 833, last: 167 },
  { name: 'gcbmry', prefix: 'r', digits: 3, first: 166, last: 999 },
  { name: 'yrmbcg', prefix: 'r', digits: 3, first: 999, last: 166 },
  { name: 'cbmr', prefix: 'r', digits: 3, first: 166, last: 833 },
  { name: 'rmbc', prefix: 'r', digits: 3, first: 833, last: 166 },
  { name: 'green_yellow_red', prefix: 's', digits: 3, first: 500, last: 833 },
  { name: 'red_yellow_green', prefix: 's', digits: 3, first: 833, last: 500 },
  { name: 'yellow_white_blue', prefix: 'w', digits: 3, first: 0, last: 83 },
  { name: 'blue_white_yellow', prefix: 'w', digits: 3, first: 83, last: 0 },
  { name: 'blue_white_red', prefix: 'w', digits: 3, first: 83, last: 167 },
  { name: 'red_white_blue', prefix: 'w', digits: 3, first: 167, last: 83 },
  { name: 'red_white_green', prefix: 'w', digits: 3, first: 167, last: 250 },
  { name: 'green_white_red', prefix: 'w', digits: 3, first: 250, last: 167 },
  { name: 'green_white_magenta', prefix: 'w', digits: 3, first: 250, last: 333 },
  { name: 'magenta_white_green', prefix: 'w', digits: 3, first: 333, last: 250 },
  { name: 'magenta_white_cyan', prefix: 'w', digits: 3, first: 333, last: 417 },
  { name: 'cyan_white_magenta', prefix: 'w', digits: 3, first: 417, last: 333 },
  { name: 'cyan_white_yellow', prefix: 'w', digits: 3, first: 417, last: 500 },
  { name: 'yellow_cyan_white', prefix: 'w', digits: 3, first: 500, last: 417 },
  { name: 'yellow_white_green', prefix: 'w', digits: 3, first: 500, last: 583 },
  { name: 'green_white_yellow', prefix: 'w', digits: 3, first: 583, last: 500 },
  { name: 'green_white_blue', prefix: 'w', digits: 3, first: 583, last: 667 },
  { name: 'blue_white_green', prefix: 'w', digits: 3, first: 667, last: 583 },
  { name: 'blue_white_magenta', prefix: 'w', digits: 3, first: 667, last: 750 },
  { name: 'magenta_white_blue', prefix: 'w', digits: 3, first: 750, last: 667 },
  { name: 'magenta_white_yellow', prefix: 'w', digits: 3, first: 750, last: 833 },
  { name: 'yellow_white_magenta', prefix: 'w', digits: 3, first: 833, last: 750 },
  { name: 'yellow_white_red', prefix: 'w', digits: 3, first: 833, last: 917 },
  { name: 'red_white_yellow', prefix: 'w', digits: 3, first: 817, last: 833 },
  { name: 'red_white_cyan', prefix: 'w', digits: 3, first: 916, last: 999 },
  { name: 'cyan_white_red', prefix: 'w', digits: 3, first: 999, last: 916 },
  { name: 'yellow_blue', prefix: 'c', digits: 3, first: 0, last: 83 },
  { name: 'blue_yellow', prefix: 'c', digits: 3, first: 83, last: 0 },
  { name: 'blue_red', prefix: 'c', digits: 3, first: 83, last: 167 },
  { name: 'red_blue', prefix: 'c', digits: 3, first: 167, last: 83 },
  { name: 'red_green', prefix: 'c', digits: 3, first: 167, last: 250 },
  { name: 'green_red', prefix: 'c', digits: 3, first: 250, last: 167 },
  { name: 'green_magenta', prefix: 'c', digits: 3, first: 250, last: 333 },
  { name: 'magenta_green', prefix: 'c', digits: 3, first: 333, last: 250 },
  { name: 'magenta_cyan', prefix: 'c', digits: 3, first: 333, last: 417 },
  { name: 'cyan_magenta', prefix: 'c', digits: 3, first: 417, last: 333 },
  { name: 'cyan_yellow', prefix: 'c', digits: 3, first: 417, last: 500 },
  { name: 'yellow_cyan', prefix: 'c', digits: 3, first: 500, last: 417 },
  { name: 'yellow_green', prefix: 'c', digits: 3, first: 500, last: 583 },
  { name: 'green_yellow', prefix: 'c', digits: 3, first: 583, last: 500 },
  { name: 'green_blue', prefix: 'c', digits: 3, first: 583, last: 667 },
  { name: 'blue_green', prefix: 'c', digits: 3, first: 667, last: 583 },
  { name: 'blue_magenta', prefix: 'c', digits: 3, first: 667, last: 750 },
  { name: 'magenta_blue', prefix: 'c', digits: 3, first: 750, last: 667 },
  { name: 'magenta_yellow', prefix: 'c', digits: 3, first: 750, last: 833 },
  { name: 'yellow_magenta', prefix: 'c', digits: 3, first: 833, last: 750 },
  { name: 'yellow_red', prefix: 'c', digits: 3, first: 833, last: 917 },
  { name: 'red_yellow', prefix: 'c', digits: 3, first: 817, last: 833 },
  { name: 'red_cyan', prefix: 'c', digits: 3, first: 916, last: 999 },
  { name: 'cyan_red', prefix: 'c', digits: 3, first: 999, last: 916 },
];

/**
 * `palette_colors_dict` — viewing.py:39-50. The 10 rainbow-family palettes
 * expressed as explicit colour-name lists, which is what the `spectrumany`
 * path uses when the C fast path cannot be taken.
 */
export const PALETTE_COLORS_DICT: Readonly<Record<string, string>> = {
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

/** `_spectrumany_interpolations` — viewing.py:1968-1973. */
export const SPECTRUM_INTERPOLATIONS = ['rgb', 'hls', 'hsv'] as const;
/** One of the `spectrumany` interpolation spaces. */
export type SpectrumInterpolation = (typeof SPECTRUM_INTERPOLATIONS)[number];

/* ------------------------------------------------------------------ *
 * Ramps
 * ------------------------------------------------------------------ */

/**
 * `ramp_spectrum_dict` — creating.py:47-57. A `ramp_new(color=...)` may be one
 * of these named spectra instead of a colour list.
 */
export const RAMP_SPECTRA: readonly { name: string; code: number | string }[] = [
  { name: 'traditional', code: 1 },
  { name: 'sludge', code: 2 },
  { name: 'ocean', code: 3 },
  { name: 'hot', code: 4 },
  { name: 'grayable', code: 5 },
  { name: 'rainbow', code: 6 },
  { name: 'afmhot', code: 7 },
  { name: 'grayscale', code: 8 },
  { name: 'object', code: 'object' },
];

/**
 * `pymol.colorramping.namedramps` — colorramping.py:17-54. Volume presets,
 * applied with `cmd.volume_color(volumeName, presetName)`.
 */
export const VOLUME_RAMPS: readonly string[] = ['2fofc', 'esp', 'fofc', 'rainbow', 'rainbow2'];

/* ------------------------------------------------------------------ *
 * Colour space — importing.py:227-288 + constants.py:141-148
 * ------------------------------------------------------------------ */

/** The `color_space` LUT choices, each with a one-line help string. */
export const COLOR_SPACES: readonly { name: string; help: string }[] = [
  { name: 'rgb', help: 'purge the LUT (default)' },
  { name: 'pymol', help: 'synthesised 512x512 LUT, pymol_space_* settings' },
  { name: 'cmyk', help: '$PYMOL_DATA/pymol/cmyk.png' },
  { name: 'greyscale', help: 'synthesised greyscale LUT' },
];

/** `util.colors(scheme)` — util.py:1029-1040. Only 'jmol' does anything. */
export const UTIL_COLOR_SCHEMES: readonly string[] = ['jmol'];
