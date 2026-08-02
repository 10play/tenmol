/**
 * Topic module `dialogs` — the remaining Qt dialogs.  OWNER: WP-22.
 *
 * NOT part of the frozen `topics/index.ts` barrel: nothing here is pushed by the
 * bridge yet, so there is no `DialogsPayload` and no registry entry to claim.
 * (`topics/dialog.ts`, singular, is WP-18's *blocking* dialog channel and is a
 * different thing entirely.)  This module is the shared wire vocabulary for the
 * dialogs that are pulled on demand:
 *
 *   * the VOLUME colour-ramp editor  (`packages/engine/modules/pmg_qt/volume.py`, 877 lines)
 *   * the properties inspector       (`packages/engine/modules/pmg_qt/properties_dialog.py`)
 *   * the advanced settings table    (`packages/engine/modules/pmg_qt/advanced_settings_gui.py`)
 *   * the text editor                (`packages/engine/modules/pmg_qt/TextEditor.py`)
 *
 * Import it by path — `@tenmol/protocol/topics/dialogs` — exactly as the
 * package's `./topics/*` export declares.
 *
 * Zero runtime dependencies; types plus a handful of frozen constant tables.
 *
 * @notATopic  NOT A TRANSPORT TOPIC — deliberately not re-exported by the
 * frozen `topics/index.ts` barrel. Reached by its subpath
 * (`@tenmol/protocol/topics/dialogs`); its events, if any, ride an existing
 * topic. `packages/bridge/tests/test_dispatch.py` looks for this tag.
 */

/* ------------------------------------------------------------------ *
 * Volume colour ramp
 * ------------------------------------------------------------------ */

/**
 * One stop of a volume colour ramp.
 *
 * PyMOL's own storage order is the flat 5-tuple `value, r, g, b, alpha`
 * (`ExecutiveGetVolumeRamp` -> `colorramping.ramp_expand`,
 * `packages/engine/modules/pymol/colorramping.py:236-262`), while the Qt widget keeps tuples of
 * `(x, y, r, g, b)` where `x` is the data value and `y` is the alpha
 * (`packages/engine/modules/pmg_qt/volume.py:747-767`).  We keep PyMOL's field NAMES and the
 * widget's separation, so neither conversion is ever guessed at.
 *
 * `r`/`g`/`b`/`alpha` are 0..1 floats, never 0..255.
 */
export interface VolumeRampPoint {
  /** Data value on the map's own scale. */
  value: number;
  /** 0..1 */
  r: number;
  /** 0..1 */
  g: number;
  /** 0..1 */
  b: number;
  /** 0..1 opacity. */
  alpha: number;
}

/**
 * `cmd.volume_color(name)` with no ramp is the GETTER and returns this flat
 * list: `[v, r, g, b, a, v, r, g, b, a, ...]` (`colorramping.py:88-118`).
 * The setter takes the identical shape.
 */
export type FlatVolumeRamp = readonly number[];

/**
 * `cmd.get_volume_histogram(name, bins=64)` -> `[min, max, mean, stdev,
 * h0 .. h(bins-1)]` (`packages/engine/modules/pymol/querying.py:62-72`, C
 * `ExecutiveGetHistogram`).  Length is `bins + 4`.
 *
 * WIRE HAZARD, measured on this tree: the bridge lists `get_volume_histogram`
 * in `codec.BLOB_RETURNS` and its blob writer insists on a numpy array, but the
 * C function returns a plain Python list — so the call currently answers
 * `NotSerializable: get_volume_histogram returned list, expected a numpy array`.
 * Clients must therefore be able to fall back to computing the same 4+N vector
 * from `cmd.get_volume_field`, which *is* a numpy array and does arrive as a
 * blob.  See `HISTOGRAM_BINS`.
 */
export type VolumeHistogram = readonly number[];

/** `bins` default of `cmd.get_volume_histogram` (`querying.py:62`). */
export const HISTOGRAM_BINS = 64;

/** Fixed prefix length of a histogram payload: min, max, mean, stdev. */
export const HISTOGRAM_HEADER = 4;

/**
 * Named ramps registered in `pymol.colorramping.namedramps`
 * (`packages/engine/modules/pymol/colorramping.py:17-54`) and offered by the internal object
 * menu at `A > volume` (`packages/engine/modules/pymol/menu.py:644-654`).  `volume_ramp_new`
 * adds more at runtime, so this is the *built-in* set, not the whole set — ask
 * the bridge for the live keys when you can.
 */
export const BUILTIN_VOLUME_RAMPS = ['2fofc', 'fofc', 'esp', 'rainbow', 'rainbow2'] as const;
export type BuiltinVolumeRamp = (typeof BUILTIN_VOLUME_RAMPS)[number];

/* ------------------------------------------------------------------ *
 * Properties inspector
 * ------------------------------------------------------------------ */

/**
 * The eight editable branches of `PropsDialog`'s fixed tree
 * (`packages/engine/modules/pmg_qt/properties_dialog.py:69-117`).  The branch is what decides
 * which `cmd.*` call an edit turns into (`:150-227`) and which unset call the
 * Delete key turns into (`:229-286`), so it travels with every row.
 */
export const PROPERTY_BRANCHES = [
  'object-ttt',
  'object-settings',
  'ostate-title',
  'ostate-matrix',
  'ostate-settings',
  'atom-identifier',
  'atom-builtin',
  'atom-settings',
  /*
   * Atom-level custom properties. In the fixed tree at
   * `properties_dialog.py:69-117` this branch is present but marked
   * "Properties — Incentive only", so open-source Qt hides it. `p.all`
   * works in this build (measured), so the branch is real here and the
   * rows are filled by `cmd.tenmol_props.atom_extras`.
   */
  'atom-property',
  'astate-builtin',
  'astate-settings',
] as const;
export type PropertyBranch = (typeof PROPERTY_BRANCHES)[number];

export interface PropertyRow {
  branch: PropertyBranch;
  /** Column 0. Never editable (`UneditableDelegate`, `properties_dialog.py:18`). */
  key: string;
  /** Column 1, already formatted (hex for `color`, binary for `reps`/`flags`). */
  text: string;
  /** `model`, `index`, `state` and `oneletter` are disabled (`:113-117`). */
  readOnly?: boolean;
  /** Set when the value could not be read; rendered instead of a lie. */
  unavailable?: string;
}

/**
 * The 11 atom identifier keys, in `properties_dialog.py:99-102` order.
 * `oneletter` is read-only.
 */
export const ATOM_IDENTIFIER_KEYS = [
  'model',
  'index',
  'segi',
  'chain',
  'resi',
  'resn',
  'oneletter',
  'name',
  'alt',
  'ID',
  'rank',
] as const;

/**
 * The 19 built-in atom properties, `properties_dialog.py:103-110`.
 * `stereo` is deliberately absent upstream ("avoid stereo auto-assignment
 * errors") and must stay absent here.
 */
export const ATOM_BUILTIN_KEYS = [
  'elem',
  'q',
  'b',
  'type',
  'formal_charge',
  'partial_charge',
  'numeric_type',
  'text_type',
  'vdw',
  'ss',
  'color',
  'reps',
  'flags',
  'label',
  'cartoon',
  'protons',
  'geom',
  'valence',
  'elec_radius',
] as const;

/** The 4 atom-state built-ins, `properties_dialog.py:111`. */
export const ASTATE_BUILTIN_KEYS = ['state', 'x', 'y', 'z'] as const;

/** Keys the Qt dialog disables outright (`properties_dialog.py:113-117`). */
export const PROPERTY_READONLY_KEYS = ['model', 'index', 'state', 'oneletter'] as const;

/* ------------------------------------------------------------------ *
 * Advanced settings
 * ------------------------------------------------------------------ */

/**
 * `cmd.get_setting_tuple(index)` answers `(type, values)`; the type constants
 * are the `cSetting_*` enum of `packages/engine/layer0/Setting.h` as consumed by
 * `packages/engine/modules/pmg_qt/advanced_settings_gui.py:60-80`.
 */
export const SETTING_TYPE = {
  Boolean: 1,
  Int: 2,
  Float: 3,
  Float3: 4,
  Color: 5,
  String: 6,
} as const;
export type SettingTypeValue = (typeof SETTING_TYPE)[keyof typeof SETTING_TYPE];

export interface AdvancedSettingRow {
  /** `setting.get_name_list()` entry. */
  name: string;
  /** `setting._get_index(name)`. */
  index: number;
  type: SettingTypeValue;
  /** `cmd.get(index)` — always the STRING form, exactly like the Qt table. */
  value: string;
}

/* ------------------------------------------------------------------ *
 * Text editor
 * ------------------------------------------------------------------ */

/**
 * The exclusive Syntax menu of `packages/engine/modules/pmg_qt/TextEditor.py:60-74`.  There is
 * no `pmg_qt/syntax/plain.py` in this tree, so "Plain Text" means "no
 * highlighting", not "a plain highlighter".
 */
export const SYNTAX_MODES = ['python', 'pml', 'plain'] as const;
export type SyntaxMode = (typeof SYNTAX_MODES)[number];

/** A file the editor has open. `path` is a real server-side path (localhost). */
export interface EditorFile {
  path: string;
  text: string;
  syntax: SyntaxMode;
}
