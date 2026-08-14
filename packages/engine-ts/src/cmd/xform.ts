/**
 * Transform + state verbs: transform_object, transform_selection, set_frame,
 * get_object_state, get_selection_state, set_state_order, get_coordset,
 * load_coordset, set_discrete (+ its count_discrete getter path).
 *
 * `set_object_ttt` is intentionally NOT registered: an honest `NotPorted` is
 * preferable to a lying no-op. The TTT (transient display) matrix itself is
 * modelled just enough for `translate object=…` to write it and
 * `get_object_ttt` to read it back (see {@link registerTransforms}).
 *
 * Registers through the shared {@link RegistrarCtx}. Compose real verbs via
 * `ctx.call(...)` (`frame`, `load_coords`, `get_frame`); mutate model state via
 * `ctx.executive`; `ctx.publish()` after coordinate/state mutations.
 */
import type { Json } from '@tenmol/protocol';
import { encodeCoords } from '@tenmol/protocol';
import type { RegistrarCtx } from './registrar';

function toNum(v: unknown, dflt: number): number {
  if (v == null || v === '') return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

function toBool(v: unknown, dflt = false): boolean {
  if (v == null || v === '') return dflt;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  if (s === '0' || s === 'off' || s === 'false' || s === 'no') return false;
  return true;
}

/**
 * Coerce a PyMOL transform matrix argument to a flat 16-element row-major array.
 * Accepts a flat 16-list or a nested 4×4. Missing entries throw — a transform
 * with a malformed matrix is a caller error, not a silent identity.
 */
function toMat16(v: unknown): number[] {
  const flat: number[] = [];
  const push = (x: unknown): void => {
    const n = Number(x);
    flat.push(Number.isFinite(n) ? n : 0);
  };
  if (Array.isArray(v)) {
    for (const el of v) {
      if (Array.isArray(el)) for (const e of el) push(e);
      else push(el);
    }
  }
  if (flat.length < 16) throw new Error('transform: expected a 16-element (4×4) matrix');
  return flat.slice(0, 16);
}

/** Apply a row-major 4×4 `m` to the coord at offset `o` of `set`, in place. */
function applyMat(set: Float32Array, o: number, m: number[]): void {
  const x = set[o] ?? 0;
  const y = set[o + 1] ?? 0;
  const z = set[o + 2] ?? 0;
  set[o] = m[0]! * x + m[1]! * y + m[2]! * z + m[3]!;
  set[o + 1] = m[4]! * x + m[5]! * y + m[6]! * z + m[7]!;
  set[o + 2] = m[8]! * x + m[9]! * y + m[10]! * z + m[11]!;
}

/** Row-major homogeneous 4×4 product a·b. */
function mat4mul(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[r * 4 + k]! * b[k * 4 + c]!;
      out[r * 4 + c] = s;
    }
  }
  return out;
}

export function registerXform(ctx: RegistrarCtx): void {
  const ex = ctx.executive;
  const str = ctx.str;

  /* --------------------------- transform_object -------------------------- */

  // transform_object(name, matrix, state=0, ...) — apply a 4×4 (row-major) to
  // an object's coordinates. state 0 == every state; state N == that state only.
  ctx.command('transform_object', (args, kwargs): Json => {
    const name = str(args[0] ?? kwargs['name']);
    const m = toMat16(args[1] ?? kwargs['matrix']);
    const state = toNum(args[2] ?? kwargs['state'], 0);
    const mol = ex.molecule(name);
    if (!mol) return 0;
    const sets = state === 0 ? mol.states : [mol.states[state - 1]];
    let n = 0;
    for (const set of sets) {
      if (!set) continue;
      for (let o = 0; o < set.length; o += 3) applyMat(set, o, m);
      n++;
    }
    // Record the applied matrix into the object's state matrix (PyMOL's
    // CoordSetRecordTxfApplied): left-combine onto the existing one so
    // get_object_matrix returns the cumulative transform.
    mol.objectMatrix = mol.objectMatrix ? mat4mul(m, mol.objectMatrix) : m.slice();
    if (n > 0) ctx.publish();
    return mol.natom;
  });

  /* -------------------------- transform_selection ------------------------ */

  // transform_selection(selection, matrix, state=0, ...) — apply a 4×4 to just
  // the matched atoms (per-atom, in each object's own state arrays).
  ctx.command('transform_selection', (args, kwargs): Json => {
    const sel = str(args[0] ?? kwargs['selection'], 'all') || 'all';
    const m = toMat16(args[1] ?? kwargs['matrix']);
    const state = toNum(args[2] ?? kwargs['state'], 0);
    const matched = ex.atomsMatching(sel);
    let n = 0;
    for (const ua of matched) {
      const mol = ex.molecule(ua.objName);
      if (!mol) continue;
      const sets = state === 0 ? mol.states : [mol.states[state - 1]];
      for (const set of sets) {
        if (!set) continue;
        applyMat(set, ua.index * 3, m);
        n++;
      }
    }
    if (n > 0) ctx.publish();
    return matched.length;
  });

  /* ---------------------------- set_state_order -------------------------- */

  // set_state_order(name, order) — reorder an object's states by a 1-based list.
  // A malformed order (wrong length / out-of-range) is a no-op.
  ctx.command('set_state_order', (args, kwargs): Json => {
    const name = str(args[0] ?? kwargs['name']);
    const orderRaw = args[1] ?? kwargs['order'];
    const mol = ex.molecule(name);
    if (!mol) return 0;
    const order = Array.isArray(orderRaw) ? orderRaw.map((v) => Number(v)) : [];
    if (order.length !== mol.states.length) return 0;
    const reordered = order.map((i) => mol.states[i - 1]);
    if (reordered.some((s) => s == null)) return 0;
    mol.states.splice(0, mol.states.length, ...(reordered as Float32Array[]));
    ctx.publish();
    return mol.nstate;
  });

  /* ------------------------------ get_coordset --------------------------- */

  // get_coordset(name, state=1, copy=1) — the object's coordinate set as an
  // N×3 numpy float32 array. Over the bridge real PyMOL serializes that as a
  // base64 `__ndarray__` (packages/bridge/tenmol_bridge/codec.py); match that
  // wire shape rather than returning a plain nested JS array. `copy` is always
  // a fresh copy here, so it is accepted but immaterial.
  ctx.command('get_coordset', (args, kwargs): Json => {
    const name = str(args[0] ?? kwargs['name']);
    const state = toNum(args[1] ?? kwargs['state'], 1) || 1;
    const mol = ex.molecule(name);
    if (!mol) return null;
    const out: Array<readonly [number, number, number]> = [];
    for (let i = 0; i < mol.natom; i++) {
      const [x, y, z] = mol.coord(i, state);
      out.push([x, y, z]);
    }
    return encodeCoords(out) as unknown as Json;
  });

  /* ----------------------------- load_coordset --------------------------- */

  // load_coordset(coords, object, state=1) — the inverse of get_coordset. The
  // object name is itself a selection matching all its atoms, so this forwards
  // to the real `load_coords` (which writes coords[i] into the i-th atom).
  ctx.command('load_coordset', (args, kwargs): Json => {
    const coords = args[0] ?? kwargs['coords'];
    const object = str(args[1] ?? kwargs['object']);
    const state = toNum(args[2] ?? kwargs['state'], 1) || 1;
    return ctx.call('load_coords', [coords, object, state]);
  });

  /* ---------------------------- get_object_state ------------------------- */

  // get_object_state(name) — the object's current state index. There is no
  // per-object current-state cursor in this model; the only cursor is the global
  // display frame (`cmd.frame`). We report that frame clamped to the object's
  // state range, so a single-state object always reads 1.
  ctx.command('get_object_state', (args, kwargs): Json => {
    const name = str(args[0] ?? kwargs['name']);
    const mol = ex.molecule(name);
    if (!mol) return 1;
    const frame = toNum(ctx.call('get_frame'), 1) || 1;
    return Math.min(Math.max(1, frame), Math.max(1, mol.nstate));
  });

  /* --------------------------- get_selection_state ----------------------- */

  // get_selection_state(selection) — the single effective object state shared by
  // all objects the selection touches. Mirrors PyMOL: map get_object_state over
  // get_object_list('(' + selection + ')'), returning the sole state if they all
  // agree, 1 if no objects are touched, or raising if they differ.
  ctx.command('get_selection_state', (args, kwargs): Json => {
    const selection = str(args[0] ?? kwargs['selection']);
    const names = ex.getObjectList(`(${selection})`);
    const states = new Set<number>();
    for (const name of names) states.add(toNum(ctx.call('get_object_state', [name]), 1));
    if (states.size === 0) return 1;
    if (states.size !== 1) throw new Error('Selection spans multiple object states');
    return states.values().next().value as number;
  });

  /* ------------------------------- set_frame ----------------------------- */

  // set_frame(frame) — move the global movie-frame cursor. Forwards to the real
  // `cmd.frame`, which owns the cursor and re-emits the view.
  ctx.command('set_frame', (args, kwargs): Json =>
    ctx.call('frame', [args[0] ?? kwargs['frame'] ?? 1]),
  );

  /* ------------------------------ set_discrete --------------------------- */

  // set_discrete(name, discrete) — set/clear a per-object discrete flag in the
  // module-level side-store. Observable via count_discrete (below).
  ctx.command('set_discrete', (args, kwargs): Json => {
    const name = str(args[0] ?? kwargs['name']);
    const flag = toBool(args[1] ?? kwargs['discrete'], true);
    const mol = ex.molecule(name);
    if (!mol) return 0;
    mol.discrete = flag;
    return 1;
  });

  // count_discrete(selection='all') — the getter path for the discrete flag:
  // how many objects touched by the selection are flagged discrete. Overrides
  // the engine's benign `() => 0` default so the flag is actually observable.
  ctx.command('count_discrete', (args): Json => {
    const sel = str(args[0], 'all') || 'all';
    const names = new Set(ex.atomsMatching(sel).map((ua) => ua.objName));
    let n = 0;
    for (const nm of names) {
      const m = ex.molecule(nm);
      if (m && m.discrete) n++;
    }
    return n;
  });
}
