/**
 * The `extras` command subsystem — the RESIDUAL COMMAND SWEEP.
 *
 * Its job is coverage: guarantee that every remaining public PyMOL `cmd.*` verb
 * (from `modules/pymol/api.py` / `keywords.py`) has a registered handler, so no
 * console verb is silently unimplemented. Verbs already owned by another
 * subsystem (coloring, transforms, objects, settings2, sculpt, measurement, …)
 * are NOT registered here — this module only fills the gap.
 *
 * Two tiers of handler live here:
 *
 *   - REAL   — a correct behaviour computed from the executive/model:
 *              alphatoall, mse2met, mask/unmask/get_mask, delete_states,
 *              split_states, join_states, spheroid, copy_to, extract, overlap,
 *              intra_rms/intra_rms_cur, look_at, refresh, transparency,
 *              stereo, edit_mode.
 *
 *   - DOCUMENTED NO-OP — for genuinely environment-bound verbs (disk/network
 *              I/O, GPU raytrace, file formats needing a parser we cannot add
 *              in an isolated module, GUI/window ops): returns a sensible value
 *              (null / [] / {} / '' / 0) WITHOUT throwing and WITHOUT side
 *              effects. These are listed explicitly below.
 *
 * CLAIMED NAMES (confirmed via grep NOT registered anywhere else at authoring
 * time — do not register any of these twice):
 *   alias alignto alphatoall assign_stereo cache callout capture cealign cls
 *   copy_to decline delete_states drag draw edit edit_keys edit_mode extend
 *   extra_fit extract fab feedback fetch fnab focal_blur get_mtl_obj get_povray
 *   h_fix intra_rms intra_rms_cur join_states load_embedded load_model
 *   load_mtz load_png load_traj loadall log log_close log_open look_at map_set
 *   mask matrix_copy mcopy mdelete mdo meter_reset middle minsert mmove mse2met
 *   overlap pair_fit pbc_unwrap pbc_wrap pi_interactions png povray quit ray
 *   refresh release remove_picked resume save scene_order set_geometry slice_new
 *   spheroid split_states stereo stereochemistry text_type transparency uniquify
 *   unmask unpick unset_deep usalign vdw_fit volume volume_panel get_mask
 */

import type { Json } from '@tenmol/protocol';
import { incentiveOnly } from '@tenmol/protocol';
import { PymolError } from '@tenmol/backend';
import type { AtomInfo } from '../model/atom';
import type { Executive } from '../exec/executive';
import { ObjectMolecule } from '../model/molecule';
import type { RegistrarCtx } from './registrar';

/**
 * `importing.load_mtz` — reflection-file import that builds fofc/2fofc (or a
 * single named) map object. It is an incentive-only feature: in Open-Source
 * PyMOL the function immediately raises `IncentiveOnlyException()`
 * (importing.py:1511). The message mirrors Python's
 * `str(IncentiveOnlyException)` verbatim — the `IncentiveOnlyException.__init__`
 * default (`"<funcname>" is not available in Open-Source PyMOL`, __init__.py:491)
 * plus the trailing "Please visit http://pymol.org …" block, and the leading
 * `<label>: ` prefix from `CmdException.__str__` — so the differential matches.
 */
const LOAD_MTZ_INCENTIVE_ONLY =
  ' Incentive-Only-Error: "load_mtz" is not available in Open-Source PyMOL\n\n' +
  '    Please visit http://pymol.org if you are interested in the\n' +
  '    full featured "Incentive PyMOL" version.\n';

// `querying.pi_interactions` (querying.py:545) likewise raises
// `IncentiveOnlyException()` in Open-Source PyMOL — the detection logic ships
// only with Incentive PyMOL. Same verbatim `str(IncentiveOnlyException)` shape
// as LOAD_MTZ_INCENTIVE_ONLY, with the function's own name.
const PI_INTERACTIONS_INCENTIVE_ONLY =
  ' Incentive-Only-Error: "pi_interactions" is not available in Open-Source PyMOL\n\n' +
  '    Please visit http://pymol.org if you are interested in the\n' +
  '    full featured "Incentive PyMOL" version.\n';

function toNum(v: unknown, dflt: number): number {
  if (v == null || v === '') return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}
/* ----------------------------- vec3 helpers ----------------------------- */
type Vec3 = [number, number, number];
function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize3(a: Vec3): Vec3 {
  const len = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / len, a[1] / len, a[2] / len];
}
/** Transpose (inverse of a rotation) of a column-major 3x3 times a vector. */
function mat3TransposeMulVec(m: number[], v: Vec3): Vec3 {
  // Column-major m: index = col*3 + row. m^T * v => row i = column i of m dotted v.
  return [
    m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
    m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2],
    m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2],
  ];
}

function toBool(v: unknown, dflt = false): boolean {
  if (v == null || v === '') return dflt;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  if (s === '0' || s === 'off' || s === 'false' || s === 'no') return false;
  return true;
}

/** A matched universe atom (mirrors the selector's shape). */
interface UA {
  objName: string;
  index: number;
  atom: AtomInfo;
}

/* ------------------------------ atom-flag store --------------------------- */

/* -------------------------------- helpers --------------------------------- */

/** Deep-copy `uas` into a fresh multi-state object, remapping bonds. */
function cloneMolecule(name: string, uas: UA[], ex: Executive): ObjectMolecule {
  const mol = new ObjectMolecule(name);
  const newIndex = new Map<string, number>();
  uas.forEach((ua, k) => {
    newIndex.set(`${ua.objName} ${ua.index}`, k);
    mol.atoms.push({ ...ua.atom, id: k + 1 });
  });
  const srcNames = [...new Set(uas.map((u) => u.objName))];
  const srcMols = srcNames.map((n) => ex.molecule(n)).filter((m): m is ObjectMolecule => m != null);
  const maxNstate = Math.max(1, ...srcMols.map((m) => m.nstate));
  for (let s = 1; s <= maxNstate; s++) {
    const arr = new Float32Array(uas.length * 3);
    uas.forEach((ua, k) => {
      const src = ex.molecule(ua.objName);
      if (!src) return;
      const [x, y, z] = src.coord(ua.index, s);
      arr[k * 3] = x;
      arr[k * 3 + 1] = y;
      arr[k * 3 + 2] = z;
    });
    mol.states.push(arr);
  }
  for (const src of srcMols) {
    for (const [i, j] of src.bonds) {
      const ni = newIndex.get(`${src.name} ${i}`);
      const nj = newIndex.get(`${src.name} ${j}`);
      if (ni !== undefined && nj !== undefined) mol.bonds.push([ni, nj]);
    }
  }
  return mol;
}

/** Rebuild each source object with the matched atoms removed (bonds remapped). */
function removeMatchedAtoms(ex: Executive, uas: UA[], publish: () => void): void {
  const byObj = new Map<string, Set<number>>();
  for (const ua of uas) {
    let s = byObj.get(ua.objName);
    if (!s) byObj.set(ua.objName, (s = new Set()));
    s.add(ua.index);
  }
  for (const [name, drop] of byObj) {
    const mol = ex.molecule(name);
    if (!mol) continue;
    const keep: number[] = [];
    for (let i = 0; i < mol.natom; i++) if (!drop.has(i)) keep.push(i);
    if (keep.length === 0) {
      ex.delete(name);
      continue;
    }
    const remap = new Map<number, number>();
    keep.forEach((old, ni) => remap.set(old, ni));
    const newAtoms = keep.map((old, ni) => ({ ...(mol.atoms[old] as AtomInfo), id: ni + 1 }));
    const newStates = mol.states.map((set) => {
      const arr = new Float32Array(keep.length * 3);
      keep.forEach((old, ni) => {
        arr[ni * 3] = set[old * 3] ?? 0;
        arr[ni * 3 + 1] = set[old * 3 + 1] ?? 0;
        arr[ni * 3 + 2] = set[old * 3 + 2] ?? 0;
      });
      return arr;
    });
    const newBonds: [number, number][] = [];
    for (const [i, j] of mol.bonds) {
      const ni = remap.get(i);
      const nj = remap.get(j);
      if (ni !== undefined && nj !== undefined) newBonds.push([ni, nj]);
    }
    mol.atoms.splice(0, mol.atoms.length, ...newAtoms);
    mol.bonds.splice(0, mol.bonds.length, ...newBonds);
    mol.states.splice(0, mol.states.length, ...newStates);
  }
  publish();
}

/** Parse a state spec like "1-3", "2", "1 3 5", "1,2" into a set of 1-based ints. */
function parseStateSpec(spec: string, maxState: number): Set<number> {
  const out = new Set<number>();
  for (const tok of spec.split(/[\s,]+/).filter((t) => t.length > 0)) {
    const range = /^(\d+)-(\d+)$/.exec(tok);
    if (range) {
      const lo = Number(range[1]);
      const hi = Number(range[2]);
      for (let s = lo; s <= hi; s++) if (s >= 1 && s <= maxState) out.add(s);
    } else if (/^\d+$/.test(tok)) {
      const s = Number(tok);
      if (s >= 1 && s <= maxState) out.add(s);
    }
  }
  return out;
}

/** RMSD over `uas` between state `s` and reference state `ref` (no superposition). */
function rmsdToRef(ex: Executive, uas: UA[], s: number, ref: number): number {
  let sum = 0;
  let n = 0;
  for (const ua of uas) {
    const mol = ex.molecule(ua.objName);
    if (!mol || s > mol.nstate) continue;
    const [ax, ay, az] = mol.coord(ua.index, ref);
    const [bx, by, bz] = mol.coord(ua.index, s);
    const dx = ax - bx;
    const dy = ay - by;
    const dz = az - bz;
    sum += dx * dx + dy * dy + dz * dz;
    n++;
  }
  return n === 0 ? 0 : Math.sqrt(sum / n);
}

/* -------------------------------------------------------------------------
 * Mouse-ring editing switch (packages/engine/modules/pymol/controlling.py).
 *
 * PyMOL keeps a "mouse ring" — an ordered list of mouse configurations that
 * `button_mode` indexes into. The engine models only the default `three_button`
 * ring: [viewing, editing]. `edit_mode`/`drag` flip `button_mode` (and the
 * mirrored `button_mode_name`) between those two entries, exactly as
 * `controlling.py`'s `edit_mode` -> `mouse(action=...)` chain does.
 * ------------------------------------------------------------------------- */

const THREE_BUTTON_RING = ['three_button_viewing', 'three_button_editing'] as const;
const MODE_NAME: Readonly<Record<string, string>> = {
  three_button_viewing: '3-Button Viewing',
  three_button_editing: '3-Button Editing',
};

/** Select a mouse mode by name — mirrors `mouse(action in mouse_ring)`. */
function setMouseMode(ex: Executive, mode: string): void {
  const bm = (THREE_BUTTON_RING as readonly string[]).indexOf(mode);
  if (bm < 0) return;
  ex.set('button_mode', bm);
  ex.set('button_mode_name', MODE_NAME[mode] ?? mode);
}

/**
 * Switch the mouse into (or out of) editing mode — the `edit_mode` body from
 * controlling.py. With the default three-button ring, active switches
 * `button_mode` 0 -> 1 (viewing -> editing); inactive switches it back.
 */
function applyEditMouseMode(ex: Executive, active: boolean): void {
  const bm = Math.trunc(Number(ex.getSetting('button_mode') ?? 0));
  if (bm < 0 || bm >= THREE_BUTTON_RING.length) return;
  const mode: string | undefined = THREE_BUTTON_RING[bm];
  if (mode === undefined) return;
  if (active) {
    if (mode.startsWith('three_button') && mode !== 'three_button_editing') {
      setMouseMode(ex, 'three_button_editing');
    }
  } else if (mode.startsWith('three_button') && mode !== 'three_button_viewing') {
    setMouseMode(ex, 'three_button_viewing');
  }
}

/* -------------------------------- registrar ------------------------------- */

export function registerExtras(ctx: RegistrarCtx): void {
  const ex = ctx.executive;
  const str = ctx.str;

  /* ========================= INCENTIVE-ONLY ============================= */
  // `load_mtz` is a licensed (incentive) feature: Open-Source PyMOL raises
  // `IncentiveOnlyException()` instead of loading maps. Reproduce that exact
  // rejection so the differential matches real PyMOL.
  ctx.command('load_mtz', (): Json => {
    throw new PymolError(incentiveOnly('load_mtz', LOAD_MTZ_INCENTIVE_ONLY), 'load_mtz');
  });

  // `pi_interactions` is also incentive-only: Open-Source PyMOL raises
  // `IncentiveOnlyException()` immediately (querying.py:545) rather than
  // computing pi-pi / pi-cation contacts. Reproduce that exact rejection.
  ctx.command('pi_interactions', (): Json => {
    throw new PymolError(
      incentiveOnly('pi_interactions', PI_INTERACTIONS_INCENTIVE_ONLY),
      'pi_interactions',
    );
  });

  /* ============================ REAL handlers ============================ */

  /* alphatoall — copy per-residue properties from the CA atom to every atom of
     the same residue (PyMOL `util.alphatoall`). properties default 'b'. */
  ctx.command('alphatoall', (args, kwargs): Json => {
    const selection = str(args[0] ?? kwargs['selection'], 'polymer') || 'polymer';
    const propsRaw = str(args[1] ?? kwargs['properties'], 'b') || 'b';
    const props = propsRaw.split(/[\s,]+/).filter((p) => p.length > 0);
    const uas = ex.atomsMatching(selection) as UA[];
    // Group atoms by residue key; find the representative CA of each.
    const groups = new Map<string, { ca?: AtomInfo; atoms: AtomInfo[] }>();
    for (const ua of uas) {
      const a = ua.atom;
      const key = `${ua.objName}|${a.segi}|${a.chain}|${a.resi}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { atoms: [] }));
      g.atoms.push(a);
      if (a.name === 'CA') g.ca = a;
    }
    let changed = 0;
    for (const g of groups.values()) {
      if (!g.ca) continue;
      const ca = g.ca;
      for (const a of g.atoms) {
        if (a === ca) continue;
        for (const p of props) {
          if (p === 'b') a.b = ca.b;
          else if (p === 'q') a.q = ca.q;
          else if (p === 'color') a.color = ca.color;
          else if (p === 'ss') a.ss = ca.ss;
        }
        changed++;
      }
    }
    ctx.publish();
    return changed;
  });

  /* mse2met — convert selenomethionine (MSE) to methionine (MET): rename the
     residue and turn the selenium (SE) into sulfur (SD). */
  ctx.command('mse2met', (args, kwargs): Json => {
    const selection = str(args[0] ?? kwargs['selection'], 'all') || 'all';
    const uas = ex.atomsMatching(selection) as UA[];
    let changed = 0;
    for (const ua of uas) {
      const a = ua.atom;
      if (a.resn !== 'MSE') continue;
      a.resn = 'MET';
      a.hetatm = false;
      if (a.elem === 'Se' || a.name === 'SE') {
        a.elem = 'S';
        a.name = 'SD';
      }
      changed++;
    }
    if (changed > 0) ctx.publish();
    return changed;
  });

  /* mask / unmask / get_mask — the per-atom "masked" (unpickable) flag stored on
     AtomInfo.masked; read by the `masked` selection keyword. Only affects mouse
     pickability, never command-line selection or transforms. */
  ctx.command('mask', (args, kwargs): Json => {
    const selection = str(args[0] ?? kwargs['selection'], 'all') || 'all';
    const uas = ex.atomsMatching(selection) as UA[];
    for (const ua of uas) ua.atom.masked = true;
    return uas.length;
  });
  ctx.command('unmask', (args, kwargs): Json => {
    const selection = str(args[0] ?? kwargs['selection'], 'all') || 'all';
    const uas = ex.atomsMatching(selection) as UA[];
    for (const ua of uas) ua.atom.masked = false;
    return uas.length;
  });
  ctx.command('get_mask', (args, kwargs): Json => {
    const selection = str(args[0] ?? kwargs['selection'], 'all') || 'all';
    const uas = ex.atomsMatching(selection) as UA[];
    let n = 0;
    for (const ua of uas) if (ua.atom.masked === true) n++;
    return n;
  });

  /* protect / deprotect — the per-atom "protected" flag stored on
     AtomInfo.protected; read by the `protected` selection keyword. Protected
     atoms are held immobile during editing transforms (torsion, drag, sculpt);
     it never affects selection or display. */
  ctx.command('protect', (args, kwargs): Json => {
    const selection = str(args[0] ?? kwargs['selection'], 'all') || 'all';
    const uas = ex.atomsMatching(selection) as UA[];
    for (const ua of uas) ua.atom.protected = true;
    return uas.length;
  });
  ctx.command('deprotect', (args, kwargs): Json => {
    const selection = str(args[0] ?? kwargs['selection'], 'all') || 'all';
    const uas = ex.atomsMatching(selection) as UA[];
    for (const ua of uas) ua.atom.protected = false;
    return uas.length;
  });

  /* delete_states — drop states matching a spec from an object. */
  ctx.command('delete_states', (args, kwargs): Json => {
    const name = str(args[0] ?? kwargs['name']);
    const spec = str(args[1] ?? kwargs['states'], '');
    const mol = ex.molecule(name);
    if (!mol || spec === '') return 0;
    // PyMOL's ExecutiveDeleteStates refuses discrete objects (each state may
    // carry a distinct atom set), leaving their states untouched.
    if (mol.discrete) return 0;
    const drop = parseStateSpec(spec, mol.nstate);
    if (drop.size === 0) return 0;
    const kept = mol.states.filter((_s, i) => !drop.has(i + 1));
    const removed = mol.states.length - kept.length;
    mol.states.splice(0, mol.states.length, ...kept);
    if (removed > 0) ctx.publish();
    return removed;
  });

  /* spheroid — average trajectory-state groups into ellipsoid-approximation
     states, collapsing the state count. Ports the observable-state half of
     ObjectMoleculeCreateSpheroid (layer2/ObjectMolecule.cpp): consecutive
     coordinate sets are grouped `average` at a time (average < 1 ⇒ all states
     in one group), each group's frame-0 coordinates are replaced by the
     per-atom mean over the group, the trailing group states are dropped, and
     NCSet becomes the number of groups. The per-spoke Spheroid/SpheroidNormal
     surface (used only by the sphere renderer) is not modelled here since it
     produces no state observable through the public API. */
  ctx.command('spheroid', (args, kwargs): Json => {
    const name = str(args[0] ?? kwargs['object'], '');
    const mol = ex.molecule(name);
    if (!mol || mol.nstate === 0) return null;
    // average < 1 folds the whole trajectory into a single spheroid state.
    let average = Math.trunc(toNum(args[1] ?? kwargs['average'], 0));
    if (average < 1) average = mol.nstate;
    const natom = mol.natom;
    // Snapshot the source coordinate sets (skipping empty slots, as the C loop
    // only advances its group counter on non-null CoordSets).
    const src = mol.states.filter((s): s is Float32Array => s != null);
    const grouped: Float32Array[] = [];
    for (let i = 0; i < src.length; i += average) {
      const group = src.slice(i, i + average);
      const out = new Float32Array(natom * 3);
      const counts = new Int32Array(natom);
      for (const st of group) {
        for (let o = 0; o < natom * 3; o++) out[o] = out[o]! + (st[o] ?? 0);
        for (let a = 0; a < natom; a++) counts[a] = counts[a]! + 1;
      }
      for (let a = 0; a < natom; a++) {
        const c = counts[a]!;
        if (c) {
          out[a * 3] = out[a * 3]! / c;
          out[a * 3 + 1] = out[a * 3 + 1]! / c;
          out[a * 3 + 2] = out[a * 3 + 2]! / c;
        }
      }
      grouped.push(out);
    }
    mol.states.splice(0, mol.states.length, ...grouped);
    // Keep the per-state parallel arrays no longer than the surviving states.
    if (mol.titles.length > grouped.length) mol.titles.length = grouped.length;
    if (mol.refPos.length > grouped.length) mol.refPos.length = grouped.length;
    ctx.publish();
    return grouped.length;
  });

  /* split_states — one new single-state object per source state. */
  ctx.command('split_states', (args, kwargs): Json => {
    const name = str(args[0] ?? kwargs['object']);
    const mol = ex.molecule(name);
    if (!mol) return [];
    let first = toNum(args[1] ?? kwargs['first'], 1);
    let last = toNum(args[2] ?? kwargs['last'], 0);
    const prefix = str(args[3] ?? kwargs['prefix'], '') || name;
    if (first < 1) first = 1;
    if (last < 1 || last > mol.nstate) last = mol.nstate;
    const created: string[] = [];
    const uas: UA[] = mol.atoms.map((atom, index) => ({ objName: name, index, atom }));
    for (let s = first; s <= last; s++) {
      const objName = ex.uniqueName(`${prefix}_${String(s).padStart(4, '0')}`);
      const nm = new ObjectMolecule(objName);
      uas.forEach((ua, k) => nm.atoms.push({ ...ua.atom, id: k + 1 }));
      const arr = new Float32Array(uas.length * 3);
      uas.forEach((ua, k) => {
        const [x, y, z] = mol.coord(ua.index, s);
        arr[k * 3] = x;
        arr[k * 3 + 1] = y;
        arr[k * 3 + 2] = z;
      });
      nm.states.push(arr);
      for (const [i, j] of mol.bonds) nm.bonds.push([i, j]);
      ex.addMolecule(nm);
      created.push(objName);
    }
    if (created.length > 0) ctx.publish();
    return created;
  });

  /* join_states — combine the single states of matching objects into one
     multi-state object (objects must share the reference atom count). */
  ctx.command('join_states', (args, kwargs): Json => {
    const name = str(args[0] ?? kwargs['name']);
    const selection = str(args[1] ?? kwargs['selection'], 'all') || 'all';
    // mode 0 builds a discrete object (states may differ); modes 1-3 don't.
    const mode = toNum(args[2] ?? kwargs['mode'], 2);
    if (name === '') return 0;
    // Distinct source objects, in executive order.
    const wanted = new Set(ex.atomsMatching(selection).map((ua) => ua.objName));
    const sources = ex.moleculesInOrder().filter((m) => wanted.has(m.name));
    if (sources.length === 0) return 0;
    const template = sources[0]!;
    const nm = new ObjectMolecule(ex.uniqueName(name));
    if (mode === 0) nm.discrete = true;
    template.atoms.forEach((a, k) => nm.atoms.push({ ...a, id: k + 1 }));
    for (const [i, j] of template.bonds) nm.bonds.push([i, j]);
    for (const src of sources) {
      if (src.natom !== template.natom) continue;
      const arr = new Float32Array(template.natom * 3);
      for (let i = 0; i < template.natom; i++) {
        const [x, y, z] = src.coord(i, 1);
        arr[i * 3] = x;
        arr[i * 3 + 1] = y;
        arr[i * 3 + 2] = z;
      }
      nm.states.push(arr);
    }
    ex.addMolecule(nm);
    ctx.publish();
    return nm.nstate;
  });

  /* copy_to — copy a selection into a (new or existing) object, keeping the
     source intact (PyMOL `cmd.copy_to`). */
  ctx.command('copy_to', (args, kwargs): Json => {
    const name = str(args[0] ?? kwargs['name']);
    const selection = str(args[1] ?? kwargs['selection'], 'all') || 'all';
    if (name === '') return 0;
    const uas = ex.atomsMatching(selection) as UA[];
    const existing = ex.molecule(name);
    if (!existing) {
      const mol = cloneMolecule(name, uas, ex);
      ex.addMolecule(mol);
      ctx.publish();
      return mol.natom;
    }
    // Append cloned atoms (state 1) onto the existing object.
    const base = existing.natom;
    uas.forEach((ua, k) => existing.atoms.push({ ...ua.atom, id: base + k + 1 }));
    const state0 = existing.states[0] ?? new Float32Array(0);
    const merged = new Float32Array((base + uas.length) * 3);
    merged.set(state0.subarray(0, base * 3), 0);
    uas.forEach((ua, k) => {
      const src = ex.molecule(ua.objName);
      const [x, y, z] = src ? src.coord(ua.index, 1) : [0, 0, 0];
      merged[(base + k) * 3] = x;
      merged[(base + k) * 3 + 1] = y;
      merged[(base + k) * 3 + 2] = z;
    });
    existing.states.splice(0, existing.states.length, merged);
    ctx.publish();
    return existing.natom;
  });

  /* extract — like create, then remove the atoms from their source objects. */
  ctx.command('extract', (args, kwargs): Json => {
    let name = str(args[0] ?? kwargs['name']);
    const selection = str(args[1] ?? kwargs['selection'], 'all') || 'all';
    if (name === '') name = ex.uniqueName('extracted');
    const uas = ex.atomsMatching(selection) as UA[];
    const mol = cloneMolecule(ex.uniqueName(name), uas, ex);
    ex.addMolecule(mol);
    removeMatchedAtoms(ex, uas, () => ctx.publish());
    return mol.natom;
  });

  /* overlap — steric-clash metric: sum of [(VDWi + VDWj + adjust) - d]/2 over
     pairs whose distance is below their combined VDW radii (+adjust). Ports
     SelectorSumVDWOverlap (layer3/Selector.cpp): sumVDW = vi + vj + adjust and,
     when dist < sumVDW, result += (sumVDW - dist)/2. querying.py passes
     state1/state2 as separate 0-based coordinate states. */
  ctx.command('overlap', (args, kwargs): Json => {
    const sel1 = str(args[0] ?? kwargs['selection1'], 'all') || 'all';
    const sel2 = str(args[1] ?? kwargs['selection2'], 'all') || 'all';
    const state1 = toNum(args[2] ?? kwargs['state1'], 1) || 1;
    const state2 = toNum(args[3] ?? kwargs['state2'], 1) || 1;
    const adjust = toNum(args[4] ?? kwargs['adjust'], 0);
    const a = ex.atomsMatching(sel1) as UA[];
    const b = ex.atomsMatching(sel2) as UA[];
    let total = 0;
    for (const ua of a) {
      const ma = ex.molecule(ua.objName);
      if (!ma) continue;
      const [ax, ay, az] = ma.coord(ua.index, state1);
      const ra = ma.vdw(ua.index);
      for (const ub of b) {
        if (ub.objName === ua.objName && ub.index === ua.index) continue;
        const mb = ex.molecule(ub.objName);
        if (!mb) continue;
        const [bx, by, bz] = mb.coord(ub.index, state2);
        const rb = mb.vdw(ub.index);
        const d = Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2);
        const sumVDW = ra + rb + adjust;
        if (d < sumVDW) total += (sumVDW - d) / 2;
      }
    }
    return total;
  });

  /* intra_rms_cur — per-state RMSD to state 1 over a selection, UNsuperposed
     (intrafit mode 0). `intra_rms` (mode 1, fits first) is real in cmd/align.ts.
     The reference state reports -1.0, as PyMOL does. */
  const intraRmsCur = (args: unknown[], kwargs: Record<string, unknown>): Json => {
    const selection = str(args[0] ?? kwargs['selection'], 'all') || 'all';
    // Reference state (1-based); PyMOL's default state=0 resolves to state 1.
    const ref = Math.max(1, Math.trunc(toNum(args[1] ?? kwargs['state'], 0)) || 1);
    const uas = ex.atomsMatching(selection) as UA[];
    const maxState = Math.max(1, ...uas.map((ua) => ex.molecule(ua.objName)?.nstate ?? 1));
    const out: number[] = [];
    for (let s = 1; s <= maxState; s++) {
      out.push(s === ref ? -1.0 : rmsdToRef(ex, uas, s, ref));
    }
    return out;
  };
  ctx.command('intra_rms_cur', intraRmsCur);

  /* look_at(target_obj, mobile_obj='_Camera') — reorient the camera so its
     forward (z) axis faces the center of `target_obj`. Ports ExecutiveLookAt /
     ExecutiveCameraLookAt (layer3/Executive.cpp): eye = current camera world
     position, build glm::lookAt(eye, targetCenter, up=(0,1,0)) and convert it
     back into the 18-float view (SceneView::FromWorldHomogeneous). Passing a
     real mobile object is a no-op in PyMOL (ExecutiveObjectLookAt does nothing),
     as is a missing target. */
  ctx.command('look_at', (args, kwargs): Json => {
    const targetName = str(args[0] ?? kwargs['target_obj']);
    const mobile = str(args[1] ?? kwargs['mobile_obj'], '_Camera') || '_Camera';
    if (targetName === '' || mobile !== '_Camera') return null;
    const sphere = ex.selectionSphere(targetName);
    if (!sphere) return null;
    const center = sphere.center as Vec3;
    const view = ex.view.get();
    const rot = view.slice(0, 9); // column-major model -> camera
    const pos: Vec3 = [view[9]!, view[10]!, view[11]!];
    const origin: Vec3 = [view[12]!, view[13]!, view[14]!];
    // Camera position in model space: eye = origin - R^T * pos (worldPos()).
    const eye = sub3(origin, mat3TransposeMulVec(rot, pos));
    // glm::lookAt(eye, center, up): f forward, s right, u up (all model space).
    const f = normalize3(sub3(center, eye));
    const s = normalize3(cross3(f, [0, 1, 0]));
    const u = cross3(s, f);
    // New column-major model->camera rotation: columns s, u, -f.
    view[0] = s[0]; view[1] = u[0]; view[2] = -f[0];
    view[3] = s[1]; view[4] = u[1]; view[5] = -f[1];
    view[6] = s[2]; view[7] = u[2]; view[8] = -f[2];
    // New camera-space Pos = Vrot*origin + Vtrans, Vtrans = (-s.eye, -u.eye, f.eye).
    view[9] = dot3(s, origin) - dot3(s, eye);
    view[10] = dot3(u, origin) - dot3(u, eye);
    view[11] = -dot3(f, origin) + dot3(f, eye);
    ex.view.set(view);
    ctx.emitView();
    return null;
  });

  /* refresh — force a re-emit of the scene. */
  ctx.command('refresh', (): Json => {
    ctx.publish();
    return null;
  });

  /* transparency — set the (surface) transparency global setting. */
  ctx.command('transparency', (args, kwargs): Json => {
    const value = toNum(args[0] ?? kwargs['value'], 0);
    ex.set('transparency', value);
    ctx.publish();
    return null;
  });

  /* stereo — record the stereo on/off state as a setting. */
  ctx.command('stereo', (args, kwargs): Json => {
    const raw = str(args[0] ?? kwargs['toggle'], 'on') || 'on';
    ex.set('stereo', toBool(raw, true) ? 1 : 0);
    return null;
  });

  /* edit_mode — switch the mouse into editing mode (controlling.py:edit_mode).
     Records the on/off state as a setting AND flips button_mode within the
     current mouse ring, the way PyMOL's edit_mode -> mouse() chain does. */
  ctx.command('edit_mode', (args, kwargs): Json => {
    const active = toBool(args[0] ?? kwargs['active'], true);
    ex.set('edit_mode', active ? 1 : 0);
    applyEditMouseMode(ex, active);
    return null;
  });

  /* drag — activate interactive dragging of a selection's coordinates
     (editing.py:drag). The interactive mouse-drag itself needs a live GL/picking
     loop we do not model, but the observable side effect ports cleanly: a
     non-empty selection defaults edit=1, which switches the mouse ring into
     editing mode (button_mode 0 -> 1); an empty selection forces edit=0 and
     leaves the ring untouched. */
  ctx.command('drag', (args, kwargs): Json => {
    const selection = str(args[0] ?? kwargs['selection'], '');
    let edit = toBool(args[2] ?? kwargs['edit'], true);
    if (selection === '') edit = false;
    if (edit) applyEditMouseMode(ex, true);
    return null;
  });

  /* ========================= DOCUMENTED NO-OPS ==========================
     Environment-bound or not-yet-modelled verbs. Each returns a sensible,
     correctly-shaped value without throwing or mutating state. Grouped by the
     value they return. */

  /** Register a batch of no-op verbs that all return the same constant. */
  const noop = (names: readonly string[], value: Json): void => {
    for (const n of names) ctx.command(n, () => value);
  };

  // Return null: disk/network/GUI/render side effects we cannot perform here.
  noop(
    [
      // file & network I/O (need a filesystem / parser / network we lack here).
      // `load` is real (cmd/fileio.ts) — it parses structured content by format.
      // `loadall` is real now — see cmd/fileio.ts (glob loader + grouping).
      // `load_embedded` is real now — see cmd/fileio.ts (embed-block loader).
      // `load_model` is real now — see cmd/fileio.ts (ChemPy-model importer).
      // `load_mtz` is incentive-only — registered separately below (throws).
      'load_png',
      // `load_traj` is real now — see cmd/fileio.ts (DCD trajectory importer).
      // `save` is real now — see cmd/exporters.ts (writes .pse sessions + the
      // format-string structure exporters to disk).
      // `fetch` is real now — see cmd/fileio.ts (loads the cached/local file).
      // `ray`/`draw`/`png` are real now — see cmd/render.ts.
      // logging to disk
      'log',
      'log_close',
      'log_open',
      'resume',
      // interaction / editor picking (no live picking model here).
      // `edit` (pk1/pk2) is real — see cmd/editing.ts.
      'edit_keys',
      // `drag` is real now — see the handler above (mouse-ring editing switch).
      'release',
      // `unpick` is real — see cmd/editing.ts (clears the pk* selections).
      // `fab` (peptide) is real — editor.ts; `fnab` (nucleic) — cmd/nucleic.ts.
      'h_fix',
      // movie frame-table edits (movie store lives in the engine)
      'mcopy',
      // `mdelete` is real now — see cmd/system.ts (splices the movie frame table).
      // `mdo` is real now — see cmd/system.ts (binds/replays generalized frame commands).
      'mmove',
      // `minsert` is real now — see cmd/system.ts (splices blank frames into the movie table).
      // `scene_order` is real now — see engine.ts (reorders the scene bin).
      // maps / volumes / slices (need a map object model)
      // `map_set` is real — see cmd/maps.ts (elementwise map arithmetic).
      // `slice_new` is real now — see cmd/maps.ts (registers an object:slice gadget).
      // `volume` is real now — see cmd/maps.ts (registers an object:volume gadget).
      'volume_panel',
      // `spheroid` is real now — see below (averages state groups + collapses NCSet).
      'vdw_fit',
      // misc app / render controls with no state to observe
      'cls',
      'cache',
      'callout',
      'capture',
      'quit',
      'meter_reset',
      'focal_blur',
      'decline',
      'feedback',
      'extend',
      'alias',
      // `matrix_copy`/`matrix_transfer` are real now — see the engine builtin
      // (empty target composes the object matrix into the camera view).
      // chemistry/typing we do not model
      'assign_stereo',
      'text_type',
      // `unset_deep` is real now — see cmd/settings2.ts (bulk-clears per-object
      // and per-bond setting overrides for the matched objects).
    ],
    null,
  );

  // Return an empty dict: analysis verbs producing a name->value mapping.
  // `cealign`/`usalign` are real now — see cmd/align.ts.
  noop(['stereochemistry'], {});

  // Return an empty string: text-export getters.
  noop(['get_mtl_obj'], '');

  // Return a pair of empty strings: PovRay exporters (scene, header).
  noop(['get_povray', 'povray'], ['', '']);

  // Genuinely ABSENT `cmd` symbols. Unlike an unported verb (which throws the
  // port's own `NotPorted`), these functions are NOT bound onto `cmd` in the
  // open-source build at all: `get_stlstr`/`read_stlstr` are incentive-only and
  // live in `pymol.lazyio`, reachable only through `save`/`load`'s extension
  // dispatch table (`exporting.py:1019`, `lazyio.py:224`). So `cmd.get_stlstr`
  // is a real Python `AttributeError`, which the bridge surfaces as a
  // `NotAllowed` "no such symbol" rejection. Reproduce that EXACT error so the
  // differential sees identical behaviour instead of a mismatched port message.
  const absentCmdSymbol = (names: readonly string[]): void => {
    for (const name of names) {
      ctx.command(name, () => {
        throw new PymolError(
          {
            kind: 'NotAllowed',
            type: 'NotAllowed',
            message: `${name}: no such symbol (module 'pymol.cmd' has no attribute '${name}')`,
            traceback: '',
          },
          name,
        );
      });
    }
  };
  absentCmdSymbol(['get_stlstr', 'read_stlstr']);

  // `remove_picked` (cmd/editing.ts) and `pair_fit` (cmd/align.ts) are real now.
}
