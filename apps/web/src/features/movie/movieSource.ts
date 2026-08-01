/**
 * The movie/scene data source: bootstrap, polling and every write.
 *
 * THE BACKEND IS THE CLOCK. Plan §6 WP-20 measured 1 s of `idle()`+`refresh()`
 * at `movie_fps 30` advancing 28 distinct frames, so playback is PyMOL's; this
 * module only *reads* `get_movie_status()` and renders it. There is no
 * `setInterval` advancing a frame counter anywhere in this feature — a client
 * timer would drift against PyMOL's own within seconds.
 *
 * TWO CADENCES, because the two readouts differ by 4000x in cost (measured in
 * `panels/movie.py`'s docstring):
 *   `get_movie_status()`  0.01 ms  -> polled, 10 Hz while visible
 *   `get_movie_panel()`   up to 41 ms on 64k atoms -> on demand + after writes
 *
 * BOOTSTRAP. `panels/movie.py` binds its getters onto the `cmd` namespace when
 * it is imported, and nothing in the bridge imports it (the panel barrel is
 * frozen and `server.py` belongs to WP-02). So the first thing this source does
 * is a single silent import through `cmd.do`, with `echo=0, log=0` so it never
 * appears in the user's console or their log file. If that fails, everything
 * still works: `fallbackStatus()` composes the same five numbers out of five
 * plain `cmd` calls, and the timeline reports itself unavailable instead of
 * rendering an empty strip that looks like an empty movie.
 */

import type {
  MovieEncoders,
  MovieExportResult,
  MoviePanel,
  MovieProducePlan,
  MovieProduceResult,
  MovieStatus,
  ScenePanelPayload,
  SceneThumbnail,
} from '@tenmol/protocol/topics/movie';

export type CallFn = <T = unknown>(
  fn: string,
  args?: readonly unknown[],
  kwargs?: Readonly<Record<string, unknown>>,
) => Promise<T>;

export const BOOTSTRAP_COMMAND = '/import tenmol_bridge.panels.movie';

export interface MovieSource {
  /** Import `panels/movie.py` into the engine. Idempotent, cached, silent. */
  ensure(): Promise<boolean>;
  status(): Promise<MovieStatus>;
  panel(): Promise<MoviePanel | null>;
  scenes(): Promise<ScenePanelPayload>;
  thumbnail(name: string): Promise<SceneThumbnail | null>;
  encoders(): Promise<MovieEncoders | null>;
  exportPng(prefix: string, options?: Record<string, unknown>): Promise<MovieExportResult | null>;
  /** What `movie.produce` *would* do — encoder, frame names, resolved size. */
  producePlan(filename: string, options?: Record<string, unknown>): Promise<MovieProducePlan | null>;
  /** `movie.produce` with no `APIEnterNotModal` window and a real result. */
  produce(filename: string, options?: Record<string, unknown>): Promise<MovieProduceResult>;
  /** True once `ensure()` has proven the aggregate endpoints exist. */
  readonly ready: boolean;
  readonly lastError: string | null;
}

export function createMovieSource(call: CallFn): MovieSource {
  let ensured: Promise<boolean> | null = null;
  let ready = false;
  let lastError: string | null = null;

  function fail(error: unknown): null {
    lastError = error instanceof Error ? error.message : String(error);
    return null;
  }

  async function ensure(): Promise<boolean> {
    if (!ensured) {
      ensured = (async () => {
        try {
          // `echo=0, log=0`: a bootstrap must not write a line the user did not
          // type into the PyMOL console, and must not end up in their .pml log.
          await call('cmd.do', [BOOTSTRAP_COMMAND], { echo: 0, log: 0 });
          await call('cmd.get_movie_status', []);
          ready = true;
          return true;
        } catch (error) {
          ready = false;
          lastError = error instanceof Error ? error.message : String(error);
          return false;
        }
      })();
    }
    return ensured;
  }

  /** Five plain `cmd` calls, for when the aggregate endpoint is unavailable. */
  async function fallbackStatus(): Promise<MovieStatus> {
    const [frame, state, nframes, playing] = await Promise.all([
      call<number>('cmd.get_frame'),
      call<number>('cmd.get_state'),
      call<number>('cmd.count_frames'),
      call<number>('cmd.get_movie_playing'),
    ]);
    return {
      frame: Number(frame) || 1,
      state: Number(state) || 1,
      nframes: Number(nframes) || 0,
      length: 0,
      playing: Boolean(playing),
      locked: false,
      rocking: false,
      fps: null,
      sceneCurrent: null,
      settings: {} as MovieStatus['settings'],
    };
  }

  return {
    get ready() {
      return ready;
    },
    get lastError() {
      return lastError;
    },
    ensure,

    async status(): Promise<MovieStatus> {
      if (await ensure()) {
        try {
          const value = await call<MovieStatus>('cmd.get_movie_status');
          lastError = null;
          return value;
        } catch (error) {
          fail(error);
        }
      }
      return fallbackStatus();
    },

    async panel(): Promise<MoviePanel | null> {
      if (!(await ensure())) return null;
      try {
        const value = await call<MoviePanel>('cmd.get_movie_panel');
        lastError = null;
        return value;
      } catch (error) {
        return fail(error);
      }
    },

    async scenes(): Promise<ScenePanelPayload> {
      if (await ensure()) {
        try {
          const value = await call<ScenePanelPayload>('cmd.get_scene_panel');
          lastError = null;
          return value;
        } catch (error) {
          fail(error);
        }
      }
      // `cmd.get_scene_list` is `_cmd.get_scene_order` (viewing.py:919) and
      // needs no bridge module; the storemask is what we lose.
      const order = (await call<string[]>('cmd.get_scene_list')) ?? [];
      const current = (await call<string>('cmd.get', ['scene_current_name'])) || null;
      return {
        order,
        current,
        scenes: order.map((name) => ({
          name,
          message: '',
          storemask: null,
          stores: null,
          current: name === current,
        })),
      };
    },

    async thumbnail(name: string): Promise<SceneThumbnail | null> {
      if (!(await ensure())) return null;
      try {
        return await call<SceneThumbnail>('cmd.get_scene_thumbnail_png', [name]);
      } catch (error) {
        return fail(error);
      }
    },

    async encoders(): Promise<MovieEncoders | null> {
      if (!(await ensure())) return null;
      try {
        return await call<MovieEncoders>('cmd.get_movie_encoders');
      } catch (error) {
        return fail(error);
      }
    },

    async exportPng(
      prefix: string,
      options: Record<string, unknown> = {},
    ): Promise<MovieExportResult | null> {
      if (!(await ensure())) return null;
      try {
        return await call<MovieExportResult>('cmd.movie_export_png', [prefix], options);
      } catch (error) {
        return fail(error);
      }
    },

    async producePlan(
      filename: string,
      options: Record<string, unknown> = {},
    ): Promise<MovieProducePlan | null> {
      if (!(await ensure())) return null;
      try {
        return await call<MovieProducePlan>('cmd.get_movie_produce_plan', [filename], options);
      } catch (error) {
        return fail(error);
      }
    },

    /**
     * `cmd.movie_produce` when the bridge module is loaded, `cmd.movie.produce`
     * when it is not.
     *
     * The fallback is NOT equivalent and says so: upstream `produce` hard-codes
     * `mpng(modal=-1)`, and measured over this socket the call right after it
     * raised ` Error: APIEnterNotModal(G)` with `get_modal_draw() == 1`. The
     * bridge endpoint pins `modal=0`, so it returns only once the file exists.
     */
    async produce(
      filename: string,
      options: Record<string, unknown> = {},
    ): Promise<MovieProduceResult> {
      if (await ensure()) {
        return call<MovieProduceResult>('cmd.movie_produce', [filename], options);
      }
      await call('cmd.movie.produce', [filename], options);
      return {
        filename,
        ok: true,
        bytes: 0,
        modal: -1,
      } as MovieProduceResult;
    },
  };
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

/** A UI-issued write, in the shape `session.act()` takes. */
export interface MovieAction {
  fn: string;
  args: readonly unknown[];
  kwargs?: Record<string, unknown>;
  /** What PyMOL's own GUI logs for this gesture (`PLog(..., cPLog_pym)`). */
  echo: string;
  /** True when the write can change the movie program, not just the clock. */
  invalidatesPanel?: boolean;
}

const act = (
  fn: string,
  args: readonly unknown[],
  echo: string,
  extra: Partial<MovieAction> = {},
): MovieAction => ({ fn, args, echo, ...extra });

/**
 * The nine control-bar buttons, with `CControl::release`'s exact semantics
 * (`layer1/Control.cpp:288-380`) including the strings it PLogs.
 */
export const transport = {
  /** Button 0: `SceneSetFrame(G,4,0)` — absolute, with movie command. */
  rewind: () => act('cmd.rewind', [], 'cmd.rewind()'),
  /** Button 1: `SceneSetFrame(G,5,-1)` — relative -1, with movie command. */
  backward: () => act('cmd.backward', [], 'cmd.back()'),
  /**
   * Button 2: stop, and also clear sculpting and rock. Not an alias for
   * `mstop`: `CControl` writes both settings before logging `cmd.mstop()`.
   */
  stop: () => act('cmd.mstop', [], 'cmd.mstop()'),
  play: () => act('cmd.mplay', [], 'cmd.mplay()'),
  toggle: () => act('cmd.mtoggle', [], 'cmd.mtoggle()'),
  /** Button 4: `SceneSetFrame(G,5,1)`. */
  forward: () => act('cmd.forward', [], 'cmd.forward()'),
  /** Button 5: `SceneSetFrame(G,6,0)`, or mode 3 with Ctrl. */
  ending: () => act('cmd.ending', [], 'cmd.ending()'),
  middle: () => act('cmd.middle', [], 'cmd.middle()'),
  /** Button 6. */
  seqView: (on: boolean) => act('cmd.set', ['seq_view', on ? 1 : 0], `cmd.set('seq_view',${on ? 1 : 0})`),
  /** Button 7: `cmd.rock(1)` restarts the sweep timer, `cmd.rock(0)` stops. */
  rock: (mode: 0 | 1) => act('cmd.rock', [mode], `cmd.rock(${mode})`),
  /** Button 8. */
  fullScreen: () => act('cmd.full_screen', [], 'cmd.full_screen()'),

  /** The scrollbar drag: `SceneSetFrame(G,7,v)` == absolute, forced command. */
  seek: (frame: number) => act('cmd.set_frame', [frame, 7], `cmd.set_frame(${frame}, 7)`),
  frame: (frame: number) => act('cmd.frame', [frame], `cmd.frame(${frame})`),
  sculptingOff: () => act('cmd.set', ['sculpting', 0], "cmd.set('sculpting',0)"),
} as const;

/** Movie program edits. All of them can change the frame->state table. */
export const program = {
  mset: (specification: string, frame = 1) =>
    act('cmd.mset', [specification, frame], `cmd.mset("${specification}", ${frame})`, {
      invalidatesPanel: true,
    }),
  madd: (specification: string) =>
    act('cmd.madd', [specification], `cmd.madd("${specification}")`, { invalidatesPanel: true }),
  /**
   * `cmd.mdo(frame, command)` is **1-BASED**, despite the inventory saying
   * "0-based on the wire". `moving.py:317` is `_cmd.mdo(COb, int(frame)-1, ...)`
   * — the 0-based form is the *C* argument, and the Python wrapper we call
   * subtracts the 1 itself. Verified live: `cmd.mdo(2, 'turn x, 5')` lands in
   * `MovieCmdAsPyList[1]`, i.e. movie frame 2.
   */
  mdo: (frame: number, command: string) =>
    act('cmd.mdo', [frame, command], `cmd.mdo(${frame}, "${command}")`, {
      invalidatesPanel: true,
    }),
  mappend: (frame: number, command: string) =>
    act('cmd.mappend', [frame, command], `cmd.mappend(${frame}, "${command}")`, {
      invalidatesPanel: true,
    }),
  mdump: () => act('cmd.mdump', [], 'cmd.mdump()'),
  mclear: () => act('cmd.mclear', [], 'cmd.mclear()'),
  purge: () => act('cmd.mset', [], 'cmd.mset()', { invalidatesPanel: true }),
} as const;

/** `cmd.mview` — the 10 actions of `modules/pymol/moving.py:160`. */
export const MVIEW_ACTIONS = [
  'store',
  'clear',
  'interpolate',
  'reinterpolate',
  'smooth',
  'reset',
  'uninterpolate',
  'toggle',
  'toggle_interp',
  'purge',
] as const;
export type MviewAction = (typeof MVIEW_ACTIONS)[number];

export function mview(
  action: MviewAction,
  kwargs: Record<string, unknown> = {},
): MovieAction {
  const rendered = Object.entries(kwargs)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? `'${value}'` : String(value)}`)
    .join(', ');
  return act('cmd.mview', [action], `cmd.mview('${action}'${rendered ? `, ${rendered}` : ''})`, {
    kwargs,
    invalidatesPanel: true,
  });
}

/**
 * Key-frame range editing. All four funnel into `_cmd.mmodify`
 * (`moving.py:493,545,591,640`); `0` means "current frame" and negatives count
 * back from the end, which is exactly why the frame numbers below are passed
 * through untouched rather than normalised here.
 */
export const range = {
  mmove: (target: number, source = 0, count = -1, object = '') =>
    act('cmd.mmove', [target, source, count], `cmd.mmove(${target},${source},${count})`, {
      kwargs: object ? { object } : {},
      invalidatesPanel: true,
    }),
  mcopy: (target: number, source = 0, count = -1, object = '') =>
    act('cmd.mcopy', [target, source, count], `cmd.mcopy(${target},${source},${count})`, {
      kwargs: object ? { object } : {},
      invalidatesPanel: true,
    }),
  mdelete: (count = -1, frame = 0, object = '') =>
    act('cmd.mdelete', [count, frame], `cmd.mdelete(${count},${frame})`, {
      kwargs: object ? { object } : {},
      invalidatesPanel: true,
    }),
  minsert: (count: number, frame = 0, object = '') =>
    act('cmd.minsert', [count, frame], `cmd.minsert(${count},${frame})`, {
      kwargs: object ? { object } : {},
      invalidatesPanel: true,
    }),
} as const;

/**
 * The five writes the movie PANEL itself issues, byte-identical to the strings
 * `CMovie::release` hands to `PParse`/`PLog` (`layer1/Movie.cpp:1616-1699`).
 *
 * Separate from `range` above on purpose: `range` is the editor form, where an
 * empty object box means "leave the argument off and take PyMOL's default".
 * Here the object argument is never absent — it is `''`, `'same'`, `'none'` or
 * a name, chosen by `objectArgument()` — because the camera row and column mode
 * differ ONLY in that argument, and dropping it turns a camera-row drag into a
 * column drag. No spaces after the commas: that is how the C formats them, and
 * a `.pml` log has to be indistinguishable.
 */
export const panelGesture = {
  mmove: (target: number, source: number, count: number, object: string) =>
    act('cmd.mmove', [target, source, count], `cmd.mmove(${target},${source},${count},object='${object}')`, {
      kwargs: { object },
      invalidatesPanel: true,
    }),
  mcopy: (target: number, source: number, count: number, object: string) =>
    act('cmd.mcopy', [target, source, count], `cmd.mcopy(${target},${source},${count},object='${object}')`, {
      kwargs: { object },
      invalidatesPanel: true,
    }),
  minsert: (count: number, frame: number, object: string) =>
    act('cmd.minsert', [count, frame], `cmd.minsert(${count},${frame},object='${object}')`, {
      kwargs: { object },
      invalidatesPanel: true,
    }),
  mdelete: (count: number, frame: number, object: string) =>
    act('cmd.mdelete', [count, frame], `cmd.mdelete(${count},${frame},object='${object}')`, {
      kwargs: { object },
      invalidatesPanel: true,
    }),
  clear: (first: number, last: number, object: string) =>
    act('cmd.mview', ['clear'], `cmd.mview('clear',first=${first},last=${last},object='${object}')`, {
      kwargs: { first, last, object },
      invalidatesPanel: true,
    }),
  /** Ctrl+Shift wheel (`layer1/Movie.cpp:1561-1564`). */
  rowHeight: (value: number) =>
    act('cmd.set', ['movie_panel_row_height', value], `cmd.set('movie_panel_row_height',${value})`, {
      invalidatesPanel: true,
    }),
} as const;

/** Camera view get/set — the 18-float vector of `viewing.py:634`. */
export const camera = {
  setView: (view: readonly number[], animate = 0) =>
    act('cmd.set_view', [view], `cmd.set_view(<18 floats>, animate=${animate})`, {
      kwargs: { animate },
    }),
  reset: () => act('cmd.reset', [], 'cmd.reset()'),
  zoom: () => act('cmd.zoom', [], 'cmd.zoom(animate=1.0)', { kwargs: { animate: 1.0 } }),
  orient: () => act('cmd.orient', [], 'cmd.orient(animate=1.0)', { kwargs: { animate: 1.0 } }),
  storeNamed: (key: string) => act('cmd.view', [key, 'store'], `cmd.view("${key}", "store")`),
  recallNamed: (key: string, animate = -1) =>
    act('cmd.view', [key, 'recall'], `cmd.view("${key}", "recall")`, { kwargs: { animate } }),
  clearNamed: (key: string) => act('cmd.view', [key, 'clear'], `cmd.view("${key}", "clear")`),
} as const;
