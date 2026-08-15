/**
 * The `sculpt` command subsystem — a lightweight molecular-mechanics geometry
 * optimizer, PyMOL's `SculptCache`/`ObjectMoleculeSculpt*` (layer2/Sculpt.cpp)
 * plus the `minimize`/`clean`/`smooth` verbs.
 *
 * The energy is a sum of harmonic restraints snapshotted from a reference
 * geometry:
 *
 *   - bond terms      E = ½·k·(d − r0)²                 (r0 = reference length)
 *   - 1-3 angle terms E = ½·kθ·(θ − θ0)²                (θ0 = reference angle)
 *   - nonbonded clash E = ½·kⁿᵇ·(d − d0)²  for d < d0   (d0 = vdw-radius sum)
 *
 * `sculpt_iterate` runs steepest descent with a backtracking step so the energy
 * is monotonically non-increasing (PyMOL uses a fixed-step SHAKE-like update; a
 * backtracking line search gives the same convergence with a clean monotonicity
 * guarantee). `minimize`/`clean` idealize toward covalent-radius bond lengths
 * (like PyMOL's `clean`), while `sculpt_activate` snapshots the *current*
 * geometry as the reference (like interactive sculpting, which preserves the
 * deposited coordinates). `smooth` box-averages coordinates across states
 * (temporal) or, for a single state, across bonded neighbours (spatial).
 */
import type { Json } from '@tenmol/protocol';
import type { ObjectMolecule } from '../model/molecule';
import type { RegistrarCtx } from './registrar';

/* ------------------------------ arg parsing ------------------------------ */

function pick(args: unknown[], kwargs: Record<string, unknown>, i: number, name: string): unknown {
  const a = args[i];
  if (a !== undefined && a !== null && a !== '') return a;
  return kwargs[name];
}

function num(v: unknown, dflt: number): number {
  if (v === undefined || v === null || v === '') return dflt;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : dflt;
}

/* ---------------------------- covalent radii ----------------------------- */

/** Covalent radii (Å) for the common organic elements; fallback 0.77. */
const COVALENT: Readonly<Record<string, number>> = {
  H: 0.31, C: 0.76, N: 0.71, O: 0.66, F: 0.57,
  P: 1.07, S: 1.05, CL: 1.02, BR: 1.2, I: 1.39,
};
function covalent(elem: string): number {
  return COVALENT[elem.toUpperCase()] ?? 0.77;
}

/** van-der-Waals radii (Å) used for the soft clash term; fallback 1.8. */
const VDW: Readonly<Record<string, number>> = {
  H: 1.2, C: 1.7, N: 1.55, O: 1.52, F: 1.47,
  P: 1.8, S: 1.8, CL: 1.75, BR: 1.85, I: 1.98,
};
function vdw(elem: string): number {
  return VDW[elem.toUpperCase()] ?? 1.8;
}

/* ----------------------------- restraint model --------------------------- */

interface BondTerm {
  i: number;
  j: number;
  r0: number;
  k: number;
}
interface AngleTerm {
  i: number;
  c: number; // centre (apex) atom
  j: number;
  theta0: number;
  k: number;
}
interface NbTerm {
  i: number;
  j: number;
  d0: number;
  k: number;
}
interface Restraints {
  state: number;
  bonds: BondTerm[];
  angles: AngleTerm[];
  nb: NbTerm[];
}

const K_BOND = 10.0;
const K_ANGLE = 4.0;
const K_NB = 4.0;
/** Clash triggers below this fraction of the vdw-radius sum. */
const VDW_CLASH_SCALE = 0.9;

/** A flat Float64 copy of one state's coordinates (natom*3). */
function readState(mol: ObjectMolecule, state: number): Float64Array {
  const set = mol.states[state - 1];
  const n = mol.natom;
  const out = new Float64Array(n * 3);
  if (set) for (let k = 0; k < out.length && k < set.length; k++) out[k] = set[k]!;
  return out;
}

function writeState(mol: ObjectMolecule, state: number, x: Float64Array): void {
  const set = mol.states[state - 1];
  if (!set) return;
  for (let k = 0; k < set.length && k < x.length; k++) set[k] = x[k]!;
}

/**
 * Snapshot the restraint set for an object in the given state.
 * `bondRef='current'` takes reference lengths from the present geometry;
 * `bondRef='covalent'` uses covalent-radius sums (idealisation, for clean).
 */
function buildRestraints(
  mol: ObjectMolecule,
  state: number,
  bondRef: 'current' | 'covalent',
): Restraints {
  const x = readState(mol, state);
  const dist = (i: number, j: number): number => {
    const dx = x[i * 3]! - x[j * 3]!;
    const dy = x[i * 3 + 1]! - x[j * 3 + 1]!;
    const dz = x[i * 3 + 2]! - x[j * 3 + 2]!;
    return Math.hypot(dx, dy, dz);
  };

  // Adjacency for angle enumeration and nonbonded exclusion.
  const nbrs = new Map<number, number[]>();
  const addNbr = (a: number, b: number): void => {
    let l = nbrs.get(a);
    if (!l) nbrs.set(a, (l = []));
    l.push(b);
  };

  const bonds: BondTerm[] = [];
  for (const [i, j] of mol.bonds) {
    const r0 =
      bondRef === 'covalent'
        ? covalent(mol.atoms[i]!.elem) + covalent(mol.atoms[j]!.elem)
        : dist(i, j);
    bonds.push({ i, j, r0, k: K_BOND });
    addNbr(i, j);
    addNbr(j, i);
  }

  // 1-3 angle terms: for every apex atom, each unordered pair of neighbours.
  const angles: AngleTerm[] = [];
  const excluded = new Set<string>();
  const key = (a: number, b: number): string => (a < b ? `${a},${b}` : `${b},${a}`);
  for (const [c, list] of nbrs) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const i = list[a]!;
        const j = list[b]!;
        angles.push({ i, c, j, theta0: angleOf(x, i, c, j), k: K_ANGLE });
        excluded.add(key(i, j)); // 1-3 pair
      }
    }
  }
  for (const [i, j] of mol.bonds) excluded.add(key(i, j)); // 1-2 pair

  // Soft nonbonded repulsion for non-excluded pairs that clash.
  const nb: NbTerm[] = [];
  const n = mol.natom;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (excluded.has(key(i, j))) continue;
      const d0 = (vdw(mol.atoms[i]!.elem) + vdw(mol.atoms[j]!.elem)) * VDW_CLASH_SCALE;
      nb.push({ i, j, d0, k: K_NB });
    }
  }

  return { state, bonds, angles, nb };
}

/** Angle (radians) at apex `c` between arms to `i` and `j`. */
function angleOf(x: Float64Array, i: number, c: number, j: number): number {
  const ux = x[i * 3]! - x[c * 3]!;
  const uy = x[i * 3 + 1]! - x[c * 3 + 1]!;
  const uz = x[i * 3 + 2]! - x[c * 3 + 2]!;
  const vx = x[j * 3]! - x[c * 3]!;
  const vy = x[j * 3 + 1]! - x[c * 3 + 1]!;
  const vz = x[j * 3 + 2]! - x[c * 3 + 2]!;
  const ru = Math.hypot(ux, uy, uz) || 1e-9;
  const rv = Math.hypot(vx, vy, vz) || 1e-9;
  let c0 = (ux * vx + uy * vy + uz * vz) / (ru * rv);
  if (c0 > 1) c0 = 1;
  else if (c0 < -1) c0 = -1;
  return Math.acos(c0);
}

/* ------------------------- energy + analytic gradient -------------------- */

/** Total restraint energy; if `g` is given, accumulate ∂E/∂x into it. */
function energyGrad(r: Restraints, x: Float64Array, g: Float64Array | null): number {
  if (g) g.fill(0);
  let E = 0;

  // Bond terms: E = ½k(d−r0)², dE/dxi = k(d−r0)·(xi−xj)/d.
  for (const { i, j, r0, k } of r.bonds) {
    const dx = x[i * 3]! - x[j * 3]!;
    const dy = x[i * 3 + 1]! - x[j * 3 + 1]!;
    const dz = x[i * 3 + 2]! - x[j * 3 + 2]!;
    const d = Math.hypot(dx, dy, dz) || 1e-9;
    const diff = d - r0;
    E += 0.5 * k * diff * diff;
    if (g) {
      const f = (k * diff) / d;
      g[i * 3] = g[i * 3]! + f * dx;
      g[i * 3 + 1] = g[i * 3 + 1]! + f * dy;
      g[i * 3 + 2] = g[i * 3 + 2]! + f * dz;
      g[j * 3] = g[j * 3]! - f * dx;
      g[j * 3 + 1] = g[j * 3 + 1]! - f * dy;
      g[j * 3 + 2] = g[j * 3 + 2]! - f * dz;
    }
  }

  // Angle terms: E = ½k(θ−θ0)², with the standard angle-gradient arms.
  for (const { i, c, j, theta0, k } of r.angles) {
    const ux = x[i * 3]! - x[c * 3]!;
    const uy = x[i * 3 + 1]! - x[c * 3 + 1]!;
    const uz = x[i * 3 + 2]! - x[c * 3 + 2]!;
    const vx = x[j * 3]! - x[c * 3]!;
    const vy = x[j * 3 + 1]! - x[c * 3 + 1]!;
    const vz = x[j * 3 + 2]! - x[c * 3 + 2]!;
    const ru = Math.hypot(ux, uy, uz) || 1e-9;
    const rv = Math.hypot(vx, vy, vz) || 1e-9;
    let cth = (ux * vx + uy * vy + uz * vz) / (ru * rv);
    if (cth > 1) cth = 1;
    else if (cth < -1) cth = -1;
    const theta = Math.acos(cth);
    const diff = theta - theta0;
    E += 0.5 * k * diff * diff;
    if (!g) continue;
    const sth = Math.sqrt(1 - cth * cth);
    if (sth < 1e-6) continue; // (near-)linear: gradient ill-defined, skip
    // dθ/dxi = (cosθ·û/|u| − v̂/|v|)/sinθ ; symmetric for j; apex balances.
    const pref = (k * diff) / sth;
    const gix = pref * ((cth * ux) / (ru * ru) - vx / (ru * rv));
    const giy = pref * ((cth * uy) / (ru * ru) - vy / (ru * rv));
    const giz = pref * ((cth * uz) / (ru * ru) - vz / (ru * rv));
    const gjx = pref * ((cth * vx) / (rv * rv) - ux / (ru * rv));
    const gjy = pref * ((cth * vy) / (rv * rv) - uy / (ru * rv));
    const gjz = pref * ((cth * vz) / (rv * rv) - uz / (ru * rv));
    g[i * 3] = g[i * 3]! + gix;
    g[i * 3 + 1] = g[i * 3 + 1]! + giy;
    g[i * 3 + 2] = g[i * 3 + 2]! + giz;
    g[j * 3] = g[j * 3]! + gjx;
    g[j * 3 + 1] = g[j * 3 + 1]! + gjy;
    g[j * 3 + 2] = g[j * 3 + 2]! + gjz;
    g[c * 3] = g[c * 3]! - (gix + gjx);
    g[c * 3 + 1] = g[c * 3 + 1]! - (giy + gjy);
    g[c * 3 + 2] = g[c * 3 + 2]! - (giz + gjz);
  }

  // Soft nonbonded repulsion: one-sided harmonic, active only inside d0.
  for (const { i, j, d0, k } of r.nb) {
    const dx = x[i * 3]! - x[j * 3]!;
    const dy = x[i * 3 + 1]! - x[j * 3 + 1]!;
    const dz = x[i * 3 + 2]! - x[j * 3 + 2]!;
    const d = Math.hypot(dx, dy, dz) || 1e-9;
    if (d >= d0) continue;
    const diff = d - d0;
    E += 0.5 * k * diff * diff;
    if (g) {
      const f = (k * diff) / d;
      g[i * 3] = g[i * 3]! + f * dx;
      g[i * 3 + 1] = g[i * 3 + 1]! + f * dy;
      g[i * 3 + 2] = g[i * 3 + 2]! + f * dz;
      g[j * 3] = g[j * 3]! - f * dx;
      g[j * 3 + 1] = g[j * 3 + 1]! - f * dy;
      g[j * 3 + 2] = g[j * 3 + 2]! - f * dz;
    }
  }

  return E;
}

/**
 * Steepest descent with backtracking line search: on each cycle move down the
 * gradient by `alpha`, halving `alpha` until the energy does not increase (and
 * growing it on success). Guarantees a monotonically non-increasing energy and
 * leaves an already-minimal geometry untouched. Returns the final energy.
 */
function minimizeCoords(r: Restraints, x: Float64Array, cycles: number): number {
  const n = x.length;
  const g = new Float64Array(n);
  const trial = new Float64Array(n);
  let E = energyGrad(r, x, null);
  let alpha = 1e-3;
  for (let c = 0; c < cycles; c++) {
    energyGrad(r, x, g);
    let gmax = 0;
    for (let k = 0; k < n; k++) gmax = Math.max(gmax, Math.abs(g[k]!));
    if (gmax < 1e-9) break; // at a stationary point
    let stepped = false;
    for (let tries = 0; tries < 40; tries++) {
      for (let k = 0; k < n; k++) trial[k] = x[k]! - alpha * g[k]!;
      const Et = energyGrad(r, trial, null);
      if (Et <= E) {
        x.set(trial);
        E = Et;
        alpha *= 1.5;
        stepped = true;
        break;
      }
      alpha *= 0.5;
    }
    if (!stepped) break; // cannot make progress at any step size
  }
  return E;
}

/* ------------------------------- registrar ------------------------------- */

export function registerSculpt(ctx: RegistrarCtx): void {
  /** Active restraint sets, keyed by object name (PyMOL's SculptCache). */
  const cache = new Map<string, Restraints>();

  /** Resolve an object by name, or by the first atom a selection matches. */
  const resolveObj = (nameOrSel: string): ObjectMolecule | undefined => {
    const direct = ctx.executive.molecule(nameOrSel);
    if (direct) return direct;
    const matched = ctx.executive.atomsMatching(nameOrSel);
    if (matched.length > 0) return ctx.executive.molecule(matched[0]!.objName);
    return undefined;
  };

  const normState = (s: number, mol: ObjectMolecule): number => {
    if (s <= 0) return 1;
    return s > mol.nstate ? mol.nstate : s;
  };

  /* --------------------------- sculpt_activate --------------------------- */
  // sculpt_activate(object, state=0) — snapshot the reference geometry.
  ctx.command('sculpt_activate', (args, kwargs): Json => {
    const name = ctx.str(pick(args, kwargs, 0, 'object'));
    const mol = resolveObj(name);
    if (!mol) return null;
    const state = normState(num(pick(args, kwargs, 1, 'state'), 0), mol);
    cache.set(mol.name, buildRestraints(mol, state, 'current'));
    const r = cache.get(mol.name)!;
    return r.bonds.length + r.angles.length;
  });

  /* --------------------------- sculpt_iterate --------------------------- */
  // sculpt_iterate(object, state=0, cycles=10) — run N steps; return energy.
  ctx.command('sculpt_iterate', (args, kwargs): Json => {
    const name = ctx.str(pick(args, kwargs, 0, 'object'));
    const mol = resolveObj(name);
    if (!mol) return 0;
    const r = cache.get(mol.name);
    if (!r) return 0;
    const state = normState(num(pick(args, kwargs, 1, 'state'), r.state), mol);
    const cycles = Math.max(0, Math.round(num(pick(args, kwargs, 2, 'cycles'), 10)));
    const x = readState(mol, state);
    const E = minimizeCoords(r, x, cycles);
    writeState(mol, state, x);
    ctx.publish();
    return E;
  });

  /* -------------------------- sculpt_deactivate ------------------------- */
  ctx.command('sculpt_deactivate', (args, kwargs): Json => {
    const name = ctx.str(pick(args, kwargs, 0, 'object'));
    const mol = resolveObj(name);
    const key = mol ? mol.name : name;
    return cache.delete(key) ? 1 : 0;
  });

  /* ----------------------------- sculpt_purge --------------------------- */
  ctx.command('sculpt_purge', (): Json => {
    cache.clear();
    return null;
  });

  /* ------------------------------- minimize ----------------------------- */
  // minimize(sele='', iter=500, grad=0.01, interval=50, _setup=1)
  // Upstream `minimize` (experimenting.py:108) is a nonfunctional stub: it
  // routes to `chempy.tinker.realtime`, which is NOT part of open-source
  // PyMOL, so `realtime.setup()` never succeeds and the command leaves the
  // coordinates untouched (printing "minimize: missing parameters"). Match
  // that behaviour faithfully — a no-op that returns None — rather than the
  // covalent idealiser (which belonged to `clean`, verified against the
  // oracle: fragment-ala bonds stay at their deposited lengths after
  // `minimize`).
  ctx.command('minimize', (): Json => null);

  /* -------------------------------- clean ------------------------------- */
  // clean(selection, state=0, cycles=100) — open-source substitute for the
  // MMFF94 `clean` (which raises IncentiveOnlyException upstream): idealise
  // geometry toward covalent-radius bond lengths; returns the final energy.
  ctx.command('clean', (args, kwargs): Json => {
    const sel = ctx.str(pick(args, kwargs, 0, 'selection'), 'all') || 'all';
    const mol = resolveObj(sel);
    if (!mol) return 0;
    const state = normState(num(pick(args, kwargs, 1, 'state'), 0), mol);
    const cycles = Math.max(0, Math.round(num(pick(args, kwargs, 2, 'cycles'), 100)));
    const r = buildRestraints(mol, state, 'covalent');
    const x = readState(mol, state);
    const E = minimizeCoords(r, x, cycles);
    writeState(mol, state, x);
    ctx.publish();
    return E;
  });

  /* -------------------------------- smooth ------------------------------ */
  // smooth(selection='all', passes=1, window=5, first=1, last=0, ends=0)
  // Temporal box-average across states for a multi-state object; for a single
  // state, a spatial average toward bonded neighbours (reduces bond variance).
  ctx.command('smooth', (args, kwargs): Json => {
    const sel = ctx.str(pick(args, kwargs, 0, 'selection'), 'all') || 'all';
    const mol = resolveObj(sel);
    if (!mol) return null;
    const passes = Math.max(1, Math.round(num(pick(args, kwargs, 1, 'passes'), 1)));
    const window = Math.max(1, Math.round(num(pick(args, kwargs, 2, 'window'), 5)));

    // Atom indices of the selection within this object (default: all atoms).
    const idx = new Set<number>();
    for (const ua of ctx.executive.atomsMatching(sel)) {
      if (ua.objName === mol.name) idx.add(ua.index);
    }
    if (idx.size === 0) return null;

    const nstate = mol.nstate;
    if (nstate >= 2) {
      // Temporal smoothing across states.
      const first = Math.max(1, Math.round(num(pick(args, kwargs, 3, 'first'), 1)));
      const lastRaw = Math.round(num(pick(args, kwargs, 4, 'last'), 0));
      const last = lastRaw <= 0 ? nstate : Math.min(nstate, lastRaw);
      const half = Math.floor(window / 2);
      for (let p = 0; p < passes; p++) {
        // Snapshot the source coordinates so a pass reads a stable frame.
        const src = mol.states.map((s) => (s ? Float32Array.from(s) : s));
        for (let s = first - 1; s <= last - 1; s++) {
          const dst = mol.states[s];
          if (!dst) continue;
          for (const i of idx) {
            for (let k = 0; k < 3; k++) {
              let sum = 0;
              let cnt = 0;
              for (let t = s - half; t <= s + half; t++) {
                if (t < 0 || t >= nstate) continue;
                const st = src[t];
                if (!st) continue;
                sum += st[i * 3 + k]!;
                cnt++;
              }
              if (cnt > 0) dst[i * 3 + k] = sum / cnt;
            }
          }
        }
      }
    } else {
      // Single state: spatial neighbour-average (relaxes bond-length variance).
      const nbrs = new Map<number, number[]>();
      for (const [i, j] of mol.bonds) {
        (nbrs.get(i) ?? nbrs.set(i, []).get(i)!).push(j);
        (nbrs.get(j) ?? nbrs.set(j, []).get(j)!).push(i);
      }
      const cur = mol.states[0];
      if (!cur) return null;
      for (let p = 0; p < passes; p++) {
        const src = Float32Array.from(cur);
        for (const i of idx) {
          const list = nbrs.get(i);
          if (!list || list.length === 0) continue;
          for (let k = 0; k < 3; k++) {
            let sum = src[i * 3 + k]!;
            for (const j of list) sum += src[j * 3 + k]!;
            cur[i * 3 + k] = sum / (list.length + 1);
          }
        }
      }
    }
    ctx.publish();
    return null;
  });
}
