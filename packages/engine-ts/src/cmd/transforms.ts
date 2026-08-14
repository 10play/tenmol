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
 * As in PyMOL, `rotate` and `translate` are OBJECT transforms — they mutate the
 * selected atoms' coordinates about the origin and leave the camera (`get_view`)
 * untouched; `turn`/`move` are the camera verbs. With `camera=1` (the default) a
 * transform's axis/vector is given in camera space and mapped back to model
 * space by the inverse (transpose) of the model->camera 3x3.
 */
import type { Json } from '@tenmol/protocol';
import type { RegistrarCtx } from './registrar';

/* ------------------------------ 3x3 helpers ------------------------------ */

type Mat3 = number[]; // column-major, length 9: index = col*3 + row

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

/** Transpose a column-major 3x3. For a rotation this is its inverse, so it maps
 * a camera-space direction back into model space (view 3x3 is model->camera). */
function transpose3(m: Mat3): Mat3 {
  return [
    m[0] as number, m[3] as number, m[6] as number,
    m[1] as number, m[4] as number, m[7] as number,
    m[2] as number, m[5] as number, m[8] as number,
  ];
}

/** Row-major homogeneous 4×4 identity as a flat 16-list. */
function identity44(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
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

  /**
   * Apply a per-coordinate map to every atom the selection matches, in the
   * given state (`state<=0` -> all states). Mutates the molecule's Float32
   * coordinate sets in place (so `get_model`/`get_coords` see the new values,
   * exactly as PyMOL's object transforms do).
   */
  const applyCoords = (
    sel: string,
    state: number,
    fn: (p: [number, number, number]) => [number, number, number],
  ): void => {
    const byObj = new Map<string, number[]>();
    for (const ua of ctx.executive.atomsMatching(sel)) {
      let arr = byObj.get(ua.objName);
      if (!arr) byObj.set(ua.objName, (arr = []));
      arr.push(ua.index);
    }
    for (const [objName, idxs] of byObj) {
      const mol = ctx.executive.molecule(objName);
      if (!mol) continue;
      const sets = state > 0 ? [mol.states[state - 1]] : mol.states;
      for (const set of sets) {
        if (!set) continue;
        for (const i of idxs) {
          const o = i * 3;
          const q = fn([set[o] as number, set[o + 1] as number, set[o + 2] as number]);
          set[o] = q[0];
          set[o + 1] = q[1];
          set[o + 2] = q[2];
        }
      }
    }
  };

  /* ------------------------------- rotate ------------------------------- */
  // rotate(axis, angle, selection='all', state=0, camera=1, object=None, origin=None)
  // Like PyMOL, `rotate` transforms the OBJECT's coordinates about the origin;
  // the camera (get_view) is unchanged. `turn` is the camera-rotation verb.
  ctx.command('rotate', (args, kwargs): Json => {
    const axisRaw = parseAxis(pick(args, kwargs, 0, 'axis'));
    const angle = num(pick(args, kwargs, 1, 'angle'), 0);
    if (!axisRaw) return null;
    const sel = ctx.str(pick(args, kwargs, 2, 'selection'), 'all') || 'all';
    const state = num(pick(args, kwargs, 3, 'state'), 0);
    const camera = flag(pick(args, kwargs, 4, 'camera'), true);
    const originArg = parseTriple(pick(args, kwargs, 6, 'origin'));
    const v = view.get();
    // camera=1 (default): the axis is given in camera space; map it to model
    // space with the inverse (transpose) of the model->camera rotation.
    const axis = camera ? transform3(transpose3(v.slice(0, 9)), axisRaw) : axisRaw;
    const rot = rotationMatrix(axis, angle);
    const pivot = originArg ?? ([v[12], v[13], v[14]] as [number, number, number]);
    applyCoords(sel, state, (p) => {
      const r = transform3(rot, [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]]);
      return [pivot[0] + r[0], pivot[1] + r[1], pivot[2] + r[2]];
    });
    ctx.publish();
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
  // Like PyMOL, `translate` shifts the OBJECT's coordinates; the camera is
  // unchanged. `move` is the camera-translation verb.
  ctx.command('translate', (args, kwargs): Json => {
    const vecRaw = parseTriple(pick(args, kwargs, 0, 'vector'));
    if (!vecRaw) return null;
    const sel = ctx.str(pick(args, kwargs, 1, 'selection'), 'all') || 'all';
    const state = num(pick(args, kwargs, 2, 'state'), 0);
    const camera = flag(pick(args, kwargs, 3, 'camera'), true);
    const objectRaw = pick(args, kwargs, 4, 'object');
    const object = objectRaw == null ? '' : ctx.str(objectRaw);
    const v = view.get();
    // camera=1 (default): the vector is in camera space; map it to model space.
    const vec = camera ? transform3(transpose3(v.slice(0, 9)), vecRaw) : vecRaw;
    // object set (object_mode=0): the selection is ignored; instead of moving the
    // atoms, PyMOL updates the object's TTT display matrix (ObjectTranslateTTT).
    if (object) {
      const mol = ctx.executive.molecule(object);
      if (!mol) return null;
      if (!mol.ttt) mol.ttt = identity44();
      mol.ttt[3]! += vec[0];
      mol.ttt[7]! += vec[1];
      mol.ttt[11]! += vec[2];
      ctx.publish();
      return null;
    }
    applyCoords(sel, state, (p) => [p[0] + vec[0], p[1] + vec[1], p[2] + vec[2]]);
    ctx.publish();
    return null;
  });

  /* --------------------------- get_object_ttt --------------------------- */
  // get_object_ttt(object, quiet=1) — return the object's TTT (transient)
  // display matrix as a flat row-major 16-list, or null when no TTT is set
  // (PyMOL's TTTFlag false) or the object is unknown. Ports ObjectGetTTT with
  // state=-1 (the only state real PyMOL supports here).
  ctx.command('get_object_ttt', (args, kwargs): Json => {
    const name = ctx.str(pick(args, kwargs, 0, 'object'));
    const mol = ctx.executive.molecule(name);
    if (!mol || !mol.ttt) return null;
    return mol.ttt.slice() as Json;
  });

  /* ------------------------------- center ------------------------------- */
  // center(selection='all', state=0, origin=1) — translate the window, clipping
  // slab and origin to the centre of the selection. Ports ExecutiveCenter:
  // `SceneOriginSet(center, preserve=0)` (when origin=1) followed by
  // `SceneRelocate(center)` (`packages/engine/layer1/Scene.cpp`). The camera
  // DISTANCE and slab THICKNESS are preserved; the front/back clip planes are
  // recomputed symmetric about the new distance.
  ctx.command('center', (args, kwargs): Json => {
    const sel = ctx.str(pick(args, kwargs, 0, 'selection'), 'all') || 'all';
    const originFlag = flag(pick(args, kwargs, 2, 'origin'), true);
    const sphere = ctx.executive.selectionSphere(sel);
    if (!sphere) return null;
    const loc = sphere.center;
    const v = view.get();
    // origin=1 (default): move the rotation origin to the selection centre with
    // no compensating shift (SceneOriginSet, preserve=0). origin=0 leaves it.
    if (originFlag) {
      v[12] = loc[0];
      v[13] = loc[1];
      v[14] = loc[2];
    }
    // SceneRelocate: re-aim the camera at `loc`, preserving the camera distance.
    const rot = v.slice(0, 9);
    let dist = v[11] as number;
    if (dist > -5) dist = -5; // keep the camera in front (>= 1 bond visible)
    const o: [number, number, number] = [v[12] as number, v[13] as number, v[14] as number];
    // v0 = origin - location, mapped model -> camera space by the view 3x3.
    const pos = transform3(rot, [o[0] - loc[0], o[1] - loc[1], o[2] - loc[2]]);
    const slab = (v[16] as number) - (v[15] as number);
    pos[2] = dist;
    v[9] = pos[0];
    v[10] = pos[1];
    v[11] = pos[2];
    v[15] = -pos[2] - slab * 0.5;
    v[16] = -pos[2] + slab * 0.5;
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
