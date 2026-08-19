/**
 * The `movie2` command subsystem — the camera/morph half of PyMOL's movie
 * machinery (`modules/pymol/movie.py`, `layer1/Movie.cpp`, `layer2/ObjectMap`
 * morphing).
 *
 * Everything here operates on the 18-float camera view exposed by
 * {@link Executive.view} (see `view/view.ts` for the layout) plus a
 * module-local set of movie models kept alive by closures in
 * {@link registerMovie2}:
 *
 *   - a movie-CAMERA model: a sparse map of frame -> stored 18-float view
 *     ("keyframes"), with `get_movie_view(frame)` returning the value obtained
 *     by linearly interpolating position/origin/clip/fov and SLERPing the 3x3
 *     rotation between the two bracketing keyframes;
 *   - a movie-MATRIX model: the same idea for a per-frame 4x4 object matrix
 *     (`mmatrix`);
 *   - a rocking flag with a small sinusoidal `get_rock_angle(frame)`;
 *   - named camera CURVES (`curve_new` / `move_on_curve`);
 *   - `morph`, which builds a fresh multi-state object whose coordinate sets
 *     linearly interpolate between two endpoint conformations.
 *
 * `mpng` / `mdump` do no file IO in the browser port and return null.
 *
 * SLERP is exact against PyMOL's quaternion interpolation for the pure-rotation
 * case; the position/clip/fov channels use straight linear interpolation, which
 * is the `power=1` ("linear") mode of `cmd.mview`.
 */
import type { Json } from '@tenmol/protocol';
import { ObjectMolecule } from '../model/molecule';
import type { View18 } from '../view/view';
import type { RegistrarCtx } from './registrar';

/* ------------------------------ arg helpers ------------------------------ */

/** Positional arg `i`, falling back to the named kwarg. */
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

/** Round to the nearest integer frame index. */
function frameOf(v: unknown, dflt: number): number {
  return Math.round(num(v, dflt));
}

/* ------------------------- 3x3 rotation / quaternion ---------------------- */

type Mat3 = number[]; // column-major, length 9: index = col*3 + row
type Quat = [number, number, number, number]; // (w, x, y, z)

/**
 * Column-major 3x3 rotation -> unit quaternion (Shepperd's method, the
 * numerically stable branch selection PyMOL's `matrix_to_quat` uses). The 3x3
 * is stored column-major, so element (row r, col c) is `m[c*3 + r]`.
 */
function matToQuat(m: Mat3): Quat {
  const r00 = m[0]!, r10 = m[1]!, r20 = m[2]!;
  const r01 = m[3]!, r11 = m[4]!, r21 = m[5]!;
  const r02 = m[6]!, r12 = m[7]!, r22 = m[8]!;
  const trace = r00 + r11 + r22;
  let w: number, x: number, y: number, z: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2; // s = 4w
    w = 0.25 * s;
    x = (r21 - r12) / s;
    y = (r02 - r20) / s;
    z = (r10 - r01) / s;
  } else if (r00 > r11 && r00 > r22) {
    const s = Math.sqrt(1 + r00 - r11 - r22) * 2; // s = 4x
    w = (r21 - r12) / s;
    x = 0.25 * s;
    y = (r01 + r10) / s;
    z = (r02 + r20) / s;
  } else if (r11 > r22) {
    const s = Math.sqrt(1 + r11 - r00 - r22) * 2; // s = 4y
    w = (r02 - r20) / s;
    x = (r01 + r10) / s;
    y = 0.25 * s;
    z = (r12 + r21) / s;
  } else {
    const s = Math.sqrt(1 + r22 - r00 - r11) * 2; // s = 4z
    w = (r10 - r01) / s;
    x = (r02 + r20) / s;
    y = (r12 + r21) / s;
    z = 0.25 * s;
  }
  return normQuat([w, x, y, z]);
}

/** Unit quaternion -> column-major 3x3 rotation. */
function quatToMat(q: Quat): Mat3 {
  const [w, x, y, z] = q;
  const r00 = 1 - 2 * (y * y + z * z);
  const r01 = 2 * (x * y - w * z);
  const r02 = 2 * (x * z + w * y);
  const r10 = 2 * (x * y + w * z);
  const r11 = 1 - 2 * (x * x + z * z);
  const r12 = 2 * (y * z - w * x);
  const r20 = 2 * (x * z - w * y);
  const r21 = 2 * (y * z + w * x);
  const r22 = 1 - 2 * (x * x + y * y);
  // Store column-major: [col0(r0,r1,r2), col1(...), col2(...)].
  return [r00, r10, r20, r01, r11, r21, r02, r12, r22];
}

function normQuat(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Spherical linear interpolation of two unit quaternions (shortest arc). */
function slerp(a: Quat, b: Quat, t: number): Quat {
  const q1 = normQuat(a);
  let q2 = normQuat(b);
  let dot = q1[0] * q2[0] + q1[1] * q2[1] + q1[2] * q2[2] + q1[3] * q2[3];
  // Take the shortest path: a quaternion and its negation are the same rotation.
  if (dot < 0) {
    q2 = [-q2[0], -q2[1], -q2[2], -q2[3]];
    dot = -dot;
  }
  if (dot > 0.9995) {
    // Nearly parallel: fall back to normalised linear interpolation.
    return normQuat([
      q1[0] + (q2[0] - q1[0]) * t,
      q1[1] + (q2[1] - q1[1]) * t,
      q1[2] + (q2[2] - q1[2]) * t,
      q1[3] + (q2[3] - q1[3]) * t,
    ]);
  }
  const theta0 = Math.acos(dot);
  const sin0 = Math.sin(theta0);
  const s1 = Math.sin((1 - t) * theta0) / sin0;
  const s2 = Math.sin(t * theta0) / sin0;
  return [
    q1[0] * s1 + q2[0] * s2,
    q1[1] * s1 + q2[1] * s2,
    q1[2] * s1 + q2[2] * s2,
    q1[3] * s1 + q2[3] * s2,
  ];
}

/**
 * PyMOL's key-frame easing curve (`ViewElemInterpolate`, layer1/View.cpp): map
 * the raw linear fraction `fxn` in [0,1] through the movie `power`/`bias` easing
 * so a stored camera does not simply lerp between key frames but eases in/out.
 *
 * Defaults match cmd.mview with no explicit power/bias: `power = 1.4`,
 * `parabolic = true` (a smooth S-curve), `bias = 1` (symmetric). A NEGATIVE
 * power selects the "circular" easing variant (parabolic = false); |power| is
 * used as the exponent. `bias != 1` skews the curve toward one end.
 */
function easeFraction(fxn: number, power = 1.4, bias = 1): number {
  let parabolic = true;
  if (power < 0) {
    parabolic = false;
    power = -power;
  }
  if (bias <= 0) bias = 1;
  if (bias !== 1) {
    fxn = 1 - Math.pow(1 - Math.pow(fxn, bias), 1 / bias);
  }
  if (power !== 1 || !parabolic) {
    if (fxn < 0.5) {
      if (!parabolic) fxn = (1 - Math.cos(Math.PI * fxn)) * 0.5; // circular
      fxn = Math.pow(fxn * 2, power) * 0.5; // parabolic
    } else if (fxn > 0.5) {
      fxn = 1 - fxn;
      if (!parabolic) fxn = (1 - Math.cos(Math.PI * fxn)) * 0.5;
      fxn = Math.pow(fxn * 2, power) * 0.5;
      fxn = 1 - fxn;
    }
  }
  return fxn;
}

/**
 * Interpolate between two 18-float views: SLERP the rotation (0-8), linearly
 * interpolate origin/position/clip/fov (9-17).
 */
function interpView(a: View18, b: View18, t: number): View18 {
  const rot = quatToMat(slerp(matToQuat(a.slice(0, 9)), matToQuat(b.slice(0, 9)), t));
  const out: View18 = a.slice();
  for (let i = 0; i < 9; i++) out[i] = rot[i]!;
  for (let i = 9; i < 18; i++) out[i] = a[i]! + (b[i]! - a[i]!) * t;
  return out;
}

/* -------------------------------- registrar ------------------------------- */

export function registerMovie2(ctx: RegistrarCtx): void {
  const view = ctx.executive.view;

  /* ---- movie-camera keyframe model (mview / get_movie_view) ---- */
  const cameraKeys = new Map<number, View18>();

  /** Interpolate the stored keyframes at `frame`, clamping outside the range. */
  const movieViewAt = (frame: number): View18 => {
    if (cameraKeys.size === 0) return view.get();
    const frames = [...cameraKeys.keys()].sort((p, q) => p - q);
    const first = frames[0]!;
    const last = frames[frames.length - 1]!;
    if (frame <= first) return cameraKeys.get(first)!.slice();
    if (frame >= last) return cameraKeys.get(last)!.slice();
    // Find the bracketing pair f0 <= frame < f1.
    let f0 = first;
    let f1 = last;
    for (let i = 0; i < frames.length - 1; i++) {
      const lo = frames[i]!;
      const hi = frames[i + 1]!;
      if (frame >= lo && frame <= hi) {
        f0 = lo;
        f1 = hi;
        break;
      }
    }
    if (f1 === f0) return cameraKeys.get(f0)!.slice();
    // PyMOL eases the linear frame fraction through the movie power/bias curve
    // (default power 1.4) rather than lerping straight between key frames.
    const t = easeFraction((frame - f0) / (f1 - f0));
    return interpView(cameraKeys.get(f0)!, cameraKeys.get(f1)!, t);
  };

  // mview(action='store', frame=0, ...) — manage camera keyframes.
  // store: capture the current 18-float view at `frame`.
  // clear: drop the keyframe at `frame` (or all keyframes if none given).
  // reset: drop every keyframe.
  // interpolate / reinterpolate: no-op flags — get_movie_view already
  //   interpolates on demand between the bracketing keyframes.
  ctx.command('mview', (args, kwargs): Json => {
    const action = ctx.str(pick(args, kwargs, 0, 'action'), 'store').toLowerCase();
    switch (action) {
      case 'store': {
        const frame = frameOf(pick(args, kwargs, 1, 'frame'), 0);
        cameraKeys.set(frame, view.get());
        return 1;
      }
      case 'clear': {
        const rawFrame = pick(args, kwargs, 1, 'frame');
        if (rawFrame === undefined || rawFrame === null || rawFrame === '') {
          cameraKeys.clear();
        } else {
          cameraKeys.delete(frameOf(rawFrame, 0));
        }
        return 1;
      }
      case 'reset':
        cameraKeys.clear();
        return 1;
      case 'interpolate':
      case 'reinterpolate':
      case 'smooth':
        // Interpolation is computed on demand by get_movie_view; nothing to
        // materialise here.
        return 1;
      default:
        return null;
    }
  });

  // get_movie_view(frame=0) -> the interpolated 18-float view at `frame`.
  ctx.command('get_movie_view', (args, kwargs): Json => {
    const frame = frameOf(pick(args, kwargs, 0, 'frame'), 0);
    return movieViewAt(frame) as unknown as Json;
  });

  /* ---- movie-matrix keyframe model (mmatrix) ---- */
  const IDENTITY16: number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const matrixKeys = new Map<number, number[]>();

  /** Coerce an unknown to a 16-float matrix, else the identity. */
  const toMat16 = (v: unknown): number[] => {
    if (Array.isArray(v) && v.length === 16) {
      const out = v.map((n) => Number(n));
      if (out.every((n) => Number.isFinite(n))) return out;
    }
    return IDENTITY16.slice();
  };

  // mmatrix(action, frame=0, matrix=identity) — object-matrix keyframes,
  // parallel to mview. store/clear/reset mirror mview; recall returns the
  // stored (or interpolated) matrix at a frame.
  ctx.command('mmatrix', (args, kwargs): Json => {
    const action = ctx.str(pick(args, kwargs, 0, 'action'), 'store').toLowerCase();
    switch (action) {
      case 'store': {
        const frame = frameOf(pick(args, kwargs, 1, 'frame'), 0);
        matrixKeys.set(frame, toMat16(pick(args, kwargs, 2, 'matrix')));
        // Real PyMOL's cmd.mmatrix returns None for every action; the keyframe
        // store is a side effect observed via get_movie_matrix, not the return.
        return null;
      }
      case 'clear': {
        const rawFrame = pick(args, kwargs, 1, 'frame');
        if (rawFrame === undefined || rawFrame === null || rawFrame === '') matrixKeys.clear();
        else matrixKeys.delete(frameOf(rawFrame, 0));
        return null;
      }
      case 'reset':
        matrixKeys.clear();
        return null;
      default:
        return null;
    }
  });

  // get_movie_matrix(frame=0) -> the object matrix at `frame`, linearly
  // interpolated between the bracketing keyframes (identity if none stored).
  ctx.command('get_movie_matrix', (args, kwargs): Json => {
    const frame = frameOf(pick(args, kwargs, 0, 'frame'), 0);
    if (matrixKeys.size === 0) return IDENTITY16.slice() as unknown as Json;
    const frames = [...matrixKeys.keys()].sort((p, q) => p - q);
    const first = frames[0]!;
    const last = frames[frames.length - 1]!;
    if (frame <= first) return matrixKeys.get(first)!.slice() as unknown as Json;
    if (frame >= last) return matrixKeys.get(last)!.slice() as unknown as Json;
    let f0 = first;
    let f1 = last;
    for (let i = 0; i < frames.length - 1; i++) {
      const lo = frames[i]!;
      const hi = frames[i + 1]!;
      if (frame >= lo && frame <= hi) {
        f0 = lo;
        f1 = hi;
        break;
      }
    }
    const a = matrixKeys.get(f0)!;
    const b = matrixKeys.get(f1)!;
    const t = f1 === f0 ? 0 : (frame - f0) / (f1 - f0);
    const out = a.map((v, i) => v + (b[i]! - v) * t);
    return out as unknown as Json;
  });

  /* ---- rocking (rock / get_rock_angle) ---- */
  // PyMOL's `sweep_angle` / `sweep_speed` defaults: a +/-15 deg sweep whose full
  // cycle spans `period` frames.
  const rockAmplitude = 15;
  const rockPeriod = 60;

  const isRocking = (): boolean => {
    const v = ctx.call('get_setting_boolean', ['rock']);
    return v === true || v === 1;
  };

  // rock(mode=-1) — toggle (-1), force on (1) / off (0), or query (-2) without
  // change. Mirrors ControlRock (layer1/Control.cpp): the live-rock state lives
  // in the global `rock` boolean setting. Returns the resulting flag.
  ctx.command('rock', (args, kwargs): Json => {
    const mode = frameOf(pick(args, kwargs, 0, 'mode'), -1);
    switch (mode) {
      case -2:
        break; // query only
      case -1:
        ctx.call('set', ['rock', isRocking() ? 0 : 1]);
        break;
      case 0:
        ctx.call('set', ['rock', 0]);
        break;
      default:
        ctx.call('set', ['rock', mode !== 0 ? 1 : 0]);
        break;
    }
    return isRocking() ? 1 : 0;
  });

  // get_rock_angle(frame=0) -> the rocking turn angle (degrees) at `frame`;
  // zero when rocking is disabled.
  ctx.command('get_rock_angle', (args, kwargs): Json => {
    if (!isRocking()) return 0;
    const frame = num(pick(args, kwargs, 0, 'frame'), 0);
    return rockAmplitude * Math.sin((2 * Math.PI * frame) / rockPeriod);
  });

  /* ---- bezier curves (curve_new / move_on_curve) ---- */
  // A curve object is a bezier spline: an ordered list of control points, each
  // with an on-curve `control` position and two off-curve handles. This mirrors
  // PyMOL's ObjectCurve / BezierSpline (layer0/Bezier.cpp, layer2/ObjectCurve.cpp).
  type Vec3 = [number, number, number];
  interface BezierPoint {
    control: Vec3;
    leftHandle: Vec3;
    rightHandle: Vec3;
  }
  const curves = new Map<string, BezierPoint[]>();

  // The default two-point spline PyMOL seeds a fresh curve with
  // (BezierSpline::addBezierPoint, empty case).
  const defaultBezierSpline = (): BezierPoint[] => [
    { control: [0, 0, 0], leftHandle: [0, 0, 10], rightHandle: [0, 0, -10] },
    { control: [10, 0, 0], leftHandle: [10, 0, -10], rightHandle: [10, 0, 10] },
  ];

  // Cubic bezier point for p0..p3 at local parameter `t` (GetBezierPoint).
  const cubicBezier = (p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 => {
    const mt = 1 - t;
    const c0 = mt * mt * mt;
    const c1 = 3 * mt * mt * t;
    const c2 = 3 * mt * t * t;
    const c3 = t * t * t;
    return [
      c0 * p0[0] + c1 * p1[0] + c2 * p2[0] + c3 * p3[0],
      c0 * p0[1] + c1 * p1[1] + c2 * p2[1] + c3 * p3[1],
      c0 * p0[2] + c1 * p1[2] + c2 * p2[2] + c3 * p3[2],
    ];
  };

  // Position at global parameter `t` in [0,1] along a spline. Ports
  // BezierSpline::getIndexAndLocalT + getBezierPoint: the handle used from the
  // start point is its RIGHT handle, and from the end point its LEFT handle.
  const bezierPositionAt = (pts: BezierPoint[], globalT: number): Vec3 => {
    const t = Math.max(0, Math.min(1, globalT));
    const curveCount = pts.length - 1;
    let index: number;
    let localT: number;
    if (t >= 1) {
      index = pts.length - 2;
      localT = 1;
    } else {
      const scaled = t * curveCount;
      index = Math.floor(scaled);
      localT = scaled - index;
    }
    const a = pts[index]!;
    const b = pts[index + 1]!;
    return cubicBezier(a.control, a.rightHandle, b.leftHandle, b.control, localT);
  };

  // curve_new(name='', curve_type='bezier') — create a curve object. Real PyMOL
  // (creating.py) auto-names an empty name via get_unused_name("Curve") and
  // registers a first-class ObjectCurve (so it shows up in get_names) seeded with
  // the default bezier spline. Returns the object name.
  ctx.command('curve_new', (args, kwargs): Json => {
    const raw = ctx.str(pick(args, kwargs, 0, 'name'), '');
    const name = raw !== '' ? raw : ctx.executive.uniqueName('Curve');
    ctx.executive.registerGadget(name, 'object:curve');
    curves.set(name, defaultBezierSpline());
    ctx.publish();
    return name;
  });

  // move_on_curve(mobile_obj, curve_obj, t) — move an object along a curve.
  // Ports ExecutiveMoveObjectOnCurve (layer3/Executive.cpp): evaluate the curve
  // at `t`, then set the mobile object's TTT (transient display matrix) so its
  // post-translation equals that position (the rotation is left untouched, or
  // identity when no TTT was set yet). Observable via get_object_ttt /
  // get_object_matrix(incl_ttt=1). Returns null (like PyMOL).
  ctx.command('move_on_curve', (args, kwargs): Json => {
    const mobileName = ctx.str(pick(args, kwargs, 0, 'mobile_obj'), '');
    const curveName = ctx.str(pick(args, kwargs, 1, 'curve_obj'), '');
    const t = Math.max(0, Math.min(1, num(pick(args, kwargs, 2, 't'), 0)));
    const pts = curves.get(curveName);
    if (!pts || pts.length < 2) return null;
    const mol = ctx.executive.molecule(mobileName);
    if (!mol) return null;
    const pos = bezierPositionAt(pts, t);
    // TTT is a row-major 4x4 with the translation in the 4th column (3/7/11).
    const ttt = mol.ttt ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    ttt[3] = pos[0];
    ttt[7] = pos[1];
    ttt[11] = pos[2];
    mol.ttt = ttt;
    ctx.publish();
    return null;
  });

  /* ------------------------------- morph ------------------------------- */
  // morph(name, source, target=None, source_state=1, target_state=?, steps=30)
  // Build a new multi-state object whose `steps` coordinate sets linearly
  // interpolate between two endpoint conformations:
  //   - target given: state 1 of `source` -> state 1 of `target`;
  //   - target omitted: state `source_state` (1) -> state `target_state` (2)
  //     of `source` (a two-state object).
  // Returns the number of states (frames) created, or null on error.
  ctx.command('morph', (args, kwargs): Json => {
    const rawName = ctx.str(pick(args, kwargs, 0, 'name'), '');
    const srcName = ctx.str(pick(args, kwargs, 1, 'source'), '');
    const tgtName = ctx.str(pick(args, kwargs, 2, 'target'), '');
    const src = ctx.executive.molecule(srcName);
    if (!src) return null;
    const tgt = tgtName !== '' ? ctx.executive.molecule(tgtName) : src;
    if (!tgt) return null;

    const srcState = frameOf(pick(args, kwargs, 3, 'source_state'), 1);
    const tgtState = frameOf(pick(args, kwargs, 4, 'target_state'), tgtName !== '' ? 1 : 2);
    const steps = Math.max(2, frameOf(pick(args, kwargs, 5, 'steps'), 30));

    const a = src.states[srcState - 1];
    const b = tgt.states[tgtState - 1];
    if (!a || !b) return null;
    const natom = Math.min(src.natom, tgt.natom);
    if (natom === 0) return null;

    const name = rawName !== '' ? ctx.executive.uniqueName(rawName) : ctx.executive.uniqueName('morph');
    const out = new ObjectMolecule(name);
    // Clone the atom table + bonds from the source object.
    for (let i = 0; i < natom; i++) out.atoms.push({ ...src.atoms[i]! });
    for (const [i, j] of src.bonds) {
      if (i < natom && j < natom) out.bonds.push([i, j]);
    }
    // Materialise the interpolated coordinate sets.
    for (let k = 0; k < steps; k++) {
      const t = steps === 1 ? 0 : k / (steps - 1);
      const coords = new Float32Array(natom * 3);
      for (let o = 0; o < natom * 3; o++) {
        const av = a[o] ?? 0;
        const bv = b[o] ?? 0;
        coords[o] = av + (bv - av) * t;
      }
      out.states.push(coords);
    }
    ctx.executive.addMolecule(out);
    ctx.publish();
    return out.nstate;
  });

  /* ---- no-op file IO in the browser port ---- */
  ctx.command('mpng', (): Json => null);
  ctx.command('mdump', (): Json => null);
}
