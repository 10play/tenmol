/**
 * The `system` command subsystem: session lifecycle (`reinitialize`), the
 * virtual/no-op OS shims (`cd`/`pwd`/`ls`/`mem`/`sync`/`splash`/`help`/`api`,
 * `undo`/`redo`/`update`), and the movie/frame basics (`frame`, `forward`,
 * `backward`, `rewind`, `mset`/`madd`/`mappend`, `mclear`, `mplay`/`mstop`/
 * `mtoggle`). Registers its `cmd.*` handlers via the {@link RegistrarCtx}.
 *
 * PORTING NOTES / LIMITS
 * - `get_frame`/`count_frames` are FIXED stubs defined in engine.ts
 *   (`() => 1 / 0`) but are REDEFINED here (this registrar runs after the
 *   builtin, so it wins) to track the live movie. `get_movie_playing` is
 *   likewise REDEFINED here to report the live play flag. The real movie state
 *   lives in this module's single
 *   global {@link movie} (PyMOL keeps one movie per session). The mutating
 *   commands below also return their result (e.g. the resulting frame, the play
 *   flag) to make the state observable — in real PyMOL `frame()`/`mplay()`
 *   return None and you would read `get_frame()`/`get_movie_playing()`.
 * - `reinitialize` resets the objects, selections, camera view and the movie.
 *   PyMOL also resets the settings table and colour table on a full
 *   reinitialize; the Executive keeps those in a PRIVATE map / colour table with
 *   no public reset path, so they are left untouched here (documented limit).
 */
import type { RegistrarCtx } from './registrar';

/**
 * PyMOL's fresh-session camera (identity rotation, perspective fov, camera at
 * distance 50, clip slab 40..100), matching `SceneSetDefaultView`.
 */
const DEFAULT_VIEW: readonly number[] = [
  1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -50, 0, 0, 0, 40, 100, -20,
];

/**
 * The single global movie (PyMOL has exactly one). `frames[i]` is the state
 * (1-based) shown at display frame `i+1`; an empty `frames` means "no movie"
 * and frames map 1:1 onto object states. `current` is the 1-based display
 * frame; `playing` is the play flag.
 */
interface MovieState {
  frames: number[];
  current: number;
  playing: boolean;
  /**
   * Generalized movie commands bound to a frame (PyMOL's `Movie->Cmd`), keyed by
   * the 1-based display frame. Set by `mdo` (overwrite) / `mappend` (append) and
   * replayed whenever that frame is displayed. Cleared by `mset`/`reinitialize`.
   */
  commands: Map<number, string>;
}

const movie: MovieState = { frames: [], current: 1, playing: false, commands: new Map() };

/** Re-entrancy guard so a frame command that itself changes the frame (or calls
 * `refresh`) cannot recurse into its own replay. Mirrors PyMOL running a frame's
 * generalized command exactly once per display update. */
let runningFrameCommand = false;

/**
 * Replay the generalized movie command bound to the current display frame
 * (PyMOL's `MovieDoFrameCommand`). Runs the stored command line through the
 * console (`cmd.do`), so multi-command, `;`-separated text works exactly as a
 * typed line would. A no-op when the frame has no command.
 */
function runFrameCommand(ctx: RegistrarCtx): void {
  if (runningFrameCommand) return;
  const command = movie.commands.get(movie.current);
  if (!command) return;
  runningFrameCommand = true;
  try {
    ctx.call('do', [command]);
  } finally {
    runningFrameCommand = false;
  }
}

/**
 * Parse a PyMOL `mset` frame specification into a list of states (1-based).
 *
 * Grammar (space-separated tokens, evaluated left to right against a running
 * "current state" cursor):
 *   `N`     a plain state -> emit one frame of state N; N becomes current.
 *   `xN`    repeat the last emitted state so its run totals N frames
 *           (e.g. `1 x30` -> thirty frames of state 1).
 *   `-N`    ramp from the current state to N inclusive
 *           (e.g. `1 -10` -> states 1,2,…,10; `15 -1` -> 15,14,…,1).
 */
function parseMovieSpec(spec: string): number[] {
  const out: number[] = [];
  let current = 1;
  for (const tok of spec.trim().split(/\s+/)) {
    if (!tok) continue;
    let m: RegExpMatchArray | null;
    if ((m = tok.match(/^x(\d+)$/i))) {
      // Repeat the last emitted state so its run totals N.
      const n = Number(m[1]);
      if (out.length === 0) {
        for (let i = 0; i < n; i++) out.push(current);
      } else {
        const last = out[out.length - 1]!;
        for (let i = 1; i < n; i++) out.push(last);
      }
    } else if ((m = tok.match(/^-(\d+)$/))) {
      // Ramp from the current state to the target, inclusive of the target.
      const target = Number(m[1]);
      const step = target >= current ? 1 : -1;
      for (let s = current + step; step > 0 ? s <= target : s >= target; s += step) out.push(s);
      current = target;
    } else if ((m = tok.match(/^\d+$/))) {
      current = Number(tok);
      out.push(current);
    }
    // Unrecognised tokens are ignored (PyMOL is likewise lenient).
  }
  return out;
}

/** Highest addressable frame: the movie length, else the first object's states.
 * Never below 1 — there is always a frame 1 to display, even in an empty scene. */
function frameCeiling(ctx: RegistrarCtx): number {
  if (movie.frames.length > 0) return movie.frames.length;
  const nstate = ctx.executive.moleculesInOrder()[0]?.nstate ?? 1;
  return Math.max(1, nstate);
}

/** `count_frames`/`MovieGetLength`: the defined movie length, else the object
 * state count — and 0 for an empty session (no movie, no objects), matching
 * real PyMOL. Distinct from {@link frameCeiling}, which never drops below 1. */
function movieLength(ctx: RegistrarCtx): number {
  if (movie.frames.length > 0) return movie.frames.length;
  const mols = ctx.executive.moleculesInOrder();
  if (mols.length === 0) return 0;
  return Math.max(...mols.map((m) => m.nstate ?? 1));
}

function clampFrame(ctx: RegistrarCtx, n: number): number {
  return Math.max(1, Math.min(Math.trunc(n), frameCeiling(ctx)));
}

export function registerSystem(ctx: RegistrarCtx): void {
  const ex = ctx.executive;

  // A fresh registration is a fresh session: start with an empty movie.
  movie.frames = [];
  movie.current = 1;
  movie.playing = false;
  movie.commands.clear();

  /* ------------------------------ session ------------------------------ */

  // `cmd.reinitialize(what='everything')`. Resets what the public Executive API
  // exposes: objects, selections, camera and the movie. Settings / colour table
  // have no public reset path (see module note) and are left as-is.
  ctx.command('reinitialize', () => {
    ex.delete('all');
    ex.clearEmbedded();
    ex.view.set(DEFAULT_VIEW);
    movie.frames = [];
    movie.current = 1;
    movie.playing = false;
    movie.commands.clear();
    ctx.publish();
    return null;
  });

  /* -------------------- virtual / no-op OS shims ----------------------- */
  // These never touch the real filesystem or process; they answer with the
  // trivial value a fresh session would, so the console/panels stay clean.
  ctx.command('pwd', () => '/');
  ctx.command('cd', () => null);
  ctx.command('ls', () => []);
  ctx.command('dir', () => []);
  ctx.command('mem', () => null);
  ctx.command('sync', () => null);
  ctx.command('splash', () => null);
  ctx.command('help', () => null);
  ctx.command('api', () => null);

  // Undo/redo/update are not ported behaviourally (no edit history / no
  // deferred geometry refresh); they are inert but succeed.
  ctx.command('undo', () => null);
  ctx.command('redo', () => null);
  ctx.command('update', () => null);

  /* --------------------------- movie / frame --------------------------- */

  // `cmd.get_frame()` — the current display frame (1-based). engine.ts installs
  // a fixed `() => 1` stub for the idle/empty session; registered here it tracks
  // the live movie cursor so `frame`/`forward`/`backward`/`rewind` are
  // observable (this registrar runs after the builtin, so it wins).
  ctx.command('get_frame', () => movie.current);

  // `cmd.count_frames()` — the number of frames in the movie. engine.ts installs
  // a fixed `() => 0` builtin; registered here (after the builtin, so it wins) it
  // reports the live movie length. Mirrors PyMOL's `MovieGetLength`: the defined
  // frame count when an `mset` mapping exists, otherwise the object state count.
  ctx.command('count_frames', () => movieLength(ctx));

  // `cmd.get_movie_length(quiet=1, images=-1)` — the number of frames EXPLICITLY
  // defined by `mset`, NOT including implicit molecular states (that is what
  // distinguishes it from `count_frames`). Mirrors C `MovieGetLength`: the raw
  // value is `NFrame` when a movie is defined, else `-NImage` (the cached
  // rendered-image count, always 0 here — no GL/frame cache). The Python wrapper
  // folds that sign into the reported count via `images`: -1 (default) reports
  // `-r` when negative, 0 reports 0 when negative, 1 reports 0 when positive.
  ctx.command('get_movie_length', (_args, kwargs) => {
    let r = movie.frames.length; // NFrame>0 -> NFrame; else -NImage == 0
    const images = Number(kwargs?.images ?? -1);
    if (r < 0) {
      if (images === 0) r = 0;
      else if (images < 0) r = -r;
    }
    if (images === 1 && r > 0) r = 0;
    return r;
  });

  // `cmd.frame(frame)` — set the current display frame (1-based, clamped).
  // Returns the resulting frame (see module note on observability).
  ctx.command('frame', (args) => {
    const n = Number(ctx.str(args[0], '1'));
    movie.current = clampFrame(ctx, Number.isFinite(n) ? n : 1);
    ctx.emitView();
    runFrameCommand(ctx);
    return movie.current;
  });

  ctx.command('forward', () => {
    movie.current = clampFrame(ctx, movie.current + 1);
    ctx.emitView();
    runFrameCommand(ctx);
    return movie.current;
  });

  ctx.command('backward', () => {
    movie.current = clampFrame(ctx, movie.current - 1);
    ctx.emitView();
    runFrameCommand(ctx);
    return movie.current;
  });

  ctx.command('rewind', () => {
    movie.current = 1;
    movie.playing = false;
    ctx.emitView();
    runFrameCommand(ctx);
    return movie.current;
  });

  // `cmd.ending()` — jump to the last movie frame (PyMOL's set_frame mode 6).
  ctx.command('ending', () => {
    movie.current = frameCeiling(ctx);
    movie.playing = false;
    ctx.emitView();
    runFrameCommand(ctx);
    return movie.current;
  });

  // `cmd.middle()` — jump to the middle movie frame (PyMOL's set_frame mode 3).
  // C `SceneSetFrame` computes `newFrame = NFrame / 2` (integer, 0-based), which
  // clamp+1 turns into the 1-based cursor (e.g. a 60-frame movie -> frame 31).
  ctx.command('middle', () => {
    movie.current = clampFrame(ctx, Math.floor(frameCeiling(ctx) / 2) + 1);
    ctx.emitView();
    runFrameCommand(ctx);
    return movie.current;
  });

  // `cmd.mset(specification)` — define the movie frame->state mapping.
  // Returns the number of frames defined.
  ctx.command('mset', (args) => {
    movie.frames = parseMovieSpec(ctx.str(args[0], ''));
    // Redefining the movie clears any existing generalized frame commands
    // (moving.py mdo NOTES: "Redefinition of the movie clears any existing mdo
    // statements") — the C side frees Movie->Cmd when the frame table is rebuilt.
    movie.commands.clear();
    movie.current = clampFrame(ctx, movie.current);
    ctx.publish();
    return movie.frames.length;
  });

  // `cmd.madd(specification)` — extend the movie frame->state mapping in place.
  // Returns the new total. Takes a movie SPEC (like `mset`), not a frame/command.
  const append = (args: unknown[]): number => {
    movie.frames.push(...parseMovieSpec(ctx.str(args[0], '')));
    ctx.publish();
    return movie.frames.length;
  };
  ctx.command('madd', append);

  // Bind a generalized command line to a movie frame. `append=false` overwrites
  // (mdo), `append=true` layers onto the existing text (mappend). Frames outside
  // the defined movie (`1..NFrame`) are ignored: PyMOL's C `MovieSetCommand`
  // guards `frame < NFrame`, and moving.py notes that `mset` must define the
  // movie before `mdo`/`mappend` "will have any effect". Mirrors
  // `_cmd.mdo(frame-1, command, flag)`.
  const bindFrameCommand = (frame: number, command: string, append: boolean): void => {
    if (!Number.isFinite(frame) || frame < 1 || frame > movie.frames.length) return;
    const key = Math.trunc(frame);
    if (append) {
      const prev = movie.commands.get(key);
      // moving.py mappend passes ";"+command, so it concatenates onto the prior
      // text; an empty/absent prior collapses the leading separator away.
      movie.commands.set(key, prev ? `${prev};${command}` : command);
    } else {
      movie.commands.set(key, command);
    }
  };

  // `cmd.mdo(frame, command)` — define (or REPLACE) the generalized command-line
  // operations run whenever `frame` is played. moving.py -> `_cmd.mdo(frame-1,
  // command, 0)`. Returns null, mirroring PyMOL.
  ctx.command('mdo', (args, kwargs) => {
    const frame = Number(ctx.str(args[0] ?? kwargs['frame'], '0'));
    const command = ctx.str(args[1] ?? kwargs['command'], '');
    bindFrameCommand(frame, command, false);
    return null;
  });

  // `cmd.mappend(frame, command)` — associate ADDITIONAL command-line text with a
  // movie frame (the additive counterpart of `mdo`). moving.py implements it as
  // `_cmd.mdo(frame-1, ";"+command, 1)`: it layers generalized movie commands
  // onto an existing frame without extending the movie or changing its length.
  ctx.command('mappend', (args, kwargs) => {
    const frame = Number(ctx.str(args[0] ?? kwargs['frame'], '0'));
    const command = ctx.str(args[1] ?? kwargs['command'], '');
    bindFrameCommand(frame, command, true);
    return null;
  });

  // `cmd.mdelete(count=-1, frame=0, freeze=0, object='', quiet=1)` — remove a run
  // of movie frames (camera views + object motions), shortening the timeline.
  // Ports moving.py `mdelete` -> `_cmd.mmodify(mode=-1, ...)`: resolve the
  // zero-based first frame and the run length exactly as Python does, then splice
  // that run out of the frame->state table.
  ctx.command('mdelete', (args, kwargs) => {
    const toInt = (v: unknown, dflt: number): number => {
      const n = Number(ctx.str(v, String(dflt)));
      return Number.isFinite(n) ? Math.trunc(n) : dflt;
    };
    let count = toInt(args[0] ?? kwargs['count'], -1);
    let frame = toInt(args[1] ?? kwargs['frame'], 0);
    const object = ctx.str(args[3] ?? kwargs['object'], '');
    const curLen = movieLength(ctx);
    if (frame === 0) {
      // 0 means the current frame (get_frame is 1-based).
      frame = movie.current - 1;
    } else if (frame < 0) {
      frame = curLen + 1 + frame;
      if (count > 0 && frame + count > curLen) frame = curLen - count;
    } else {
      frame -= 1;
    }
    if (count < 0) count = 1 + curLen - frame; // negative count -> delete to end
    // An object-restricted delete touches that object's motions, not the global
    // camera/movie frame table; there is no per-object motion model here.
    if (object === '') {
      const start = Math.max(0, Math.min(frame, movie.frames.length));
      const n = Math.max(0, Math.min(count, movie.frames.length - start));
      if (n > 0) {
        movie.frames.splice(start, n);
        movie.current = clampFrame(ctx, movie.current);
        ctx.publish();
      }
    }
    return null;
  });

  // `cmd.minsert(count, frame=0, freeze=0, object='', quiet=1)` — insert a run of
  // blank frames into the movie (camera views + object motions), lengthening the
  // timeline. Ports moving.py `minsert` -> `_cmd.mmodify(mode=1, ...)`: resolve
  // the zero-based insertion point exactly as Python does, then splice `count`
  // frames into the frame->state table before it. A blank frame holds the state
  // shown at the insertion point (or the preceding frame), pausing there.
  ctx.command('minsert', (args, kwargs) => {
    const toInt = (v: unknown, dflt: number): number => {
      const n = Number(ctx.str(v, String(dflt)));
      return Number.isFinite(n) ? Math.trunc(n) : dflt;
    };
    const count = toInt(args[0] ?? kwargs['count'], 0);
    let frame = toInt(args[1] ?? kwargs['frame'], 0);
    const object = ctx.str(args[3] ?? kwargs['object'], '');
    if (frame === 0) {
      // 0 means the current frame (get_frame is 1-based).
      frame = movie.current - 1;
    } else {
      frame -= 1;
    }
    // An object-restricted insert touches that object's motions, not the global
    // camera/movie frame table; there is no per-object motion model here.
    if (object === '' && count > 0) {
      const start = Math.max(0, Math.min(frame, movie.frames.length));
      // Blank frames hold the state at the insertion point, else the frame just
      // before it, else state 1 for an empty movie.
      const hold = movie.frames[start] ?? movie.frames[start - 1] ?? 1;
      movie.frames.splice(start, 0, ...new Array<number>(count).fill(hold));
      movie.current = clampFrame(ctx, movie.current);
      ctx.publish();
    }
    return null;
  });

  // `cmd.mclear` — `MovieClearImages`: free ONLY the cached rendered movie-frame
  // images (the cache built when `cache_frames` is on). It does NOT touch the
  // `mset` frame->state mapping, so `get_movie_length`/`count_frames` are
  // unchanged. This engine has no GL/frame-image cache, so there is nothing to
  // free — `mclear` is inert here (leaving `movie.frames` intact). Returns null.
  ctx.command('mclear', () => null);

  // `cmd.get_movie_playing()` — whether the movie is currently playing back.
  // engine.ts installs a fixed `() => 0` builtin; registered here (after the
  // builtin, so it wins) it reports the live play flag toggled by
  // `mplay`/`mstop`/`mtoggle`. Mirrors PyMOL's `MoviePlaying`.
  ctx.command('get_movie_playing', () => (movie.playing ? 1 : 0));

  // Play flag. `mplay`/`mstop`/`mtoggle` toggle it and also return the resulting
  // flag so the state is observable alongside `get_movie_playing`.
  ctx.command('mplay', () => {
    movie.playing = true;
    return 1;
  });
  ctx.command('mstop', () => {
    movie.playing = false;
    return 0;
  });
  ctx.command('mtoggle', () => {
    movie.playing = !movie.playing;
    return movie.playing ? 1 : 0;
  });
}
