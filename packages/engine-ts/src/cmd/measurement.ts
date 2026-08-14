/**
 * The `measurement` command subsystem — PyMOL's geometry queries.
 *
 * Ports the `cmd.get_*` family that reads coordinates back out of the executive
 * (`packages/engine/modules/pymol/querying.py`,
 * `packages/engine/layer3/Executive.cpp`,
 * `packages/engine/layer2/ObjectMolecule.cpp`):
 *
 *   get_distance / get_angle / get_dihedral  — single-atom geometry
 *   get_extent / get_atom_coords / get_coords — coordinate readout
 *   centerofmass                              — mass-weighted centroid
 *   get_position                              — centre of the viewer window
 *   phi_psi                                   — backbone torsions per residue
 *
 * The angle/dihedral sign conventions replicate `get_angle3f` /
 * `get_dihedral3f` (`packages/engine/layer0/Vector.cpp`) exactly, so signed
 * torsions match PyMOL bit-for-bit (a right-handed alpha helix gives phi ~ -57).
 */

import type { Json } from '@tenmol/protocol';
import { encodeCoords } from '@tenmol/protocol';
import type { ObjectMolecule } from '../model/molecule';
import type { UniverseAtom } from '../select/selector';
import type { RegistrarCtx } from './registrar';

type Vec3 = [number, number, number];

/* --------------------------- atomic masses --------------------------- */

/**
 * Atomic masses (u), keyed by canonical (title-case) element symbol. Values are
 * PyMOL's `chempy.atomic_mass` table (`packages/engine/modules/chempy/__init__.py`),
 * which `centerofmass` reads through `a.get_mass()`. Covers the biomolecular set;
 * anything outside it falls back to `DEFAULT_MASS`.
 */
const ATOMIC_MASS: Readonly<Record<string, number>> = {
  H: 1.00794,
  He: 4.002602,
  Li: 6.941,
  Be: 9.012182,
  B: 10.811,
  C: 12.0107,
  N: 14.0067,
  O: 15.9994,
  F: 18.9984032,
  Ne: 20.1797,
  Na: 22.98977,
  Mg: 24.305,
  Al: 26.981538,
  Si: 28.0855,
  P: 30.973761,
  S: 32.065,
  Cl: 35.453,
  K: 39.0983,
  Ca: 40.078,
  Mn: 54.938049,
  Fe: 55.845,
  Co: 58.9332,
  Ni: 58.6934,
  Cu: 63.546,
  Zn: 65.409,
  Se: 78.96,
  Br: 79.904,
  I: 126.90447,
};
const DEFAULT_MASS = 12.0107;

function massOf(elem: string): number {
  const t = elem.trim();
  const key = t === '' ? '' : t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  return ATOMIC_MASS[key] ?? DEFAULT_MASS;
}

/* ------------------------------ vec math ----------------------------- */

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function len(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

const R_SMALL = 1e-8;

/** Port of `get_angle3f` — angle (radians) between two vectors, clamped. */
function angle3f(v1: Vec3, v2: Vec3): number {
  const denom = len(v1) * len(v2);
  if (denom <= R_SMALL) return 0;
  let c = dot(v1, v2) / denom;
  if (c < -1) c = -1;
  else if (c > 1) c = 1;
  return Math.acos(c);
}

/**
 * Port of `get_dihedral3f` (`packages/engine/layer0/Vector.cpp`) — the signed
 * torsion (radians) about the v1->v2 axis. The sign is derived exactly as PyMOL
 * does (`dot(dd3, d21 x dd1) < 0`), so parity holds bit-for-bit.
 */
function dihedral3f(v0: Vec3, v1: Vec3, v2: Vec3, v3: Vec3): number {
  const d21 = sub(v2, v1);
  const d01 = sub(v0, v1);
  const d32 = sub(v3, v2);
  if (len(d21) < R_SMALL) return angle3f(d01, d32);
  const dd1 = cross(d21, d01);
  const dd3 = cross(d21, d32);
  if (len(dd1) < R_SMALL || len(dd3) < R_SMALL) return angle3f(d01, d32);
  let result = angle3f(dd1, dd3);
  const posD = cross(d21, dd1);
  if (dot(dd3, posD) < 0) result = -result;
  return result;
}

const RAD_TO_DEG = 180 / Math.PI;

/* ------------------------------ helpers ------------------------------ */

function num(v: unknown, dflt: number): number {
  if (v == null || v === '') return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

/** Positional arg `i`, else `kwargs[key]`. */
function arg(args: unknown[], kwargs: Record<string, unknown>, i: number, key: string): unknown {
  return args[i] ?? kwargs[key];
}

export function registerMeasurement(ctx: RegistrarCtx): void {
  const ex = ctx.executive;
  const str = ctx.str;

  const molOf = (ua: UniverseAtom): ObjectMolecule => ex.molecule(ua.objName)!;

  /** Coordinate of a universe atom in a 1-based state. */
  const coordAt = (ua: UniverseAtom, state: number): Vec3 => molOf(ua).coord(ua.index, state);

  /**
   * Resolve the effective 1-based state for the single-state coordinate
   * queries: PyMOL's default (0 / current) maps to the first state.
   */
  const oneState = (state: number): number => (state > 0 ? state : 1);

  /** The single atom of a selection, or throw (PyMOL requires exactly one). */
  const singleAtom = (sel: string, label: string): UniverseAtom => {
    const matched = ex.atomsMatching(sel);
    if (matched.length !== 1) {
      throw new Error(`${label}: selection "${sel}" must contain exactly one atom (got ${matched.length})`);
    }
    return matched[0]!;
  };

  const singleCoord = (sel: string, state: number, label: string): Vec3 =>
    coordAt(singleAtom(sel, label), oneState(state));

  /* ----------------------------- distances ---------------------------- */

  ctx.command('get_distance', (args, kwargs): Json => {
    const a1 = str(arg(args, kwargs, 0, 'atom1'));
    const a2 = str(arg(args, kwargs, 1, 'atom2'));
    const state = num(arg(args, kwargs, 2, 'state'), 0);
    const p1 = singleCoord(a1, state, 'get_distance');
    const p2 = singleCoord(a2, state, 'get_distance');
    return len(sub(p1, p2));
  });

  ctx.command('get_angle', (args, kwargs): Json => {
    const a1 = str(arg(args, kwargs, 0, 'atom1'));
    const a2 = str(arg(args, kwargs, 1, 'atom2'));
    const a3 = str(arg(args, kwargs, 2, 'atom3'));
    const state = num(arg(args, kwargs, 3, 'state'), 0);
    const v1 = singleCoord(a1, state, 'get_angle');
    const v2 = singleCoord(a2, state, 'get_angle');
    const v3 = singleCoord(a3, state, 'get_angle');
    // vertex is atom2: angle between (v1 - v2) and (v3 - v2).
    return RAD_TO_DEG * angle3f(sub(v1, v2), sub(v3, v2));
  });

  ctx.command('get_dihedral', (args, kwargs): Json => {
    const a1 = str(arg(args, kwargs, 0, 'atom1'));
    const a2 = str(arg(args, kwargs, 1, 'atom2'));
    const a3 = str(arg(args, kwargs, 2, 'atom3'));
    const a4 = str(arg(args, kwargs, 3, 'atom4'));
    const state = num(arg(args, kwargs, 4, 'state'), 0);
    const v1 = singleCoord(a1, state, 'get_dihedral');
    const v2 = singleCoord(a2, state, 'get_dihedral');
    const v3 = singleCoord(a3, state, 'get_dihedral');
    const v4 = singleCoord(a4, state, 'get_dihedral');
    return RAD_TO_DEG * dihedral3f(v1, v2, v3, v4);
  });

  /* --------------------------- coordinates ---------------------------- */

  ctx.command('get_atom_coords', (args, kwargs): Json => {
    const sel = str(arg(args, kwargs, 0, 'selection'));
    const state = num(arg(args, kwargs, 1, 'state'), 0);
    return singleCoord(sel, state, 'get_atom_coords') as unknown as Json;
  });

  ctx.command('get_coords', (args, kwargs): Json => {
    const sel = str(arg(args, kwargs, 0, 'selection'), 'all');
    const state = oneState(num(arg(args, kwargs, 1, 'state'), 0));
    const matched = ex.atomsMatching(sel);
    // API-only: real PyMOL returns an N×3 numpy float32 array (None for an empty
    // selection). Over the bridge that array is serialized as a base64
    // `__ndarray__` (packages/bridge/tenmol_bridge/codec.py); match that wire
    // shape here rather than returning a plain nested JS array.
    if (matched.length === 0) return null;
    return encodeCoords(matched.map((ua) => coordAt(ua, state))) as unknown as Json;
  });

  ctx.command('get_extent', (args, kwargs): Json => {
    const sel = str(arg(args, kwargs, 0, 'selection'), 'all');
    const state = num(arg(args, kwargs, 1, 'state'), 0);
    const matched = ex.atomsMatching(sel);
    if (matched.length === 0) return null;
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const ua of matched) {
      const mol = molOf(ua);
      // state 0 -> union across every state; otherwise the single state.
      const states = state === 0 ? range(1, mol.nstate) : [oneState(state)];
      for (const s of states) {
        const [x, y, z] = mol.coord(ua.index, s);
        if (x < min[0]) min[0] = x;
        if (y < min[1]) min[1] = y;
        if (z < min[2]) min[2] = z;
        if (x > max[0]) max[0] = x;
        if (y > max[1]) max[1] = y;
        if (z > max[2]) max[2] = z;
      }
    }
    return [min, max];
  });

  ctx.command('centerofmass', (args, kwargs): Json => {
    const sel = str(arg(args, kwargs, 0, 'selection'), 'all');
    const state = num(arg(args, kwargs, 1, 'state'), 0);
    const matched = ex.atomsMatching(sel);
    if (matched.length === 0) throw new Error('centerofmass: empty selection');
    const com: Vec3 = [0, 0, 0];
    let totmass = 0;
    for (const ua of matched) {
      const mol = molOf(ua);
      const states = state === 0 ? range(1, mol.nstate) : [oneState(state)];
      // PyMOL weights by mass * (occupancy or 1.0).
      const m = massOf(ua.atom.elem) * (ua.atom.q || 1.0);
      for (const s of states) {
        const [x, y, z] = mol.coord(ua.index, s);
        com[0] += x * m;
        com[1] += y * m;
        com[2] += z * m;
        totmass += m;
      }
    }
    if (totmass === 0) throw new Error('centerofmass: mass is zero');
    return [com[0] / totmass, com[1] / totmass, com[2] / totmass];
  });

  /* ------------------------------ camera ------------------------------ */

  ctx.command('get_position', (): Json => {
    // Port of SceneGetCenter (packages/engine/layer1/Scene.cpp): the centre of
    // the viewer window in model space. pos = R^-1 * (R*origin - camXY).
    const v = ex.view.get();
    const r = v.slice(0, 9);
    const origin: Vec3 = [v[12]!, v[13]!, v[14]!];
    // forward: p = R * origin (R column-major 3x3).
    let px = r[0]! * origin[0] + r[3]! * origin[1] + r[6]! * origin[2];
    let py = r[1]! * origin[0] + r[4]! * origin[1] + r[7]! * origin[2];
    const pz0 = r[2]! * origin[0] + r[5]! * origin[1] + r[8]! * origin[2];
    px -= v[9]!; // camera x
    py -= v[10]!; // camera y (z is intentionally not subtracted, per PyMOL)
    const pz = pz0;
    // inverse: p = R^T * p.
    return [
      r[0]! * px + r[1]! * py + r[2]! * pz,
      r[3]! * px + r[4]! * py + r[5]! * pz,
      r[6]! * px + r[7]! * py + r[8]! * pz,
    ];
  });

  /* ---------------------------- phi / psi ----------------------------- */

  ctx.command('phi_psi', (args, kwargs): Json => {
    const sel = str(arg(args, kwargs, 0, 'selection'), 'all');
    const state = oneState(num(arg(args, kwargs, 1, 'state'), 0));
    const matched = ex.atomsMatching(sel);
    const out: Record<string, [number, number]> = {};
    for (const ua of matched) {
      const mol = molOf(ua);
      if (ua.atom.name !== 'CA') continue;
      const pp = phiPsiForCA(mol, ua.index, state);
      if (pp) out[`${ua.objName}/${ua.atom.resi}`] = pp;
    }
    return out as unknown as Json;
  });
}

/* --------------------------- phi/psi engine -------------------------- */

/** Adjacency list of an object's bonds (0-based atom indices). */
function neighborsOf(mol: ObjectMolecule): number[][] {
  const adj: number[][] = Array.from({ length: mol.natom }, () => []);
  for (const [i, j] of mol.bonds) {
    adj[i]!.push(j);
    adj[j]!.push(i);
  }
  return adj;
}

/** First neighbour of `atom` with the given atom name, or -1. */
function neighborNamed(mol: ObjectMolecule, adj: number[][], atom: number, name: string): number {
  for (const n of adj[atom]!) {
    if (mol.atoms[n]!.name === name) return n;
  }
  return -1;
}

/**
 * Port of `ObjectMoleculeGetPhiPsi` (`packages/engine/layer2/ObjectMolecule.cpp`).
 * Uses connectivity, not residue numbering: for a CA it finds the bonded C and
 * N, then N-of-C (next residue) and C-of-N (previous residue). Returns `[phi,
 * psi]` in degrees only if all five backbone atoms exist.
 */
function phiPsiForCA(mol: ObjectMolecule, ca: number, state: number): [number, number] | null {
  const adj = neighborsOf(mol);
  const c = neighborNamed(mol, adj, ca, 'C');
  const n = neighborNamed(mol, adj, ca, 'N');
  const np = c >= 0 ? neighborNamed(mol, adj, c, 'N') : -1; // next residue N
  const cm = n >= 0 ? neighborNamed(mol, adj, n, 'C') : -1; // previous residue C
  if (ca < 0 || np < 0 || c < 0 || n < 0 || cm < 0) return null;
  const vCa = mol.coord(ca, state) as Vec3;
  const vN = mol.coord(n, state) as Vec3;
  const vC = mol.coord(c, state) as Vec3;
  const vCm = mol.coord(cm, state) as Vec3;
  const vNp = mol.coord(np, state) as Vec3;
  const phi = RAD_TO_DEG * dihedral3f(vC, vCa, vN, vCm);
  const psi = RAD_TO_DEG * dihedral3f(vNp, vC, vCa, vN);
  return [phi, psi];
}

/** Inclusive integer range [a, b]. */
function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}
