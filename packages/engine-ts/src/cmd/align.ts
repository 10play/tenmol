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

/** Atom-identity key for `matchmaker=0` pairing: segi/chain/resn/resi/name/alt. */
function identityKey(ua: UniverseAtom): string {
  const a = ua.atom;
  return `${a.segi}|${a.chain}|${a.resn}|${a.resi}|${a.name}|${a.alt}`;
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

  /**
   * Materialised alignment objects, keyed by name. Each value is the raw
   * alignment: a list of columns, each column a list of `[objectName, index]`
   * pairs (`index` is PyMOL's 1-based atom index). `align`/`super`/… populate
   * this when called with `object=<name>`; `get_raw_alignment` reads it back.
   */
  const rawAlignments = new Map<string, Array<Array<[string, number]>>>();

  /** Object load-order rank, so a column's members come out in the same order
   *  real PyMOL lists them (by the alignment's object order). */
  const loadRank = (name: string): number => {
    let i = 0;
    for (const mol of ctx.executive.moleculesInOrder()) {
      if (mol.name === name) return i;
      i++;
    }
    return i;
  };

  /**
   * Shared paired-selection gather for `fit` / `rms_cur` / `rms`. Pairs atoms by
   * IDENTITY — (segi, chain, resn, resi, name, alt) — matching PyMOL's default
   * `matchmaker=0`, so storage order is irrelevant (a reversed copy still pairs).
   */
  const gatherPairs = (
    args: unknown[],
    kwargs: Record<string, unknown>,
  ): { mob: Vec3[]; tgt: Vec3[]; mobMols: Set<string>; state: number } => {
    const mobileSel = str(pick(args, kwargs, 0, 'mobile'), '');
    const targetSel = str(pick(args, kwargs, 1, 'target'), '');
    const state = Math.max(1, Math.trunc(num(pick(args, kwargs, 6, 'state'), 1)) || 1);
    const mobUAs = ctx.executive.atomsMatching(mobileSel);
    const tgtUAs = ctx.executive.atomsMatching(targetSel);
    // PyMOL's matcher still requires the two selections to have equal atom
    // counts; identity matching then makes storage order irrelevant.
    if (mobUAs.length !== tgtUAs.length) {
      throw new Error(
        `Match: atom counts differ (mobile ${mobUAs.length}, target ${tgtUAs.length})`,
      );
    }

    const tgtByKey = new Map<string, Vec3>();
    for (const ua of tgtUAs) {
      const mol = ctx.executive.molecule(ua.objName);
      if (mol) tgtByKey.set(identityKey(ua), mol.coord(ua.index, state));
    }
    const mob: Vec3[] = [];
    const tgt: Vec3[] = [];
    const mobMols = new Set<string>();
    for (const ua of mobUAs) {
      const t = tgtByKey.get(identityKey(ua));
      if (!t) continue;
      const mol = ctx.executive.molecule(ua.objName);
      if (!mol) continue;
      mob.push(mol.coord(ua.index, state));
      tgt.push(t);
      mobMols.add(ua.objName);
    }
    return { mob, tgt, mobMols, state };
  };

  /** Guide-Cα coordinate pairs by STRUCTURAL position (order), ignoring resn —
   *  the correspondence `super`/`cealign`/`usalign`/`alignto`/`extra_fit` use. */
  const caPairsByOrder = (
    mobileSel: string,
    targetSel: string,
    state: number,
  ): {
    mob: Vec3[]; tgt: Vec3[]; mobMols: Set<string>;
    n: number; identical: number; Lmob: number; Ltgt: number;
  } => {
    const mobCA = caAtoms(ctx, mobileSel);
    const tgtCA = caAtoms(ctx, targetSel);
    const count = Math.min(mobCA.length, tgtCA.length);
    const mob: Vec3[] = [];
    const tgt: Vec3[] = [];
    const mobMols = new Set<string>();
    let identical = 0;
    for (let i = 0; i < count; i++) {
      const mua = mobCA[i] as UniverseAtom;
      const tua = tgtCA[i] as UniverseAtom;
      const mMol = ctx.executive.molecule(mua.objName);
      const tMol = ctx.executive.molecule(tua.objName);
      if (!mMol || !tMol) continue;
      mob.push(mMol.coord(mua.index, state));
      tgt.push(tMol.coord(tua.index, state));
      mobMols.add(mua.objName);
      if (mua.atom.resn.toUpperCase() === tua.atom.resn.toUpperCase()) identical++;
    }
    return { mob, tgt, mobMols, n: mob.length, identical, Lmob: mobCA.length, Ltgt: tgtCA.length };
  };

  /** Residue key (segi|chain|resi) used to group a residue's atoms together. */
  const resKeyOf = (ua: UniverseAtom): string =>
    `${ua.atom.segi}|${ua.atom.chain}|${ua.atom.resi}`;

  /** Group a selection's atoms by residue, each residue mapping upper-cased atom
   *  name -> UniverseAtom. Used by `align` to pair EVERY atom of two aligned
   *  residues by name (PyMOL's `_cmd.align` fits over all aligned atoms, not just
   *  the guide Cα — which is why a single-residue fragment still superposes). */
  const residueAtomMap = (sel: string): Map<string, Map<string, UniverseAtom>> => {
    const map = new Map<string, Map<string, UniverseAtom>>();
    for (const ua of ctx.executive.atomsMatching(sel)) {
      const rk = resKeyOf(ua);
      let m = map.get(rk);
      if (!m) {
        m = new Map<string, UniverseAtom>();
        map.set(rk, m);
      }
      m.set(ua.atom.name.toUpperCase(), ua);
    }
    return map;
  };

  /** Apply a superposition transform to a single point (for TM-score scoring). */
  const applyPoint = (s: Superposition, p: Vec3): Vec3 => {
    const q: Vec3 = [p[0] - s.cMobile[0], p[1] - s.cMobile[1], p[2] - s.cMobile[2]];
    const rp = matVec(s.r, q);
    return [rp[0] + s.cTarget[0], rp[1] + s.cTarget[1], rp[2] + s.cTarget[2]];
  };

  /* -------------------------------- rms_cur ------------------------------ */
  // rms_cur(mobile, target) — RMS over paired atoms, no superposition.
  const rmsCur = (args: unknown[], kwargs: Record<string, unknown>): Json => {
    const { mob, tgt } = gatherPairs(args, kwargs);
    return rmsPaired(mob, tgt);
  };
  ctx.command('rms_cur', rmsCur);
  // rms(mobile, target) — best-fit RMS by identity matching, WITHOUT moving the
  // object (fit mode 1): Kabsch-superpose the pairs and report the residual.
  ctx.command('rms', (args, kwargs): Json => {
    const { mob, tgt } = gatherPairs(args, kwargs);
    if (mob.length === 0) return 0;
    return superpose(mob, tgt).rms;
  });

  /* ---------------------------------- fit -------------------------------- */
  // fit(mobile, target, ...) — Kabsch superpose the mobile object onto target,
  // return the post-fit RMS.
  const fit = (args: unknown[], kwargs: Record<string, unknown>): Json => {
    const { mob, tgt, mobMols, state } = gatherPairs(args, kwargs);
    if (mob.length === 0) return 0;
    const sup = superpose(mob, tgt);
    applySuperposition(objectsFrom(ctx, mobMols), state, sup);
    ctx.publish();
    return sup.rms;
  };
  ctx.command('fit', fit);

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

    // PyMOL's `_cmd.align` superposes over ALL atoms of the aligned residues
    // (paired by atom name), not just the guide Cα — so even a single-residue
    // fragment yields a determinate rigid fit. Group each side's atoms by
    // residue and, for every matched residue, pair atoms of the same name.
    const mobRes = residueAtomMap(mobileSel);
    const tgtRes = residueAtomMap(targetSel);
    const mob: Vec3[] = [];
    const tgt: Vec3[] = [];
    const mobMols = new Set<string>();
    // Per-column atom pairing for the alignment object (if object= is given).
    const columns: Array<Array<[string, number]>> = [];
    let nRes = 0;
    for (const [i, j] of pairs) {
      const mAtoms = mobRes.get(resKeyOf(mobCA[i] as UniverseAtom));
      const tAtoms = tgtRes.get(resKeyOf(tgtCA[j] as UniverseAtom));
      if (!mAtoms || !tAtoms) continue;
      let paired = false;
      for (const [name, mua] of mAtoms) {
        const tua = tAtoms.get(name);
        if (!tua) continue;
        const mMol = ctx.executive.molecule(mua.objName);
        const tMol = ctx.executive.molecule(tua.objName);
        if (!mMol || !tMol) continue;
        mobMols.add(mua.objName);
        mob.push(mMol.coord(mua.index, state));
        tgt.push(tMol.coord(tua.index, state));
        // Column members are PyMOL 1-based indices, ordered by object load order.
        const col: Array<[string, number]> = [
          [mua.objName, mua.index + 1],
          [tua.objName, tua.index + 1],
        ];
        col.sort((a, b) => loadRank(a[0]) - loadRank(b[0]));
        columns.push(col);
        paired = true;
      }
      if (paired) nRes++;
    }
    const n = mob.length;
    if (n === 0) return [0, 0, 0, 0, 0, 0, 0];

    const objectName = str(pick(args, kwargs, 7, 'object'), '');
    if (objectName) rawAlignments.set(objectName, columns);

    const rmsdPre = rmsPaired(mob, tgt);
    const sup = superpose(mob, tgt);
    applySuperposition(objectsFrom(ctx, mobMols), state, sup);
    ctx.publish();
    // [rmsd, n_atoms, n_cycles, rmsd_pre, n_pre, raw_score, n_residues]
    return [sup.rms, n, 0, rmsdPre, n, 0, nRes];
  };
  ctx.command('align', align);

  /* --------------------------------- super ------------------------------- */
  // super(mobile, target, ...) — STRUCTURE-based superposition: pairs guide Cα
  // by structural position (ignoring residue names), Kabsch-fits and carries the
  // whole mobile object. Unlike `align` it needs no sequence similarity.
  const superFn = (args: unknown[], kwargs: Record<string, unknown>): Json => {
    const mobileSel = str(pick(args, kwargs, 0, 'mobile'), '');
    const targetSel = str(pick(args, kwargs, 1, 'target'), '');
    const state = Math.max(1, Math.trunc(num(pick(args, kwargs, 8, 'mobile_state'), 1)) || 1);
    const p = caPairsByOrder(mobileSel, targetSel, state);
    if (p.n === 0) return [0, 0, 0, 0, 0, 0, 0];
    const rmsdPre = rmsPaired(p.mob, p.tgt);
    const sup = superpose(p.mob, p.tgt);
    applySuperposition(objectsFrom(ctx, p.mobMols), state, sup);
    ctx.publish();
    return [sup.rms, p.n, 0, rmsdPre, p.n, 0, p.n];
  };
  ctx.command('super', superFn);

  /* -------------------------------- cealign ------------------------------ */
  // cealign(target, mobile, ...) — the CE structural aligner. NOTE the argument
  // order: TARGET first, MOBILE second (fitting.py). Transforms the mobile onto
  // the target and returns {alignment_length, RMSD, rotation_matrix}.
  const cealignFn = (args: unknown[], kwargs: Record<string, unknown>): Json => {
    const targetSel = str(pick(args, kwargs, 0, 'target'), '');
    const mobileSel = str(pick(args, kwargs, 1, 'mobile'), '');
    const state = Math.max(1, Math.trunc(num(pick(args, kwargs, 3, 'mobile_state'), 1)) || 1);
    const p = caPairsByOrder(mobileSel, targetSel, state);
    if (p.n === 0) return { alignment_length: 0, RMSD: 0, rotation_matrix: [] };
    const sup = superpose(p.mob, p.tgt);
    applySuperposition(objectsFrom(ctx, p.mobMols), state, sup);
    ctx.publish();
    return {
      alignment_length: p.n,
      RMSD: sup.rms,
      rotation_matrix: [
        [sup.r[0] as number, sup.r[1] as number, sup.r[2] as number],
        [sup.r[3] as number, sup.r[4] as number, sup.r[5] as number],
        [sup.r[6] as number, sup.r[7] as number, sup.r[8] as number],
      ],
    };
  };
  ctx.command('cealign', cealignFn);

  /* -------------------------------- usalign ------------------------------ */
  // usalign(mobile, target, ...) — TM-align-style superposition. Returns the
  // documented dict: tm_score_target/tm_score_mobile/RMSD/alignment_length/
  // seq_identity (test_fitting.py golden). TM = mean 1/(1+(dᵢ/d0)²) over pairs.
  ctx.command('usalign', (args, kwargs): Json => {
    const mobileSel = str(pick(args, kwargs, 0, 'mobile'), '');
    const targetSel = str(pick(args, kwargs, 1, 'target'), '');
    const p = caPairsByOrder(mobileSel, targetSel, 1);
    if (p.n === 0) {
      return { tm_score_target: 0, tm_score_mobile: 0, RMSD: 0, alignment_length: 0, seq_identity: 0 };
    }
    const sup = superpose(p.mob, p.tgt);
    const d0 = (L: number): number => Math.max(0.5, 1.24 * Math.cbrt(Math.max(L - 15, 0)) - 1.8);
    const d0t = d0(p.Ltgt);
    const d0m = d0(p.Lmob);
    let sumT = 0;
    let sumM = 0;
    for (let i = 0; i < p.n; i++) {
      const f = applyPoint(sup, p.mob[i] as Vec3);
      const t = p.tgt[i] as Vec3;
      const di2 = (f[0] - t[0]) ** 2 + (f[1] - t[1]) ** 2 + (f[2] - t[2]) ** 2;
      sumT += 1 / (1 + di2 / (d0t * d0t));
      sumM += 1 / (1 + di2 / (d0m * d0m));
    }
    return {
      tm_score_target: p.Ltgt ? sumT / p.Ltgt : 0,
      tm_score_mobile: p.Lmob ? sumM / p.Lmob : 0,
      RMSD: sup.rms,
      alignment_length: p.n,
      seq_identity: p.n ? p.identical / p.n : 0,
    };
  });

  /* ------------------------------- pair_fit ------------------------------ */
  // pair_fit(m1, t1, m2, t2, …) — superpose explicit atom-pair selections and
  // carry the mobile object(s). Selections pair atom-by-atom in order.
  ctx.command('pair_fit', (args, kwargs): Json => {
    const sels: string[] = [];
    for (const a of args) {
      const s = str(a, '');
      if (s) sels.push(s);
    }
    void kwargs;
    const state = 1;
    const mob: Vec3[] = [];
    const tgt: Vec3[] = [];
    const mobMols = new Set<string>();
    for (let k = 0; k + 1 < sels.length; k += 2) {
      const mUAs = ctx.executive.atomsMatching(sels[k] as string);
      const tUAs = ctx.executive.atomsMatching(sels[k + 1] as string);
      const count = Math.min(mUAs.length, tUAs.length);
      for (let i = 0; i < count; i++) {
        const mua = mUAs[i] as UniverseAtom;
        const tua = tUAs[i] as UniverseAtom;
        const mMol = ctx.executive.molecule(mua.objName);
        const tMol = ctx.executive.molecule(tua.objName);
        if (!mMol || !tMol) continue;
        mob.push(mMol.coord(mua.index, state));
        tgt.push(tMol.coord(tua.index, state));
        mobMols.add(mua.objName);
      }
    }
    if (mob.length === 0) return 0;
    const sup = superpose(mob, tgt);
    applySuperposition(objectsFrom(ctx, mobMols), state, sup);
    ctx.publish();
    return sup.rms;
  });

  /* ---------------------------- alignto / extra_fit ---------------------- */
  // The fitting methods `extra_fit`/`alignto` can dispatch to. Each takes the
  // mobile/target selection (by keyword, so cealign's reversed positional order
  // is irrelevant) and carries the mobile object onto the target.
  const methods: Record<
    string,
    (args: unknown[], kwargs: Record<string, unknown>) => Json
  > = { align, super: superFn, cealign: cealignFn, fit };

  /** Fold trailing `key=value` string tokens (as the console parser hands them
   *  over — it never splits kwargs itself) into `kwargs`. The wrapper verbs
   *  `alignto`/`extra_fit` take object/method names positionally and everything
   *  else as `key=value`, so `alignto ala, method=align` behaves like real
   *  PyMOL's keyword dispatch. */
  const foldKwargs = (
    args: unknown[],
    kwargs: Record<string, unknown>,
  ): { pos: unknown[]; kw: Record<string, unknown> } => {
    const pos: unknown[] = [];
    const kw: Record<string, unknown> = { ...kwargs };
    for (const a of args) {
      if (typeof a === 'string') {
        const m = /^([A-Za-z_]\w*)=(.*)$/.exec(a.trim());
        if (m) {
          kw[m[1] as string] = m[2];
          continue;
        }
      }
      pos.push(a);
    }
    return { pos, kw };
  };

  /** Run `method` for one mobile object against a target selection and extract
   *  its post-fit RMS from whatever shape the method returns (list / dict /
   *  scalar). Returns -1 when nothing was paired. */
  const runMethod = (
    method: string,
    mobileSel: string,
    targetSel: string,
    kwargs: Record<string, unknown>,
  ): number => {
    const fn = methods[method] ?? superFn;
    const res = fn([], { ...kwargs, mobile: mobileSel, target: targetSel });
    if (Array.isArray(res)) return res.length ? Number(res[0]) : -1;
    if (res && typeof res === 'object' && 'RMSD' in (res as Record<string, unknown>)) {
      return Number((res as Record<string, unknown>).RMSD);
    }
    if (typeof res === 'number') return res;
    return -1;
  };

  // extra_fit(selection, reference, method, …) — superpose every non-reference
  // object present in `selection` onto `reference` using `method` (default
  // `align`, matching PyMOL). A thin dispatcher over the method commands.
  const extraFit = (rawArgs: unknown[], rawKwargs: Record<string, unknown>): Json => {
    const { pos: args, kw: kwargs } = foldKwargs(rawArgs, rawKwargs);
    const selection = str(pick(args, kwargs, 0, 'selection'), 'all') || 'all';
    let reference = str(pick(args, kwargs, 1, 'reference'), '');
    const method = str(pick(args, kwargs, 2, 'method'), 'align') || 'align';
    // Objects touched by the selection, in load order.
    const objs: string[] = [];
    const seen = new Set<string>();
    for (const ua of ctx.executive.atomsMatching(selection)) {
      if (!seen.has(ua.objName)) {
        seen.add(ua.objName);
        objs.push(ua.objName);
      }
    }
    if (!reference && objs.length) reference = objs[0] as string;
    const out: Json[] = [];
    for (const name of objs) {
      if (name === reference) continue;
      const rms = runMethod(method, name, reference, kwargs);
      if (rms >= 0) out.push([name, rms]);
    }
    ctx.publish();
    return out;
  };
  ctx.command('extra_fit', extraFit);

  // alignto(target, method, selection, …) — superpose every OTHER public object
  // onto `target`. A wrapper over `extra_fit` (default method `cealign`).
  ctx.command('alignto', (rawArgs, rawKwargs): Json => {
    const { pos: args, kw: kwargs } = foldKwargs(rawArgs, rawKwargs);
    const target = str(pick(args, kwargs, 0, 'target'), '');
    const method = str(pick(args, kwargs, 1, 'method'), 'cealign') || 'cealign';
    const selection = str(pick(args, kwargs, 2, 'selection'), '');
    if (selection) {
      return extraFit([selection, target, method], kwargs);
    }
    // Default: all public objects, in load order.
    const out: Json[] = [];
    for (const mol of ctx.executive.moleculesInOrder()) {
      if (mol.name === target) continue;
      const rms = runMethod(method, mol.name, target, kwargs);
      if (rms >= 0) out.push([mol.name, rms]);
    }
    ctx.publish();
    return out;
  });

  /* ------------------------------- intra_rms ----------------------------- */
  // intra_rms(selection, state=1) — FIT each state onto the reference state and
  // report the post-fit RMS (coordinates left unchanged; intrafit mode 1). The
  // reference state's entry is -1.0.
  ctx.command('intra_rms', (args, kwargs): Json => {
    const sel = str(pick(args, kwargs, 0, 'selection'), 'all') || 'all';
    const refState = Math.max(1, Math.trunc(num(pick(args, kwargs, 1, 'state'), 1)) || 1);
    const uas = ctx.executive.atomsMatching(sel);
    if (uas.length === 0) return [];
    const objName = (uas[0] as UniverseAtom).objName;
    const mol = ctx.executive.molecule(objName);
    if (!mol) return [];
    const idxs = uas.filter((ua) => ua.objName === objName).map((ua) => ua.index);
    const ref: Vec3[] = idxs.map((i) => mol.coord(i, refState));
    const out: number[] = [];
    for (let s = 1; s <= mol.nstate; s++) {
      if (s === refState) {
        out.push(-1.0);
        continue;
      }
      const cur: Vec3[] = idxs.map((i) => mol.coord(i, s));
      out.push(superpose(cur, ref).rms);
    }
    return out;
  });

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
  // get_raw_alignment(name, active_only=0) — the per-atom alignment relations of
  // an alignment object, as a list of columns of (object, index) tuples. Reads
  // back whatever `align`/`super`/… recorded when called with object=<name>.
  ctx.command('get_raw_alignment', (args, kwargs): Json => {
    const name = str(pick(args, kwargs, 0, 'name'), '');
    const cols = name ? rawAlignments.get(name) : undefined;
    return (cols ?? []) as unknown as Json;
  });
}
