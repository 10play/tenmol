/**
 * Movie / scene aggregate payloads.  OWNER: WP-20.
 *
 * NOT a topic module — `topics/index.ts` is frozen and already carries the
 * three v1 movie topics (`frame`, `scenes`, `movie_panel`), which stay exactly
 * as WP-01 wrote them. This module is the *request/response* half: the shapes
 * returned by the four aggregate endpoints `bridge/tenmol_bridge/panels/movie.py`
 * binds onto the `cmd` namespace. It is reached by its subpath —
 * `import type { ... } from '@tenmol/protocol/topics/movie'` — which
 * `package.json`'s `"./topics/*"` export already resolves.
 *
 * Why aggregates at all: the transport bar needs six numbers and the timeline
 * needs a structure that has NO Python getter in this tree (see the module
 * docstring on the Python side). One call at 0.01 ms beats six round trips,
 * and the timeline's only readout — `get_session()['movie']` — costs 41 ms on
 * a 64k-atom scene, so it must be a *separate*, on-demand call that the poll
 * never touches.
 *
 * Frames and states are **1-based** on this wire, as everywhere in PyMOL's
 * Python API. The 0-based forms (`_cmd.mset`'s state list, `cmd.mdo`'s frame,
 * `CViewElem` indices) never leave the bridge.
 *
 * @notATopic  NOT A TRANSPORT TOPIC — deliberately not re-exported by the
 * frozen `topics/index.ts` barrel. Reached by its subpath
 * (`@tenmol/protocol/topics/movie`); its events, if any, ride an existing
 * topic. `bridge/tests/test_dispatch.py` looks for this tag.
 */

/* ------------------------------------------------------------------ *
 * status — the poll
 * ------------------------------------------------------------------ */

/** Settings the movie/scene UI binds to. Values are `null` if unreadable. */
export interface MovieSettings {
  movie_fps: number | null;
  movie_delay: number | null;
  movie_loop: boolean | null;
  movie_auto_interpolate: boolean | null;
  movie_auto_store: boolean | null;
  movie_panel: boolean | null;
  movie_panel_row_height: number | null;
  movie_quality: number | null;
  draw_frames: boolean | null;
  ray_trace_frames: boolean | null;
  cache_frames: boolean | null;
  static_singletons: boolean | null;
  all_states: boolean | null;
  sweep_mode: number | null;
  sweep_angle: number | null;
  sweep_speed: number | null;
  sweep_phase: number | null;
  rock_delay: number | null;
  rock: boolean | null;
  scene_buttons: boolean | null;
  scene_loop: boolean | null;
  scene_animation: number | null;
  scene_animation_duration: number | null;
  scene_frame_mode: number | null;
  scene_current_name: string | null;
  presentation: boolean | null;
  seq_view: boolean | null;
  text: boolean | null;
}

/** `cmd.get_movie_status()` — measured at 0.01 ms, safe to poll. */
export interface MovieStatus {
  /** 1-based, `cmd.get_frame()`. */
  frame: number;
  /** 1-based, `cmd.get_state()`. */
  state: number;
  /** `cmd.count_frames()`. */
  nframes: number;
  /** `cmd.get_movie_length()` — 0 when no `mset` program is defined. */
  length: number;
  /** `MoviePlaying` (`layer1/Movie.cpp:540`) — false while locked. */
  playing: boolean;
  /** `cmd.get_movie_locked()`. */
  locked: boolean;
  /** `cmd.rock(-2)`, the documented query-only mode. */
  rocking: boolean;
  fps: number | null;
  sceneCurrent: string | null;
  settings: MovieSettings;
}

/* ------------------------------------------------------------------ *
 * timeline — on demand
 * ------------------------------------------------------------------ */

/** `CViewElem::specification_level` (`layer1/View.h:24`). */
export const SPEC_NONE = 0;
export const SPEC_INTERPOLATED = 1;
export const SPEC_KEY = 2;
export type SpecLevel = typeof SPEC_NONE | typeof SPEC_INTERPOLATED | typeof SPEC_KEY;

export interface MovieCell {
  /** 1-based movie frame. */
  frame: number;
  /** 1-based state this frame maps to (`MovieFrameToIndex`). */
  state: number;
  /** The frame's `mdo` command, `''` when none. */
  command: string;
  spec: SpecLevel;
  /** Scene pinned at this frame (`scene_flag` + `scene_name`), else null. */
  scene: string | null;
  /** `state_flag` ? `state` : null — the key frame's own state override. */
  stateKey: number | null;
}

/**
 * One row of `ExecutiveMotionDraw` (`layer3/Executive.cpp:692`).
 * `object === ''` is the camera row (`cExecAll`).
 */
export interface MovieRow {
  object: string;
  spec: SpecLevel[];
  scenes: (string | null)[];
}

export interface MoviePanel {
  nframes: number;
  cells: MovieCell[];
  rows: MovieRow[];
  /** `movie_panel` setting. */
  visible: boolean;
  /** `movie_panel_row_height`. */
  rowHeight: number;
  /** `movie_panel_row_height * rows.length` (`MovieGetPanelHeight`). */
  height: number;
  /** `CMovie::MatrixFlag` — a programmed initial orientation exists. */
  matrix: boolean;
}

/* ------------------------------------------------------------------ *
 * scenes
 * ------------------------------------------------------------------ */

/** `MovieScene::storemask` bit names (`layer3/MovieScene.cpp:207-213`). */
export type SceneStore = 'view' | 'color' | 'active' | 'rep' | 'frame' | 'thumbnail';

export interface SceneRecord {
  name: string;
  /** `cmd.get_scene_message(name)`. */
  message: string;
  /** Raw `storemask`, or null when the session readout was unavailable. */
  storemask: number | null;
  stores: SceneStore[] | null;
  current: boolean;
}

export interface ScenePanelPayload {
  scenes: SceneRecord[];
  current: string | null;
  order: string[];
}

/**
 * `cmd.get_scene_thumbnail_png(name)`.
 *
 * `encoding` is load-bearing. `MovieSceneStore` resizes the thumbnail and then
 * defers the capture (`layer3/MovieScene.cpp:225-232`), so a read before the
 * deferred draw lands returns 220*124*4 = 109,120 raw zero bytes and only
 * afterwards the PNG. `ready === false` means "ask again", not "black image".
 */
export interface SceneThumbnail {
  name: string;
  encoding: 'png' | 'rgba' | 'empty';
  width: number;
  height: number;
  bytes: number;
  ready: boolean;
  /** base64 PNG, only when `ready`. */
  data: string;
}

/* ------------------------------------------------------------------ *
 * export
 * ------------------------------------------------------------------ */

export interface MovieExportResult {
  prefix: string;
  dir: string;
  files: string[];
  written: string[];
  count: number;
}

/** `pymol.movie.find_exe` for each encoder the export form offers. */
export interface MovieEncoders {
  ffmpeg: string | null;
  convert: string | null;
  mpeg_encode: string | null;
}

/* ------------------------------------------------------------------ *
 * mset mini-language (client-side preview only)
 * ------------------------------------------------------------------ */

/**
 * One token of the `mset` specification (`modules/pymol/moving.py:691`).
 *
 * The parser is reproduced client-side ONLY to preview the frame->state table
 * before the user commits; the raw string is always what goes over the wire.
 */
export type MsetToken =
  | { kind: 'state'; state: number }
  | { kind: 'repeat'; total: number }
  | { kind: 'ramp'; to: number };

export interface MsetPreview {
  /** 1-based states, one entry per movie frame. */
  states: number[];
  tokens: MsetToken[];
  error: string | null;
}
