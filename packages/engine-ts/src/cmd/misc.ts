/**
 * The `misc` command subsystem: residual per-atom queries that don't belong to
 * a larger analysis module. Registered via the {@link RegistrarCtx}.
 *
 * Ports the shape of a grab-bag of PyMOL executive queries:
 *
 *   get_area          — solvent-accessible surface area (Å²) of a selection
 *   get_sasa_relative — per-residue relative SASA map (area / reference max ASA)
 *   find_pairs        — atom pairs within a cutoff across two selections
 *   get_bonds/get_bond— the bonds internal to a selection
 *   index             — (object, 1-based index) pairs of a selection
 *   id_atom           — the atom id of a single-atom selection
 *   indicate          — set the `indicate` named selection (like `select`)
 *
 * Names that another subsystem already owns (centerofmass, get_extent,
 * get_atom_coords, get_coords, pseudoatom, count_atoms, get_model) are NOT
 * (re)registered here.
 */

import type { Json } from '@tenmol/protocol';
import type { ObjectMolecule } from '../model/molecule';
import type { UniverseAtom } from '../select/selector';
import type { RegistrarCtx } from './registrar';

type Vec3 = [number, number, number];

/** PyMOL `solvent_radius` default (Å). */
const DEFAULT_PROBE = 1.4;

/**
 * Sample-point count per atom sphere. Higher = smoother area fractions. A lone
 * atom is 100% exposed regardless of N (fraction is exactly 1), so this only
 * affects partially-buried atoms; 400 gives a stable estimate.
 */
const N_POINTS = 400;

/* ------------------------------ small helpers ---------------------------- */

/** Positional arg `i`, falling back to the named kwarg. */
function pick(args: unknown[], kwargs: Record<string, unknown>, i: number, name: string): unknown {
  const v = args[i];
  return v !== undefined ? v : kwargs[name];
}

function num(v: unknown, dflt: number): number {
  if (v === undefined || v === null || v === '') return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

/** Resolve a coordinate state: PyMOL 0 (== "current") maps to state 1 here. */
function oneState(state: number): number {
  return state > 0 ? state : 1;
}

/**
 * N points on the unit sphere via the Fibonacci lattice — deterministic and
 * near-uniform, so the exposed fraction is a stable Monte-Carlo-free estimate.
 */
function fibonacciSphere(n: number): Vec3[] {
  const pts: Vec3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5)); // golden angle
  for (let k = 0; k < n; k++) {
    const y = 1 - ((k + 0.5) / n) * 2; // 1 -> -1
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * k;
    pts.push([Math.cos(theta) * r, y, Math.sin(theta) * r]);
  }
  return pts;
}

/**
 * Per-atom solvent-accessible surface area for a set of atoms, in input order.
 *
 * Each atom `i` is a sphere of radius `Ri = vdw_i + probe`. We tile it with
 * {@link fibonacciSphere} points and count those NOT buried inside any other
 * atom's expanded sphere (`dist(point, Cj) < Rj`); the exposed fraction times
 * the full sphere area `4π·Ri²` is the atom's contribution. Burial context is
 * the same atom set (PyMOL's caveat: include neighbours in the selection).
 */
function perAtomArea(
  centers: Vec3[],
  radii: number[],
  unit: Vec3[],
): number[] {
  const n = centers.length;
  const areas = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const ci = centers[i]!;
    const ri = radii[i]!;
    // Only atoms whose spheres can overlap atom i's sphere can bury its points.
    const neigh: number[] = [];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const cj = centers[j]!;
      const dx = ci[0] - cj[0];
      const dy = ci[1] - cj[1];
      const dz = ci[2] - cj[2];
      const reach = ri + radii[j]!;
      if (dx * dx + dy * dy + dz * dz < reach * reach) neigh.push(j);
    }
    let exposed = 0;
    for (const u of unit) {
      const px = ci[0] + u[0] * ri;
      const py = ci[1] + u[1] * ri;
      const pz = ci[2] + u[2] * ri;
      let buried = false;
      for (const j of neigh) {
        const cj = centers[j]!;
        const rj = radii[j]!;
        const dx = px - cj[0];
        const dy = py - cj[1];
        const dz = pz - cj[2];
        if (dx * dx + dy * dy + dz * dz < rj * rj) {
          buried = true;
          break;
        }
      }
      if (!buried) exposed++;
    }
    areas[i] = (exposed / unit.length) * 4 * Math.PI * ri * ri;
  }
  return areas;
}

/* -------------------------------- registrar ------------------------------ */

export function registerMisc(ctx: RegistrarCtx): void {
  const ex = ctx.executive;
  const sel0 = (v: unknown): string => ctx.str(v, 'all') || 'all';

  const probeRadius = (): number => ex.getSettingFloat('solvent_radius') || DEFAULT_PROBE;

  const molOf = (ua: UniverseAtom): ObjectMolecule => ex.molecule(ua.objName)!;

  /**
   * Gather selection atoms plus their SASA-sphere geometry (centre + vdw+probe).
   * Returns the matched atoms in selection order alongside parallel arrays.
   */
  const gatherAreaInputs = (
    sel: string,
    state: number,
  ): { matched: UniverseAtom[]; areas: number[] } => {
    const matched = ex.atomsMatching(sel);
    const probe = probeRadius();
    const s = oneState(state);
    const centers: Vec3[] = [];
    const radii: number[] = [];
    for (const ua of matched) {
      const mol = molOf(ua);
      centers.push(mol.coord(ua.index, s));
      radii.push(mol.vdw(ua.index) + probe);
    }
    const unit = fibonacciSphere(N_POINTS);
    const areas = perAtomArea(centers, radii, unit);
    return { matched, areas };
  };

  // ---- get_area ----------------------------------------------------------
  ctx.command('get_area', (args, kwargs) => {
    const sel = sel0(pick(args, kwargs, 0, 'selection'));
    const state = num(pick(args, kwargs, 1, 'state'), 0);
    const loadB = num(pick(args, kwargs, 2, 'load_b'), 0) !== 0;
    const { matched, areas } = gatherAreaInputs(sel, state);
    let total = 0;
    for (let i = 0; i < matched.length; i++) {
      total += areas[i]!;
      if (loadB) matched[i]!.atom.b = areas[i]!;
    }
    if (loadB) ctx.publish();
    return total;
  });

  // ---- get_sasa_relative -------------------------------------------------
  // Per-residue relative SASA = area IN CONTEXT / area of the residue IN
  // ISOLATION (its own atoms as the only occluders), altered into `var`
  // (default 'b'). A lone, fully-exposed residue therefore reports 1.0.
  ctx.command('get_sasa_relative', (args, kwargs) => {
    const sel = sel0(pick(args, kwargs, 0, 'selection'));
    const state = num(pick(args, kwargs, 1, 'state'), 0);
    const varName = ctx.str(kwargs.var ?? kwargs.vis, 'b') || 'b';
    const { matched, areas: contextAreas } = gatherAreaInputs(sel, state);

    // Group matched atoms into residues (object|segi|chain|resi).
    const byRes = new Map<string, number[]>();
    matched.forEach((ua, i) => {
      const a = ua.atom;
      const key = `${ua.objName}/${a.segi}/${a.chain}/${a.resi}`;
      let g = byRes.get(key);
      if (!g) byRes.set(key, (g = []));
      g.push(i);
    });

    const out: Record<string, number> = {};
    for (const [key, idxs] of byRes) {
      const contextSum = idxs.reduce((s, i) => s + contextAreas[i]!, 0);
      const ua0 = matched[idxs[0]!]!;
      const a0 = ua0.atom;
      let resSel = `${ua0.objName} and resi ${a0.resi}`;
      if (a0.chain) resSel += ` and chain ${a0.chain}`;
      if (a0.segi) resSel += ` and segi ${a0.segi}`;
      const { areas: isoAreas } = gatherAreaInputs(resSel, state);
      const isoSum = isoAreas.reduce((s, x) => s + x, 0);
      const ratio = isoSum > 0 ? contextSum / isoSum : 0;
      out[key] = ratio;
      for (const i of idxs) {
        const a = matched[i]!.atom as unknown as Record<string, unknown>;
        a[varName] = ratio;
      }
    }
    ctx.publish();
    return out as Json;
  });

  // ---- find_pairs --------------------------------------------------------
  ctx.command('find_pairs', (args, kwargs) => {
    const sel1 = sel0(pick(args, kwargs, 0, 'selection1'));
    const sel2 = sel0(pick(args, kwargs, 1, 'selection2'));
    const cutoff = num(pick(args, kwargs, 4, 'cutoff'), 3.5);
    const state = num(pick(args, kwargs, 2, 'state1'), 0);
    const s = oneState(state);
    const cut2 = cutoff * cutoff;
    const left = ex.atomsMatching(sel1);
    const right = ex.atomsMatching(sel2);
    const out: Json[] = [];
    for (const a of left) {
      const [ax, ay, az] = molOf(a).coord(a.index, s);
      for (const b of right) {
        // Skip the identical atom (same object + index).
        if (a.objName === b.objName && a.index === b.index) continue;
        const [bx, by, bz] = molOf(b).coord(b.index, s);
        const dx = ax - bx;
        const dy = ay - by;
        const dz = az - bz;
        if (dx * dx + dy * dy + dz * dz <= cut2) {
          out.push([
            [a.objName, a.index + 1],
            [b.objName, b.index + 1],
          ]);
        }
      }
    }
    return out;
  });

  // ---- get_bonds / get_bond ---------------------------------------------
  /** The internal bonds of a selection as `[obj, i1based, j1based]` triples. */
  const bondsInSelection = (sel: string): Array<[string, number, number]> => {
    const matched = ex.atomsMatching(sel);
    const byObj = new Map<string, Set<number>>();
    for (const ua of matched) {
      let set = byObj.get(ua.objName);
      if (!set) {
        set = new Set<number>();
        byObj.set(ua.objName, set);
      }
      set.add(ua.index);
    }
    const out: Array<[string, number, number]> = [];
    for (const [objName, idxSet] of byObj) {
      const mol = ex.molecule(objName);
      if (!mol) continue;
      for (const [i, j] of mol.bonds) {
        if (idxSet.has(i) && idxSet.has(j)) out.push([objName, i + 1, j + 1]);
      }
    }
    return out;
  };

  ctx.command('get_bonds', (args, kwargs) => {
    const sel = sel0(pick(args, kwargs, 0, 'selection'));
    return bondsInSelection(sel).map(([, i, j]) => [i, j]) as Json;
  });

  ctx.command('get_bond', (args, kwargs) => {
    const sel = sel0(pick(args, kwargs, 0, 'selection'));
    const bonds = bondsInSelection(sel);
    const first = bonds[0];
    return first ? ([first[1], first[2]] as Json) : null;
  });

  // ---- index -------------------------------------------------------------
  ctx.command('index', (args, kwargs) => {
    const sel = sel0(pick(args, kwargs, 0, 'selection'));
    return ex.atomsMatching(sel).map((ua) => [ua.objName, ua.index + 1]) as Json;
  });

  // ---- id_atom -----------------------------------------------------------
  ctx.command('id_atom', (args, kwargs) => {
    const sel = sel0(pick(args, kwargs, 0, 'selection'));
    const matched = ex.atomsMatching(sel);
    if (matched.length !== 1) {
      throw new Error(`id_atom: selection must contain exactly one atom (got ${matched.length})`);
    }
    return matched[0]!.atom.id;
  });

  // ---- indicate ----------------------------------------------------------
  ctx.command('indicate', (args, kwargs) => {
    const sel = sel0(pick(args, kwargs, 0, 'selection'));
    const n = ex.select('indicate', sel);
    ctx.publish();
    return n;
  });
}
