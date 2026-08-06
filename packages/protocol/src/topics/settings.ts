/**
 * Topic `settings` — the single source of truth for every checkbox and radio
 * in every menu.  OWNER: WP-15.
 *
 * Drained from `cmd.get_setting_updates()` (`packages/engine/modules/pymol/setting.py:440-447`),
 * which returns *indices* and CLEARS the queue; the bridge enriches each index.
 *
 * TWO MEASURED TRAPS (plan §1.2):
 *  * `[]` on a lock miss is indistinguishable from "nothing changed" — never
 *    build quiescence/settle detection on this topic.
 *  * The per-object setting channel is SEPARATE and must be drained too
 *    (21.6 us for 31 objects — do it every tick).
 *
 * Min/max ARE available after all, but only as a HINT and never as a limit —
 * see `SettingMeta.min`.  Nothing here clamps.
 */

/* ------------------------------------------------------------------ *
 * Vocabulary
 * ------------------------------------------------------------------ */

/** `packages/engine/layer1/Setting.h:113-120`; `blank` is the one retired slot (index 83). */
export type SettingKind = 'boolean' | 'int' | 'float' | 'float3' | 'color' | 'string' | 'blank';

/**
 * `SettingLevelGetName` (`packages/engine/layer1/Setting.cpp:83-85`).  A lattice, not a chain:
 * `global < object < object-state`, then `object-state < atom < atom-state` and
 * `object-state < bond < bond-state` as siblings (`packages/engine/layer1/Setting.cpp:55-63`).
 */
export type SettingLevel =
  | 'unused'
  | 'global'
  | 'object'
  | 'object-state'
  | 'atom'
  | 'atom-state'
  | 'bond'
  | 'bond-state';

/** Where a write is aimed.  Subset of the levels: what a UI can select. */
export type SettingScope =
  | 'global'
  | 'object'
  | 'object-state'
  | 'atom'
  | 'atom-state'
  | 'bond'
  | 'bond-state';

/** float3 arrives as three numbers; everything else is a scalar. */
export type SettingValue = boolean | number | readonly number[] | string;

/* ------------------------------------------------------------------ *
 * The catalogue
 * ------------------------------------------------------------------ */

/**
 * One row of the static C setting table as the bridge reports it
 * (`packages/bridge/tenmol_bridge/panels/settings.py`).
 *
 * `index` is FROZEN FOREVER — sessions serialize it
 * (`packages/engine/layer1/SettingInfo.h:5-6`), so it, not the name, is the identity.
 */
export interface SettingMeta {
  index: number;
  name: string;
  kind: SettingKind;
  /** `_cmd.get_setting_level(index)` — never wrapped in `pymol.setting`. */
  level: SettingLevel;
  /** Scopes this level may legally be written at.  Anything else is a no-op. */
  scopes: readonly SettingScope[];
  /**
   * From `packages/engine/layer1/SettingInfo.h`, parsed and validated against the live table;
   * absent when the header is not next to the bridge.  There is NO C accessor
   * for this (`feature-parity.md` area 5) and none was invented.
   */
  default?: SettingValue;
  /**
   * A HINT, never a limit.  PyMOL clamps only `int` settings and only for
   * global writes (`packages/engine/layer1/Setting.cpp:1890-1911`); exactly 30 records declare
   * a range and the two float ones are never enforced at all.  The client
   * therefore ships UNCLAMPED inputs and shows the range as text.
   */
  min?: number;
  max?: number;
  /** `packages/engine/data/setting_help.csv` — 697 named rows, and this is its first consumer. */
  help?: string;
}

/** Provenance of the catalogue, so the UI can say what it does not know. */
export interface SettingCatalogueMeta {
  cSettingInit: number;
  indexDictSize: number;
  nameListSize: number;
  /** Repo-relative path, or null when defaults/ranges are unavailable. */
  defaultsSource: string | null;
  defaultsNote: string;
  minMaxEnforced: false;
  minMaxNote: string;
  helpSource: string | null;
  helpRows: number;
}

/** Every setting the build knows, plus aliases, counts, and provenance. */
export interface SettingCatalogue {
  version: number;
  count: number;
  settings: readonly SettingMeta[];
  /** `ray_shadows -> ray_shadow`'s index; injected after the name snapshot. */
  aliases: Readonly<Record<string, number>>;
  counts: Readonly<Record<string, number>>;
  levelCounts: Readonly<Record<string, number>>;
  meta: SettingCatalogueMeta;
}

/* ------------------------------------------------------------------ *
 * Values
 * ------------------------------------------------------------------ */

/** `[index, value, text]` — text is `cmd.get`'s rendering. */
export type SettingValueRow = readonly [number, SettingValue, string];

/** `cmd.get`'s values for a batch of indices in one object/state scope. */
export interface SettingValuesReply {
  /** '' for the global scope. */
  object: string;
  state: number;
  values: readonly SettingValueRow[];
  /** Indices the backend refused (unknown name, object lacks state, ...). */
  failed: readonly number[];
}

/** `cmd.get_object_settings` -> the overrides an object genuinely carries. */
export type ObjectOverrideRow = readonly [number, SettingKind, SettingValue];

/** Where a value comes from: the object/state overrides and per-atom settings in scope. */
export interface SettingScopeReply {
  object: string;
  state: number;
  objectSettings: readonly ObjectOverrideRow[];
  atoms: readonly { model: string; index: number; settings: readonly number[] }[];
  /** Present only when a selection was given; see `SettingBondsReply`. */
  bonds?: readonly SettingBondRow[];
  truncated: boolean;
  error?: string;
}

/* ------------------------------------------------------------------ *
 * Bond level — the six settings `cmd.set` silently cannot reach
 * ------------------------------------------------------------------ */

/**
 * `cmd.set` over a selection of atoms "will appear to take, but no change will
 * be observed" for a bond-level setting (`packages/engine/modules/pymol/setting.py:245-248`).
 * `cmd.set_bond` / `cmd.unset_bond` / `cmd.get_bond` are the only working path,
 * so the client must know which six names those are and route them.
 */
export const BOND_LEVEL_SETTINGS = [
  'valence',
  'line_width',
  'line_color',
  'stick_radius',
  'stick_color',
  'stick_transparency',
] as const;

/** One bond that actually carries an override (`get_bond` skips `None`). */
export interface SettingBondRow {
  index: number;
  model: string;
  /** The two atom indices `cmd.get_bond` reported, in its order. */
  atoms: readonly [number, number];
  value: SettingValue;
}

/** `cmd.get_bond`'s reply: the bond-level overrides carried over a selection. */
export interface SettingBondsReply {
  selection: string;
  state: number;
  /** Indices actually queried — the six above, resolved on the backend. */
  settings: readonly number[];
  bonds: readonly SettingBondRow[];
  truncated: boolean;
  error?: string;
}

/* ------------------------------------------------------------------ *
 * Change notification
 * ------------------------------------------------------------------ */

/**
 * The bridge's cursor-addressed view of `cmd.get_setting_updates()`.
 *
 * The status thread is the drain's only consumer; this is a TAP on what it
 * received, so reading it slowly loses nothing.  `full` means "a batch the size
 * of a session load arrived" — refetch everything rather than trusting a diff.
 */
export interface SettingDrainReply {
  cursor: number;
  indices: readonly number[];
  batches: number;
  full: boolean;
  /** The tap's ring wrapped past this caller's cursor: treat as `full`. */
  lost: boolean;
  observing: boolean;
}

/** The backend settings module's self-report: installed, cursor, and call counts. */
export interface SettingServiceStatus {
  installed: boolean;
  cursor: number;
  calls: number;
  recorded: number;
  catalogueBuilt: boolean;
  module: string;
}

/* ------------------------------------------------------------------ *
 * The topic payload (the barrel's one requirement)
 * ------------------------------------------------------------------ */

/** One pushed setting change: index, name, value, and its rendered text. */
export interface SettingChange {
  /** Setting index, e.g. 254 = scenes_changed (`packages/engine/layer1/SettingInfo.h:339`). */
  index: number;
  /** Setting name, e.g. 'scenes_changed'. */
  name: string;
  kind: SettingKind;
  value: SettingValue;
  /** `cmd.get_setting_text(...)` rendering (`setting.py:435-438`). */
  text: string;
  /**
   * Object name when this change came from the per-object channel; absent for
   * global settings.
   */
  object?: string;
  /** `_cmd.get_setting_level` (`packages/engine/layer4/Cmd.cpp:6494`) — no C++ needed (§A9). */
  level?: string;
}

/**
 * PUSHED, at last. For four waves this topic accepted a subscription and
 * nothing anywhere published to it, so the client polled the cursor-addressed
 * tap (`setting.tenmol_settings_drain`) at 5 Hz instead — lossless, and 200 ms
 * late. `BridgeServer._on_status` now publishes: the status thread collects the
 * indices `cmd.get_setting_updates()` gave it (still the process's ONE drain)
 * and hands them to the engine thread to enrich, because reading a value is
 * `cmd.get_setting_tuple`, which takes `lock_api` and would stall the status
 * thread for the whole of a `cmd.ray()`.
 */
export interface SettingsPayload {
  /**
   * Map key is the setting index rendered as a decimal string, because JSON
   * object keys are always strings.
   *
   * EMPTY when `full` is true: 798 enriched rows per client per session load,
   * to say something the client answers by refetching, is the wrong payload.
   */
  changed: Record<string, SettingChange>;
  /**
   * True when this is a full resync rather than a diff. A session load produces
   * `len(get_setting_updates()) == 798` — a usable full-resync signal (§1.5).
   */
  full?: boolean;
  /**
   * Every index in this batch, enriched or not. Present on both shapes, so a
   * consumer that only needs "did X change?" never has to care which one it
   * got.
   */
  indices?: readonly number[];
  /** Indices the backend could not read (unknown, or no such object/state). */
  failed?: readonly number[];
}
