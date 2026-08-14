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
import { sphereForDensity } from '../geometry/sphere_data';

type Vec3 = [number, number, number];

/** PyMOL `solvent_radius` default (Å). */
const DEFAULT_PROBE = 1.4;

/** PyMOL atom flags that exclude an atom from its own dot surface. */
const CATOMFLAG_EXFOLIATE = 0x01000000;
/** PyMOL atom flag that removes an atom from the occluder set. */
const CATOMFLAG_IGNORE = 0x02000000;

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
  // Faithful port of PyMOL's `ExecutiveGetArea` + `RepDotDoNew(cRepDotAreaType)`
  // (Executive.cpp / RepDot.cpp). The surface is computed over the WHOLE object
  // that the selection touches (occlusion context), then only the dots owned by
  // selected atoms are summed. Each atom's sphere radius is `vdw` (+ solvent
  // radius when `dot_solvent` is on); dots are PyMOL's exact geodesic
  // tessellation for `dot_density`, and each exposed dot contributes
  // `radius² · sphere.area[b]` (Å²). Selection must lie within a single object.
  ctx.command('get_area', (args, kwargs) => {
    const sel = sel0(pick(args, kwargs, 0, 'selection'));
    const state = num(pick(args, kwargs, 1, 'state'), 1);
    const loadB = num(pick(args, kwargs, 2, 'load_b'), 0) !== 0;
    const matched = ex.atomsMatching(sel);
    if (matched.length === 0) return 0;

    // Single-object requirement (PyMOL: SelectorGetSingleObjectMolecule).
    const objName = matched[0]!.objName;
    if (matched.some((ua) => ua.objName !== objName)) {
      throw new Error('get_area: selection must be within a single object');
    }
    const mol = ex.molecule(objName);
    if (!mol) return 0;
    const s = oneState(state);

    // PyMOL runs the dot geometry and occlusion tests in single-precision, so
    // near-boundary dots must be classified the same way — do the decision-path
    // arithmetic in float32 (Math.fround) to match which dots survive.
    const f = Math.fround;
    const solvRad = ex.getSettingFloat('dot_solvent') !== 0 ? f(probeRadius()) : 0;
    const density = ex.getSettingFloat('dot_density') || 2;
    const sphere = sphereForDensity(density);
    // Sphere directions are float32 literals in PyMOL's SphereData.h.
    const dotX = sphere.dot.map((d) => f(d[0]));
    const dotY = sphere.dot.map((d) => f(d[1]));
    const dotZ = sphere.dot.map((d) => f(d[2]));

    // Occluder shells: every atom of the object (minus flag-ignored ones). A dot
    // is buried if it falls within another atom's `vdw + solvent` sphere.
    const n = mol.natom;
    const cx = new Float32Array(n);
    const cy = new Float32Array(n);
    const cz = new Float32Array(n);
    const rad = new Float32Array(n); // vdw + solvent (occluder reach)
    // Effective modeling flags. PyMOL's readers default HETATM atoms (e.g.
    // waters) to `cAtomFlag_ignore` unless the atom carries explicit flags
    // (ObjectMolecule.cpp), and area mode culls by flag: ignore-flagged atoms
    // neither generate dots nor occlude. Mirror that here.
    const eff = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const c = mol.coord(i, s);
      cx[i] = c[0];
      cy[i] = c[1];
      cz[i] = c[2];
      rad[i] = f(mol.vdw(i) + solvRad);
      const a = mol.atoms[i]!;
      eff[i] = a.flags ?? (a.hetatm ? CATOMFLAG_IGNORE : 0);
    }

    // Which local indices are members of the selection (contribute area).
    const selected = new Set<number>(matched.map((ua) => ua.index));

    if (loadB) {
      // Zero the b-factor of every selected atom first (PyMOL OMOP_SetB).
      for (const i of selected) mol.atoms[i]!.b = 0;
    }

    let total = 0;
    for (const i of selected) {
      const ai = mol.atoms[i]!;
      // Area mode forces dot_hydrogens on but honours the exfoliate/ignore flags.
      if ((eff[i]! & (CATOMFLAG_EXFOLIATE | CATOMFLAG_IGNORE)) !== 0) continue;
      const ri = rad[i]!;
      const ox = cx[i]!;
      const oy = cy[i]!;
      const oz = cz[i]!;
      // Neighbours whose spheres can bury a dot on atom i's shell (reach ri+rj).
      const neigh: number[] = [];
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        if ((eff[j]! & CATOMFLAG_IGNORE) !== 0) continue;
        const dx = ox - cx[j]!;
        const dy = oy - cy[j]!;
        const dz = oz - cz[j]!;
        const reach = ri + rad[j]!;
        if (dx * dx + dy * dy + dz * dz <= reach * reach) neigh.push(j);
      }
      const ri2 = f(ri * ri);
      let atomArea = 0;
      for (let b = 0; b < dotX.length; b++) {
        // Dot on atom i's shell (PyMOL: v0 + vdw * sp->dot, all float32).
        const px = f(ox + f(ri * dotX[b]!));
        const py = f(oy + f(ri * dotY[b]!));
        const pz = f(oz + f(ri * dotZ[b]!));
        let buried = false;
        for (const j of neigh) {
          // within3f, in float32: (dx² + dy²) + dz² <= dist².
          const dx = f(px - cx[j]!);
          const dy = f(py - cy[j]!);
          const dz = f(pz - cz[j]!);
          const rj = rad[j]!;
          if (f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz)) <= f(rj * rj)) {
            buried = true;
            break;
          }
        }
        if (!buried) atomArea += ri2 * sphere.area[b]!;
      }
      total += atomArea;
      if (loadB) ai.b += atomArea;
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
  // get_bonds(selection='(all)', state=-1)
  // Returns `(atm1, atm2, order)` tuples where atm1/atm2 are 0-based indices
  // that ENUMERATE THE ATOMS WITHIN THE SELECTION (not the `index` property),
  // matching real PyMOL / `cmd.get_model().bond`. Atoms are enumerated per
  // object in ascending atom-index order; `order` is the bond order (1 single,
  // 2 double, …), defaulting to 1 when the loader recorded none.
  ctx.command('get_bonds', (args, kwargs) => {
    const sel = sel0(pick(args, kwargs, 0, 'selection'));
    const byObj = new Map<string, Set<number>>();
    for (const ua of ex.atomsMatching(sel)) {
      let set = byObj.get(ua.objName);
      if (!set) byObj.set(ua.objName, (set = new Set<number>()));
      set.add(ua.index);
    }
    const out: Array<[number, number, number]> = [];
    let base = 0;
    for (const [objName, idxSet] of byObj) {
      // Local 0-based index = position within the selection, per object in
      // ascending atom-index order (get_model enumeration order).
      const sorted = [...idxSet].sort((a, b) => a - b);
      const local = new Map<number, number>();
      sorted.forEach((gi, k) => local.set(gi, base + k));
      const mol = ex.molecule(objName);
      if (mol) {
        for (const [i, j, order] of mol.bonds) {
          if (idxSet.has(i) && idxSet.has(j)) {
            out.push([local.get(i)!, local.get(j)!, order ?? 1]);
          }
        }
      }
      base += sorted.length;
    }
    return out as Json;
  });

  /** Atoms of a selection grouped by object → set of 0-based atom indices. */
  const idxByObject = (sel: string): Map<string, Set<number>> => {
    const byObj = new Map<string, Set<number>>();
    for (const ua of ex.atomsMatching(sel)) {
      let set = byObj.get(ua.objName);
      if (!set) byObj.set(ua.objName, (set = new Set<number>()));
      set.add(ua.index);
    }
    return byObj;
  };

  // get_bond(name, selection1, selection2=None, state=0, updates=1, quiet=1)
  // Returns per-object `[model, [[idx1, idx2, value], ...]]` for every bond
  // that spans selection1 and selection2 (selection2 defaults to selection1).
  // `value` is the per-bond override of the named setting, or null when unset.
  // Per-bond settings are not yet stored, so values are always null (matching
  // real PyMOL when nothing has been set via set_bond).
  ctx.command('get_bond', (args, kwargs) => {
    const sel1 = sel0(pick(args, kwargs, 1, 'selection1'));
    const sel2raw = pick(args, kwargs, 2, 'selection2');
    const sel2 =
      sel2raw !== undefined && sel2raw !== null && sel2raw !== ''
        ? sel0(sel2raw)
        : sel1;
    const idx1 = idxByObject(sel1);
    const idx2 = idxByObject(sel2);
    const out: Json[] = [];
    for (const [objName, set1] of idx1) {
      const set2 = idx2.get(objName);
      if (!set2) continue;
      const mol = ex.molecule(objName);
      if (!mol) continue;
      const vlist: Json[] = [];
      for (const [i, j] of mol.bonds) {
        if ((set1.has(i) && set2.has(j)) || (set1.has(j) && set2.has(i))) {
          vlist.push([i + 1, j + 1, null]);
        }
      }
      if (vlist.length) out.push([objName, vlist]);
    }
    return out as Json;
  });

  // ---- get_bond_print ----------------------------------------------------
  // Experimental/debug helper. Faithful port of `ObjectMoleculeGetBondPrint`
  // (ObjectMolecule.cpp): a 3D int histogram `result[at1][at2][dist]` over
  // customType pairs and bond-path distance, dims
  // `[max_type+1][max_type+1][max_bond+1]`. For each atom `a` with
  // `customType == at1` in `[0, max_type]`, a BFS out to `max_bond` bonds
  // (ObjectMoleculeGetBondPaths) reaches every atom `i` at distance `c`; when
  // its `customType == at2` is in range, `result[at1][at2][c]++`. `customType`
  // is `-1` (unassigned) for freshly built/loaded objects — it is only set by
  // internal typing passes not exposed by this slice — so the dump is all
  // zeros, exactly as real PyMOL reports for a plain `fragment`/loaded object.
  // A non-molecule (or missing) name yields None, like ExecutiveGetBondPrint.
  ctx.command('get_bond_print', (args, kwargs) => {
    const objName = ctx.str(pick(args, kwargs, 0, 'obj'));
    const maxBond = Math.trunc(num(pick(args, kwargs, 1, 'max_bond'), 0));
    const maxType = Math.trunc(num(pick(args, kwargs, 2, 'max_type'), 0));
    const mol = ex.molecule(objName);
    if (!mol) return null;

    const nType = maxType + 1;
    const nDist = maxBond + 1;
    const result: number[][][] = Array.from({ length: nType }, () =>
      Array.from({ length: nType }, () => new Array<number>(nDist).fill(0)),
    );

    const n = mol.atoms.length;
    const customType = (i: number): number => mol.atoms[i]!.customType ?? -1;

    // Undirected adjacency for the bond-path BFS.
    const adj: number[][] = Array.from({ length: n }, () => []);
    for (const [i, j] of mol.bonds) {
      if (i >= 0 && i < n && j >= 0 && j < n) {
        adj[i]!.push(j);
        adj[j]!.push(i);
      }
    }

    const dist = new Array<number>(n).fill(-1);
    for (let a = 0; a < n; a++) {
      const at1 = customType(a);
      if (at1 < 0 || at1 > maxType) continue;
      // BFS bond distances from `a` out to `maxBond` bonds.
      dist.fill(-1);
      const list: number[] = [a];
      dist[a] = 0;
      let cur = 0;
      for (let bCnt = 1; bCnt <= maxBond; bCnt++) {
        let nCur = list.length - cur;
        if (nCur === 0) break;
        while (nCur-- > 0) {
          const a1 = list[cur++]!;
          for (const a2 of adj[a1]!) {
            if (dist[a2]! < 0) {
              dist[a2] = bCnt;
              list.push(a2);
            }
          }
        }
      }
      for (const i of list) {
        const at2 = customType(i);
        if (at2 >= 0 && at2 <= maxType) result[at1]![at2]![dist[i]!]!++;
      }
    }
    return result as Json;
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
