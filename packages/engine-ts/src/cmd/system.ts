/**
 * The `system` command subsystem: session lifecycle (`reinitialize`), the
 * virtual/no-op OS shims (`cd`/`pwd`/`ls`/`mem`/`sync`/`splash`/`help`/`api`,
 * `undo`/`redo`/`update`), and the movie/frame basics (`frame`, `forward`,
 * `backward`, `rewind`, `mset`/`madd`/`mappend`, `mclear`, `mplay`/`mstop`/
 * `mtoggle`). Registers its `cmd.*` handlers via the {@link RegistrarCtx}.
 *
 * PORTING NOTES / LIMITS
 * - `get_frame`, `count_frames`, `get_movie_playing` are FIXED stubs defined in
 *   engine.ts (`() => 1 / 0 / 0`) and are intentionally NOT redefined here. The
 *   real movie state lives in this module's single global {@link movie}
 *   (PyMOL keeps one movie per session). So the mutating commands below return
 *   their result (e.g. the resulting frame, the frame count, the play flag) to
 *   make the state observable — in real PyMOL `frame()`/`mplay()` return None
 *   and you would read `get_frame()`/`get_movie_playing()`; here those getters
 *   are stubs, so returning the value is how a caller (and the tests) observe it.
 * - `reinitialize` resets the objects, selections, camera view and the movie.
 *   PyMOL also resets the settings table and colour table on a full
 *   reinitialize; the Executive keeps those in a PRIVATE map / colour table with
 *   no public reset path, so they are left untouched here (documented limit).
 */
import type { RegistrarCtx } from './registrar';

/** PyMOL's fresh-session camera (identity rotation, perspective fov, dist 40). */
const DEFAULT_VIEW: readonly number[] = [
  1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -40, 0, 0, 0, 20, 60, -20,
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
}

const movie: MovieState = { frames: [], current: 1, playing: false };

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

/** Highest addressable frame: the movie length, else the first object's states. */
function frameCeiling(ctx: RegistrarCtx): number {
  if (movie.frames.length > 0) return movie.frames.length;
  const nstate = ctx.executive.moleculesInOrder()[0]?.nstate ?? 1;
  return Math.max(1, nstate);
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

  /* ------------------------------ session ------------------------------ */

  // `cmd.reinitialize(what='everything')`. Resets what the public Executive API
  // exposes: objects, selections, camera and the movie. Settings / colour table
  // have no public reset path (see module note) and are left as-is.
  ctx.command('reinitialize', () => {
    ex.delete('all');
    ex.view.set(DEFAULT_VIEW);
    movie.frames = [];
    movie.current = 1;
    movie.playing = false;
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

  // `cmd.frame(frame)` — set the current display frame (1-based, clamped).
  // Returns the resulting frame (see module note on observability).
  ctx.command('frame', (args) => {
    const n = Number(ctx.str(args[0], '1'));
    movie.current = clampFrame(ctx, Number.isFinite(n) ? n : 1);
    ctx.emitView();
    return movie.current;
  });

  ctx.command('forward', () => {
    movie.current = clampFrame(ctx, movie.current + 1);
    ctx.emitView();
    return movie.current;
  });

  ctx.command('backward', () => {
    movie.current = clampFrame(ctx, movie.current - 1);
    ctx.emitView();
    return movie.current;
  });

  ctx.command('rewind', () => {
    movie.current = 1;
    movie.playing = false;
    ctx.emitView();
    return movie.current;
  });

  // `cmd.mset(specification)` — define the movie frame->state mapping.
  // Returns the number of frames defined.
  ctx.command('mset', (args) => {
    movie.frames = parseMovieSpec(ctx.str(args[0], ''));
    movie.current = clampFrame(ctx, movie.current);
    ctx.publish();
    return movie.frames.length;
  });

  // `cmd.madd` / `cmd.mappend` — extend the movie. Returns the new total.
  const append = (args: unknown[]): number => {
    movie.frames.push(...parseMovieSpec(ctx.str(args[0], '')));
    ctx.publish();
    return movie.frames.length;
  };
  ctx.command('madd', append);
  ctx.command('mappend', append);

  // `cmd.mclear` — clear the movie (frames only; frame cursor is left).
  ctx.command('mclear', () => {
    movie.frames = [];
    movie.current = clampFrame(ctx, movie.current);
    ctx.publish();
    return null;
  });

  // Play flag. Getter (`get_movie_playing`) is a stub in engine.ts; these return
  // the resulting flag so it is observable.
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
