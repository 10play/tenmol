/**
 * A per-story session that seeds the Movie panel with a realistic, POPULATED
 * movie — a 90-frame program with a camera key-frame track, two object tracks
 * and a couple of pinned scenes — so the transport, seek bar and timeline render
 * like a working session instead of the empty "no movie" shell
 * {@link withPanelData} produces.
 *
 * The panel bootstraps by reading two aggregate endpoints the moment it mounts:
 * {@link useMovie} runs the silent `cmd.do` import probe, polls
 * `cmd.get_movie_status` (10 Hz) and fetches `cmd.get_movie_panel` on mount +
 * after writes. It also asks `cmd.get_scene_panel` for the scene list and
 * `cmd.count_states` when a motion menu opens. This decorator answers all of
 * them with a fixed, believable snapshot so the timeline canvas draws real
 * key-frame bars, scene pins and a playhead, and the clock reads a defined
 * movie ("frame 24/90 · state 24 · 30 fps").
 *
 * Not a `*.stories.tsx` file, so Storybook does not index it as a story.
 */

import type { Decorator } from '@storybook/react-vite';
import { SessionContext, type Session } from '@web/app';
import type { MovieCell, MovieRow, SpecLevel } from '@tenmol/protocol/topics/movie';

import { mockSession } from '../../.storybook/decorators';

/**
 * `CViewElem::specification_level` values, inlined from `@tenmol/protocol`. The
 * storybook stories dir cannot resolve the protocol package at runtime (only
 * `@tenmol/stores` and the `@web` alias are on its path), so importing these as
 * runtime values would break the story module fetch — see `panelData.tsx`,
 * which inlines `WIZARD_PROBE_RPC` for the same reason. Types are erased, so the
 * `import type` above is safe.
 */
const SPEC_NONE: SpecLevel = 0;
const SPEC_INTERPOLATED: SpecLevel = 1;
const SPEC_KEY: SpecLevel = 2;

/** The movie is 90 frames long — three seconds at 30 fps. */
const NFRAMES = 90;

/**
 * Build a per-frame spec array: `SPEC_KEY` at each listed key frame,
 * `SPEC_INTERPOLATED` for every frame strictly between two keys, `SPEC_NONE`
 * outside the outermost pair. This is exactly the shape `ViewElemDraw` renders —
 * a thin centre bar between keys, a full block on a key.
 */
function track(keys0: readonly number[]): SpecLevel[] {
  const spec: SpecLevel[] = new Array(NFRAMES).fill(SPEC_NONE);
  const keys = [...keys0].sort((a, b) => a - b);
  for (const k of keys) spec[k] = SPEC_KEY;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const lo = keys[i]!;
    const hi = keys[i + 1]!;
    for (let f = lo + 1; f < hi; f += 1) spec[f] = SPEC_INTERPOLATED;
  }
  return spec;
}

/** Pin a scene name at a 0-based frame; the rest of the row is null. */
function pins(entries: ReadonlyArray<[number, string]>): (string | null)[] {
  const row: (string | null)[] = new Array(NFRAMES).fill(null);
  for (const [frame, name] of entries) row[frame] = name;
  return row;
}

/** The camera row plus two object tracks — `ExecutiveMotionDraw`'s row order. */
const ROWS: MovieRow[] = [
  {
    object: '',
    label: 'camera',
    spec: track([0, 30, 60, 89]),
    scenes: pins([
      [0, 'overview'],
      [30, 'active-site'],
      [60, 'surface'],
    ]),
  },
  {
    object: 'ras',
    label: 'ras',
    spec: track([0, 45, 89]),
    scenes: pins([]),
  },
  {
    object: 'gtp',
    label: 'gtp',
    spec: track([15, 45, 75]),
    scenes: pins([]),
  },
];

/** A believable frame→state table: the `mset` ramp `1 x30 1 -30 30`. */
const CELLS: MovieCell[] = Array.from({ length: NFRAMES }, (_, i) => {
  const frame = i + 1;
  const camSpec = ROWS[0]!.spec[i] ?? SPEC_NONE;
  const scene = ROWS[0]!.scenes[i] ?? null;
  const command = i === 0 ? 'turn y, 4' : i === 30 ? 'turn x, 3' : '';
  return {
    frame,
    state: 1,
    command,
    spec: camSpec,
    scene,
    stateKey: camSpec === SPEC_KEY ? 1 : null,
  };
});

const MOVIE_PANEL = {
  nframes: NFRAMES,
  cells: CELLS,
  rows: ROWS,
  visible: true,
  rowHeight: 16,
  height: 16 * ROWS.length,
  matrix: false,
  motions: ROWS.length,
  presentation: false,
  label: 'camera',
  labelIndent: 64,
  panelActive: false,
  panelHeight: 0,
};

const MOVIE_STATUS = {
  frame: 24,
  state: 24,
  nframes: NFRAMES,
  length: NFRAMES,
  playing: false,
  locked: false,
  rocking: false,
  fps: 30,
  sceneCurrent: 'active-site',
  settings: {
    movie_fps: 30,
    movie_delay: 0,
    movie_loop: true,
    movie_auto_interpolate: true,
    movie_auto_store: true,
    movie_panel: true,
    movie_panel_row_height: 16,
    movie_quality: 90,
    draw_frames: false,
    ray_trace_frames: false,
    cache_frames: true,
    static_singletons: true,
    all_states: false,
    sweep_mode: 0,
    sweep_angle: 30,
    sweep_speed: 0.75,
    sweep_phase: 0,
    rock_delay: 3.0,
    rock: false,
    scene_buttons: true,
    scene_loop: true,
    scene_animation: 1,
    scene_animation_duration: 2.0,
    scene_frame_mode: -1,
    scene_current_name: 'active-site',
    presentation: false,
    seq_view: false,
    text: false,
  },
};

const SCENE_ORDER = ['overview', 'active-site', 'surface'];

const SCENE_PANEL = {
  order: SCENE_ORDER,
  current: 'active-site',
  scenes: SCENE_ORDER.map((name) => ({
    name,
    message: '',
    storemask: 0,
    stores: ['view', 'color', 'rep'],
    current: name === 'active-site',
  })),
};

/** Answer one bridge `cmd.*` call with seeded movie data. */
function seededCall(fn: string): unknown {
  switch (fn) {
    case 'cmd.do':
      return null;
    case 'cmd.get_movie_status':
      return MOVIE_STATUS;
    case 'cmd.get_movie_panel':
      return MOVIE_PANEL;
    case 'cmd.get_scene_panel':
      return SCENE_PANEL;
    case 'cmd.get_scene_list':
      return SCENE_ORDER;
    case 'cmd.count_states':
      return 1;
    default:
      return null;
  }
}

/** Wrap a story in a session pre-loaded with a defined 90-frame movie. */
export const withMovieData: Decorator = (Story) => {
  const base = mockSession();
  const session: Session = {
    ...base,
    call: ((fn: string) => Promise.resolve(seededCall(fn))) as Session['call'],
  } as Session;
  return (
    <SessionContext.Provider value={session}>
      <Story />
    </SessionContext.Provider>
  );
};
