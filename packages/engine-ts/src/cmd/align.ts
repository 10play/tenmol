/**
 * The `align` / RMS command subsystem — PyMOL's structural-superposition verbs
 * (`packages/engine/layer3/Executive.cpp` `ExecutiveRMS` / `ExecutiveAlign`,
 * and `matrix.py`).
 *
 * Implemented here:
 *   - `rms_cur(mobile, target)` — RMS over PAIRED atoms (equal counts, same
 *     order), measuring only; the coordinates are not moved.
 *   - `fit(mobile, target)` — measures AND superposes: a Kabsch fit (centroid
 *     align, 3x3 covariance `H = Σ mᵢ tᵢᵀ`, SVD, `R = V·diag(1,1,det)·Uᵀ`) whose
 *     rigid transform is then applied to the WHOLE mobile object. Returns the
 *     post-fit RMS.
 *   - `align(mobile, target)` / `super(...)` — a simplified sequence alignment:
 *     pair Cα atoms by an LCS on the two chains' residue identities, Kabsch-fit
 *     the paired Cα, apply to the whole mobile object. Returns PyMOL's align
 *     result list `[rmsd, n_atoms, n_cycles, rmsd_pre, n_pre, raw_score, n_res]`.
 *   - `intra_fit(selection, state)` — fit every state of an object onto a
 *     reference state; returns the per-state RMS list (reference state = -1.0).
 *   - `rms(mobile, target)` — the paired RMS (stub aliasing `rms_cur`).
 *   - `get_raw_alignment(name)` — `[]` stub.
 *
 * The Kabsch SVD is obtained in-file from a Jacobi eigen-decomposition of the
 * symmetric `HᵀH`, avoiding any external linear-algebra dependency.
 */
import type { Json } from '@tenmol/protocol';
import type { ObjectMolecule } from '../model/molecule';
import type { UniverseAtom } from '../select/selector';
import type { RegistrarCtx } from './registrar';

/* ------------------------------ math types ------------------------------- */

type Vec3 = [number, number, number];
/** Row-major 3x3: `m[row * 3 + col]`. */
type Mat3 = number[];

function matVec(m: Mat3, v: Vec3): Vec3 {
  return [
    (m[0] as number) * v[0] + (m[1] as number) * v[1] + (m[2] as number) * v[2],
    (m[3] as number) * v[0] + (m[4] as number) * v[1] + (m[5] as number) * v[2],
    (m[6] as number) * v[0] + (m[7] as number) * v[1] + (m[8] as number) * v[2],
  ];
}

function det3(m: Mat3): number {
  const a = m[0] as number, b = m[1] as number, c = m[2] as number;
  const d = m[3] as number, e = m[4] as number, f = m[5] as number;
  const g = m[6] as number, h = m[7] as number, i = m[8] as number;
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function norm3(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

/* --------------------- symmetric-3x3 Jacobi eigensolver ------------------ */

/**
 * Cyclic Jacobi eigen-decomposition of a symmetric 3x3 matrix (`in` is a
 * row-major length-9 symmetric array). Returns eigenvalues sorted DESCENDING
 * and the matching orthonormal eigenvector COLUMNS (`vectors[i]` is column `i`).
 * Robust for the covariance matrices this file forms.
 */
function jacobiEigenSym(input: Mat3): { values: number[]; vectors: Vec3[] } {
  const a = input.slice(); // mutated toward diagonal
  const get = (i: number, j: number): number => a[i * 3 + j] as number;
  const set = (i: number, j: number, x: number): void => {
    a[i * 3 + j] = x;
  };
  // Eigenvector accumulator, identity to start (row-major).
  const v: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  for (let iter = 0; iter < 100; iter++) {
    const off = Math.abs(get(0, 1)) + Math.abs(get(0, 2)) + Math.abs(get(1, 2));
    if (off < 1e-18) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) {
      const apq = get(p, q);
      if (Math.abs(apq) < 1e-300) continue;
      const app = get(p, p);
      const aqq = get(q, q);
      // Rotation angle that zeros the (p,q) entry.
      const tau = (aqq - app) / (2 * apq);
      const t =
        tau >= 0
          ? 1 / (tau + Math.sqrt(1 + tau * tau))
          : -1 / (-tau + Math.sqrt(1 + tau * tau));
      const c = 1 / Math.sqrt(1 + t * t);
      const s = t * c;
      // Two-sided rotation A' = GᵀAG: closed-form on the (p,q) block …
      const newApp = c * c * app - 2 * s * c * apq + s * s * aqq;
      const newAqq = s * s * app + 2 * s * c * apq + c * c * aqq;
      set(p, p, newApp);
      set(q, q, newAqq);
      set(p, q, 0);
      set(q, p, 0);
      // … and the one-sided update for the remaining index.
      for (let k = 0; k < 3; k++) {
        if (k === p || k === q) continue;
        const akp = get(k, p);
        const akq = get(k, q);
        const nkp = c * akp - s * akq;
        const nkq = s * akp + c * akq;
        set(k, p, nkp);
        set(p, k, nkp);
        set(k, q, nkq);
        set(q, k, nkq);
      }
      // Accumulate eigenvectors: V' = V·G.
      for (let k = 0; k < 3; k++) {
        const vkp = v[k * 3 + p] as number;
        const vkq = v[k * 3 + q] as number;
        v[k * 3 + p] = c * vkp - s * vkq;
        v[k * 3 + q] = s * vkp + c * vkq;
      }
    }
  }

  const idx = [0, 1, 2].sort((x, y) => get(y, y) - get(x, x)); // descending
  const values = idx.map((j) => get(j, j));
  const vectors: Vec3[] = idx.map((j) => [
    v[0 * 3 + j] as number,
    v[1 * 3 + j] as number,
    v[2 * 3 + j] as number,
  ]);
  return { values, vectors };
}

/* --------------------------------- Kabsch -------------------------------- */

/**
 * The proper rotation `R` (row-major 3x3) that best maps centred `mobile` onto
 * centred `target` in the least-squares sense: `targetᵢ ≈ R·mobileᵢ`. Uses the
 * covariance `H = Σ mᵢ tᵢᵀ`, its SVD via `jacobiEigenSym(HᵀH)`, and the
 * determinant sign fix `R = V·diag(1,1,d)·Uᵀ`.
 */
function kabschRotation(mob: Vec3[], tgt: Vec3[]): Mat3 {
  // Covariance H[a][b] = Σ mobileᵢ[a] · targetᵢ[b]  (row-major).
  const h: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < mob.length; i++) {
    const m = mob[i] as Vec3;
    const t = tgt[i] as Vec3;
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        h[a * 3 + b] = (h[a * 3 + b] as number) + m[a]! * t[b]!;
      }
    }
  }
  // A = HᵀH  (symmetric): A[a][b] = Σ_k H[k][a] H[k][b].
  const ata: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let a = 0; a < 3; a++) {
    for (let b = 0; b < 3; b++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += (h[k * 3 + a] as number) * (h[k * 3 + b] as number);
      ata[a * 3 + b] = sum;
    }
  }
  const { values, vectors: vCols } = jacobiEigenSym(ata);
  const sv = values.map((w) => Math.sqrt(Math.max(0, w))); // singular values (desc)

  // Left singular vectors uᵢ = H·vᵢ / sᵢ; fall back to an orthonormal
  // completion when a singular value collapses (planar / collinear atoms).
  const eps = 1e-9 * (sv[0] || 1);
  const uCols: Vec3[] = [];
  for (let i = 0; i < 3; i++) {
    const s = sv[i] as number;
    const vi = vCols[i] as Vec3;
    if (s > eps) {
      const hv = matVec(h, vi);
      uCols.push([hv[0] / s, hv[1] / s, hv[2] / s]);
    } else {
      uCols.push([0, 0, 0]); // filled below
    }
  }
  // Complete any degenerate columns as a right-handed orthonormal basis.
  for (let i = 0; i < 3; i++) {
    if (norm3(uCols[i] as Vec3) > 0.5) continue;
    const a = uCols[(i + 1) % 3] as Vec3;
    const b = uCols[(i + 2) % 3] as Vec3;
    let c = cross(a, b);
    if (norm3(c) < 1e-9) {
      // Two columns missing: pick any vector orthogonal to the one present.
      const known = norm3(a) > 0.5 ? a : b;
      const trial: Vec3 = Math.abs(known[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      c = cross(known, trial);
    }
    const n = norm3(c) || 1;
    uCols[i] = [c[0] / n, c[1] / n, c[2] / n];
  }

  // Build V and U (columns) as matrices for the determinant sign check.
  const vMat: Mat3 = [
    vCols[0]![0], vCols[1]![0], vCols[2]![0],
    vCols[0]![1], vCols[1]![1], vCols[2]![1],
    vCols[0]![2], vCols[1]![2], vCols[2]![2],
  ];
  const uMat: Mat3 = [
    uCols[0]![0], uCols[1]![0], uCols[2]![0],
    uCols[0]![1], uCols[1]![1], uCols[2]![1],
    uCols[0]![2], uCols[1]![2], uCols[2]![2],
  ];
  const d = det3(vMat) * det3(uMat) < 0 ? -1 : 1;
  const dg: Vec3 = [1, 1, d];

  // R = V·diag(1,1,d)·Uᵀ = Σᵢ dᵢ · vᵢ uᵢᵀ  (row-major).
  const r: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const vi = vCols[i] as Vec3;
    const ui = uCols[i] as Vec3;
    const di = dg[i] as number;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        r[row * 3 + col] = (r[row * 3 + col] as number) + di * vi[row]! * ui[col]!;
      }
    }
  }
  return r;
}

/* ------------------------------ RMS helpers ------------------------------ */

function centroid(pts: Vec3[]): Vec3 {
  const c: Vec3 = [0, 0, 0];
  for (const p of pts) {
    c[0] += p[0];
    c[1] += p[1];
    c[2] += p[2];
  }
  const n = pts.length || 1;
  return [c[0] / n, c[1] / n, c[2] / n];
}

/** RMS deviation over paired points (no fitting). */
function rmsPaired(a: Vec3[], b: Vec3[]): number {
  if (a.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const p = a[i] as Vec3;
    const q = b[i] as Vec3;
    const dx = p[0] - q[0];
    const dy = p[1] - q[1];
    const dz = p[2] - q[2];
    sum += dx * dx + dy * dy + dz * dz;
  }
  return Math.sqrt(sum / a.length);
}

/** A Kabsch superposition: rotation + the pre/post centroids, and the post-fit RMS. */
interface Superposition {
  r: Mat3;
  cMobile: Vec3;
  cTarget: Vec3;
  rms: number;
}

function superpose(mob: Vec3[], tgt: Vec3[]): Superposition {
  const cMobile = centroid(mob);
  const cTarget = centroid(tgt);
  const mc = mob.map((p): Vec3 => [p[0] - cMobile[0], p[1] - cMobile[1], p[2] - cMobile[2]]);
  const tc = tgt.map((p): Vec3 => [p[0] - cTarget[0], p[1] - cTarget[1], p[2] - cTarget[2]]);
  const r = kabschRotation(mc, tc);
  // Post-fit residual: R·mcᵢ - tcᵢ.
  let sum = 0;
  for (let i = 0; i < mc.length; i++) {
    const rp = matVec(r, mc[i] as Vec3);
    const q = tc[i] as Vec3;
    const dx = rp[0] - q[0];
    const dy = rp[1] - q[1];
    const dz = rp[2] - q[2];
    sum += dx * dx + dy * dy + dz * dz;
  }
  const rms = mc.length ? Math.sqrt(sum / mc.length) : 0;
  return { r, cMobile, cTarget, rms };
}

/**
 * Apply a superposition transform `p → R·(p - cMobile) + cTarget` to every atom
 * of the given objects, in `state` (1-based), mutating the Float32 coord sets
 * in place — exactly as PyMOL's `fit`/`align` move the whole mobile object.
 */
function applySuperposition(mols: ObjectMolecule[], state: number, s: Superposition): void {
  for (const mol of mols) {
    const set = mol.states[state - 1];
    if (!set) continue;
    for (let o = 0; o + 2 < set.length; o += 3) {
      const p: Vec3 = [
        (set[o] as number) - s.cMobile[0],
        (set[o + 1] as number) - s.cMobile[1],
        (set[o + 2] as number) - s.cMobile[2],
      ];
      const rp = matVec(s.r, p);
      set[o] = rp[0] + s.cTarget[0];
      set[o + 1] = rp[1] + s.cTarget[1];
      set[o + 2] = rp[2] + s.cTarget[2];
    }
  }
}

/* ------------------------------ arg helpers ------------------------------ */

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

/* ------------------------------- selection ------------------------------- */

/** The paired atom coordinates of a selection in `state`, plus their objects. */
function coordsOf(
  uas: UniverseAtom[],
  ctx: RegistrarCtx,
  state: number,
): { pts: Vec3[]; mols: Set<string> } {
  const pts: Vec3[] = [];
  const mols = new Set<string>();
  for (const ua of uas) {
    const mol = ctx.executive.molecule(ua.objName);
    if (!mol) continue;
    mols.add(ua.objName);
    pts.push(mol.coord(ua.index, state));
  }
  return { pts, mols };
}

function objectsFrom(ctx: RegistrarCtx, names: Set<string>): ObjectMolecule[] {
  const out: ObjectMolecule[] = [];
  for (const n of names) {
    const m = ctx.executive.molecule(n);
    if (m) out.push(m);
  }
  return out;
}

/* ------------------------- sequence alignment (Cα) ----------------------- */

/**
 * Greedy longest-common-subsequence pairing of two residue-identity sequences.
 * Returns the matched index pairs `[i, j]` (into `a`/`b`) in order — the simple
 * stand-in for PyMOL's dynamic-programming sequence aligner used by `align`.
 */
function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j]
        ? (dp[i + 1]![j + 1] as number) + 1
        : Math.max(dp[i + 1]![j] as number, dp[i]![j + 1] as number);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if ((dp[i + 1]![j] as number) >= (dp[i]![j + 1] as number)) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/** Cα atoms of a selection, in universe order. */
function caAtoms(ctx: RegistrarCtx, sel: string): UniverseAtom[] {
  return ctx.executive
    .atomsMatching(sel)
    .filter((ua) => ua.atom.name.toUpperCase() === 'CA' && !ua.atom.hetatm);
}

/* ------------------------------- registrar ------------------------------- */

export function registerAlign(ctx: RegistrarCtx): void {
  const str = ctx.str;

  /** Shared paired-selection gather for `fit` / `rms_cur` / `rms`. */
  const gatherPairs = (
    args: unknown[],
    kwargs: Record<string, unknown>,
  ): { mob: Vec3[]; tgt: Vec3[]; mobMols: Set<string>; state: number } => {
    const mobileSel = str(pick(args, kwargs, 0, 'mobile'), '');
    const targetSel = str(pick(args, kwargs, 1, 'target'), '');
    const state = Math.max(1, Math.trunc(num(pick(args, kwargs, 6, 'state'), 1)) || 1);
    const mobUAs = ctx.executive.atomsMatching(mobileSel);
    const tgtUAs = ctx.executive.atomsMatching(targetSel);
    if (mobUAs.length !== tgtUAs.length) {
      throw new Error(
        `Match: atom counts differ (mobile ${mobUAs.length}, target ${tgtUAs.length})`,
      );
    }
    const mob = coordsOf(mobUAs, ctx, state);
    const tgt = coordsOf(tgtUAs, ctx, state);
    return { mob: mob.pts, tgt: tgt.pts, mobMols: mob.mols, state };
  };

  /* -------------------------------- rms_cur ------------------------------ */
  // rms_cur(mobile, target) — RMS over paired atoms, no superposition.
  const rmsCur = (args: unknown[], kwargs: Record<string, unknown>): Json => {
    const { mob, tgt } = gatherPairs(args, kwargs);
    return rmsPaired(mob, tgt);
  };
  ctx.command('rms_cur', rmsCur);
  // `rms` is the sculpting-refined RMS in PyMOL; here it aliases the paired RMS.
  ctx.command('rms', rmsCur);

  /* ---------------------------------- fit -------------------------------- */
  // fit(mobile, target, ...) — Kabsch superpose the mobile object onto target,
  // return the post-fit RMS.
  ctx.command('fit', (args, kwargs): Json => {
    const { mob, tgt, mobMols, state } = gatherPairs(args, kwargs);
    if (mob.length === 0) return 0;
    const sup = superpose(mob, tgt);
    applySuperposition(objectsFrom(ctx, mobMols), state, sup);
    ctx.publish();
    return sup.rms;
  });

  /* --------------------------------- align ------------------------------- */
  // align(mobile, target, ...) — Cα sequence-alignment superposition. Returns
  // PyMOL's list [rmsd, n_atoms, n_cycles, rmsd_pre, n_pre, raw_score, n_res].
  const align = (args: unknown[], kwargs: Record<string, unknown>): Json => {
    const mobileSel = str(pick(args, kwargs, 0, 'mobile'), '');
    const targetSel = str(pick(args, kwargs, 1, 'target'), '');
    const state = Math.max(1, Math.trunc(num(pick(args, kwargs, 8, 'mobile_state'), 1)) || 1);

    const mobCA = caAtoms(ctx, mobileSel);
    const tgtCA = caAtoms(ctx, targetSel);
    const mobSeq = mobCA.map((ua) => ua.atom.resn.toUpperCase());
    const tgtSeq = tgtCA.map((ua) => ua.atom.resn.toUpperCase());
    const pairs = lcsPairs(mobSeq, tgtSeq);

    const mob: Vec3[] = [];
    const tgt: Vec3[] = [];
    const mobMols = new Set<string>();
    for (const [i, j] of pairs) {
      const mua = mobCA[i] as UniverseAtom;
      const tua = tgtCA[j] as UniverseAtom;
      const mMol = ctx.executive.molecule(mua.objName);
      const tMol = ctx.executive.molecule(tua.objName);
      if (!mMol || !tMol) continue;
      mobMols.add(mua.objName);
      mob.push(mMol.coord(mua.index, state));
      tgt.push(tMol.coord(tua.index, state));
    }
    const n = mob.length;
    if (n === 0) return [0, 0, 0, 0, 0, 0, 0];

    const rmsdPre = rmsPaired(mob, tgt);
    const sup = superpose(mob, tgt);
    applySuperposition(objectsFrom(ctx, mobMols), state, sup);
    ctx.publish();
    // [rmsd, n_atoms, n_cycles, rmsd_pre, n_pre, raw_score, n_residues]
    return [sup.rms, n, 0, rmsdPre, n, 0, n];
  };
  ctx.command('align', align);
  ctx.command('super', align); // alias for now

  /* ------------------------------- intra_fit ----------------------------- */
  // intra_fit(selection, state=1) — fit every state onto the reference state;
  // returns the per-state RMS list (the reference state's entry is -1.0).
  ctx.command('intra_fit', (args, kwargs): Json => {
    const sel = str(pick(args, kwargs, 0, 'selection'), '');
    const refState = Math.max(1, Math.trunc(num(pick(args, kwargs, 1, 'state'), 1)) || 1);
    const uas = ctx.executive.atomsMatching(sel);
    if (uas.length === 0) return [];
    // intra_fit operates within a single object; take the selection's object.
    const objName = (uas[0] as UniverseAtom).objName;
    const mol = ctx.executive.molecule(objName);
    if (!mol) return [];
    const idxs = uas.filter((ua) => ua.objName === objName).map((ua) => ua.index);
    const refSet = mol.states[refState - 1];
    if (!refSet) return [];
    const ref: Vec3[] = idxs.map((i) => mol.coord(i, refState));

    const out: number[] = [];
    for (let s = 1; s <= mol.nstate; s++) {
      if (s === refState) {
        out.push(-1.0);
        continue;
      }
      const cur: Vec3[] = idxs.map((i) => mol.coord(i, s));
      const sup = superpose(cur, ref);
      applySuperposition([mol], s, sup);
      out.push(sup.rms);
    }
    ctx.publish();
    return out;
  });

  /* --------------------------- get_raw_alignment ------------------------- */
  // get_raw_alignment(name) — the per-atom alignment map; a `[]` stub here.
  ctx.command('get_raw_alignment', (): Json => []);
}
