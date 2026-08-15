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

/** PyMOL `solvent_radius` default (Å). */
const DEFAULT_PROBE = 1.4;

/** PyMOL atom flags that exclude an atom from its own dot surface. */
const CATOMFLAG_EXFOLIATE = 0x01000000;
/** PyMOL atom flag that removes an atom from the occluder set. */
const CATOMFLAG_IGNORE = 0x02000000;

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

/* -------------------------------- registrar ------------------------------ */

export function registerMisc(ctx: RegistrarCtx): void {
  const ex = ctx.executive;
  const sel0 = (v: unknown): string => ctx.str(v, 'all') || 'all';

  const probeRadius = (): number => ex.getSettingFloat('solvent_radius') || DEFAULT_PROBE;

  const molOf = (ua: UniverseAtom): ObjectMolecule => ex.molecule(ua.objName)!;

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
  // Faithful port of util.get_sasa_relative (packages/engine/modules/pymol/
  // util.py). Per-residue relative SASA = the residue's area IN CONTEXT (the
  // whole object occludes) divided by its area in a TRIPEPTIDE — that residue
  // with only its two bonded sequence neighbours (`byres … extend 1`) as the
  // occlusion context. The 0.0–1.0 ratio is altered into `var` (default 'b')
  // for every atom of the residue. `dot_solvent` is forced on for the duration.
  //
  // Per-atom areas use the SAME single-precision geodesic-dot machinery as the
  // `get_area` command above, evaluated against an arbitrary occluder set so
  // the tripeptide reference can be measured in isolation.
  const areasFor = (
    mol: ObjectMolecule,
    state: number,
    computeIdx: Iterable<number>,
    occluderIdx: number[],
  ): Map<number, number> => {
    const f = Math.fround;
    const solvRad = ex.getSettingFloat('dot_solvent') !== 0 ? f(probeRadius()) : 0;
    const density = ex.getSettingFloat('dot_density') || 2;
    const sphere = sphereForDensity(density);
    const dotX = sphere.dot.map((d) => f(d[0]));
    const dotY = sphere.dot.map((d) => f(d[1]));
    const dotZ = sphere.dot.map((d) => f(d[2]));
    const s = oneState(state);
    const flagOf = (i: number): number => {
      const a = mol.atoms[i]!;
      return a.flags ?? (a.hetatm ? CATOMFLAG_IGNORE : 0);
    };

    // Occluder shells (indexed by position in occluderIdx).
    const m = occluderIdx.length;
    const cx = new Float32Array(m);
    const cy = new Float32Array(m);
    const cz = new Float32Array(m);
    const rad = new Float32Array(m);
    const oflag = new Int32Array(m);
    for (let k = 0; k < m; k++) {
      const i = occluderIdx[k]!;
      const c = mol.coord(i, s);
      cx[k] = c[0];
      cy[k] = c[1];
      cz[k] = c[2];
      rad[k] = f(mol.vdw(i) + solvRad);
      oflag[k] = flagOf(i);
    }

    const out = new Map<number, number>();
    for (const i of computeIdx) {
      if ((flagOf(i) & (CATOMFLAG_EXFOLIATE | CATOMFLAG_IGNORE)) !== 0) {
        out.set(i, 0);
        continue;
      }
      const ri = f(mol.vdw(i) + solvRad);
      const c = mol.coord(i, s);
      const ox = c[0];
      const oy = c[1];
      const oz = c[2];
      // Occluders whose spheres can bury a dot on atom i's shell (reach ri+rk).
      const neigh: number[] = [];
      for (let k = 0; k < m; k++) {
        if (occluderIdx[k] === i) continue;
        if ((oflag[k]! & CATOMFLAG_IGNORE) !== 0) continue;
        const dx = ox - cx[k]!;
        const dy = oy - cy[k]!;
        const dz = oz - cz[k]!;
        const reach = ri + rad[k]!;
        if (dx * dx + dy * dy + dz * dz <= reach * reach) neigh.push(k);
      }
      const ri2 = f(ri * ri);
      let atomArea = 0;
      for (let b = 0; b < dotX.length; b++) {
        const px = f(ox + f(ri * dotX[b]!));
        const py = f(oy + f(ri * dotY[b]!));
        const pz = f(oz + f(ri * dotZ[b]!));
        let buried = false;
        for (const k of neigh) {
          const dx = f(px - cx[k]!);
          const dy = f(py - cy[k]!);
          const dz = f(pz - cz[k]!);
          const rk = rad[k]!;
          if (f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz)) <= f(rk * rk)) {
            buried = true;
            break;
          }
        }
        if (!buried) atomArea += ri2 * sphere.area[b]!;
      }
      out.set(i, atomArea);
    }
    return out;
  };

  ctx.command('get_sasa_relative', (args, kwargs) => {
    const sel = sel0(pick(args, kwargs, 0, 'selection'));
    const state = num(pick(args, kwargs, 1, 'state'), 0);
    const varName = ctx.str(pick(args, kwargs, 3, 'var'), 'b') || 'b';
    const subsele = ctx.str(kwargs.subsele, 'all') || 'all';

    const matched = ex.atomsMatching(sel);
    if (matched.length === 0) return {} as Json;

    // subsele restricts which atoms contribute area (e.g. "sidechain"). Build a
    // membership set keyed by object|index; default "all" includes everything.
    const subKey = (objName: string, idx: number): string => `${objName}|${idx}`;
    const subSet = new Set<string>();
    for (const ua of ex.atomsMatching(subsele)) subSet.add(subKey(ua.objName, ua.index));
    const inSub = (objName: string, idx: number): boolean => subSet.has(subKey(objName, idx));

    // PyMOL forces dot_solvent on for the whole computation, then restores it.
    const savedDotSolvent = ex.getSetting('dot_solvent');
    ex.set('dot_solvent', 1);

    const out: Record<string, number> = {};
    try {
      // Group selected atoms by object, then by residue (segi|chain|resi — the
      // same key PyMOL uses for `resarea` and `byres`).
      const byObject = new Map<string, UniverseAtom[]>();
      for (const ua of matched) {
        let g = byObject.get(ua.objName);
        if (!g) byObject.set(ua.objName, (g = []));
        g.push(ua);
      }

      for (const [objName, uas] of byObject) {
        const mol = ex.molecule(objName);
        if (!mol) continue;
        const n = mol.natom;
        const allIdx = Array.from({ length: n }, (_v, i) => i);

        // Residue groups for the WHOLE object (needed for `byres` of the
        // tripeptide, which can reach neighbours outside `sel`).
        const resKeyOf = (i: number): string => {
          const a = mol.atoms[i]!;
          return `${a.segi}|${a.chain}|${a.resi}`;
        };
        const resAtoms = new Map<string, number[]>();
        for (let i = 0; i < n; i++) {
          const rk = resKeyOf(i);
          let g = resAtoms.get(rk);
          if (!g) resAtoms.set(rk, (g = []));
          g.push(i);
        }

        // Bond adjacency for `extend 1`.
        const adj: number[][] = Array.from({ length: n }, () => []);
        for (const [i, j] of mol.bonds) {
          if (i < n && j < n) {
            adj[i]!.push(j);
            adj[j]!.push(i);
          }
        }

        // Context areas: each selected atom occluded by the whole object.
        const selIdx = uas.map((ua) => ua.index);
        const contextArea = areasFor(mol, state, selIdx, allIdx);

        // Residues present in this object's part of the selection, with the
        // selected atoms that belong to each.
        const selByRes = new Map<string, number[]>();
        for (const idx of selIdx) {
          const rk = resKeyOf(idx);
          let g = selByRes.get(rk);
          if (!g) selByRes.set(rk, (g = []));
          g.push(idx);
        }

        for (const [rk, resSel] of selByRes) {
          const resAll = resAtoms.get(rk) ?? resSel;
          // Context sum over subsele atoms of the residue.
          let contextSum = 0;
          for (const idx of resSel) {
            if (inSub(objName, idx)) contextSum += contextArea.get(idx) ?? 0;
          }

          // Tripeptide = byres(residue extend 1): the residue plus every residue
          // bonded to it. Compute the residue's area with only those as context.
          const extended = new Set<number>(resAll);
          for (const idx of resAll) for (const j of adj[idx]!) extended.add(j);
          const tri = new Set<number>();
          for (const idx of extended) for (const j of resAtoms.get(resKeyOf(idx)) ?? []) tri.add(j);
          const triIdx = [...tri];
          const exposedArea = areasFor(mol, state, resAll, triIdx);
          let exposedSum = 0;
          for (const idx of resAll) {
            if (inSub(objName, idx)) exposedSum += exposedArea.get(idx) ?? 0;
          }

          const ratio = exposedSum > 0 ? contextSum / exposedSum : contextSum;
          // Public dict key mirrors PyMOL's (model, segi, chain, resi) tuple as a
          // readable "object/segi/chain/resi" string.
          const a0 = mol.atoms[resSel[0]!]!;
          out[`${objName}/${a0.segi}/${a0.chain}/${a0.resi}`] = ratio;
          // alter var = ratio for EVERY selected atom of the residue.
          for (const idx of resSel) {
            const a = mol.atoms[idx]! as unknown as Record<string, unknown>;
            a[varName] = ratio;
          }
        }
      }
    } finally {
      if (savedDotSolvent === undefined) ex.set('dot_solvent', 0);
      else ex.set('dot_solvent', savedDotSolvent);
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
    const mode = Number(pick(args, kwargs, 1, 'mode') ?? 0);
    const matched = ex.atomsMatching(sel);
    if (matched.length !== 1) {
      throw new Error(`id_atom: selection must contain exactly one atom (got ${matched.length})`);
    }
    const ua = matched[0]!;
    // mode 0 -> the id; mode 1 -> (object, id) tuple (identify semantics).
    return (mode ? [ua.objName, ua.atom.id] : ua.atom.id) as Json;
  });

  // ---- indicate ----------------------------------------------------------
  ctx.command('indicate', (args, kwargs) => {
    const sel = sel0(pick(args, kwargs, 0, 'selection'));
    const n = ex.select('indicate', sel);
    ctx.publish();
    return n;
  });
}
