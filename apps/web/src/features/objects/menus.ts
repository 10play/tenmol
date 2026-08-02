/**
 * The A / S / H / L / C / M buttons — metadata only.
 *
 * THE MENU CONTENTS ARE NOT IN THIS FILE AND MUST NEVER BE.
 * `docs/internal-gui.md` §12 is explicit: menus are FETCHED from the
 * backend as data (`pymol.menu.<name>(cmd, *args)` -> `[code, text, command]`),
 * because the entries embed `cmd.*` source strings and are generated from live
 * state — scene lists, ramp lists, object lists, the colour table. The previous
 * version of this file transcribed ~150 of those leaves into TypeScript with a
 * dozen `todo` placeholders; all of it is deleted. `panelSource.ts` calls
 * `cmd.tenmol_objects('menu', name, op)` and the real `pymol.menu` answers.
 *
 * What DOES belong here is the dispatch *table* — which button opens which menu
 * for which row type — because the panel has to draw a button that opens
 * nothing (PyMOL draws the L button on a map row and does nothing when you
 * click it, `packages/engine/layer3/Executive.cpp:15205-15229`) and it cannot learn that from a
 * request it never makes. The table is transcribed from `CExecutive::click`
 * (`:15012-15300`) and is asserted against the Python side's copy in
 * `packages/bridge/tests/test_objects.py`.
 *
 * Hit-column indices match `CExecutive::click`: 0=A 1=S 2=H 3=L 4=C 5=M, and
 * `get_op_cnt()` (`:1757-1765`) is 5, or 6 when
 * `button_mode_name == "3-Button Motions"`.
 */

export type OpButton = 'A' | 'S' | 'H' | 'L' | 'C' | 'M';

export const OPS: readonly OpButton[] = ['A', 'S', 'H', 'L', 'C', 'M'];
export const MOTION_OP: OpButton = 'M';

export const OP_TITLES: Record<OpButton, string> = {
  A: 'Actions',
  S: 'Show',
  H: 'Hide',
  L: 'Label',
  C: 'Color',
  M: 'Motion',
};

/**
 * `row kind -> pymol.menu function`, per button. `null` = PyMOL draws the
 * button and opens nothing. An absent key = the row type never reaches that
 * switch case (e.g. a ramp row has no S menu at all).
 */
type Table = Readonly<Record<string, string | null>>;

const A: Table = {
  all: 'all_action',
  selection: 'sele_action',
  'object:group': 'group_action',
  'object:molecule': 'mol_action',
  'object:map': 'map_action',
  'object:surface': 'surface_action',
  'object:mesh': 'mesh_action',
  'object:measurement': 'simple_action',
  'object:cgo': 'simple_action',
  'object:callback': 'simple_action',
  'object:alignment': 'simple_action',
  'object:volume': 'simple_action',
  'object:slice': 'slice_action',
  'object:ramp': 'ramp_action',
};

const S: Table = {
  all: 'mol_show',
  selection: 'mol_show',
  'object:group': 'mol_show',
  'object:molecule': 'mol_show',
  'object:cgo': 'cgo_show',
  'object:alignment': 'cgo_show',
  'object:measurement': 'measurement_show',
  'object:map': 'map_show',
  'object:mesh': 'mesh_show',
  'object:surface': 'surface_show',
  'object:slice': 'slice_show',
  'object:volume': 'volume_show',
};

const H: Table = {
  all: 'mol_hide',
  selection: 'mol_hide',
  'object:group': 'mol_hide',
  'object:molecule': 'mol_hide',
  'object:cgo': 'cgo_hide',
  'object:alignment': 'cgo_hide',
  'object:measurement': 'measurement_hide',
  'object:map': 'map_hide',
  'object:mesh': 'mesh_hide',
  'object:surface': 'surface_hide',
  'object:slice': 'slice_hide',
  'object:volume': 'volume_hide',
};

const L: Table = {
  all: 'mol_labels',
  selection: 'mol_labels',
  'object:group': 'mol_labels',
  'object:molecule': 'mol_labels',
  // `break` with no MenuActivate (Executive.cpp:15218-15227).
  'object:measurement': null,
  'object:map': null,
  'object:surface': null,
  'object:mesh': null,
  'object:slice': null,
};

const C: Table = {
  all: 'mol_color',
  selection: 'mol_color',
  'object:group': 'mol_color',
  'object:molecule': 'mol_color',
  'object:map': 'general_color',
  'object:cgo': 'general_color',
  'object:alignment': 'general_color',
  'object:mesh': 'mesh_color',
  // MenuActivate2Arg(..., "mesh_color", namesele, "surface") — :15252.
  'object:surface': 'mesh_color',
  'object:measurement': 'measurement_color',
  'object:slice': 'slice_color',
  'object:volume': 'vol_color',
  'object:ramp': 'ramp_color',
};

const M: Table = {
  all: 'camera_motion',
  selection: null, // "not relevant at present" (:15281)
  'object:group': 'obj_motion',
  'object:molecule': 'obj_motion',
  'object:measurement': 'obj_motion',
  'object:map': 'obj_motion',
  'object:surface': 'obj_motion',
  'object:cgo': 'obj_motion',
  'object:mesh': 'obj_motion',
};

export const DISPATCH: Readonly<Record<OpButton, Table>> = { A, S, H, L, C, M };

/** The row kind the dispatch table is keyed by. */
export function rowKind(row: { isAll: boolean; type: string }): string {
  return row.isAll ? 'all' : row.type;
}

/** The `pymol.menu` function this button opens for this row, or null. */
export function menuNameFor(kind: string, op: OpButton): string | null {
  return DISPATCH[op][kind] ?? null;
}
