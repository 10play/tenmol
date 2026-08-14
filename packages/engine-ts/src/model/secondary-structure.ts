/**
 * Secondary-structure assignment — a faithful port of PyMOL's `SelectorAssignSS`
 * (`packages/engine/layer3/Selector.cpp`) plus the backbone hydrogen-bond
 * geometry it depends on (`ObjectMoleculeGetCheckHBond`,
 * `ObjectMoleculeGetAvgHBondVector`, `CoordSetFindOpenValenceVector` and
 * `ObjectMoleculeGetPhiPsi` in `packages/engine/layer2/ObjectMolecule*.cpp`).
 *
 * PyMOL's `dss` does NOT reproduce DSSP: it detects i+3/4/5 helical H-bonds and
 * antiparallel/parallel β-ladder H-bonds, filters by backbone φ/ψ geometry, then
 * cleans up short segments. Crucially it writes the resulting `ss` code back onto
 * the **Cα atom only** — every other atom keeps whatever `ss` it had. The counts
 * the differential checks (`ss H`, `ss S`) are therefore per-residue Cα counts.
 *
 * The H-bond model mirrors PyMOL exactly for a hydrogen-free protein loaded from
 * PDB (all bonds single): the amide N is treated as a tetrahedral donor with a
 * single virtual H placed toward the acceptor, and the carbonyl O is a
 * tetrahedral acceptor whose lone-pair plane is optimised against the incoming H.
 */
import type { ObjectMolecule } from './molecule';

type Vec3 = [number, number, number];

/* ------------------------------- vector math ----------------------------- */
// Mirrors packages/engine/layer0/Vector.{h,cpp}. Double precision throughout;
// coordinates are already float32-rounded coming out of the CoordSet.

const R_SMALL = 0.000000001;

// PyMOL performs this geometry in C `float` (32-bit) and stores float results.
// We emulate that rounding so borderline H-bonds / φ-ψ boundaries fall the same
// way they do behind the oracle; doing the maths in double drifts a handful of
// residues across the assignment thresholds.
const f = Math.fround;

function sub(a: Vec3, b: Vec3): Vec3 {
  return [f(a[0] - b[0]), f(a[1] - b[1]), f(a[2] - b[2])];
}
function add(a: Vec3, b: Vec3): Vec3 {
  return [f(a[0] + b[0]), f(a[1] + b[1]), f(a[2] + b[2])];
}
function scale(a: Vec3, s: number): Vec3 {
  return [f(a[0] * s), f(a[1] * s), f(a[2] * s)];
}
function dot(a: Vec3, b: Vec3): number {
  return f(f(f(a[0] * b[0]) + f(a[1] * b[1])) + f(a[2] * b[2]));
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    f(f(a[1] * b[2]) - f(a[2] * b[1])),
    f(f(a[2] * b[0]) - f(a[0] * b[2])),
    f(f(a[0] * b[1]) - f(a[1] * b[0])),
  ];
}
function length(a: Vec3): number {
  // length3f uses sqrt1f((x*x)+(y*y)+(z*z)) in float.
  const s = f(f(f(a[0] * a[0]) + f(a[1] * a[1])) + f(a[2] * a[2]));
  return f(Math.sqrt(s));
}
function normalize(a: Vec3): Vec3 {
  // normalize3f divides by the float length in place.
  const l = length(a);
  if (l > R_SMALL) return [f(a[0] / l), f(a[1] / l), f(a[2] / l)];
  return [0, 0, 0];
}

/** `get_angle3f`: angle (radians, float) between two vectors, clamped, via acosf.
 *  PyMOL computes the dot/denominator in double but returns `acosf` (float). */
function angleBetween(v1: Vec3, v2: Vec3): number {
  const arg1 = v1[0] * v1[0] + v1[1] * v1[1] + v1[2] * v1[2];
  const arg2 = v2[0] * v2[0] + v2[1] * v2[1] + v2[2] * v2[2];
  const denom = Math.sqrt(arg1) * Math.sqrt(arg2);
  let result = 0;
  if (denom > R_SMALL) result = (v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / denom;
  if (result < -1) result = -1;
  else if (result > 1) result = 1;
  return f(Math.acos(f(result)));
}

/** `get_dihedral3f`: signed dihedral (degrees) in PyMOL's convention. */
function dihedral(v0: Vec3, v1: Vec3, v2: Vec3, v3: Vec3): number {
  const d21 = sub(v2, v1);
  const d01 = sub(v0, v1);
  const d32 = sub(v3, v2);
  let result: number;
  if (length(d21) < R_SMALL) {
    result = angleBetween(d01, d32);
  } else {
    const dd1 = cross(d21, d01);
    const dd3 = cross(d21, d32);
    if (length(dd1) < R_SMALL || length(dd3) < R_SMALL) {
      result = angleBetween(d01, d32);
    } else {
      result = angleBetween(dd1, dd3);
      const posD = cross(d21, dd1);
      if (dot(dd3, posD) < 0) result = -result;
    }
  }
  // rad_to_deg: (float)(180.0 * (angle / PI)); angle is already a float radian.
  return f(180.0 * (result / Math.PI));
}

/* ------------------------------ H-bond geometry -------------------------- */

/** `ObjectMoleculeInitHBondCriteria` overridden by the SS-specific values. */
interface HBondCriteria {
  maxAngle: number;
  maxDistAtMaxAngle: number;
  maxDistAtZero: number;
  powerA: number;
  powerB: number;
  factorA: number;
  factorB: number;
  coneDangle: number;
}

function ssHBondCriteria(): HBondCriteria {
  // SelectorAssignSS overrides the defaults after ObjectMoleculeInitHBondCriteria.
  const maxAngle = 63.0;
  const powerA = 1.6;
  const powerB = 5.0;
  return {
    maxAngle,
    maxDistAtMaxAngle: 3.2,
    maxDistAtZero: 4.0,
    powerA,
    powerB,
    factorA: 0.5 / Math.pow(maxAngle, powerA),
    factorB: 0.5 / Math.pow(maxAngle, powerB),
    coneDangle: 0.0, // cos(90 * 180/180) = 0
  };
}

/**
 * Place the best donor hydrogen on a tetrahedral backbone nitrogen, oriented
 * toward `seek` (the donor->acceptor vector). Mirrors
 * `CoordSetFindOpenValenceVector` for the tetrahedral geometry that PyMOL infers
 * for every amide N when all bonds are single (hydrogen-free PDB). Returns the
 * absolute H coordinate (1 Å from N), or `null` if no open valence exists.
 */
/** A neighbour of the donor nitrogen: its coordinate and whether it is a hydrogen. */
interface Neighbor {
  pos: Vec3;
  isH: boolean;
}

/**
 * Place / select the best donor hydrogen on a backbone amide nitrogen, oriented
 * toward `seek` (the donor->acceptor vector). Mirrors `ObjectMoleculeFindBestDonorH`
 * + the planar branch of `CoordSetFindOpenValenceVector`:
 *   - If the N carries an EXPLICIT hydrogen (hydrogenated structure), use that H's
 *     real coordinate (the one best aligned with `seek`).
 *   - Otherwise, when there is an open valence (fewer heavy neighbours than the
 *     amide N's valence of 3), place a VIRTUAL H in the peptide plane.
 * PyMOL infers a *planar* (sp2) amide nitrogen, so the virtual H sits in-plane —
 * a tetrahedral N would push it out of plane and mis-call borderline β-bulge
 * H-bonds. Returns the absolute H coordinate, or `null` if the N cannot donate.
 */
function bestDonorH(nPos: Vec3, neighbors: Neighbor[], seek: Vec3): Vec3 | null {
  const nn = neighbors.length;
  let best: Vec3 | null = null;
  let bestDot = 0;
  let usingVirtual = false;

  // Virtual hydrogen if there is an open valence (amide N valence = 3, planar).
  if (nn < 3) {
    const occ = neighbors.map((d) => normalize(sub(d.pos, nPos)));
    let v: Vec3;
    if (occ.length === 0) {
      v = seek;
    } else if (occ.length === 1) {
      const y = normalize(cross(occ[0]!, seek));
      const b = normalize(cross(y, occ[0]!));
      const a = normalize(occ[0]!);
      v = add(scale(a, -0.5), scale(b, 0.866));
    } else {
      // in-plane bisector opposite the two existing bonds.
      v = scale(add(occ[0]!, occ[1]!), -1);
    }
    v = normalize(v);
    best = add(nPos, v);
    bestDot = dot(v, seek);
    usingVirtual = true;
  }

  // Explicit hydrogens override the virtual one; among several, pick the H best
  // aligned with `seek` (PyMOL keeps the largest cand·dir).
  for (const nb of neighbors) {
    if (!nb.isH) continue;
    const candDir = normalize(sub(nb.pos, nPos));
    const candDot = dot(candDir, seek);
    if (best === null) {
      best = nb.pos;
      bestDot = candDot;
    } else if (bestDot < candDot || usingVirtual) {
      best = nb.pos;
      bestDot = candDot;
      usingVirtual = false;
    }
  }
  return best;
}

/**
 * `ObjectMoleculeGetAvgHBondVector` for a carbonyl oxygen acceptor (one heavy
 * neighbour, sp3 in the single-bond model). Writes the lone-pair plane vector
 * into `out`, optimised against `incoming` (the H->acceptor vector). Returns the
 * average-vector length (>0.1 means the plane is meaningful).
 */
function acceptorPlane(oPos: Vec3, cPos: Vec3, incoming: Vec3): { len: number; plane: Vec3 } {
  // Single neighbour C: v_acc = unit(O - C).
  let v = normalize(sub(oPos, cPos));
  const len = 1.0; // length(v_acc)/vec_cnt with vec_cnt === 1
  // vec_cnt === 1 and the O is sp3 (no double bond perceived) => optimise plane.
  if (Math.abs(dot(v, incoming)) < 0.99) {
    // remove_component3f(incoming, v) then rotate v off the C-O axis.
    const d = dot(incoming, v);
    let vPerp: Vec3 = [incoming[0] - v[0] * d, incoming[1] - v[1] * d, incoming[2] - v[2] * d];
    vPerp = normalize(vPerp);
    const tmp = add(scale(v, 0.333644), scale(vPerp, 0.942699));
    v = normalize(sub(v, tmp));
  }
  return { len, plane: v };
}

/** `ObjectMoleculeTestHBond`: angle + distance-interpolated cutoff test. */
function testHBond(
  donToAcc: Vec3,
  donToH: Vec3,
  hToAcc: Vec3,
  accPlane: Vec3 | null,
  hbc: HBondCriteria,
): boolean {
  const nHToAcc = normalize(hToAcc);
  if (accPlane) {
    const nAccPlane = normalize(accPlane);
    if (dot(nHToAcc, nAccPlane) > -hbc.coneDangle) return false;
  }
  const nDonToH = normalize(donToH);
  const nDonToAcc = normalize(donToAcc);
  const dangle = dot(nDonToH, nDonToAcc);
  let angle: number;
  if (dangle < 1.0 && dangle > 0.0) angle = (180.0 * Math.acos(dangle)) / Math.PI;
  else if (dangle > 0.0) angle = 0.0;
  else angle = 90.0;

  if (angle > hbc.maxAngle) return false;

  let cutoff: number;
  if (hbc.maxDistAtMaxAngle !== 0.0) {
    const curve =
      Math.pow(angle, hbc.powerA) * hbc.factorA + Math.pow(angle, hbc.powerB) * hbc.factorB;
    cutoff = hbc.maxDistAtMaxAngle * curve + hbc.maxDistAtZero * (1.0 - curve);
  } else {
    cutoff = hbc.maxDistAtZero;
  }
  return length(donToAcc) <= cutoff;
}

/* ------------------------------ connectivity ----------------------------- */

/** `ObjectMoleculeCheckBondSep`: is `a1` reachable from `a0` by a distinct
 *  simple path of exactly `dist` bonds? (CA->N->C->CA is 3 bonds.) */
function checkBondSep(adj: number[][], a0: number, a1: number, dist: number): boolean {
  const history: number[] = [a0];
  function walk(node: number, depth: number): boolean {
    for (const n0 of adj[node] ?? []) {
      if (history.includes(n0)) continue;
      if (depth < dist) {
        history.push(n0);
        if (walk(n0, depth + 1)) return true;
        history.pop();
      } else if (n0 === a1) {
        return true;
      }
    }
    return false;
  }
  return walk(a0, 1);
}

/** `SelectorCheckNeighbors`: are `at1` and `at2` within `maxDist` bonds? */
function withinBonds(adj: number[][], at1: number, at2: number, maxDist: number): boolean {
  const distOf = new Map<number, number>();
  distOf.set(at1, 0);
  const stack: number[] = [at1];
  while (stack.length) {
    const a = stack.pop()!;
    const dist = distOf.get(a)! + 1;
    for (const a1 of adj[a] ?? []) {
      if (a1 === at2) return true;
      if (!distOf.has(a1) && dist < maxDist) {
        distOf.set(a1, dist);
        stack.push(a1);
      }
    }
  }
  return false;
}

/** Covalent radius (Å) for a PDB atom, guessed from the atom NAME's element.
 *  Robust to a loader that mis-inferred the element for element-less PDBs. */
const NAME_RADII: Readonly<Record<string, number>> = {
  H: 0.31,
  C: 0.76,
  N: 0.71,
  O: 0.66,
  S: 1.05,
  P: 1.07,
};
function covalentRadiusByName(name: string): number {
  // Element is the leading letter of the trimmed name (organic backbone: the
  // second letter is a position code — CA/CB/CG/ND1/HH11 — never a 2-char
  // element here). Two-letter metals/halogens are irrelevant to the SS graph.
  const letters = name.toUpperCase().replace(/[^A-Z]/g, '');
  const r = NAME_RADII[letters.charAt(0)];
  return typeof r === 'number' ? r : 0.77;
}

/* --------------------------------- SS core ------------------------------- */

// Flag bits (Selector.cpp).
const HELIX3 = 0x0001;
const HELIX4 = 0x0002;
const HELIX5 = 0x0004;
const HELIX_HB = HELIX3 | HELIX4 | HELIX5;
const PHIPSI_HELIX = 0x0010;
const PHIPSI_NOT_HELIX = 0x0020;
const PHIPSI_STRAND = 0x0040;
const PHIPSI_NOT_STRAND = 0x0080;
const ANTI_SINGLE = 0x0100;
const ANTI_DOUBLE = 0x0200;
const ANTI_BULDGE = 0x0400;
const ANTI_SKIP = 0x0800;
const PARA_SINGLE = 0x1000;
const PARA_DOUBLE = 0x2000;
const PARA_SKIP = 0x4000;

const SS_BREAK_SIZE = 5;
const SS_MAX_HBOND = 6;

// φ/ψ targets and windows (SettingInfo.h defaults).
const HELIX_PSI_TARGET = -48.0;
const HELIX_PSI_INCLUDE = 55.0;
const HELIX_PSI_EXCLUDE = 85.0;
const HELIX_PHI_TARGET = -57.0;
const HELIX_PHI_INCLUDE = 55.0;
const HELIX_PHI_EXCLUDE = 85.0;
const STRAND_PSI_TARGET = 124.0;
const STRAND_PSI_INCLUDE = 40.0;
const STRAND_PSI_EXCLUDE = 90.0;
const STRAND_PHI_TARGET = -129.0;
const STRAND_PHI_INCLUDE = 40.0;
const STRAND_PHI_EXCLUDE = 100.0;

interface SSResi {
  real: boolean;
  present: boolean;
  n: number; // atom indices
  ca: number;
  c: number;
  o: number;
  ss: string; // '', 'L', 'H', 'S', 'h'
  ssSave: string;
  flags: number;
  phi: number;
  psi: number;
  nAcc: number;
  acc: number[];
  nDon: number;
  don: number[];
}

function emptyResi(): SSResi {
  return {
    real: false,
    present: false,
    n: -1,
    ca: -1,
    c: -1,
    o: -1,
    ss: '',
    ssSave: '',
    flags: 0,
    phi: 0,
    psi: 0,
    nAcc: 0,
    acc: [],
    nDon: 0,
    don: [],
  };
}

/**
 * Assign secondary structure onto `mol` for the given 0-based `stateList`,
 * writing the `ss` code onto Cα atoms whose index is in `target`. `preserve`
 * keeps existing H/S assignments untouched (per object). Mirrors
 * SelectorAssignSS's consensus behaviour across states.
 */
export function assignSecondaryStructure(
  mol: ObjectMolecule,
  stateList: number[],
  preserve: boolean,
  target: (atomIdx: number) => boolean,
): void {
  const atoms = mol.atoms;
  const nAtom = atoms.length;

  // Backbone connectivity by distance, using radii derived from the atom NAME's
  // leading letter rather than `mol.bonds`. A PDB with no element column and
  // left-justified names makes the loader mis-guess elements (e.g. "CA" ->
  // calcium, radius 1.76 Å), which corrupts the distance bonding and would fuse
  // the backbone. Guessing C/N/O/H/S/P from the name is reliable for the organic
  // backbone and yields PyMOL-equivalent connectivity for the H-bond graph.
  const adj: number[][] = Array.from({ length: nAtom }, () => []);
  const connState = mol.states[(stateList[0] ?? 0)] ?? mol.states[0];
  if (connState) {
    const rad = new Float64Array(nAtom);
    for (let i = 0; i < nAtom; i++) rad[i] = covalentRadiusByName(atoms[i]!.name);
    for (let i = 0; i < nAtom; i++) {
      const xi = connState[i * 3]!;
      const yi = connState[i * 3 + 1]!;
      const zi = connState[i * 3 + 2]!;
      for (let j = i + 1; j < nAtom; j++) {
        const cutoff = rad[i]! + rad[j]! + 0.35;
        const dx = xi - connState[j * 3]!;
        const dy = yi - connState[j * 3 + 1]!;
        const dz = zi - connState[j * 3 + 2]!;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > 0.01 && d2 <= cutoff * cutoff) {
          adj[i]!.push(j);
          adj[j]!.push(i);
        }
      }
    }
  }

  // Backbone atoms are matched by NAME, not element: a PDB without an element
  // column makes the loader mis-guess (e.g. "CA" -> calcium, "NE" -> neon), yet
  // the name is reliable. Requiring N/C/O in the residue (below) filters out
  // stray metal ions that happen to be named "CA". This matches PyMOL's outcome
  // (its protons are inferred correctly) and is robust to the loader quirk.
  const isCA = (i: number): boolean => atoms[i]!.name.toUpperCase() === 'CA';
  // A neighbour of the backbone N is a hydrogen iff its (optionally digit-prefixed)
  // name begins with H — the amide H(s); the other N neighbours are carbons.
  const isHydrogen = (i: number): boolean =>
    atoms[i]!.elem === 'H' || /^[0-9]*H/.test(atoms[i]!.name.toUpperCase());
  const sameResidue = (i: number, j: number): boolean => {
    const a = atoms[i]!;
    const b = atoms[j]!;
    return a.chain === b.chain && a.segi === b.segi && a.resi === b.resi && a.resn === b.resn;
  };

  // Pass 1: collect real residues (CA with N, C, O) in atom order.
  const real: SSResi[] = [];
  for (let a = 0; a < nAtom; a++) {
    if (!isCA(a)) continue;
    let a0 = a - 1;
    while (a0 >= 0 && sameResidue(a0, a)) a0--;
    let a1 = a + 1;
    while (a1 < nAtom && sameResidue(a1, a)) a1++;
    let foundN = -1;
    let foundC = -1;
    let foundO = -1;
    for (let aa = a0 + 1; aa < a1; aa++) {
      const nm = atoms[aa]!.name.toUpperCase();
      if (nm === 'C') foundC = aa;
      if (nm === 'N') foundN = aa;
      if (nm === 'O') foundO = aa;
    }
    if (foundC >= 0 && foundN >= 0 && foundO >= 0) {
      const r = emptyResi();
      r.real = true;
      r.n = foundN;
      r.o = foundO;
      r.c = foundC;
      r.ca = a;
      real.push(r);
    }
  }

  // preserve: mark residues of objects already carrying H/S (single object here).
  if (preserve) {
    // Whole-object preserve: if any CA already has H/S, keep all (matches the
    // single-object branch of SelectorAssignSS).
    const anySS = real.some((r) => {
      const s = atoms[r.ca]!.ss;
      return s === 'S' || s === 'H' || s === 's' || s === 'h';
    });
    if (anySS) return;
  }

  // Pass 2: repack into res[] with break padding between chain segments.
  const res: SSResi[] = [];
  for (let a = 0; a < real.length; a++) {
    let addBreak = false;
    if (a === 0) addBreak = true;
    else if (!checkBondSep(adj, real[a]!.ca, real[a - 1]!.ca, 3)) addBreak = true;
    if (addBreak) for (let k = 0; k < SS_BREAK_SIZE; k++) res.push(emptyResi());
    res.push(real[a]!);
  }
  for (let k = 0; k < SS_BREAK_SIZE; k++) res.push(emptyResi());
  const nRes = res.length;

  const hbc = ssHBondCriteria();
  const lo = SS_BREAK_SIZE;
  const hi = nRes - SS_BREAK_SIZE;

  for (const state of stateList) {
    const coord = (atomIdx: number): Vec3 => mol.coord(atomIdx, state + 1);

    // reset present/flags/hbonds for this coordinate set.
    for (const r of res) {
      r.present = r.real;
      r.flags = 0;
      r.nAcc = 0;
      r.acc = [];
      r.nDon = 0;
      r.don = [];
    }

    // --- record hydrogen-bonding relationships -----------------------------
    // For every acceptor carbonyl O, find donor amide N within cutoff and test.
    const cutoff = Math.max(hbc.maxDistAtMaxAngle, hbc.maxDistAtZero);
    for (let a0 = 0; a0 < nRes; a0++) {
      const acc = res[a0]!;
      if (!acc.present) continue;
      const oPos = coord(acc.o);
      const cPos = coord(acc.c); // carbonyl carbon (O's neighbour)
      for (let a1 = 0; a1 < nRes; a1++) {
        const don = res[a1]!;
        if (!don.present) continue;
        const nPos = coord(don.n);
        // within cutoff (O..N distance)
        if (
          Math.abs(oPos[0] - nPos[0]) > cutoff ||
          Math.abs(oPos[1] - nPos[1]) > cutoff ||
          Math.abs(oPos[2] - nPos[2]) > cutoff
        )
          continue;
        const dnx = oPos[0] - nPos[0];
        const dny = oPos[1] - nPos[1];
        const dnz = oPos[2] - nPos[2];
        if (dnx * dnx + dny * dny + dnz * dnz > cutoff * cutoff) continue;

        // exclude H-bonds within 5 bonds (adjacent residues / self).
        if (withinBonds(adj, acc.o, don.n, 5)) continue;

        // donor H geometry: the amide N's neighbours (explicit H used if present,
        // otherwise a virtual H is placed in the peptide plane).
        const nbrs: Neighbor[] = (adj[don.n] ?? []).map((nb) => ({
          pos: coord(nb),
          isH: isHydrogen(nb),
        }));
        const donToAcc = sub(oPos, nPos);
        const bestH = bestDonorH(nPos, nbrs, donToAcc);
        if (!bestH) continue;
        const donToH = sub(bestH, nPos);
        const hToAcc = sub(oPos, bestH);
        const { len, plane } = acceptorPlane(oPos, cPos, hToAcc);
        const accPlane = len > 0.1 ? plane : null;
        if (!testHBond(donToAcc, donToH, hToAcc, accPlane, hbc)) continue;

        // store acceptor link (a0 accepts from a1) and donor link.
        if (acc.nAcc < SS_MAX_HBOND - 1) {
          acc.acc[acc.nAcc] = a1;
          acc.nAcc++;
        }
        if (don.nDon < SS_MAX_HBOND - 1) {
          don.don[don.nDon] = a0;
          don.nDon++;
        }
      }
    }

    // --- compute phi/psi ---------------------------------------------------
    for (let a = 0; a < nRes; a++) {
      const r = res[a]!;
      const prev = res[a - 1];
      if (r.real && prev && prev.real) {
        const pp = getPhiPsi(mol, adj, r.ca, state);
        if (pp) {
          r.phi = pp.phi;
          r.psi = pp.psi;
          let helixPsiDelta = f(Math.abs(f(r.psi - HELIX_PSI_TARGET)));
          let strandPsiDelta = f(Math.abs(f(r.psi - STRAND_PSI_TARGET)));
          let helixPhiDelta = f(Math.abs(f(r.phi - HELIX_PHI_TARGET)));
          let strandPhiDelta = f(Math.abs(f(r.phi - STRAND_PHI_TARGET)));
          if (helixPsiDelta > 180.0) helixPsiDelta = f(360.0 - helixPsiDelta);
          if (strandPsiDelta > 180.0) strandPsiDelta = f(360.0 - strandPsiDelta);
          if (helixPhiDelta > 180.0) helixPhiDelta = f(360.0 - helixPhiDelta);
          if (strandPhiDelta > 180.0) strandPhiDelta = f(360.0 - strandPhiDelta);

          if (helixPsiDelta > HELIX_PSI_EXCLUDE || helixPhiDelta > HELIX_PHI_EXCLUDE) {
            r.flags |= PHIPSI_NOT_HELIX;
          } else if (helixPsiDelta < HELIX_PSI_INCLUDE && helixPhiDelta < HELIX_PHI_INCLUDE) {
            r.flags |= PHIPSI_HELIX;
          }
          if (strandPsiDelta > STRAND_PSI_EXCLUDE || strandPhiDelta > STRAND_PHI_EXCLUDE) {
            r.flags |= PHIPSI_NOT_STRAND;
          } else if (strandPsiDelta < STRAND_PSI_INCLUDE && strandPhiDelta < STRAND_PHI_INCLUDE) {
            r.flags |= PHIPSI_STRAND;
          }
        }
      }
    }

    // tentatively assign everything present as loop.
    for (let a = lo; a < hi; a++) if (res[a]!.present) res[a]!.ss = 'L';

    // --- flag H-bond ladder patterns --------------------------------------
    for (let a = lo; a < hi; a++) {
      const r = res[a]!;
      if (!r.real) continue;

      // helical i+3/4/5 H-bonds (as acceptor or donor).
      for (let b = 0; b < r.nAcc; b++) {
        if (r.acc[b] === a + 3) r.flags |= HELIX3;
        if (r.acc[b] === a + 4) r.flags |= HELIX4;
        if (r.acc[b] === a + 5) r.flags |= HELIX5;
      }
      for (let b = 0; b < r.nDon; b++) {
        if (r.don[b] === a - 3) r.flags |= HELIX3;
        if (r.don[b] === a - 4) r.flags |= HELIX4;
        if (r.don[b] === a - 5) r.flags |= HELIX5;
      }

      // antiparallel double-H-bonded pairs.
      for (let b = 0; b < r.nAcc; b++) {
        const r2 = res[r.acc[b]!]!;
        if (r2.real) {
          for (let c = 0; c < r2.nAcc; c++) {
            if (r2.acc[c] === a) {
              r.flags |= ANTI_DOUBLE;
              r2.flags |= ANTI_DOUBLE;
            }
          }
        }
      }

      // antiparallel β-bulges.
      for (let b = 0; b < r.nAcc; b++) {
        const idx = r.acc[b]! + 1;
        const r2 = res[idx];
        if (r2 && r2.real) {
          for (let c = 0; c < r2.nAcc; c++) {
            if (r2.acc[c] === a) {
              r.flags |= ANTI_DOUBLE;
              r2.flags |= ANTI_BULDGE;
              res[idx - 1]!.flags |= ANTI_BULDGE;
            }
          }
        }
      }

      // antiparallel ladders (single/double).
      if (res[a + 1]!.real && res[a + 2]!.real) {
        for (let b = 0; b < r.nAcc; b++) {
          const idx = r.acc[b]! - 2;
          const r2 = res[idx];
          if (r2 && r2.real) {
            for (let c = 0; c < r2.nAcc; c++) {
              if (r2.acc[c] === a + 2) {
                res[a]!.flags |= ANTI_SINGLE;
                res[a + 1]!.flags |= ANTI_SKIP;
                res[a + 2]!.flags |= ANTI_SINGLE;
                res[idx]!.flags |= ANTI_SINGLE;
                res[idx + 1]!.flags |= ANTI_SKIP;
                res[idx + 2]!.flags |= ANTI_SINGLE;
              }
            }
          }
        }
      }

      // parallel ladders.
      if (res[a + 1]!.real && res[a + 2]!.real) {
        for (let b = 0; b < r.nAcc; b++) {
          const idx = r.acc[b]!;
          const r2 = res[idx];
          if (r2 && r2.real) {
            for (let c = 0; c < r2.nAcc; c++) {
              if (r2.acc[c] === a + 2) {
                res[a]!.flags |= PARA_SINGLE;
                res[a + 1]!.flags |= PARA_SKIP;
                res[a + 2]!.flags |= PARA_SINGLE;
                res[idx]!.flags |= PARA_DOUBLE;
              }
            }
          }
        }
      }
    }

    // --- convert flags to assignments: helices first ----------------------
    for (let a = lo; a < hi; a++) {
      const r = res[a]!;
      if (!r.real) continue;
      if (
        res[a - 1]!.flags & HELIX_HB &&
        r.flags & HELIX_HB &&
        res[a + 1]!.flags & HELIX_HB &&
        !(r.flags & PHIPSI_NOT_HELIX)
      ) {
        r.ss = 'H';
      }
    }

    for (let a = lo; a < hi; a++) {
      const r = res[a]!;
      if (!r.real) continue;
      if (
        res[a - 2]!.flags & HELIX_HB &&
        res[a - 1]!.flags & HELIX_HB &&
        res[a - 1]!.flags & PHIPSI_HELIX &&
        r.flags & PHIPSI_HELIX &&
        res[a + 1]!.flags & HELIX_HB &&
        res[a + 1]!.flags & PHIPSI_HELIX &&
        res[a + 2]!.flags & HELIX_HB
      ) {
        r.ss = 'h';
      }
    }

    for (let a = lo; a < hi; a++) {
      const r = res[a]!;
      if (r.real && r.ss === 'h') {
        r.flags |= HELIX_HB;
        r.ss = 'H';
      }
    }

    for (let a = lo; a < hi; a++) {
      const r = res[a]!;
      if (!r.real) continue;
      if (
        r.flags & HELIX_HB &&
        r.flags & PHIPSI_HELIX &&
        res[a + 1]!.flags & HELIX_HB &&
        res[a + 1]!.flags & PHIPSI_HELIX &&
        res[a + 2]!.flags & HELIX_HB &&
        res[a + 2]!.flags & PHIPSI_HELIX &&
        res[a + 1]!.ss === 'H'
      ) {
        r.ss = 'H';
      }
      if (
        r.flags & HELIX_HB &&
        r.flags & PHIPSI_HELIX &&
        res[a - 1]!.flags & HELIX_HB &&
        res[a - 1]!.flags & PHIPSI_HELIX &&
        res[a - 2]!.flags & HELIX_HB &&
        res[a - 2]!.flags & PHIPSI_HELIX &&
        res[a - 1]!.ss === 'H'
      ) {
        r.ss = 'H';
      }
    }

    // --- sheets/strands ----------------------------------------------------
    for (let a = lo; a < hi; a++) {
      const r = res[a]!;
      if (!r.real) continue;

      if (r.flags & ANTI_DOUBLE && !(r.flags & PHIPSI_NOT_STRAND)) r.ss = 'S';

      if (r.flags & ANTI_BULDGE && res[a + 1]!.flags & ANTI_BULDGE) {
        r.ss = 'S';
        res[a + 1]!.ss = 'S';
      }

      if (
        res[a - 1]!.flags & ANTI_DOUBLE &&
        r.flags & ANTI_SKIP &&
        !(r.flags & PHIPSI_NOT_STRAND) &&
        res[a + 1]!.flags & (ANTI_SINGLE | ANTI_DOUBLE)
      ) {
        r.ss = 'S';
      }

      if (
        res[a - 1]!.flags & (ANTI_SINGLE | ANTI_DOUBLE) &&
        r.flags & ANTI_SKIP &&
        !(r.flags & PHIPSI_NOT_STRAND) &&
        res[a + 1]!.flags & ANTI_DOUBLE
      ) {
        r.ss = 'S';
      }

      if (
        res[a - 1]!.flags & (ANTI_SINGLE | ANTI_DOUBLE) &&
        res[a - 1]!.flags & PHIPSI_STRAND &&
        r.flags & PHIPSI_STRAND &&
        res[a + 1]!.flags & (ANTI_SINGLE | ANTI_DOUBLE) &&
        res[a + 1]!.flags & PHIPSI_STRAND
      ) {
        res[a - 1]!.ss = 'S';
        r.ss = 'S';
        res[a + 1]!.ss = 'S';
      }

      // parallel sheets
      if (r.flags & PARA_DOUBLE && !(r.flags & PHIPSI_NOT_STRAND)) r.ss = 'S';

      if (
        res[a - 1]!.flags & PARA_DOUBLE &&
        r.flags & PARA_SKIP &&
        !(r.flags & PHIPSI_NOT_STRAND) &&
        res[a + 1]!.flags & (PARA_SINGLE | PARA_DOUBLE)
      ) {
        r.ss = 'S';
      }

      if (
        res[a - 1]!.flags & (PARA_SINGLE | PARA_DOUBLE) &&
        r.flags & PARA_SKIP &&
        !(r.flags & PHIPSI_NOT_STRAND) &&
        res[a + 1]!.flags & PARA_DOUBLE
      ) {
        r.ss = 'S';
      }

      if (
        res[a - 1]!.flags & (PARA_SINGLE | PARA_DOUBLE) &&
        res[a - 1]!.flags & PHIPSI_STRAND &&
        r.flags & PARA_SKIP &&
        r.flags & PHIPSI_STRAND &&
        res[a + 1]!.flags & (PARA_SINGLE | PARA_DOUBLE) &&
        res[a + 1]!.flags & PHIPSI_STRAND
      ) {
        res[a - 1]!.ss = 'S';
        r.ss = 'S';
        res[a + 1]!.ss = 'S';
      }
    }

    // --- clean up short segments ------------------------------------------
    let repeat = true;
    while (repeat) {
      repeat = false;
      for (let a = lo; a < hi; a++) {
        const r = res[a]!;
        if (!r.real) continue;

        if (
          r.ss === 'S' &&
          res[a + 1]!.ss === 'S' &&
          res[a - 1]!.ss !== 'S' &&
          res[a + 2]!.ss !== 'S'
        ) {
          r.ss = 'L';
          res[a + 1]!.ss = 'L';
          repeat = true;
        }
        if (
          r.ss === 'H' &&
          res[a + 1]!.ss === 'H' &&
          res[a - 1]!.ss !== 'H' &&
          res[a + 2]!.ss !== 'H'
        ) {
          r.ss = 'L';
          res[a + 1]!.ss = 'L';
          repeat = true;
        }
        if (r.ss === 'S' && res[a - 1]!.ss !== 'S' && res[a + 1]!.ss !== 'S') {
          r.ss = 'L';
          repeat = true;
        }
        if (r.ss === 'H' && res[a - 1]!.ss !== 'H' && res[a + 1]!.ss !== 'H') {
          r.ss = 'L';
          repeat = true;
        }

        // terminal strand residues must have a partner.
        if (r.ss === 'S' && (res[a - 1]!.ss !== 'S' || res[a + 1]!.ss !== 'S')) {
          let found = false;
          for (let b = 0; b < r.nAcc; b++) {
            if (res[r.acc[b]!]!.ss === r.ss) {
              found = true;
              break;
            }
          }
          if (!found) {
            for (let b = 0; b < r.nDon; b++) {
              if (res[r.don[b]!]!.ss === r.ss) {
                found = true;
                break;
              }
            }
          }
          if (!found) {
            if (r.flags & (ANTI_SKIP | PARA_SKIP)) {
              if (res[a + 1]!.ss === r.ss) {
                for (let b = 0; b < res[a + 1]!.nAcc; b++) {
                  if (res[res[a + 1]!.acc[b]!]!.ss === r.ss) {
                    found = true;
                    break;
                  }
                }
              }
              if (!found && res[a - 1]!.ss === r.ss) {
                for (let b = 0; b < res[a - 1]!.nDon; b++) {
                  if (res[res[a - 1]!.don[b]!]!.ss === r.ss) {
                    found = true;
                    break;
                  }
                }
              }
            }
          }
          if (!found) {
            r.ss = 'L';
            repeat = true;
          }
        }
      }
    }

    // --- consensus / union across states ----------------------------------
    for (let a = 0; a < nRes; a++) {
      const r = res[a]!;
      if (r.present) {
        if (r.ssSave) {
          if (r.ss !== r.ssSave) {
            // consensus (default) collapses disagreement to loop.
            r.ss = r.ssSave = 'L';
          }
        }
        r.ssSave = r.ss;
      }
    }
  }

  // --- write ss back onto Cα atoms in the target ---------------------------
  for (let a = 0; a < nRes; a++) {
    const r = res[a]!;
    if (r.present && target(r.ca)) {
      atoms[r.ca]!.ss = r.ssSave;
    }
  }
}

/** `ObjectMoleculeGetPhiPsi` for the Cα at atom index `ca`. */
function getPhiPsi(
  mol: ObjectMolecule,
  adj: number[][],
  ca: number,
  state: number,
): { phi: number; psi: number } | null {
  const atoms = mol.atoms;
  const nameOf = (i: number): string => atoms[i]!.name.toUpperCase();
  if (nameOf(ca) !== 'CA') return null;
  let c = -1;
  let n = -1;
  for (const nb of adj[ca] ?? []) {
    if (c < 0 && nameOf(nb) === 'C') c = nb;
  }
  for (const nb of adj[ca] ?? []) {
    if (n < 0 && nameOf(nb) === 'N') n = nb;
  }
  let np = -1;
  if (c >= 0) for (const nb of adj[c] ?? []) if (np < 0 && nameOf(nb) === 'N') np = nb;
  let cm = -1;
  if (n >= 0) for (const nb of adj[n] ?? []) if (cm < 0 && nameOf(nb) === 'C') cm = nb;
  if (ca >= 0 && np >= 0 && c >= 0 && n >= 0 && cm >= 0) {
    const vCa = mol.coord(ca, state + 1) as Vec3;
    const vN = mol.coord(n, state + 1) as Vec3;
    const vC = mol.coord(c, state + 1) as Vec3;
    const vCm = mol.coord(cm, state + 1) as Vec3;
    const vNp = mol.coord(np, state + 1) as Vec3;
    return {
      phi: dihedral(vC, vCa, vN, vCm),
      psi: dihedral(vNp, vC, vCa, vN),
    };
  }
  return null;
}
