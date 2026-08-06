/**
 * The Setting menu, transcribed from `PyMOLDesktopGUI.get_menudata`
 * (`packages/engine/modules/pymol/_gui.py:491-773`) — the toolkit-independent nested list both
 * the Qt and the Tk front ends consume (`pymol_qt_gui.py:353`,
 * `pmg_tk/skins/normal/__init__.py:1072`).
 *
 * The grammar is PyMOL's, unchanged:
 *
 *   ('separator',)
 *   ('menu',  label, [items])
 *   ('command', label, callable | command-string)
 *   ('check', label, setting [, trueValue, falseValue])
 *   ('radio', label, setting, value)
 *
 * with two deliberate representation choices:
 *
 *  * `check` keeps trueValue/falseValue explicitly, because they are not always
 *    1/0: `assembly` is a STRING setting used as a toggle ('1'/''),
 *    `connect_mode` toggles 4/0, `auto_show_classified` -1/0,
 *    `cartoon_highlight_color` 104/-1 and `ray_interior_color` 74/-1.
 *  * `command` becomes DATA (a list of calls) instead of a Python lambda, since
 *    a lambda cannot cross the wire. The four transparency presets are three
 *    `cmd.set`s each and the Modernize/Shadows entries are one `util.*` call —
 *    which is exactly what the Qt menu does, server-side, in one round trip.
 *
 * Every label, every setting name and every value below is copied verbatim from
 * `_gui.py`; where the Python built them in a loop the loop is unrolled here.
 */

import type { SettingValue } from '@tenmol/protocol';

/** One `{t:'call'}` a menu command issues — the wire form of a Python lambda. */
export interface MenuCall {
  /** Dotted symbol for `{t:'call'}`. */
  fn: string;
  args: readonly unknown[];
  kwargs?: Readonly<Record<string, unknown>>;
}

/** One node of the Setting menu tree: separator, submenu, command, check, or radio. */
export type MenuItem =
  | { kind: 'separator' }
  | { kind: 'menu'; label: string; items: readonly MenuItem[] }
  | { kind: 'command'; label: string; calls: readonly MenuCall[]; echo: string }
  | { kind: 'check'; label: string; setting: string; on: SettingValue; off: SettingValue }
  | { kind: 'radio'; label: string; setting: string; value: SettingValue };

const sep: MenuItem = { kind: 'separator' };

const check = (
  label: string,
  setting: string,
  on: SettingValue = 1,
  off: SettingValue = 0,
): MenuItem => ({ kind: 'check', label, setting, on, off });

const radio = (label: string, setting: string, value: SettingValue): MenuItem => ({
  kind: 'radio',
  label,
  setting,
  value,
});

const menu = (label: string, items: readonly MenuItem[]): MenuItem => ({
  kind: 'menu',
  label,
  items,
});

/** `transparency_menu(setting_name)` — `_gui.py:66-71`. */
function transparencyMenu(setting: string): readonly MenuItem[] {
  return (
    [
      ['Off', 0.0],
      ['20%', 0.2],
      ['40%', 0.4],
      ['50%', 0.5],
      ['60%', 0.6],
      ['80%', 0.8],
    ] as const
  ).map(([label, value]) => radio(label, setting, value));
}

/** The three `cmd.set`s each transparency preset issues (`_gui.py:679-689`). */
function transparencyPreset(
  label: string,
  mode: number,
  cull: number,
  twoSided: number,
): MenuItem {
  return {
    kind: 'command',
    label,
    calls: [
      { fn: 'cmd.set', args: ['transparency_mode', mode], kwargs: { quiet: 0 } },
      { fn: 'cmd.set', args: ['backface_cull', cull], kwargs: { quiet: 0 } },
      { fn: 'cmd.set', args: ['two_sided_lighting', twoSided], kwargs: { quiet: 0 } },
    ],
    echo: `set transparency_mode, ${mode}; set backface_cull, ${cull}; set two_sided_lighting, ${twoSided}`,
  };
}

const shadow = (mode: string): MenuItem => ({
  kind: 'command',
  label: mode.charAt(0).toUpperCase() + mode.slice(1),
  calls: [{ fn: 'util.ray_shadows', args: [mode] }],
  echo: `util.ray_shadows("${mode}")`,
});

const rayTexture = (setting: string): readonly MenuItem[] => [
  radio('None', setting, 0),
  radio('Matte 1', setting, 1),
  radio('Matte 2', setting, 4),
  radio('Swirl 1', setting, 2),
  radio('Swirl 2', setting, 3),
  radio('Fiber', setting, 5),
];

/** `('menu', 'Setting', [...])` — `_gui.py:491-773`, minus the three dialog
 *  entries at the top (Edit All / Keyboard Shortcuts / Colors), which are
 *  windows rather than settings and are launched from the panel header. */
export const SETTING_MENU: readonly MenuItem[] = [
  menu('Label', [
    menu('Size', [
      ...[10, 14, 18, 24, 36, 48, 72].map((v) => radio(`${v} Point`, 'label_size', v)),
      sep,
      ...[0.3, 0.5, 1, 2, 4].map((v) => radio(`${v} Angstrom`, 'label_size', -v)),
    ]),
    menu('Font', [
      ['Sans', 5],
      ['Sans Oblique', 6],
      ['Sans Bold', 7],
      ['Sans Bold Oblique', 8],
      ['Serif', 9],
      ['Serif Oblique', 17],
      ['Serif Bold', 10],
      ['Serif Bold Oblique', 18],
      ['Mono', 11],
      ['Mono Oblique', 12],
      ['Mono Bold', 13],
      ['Mono Bold Oblique', 14],
      ['Gentium Roman', 15],
      ['Gentium Italic', 16],
    ].map(([label, value]) => radio(label as string, 'label_font_id', value as number)),
    ),
    menu('Color', [radio('Front', 'label_color', -6), radio('Back', 'label_color', -7)]),
    check('Show Connectors', 'label_connector'),
    menu('Background Color', [
      radio('None', 'label_bg_color', -1),
      radio('Back', 'label_bg_color', -7),
      radio('Front', 'label_bg_color', -6),
    ]),
  ]),

  menu('Lines & Sticks', [
    check('Ball and Stick', 'stick_ball', 1),
    menu('Ball and Stick Ratio', [
      radio('1.0', 'stick_ball_ratio', 1),
      radio('1.5', 'stick_ball_ratio', 1.5),
      radio('VDW', 'stick_ball_ratio', -1),
    ]),
    sep,
    menu('Zero Order Bonds', [
      radio('Hide', 'valence_zero_mode', 0),
      radio('Dashed', 'valence_zero_mode', 1),
      radio('Solid', 'valence_zero_mode', 2),
    ]),
    menu(
      'Zero Order Stick Scale',
      [0.1, 0.2, 0.3, 1.0].map((v) => radio(String(v), 'valence_zero_scale', v)),
    ),
    sep,
    menu(
      'Stick Radius',
      [0.1, 0.2, 0.25].map((v) => radio(String(v), 'stick_radius', v)),
    ),
    menu(
      'Stick Hydrogen Scale',
      [0.4, 1].map((v) => radio(String(v), 'stick_h_scale', v)),
    ),
    sep,
    menu(
      'Line Width',
      [1.0, 1.49, 3.0].map((v) => radio(String(v), 'line_width', v)),
    ),
    check('Lines As Cylinders', 'line_as_cylinders', 1),
  ]),

  menu('Cartoon', [
    menu('Rings and Bases', [
      radio('Filled Rings (Round Edges)', 'cartoon_ring_mode', 1),
      radio('Filled Rings (Flat Edges)', 'cartoon_ring_mode', 2),
      radio('Filled Rings (with Border)', 'cartoon_ring_mode', 3),
      radio('Spheres', 'cartoon_ring_mode', 4),
      radio('Base Ladders', 'cartoon_ring_mode', 0),
      sep,
      radio('Bases and Sugars', 'cartoon_ring_finder', 1),
      radio('Bases Only', 'cartoon_ring_finder', 2),
      radio('Non-protein Rings', 'cartoon_ring_finder', 3),
      radio('All Rings', 'cartoon_ring_finder', 4),
      sep,
      radio('Transparent Rings', 'cartoon_ring_transparency', 0.5),
      radio('Default', 'cartoon_ring_transparency', -1),
    ]),
    check('Side Chain Helper', 'cartoon_side_chain_helper', 1),
    check('Round Helices', 'cartoon_round_helices', 1),
    check('Fancy Helices', 'cartoon_fancy_helices', 1),
    check('Cylindrical Helices', 'cartoon_cylindrical_helices', 1),
    check('Flat Sheets', 'cartoon_flat_sheets', 1),
    check('Fancy Sheets', 'cartoon_fancy_sheets', 1),
    check('Smooth Loops', 'cartoon_smooth_loops', 1),
    check('Discrete Colors', 'cartoon_discrete_colors', 1),
    // The check-with-a-colour-index pattern: on = 104 (grey50), off = -1.
    check('Highlight Color', 'cartoon_highlight_color', 104, -1),
    menu('Sampling', [
      radio('Atom count dependent', 'cartoon_sampling', -1),
      ...[2, 7, 14].map((v) => radio(String(v), 'cartoon_sampling', v)),
    ]),
    menu(
      'Gap Cutoff',
      [0, 5, 10, 20].map((v) => radio(String(v), 'cartoon_gap_cutoff', v)),
    ),
  ]),

  menu('Ribbon', [
    check('Side Chain Helper', 'ribbon_side_chain_helper', 1),
    check('Trace Atoms', 'ribbon_trace_atoms', 1),
    sep,
    radio('As Lines', 'ribbon_as_cylinders', 0),
    radio('As Cylinders', 'ribbon_as_cylinders', 1),
    menu('Cylinder Radius', [
      radio('Match Line Width', 'ribbon_radius', 0),
      ...[0.2, 0.5, 1].map((v) => radio(`${v.toFixed(1)} Angstrom`, 'ribbon_radius', v)),
    ]),
  ]),

  menu('Surface', [
    menu('Color', [
      radio('White', 'surface_color', 0),
      // 4236 is gray80 and 25 is gray: hardcoded colour INDICES in _gui.py,
      // resolved to live RGB by the colour store rather than trusted labels.
      radio('Light Gray', 'surface_color', 4236),
      radio('Gray', 'surface_color', 25),
      radio('Default (Atomic)', 'surface_color', -1),
    ]),
    radio('Dot', 'surface_type', 1),
    radio('Wireframe', 'surface_type', 2),
    radio('Solid', 'surface_type', 0),
    sep,
    radio('Cavities and Pockets Only', 'surface_cavity_mode', 1),
    radio('Cavities and Pockets (Culled)', 'surface_cavity_mode', 2),
    menu('Cavity Detection Radius', [
      radio('7 Angstrom', 'surface_cavity_radius', 7),
      ...[3, 4, 5, 6, 8, 10, 20].map((v) =>
        radio(`${v} Solvent Radii`, 'surface_cavity_radius', -v),
      ),
    ]),
    menu(
      'Cavity Detection Cutoff',
      [1, 2, 3, 4, 5].map((v) => radio(`${v} Solvent Radii`, 'surface_cavity_cutoff', -v)),
    ),
    radio('Exterior (Normal)', 'surface_cavity_mode', 0),
    sep,
    check('Solvent Accessible', 'surface_solvent', 1),
    sep,
    check('Smooth Edges', 'surface_smooth_edges', 1),
    check('Edge Proximity', 'surface_proximity', 1),
    sep,
    radio('Ignore None', 'surface_mode', 1),
    radio('Ignore HETATMs', 'surface_mode', 0),
    radio('Ignore Hydrogens', 'surface_mode', 2),
    radio('Ignore Unsurfaced', 'surface_mode', 3),
  ]),

  menu('Volume', [
    check('Pre-integrated Rendering', 'volume_mode'),
    menu(
      'Number of Layers',
      [100, 256, 500, 1000].map((v) => radio(String(v), 'volume_layers', v)),
    ),
  ]),

  menu('Transparency', [
    menu('Surface', transparencyMenu('transparency')),
    menu('Sphere', transparencyMenu('sphere_transparency')),
    menu('Cartoon', transparencyMenu('cartoon_transparency')),
    menu('Stick', transparencyMenu('stick_transparency')),
    sep,
    transparencyPreset('Uni-Layer', 2, 1, 0),
    transparencyPreset('Multi-Layer', 1, 0, 1),
    transparencyPreset('Multi-Layer (Real-time OIT)', 3, 0, -1),
    transparencyPreset('Fast and Ugly', 0, 1, 0),
    sep,
    check('Angle-dependent', 'ray_transparency_oblique', 1.0, 0.0),
  ]),

  menu('Rendering', [
    check('OpenGL 2.0 Shaders', 'use_shaders', 1),
    sep,
    check('Antialias (Ray Tracing)', 'antialias', 1),
    menu('Antialias (Real Time)', [
      radio('off', 'antialias_shader', 0),
      radio('FXAA', 'antialias_shader', 1),
      radio('SMAA', 'antialias_shader', 2),
    ]),
    sep,
    {
      kind: 'command',
      label: 'Modernize',
      calls: [{ fn: 'util.modernize_rendering', args: [1] }],
      echo: 'util.modernize_rendering(1)',
    },
    sep,
    menu('Shadows', [
      ...['none', 'light', 'medium', 'heavy', 'black'].map(shadow),
      sep,
      ...['matte', 'soft', 'occlusion', 'occlusion2'].map(shadow),
    ]),
    menu('Texture', rayTexture('ray_texture')),
    menu('Interior Texture', rayTexture('ray_interior_texture')),
    menu('Memory', [
      radio('Use Less (slower)', 'hash_max', 70),
      radio('Use Standard Amount', 'hash_max', 100),
      radio('Use More (faster)', 'hash_max', 170),
      radio('Use Even More', 'hash_max', 230),
      radio('Use Most', 'hash_max', 300),
    ]),
    sep,
    check('Cull Backfaces', 'backface_cull', 1),
    check('Opaque Interiors', 'ray_interior_color', 74, -1),
  ]),

  sep,

  menu('PDB File Loading', [check('Ignore PDB Segment Identifier', 'ignore_pdb_segi', 1)]),
  menu('mmCIF File Loading', [
    check('Use "auth" Identifiers', 'cif_use_auth', 1),
    // `assembly` is a STRING setting driven as a toggle: '1' / ''.
    check('Load Assembly (Biological Unit)', 'assembly', '1', ''),
    check('Bonding by "Chemical Component Dictionary"', 'connect_mode', 4, 0),
  ]),
  menu('Map File Loading', [
    check('Normalize CCP4 Maps', 'normalize_ccp4_maps', 1),
    check('Normalize O Maps', 'normalize_o_maps', 1),
  ]),

  sep,

  menu('Auto-Show ...', [
    check('Cartoon/Sticks/Spheres by Classification', 'auto_show_classified', -1, 0),
    sep,
    check('Auto-Show Lines', 'auto_show_lines', 1),
    check('Auto-Show Spheres', 'auto_show_spheres', 1),
    check('Auto-Show Nonbonded', 'auto_show_nonbonded', 1),
    sep,
    check('Auto-Show New Selections', 'auto_show_selections', 1),
    check('Auto-Hide Selections', 'auto_hide_selections', 1),
  ]),
  check('Auto-Zoom New Objects', 'auto_zoom', 1),
  check('Auto-Remove Hydrogens', 'auto_remove_hydrogens', 1),
  sep,
  check('Show Text (Esc)', 'text'),
  check('Overlay Text', 'overlay'),
];

/** Every setting name the menu binds, for tests and for a bulk pre-read. */
export function menuSettingNames(items: readonly MenuItem[] = SETTING_MENU): string[] {
  const out: string[] = [];
  const walk = (list: readonly MenuItem[]): void => {
    for (const item of list) {
      if (item.kind === 'menu') walk(item.items);
      else if (item.kind === 'check' || item.kind === 'radio') out.push(item.setting);
    }
  };
  walk(items);
  return [...new Set(out)];
}
