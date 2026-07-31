/**
 * Topic `objects` — the object panel (Qt "names list").  OWNER: WP-12.
 *
 * NOTE FOR THE PARITY INVENTORY (plan §6 WP-12): the object panel has NO Python
 * data feed upstream. It is a C++ `Block::draw` surface (`struct CExecutive :
 * public Block`, `layer3/ExecutiveDef.h:54`, `:99`) redrawn from the live Spec
 * list at up to 50 Hz. `bridge/tenmol_bridge/panels/objects.py` is a NEW
 * endpoint built from `get_names` / `get_type` / `get_vis` / group queries —
 * those rows are "new bridge endpoint required", not "wire up existing API".
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
  /** Rep visibility bitmask — `cRep*Bit` values, `layer1/Rep.h:84-104`. */
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
