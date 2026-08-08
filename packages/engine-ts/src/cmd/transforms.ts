/**
 * The `transforms` command subsystem — camera and object moves.
 *
 * Ports the camera-manipulation half of PyMOL's `viewing.py` / `Scene.cpp`:
 * `rotate`, `move`, `translate`, `center`, `origin`, `clip`. Everything operates
 * on the 18-float view exposed by {@link Executive.view}:
 *
 *   0-8    column-major 3x3, model space -> camera space
 *   9-11   origin of rotation relative to the camera (camera space, `Pos`)
 *   12-14  origin of rotation (model space, `Origin`)
 *   15     front (near) clip distance from the camera
 *   16     rear (far) clip distance from the camera
 *   17     signed field of view
 *
 * The scene-rotation convention matches `ViewState.turn`: a camera-space
 * axis-angle rotation is PRE-multiplied onto the model->camera 3x3, so
 * `rotate('y', 90)` reproduces `turn('y', 90)` exactly, and the arbitrary-axis
 * form (`rotate([x,y,z], a)`) is the Rodrigues generalisation of it.
 */
import type { Json } from '@tenmol/protocol';
import type { RegistrarCtx } from './registrar';

/* ------------------------------ 3x3 helpers ------------------------------ */

type Mat3 = number[]; // column-major, length 9: index = col*3 + row

/** Column-major 3x3 multiply: returns a*b (same convention as view.ts). */
function mul3(a: Mat3, b: Mat3): Mat3 {
  const out: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += (a[k * 3 + r] as number) * (b[c * 3 + k] as number);
      out[c * 3 + r] = s;
    }
  }
  return out;
}

/**
 * Rotation about an arbitrary axis by `deg` degrees (Rodrigues' formula),
 * returned column-major. Reduces to `ViewState`'s per-axis matrices: for the
 * unit y axis this yields `[c,0,-s, 0,1,0, s,0,c]`, matching `turn('y', deg)`.
 */
function rotationMatrix(axis: readonly [number, number, number], deg: number): Mat3 {
  const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const x = axis[0] / len;
  const y = axis[1] / len;
  const z = axis[2] / len;
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const t = 1 - c;
  // Row-major entries of the right-handed rotation matrix.
  const m00 = c + x * x * t;
  const m01 = x * y * t - z * s;
  const m02 = x * z * t + y * s;
  const m10 = y * x * t + z * s;
  const m11 = c + y * y * t;
  const m12 = y * z * t - x * s;
  const m20 = z * x * t - y * s;
  const m21 = z * y * t + x * s;
  const m22 = c + z * z * t;
  // Store column-major: [col0(r0,r1,r2), col1(...), col2(...)].
  return [m00, m10, m20, m01, m11, m21, m02, m12, m22];
}

/** Multiply a column-major 3x3 by a model-space vector -> a 3-vector. */
function transform3(m: Mat3, v: readonly [number, number, number]): [number, number, number] {
  return [
    (m[0] as number) * v[0] + (m[3] as number) * v[1] + (m[6] as number) * v[2],
    (m[1] as number) * v[0] + (m[4] as number) * v[1] + (m[7] as number) * v[2],
    (m[2] as number) * v[0] + (m[5] as number) * v[1] + (m[8] as number) * v[2],
  ];
}

/* ------------------------------ arg parsing ------------------------------ */

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

/** Parse a `[x,y,z]` / `x,y,z` / array into a numeric triple. */
function parseTriple(v: unknown): [number, number, number] | null {
  if (Array.isArray(v)) {
    if (v.length !== 3) return null;
    return [Number(v[0]), Number(v[1]), Number(v[2])];
  }
  if (typeof v === 'string') {
    const nums = v
      .replace(/[[\]()]/g, '')
      .split(/[\s,]+/)
      .filter((s) => s !== '')
      .map(Number);
    if (nums.length === 3 && nums.every((n) => Number.isFinite(n))) {
      return [nums[0]!, nums[1]!, nums[2]!];
    }
  }
  return null;
}

/** Resolve a rotation/translation axis to a direction vector. */
function parseAxis(v: unknown): [number, number, number] | null {
  if (typeof v === 'string') {
    switch (v.trim().toLowerCase()) {
      case 'x':
        return [1, 0, 0];
      case 'y':
        return [0, 1, 0];
      case 'z':
        return [0, 0, 1];
    }
  }
  return parseTriple(v);
}

/** Truthy PyMOL flag: accepts 1/0, "1"/"0", "true"/"false". */
function flag(v: unknown, dflt: boolean): boolean {
  if (v === undefined || v === null || v === '') return dflt;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).trim().toLowerCase();
  return s !== '0' && s !== '' && s !== 'false' && s !== 'none' && s !== 'off';
}

/* ------------------------------- registrar ------------------------------- */

export function registerTransforms(ctx: RegistrarCtx): void {
  const view = ctx.executive.view;

  /* ------------------------------- rotate ------------------------------- */
  // rotate(axis, angle, selection='all', state=0, camera=1, object=None, origin=None)
  ctx.command('rotate', (args, kwargs): Json => {
    const axis = parseAxis(pick(args, kwargs, 0, 'axis'));
    const angle = num(pick(args, kwargs, 1, 'angle'), 0);
    const object = pick(args, kwargs, 5, 'object');
    const camera = flag(pick(args, kwargs, 4, 'camera'), true);
    if (!axis) return null;
    // Only the camera path is ported: rotate the scene about a camera-space axis.
    // (Object-coordinate rotation is out of scope; see engine-port-gaps.md.)
    if (object != null && object !== '' && !camera) return null;
    const v = view.get();
    const rot = mul3(rotationMatrix(axis, angle), v.slice(0, 9));
    for (let i = 0; i < 9; i++) v[i] = rot[i] as number;
    view.set(v);
    ctx.emitView();
    return null;
  });

  /* -------------------------------- move -------------------------------- */
  // move(axis, distance) — translate the camera (PyMOL SceneTranslate).
  ctx.command('move', (args, kwargs): Json => {
    const axisName = ctx.str(pick(args, kwargs, 0, 'axis')).trim().toLowerCase();
    const dist = num(pick(args, kwargs, 1, 'distance'), 0);
    const v = view.get();
    switch (axisName) {
      case 'x':
        v[9] = (v[9] as number) + dist;
        break;
      case 'y':
        v[10] = (v[10] as number) + dist;
        break;
      case 'z':
        v[11] = (v[11] as number) + dist;
        // Clip planes are measured from the camera, so a z shift carries them.
        v[15] = (v[15] as number) - dist;
        v[16] = (v[16] as number) - dist;
        break;
      default:
        return null;
    }
    view.set(v);
    ctx.emitView();
    return null;
  });

  /* ------------------------------ translate ----------------------------- */
  // translate(vector, selection='all', state=0, camera=1, object=None)
  ctx.command('translate', (args, kwargs): Json => {
    const vec = parseTriple(pick(args, kwargs, 0, 'vector'));
    if (!vec) return null;
    const object = pick(args, kwargs, 4, 'object');
    const camera = flag(pick(args, kwargs, 3, 'camera'), true);

    // Bonus: object-space translation of atom coordinates.
    if (object != null && object !== '' && !camera) {
      const mol = ctx.executive.molecule(ctx.str(object));
      if (!mol) return null;
      for (const set of mol.states) {
        for (let o = 0; o < set.length; o += 3) {
          set[o] = (set[o] as number) + vec[0];
          set[o + 1] = (set[o + 1] as number) + vec[1];
          set[o + 2] = (set[o + 2] as number) + vec[2];
        }
      }
      ctx.publish();
      return null;
    }

    // Camera-space translation of the whole scene (SceneTranslate).
    const v = view.get();
    v[9] = (v[9] as number) + vec[0];
    v[10] = (v[10] as number) + vec[1];
    v[11] = (v[11] as number) + vec[2];
    v[15] = (v[15] as number) - vec[2];
    v[16] = (v[16] as number) - vec[2];
    view.set(v);
    ctx.emitView();
    return null;
  });

  /* ------------------------------- center ------------------------------- */
  // center(selection='all', state=0, origin=1) — pivot on the selection centroid.
  ctx.command('center', (args, kwargs): Json => {
    const sel = ctx.str(pick(args, kwargs, 0, 'selection'), 'all') || 'all';
    const sphere = ctx.executive.selectionSphere(sel);
    if (!sphere) return null;
    const v = view.get();
    v[12] = sphere.center[0];
    v[13] = sphere.center[1];
    v[14] = sphere.center[2];
    // Recentre the pivot on screen (Pos x/y -> 0), as PyMOL's `center` does.
    v[9] = 0;
    v[10] = 0;
    view.set(v);
    ctx.emitView();
    return null;
  });

  /* ------------------------------- origin ------------------------------- */
  // origin(selection='all', object=None, state=0) — set the rotation origin
  // WITHOUT moving the camera (the object stays put on screen).
  ctx.command('origin', (args, kwargs): Json => {
    const sel = ctx.str(pick(args, kwargs, 0, 'selection'), 'all') || 'all';
    const sphere = ctx.executive.selectionSphere(sel);
    if (!sphere) return null;
    const v = view.get();
    const oldOrigin: [number, number, number] = [
      v[12] as number,
      v[13] as number,
      v[14] as number,
    ];
    // Preserve on-screen position: shift the camera-space Pos by the origin
    // delta rotated into camera space (PyMOL SceneOriginSet, preserve=1).
    const delta: [number, number, number] = [
      sphere.center[0] - oldOrigin[0],
      sphere.center[1] - oldOrigin[1],
      sphere.center[2] - oldOrigin[2],
    ];
    const camDelta = transform3(v.slice(0, 9), delta);
    v[9] = (v[9] as number) - camDelta[0];
    v[10] = (v[10] as number) - camDelta[1];
    v[11] = (v[11] as number) - camDelta[2];
    v[12] = sphere.center[0];
    v[13] = sphere.center[1];
    v[14] = sphere.center[2];
    view.set(v);
    ctx.emitView();
    return null;
  });

  /* -------------------------------- clip -------------------------------- */
  // clip(mode, distance) — adjust the near/far clipping planes (SceneClip).
  ctx.command('clip', (args, kwargs): Json => {
    const mode = ctx.str(pick(args, kwargs, 0, 'mode')).trim().toLowerCase();
    const dist = num(pick(args, kwargs, 1, 'distance'), 0);
    const v = view.get();
    const front = v[15] as number;
    const back = v[16] as number;
    switch (mode) {
      case 'near':
        v[15] = front - dist;
        break;
      case 'far':
        v[16] = back - dist;
        break;
      case 'move':
        v[15] = front - dist;
        v[16] = back - dist;
        break;
      case 'slab': {
        const mid = (front + back) / 2;
        v[15] = mid - dist / 2;
        v[16] = mid + dist / 2;
        break;
      }
      default:
        return null;
    }
    view.set(v);
    ctx.emitView();
    return null;
  });
}
