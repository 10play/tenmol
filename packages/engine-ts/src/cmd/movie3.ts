/**
 * The `cmd.movie.*` namespace — ported from `modules/pymol/movie.py`.
 *
 * `movie.py` is pure orchestration: every function is composed out of the
 * top-level movie verbs (`mset`, `madd`, `mview`, `mdo`, `frame`, `turn`,
 * `scene`, `set`, `count_states`, `count_frames`, …) which are ALREADY ported
 * elsewhere in the engine (`cmd/system.ts`, `cmd/movie2.ts`, `engine.ts`). This
 * module therefore adds no new state of its own; each `movie.<name>` handler is
 * a faithful translation of the corresponding Python body, invoking those
 * lower-level verbs through {@link RegistrarCtx.call} exactly as `movie.py`
 * calls `cmd.mset(...)` / `cmd.mview(...)`.
 *
 * PORTING NOTES / LIMITS (why some verbs are only partially faithful):
 *  - The engine's `mset` (cmd/system.ts) honours PyMOL's 1-based `start` frame
 *    (splicing the spec in at `start` — truncate + append, per C
 *    `MovieAppendSequence`), so the `add_*` verbs, whose Python default is
 *    `start = get_movie_length() + 1`, genuinely append to the timeline. The
 *    `freeze` flag is a no-op here (no auto-interpolate side effect to suppress).
 *    The keyframe (`mview`) side effects are fully faithful.
 *  - The camera-loop verbs (`roll`, `rock`, `tdroll`, `zoom`, `screw`,
 *    `nutate`) drive per-frame motion through `mdo`, which is a documented
 *    no-op in the browser engine (cmd/extras.ts — the frame-table command store
 *    is not modelled). They are ported verb-for-verb but are inert in-engine;
 *    the key-frame-based `add_*` counterparts are the ones that produce
 *    observable interpolation. With their default `last=-1` (→ `count_frames()`
 *    → 0) these loops execute zero iterations, so they are safe to call.
 *  - `produce` / `find_exe` shell out to ffmpeg/ImageMagick and touch the
 *    filesystem, which the browser engine cannot do. `find_exe` faithfully
 *    reports "not found" (null); `produce` performs the in-engine part
 *    (resolve the frame range, enable opaque background for PNG frames) and
 *    treats the render+encode as a no-op — see the comment there.
 *  - `load` globs a directory of files off disk; there is no filesystem here,
 *    so it is a documented no-op.
 *
 * None of the composed verbs are `NotPorted` (mdo/mpng/scene are registered
 * no-ops), so no `NotPorted`-swallowing try/catch is required.
 */
import type { Json } from '@tenmol/protocol';
import type { RegistrarCtx } from './registrar';

/* ------------------------------ arg helpers ------------------------------ */

/** Positional arg `i`, falling back to the named kwarg (mirrors movie2.ts). */
function pick(args: unknown[], kwargs: Record<string, unknown>, i: number, name: string): unknown {
  const a = args[i];
  if (a !== undefined && a !== null && a !== '') return a;
  return kwargs[name];
}

/** Coerce to a finite number, or `dflt` when absent/unparseable. */
function num(v: unknown, dflt: number): number {
  if (v === undefined || v === null || v === '') return dflt;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : dflt;
}

/** Python `int(...)`: truncate toward zero (matches movie.py's `int()`). */
function intOf(v: unknown, dflt: number): number {
  return Math.trunc(num(v, dflt));
}

/* -------------------------------- registrar ------------------------------- */

export function registerMovieNs(ctx: RegistrarCtx): void {
  /** `movie.get_movie_fps` used internally throughout movie.py. */
  const fps = (): number => {
    const r = ctx.executive.getSettingFloat('movie_fps');
    return r <= 0 ? 30 : r;
  };

  // Small typed shims over the composed verbs, so the ports below read like the
  // Python (`cmd.mset(...)`, `cmd.turn(...)`, `cmd.mview("store", ...)`).
  const mset = (spec: string, start = 1, kwargs: Record<string, unknown> = {}): void => {
    // `start` is the 1-based frame to write at (PyMOL `mset` default frame=1,
    // i.e. rebuild from the beginning). The engine's `mset` honours it, splicing
    // the spec in at `start` instead of always replacing — that is what lets the
    // add_* generators append (they pass start=get_movie_length()+1). `freeze`
    // is passed via kwargs for fidelity (no auto-interpolate side effect here).
    ctx.call('mset', [spec, start], kwargs);
  };
  const turn = (axis: string, angle: number): void => {
    ctx.call('turn', [axis, angle]);
  };
  const mview = (
    action: string,
    ...rest: [frame?: number, kwargs?: Record<string, unknown>]
  ): void => {
    const [frame, kwargs] = rest;
    if (frame === undefined) ctx.call('mview', [action]);
    else ctx.call('mview', [action, frame], kwargs ?? {});
  };
  const countStates = (): number => num(ctx.call('count_states', ['all']), 1);
  const countFrames = (): number => num(ctx.call('count_frames'), 0);
  const movieLength = (): number => num(ctx.call('get_movie_length'), 0);

  /* ------------------------------------------------------------------ */
  /* get_movie_fps                                                       */
  /* ------------------------------------------------------------------ */

  // Report the real `movie_fps` setting; PyMOL's floor of 30 fps for a
  // non-positive value.
  ctx.command('movie.get_movie_fps', (): Json => fps());

  /* ------------------------------------------------------------------ */
  /* file / executable helpers (no filesystem or subprocess in-engine)   */
  /* ------------------------------------------------------------------ */

  // find_exe(exe) -> full path to an executable, or None. The browser engine
  // has no PATH/filesystem, so every lookup faithfully fails.
  ctx.command('movie.find_exe', (): Json => null);

  // load(pattern, nam='mov') — glob a directory of files and load them as movie
  // states. No filesystem here, so this is a documented no-op (the top-level
  // `load` verb is likewise a no-op).
  ctx.command('movie.load', (): Json => null);

  // produce(filename, mode, first, last, ...) — export the movie to a video
  // file. Encoding requires ffmpeg/ImageMagick and temp files on disk, none of
  // which exist in the browser. We still perform the in-engine part: resolve the
  // frame range and (for a PNG-frame pipeline) enable opaque_background, exactly
  // as movie.py does before it renders. The `mpng` render and the ffmpeg/convert
  // encode are genuine no-ops here (documented, not a pretend file write).
  ctx.command('movie.produce', (args, kwargs): Json => {
    const filename = ctx.str(pick(args, kwargs, 0, 'filename'), '');
    let first = intOf(pick(args, kwargs, 2, 'first'), 0);
    let last = intOf(pick(args, kwargs, 3, 'last'), 0);
    let quality = intOf(pick(args, kwargs, 6, 'quality'), -1);
    if (quality < 0) quality = intOf(ctx.call('get_setting_int', ['movie_quality']), 90);

    // Split off the extension the way movie.py does; default to .mpg.
    const dot = filename.lastIndexOf('.');
    const ext = (dot >= 0 ? filename.slice(dot) : '').toLowerCase();
    // mpeg containers use mpeg_encode (PPM frames); everything else renders PNG
    // frames and needs an opaque background.
    const pngFrames = ext !== '.mpeg' && ext !== '.mpg';
    if (pngFrames) {
      // `cmd.set('opaque_background')` (enable). We pass an explicit 1 because the
      // engine's set() has no no-value toggle form.
      ctx.call('set', ['opaque_background', 1]);
    }

    // Resolve the export range (as `_encode` would). `count_frames` is 0
    // in-engine, so `last` clamps to 1.
    if (first <= 0) first = 1;
    if (last <= 0) last = countFrames();
    if (last <= 1) last = 1;
    void first;
    void last;

    // The actual per-frame render (mpng) and the ffmpeg/convert encode are
    // no-ops in-engine (no filesystem, no subprocess). Return null rather than
    // pretend a file was written.
    return null;
  });

  /* ------------------------------------------------------------------ */
  /* mset-string builders (sweep / pause)                                */
  /* ------------------------------------------------------------------ */

  // sweep(pause=0, cycles=1) — play states forward then backward, optionally
  // pausing at each end, repeated `cycles` times.
  ctx.command('movie.sweep', (args, kwargs): Json => {
    const pauseN = intOf(pick(args, kwargs, 0, 'pause'), 0);
    const cycles = intOf(pick(args, kwargs, 1, 'cycles'), 1);
    const nState = countStates();
    const pass =
      pauseN > 0
        ? `1 x${pauseN} 1 -${nState} ${nState} x${pauseN} ${nState} -1`
        : `1 -${nState} ${nState} -1`;
    mset(Array.from({ length: Math.max(0, cycles) }, () => pass).join(' '));
    return null;
  });

  // pause(pause=15, cycles=1) — like sweep but dwelling on the first/last state
  // without a trailing ramp back.
  ctx.command('movie.pause', (args, kwargs): Json => {
    const pauseN = intOf(pick(args, kwargs, 0, 'pause'), 15);
    const cycles = intOf(pick(args, kwargs, 1, 'cycles'), 1);
    const nState = countStates();
    const pass =
      pauseN > 0 ? `1 x${pauseN} 1 -${nState} ${nState} x${pauseN}` : `1 -${nState} ${nState} -1`;
    mset(Array.from({ length: Math.max(0, cycles) }, () => pass).join(' '));
    return null;
  });

  /* ------------------------------------------------------------------ */
  /* mdo camera loops (roll / rock / tdroll / zoom / screw / nutate)      */
  /* ------------------------------------------------------------------ */
  // These assign a per-frame `turn`/`move` command to each movie frame via
  // `mdo`. `mdo` is a no-op in the browser engine (see module note), so they are
  // ported faithfully but produce no observable interpolation.

  const mdo = (frame: number, command: string): void => {
    ctx.call('mdo', [String(frame), command]);
  };

  // roll(first=1, last=-1, loop=1, axis='y') — assign a constant per-frame turn
  // so the object spins one full revolution across the frame range.
  ctx.command('movie.roll', (args, kwargs): Json => {
    const first = intOf(pick(args, kwargs, 0, 'first'), 1);
    let last = intOf(pick(args, kwargs, 1, 'last'), -1);
    const loop = intOf(pick(args, kwargs, 2, 'loop'), 1);
    let axis = ctx.str(pick(args, kwargs, 3, 'axis'), 'y');
    if (last < 0) last = countFrames();
    const n = last - first;
    const step = loop ? (2 * Math.PI) / (n + 1) : (2 * Math.PI) / n;
    let invert = 1;
    if (axis.slice(0, 1) === '-') {
      axis = axis.slice(1);
      invert = -1;
    }
    const deg = invert * ((180 * step) / Math.PI);
    for (let a = 0; a <= n; a++) mdo(first + a, `turn ${axis},${deg.toFixed(3)}`);
    return null;
  });

  // rock(first=1, last=-1, angle=30, phase=0, loop=1, axis='y') — a sinusoidal
  // back-and-forth turn assigned frame by frame.
  ctx.command('movie.rock', (args, kwargs): Json => {
    const first = intOf(pick(args, kwargs, 0, 'first'), 1);
    let last = intOf(pick(args, kwargs, 1, 'last'), -1);
    const angle = num(pick(args, kwargs, 2, 'angle'), 30);
    const phase = num(pick(args, kwargs, 3, 'phase'), 0);
    const axis = ctx.str(pick(args, kwargs, 5, 'axis'), 'y');
    if (last < 0) last = countFrames();
    let nstep = last - first + 1;
    if (nstep < 0) nstep = 1;
    const loop = intOf(pick(args, kwargs, 4, 'loop'), 1);
    const subdiv = loop ? nstep : nstep + 1;
    let angCur = (Math.PI * phase) / 180;
    const angInc = (2 * Math.PI) / subdiv;
    angCur -= angInc;
    for (let a = 0; a < nstep; a++) {
      const prev = (angle * Math.sin(angCur)) / 2;
      angCur += angInc;
      const disp = (angle * Math.sin(angCur)) / 2;
      const diff = disp - prev;
      mdo(first + a, `turn ${axis},${diff.toFixed(3)}`);
    }
    return null;
  });

  // tdroll(first, rangex, rangey, rangez, skip=1) — Byron DeLaBarre's
  // three-dimensional roll: consecutive x, then y, then z sweeps.
  ctx.command('movie.tdroll', (args, kwargs): Json => {
    const first = intOf(pick(args, kwargs, 0, 'first'), 1);
    const ranges = [
      num(pick(args, kwargs, 1, 'rangex'), 0),
      num(pick(args, kwargs, 2, 'rangey'), 0),
      num(pick(args, kwargs, 3, 'rangez'), 0),
    ];
    // `skip` is the per-frame turn step and a loop divisor — a non-positive or
    // NaN value (e.g. `skip=0`) would make `range % skip` NaN and never advance
    // the frame loop, so clamp it to a sane minimum.
    const skipRaw = intOf(pick(args, kwargs, 4, 'skip'), 1);
    const skip = skipRaw > 0 ? skipRaw : 1;
    const axes = ['x', 'y', 'z'];
    let frpos = 1;
    for (let axpos = 0; axpos < 3; axpos++) {
      let range = Math.trunc(ranges[axpos]!);
      if (range) {
        const leftover = range % skip;
        if (leftover) range += leftover;
        let a = 0;
        while (a < range) {
          mdo(first + frpos - 1, `turn ${axes[axpos]},${skip.toFixed(3)}`);
          a += skip;
          frpos += 1;
        }
      }
    }
    return null;
  });

  // zoom(first, last, step=1, loop=1, axis='z') — Peter Haebel's dolly: a
  // per-frame `move` along the axis, reversing at the midpoint when looping.
  ctx.command('movie.zoom', (args, kwargs): Json => {
    const first = intOf(pick(args, kwargs, 0, 'first'), 1);
    const last = intOf(pick(args, kwargs, 1, 'last'), 1);
    const step = intOf(pick(args, kwargs, 2, 'step'), 1);
    const loop = intOf(pick(args, kwargs, 3, 'loop'), 1);
    const axis = ctx.str(pick(args, kwargs, 4, 'axis'), 'z');
    const n = last - first;
    for (let a = 0; a <= n; a++) {
      const s = loop && a > n / 2 ? -step : step;
      mdo(first + a, `move ${axis},${s.toFixed(3)}`);
    }
    return null;
  });

  // nutate(first, last, angle=30, phase=0, loop=1, shift=pi/2) — a circular
  // "wobble" combining x and y turns each frame.
  ctx.command('movie.nutate', (args, kwargs): Json => {
    const first = intOf(pick(args, kwargs, 0, 'first'), 1);
    const last = intOf(pick(args, kwargs, 1, 'last'), 1);
    const angle = num(pick(args, kwargs, 2, 'angle'), 30);
    const phase = num(pick(args, kwargs, 3, 'phase'), 0);
    const shift = num(pick(args, kwargs, 5, 'shift'), Math.PI / 2);
    let nstep = last - first + 1;
    if (nstep < 0) nstep = 1;
    const loop = intOf(pick(args, kwargs, 4, 'loop'), 1);
    const subdiv = loop ? nstep : nstep + 1;
    let angCur = (Math.PI * phase) / 180;
    const angInc = (2 * Math.PI) / subdiv;
    angCur -= angInc;
    for (let a = 0; a < nstep; a++) {
      const lastx = (angle * Math.sin(angCur)) / 2;
      const lasty = (angle * Math.sin(angCur + shift)) / 2;
      angCur += angInc;
      const nextx = (angle * Math.sin(angCur)) / 2;
      const nexty = (angle * Math.sin(angCur + shift)) / 2;
      mdo(
        first + a,
        `turn x,${(-lastx).toFixed(3)};turn y,${(-lasty).toFixed(3)};` +
          `turn y,${nexty.toFixed(3)};turn x,${nextx.toFixed(3)}`,
      );
    }
    return null;
  });

  // screw(first, last, step=1, angle=30, phase=0, loop=1, axis='y') — Peter
  // Haebel's corkscrew: a rock combined with a per-frame dolly along z.
  ctx.command('movie.screw', (args, kwargs): Json => {
    const first = intOf(pick(args, kwargs, 0, 'first'), 1);
    const last = intOf(pick(args, kwargs, 1, 'last'), 1);
    const step = intOf(pick(args, kwargs, 2, 'step'), 1);
    const angle = num(pick(args, kwargs, 3, 'angle'), 30);
    const phase = num(pick(args, kwargs, 4, 'phase'), 0);
    const loop = intOf(pick(args, kwargs, 5, 'loop'), 1);
    const axis = ctx.str(pick(args, kwargs, 6, 'axis'), 'y');
    let nstep = last - first + 1;
    if (nstep < 0) nstep = 1;
    const subdiv = loop ? nstep : nstep + 1;
    let angCur = (Math.PI * phase) / 180;
    const angInc = (2 * Math.PI) / subdiv;
    angCur -= angInc;
    for (let a = 0; a < nstep; a++) {
      const s = loop && a >= nstep / 2 ? -step : step;
      const prev = (angle * Math.sin(angCur)) / 2;
      angCur += angInc;
      const disp = (angle * Math.sin(angCur)) / 2;
      const diff = disp - prev;
      mdo(first + a, `turn ${axis},${diff.toFixed(3)}; move z,${s.toFixed(3)}`);
    }
    return null;
  });

  // timed_roll(period=12, cycles=1, axis='y') — a key-frame roll: build a movie
  // of `period*fps*cycles` frames and store one camera key frame per step, each
  // rotated by a constant increment. Fully observable (uses mset + mview).
  ctx.command('movie.timed_roll', (args, kwargs): Json => {
    const period = num(pick(args, kwargs, 0, 'period'), 12);
    const cycles = intOf(pick(args, kwargs, 1, 'cycles'), 1);
    const axis = ctx.str(pick(args, kwargs, 2, 'axis'), 'y');
    let framesPerSec = fps();
    if (framesPerSec < 1) framesPerSec = 30;
    const framesPerCycle = Math.trunc(period * framesPerSec);
    const total = framesPerCycle * cycles;
    mset(`1 x${total}`);
    const step = (2 * Math.PI) / framesPerCycle;
    const deg = (180 * step) / Math.PI;
    mview('reset');
    ctx.call('rewind');
    let frame = 1;
    for (let cycle = 0; cycle < cycles; cycle++) {
      for (let cnt = 0; cnt < framesPerCycle; cnt++) {
        turn(axis, deg);
        mview('store', frame, { freeze: 1 });
        frame += 1;
      }
    }
    return null;
  });

  /* ------------------------------------------------------------------ */
  /* key-frame builders (add_blank / add_roll / add_rock / …)            */
  /* ------------------------------------------------------------------ */

  /** PyMOL `start` default: end of movie (get_movie_length()+1), else `start`. */
  const resolveStart = (start: number): number => (!start ? movieLength() + 1 : start);

  // add_blank(duration=12, start=0) — append `duration` seconds of empty frames
  // (no key frames).
  ctx.command('movie.add_blank', (args, kwargs): Json => {
    const start = resolveStart(intOf(pick(args, kwargs, 1, 'start'), 0));
    const duration = num(pick(args, kwargs, 0, 'duration'), 12);
    const nFrame = Math.round(fps() * duration);
    if (nFrame > 0) {
      mset(`1 x${nFrame}`, start);
      ctx.call('frame', [start]);
    }
    return null;
  });

  // add_roll(duration=12, loop=1, axis='y', start=0) — append a 360-degree
  // camera rotation built from three (or four, when looping) key frames.
  ctx.command('movie.add_roll', (args, kwargs): Json => {
    const start = resolveStart(intOf(pick(args, kwargs, 3, 'start'), 0));
    const duration = num(pick(args, kwargs, 0, 'duration'), 12);
    const loop = intOf(pick(args, kwargs, 1, 'loop'), 1);
    const axis = ctx.str(pick(args, kwargs, 2, 'axis'), 'y');
    const nFrame = Math.round(fps() * duration);
    if (nFrame > 0) {
      mset(`1 x${nFrame}`, start, { freeze: 1 });
      mview('store', start, { power: 1, freeze: 1 });
      turn(axis, 120);
      mview('store', start + nFrame / 3, { power: 1, freeze: 1 });
      turn(axis, 120);
      mview('store', start + (2 * nFrame) / 3, { power: 1, freeze: 1 });
      if (loop) {
        if (start === 1) {
          mview('interpolate', undefined, { wrap: 1 });
          turn(axis, 120);
          mview('store', start + nFrame - 1, { power: 1, freeze: 1 });
          turn(axis, 120);
        } else {
          const adjustment = 360 / nFrame;
          turn(axis, 120 - adjustment);
          mview('store', start + nFrame - 1, { power: 1, freeze: 1 });
          mview('interpolate');
          turn(axis, adjustment);
        }
      } else {
        turn(axis, 120);
        mview('store', start + nFrame - 1, { power: 1, freeze: 1 });
        mview('interpolate');
      }
      ctx.call('frame', [start]);
      if (intOf(ctx.call('get_setting_int', ['movie_auto_interpolate']), 0)) {
        mview('reinterpolate');
      }
    }
    return null;
  });

  // add_rock(duration=8, angle=30, loop=1, axis='y', start=0) — append a rocking
  // motion built from two key frames straddling the neutral pose.
  ctx.command('movie.add_rock', (args, kwargs): Json => {
    const start = resolveStart(intOf(pick(args, kwargs, 4, 'start'), 0));
    const duration = num(pick(args, kwargs, 0, 'duration'), 8);
    const angle = num(pick(args, kwargs, 1, 'angle'), 30);
    const loop = intOf(pick(args, kwargs, 2, 'loop'), 1);
    const axis = ctx.str(pick(args, kwargs, 3, 'axis'), 'y');
    const nFrame = Math.round(fps() * duration);
    if (nFrame > 0) {
      mset(`1 x${nFrame}`, start, { freeze: 1 });
      turn(axis, angle / 2);
      mview('store', start + nFrame / 4, { power: -1, freeze: 1 });
      turn(axis, -angle);
      mview('store', start + (3 * nFrame) / 4, { power: -1, freeze: 1 });
      if (loop && start === 1) mview('interpolate', undefined, { wrap: 1 });
      else mview('interpolate');
      ctx.call('frame', [start]);
    }
    return null;
  });

  // add_state_sweep(factor=1, pause=2, first=-1, last=-1, loop=1, start=0) —
  // sweep through the object's states forward, holding at each end.
  ctx.command('movie.add_state_sweep', (args, kwargs): Json => {
    const start = resolveStart(intOf(pick(args, kwargs, 5, 'start'), 0));
    const factor = num(pick(args, kwargs, 0, 'factor'), 1);
    const pauseSec = num(pick(args, kwargs, 1, 'pause'), 2);
    const loop = intOf(pick(args, kwargs, 4, 'loop'), 1);
    const f = fps();
    const nState = countStates();
    const duration = 2 * pauseSec + (2 * factor * nState) / f;
    const nFrame = Math.round(f * duration);
    if (nFrame > 0) {
      mset(`1 x${nFrame}`, start, { freeze: 1 });
      mview('store', start, { state: 1, freeze: 1 });
      mview('store', start + (nFrame * pauseSec) / duration, { state: 1, freeze: 1 });
      mview('store', start + nState * factor + (nFrame * pauseSec) / duration - 1, {
        state: nState,
        freeze: 1,
      });
      mview('store', start + nState * factor + (2 * nFrame * pauseSec) / duration, {
        state: nState,
        freeze: 1,
      });
      mview('store', start + nFrame - 1, { state: 1, freeze: 1 });
      if (loop && start === 1) mview('interpolate', undefined, { wrap: 1 });
      else mview('interpolate');
      ctx.call('frame', [start]);
      if (intOf(ctx.call('get_setting_int', ['movie_auto_interpolate']), 0)) {
        mview('reinterpolate');
      }
    }
    return null;
  });

  // add_state_loop(factor=1, pause=2, first=-1, last=-1, loop=1, start=0) —
  // like add_state_sweep but loops first->last without a return sweep.
  ctx.command('movie.add_state_loop', (args, kwargs): Json => {
    const start = resolveStart(intOf(pick(args, kwargs, 5, 'start'), 0));
    const factor = num(pick(args, kwargs, 0, 'factor'), 1);
    const pauseSec = num(pick(args, kwargs, 1, 'pause'), 2);
    const loop = intOf(pick(args, kwargs, 4, 'loop'), 1);
    const f = fps();
    const nState = countStates();
    const duration = pauseSec + (factor * nState) / f;
    const nFrame = Math.round(f * duration);
    if (nFrame > 0) {
      mset(`1 x${nFrame}`, start, { freeze: 1 });
      mview('store', start, { state: 1, freeze: 1 });
      mview('store', start + (nFrame * pauseSec * 0.5) / duration, { state: 1, freeze: 1 });
      mview('store', start + nState * factor + (nFrame * pauseSec * 0.5) / duration, {
        state: nState,
        freeze: 1,
      });
      mview('store', start + nFrame - 1, { state: nState, freeze: 1 });
      if (loop && start === 1) mview('interpolate', undefined, { wrap: 1 });
      else mview('interpolate');
      ctx.call('frame', [start]);
      if (intOf(ctx.call('get_setting_int', ['movie_auto_interpolate']), 0)) {
        mview('reinterpolate');
      }
    }
    return null;
  });

  // add_nutate(duration=8, angle=30, spiral=0, loop=1, offset=0, phase=0,
  // shift=pi/2, start=0) — append a nutating (circular/spiral) camera motion,
  // one key frame per frame.
  ctx.command('movie.add_nutate', (args, kwargs): Json => {
    const start = resolveStart(intOf(pick(args, kwargs, 7, 'start'), 0));
    const duration = num(pick(args, kwargs, 0, 'duration'), 8);
    const angle = num(pick(args, kwargs, 1, 'angle'), 30);
    const spiral = intOf(pick(args, kwargs, 2, 'spiral'), 0);
    const phase = num(pick(args, kwargs, 5, 'phase'), 0);
    const shift = num(pick(args, kwargs, 6, 'shift'), Math.PI / 2);
    const nFrame = Math.round(fps() * duration);
    if (nFrame > 0) {
      mset(`1 x${nFrame}`, start, { freeze: 1 });
      for (let index = 0; index < nFrame; index++) {
        let spAngle: number;
        if (spiral > 0) spAngle = (angle * (index + 1)) / nFrame;
        else if (spiral < 0) spAngle = angle * (1 - (index + 1) / nFrame);
        else spAngle = angle;
        const angCur = (Math.PI * phase) / 180 + (2 * Math.PI * index) / nFrame;
        const xRot = (spAngle * Math.sin(angCur)) / 2;
        const yRot = (spAngle * Math.sin(angCur + shift)) / 2;
        turn('x', xRot);
        turn('y', yRot);
        mview('store', start + index, { freeze: 1 });
        turn('y', -yRot);
        turn('x', -xRot);
      }
    }
    if (intOf(ctx.call('get_setting_int', ['movie_auto_interpolate']), 0)) {
      mview('reinterpolate');
    }
    return null;
  });

  /* ---- add_scenes and its private rock/nutate sub-motions ---- */

  // _rock(mode, axis, first, last, period, pause) — internal: insert a rocking
  // sub-motion between two scene key frames (movie.py `_rock`).
  const _rock = (
    axis: string,
    first: number,
    last: number,
    period: number,
    pause: number,
  ): void => {
    const nFrame = last - first + 1;
    const angle = num(ctx.call('get_setting_float', ['sweep_angle']), 0);
    let frameList: number[];
    if (period * 1.5 < pause) {
      const nCyc = Math.round(pause / period);
      frameList = [];
      for (let cyc = 0; cyc < nCyc; cyc++) {
        frameList.push(first + ((1 + 4 * cyc) * nFrame) / (4 * nCyc));
        frameList.push(first + ((3 + 4 * cyc) * nFrame) / (4 * nCyc));
      }
    } else {
      frameList = [first + nFrame / 4, first + (3 * nFrame) / 4];
    }
    let direction = 0;
    for (const frame of frameList) {
      if (!direction) {
        turn(axis, angle / 2);
        mview('store', frame, { power: -1, freeze: 1 });
        direction = -1;
      } else {
        turn(axis, direction * angle);
        mview('store', frame, { power: -1, freeze: 1 });
        direction = -direction;
      }
    }
    turn(axis, (direction * angle) / 2);
    mview('store', last, { power: -1, freeze: 1 });
    ctx.call('mview', ['interpolate', first, last]);
  };

  // _nutate_sub(start, stop, angle, spiral) — internal: one nutation span of key
  // frames (movie.py `_nutate_sub`).
  const _nutateSub = (
    startFrame: number,
    stopFrame: number,
    angle: number,
    spiral: number,
  ): void => {
    const f = fps();
    const duration = (stopFrame - startFrame) / f;
    const nFrame = Math.round(f * duration);
    const shift = Math.PI / 2;
    for (let index = 0; index < nFrame; index++) {
      let spAngle: number;
      if (spiral > 0) spAngle = (angle * (index + 1)) / nFrame;
      else if (spiral < 0) spAngle = angle * (1 - (index + 1) / nFrame);
      else spAngle = angle;
      const angCur = (2 * Math.PI * index) / nFrame;
      const xRot = (spAngle * Math.sin(angCur)) / 2;
      const yRot = (spAngle * Math.sin(angCur + shift)) / 2;
      turn('x', xRot);
      turn('y', yRot);
      mview('store', startFrame + index, { freeze: 1 });
      turn('y', -yRot);
      turn('x', -xRot);
    }
  };

  // _nutate(first, last, period, pause) — internal: tile nutation spans across a
  // scene (movie.py `_nutate`).
  const _nutate = (first: number, last: number, period: number, pause: number): void => {
    const nFrame = last - first + 1;
    const angle = num(ctx.call('get_setting_float', ['sweep_angle']), 0);
    let frameList: Array<[number, number]>;
    if (period * 1.5 < pause) {
      const nCyc = Math.round(pause / period);
      frameList = [];
      for (let cyc = 0; cyc < nCyc; cyc++) {
        frameList.push([first + (cyc * nFrame) / nCyc, first + ((cyc + 1) * nFrame) / nCyc]);
      }
    } else {
      frameList = [[first, first + nFrame]];
    }
    let spiral = 1;
    for (const [lo, hi] of frameList) {
      _nutateSub(lo, hi, angle, spiral);
      spiral = 0;
    }
  };

  /** Parse the `names` argument: a list, a comma/space string, else the scene list. */
  const parseScenes = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.map((s) => String(s));
    if (typeof v === 'string' && v.trim() !== '') {
      return v
        .replace(/[[\]()'"]/g, '')
        .split(/[,\s]+/)
        .filter(Boolean);
    }
    const list = ctx.call('get_scene_list');
    return Array.isArray(list) ? list.map((s) => String(s)) : [];
  };

  // add_scenes(names=None, pause=8, cut=0, loop=1, rock=-1, period=8,
  // animate=-1, start=0) — append a scene tour with a rock/nutate motion at each
  // scene. Composed from mset + mview(store/interpolate/smooth) + the private
  // rock/nutate helpers above.
  ctx.command('movie.add_scenes', (args, kwargs): Json => {
    const start = resolveStart(intOf(pick(args, kwargs, 7, 'start'), 0));
    let animate = num(pick(args, kwargs, 6, 'animate'), -1);
    const pauseSec = num(pick(args, kwargs, 1, 'pause'), 8);
    const cut = num(pick(args, kwargs, 2, 'cut'), 0);
    const loop = intOf(pick(args, kwargs, 3, 'loop'), 1);
    const rock = intOf(pick(args, kwargs, 4, 'rock'), -1);
    let period = num(pick(args, kwargs, 5, 'period'), 8);
    if (period > pauseSec) period = pauseSec;
    if (animate < 0) animate = num(ctx.call('get', ['scene_animation_duration']), 0);
    const names = parseScenes(pick(args, kwargs, 0, 'names'));
    const nScene = names.length;
    if (nScene === 0) return null; // nothing to tour
    const duration = nScene * (pauseSec + animate);
    const f = fps();
    const nFrame = Math.round(f * duration);
    const actNFrame = !loop ? Math.round(f * (duration - animate)) : nFrame;

    let sweepMode: number;
    if (rock < 0) sweepMode = intOf(ctx.call('get', ['sweep_mode']), 0);
    else if (rock) sweepMode = rock - 1;
    else sweepMode = 0;

    if (nFrame > 0) {
      mset(`1 x${actNFrame}`, start, { freeze: 1 });
      let cnt = 0;
      for (const scene of names) {
        let frame = start + Math.trunc((cnt * nFrame) / nScene);
        mview('store', frame, { scene, freeze: 1 });
        if (rock) {
          ctx.call('mview', ['interpolate'], { cut, wrap: 0 });
          const sweepFirst = frame + 1;
          let sweepLast = start + Math.trunc(pauseSec * f + (cnt * nFrame) / nScene) - 1;
          if (sweepLast > actNFrame) sweepLast = actNFrame;
          const nSweepFrame = sweepLast - sweepFirst + 1;
          if (nSweepFrame > 0) {
            if (sweepMode === 1) _rock('x', sweepFirst, sweepLast, period, pauseSec);
            else if (sweepMode < 3) _rock('y', sweepFirst, sweepLast, period, pauseSec);
            else if (sweepMode === 3) _nutate(sweepFirst, sweepLast, period, pauseSec);
          }
        }
        frame = start + Math.trunc(pauseSec * f + (cnt * nFrame) / nScene);
        if (frame <= actNFrame && sweepMode !== 3) {
          mview('store', frame, { scene, freeze: 1 });
        }
        cnt += 1;
      }
      ctx.call('mview', ['interpolate'], { cut, wrap: loop });
      if (rock) mview('smooth');
      ctx.call('frame', [start]);
    }
    return null;
  });
}
