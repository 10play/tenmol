/**
 * @tenmol/protocol — topics and their event payloads.
 *
 * v1 topic set is CLOSED. Adding a topic is a protocol change: bump
 * PROTOCOL_VERSION in ./messages.ts and change the bridge in the same commit.
 *
 * Every payload below is produced by the bridge pump on the single PyMOL
 * thread. Two of them are genuine *drains* — reading them clears the queue
 * (`cmd._get_feedback()` at modules/pymol/internal.py:593-606,
 * `cmd.get_setting_updates()` at modules/pymol/setting.py:440-447) — which is
 * why the bridge must be their sole consumer.
 */

import type { RepId, RepInvalidationLevel } from './geometry';

/** The complete v1 topic set. */
export const TOPICS = [
  'objects',
  'view',
  'frame',
  'selection',
  'settings',
  'feedback',
  'geometry',
] as const;

export type Topic = (typeof TOPICS)[number];

const TOPIC_SET: ReadonlySet<string> = new Set<string>(TOPICS);

export function isTopic(v: unknown): v is Topic {
  return typeof v === 'string' && TOPIC_SET.has(v);
}

/* ------------------------------------------------------------------ *
 * `objects`
 * ------------------------------------------------------------------ */

/**
 * `cmd.get_type(name)` strings — `layer3/Executive.cpp` object type names as
 * surfaced by `cmd.get_type` (`modules/pymol/querying.py`). Left open-ended
 * because new object types are added upstream.
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

/** One row of the object panel (the Qt "names list"). */
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
}

export interface ObjectsPayload {
  objects: ObjectRow[];
}

/* ------------------------------------------------------------------ *
 * `view`
 * ------------------------------------------------------------------ */

/**
 * The 18 floats of `cmd.get_view()` (`modules/pymol/viewing.py:634`,
 * layout documented at `:660-676`):
 *   0-8   column-major 3x3 model->camera rotation
 *   9-11  origin of rotation relative to camera (camera space)
 *   12-14 origin of rotation (model space)
 *   15    front plane distance from camera
 *   16    rear plane distance from camera
 *   17    orthoscopic flag (+/-) and field of view when abs(value) > 1
 */
export type ViewMatrix = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export const VIEW_MATRIX_LENGTH = 18;

export function isViewMatrix(v: unknown): v is ViewMatrix {
  return (
    Array.isArray(v) && v.length === VIEW_MATRIX_LENGTH && v.every((n) => typeof n === 'number')
  );
}

export interface ViewPayload {
  view: ViewMatrix;
}

/* ------------------------------------------------------------------ *
 * `frame`
 * ------------------------------------------------------------------ */

/**
 * `cmd.get_frame()` / `cmd.get_state()` / `cmd.count_frames()` /
 * `cmd.get_movie_playing()`. Frames and states are 1-based in PyMOL.
 */
export interface FramePayload {
  frame: number;
  state: number;
  nframes: number;
  playing: boolean;
}

/* ------------------------------------------------------------------ *
 * `selection`
 * ------------------------------------------------------------------ */

/** `cmd.get_names('selections')` plus a per-selection `cmd.count_atoms`. */
export interface SelectionPayload {
  names: string[];
  /** selection name -> atom count. */
  counts: Record<string, number>;
}

/* ------------------------------------------------------------------ *
 * `settings`
 * ------------------------------------------------------------------ */

/** Setting value kind, matching PyMOL's setting type ladder. */
export type SettingKind = 'boolean' | 'int' | 'float' | 'float3' | 'color' | 'string';

export interface SettingChange {
  /** Setting index, e.g. 254 = scenes_changed (`layer1/SettingInfo.h:339`). */
  index: number;
  /** Setting name, e.g. 'scenes_changed'. */
  name: string;
  kind: SettingKind;
  /** Typed value: boolean/number/[r,g,b]/string. */
  value: boolean | number | readonly number[] | string;
  /** `cmd.get_setting_text(...)` rendering (setting.py:435-438). */
  text: string;
}

/**
 * Drained from `cmd.get_setting_updates()` (setting.py:440-447), which returns
 * *indices* and clears the queue; the bridge enriches each index.
 *
 * NOTE: the map key is the setting index rendered as a decimal string, because
 * JSON object keys are always strings.
 */
export interface SettingsPayload {
  changed: Record<string, SettingChange>;
}

/* ------------------------------------------------------------------ *
 * `feedback`
 * ------------------------------------------------------------------ */

/**
 * Same shape as the top-level `{t:'feedback'}` frame. Append-only: these lines
 * are never coalesced or dropped, because reading the queue destroys it.
 */
export interface FeedbackPayload {
  lines: string[];
}

/* ------------------------------------------------------------------ *
 * `geometry`
 * ------------------------------------------------------------------ */

/**
 * Invalidation notice: "rep R of object O in state S changed at level L; pull
 * it again". The geometry itself arrives out of band as a binary frame
 * (./geometry.ts), never inside this JSON event.
 *
 * `level` is PyMOL's `cRepInv_t` ladder (`layer1/Rep.h:133-184`);
 * `cRepInvColor` (15) means colours only, `cRepInvRep` (35) / `cRepInvAll`
 * (100) mean rebuild everything.
 */
export interface GeometryInvalidation {
  object: string;
  state: number;
  rep: RepId;
  level: RepInvalidationLevel;
}

export type GeometryPayload = GeometryInvalidation;

/* ------------------------------------------------------------------ *
 * Topic -> payload map
 * ------------------------------------------------------------------ */

export interface TopicPayloads {
  objects: ObjectsPayload;
  view: ViewPayload;
  frame: FramePayload;
  selection: SelectionPayload;
  settings: SettingsPayload;
  feedback: FeedbackPayload;
  geometry: GeometryPayload;
}

/** Payload type for a given topic. */
export type PayloadFor<T extends Topic> = TopicPayloads[T];
