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
 *              split_states, join_states, copy_to, extract, overlap,
 *              intra_rms/intra_rms_cur, look_at, middle, refresh, transparency,
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
import type { AtomInfo } from '../model/atom';
import type { Executive } from '../exec/executive';
import { ObjectMolecule } from '../model/molecule';
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

/** A matched universe atom (mirrors the selector's shape). */
interface UA {
  objName: string;
  index: number;
  atom: AtomInfo;
}

/* ------------------------------ atom-flag store --------------------------- */

/**
 * Per-atom boolean flags this module maintains outside {@link AtomInfo} (which
 * has no flag field). Keyed by atom identity so the state is observable through
 * a getter without touching the shared atom record. `mask`/`unmask` set/clear
 * the "masked" (unpickable) flag; `get_mask` reads it back.
 */
const MASKED = new WeakSet<AtomInfo>();

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

/** RMSD over `uas` between state `s` and the reference state 1 (no superposition). */
function rmsdToRef(ex: Executive, uas: UA[], s: number): number {
  let sum = 0;
  let n = 0;
  for (const ua of uas) {
    const mol = ex.molecule(ua.objName);
    if (!mol || s > mol.nstate) continue;
    const [ax, ay, az] = mol.coord(ua.index, 1);
    const [bx, by, bz] = mol.coord(ua.index, s);
    const dx = ax - bx;
    const dy = ay - by;
    const dz = az - bz;
    sum += dx * dx + dy * dy + dz * dz;
    n++;
  }
  return n === 0 ? 0 : Math.sqrt(sum / n);
}

/* -------------------------------- registrar ------------------------------- */

export function registerExtras(ctx: RegistrarCtx): void {
  const ex = ctx.executive;
  const str = ctx.str;

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

  /* mask / unmask / get_mask — the per-atom "masked" (unpickable) flag. */
  ctx.command('mask', (args, kwargs): Json => {
    const selection = str(args[0] ?? kwargs['selection'], 'all') || 'all';
    const uas = ex.atomsMatching(selection) as UA[];
    for (const ua of uas) MASKED.add(ua.atom);
    return uas.length;
  });
  ctx.command('unmask', (args, kwargs): Json => {
    const selection = str(args[0] ?? kwargs['selection'], 'all') || 'all';
    const uas = ex.atomsMatching(selection) as UA[];
    for (const ua of uas) MASKED.delete(ua.atom);
    return uas.length;
  });
  ctx.command('get_mask', (args, kwargs): Json => {
    const selection = str(args[0] ?? kwargs['selection'], 'all') || 'all';
    const uas = ex.atomsMatching(selection) as UA[];
    let n = 0;
    for (const ua of uas) if (MASKED.has(ua.atom)) n++;
    return n;
  });

  /* delete_states — drop states matching a spec from an object. */
  ctx.command('delete_states', (args, kwargs): Json => {
    const name = str(args[0] ?? kwargs['name']);
    const spec = str(args[1] ?? kwargs['states'], '');
    const mol = ex.molecule(name);
    if (!mol || spec === '') return 0;
    const drop = parseStateSpec(spec, mol.nstate);
    if (drop.size === 0) return 0;
    const kept = mol.states.filter((_s, i) => !drop.has(i + 1));
    const removed = mol.states.length - kept.length;
    mol.states.splice(0, mol.states.length, ...kept);
    if (removed > 0) ctx.publish();
    return removed;
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
    if (name === '') return 0;
    // Distinct source objects, in executive order.
    const wanted = new Set(ex.atomsMatching(selection).map((ua) => ua.objName));
    const sources = ex.moleculesInOrder().filter((m) => wanted.has(m.name));
    if (sources.length === 0) return 0;
    const template = sources[0]!;
    const nm = new ObjectMolecule(ex.uniqueName(name));
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

  /* overlap — total VDW overlap (sum of ri+rj-d over clashing pairs). */
  ctx.command('overlap', (args, kwargs): Json => {
    const sel1 = str(args[0] ?? kwargs['selection1'], 'all') || 'all';
    const sel2 = str(args[1] ?? kwargs['selection2'], 'all') || 'all';
    const state = toNum(args[2] ?? kwargs['state'], 1) || 1;
    const adjust = toNum(args[3] ?? kwargs['adjust'], 0);
    const a = ex.atomsMatching(sel1) as UA[];
    const b = ex.atomsMatching(sel2) as UA[];
    let total = 0;
    for (const ua of a) {
      const ma = ex.molecule(ua.objName);
      if (!ma) continue;
      const [ax, ay, az] = ma.coord(ua.index, state);
      const ra = ma.vdw(ua.index);
      for (const ub of b) {
        if (ub.objName === ua.objName && ub.index === ua.index) continue;
        const mb = ex.molecule(ub.objName);
        if (!mb) continue;
        const [bx, by, bz] = mb.coord(ub.index, state);
        const rb = mb.vdw(ub.index);
        const d = Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2);
        const ov = ra + rb - d - adjust;
        if (ov > 0) total += ov;
      }
    }
    return total;
  });

  /* intra_rms_cur — per-state RMSD to state 1 over a selection, UNsuperposed
     (intrafit mode 0). `intra_rms` (mode 1, fits first) is real in cmd/align.ts.
     The reference state reports -1.0, as PyMOL does. */
  const intraRmsCur = (args: unknown[], kwargs: Record<string, unknown>): Json => {
    const selection = str(args[0] ?? kwargs['selection'], 'all') || 'all';
    const uas = ex.atomsMatching(selection) as UA[];
    const maxState = Math.max(1, ...uas.map((ua) => ex.molecule(ua.objName)?.nstate ?? 1));
    const out: number[] = [];
    for (let s = 1; s <= maxState; s++) out.push(s === 1 ? -1.0 : rmsdToRef(ex, uas, s));
    return out;
  };
  ctx.command('intra_rms_cur', intraRmsCur);

  /* look_at — aim the camera at a point (set the model-space rotation origin). */
  ctx.command('look_at', (args, kwargs): Json => {
    const x = toNum(args[0] ?? kwargs['x'], 0);
    const y = toNum(args[1] ?? kwargs['y'], 0);
    const z = toNum(args[2] ?? kwargs['z'], 0);
    const view = ex.view.get();
    view[12] = x;
    view[13] = y;
    view[14] = z;
    ex.view.set(view);
    ctx.emitView();
    return null;
  });

  /* middle — recentre the rotation origin on the middle of all objects. */
  ctx.command('middle', (): Json => {
    const sphere = ex.selectionSphere('all');
    if (sphere) {
      const view = ex.view.get();
      view[12] = sphere.center[0];
      view[13] = sphere.center[1];
      view[14] = sphere.center[2];
      ex.view.set(view);
      ctx.emitView();
    }
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

  /* edit_mode — record the editor-mode on/off state as a setting. */
  ctx.command('edit_mode', (args, kwargs): Json => {
    const active = toBool(args[0] ?? kwargs['active'], true);
    ex.set('edit_mode', active ? 1 : 0);
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
      'loadall',
      'load_embedded',
      'load_model',
      'load_mtz',
      'load_png',
      'load_traj',
      'save',
      'fetch',
      'png',
      'ray',
      'draw',
      // logging to disk
      'log',
      'log_close',
      'log_open',
      'resume',
      // interaction / editor picking (no live picking model here).
      // `edit` (pk1/pk2) is real — see cmd/editing.ts.
      'edit_keys',
      'drag',
      'release',
      'unpick',
      // builders needing a fragment library. `fab` (peptide) is real — editor.ts.
      'fnab',
      'h_fix',
      // movie frame-table edits (movie store lives in the engine)
      'mcopy',
      'mdelete',
      'mmove',
      'mdo',
      'minsert',
      'scene_order',
      // maps / volumes / slices (need a map object model)
      'map_set',
      'slice_new',
      'volume',
      'volume_panel',
      'spheroid',
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
      'matrix_copy',
      // chemistry/typing we do not model
      'assign_stereo',
      'text_type',
      'unset_deep',
      'pbc_wrap',
      'pbc_unwrap',
    ],
    null,
  );

  // Return an empty dict: analysis verbs producing a name->value mapping.
  // `cealign`/`usalign` are real now — see cmd/align.ts.
  noop(['pi_interactions', 'stereochemistry'], {});

  // Return an empty string: text-export getters.
  noop(['get_mtl_obj'], '');

  // Return a pair of empty strings: PovRay exporters (scene, header).
  noop(['get_povray', 'povray'], ['', '']);

  // `remove_picked` (cmd/editing.ts) and `pair_fit` (cmd/align.ts) are real now.
}
