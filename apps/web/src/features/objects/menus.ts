/**
 * The A / S / H / L / C / M popup menus.
 *
 * THE LONG-TERM ANSWER IS NOT THIS FILE. `docs/webclient/internal-gui.md` §12 is
 * explicit: menus must be FETCHED from the backend as data
 * (`pymol.menu.<name>(cmd, *args)` -> `[code, text, command]`), never
 * re-declared in TypeScript, because the entries embed `cmd.*` source strings
 * and are generated from live state — scene lists, ramp lists, object lists, the
 * colour table. That is WP-13's `bridge/tenmol_bridge/panels/menus.py`, and it
 * cannot be called from here today: `pymol.menu.*` takes the `cmd` object as its
 * first argument, which does not exist on the wire.
 *
 * So this file is the INTERIM: the leaves that are a single unambiguous `cmd.*`
 * call are transcribed from `modules/pymol/menu.py` (line-cited per block, and
 * in the same order PyMOL draws them), and everything that needs the popup
 * engine — lazy submenus, `menucontext`, `\RGB` colour codes, wizard-driven
 * rename — is present as a DISABLED row naming its owner. A user can see exactly
 * what exists and what does not; nothing is silently missing.
 *
 * Hit-column indices match `CExecutive::click` (`layer3/Executive.cpp:14992`):
 * 0=A 1=S 2=H 3=L 4=C 5=M, and `get_op_cnt()` (`:1749-1756`) is 5, or 6 when
 * `button_mode_name == "3-Button Motions"`.
 */

import { panelActions, quoteName, type PanelAction, type PanelRow } from '@tenmol/stores';

export type OpButton = 'A' | 'S' | 'H' | 'L' | 'C' | 'M';

export const OPS: readonly OpButton[] = ['A', 'S', 'H', 'L', 'C'];
export const MOTION_OP: OpButton = 'M';

export type MenuItem =
  | { kind: 'title'; label: string }
  | { kind: 'sep' }
  | { kind: 'item'; label: string; action: PanelAction; indent?: number; swatch?: string }
  | { kind: 'todo'; label: string; owner: string; note: string; indent?: number };

/** `[code, text, command]` code 2 rows. */
const title = (label: string): MenuItem => ({ kind: 'title', label });
const sep: MenuItem = { kind: 'sep' };
const todo = (label: string, owner: string, note: string): MenuItem => ({
  kind: 'todo',
  label,
  owner,
  note,
});

/** A leaf that is exactly one `cmd.*` call. */
function item(label: string, action: PanelAction, indent = 0): MenuItem {
  return { kind: 'item', label, action, indent };
}

/* ------------------------------------------------------------------ *
 * S / H — menu.py:145-176 rep_action(), :197-215 mol_show, :223-240 mol_hide
 * ------------------------------------------------------------------ */

/** `rep_action` verbatim, including the two-space indents and the blank rows. */
const REP_ACTION: ReadonlyArray<{ label: string; rep: string; indent: number } | 'sep'> = [
  { label: 'wire', rep: 'wire', indent: 0 },
  { label: 'lines', rep: 'lines', indent: 1 },
  { label: 'nonbonded', rep: 'nonbonded', indent: 1 },
  'sep',
  { label: 'licorice', rep: 'licorice', indent: 0 },
  { label: 'sticks', rep: 'sticks', indent: 1 },
  { label: 'nb_spheres', rep: 'nb_spheres', indent: 1 },
  'sep',
  { label: 'ribbon', rep: 'ribbon', indent: 0 },
  { label: 'cartoon', rep: 'cartoon', indent: 0 },
  'sep',
  { label: 'label', rep: 'labels', indent: 0 },
  { label: 'cell', rep: 'cell', indent: 0 },
  'sep',
  { label: 'dots', rep: 'dots', indent: 0 },
  { label: 'spheres', rep: 'spheres', indent: 0 },
  'sep',
  { label: 'mesh', rep: 'mesh', indent: 0 },
  { label: 'surface', rep: 'surface', indent: 0 },
];

function repRows(name: string, action: 'show' | 'hide' | 'show_as'): MenuItem[] {
  const make =
    action === 'show'
      ? panelActions.show
      : action === 'hide'
        ? panelActions.hide
        : panelActions.showAs;
  return REP_ACTION.map((entry) =>
    entry === 'sep' ? sep : item(entry.label, make(entry.rep, name), entry.indent),
  );
}

/** `map_show`/`mesh_show`/`surface_show`/`slice_show`/`volume_show`, menu.py:277-333. */
const NON_MOLECULAR_REPS: Record<string, readonly string[]> = {
  'object:map': ['dots', 'extent', 'everything'],
  'object:mesh': ['mesh', 'cell', 'everything'],
  'object:surface': ['surface', 'cell', 'everything'],
  'object:slice': ['slice'],
  'object:volume': ['volume', 'extent'],
  'object:measurement': ['dashes', 'angles', 'dihedrals', 'labels'],
  'object:cgo': ['cgo'],
  'object:alignment': ['cgo'],
};

function showMenu(row: PanelRow): MenuItem[] {
  const name = row.isAll ? 'all' : row.name;
  const reps = NON_MOLECULAR_REPS[row.type];
  if (reps) {
    return [title('Show:'), ...reps.map((rep) => item(rep, panelActions.show(rep, name)))];
  }
  return [
    title('Show:'),
    todo(
      'as ▸',
      'WP-13',
      'mol_as (menu.py:178-182) — a submenu of show_as, needs the popup engine',
    ),
    sep,
    ...repRows(name, 'show'),
    sep,
    todo('organic ▸', 'WP-13', 'show_misc, menu.py:190-195'),
    todo('main chain ▸', 'WP-13', 'show_misc over (byres sele)&bb.'),
    todo('side chain ▸', 'WP-13', 'show_misc over (byres sele)&sc.'),
    todo('disulfides ▸', 'WP-13', 'show_misc over the CYS SG pairs'),
    sep,
    todo('valence', 'WP-13', 'cmd.set_bond("valence","1",sele) — set_bond is not yet granted'),
  ];
}

function hideMenu(row: PanelRow): MenuItem[] {
  const name = row.isAll ? 'all' : row.name;
  const reps = NON_MOLECULAR_REPS[row.type];
  if (reps) {
    return [title('Hide:'), ...reps.map((rep) => item(rep, panelActions.hide(rep, name)))];
  }
  return [
    title('Hide:'),
    item('everything', panelActions.hide('everything', name)),
    sep,
    ...repRows(name, 'hide'),
    sep,
    todo('main chain', 'WP-13', 'cmd.hide("((byres sele)&(bb.&!name CA+N+C+O))")'),
    todo('side chain', 'WP-13', 'cmd.hide("((byres sele)&(sc.&!...))")'),
    todo('waters', 'WP-13', 'cmd.hide("(solvent and (sele))") — a selection expression, not a rep'),
    todo('hydrogens ▸', 'WP-13', 'hide_hydro, menu.py:217-221'),
    todo('unselected', 'WP-13', 'cmd.hide("(not sele)")'),
  ];
}

/* ------------------------------------------------------------------ *
 * C — menu.py:519-618 all_colors_list, :625-641 all_colors, :672-685 mol_color
 * ------------------------------------------------------------------ */

/**
 * `all_colors_list` verbatim: nine groups, each `(colourCode, name)`. The code
 * is PyMOL's `\RGB` text-colour escape, three digits 0-9
 * (`TextSetColorFromCode`, `layer1/Text.cpp:530-548`) — here it becomes the CSS
 * swatch, which is the same information the C++ menu draws.
 */
const ALL_COLORS: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, string]>]> = [
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
      ['960', 'tv_orange'],
      ['950', 'orange'],
      ['852', 'sand'],
    ],
  ],
  [
    'magentas',
    [
      ['909', 'magenta'],
      ['929', 'lightmagenta'],
      ['809', 'hotpink'],
      ['957', 'pink'],
      ['978', 'lightpink'],
      ['646', 'dirtyviolet'],
      ['747', 'violet'],
      ['636', 'violetpurple'],
      ['636', 'purple'],
      ['515', 'deeppurple'],
    ],
  ],
  [
    'cyans',
    [
      ['099', 'cyan'],
      ['499', 'palecyan'],
      ['299', 'lightteal'],
      ['088', 'aquamarine'],
      ['087', 'greencyan'],
      ['077', 'teal'],
      ['055', 'deepteal'],
    ],
  ],
  [
    'oranges',
    [
      ['950', 'orange'],
      ['960', 'tv_orange'],
      ['870', 'brightorange'],
      ['985', 'lightorange'],
      ['983', 'yelloworange'],
      ['852', 'olive'],
      ['740', 'deepolive'],
    ],
  ],
  [
    'tints',
    [
      ['955', 'wheat'],
      ['996', 'palegreen'],
      ['899', 'lightblue'],
      ['989', 'bluewhite'],
      ['998', 'palecyan'],
      ['889', 'lightpink'],
      ['988', 'paleyellow'],
      ['898', 'lightorange'],
    ],
  ],
  [
    'grays',
    [
      ['999', 'white'],
      ['888', 'gray90'],
      ['777', 'gray80'],
      ['666', 'gray70'],
      ['555', 'gray60'],
      ['444', 'gray50'],
      ['333', 'gray40'],
      ['222', 'gray30'],
      ['111', 'gray20'],
      ['000', 'black'],
    ],
  ],
];

/** `\RGB`, digits 0-9, exactly as `TextSetColorFromCode` decodes them. */
export function swatchFromCode(code: string): string {
  const value = (index: number) => Math.round((Number(code[index] ?? '0') / 9) * 255);
  return `rgb(${value(0)}, ${value(1)}, ${value(2)})`;
}

function colorMenu(row: PanelRow): MenuItem[] {
  const name = row.isAll ? 'all' : row.name;
  const rows: MenuItem[] = [
    title('Color:'),
    todo('by element ▸', 'WP-13', 'by_elem, menu.py:400-418 — 8 carbon sets, util.cba/util.cbh'),
    todo('by chain ▸', 'WP-13', 'by_chain, menu.py:464-480 — util.color_chains / util.chainbow'),
    todo('by ss ▸', 'WP-13', 'by_ss, menu.py:420-426 — util.cbss presets'),
    todo('by rep ▸', 'WP-13', 'by_rep, menu.py:428-444 over rep_setting_lists'),
    todo('spectrum ▸', 'WP-13', 'spectrum, menu.py:446-462'),
    sep,
    todo('auto ▸', 'WP-13', 'color_auto, menu.py:659-670'),
    sep,
  ];
  for (const [group, colors] of ALL_COLORS) {
    rows.push(title(group));
    for (const [code, colorName] of colors) {
      rows.push({
        kind: 'item',
        label: colorName,
        // `cmd.color_deep(color, name, 0)` — menu.py:626 `all_colors`.
        action: {
          fn: 'color_deep',
          args: [colorName, name, 0],
          echo: `color_deep ${colorName}, ${quoteName(name)}`,
        },
        swatch: swatchFromCode(code),
      });
    }
  }
  return rows;
}

/* ------------------------------------------------------------------ *
 * A — menu.py:1160-1188 sele_action, :1248-1281 mol_action
 * ------------------------------------------------------------------ */

function actionMenu(row: PanelRow): MenuItem[] {
  const name = row.isAll ? 'all' : row.name;
  const isSelection = row.type === 'selection';

  const rows: MenuItem[] = [
    title('Action:'),
    item('zoom', panelActions.zoom(name)),
    item('orient', panelActions.orient(name)),
    item('center', panelActions.center(name)),
    item('origin', { fn: 'origin', args: [name], echo: `origin ${quoteName(name)}` }),
    sep,
  ];

  if (!isSelection && !row.isAll) {
    rows.push(
      item('reset matrix', {
        fn: 'reset',
        args: [name],
        echo: `reset object=${quoteName(name)}`,
      }),
      item('assign sec. struc.', { fn: 'dss', args: [name], echo: `dss ${quoteName(name)}` }),
      sep,
    );
  }

  rows.push(
    todo('preset ▸', 'WP-13', 'presets, menu.py — a live submenu over pymol.preset'),
    todo('find ▸', 'WP-13', 'find, menu.py — polar contacts etc.'),
    todo('align ▸', 'WP-13', 'mol_align / sele_align'),
    todo('generate ▸', 'WP-13', 'mol_generate — symmetry mates, surfaces'),
    sep,
    todo(
      'clean',
      'WP-17',
      'cmd.clean is Incentive-only (IncentiveOnlyException); the button ships disabled, not broken',
    ),
    todo('rename ▸', 'WP-16', 'cmd.wizard("renaming", sele) — needs the wizard panel'),
    todo('copy to object ▸', 'WP-13', 'lazy submenu (menu.py:1269, SubGetItem)'),
    todo('group ▸', 'WP-13', 'lazy submenu move_to_group (menu.py:1270)'),
    sep,
  );

  if (isSelection) {
    rows.push(
      item('delete selection', panelActions.deleteObject(name)),
      item('remove atoms', {
        fn: 'remove',
        args: [name],
        echo: `remove ${quoteName(name)}`,
        invalidatesNames: true,
      }),
    );
  } else {
    rows.push(
      item('delete object', panelActions.deleteObject(name)),
      item('remove waters', {
        fn: 'remove',
        args: [`(solvent and (${name}))`],
        echo: `remove (solvent and (${name}))`,
        invalidatesNames: true,
      }),
    );
  }

  rows.push(
    sep,
    todo('state ▸', 'WP-20', 'state submenu'),
    todo('masking ▸', 'WP-17', 'masking submenu'),
    todo('sequence ▸', 'WP-21', 'sequence submenu'),
    todo('movement ▸', 'WP-20', 'movement submenu'),
    todo('compute ▸', 'WP-24', 'compute submenu'),
  );
  return rows;
}

/* ------------------------------------------------------------------ *
 * L — menu.py:1546-1571 mol_labels
 * ------------------------------------------------------------------ */

function labelMenu(row: PanelRow): MenuItem[] {
  const name = row.isAll ? 'all' : row.name;
  const label = (text: string, expression: string) =>
    item(text, panelActions.label(expression, name));
  return [
    title('Label:'),
    item('clear', panelActions.label('""', name)),
    sep,
    label('residues (resn-resi)', '"%s-%s" % (resn, resi)'),
    label('chains', 'chain'),
    label('segments', 'segi'),
    sep,
    label('atom name', 'name'),
    label('element symbol', 'elem'),
    label('residue name', 'resn'),
    label('one letter code', 'oneletter'),
    label('residue identifier', 'resi'),
    sep,
    label('b-factor', 'b'),
    label('occupancy', 'q'),
    label('vdw radius', 'vdw'),
    sep,
    todo('residues (one letter) ▸', 'WP-13', 'anchored on cmd.get("label_anchor")'),
    todo('other properties ▸', 'WP-13', 'label_props, menu.py:1520-1537'),
    todo('atom identifiers ▸', 'WP-13', 'label_ids, menu.py:1539-1544'),
  ];
}

/* ------------------------------------------------------------------ *
 * M — menu.py:108-124 camera_motion, :126-143 obj_motion
 * ------------------------------------------------------------------ */

function motionMenu(row: PanelRow): MenuItem[] {
  return [
    title(row.isAll ? 'Camera motion:' : 'Object motion:'),
    todo('store / clear / interpolate ▸', 'WP-20', 'camera_motion / obj_motion, menu.py:108-143'),
  ];
}

/* ------------------------------------------------------------------ */

/** The menu a given button opens for a given row. */
export function menuFor(row: PanelRow, op: OpButton): MenuItem[] {
  switch (op) {
    case 'A':
      return actionMenu(row);
    case 'S':
      return showMenu(row);
    case 'H':
      return hideMenu(row);
    case 'L':
      // `layer3/Executive.cpp:15169-15176`: L has NO menu for measurement, map,
      // surface, mesh or slice rows. PyMOL draws the button and does nothing.
      return row.type === 'object:molecule' || row.type === 'selection' || row.isAll
        ? labelMenu(row)
        : [
            title('Label:'),
            todo('(no label menu for this object type)', '—', 'Executive.cpp:15169-15176'),
          ];
    case 'C':
      return colorMenu(row);
    case 'M':
      return motionMenu(row);
  }
}

export const OP_TITLES: Record<OpButton, string> = {
  A: 'Actions',
  S: 'Show',
  H: 'Hide',
  L: 'Label',
  C: 'Color',
  M: 'Motion',
};
