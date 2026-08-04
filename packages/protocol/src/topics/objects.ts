/**
 * Topic `objects` — the object panel (Qt "names list").  OWNER: WP-12.
 *
 * NOTE FOR THE PARITY INVENTORY (plan §6 WP-12): the object panel has NO Python
 * data feed upstream. It is a C++ `Block::draw` surface (`struct CExecutive :
 * public Block`, `packages/engine/layer3/ExecutiveDef.h:54`, `:99`) redrawn from the live Spec
 * list at up to 50 Hz. `packages/bridge/tenmol_bridge/panels/objects.py` is a NEW
 * endpoint built from `get_names` / `get_vis` / `get_session(partial=1)` —
 * those rows are "new bridge endpoint required", not "wire up existing API".
 *
 * Two shapes live here, and they are NOT redundant:
 *
 *   `ObjectRow`/`ObjectsPayload`   the flat, push-topic shape. It carries what
 *                                  two cheap polls (`get_names` + `get_vis`)
 *                                  can see, and nothing that needs the panel
 *                                  endpoint.
 *   `PanelSnapshot`/`PanelRow`     what `panels/objects.py` actually answers:
 *                                  real `PanelListGroup` order, real nest
 *                                  levels, real `ObjectGroup::OpenOrClosed`,
 *                                  the caption, and the settings the panel
 *                                  draws itself from.
 *
 * The difference matters because group nesting and group open/closed are not
 * derivable client-side: `cmd.get_names` returns Spec order, not panel order,
 * and a CLOSED group's children are not rows at all
 * (`PanelListGroup`, `packages/engine/layer3/Executive.cpp:1531-1563`).
 */

export type PymolObjectType =
  | 'object:molecule'
  | 'object:map'
  | 'object:mesh'
  | 'object:measurement'
  | 'object:callback'
  | 'object:cgo'
  | 'object:surface'
  | 'object:slice'
  | 'object:alignment'
  | 'object:group'
  | 'object:volume'
  | 'object:ramp'
  | 'object:curve'
  | 'selection'
  | (string & {});

/** One row of the object panel. */
export interface ObjectRow {
  name: string;
  type: PymolObjectType;
  /** `cmd.get_names('all', enabled_only=1)` membership. */
  enabled: boolean;
  /** Owning group object name, '' when top level. */
  group: string;
  /** Indentation depth implied by group nesting; 0 at top level. */
  nest: number;
  /** Rep visibility bitmask — `cRep*Bit` values, `packages/engine/layer1/Rep.h:84-104`. */
  reps: number;
  /** PyMOL color index, or null for objects without one. */
  color: number | null;
  /** Object caption / title text, '' when unset. */
  caption: string;
  /** Number of states (`cmd.count_states`); 1 for most objects. */
  states?: number;
}

export interface ObjectsPayload {
  objects: ObjectRow[];
}

/* ------------------------------------------------------------------ *
 * The panel endpoint — `cmd.tenmol_objects('snapshot')`
 * ------------------------------------------------------------------ */

/** A row's kind as the menu dispatch table keys it (`CExecutive::click`). */
export type PanelRowKind = 'all' | PymolObjectType;

/** One row of `panels/objects.py`'s `rows()`, in `PanelListGroup` order. */
export interface PanelSnapshotRow extends ObjectRow {
  type: PanelRowKind;
  /** `rec->obj->type == cObjectGroup`. */
  isGroup: boolean;
  /** `ObjectGroup::OpenOrClosed` — server truth, not a client-side toggle. */
  isOpen: boolean;
  /** The synthetic `all` row (`cExecAll`), which `get_names` never returns. */
  isAll: boolean;
  /** `cmd.get_vis()[name][2]`, the raw rep index list. */
  repIndices: number[];
  /** `getNameColor` result for `internal_gui_name_color_mode` 1 or 2, 0..1 RGB. */
  nameColor?: [number, number, number] | number[];
}

/** Panel-wide settings the C++ block reads on every draw. */
export interface PanelSettings {
  group_full_member_names: number;
  group_arrow_prefix: number;
  internal_gui_name_color_mode: number;
  internal_gui_control_size: number;
  internal_gui_width: number;
  hide_underscore_names: number;
}

export interface PanelSnapshot {
  rows: PanelSnapshotRow[];
  /** `get_op_cnt()` — 5, or 6 with `button_mode_name == '3-Button Motions'`. */
  opCount: number;
  buttonMode: string;
  ops: string[];
  settings: PanelSettings;
}

/* ------------------------------------------------------------------ *
 * The popup menus — `cmd.tenmol_objects('menu', name, op)`
 * ------------------------------------------------------------------ */

/**
 * `packages/engine/layer4/PopUp.cpp:131-260` codes: 0 = separator bar, 1 = item, 2 = title.
 * These are PyMOL's own numbers, not an invention of this protocol.
 */
export type PanelMenuCode = 0 | 1 | 2;

/** One `[code, text, command]` entry, serialised. */
export interface PanelMenuNode {
  code: PanelMenuCode;
  /** Raw PyMOL text, `\RGB` colour escapes included (`packages/engine/layer1/Text.cpp:507-548`). */
  text: string;
  /** Index path from the menu root; the handle `expand` takes. */
  path: number[];
  /** A leaf: the command string to run through `{t:'do'}`. */
  command?: string;
  /** An eager submenu (a nested list in `pymol.menu`). */
  items?: PanelMenuNode[];
  /** A callable submenu (`lambda: copy_to(...)`) — resolve with `expand`. */
  lazy?: boolean;
}

export interface PanelMenuPayload {
  name: string;
  kind: PanelRowKind;
  /** 'A' | 'S' | 'H' | 'L' | 'C' | 'M'. */
  op: string;
  /** The `pymol.menu` function that produced it, e.g. `mol_show`. */
  menu: string;
  items: PanelMenuNode[];
}
