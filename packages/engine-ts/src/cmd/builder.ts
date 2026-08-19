/**
 * The `builder` / chemistry command subsystem.
 *
 * Ports the topology/geometry-building half of PyMOL's `editor.py` /
 * `Editor.cpp`: `add_bond`, `attach`, `h_add`/`h_fill`, `valence`/
 * `cycle_valence`, `invert`, `fuse`, `replace`, `rebond`, `fix_chemistry`,
 * `sort` and `protonate`. Each verb mutates an {@link ObjectMolecule} in place
 * (atom table, per-state Float32 coordinates, bond list) and calls
 * `ctx.publish()` afterwards, exactly as PyMOL's editor does.
 *
 * Hydrogen placement uses idealised VSEPR geometry: for each heavy atom the
 * number of missing hydrogens is `typical valence − Σ(bond orders)`, and the new
 * H atoms are placed at tetrahedral / trigonal directions derived from the
 * existing neighbour directions at the element-specific X–H bond length. The
 * exact positions are a reasonable idealisation, not a force-field minimum.
 *
 * PyMOL's `Bond` struct carries an order; this port stores bonds as bare index
 * pairs, so bond orders live in a per-molecule side table ({@link getBondOrder}).
 */
import type { Json } from '@tenmol/protocol';
import type { AtomInfo } from '../model/atom';
import { defaultVisRep } from '../model/atom';
import { canonicalElement } from '../model/element';
import type { ObjectMolecule } from '../model/molecule';
import { templateBondOrder } from '../model/residue-bonds';
import { sortAtomsInPlace } from '../model/atomsort';
import type { RegistrarCtx } from './registrar';

/* ------------------------------ arg helpers ------------------------------ */

/** Positional arg `i`, falling back to the named kwarg. */
function pick(args: unknown[], kwargs: Record<string, unknown>, i: number, name: string): unknown {
  const a = args[i];
  if (a !== undefined && a !== null && a !== '') return a;
  return kwargs[name];
}

/** Coerce to a finite number, or `dflt` when absent/unparseable. */
function num(v: unknown, dflt: number): number {
  if (v === undefined || v === null || v === '') return dflt;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : dflt;
}

/* ------------------------------ vec3 helpers ----------------------------- */

type Vec3 = [number, number, number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
function norm(a: Vec3): Vec3 {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
/** Any unit vector perpendicular to `a` (numerically stable choice). */
function anyPerp(a: Vec3): Vec3 {
  const ax = Math.abs(a[0]);
  const ay = Math.abs(a[1]);
  const az = Math.abs(a[2]);
  const ref: Vec3 = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  const p = cross(a, ref);
  return len(p) < 1e-6 ? [0, 1, 0] : norm(p);
}

/* --------------------------- chemistry tables ---------------------------- */

/** Typical (neutral) valence per element — how many bonds it wants. */
const VALENCE: Readonly<Record<string, number>> = {
  H: 1,
  C: 4,
  N: 3,
  O: 2,
  S: 2,
  P: 3,
  B: 3,
  F: 1,
  Cl: 1,
  Br: 1,
  I: 1,
};

/** Idealised X–H bond length (Å). */
const XH_LENGTH: Readonly<Record<string, number>> = {
  C: 1.09,
  N: 1.01,
  O: 0.96,
  S: 1.34,
  P: 1.44,
  B: 1.19,
};
const DEFAULT_XH = 1.0;

/** Covalent radii (Å) — the distance-bonding pass (mirrors `pdb.ts`). */
const COVALENT: Readonly<Record<string, number>> = {
  H: 0.31,
  C: 0.76,
  N: 0.71,
  O: 0.66,
  F: 0.57,
  P: 1.07,
  S: 1.05,
  Cl: 1.02,
  Se: 1.2,
  Br: 1.2,
  Fe: 1.32,
  Zn: 1.22,
  Mg: 1.41,
  Ca: 1.76,
  Na: 1.66,
  K: 2.03,
};
const DEFAULT_COVALENT = 0.77;
const CONNECT_CUTOFF = 0.35;

const valenceOf = (elem: string): number => VALENCE[canonicalElement(elem)] ?? 0;
const xhLength = (elem: string): number => XH_LENGTH[canonicalElement(elem)] ?? DEFAULT_XH;
const covalent = (elem: string): number => COVALENT[canonicalElement(elem)] ?? DEFAULT_COVALENT;

/* --------------------------- bond-order table ---------------------------- */

/** Per-molecule bond-order side table, keyed by the undirected pair. */
const bondOrders = new WeakMap<ObjectMolecule, Map<string, number>>();
const bondKey = (i: number, j: number): string => (i < j ? `${i}:${j}` : `${j}:${i}`);

/** The order of bond `i–j` (0-based indices); defaults to 1 (single). The side
 *  table is authoritative; fall back to the order stored on the bond tuple's
 *  third element (as MOL/MOL2 loaders record it) so loaded orders are seen. */
export function getBondOrder(mol: ObjectMolecule, i: number, j: number): number {
  const fromTable = bondOrders.get(mol)?.get(bondKey(i, j));
  if (fromTable !== undefined) return fromTable;
  const bond = mol.bonds.find(([a, b]) => (a === i && b === j) || (a === j && b === i));
  return bond?.[2] ?? 1;
}
export function setBondOrder(mol: ObjectMolecule, i: number, j: number, order: number): void {
  let m = bondOrders.get(mol);
  if (!m) bondOrders.set(mol, (m = new Map()));
  m.set(bondKey(i, j), order);
  // Keep the bond tuple's stored order in sync so readers that inspect the
  // tuple directly (get_bonds, exporters, get_model) observe the new order.
  const bond = mol.bonds.find(([a, b]) => (a === i && b === j) || (a === j && b === i));
  if (bond) bond[2] = order;
}

/** Per-atom valence overrides (PyMOL `set_geometry`), keyed by stable atom id so
 *  they survive the reindexing that H removal/addition performs. */
const valenceOverrides = new WeakMap<ObjectMolecule, Map<number, number>>();
function setValenceOverride(mol: ObjectMolecule, id: number, valence: number): void {
  let m = valenceOverrides.get(mol);
  if (!m) valenceOverrides.set(mol, (m = new Map()));
  m.set(id, valence);
}
function valenceOverrideOf(mol: ObjectMolecule, id: number): number | undefined {
  return valenceOverrides.get(mol)?.get(id);
}
function clearBondOrders(mol: ObjectMolecule): void {
  bondOrders.delete(mol);
}

/* ------------------------------ topology --------------------------------- */

/** Undirected adjacency list over the current bond table. */
function buildAdjacency(mol: ObjectMolecule): number[][] {
  const adj: number[][] = Array.from({ length: mol.natom }, () => []);
  for (const [i, j] of mol.bonds) {
    adj[i]!.push(j);
    adj[j]!.push(i);
  }
  return adj;
}

/** Σ of the orders of every bond incident on atom `idx`. */
function bondOrderSum(mol: ObjectMolecule, idx: number): number {
  let sum = 0;
  for (const [i, j] of mol.bonds) {
    if (i === idx || j === idx) sum += getBondOrder(mol, i, j);
  }
  return sum;
}

/** Does the undirected bond `i–j` already exist? */
function hasBond(mol: ObjectMolecule, i: number, j: number): boolean {
  return mol.bonds.some(([a, b]) => (a === i && b === j) || (a === j && b === i));
}

/** Unit directions from atom `idx` to each of its bonded neighbours, in `state`. */
function neighbourDirs(mol: ObjectMolecule, idx: number, state: number, adj: number[][]): Vec3[] {
  const p = mol.coord(idx, state);
  const dirs: Vec3[] = [];
  for (const nb of adj[idx]!) {
    const d = sub(mol.coord(nb, state), p);
    if (len(d) > 1e-6) dirs.push(norm(d));
  }
  return dirs;
}

/* --------------------------- VSEPR placement ----------------------------- */

const TET_COS = -1 / 3; // cos(109.4712°)
const TET_SIN = Math.sqrt(8) / 3; // sin(109.4712°)
// Half-tetrahedral (54.7356°) — for completing two bonds symmetric about a bisector.
const HALF_COS = 0.5773502691896257;
const HALF_SIN = 0.816496580927726;

/** The canonical tetrahedron (for an atom with no existing neighbours). */
const TETRAHEDRON: Vec3[] = [
  norm([1, 1, 1]),
  norm([1, -1, -1]),
  norm([-1, 1, -1]),
  norm([-1, -1, 1]),
];

/**
 * Unit directions for `count` new bonds on an atom that already has the given
 * `existing` neighbour directions, using idealised sp3 (tetrahedral) geometry.
 */
function fillDirections(existing: Vec3[], count: number): Vec3[] {
  if (count <= 0) return [];
  switch (existing.length) {
    case 0:
      return TETRAHEDRON.slice(0, count);
    case 1: {
      const a = existing[0]!;
      const p = anyPerp(a);
      const q = norm(cross(a, p));
      const out: Vec3[] = [];
      for (let k = 0; k < count; k++) {
        const phi = (k * 2 * Math.PI) / 3;
        const radial = add(scale(p, Math.cos(phi)), scale(q, Math.sin(phi)));
        out.push(norm(add(scale(a, TET_COS), scale(radial, TET_SIN))));
      }
      return out;
    }
    case 2: {
      const a = existing[0]!;
      const b = existing[1]!;
      const bisRaw = add(a, b);
      const bis = len(bisRaw) > 1e-6 ? norm(bisRaw) : anyPerp(a);
      let n = cross(a, b);
      n = len(n) > 1e-6 ? norm(n) : anyPerp(bis);
      const d1 = norm(add(scale(bis, -HALF_COS), scale(n, HALF_SIN)));
      const d2 = norm(add(scale(bis, -HALF_COS), scale(n, -HALF_SIN)));
      return [d1, d2].slice(0, count);
    }
    default: {
      let sum: Vec3 = [0, 0, 0];
      for (const d of existing) sum = add(sum, d);
      const dir = len(sum) > 1e-6 ? neg(norm(sum)) : anyPerp(existing[0]!);
      const out: Vec3[] = [];
      for (let k = 0; k < count; k++) out.push(dir);
      return out;
    }
  }
}

/* --------------------------- atom / coord edits -------------------------- */

/** A new atom to splice into a molecule, with one coordinate per state. */
export interface NewAtom {
  atom: AtomInfo;
  coords: Vec3[]; // indexed by state; falls back to coords[0]
  bondTo: number; // 0-based heavy-atom index to bond to (-1 = no bond)
  order: number;
}

/**
 * Append `specs` to `mol`: extend the atom table, every per-state coordinate
 * set, and (for `bondTo >= 0`) the bond list. Returns the first new index.
 */
export function appendAtoms(mol: ObjectMolecule, specs: NewAtom[]): number {
  if (specs.length === 0) return mol.natom;
  const base = mol.natom;
  if (mol.states.length === 0) mol.states.push(new Float32Array(base * 3));
  for (const s of specs) {
    s.atom.id = mol.atoms.length + 1;
    mol.atoms.push(s.atom);
  }
  const nNew = specs.length;
  for (let st = 0; st < mol.states.length; st++) {
    const old = mol.states[st]!;
    const out = new Float32Array(old.length + nNew * 3);
    out.set(old, 0);
    for (let k = 0; k < nNew; k++) {
      const c = specs[k]!.coords[st] ?? specs[k]!.coords[0] ?? [0, 0, 0];
      out[old.length + k * 3] = c[0];
      out[old.length + k * 3 + 1] = c[1];
      out[old.length + k * 3 + 2] = c[2];
    }
    mol.states[st] = out;
  }
  for (let k = 0; k < nNew; k++) {
    const spec = specs[k]!;
    if (spec.bondTo >= 0) {
      const i = spec.bondTo;
      const j = base + k;
      mol.bonds.push(i < j ? [i, j] : [j, i]);
      if (spec.order !== 1) setBondOrder(mol, i, j, spec.order);
    }
  }
  return base;
}

/**
 * Remove the atoms in `drop` (0-based) from `mol`: compact the atom table and
 * every coordinate set, drop bonds touching them, reindex the survivors and
 * remap the bond-order side table.
 */
export function removeAtoms(mol: ObjectMolecule, drop: Set<number>): void {
  if (drop.size === 0) return;
  const n = mol.natom;
  const remap = new Int32Array(n).fill(-1);
  let next = 0;
  for (let i = 0; i < n; i++) if (!drop.has(i)) remap[i] = next++;

  const survivors = mol.atoms.filter((_, i) => !drop.has(i));
  mol.atoms.length = 0;
  mol.atoms.push(...survivors);

  for (let s = 0; s < mol.states.length; s++) {
    const old = mol.states[s]!;
    const out = new Float32Array(next * 3);
    for (let i = 0; i < n; i++) {
      const ni = remap[i]!;
      if (ni < 0) continue;
      out[ni * 3] = old[i * 3] ?? 0;
      out[ni * 3 + 1] = old[i * 3 + 1] ?? 0;
      out[ni * 3 + 2] = old[i * 3 + 2] ?? 0;
    }
    mol.states[s] = out;
  }

  const orders = bondOrders.get(mol);
  const newOrders = orders ? new Map<string, number>() : undefined;
  const kept: Array<[number, number]> = [];
  for (const [a, b] of mol.bonds) {
    if (drop.has(a) || drop.has(b)) continue;
    const na = remap[a]!;
    const nb = remap[b]!;
    kept.push(na < nb ? [na, nb] : [nb, na]);
    if (orders && newOrders) {
      const o = orders.get(bondKey(a, b));
      if (o !== undefined) newOrders.set(bondKey(na, nb), o);
    }
  }
  mol.bonds.length = 0;
  mol.bonds.push(...kept);
  if (newOrders) bondOrders.set(mol, newOrders);
}

/* ------------------------------ hydrogens -------------------------------- */

/**
 * Build the hydrogen specs to fill the valence of each heavy atom in
 * `heavyIdxs`. `hCounter` seeds the H atom names (mutated so names stay unique).
 */
/**
 * Perceive intra-residue bond orders from the standard-residue templates so
 * valence maths sees, e.g., the backbone carbonyl C=O as a double bond. Only
 * fills orders that aren't already set (an explicit MOL/MOL2 order wins).
 */
function perceiveBondOrders(mol: ObjectMolecule): void {
  for (const [i, j] of mol.bonds) {
    const a = mol.atoms[i];
    const b = mol.atoms[j];
    if (!a || !b) continue;
    // Only intra-residue bonds are templated; the peptide/backbone links across
    // residues stay single.
    if (a.resi !== b.resi || a.chain !== b.chain || a.segi !== b.segi) continue;
    if (getBondOrder(mol, i, j) !== 1) continue; // already assigned
    const order = templateBondOrder(a.resn, a.name, b.name);
    if (order !== undefined && order !== 1) setBondOrder(mol, i, j, order);
  }
}

function buildHydrogens(
  mol: ObjectMolecule,
  heavyIdxs: number[],
  hCounter: { n: number },
): NewAtom[] {
  perceiveBondOrders(mol);
  const adj = buildAdjacency(mol);
  const specs: NewAtom[] = [];
  const nStates = Math.max(1, mol.states.length);
  for (const idx of heavyIdxs) {
    const parent = mol.atoms[idx];
    if (!parent) continue;
    const val = valenceOverrideOf(mol, parent.id) ?? valenceOf(parent.elem);
    if (val <= 0) continue;
    const nMiss = val - bondOrderSum(mol, idx);
    if (nMiss <= 0) continue;

    const bl = xhLength(parent.elem);
    // Per-state new directions and base positions.
    const dirsByState: Vec3[][] = [];
    const baseByState: Vec3[] = [];
    for (let s = 1; s <= nStates; s++) {
      const existing = neighbourDirs(mol, idx, s, adj);
      dirsByState.push(fillDirections(existing, nMiss));
      baseByState.push(mol.coord(idx, s));
    }
    for (let k = 0; k < nMiss; k++) {
      const coords: Vec3[] = [];
      for (let s = 0; s < nStates; s++) {
        const dir = dirsByState[s]![k] ?? [0, 0, 1];
        coords.push(add(baseByState[s]!, scale(dir, bl)));
      }
      const atom: AtomInfo = {
        id: 0, // assigned in appendAtoms
        name: 'H' + hCounter.n++,
        resn: parent.resn,
        resi: parent.resi,
        resv: parent.resv,
        chain: parent.chain,
        segi: parent.segi,
        alt: '',
        elem: 'H',
        hetatm: parent.hetatm,
        b: 0,
        q: 1,
        color: 0,
        ss: '',
        visRep: defaultVisRep(),
      };
      specs.push({ atom, coords, bondTo: idx, order: 1 });
    }
  }
  return specs;
}

/**
 * Drop the hydrogens bonded to each heavy atom in `heavyIdxs`, then re-add them
 * at idealised positions to satisfy the (perceived / overridden) valence — the
 * `h_fill` core shared by `h_fill`, `cycle_valence` and `replace`. Returns the
 * number of hydrogens added.
 */
function refillHydrogens(mol: ObjectMolecule, heavyIdxs: number[]): number {
  const targetIds = new Set<number>();
  for (const i of heavyIdxs) {
    const a = mol.atoms[i];
    if (a && a.elem !== 'H' && a.elem !== 'D') targetIds.add(a.id);
  }
  const adj = buildAdjacency(mol);
  const drop = new Set<number>();
  for (const i of heavyIdxs) {
    for (const nb of adj[i] ?? []) {
      const e = mol.atoms[nb]!.elem;
      if (e === 'H' || e === 'D') drop.add(nb);
    }
  }
  removeAtoms(mol, drop);
  const heavy: number[] = [];
  for (let i = 0; i < mol.natom; i++) if (targetIds.has(mol.atoms[i]!.id)) heavy.push(i);
  const specs = buildHydrogens(mol, heavy, { n: countHydrogens(mol) + 1 });
  appendAtoms(mol, specs);
  return specs.length;
}

/** Count of existing hydrogens in a molecule (seed for unique H names). */
function countHydrogens(mol: ObjectMolecule): number {
  let n = 0;
  for (const a of mol.atoms) if (a.elem === 'H' || a.elem === 'D') n++;
  return n;
}

/* -------------------------------- registrar ------------------------------ */

export function registerBuilder(ctx: RegistrarCtx): void {
  const ex = ctx.executive;
  const sel = (v: unknown, dflt = 'all'): string => ctx.str(v, dflt) || dflt;

  /** Matched atoms grouped by object -> sorted, deduped local indices. */
  const byObject = (selection: string): Map<string, number[]> => {
    const m = new Map<string, number[]>();
    for (const ua of ex.atomsMatching(selection)) {
      let arr = m.get(ua.objName);
      if (!arr) m.set(ua.objName, (arr = []));
      arr.push(ua.index);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => a - b);
      // dedup
      let w = 0;
      for (let r = 0; r < arr.length; r++) if (r === 0 || arr[r] !== arr[r - 1]) arr[w++] = arr[r]!;
      arr.length = w;
    }
    return m;
  };

  /** First matched atom of a selection (or null). */
  const firstAtom = (selection: string): { objName: string; index: number } | null => {
    const matched = ex.atomsMatching(selection);
    const ua = matched[0];
    return ua ? { objName: ua.objName, index: ua.index } : null;
  };

  /* -------------------------------- add_bond ----------------------------- */
  // add_bond(object, index1, index2, order=1) — add a bond between two atoms of
  // one object. `index1`/`index2` are 1-based atom indices (PyMOL `ID`/`index`).
  // Returns the number of bonds added (0 if it already existed).
  ctx.command('add_bond', (args, kwargs): Json => {
    const objName = ctx.str(pick(args, kwargs, 0, 'object'), '');
    const i1 = Math.trunc(num(pick(args, kwargs, 1, 'index1'), 0)) - 1;
    const i2 = Math.trunc(num(pick(args, kwargs, 2, 'index2'), 0)) - 1;
    const order = Math.trunc(num(pick(args, kwargs, 3, 'order'), 1));
    const mol = ex.molecule(objName);
    if (!mol || i1 < 0 || i2 < 0 || i1 >= mol.natom || i2 >= mol.natom || i1 === i2) return 0;
    if (hasBond(mol, i1, i2)) return 0;
    mol.bonds.push(i1 < i2 ? [i1, i2] : [i2, i1]);
    setBondOrder(mol, i1, i2, order);
    ctx.publish();
    return 1;
  });

  /* --------------------------------- attach ------------------------------ */
  // attach(element, geometry, valence, name='', selection='pk1') — add one atom
  // of `element`, bonded to the picked atom at the covalent bond length in an
  // idealised open direction. `geometry`/`valence` accepted for signature parity.
  ctx.command('attach', (args, kwargs): Json => {
    const element = canonicalElement(ctx.str(pick(args, kwargs, 0, 'element'), 'H') || 'H');
    const name = ctx.str(kwargs.name, '') || element.toUpperCase();
    const target = firstAtom(sel(pick(args, kwargs, 4, 'selection'), 'pk1'));
    if (!target) return null;
    const mol = ex.molecule(target.objName);
    if (!mol) return null;

    const adj = buildAdjacency(mol);
    const parent = mol.atoms[target.index]!;
    const bl = covalent(parent.elem) + covalent(element);
    const nStates = Math.max(1, mol.states.length);
    const coords: Vec3[] = [];
    for (let s = 1; s <= nStates; s++) {
      const existing = neighbourDirs(mol, target.index, s, adj);
      const dir = fillDirections(existing, 1)[0] ?? [0, 0, 1];
      coords.push(add(mol.coord(target.index, s), scale(dir, bl)));
    }
    const atom: AtomInfo = {
      id: 0,
      name,
      resn: parent.resn,
      resi: parent.resi,
      resv: parent.resv,
      chain: parent.chain,
      segi: parent.segi,
      alt: '',
      elem: element,
      hetatm: parent.hetatm,
      b: 0,
      q: 1,
      color: 0,
      ss: '',
      visRep: defaultVisRep(),
    };
    appendAtoms(mol, [{ atom, coords, bondTo: target.index, order: 1 }]);
    ctx.publish();
    return null;
  });

  /* --------------------------------- h_add ------------------------------- */
  // h_add(selection='(all)') — add missing hydrogens to every heavy atom in the
  // selection at idealised tetrahedral/trigonal positions. Observe the result
  // via count_atoms('elem H'). Returns the number of hydrogens added.
  ctx.command('h_add', (args, kwargs): Json => {
    const groups = byObject(sel(pick(args, kwargs, 0, 'selection'), 'all'));
    let added = 0;
    for (const [objName, idxs] of groups) {
      const mol = ex.molecule(objName);
      if (!mol) continue;
      const heavy = idxs.filter((i) => {
        const e = mol.atoms[i]!.elem;
        return e !== 'H' && e !== 'D';
      });
      const specs = buildHydrogens(mol, heavy, { n: countHydrogens(mol) + 1 });
      appendAtoms(mol, specs);
      added += specs.length;
    }
    if (added > 0) ctx.publish();
    return added;
  });

  /* --------------------------------- h_fill ------------------------------ */
  // h_fill(selection='pk1') — remove the hydrogens on the picked atom(s) and
  // re-add them at idealised positions. Returns the number of hydrogens added.
  ctx.command('h_fill', (args, kwargs): Json => {
    const groups = byObject(sel(pick(args, kwargs, 0, 'selection'), 'pk1'));
    let added = 0;
    for (const [objName, idxs] of groups) {
      const mol = ex.molecule(objName);
      if (!mol) continue;
      // Heavy atoms among the picks, remembered by stable id (removal reindexes).
      const targetIds = new Set<number>();
      for (const i of idxs) {
        const a = mol.atoms[i]!;
        if (a.elem !== 'H' && a.elem !== 'D') targetIds.add(a.id);
      }
      // Drop hydrogens bonded to any picked heavy atom.
      const adj = buildAdjacency(mol);
      const drop = new Set<number>();
      for (const i of idxs) {
        for (const nb of adj[i]!) {
          const e = mol.atoms[nb]!.elem;
          if (e === 'H' || e === 'D') drop.add(nb);
        }
      }
      removeAtoms(mol, drop);
      // Re-locate the heavy atoms by id, then re-add hydrogens.
      const heavy: number[] = [];
      for (let i = 0; i < mol.natom; i++) if (targetIds.has(mol.atoms[i]!.id)) heavy.push(i);
      const specs = buildHydrogens(mol, heavy, { n: countHydrogens(mol) + 1 });
      appendAtoms(mol, specs);
      added += specs.length;
    }
    ctx.publish();
    return added;
  });

  /* ------------------------------- protonate ----------------------------- */
  // protonate(selection='(all)') — PyMOL alias: add hydrogens. Delegates to the
  // same idealised placement as h_add.
  ctx.command('protonate', (args, kwargs): Json => {
    const groups = byObject(sel(pick(args, kwargs, 0, 'selection'), 'all'));
    let added = 0;
    for (const [objName, idxs] of groups) {
      const mol = ex.molecule(objName);
      if (!mol) continue;
      const heavy = idxs.filter((i) => {
        const e = mol.atoms[i]!.elem;
        return e !== 'H' && e !== 'D';
      });
      const specs = buildHydrogens(mol, heavy, { n: countHydrogens(mol) + 1 });
      appendAtoms(mol, specs);
      added += specs.length;
    }
    if (added > 0) ctx.publish();
    return added;
  });

  /* -------------------------------- valence ------------------------------ */
  // valence(order, atom1='pk1', atom2='pk2') — set the order of the bond between
  // the first atom of each selection (creating it if absent). Returns bonds set.
  ctx.command('valence', (args, kwargs): Json => {
    const order = Math.trunc(num(pick(args, kwargs, 0, 'order'), 1));
    const t1 = firstAtom(sel(pick(args, kwargs, 1, 'atom1'), 'pk1'));
    const t2 = firstAtom(sel(pick(args, kwargs, 2, 'atom2'), 'pk2'));
    if (!t1 || !t2 || t1.objName !== t2.objName || t1.index === t2.index) return 0;
    const mol = ex.molecule(t1.objName);
    if (!mol) return 0;
    if (!hasBond(mol, t1.index, t2.index)) {
      mol.bonds.push(t1.index < t2.index ? [t1.index, t2.index] : [t2.index, t1.index]);
    }
    setBondOrder(mol, t1.index, t2.index, order);
    ctx.publish();
    return 1;
  });

  /* ----------------------------- cycle_valence --------------------------- */
  // cycle_valence(atom1='pk1', atom2='pk2') — cycle the bond order 1→2→3→1 on the
  // bond between the two picked atoms. Returns the new order (0 if no bond).
  ctx.command('cycle_valence', (args, kwargs): Json => {
    const t1 = firstAtom(sel(pick(args, kwargs, 0, 'atom1'), 'pk1'));
    const t2 = firstAtom(sel(pick(args, kwargs, 1, 'atom2'), 'pk2'));
    if (!t1 || !t2 || t1.objName !== t2.objName) return 0;
    const mol = ex.molecule(t1.objName);
    if (!mol || !hasBond(mol, t1.index, t2.index)) return 0;
    const nextOrder = (getBondOrder(mol, t1.index, t2.index) % 3) + 1;
    setBondOrder(mol, t1.index, t2.index, nextOrder);
    // h_fill (default): refill both atoms' hydrogens to satisfy the new order.
    const hFill = Number(pick(args, kwargs, 2, 'h_fill') ?? 1) !== 0;
    if (hFill) refillHydrogens(mol, [t1.index, t2.index]);
    ctx.publish();
    return nextOrder;
  });

  /* -------------------------------- replace ------------------------------ */
  // replace(element, geometry, valence, name='') — change the picked atom's
  // element (and name) in place. Returns the number of atoms replaced.
  ctx.command('replace', (args, kwargs): Json => {
    const element = canonicalElement(ctx.str(pick(args, kwargs, 0, 'element'), '') || '');
    if (element === '') return 0;
    const name = ctx.str(pick(args, kwargs, 3, 'name'), '') || element.toUpperCase();
    const target = firstAtom(sel(pick(args, kwargs, 4, 'selection'), 'pk1'));
    if (!target) return 0;
    const mol = ex.molecule(target.objName);
    if (!mol) return 0;
    const atom = mol.atoms[target.index]!;
    atom.elem = element;
    atom.name = name;
    // An explicit valence overrides the element default for H-filling.
    const valence = Number(pick(args, kwargs, 2, 'valence') ?? NaN);
    if (Number.isFinite(valence) && valence > 0) setValenceOverride(mol, atom.id, valence);
    // h_fill: strip the replaced atom's old hydrogens and refill to its valence.
    refillHydrogens(mol, [target.index]);
    ctx.publish();
    return 1;
  });

  /* ------------------------------ set_geometry --------------------------- */
  // set_geometry(selection, geometry, valence) — override the assumed valence of
  // the selected atoms so a later h_add/h_fill fills to it (editing.py). We store
  // the valence (falling back to the geometry code) as a per-atom override.
  ctx.command('set_geometry', (args, kwargs): Json => {
    const selection = sel(pick(args, kwargs, 0, 'selection'), 'pk1');
    const valence = Number(
      pick(args, kwargs, 2, 'valence') ?? pick(args, kwargs, 1, 'geometry') ?? NaN,
    );
    if (!Number.isFinite(valence) || valence <= 0) return 0;
    let n = 0;
    for (const ua of ex.atomsMatching(selection)) {
      const mol = ex.molecule(ua.objName);
      if (!mol) continue;
      setValenceOverride(mol, ua.atom.id, valence);
      n++;
    }
    return n;
  });

  /* --------------------------------- invert ------------------------------ */
  // invert(quiet=1) — invert the stereochemistry at the picked atom `pk1`,
  // holding the two attached atoms `pk2` and `pk3` immobile (Editor.cpp
  // EditorInvert). PyMOL takes no selection argument: it reads the editor picks.
  //
  // Algorithm (Editor.cpp:608): with centre `v` = pk1, and the two immobile
  // neighbours `v0` = pk2, `v1` = pk3, build the bisector axis
  //   n = normalize( normalize(v-v0) + normalize(v-v1) )
  // and rotate every "free" fragment (the atoms hanging off pk1 that are NOT
  // bonded to pk2 or pk3) by 180° about that axis through `v`. Rotating by π
  // about the bisector swaps the two free substituents' half-spaces — a rigid
  // motion that inverts the chirality while leaving pk2/pk3 (and all bond
  // lengths) untouched.
  ctx.command('invert', (): Json => {
    const target = firstAtom('pk1');
    if (!target) return null;
    const mol = ex.molecule(target.objName);
    if (!mol) return null;
    const a2 = firstAtom('pk2');
    const a3 = firstAtom('pk3');
    // Both immobile picks must exist in the same object (EditorInvert requires
    // pk1/pk2/pk3, all in one object, else it errors and does nothing).
    if (!a2 || !a3) return null;
    if (a2.objName !== target.objName || a3.objName !== target.objName) return null;
    const ci = target.index;
    const i2 = a2.index;
    const i3 = a3.index;

    const adj = buildAdjacency(mol);
    // Free fragments: each neighbour of pk1 other than pk2/pk3 seeds a connected
    // component reached without crossing back through pk1. Skip any component
    // that contains pk2 or pk3 (a ring back to an immobile atom is not free).
    const moved = new Set<number>();
    for (const nb of adj[ci]!) {
      if (nb === i2 || nb === i3) continue;
      const seen = new Set<number>([nb]);
      const stack = [nb];
      let touchesImmobile = false;
      while (stack.length > 0) {
        const x = stack.pop()!;
        if (x === i2 || x === i3) touchesImmobile = true;
        for (const y of adj[x]!) {
          if (y === ci || seen.has(y)) continue;
          seen.add(y);
          stack.push(y);
        }
      }
      if (!touchesImmobile) for (const x of seen) moved.add(x);
    }
    if (moved.size === 0) return null;

    for (let s = 0; s < mol.states.length; s++) {
      const set = mol.states[s]!;
      const v: Vec3 = [set[ci * 3] ?? 0, set[ci * 3 + 1] ?? 0, set[ci * 3 + 2] ?? 0];
      const v0: Vec3 = [set[i2 * 3] ?? 0, set[i2 * 3 + 1] ?? 0, set[i2 * 3 + 2] ?? 0];
      const v1: Vec3 = [set[i3 * 3] ?? 0, set[i3 * 3 + 1] ?? 0, set[i3 * 3 + 2] ?? 0];
      const n0 = norm(sub(v, v0));
      const n1 = norm(sub(v, v1));
      const axis = norm(add(n0, n1));
      // Rotate 180° about `axis` through `v`: R(p) = v + (2 (axis·d) axis − d),
      // where d = p − v.
      for (const idx of moved) {
        const p: Vec3 = [set[idx * 3] ?? 0, set[idx * 3 + 1] ?? 0, set[idx * 3 + 2] ?? 0];
        const d = sub(p, v);
        const dot = axis[0] * d[0] + axis[1] * d[1] + axis[2] * d[2];
        const r = sub(scale(axis, 2 * dot), d);
        set[idx * 3] = v[0] + r[0];
        set[idx * 3 + 1] = v[1] + r[1];
        set[idx * 3 + 2] = v[2] + r[2];
      }
    }
    ctx.publish();
    return null;
  });

  /* --------------------------------- fuse -------------------------------- */
  // fuse(selection1='pk1', selection2='pk2', mode=0, recolor=1, move=1) — join
  // two objects into one. PyMOL's `ExecutiveFuse`/`ObjectMoleculeFuse` copies the
  // WHOLE object holding `selection1` (the source) into the object holding
  // `selection2` (the target), then — unless `mode==3` — forms a bond between the
  // target atom and the copy of the source atom, moving the copy into a bonding
  // position first (`move`). The source object is left untouched, so the atom
  // total grows by the source's atom count. Returns 1 on success.
  ctx.command('fuse', (args, kwargs): Json => {
    const mode = Math.trunc(num(pick(args, kwargs, 2, 'mode'), 0));
    const recolor = num(pick(args, kwargs, 3, 'recolor'), 1) !== 0;
    const move = num(pick(args, kwargs, 4, 'move'), 1) !== 0;
    const s1 = firstAtom(sel(pick(args, kwargs, 0, 'selection1'), 'pk1')); // source
    const s2 = firstAtom(sel(pick(args, kwargs, 1, 'selection2'), 'pk2')); // target
    if (!s1 || !s2) return 0;

    // Same object: PyMOL's ExecutiveFuse requires two *different* objects (it
    // bails when obj0 == obj1). The port keeps a minimal intra-object bond here
    // for backward compatibility with callers that lean on it.
    if (s1.objName === s2.objName) {
      if (s1.index === s2.index) return 0;
      const mol = ex.molecule(s1.objName);
      if (!mol || hasBond(mol, s1.index, s2.index)) return 0;
      mol.bonds.push(s1.index < s2.index ? [s1.index, s2.index] : [s2.index, s1.index]);
      ctx.publish();
      return 1;
    }

    // Cross-object fuse: copy every atom of the source object into the target.
    const srcMol = ex.molecule(s1.objName);
    const dstMol = ex.molecule(s2.objName);
    if (!srcMol || !dstMol || srcMol.natom === 0) return 0;

    const createBond = mode !== 3;
    const base = dstMol.natom; // first copied index within the target
    const targetIdx = s2.index; // anchor atom in the target
    const srcAnchorCopy = base + s1.index; // copy of the source anchor in the target

    // Translation that moves the source copy so its anchor atom sits at bonding
    // distance from the target anchor along the target→source direction.
    let dx = 0;
    let dy = 0;
    let dz = 0;
    if (createBond && move) {
      const tp = dstMol.coord(targetIdx, 1);
      const sp = srcMol.coord(s1.index, 1);
      const bl = covalent(dstMol.atoms[targetIdx]!.elem) + covalent(srcMol.atoms[s1.index]!.elem);
      let ux = sp[0] - tp[0];
      let uy = sp[1] - tp[1];
      let uz = sp[2] - tp[2];
      const ul = Math.hypot(ux, uy, uz);
      if (ul < 1e-6) {
        ux = 1;
        uy = 0;
        uz = 0;
      } else {
        ux /= ul;
        uy /= ul;
        uz /= ul;
      }
      dx = tp[0] + ux * bl - sp[0];
      dy = tp[1] + uy * bl - sp[1];
      dz = tp[2] + uz * bl - sp[2];
    }

    // Copy the atom table (recolor carbons to the target atom's colour when asked).
    const dstColor = dstMol.atoms[targetIdx]!.color;
    for (let i = 0; i < srcMol.natom; i++) {
      const sa = srcMol.atoms[i]!;
      const copy: AtomInfo = { ...sa, id: base + i + 1 };
      if (recolor && canonicalElement(sa.elem) === 'C') copy.color = dstColor;
      dstMol.atoms.push(copy);
    }

    // Copy coordinates into every target state, applying the move translation.
    if (dstMol.states.length === 0) dstMol.states.push(new Float32Array(base * 3));
    const nNew = srcMol.natom;
    for (let st = 0; st < dstMol.states.length; st++) {
      const old = dstMol.states[st]!;
      const out = new Float32Array(old.length + nNew * 3);
      out.set(old, 0);
      const ss = srcMol.states[st] ?? srcMol.states[0];
      for (let k = 0; k < nNew; k++) {
        out[old.length + k * 3] = (ss?.[k * 3] ?? 0) + dx;
        out[old.length + k * 3 + 1] = (ss?.[k * 3 + 1] ?? 0) + dy;
        out[old.length + k * 3 + 2] = (ss?.[k * 3 + 2] ?? 0) + dz;
      }
      dstMol.states[st] = out;
    }

    // Copy the source's internal bonds (shifted into the target's index space),
    // preserving their orders.
    for (const [a, b] of srcMol.bonds) {
      const na = base + a;
      const nb = base + b;
      dstMol.bonds.push(na < nb ? [na, nb] : [nb, na]);
      const ord = getBondOrder(srcMol, a, b);
      if (ord !== 1) setBondOrder(dstMol, na, nb, ord);
    }

    // Form the linking bond between the target atom and the source anchor's copy.
    if (createBond && !hasBond(dstMol, targetIdx, srcAnchorCopy)) {
      dstMol.bonds.push(
        targetIdx < srcAnchorCopy ? [targetIdx, srcAnchorCopy] : [srcAnchorCopy, targetIdx],
      );
    }

    ctx.publish();
    return 1;
  });

  /* -------------------------------- rebond ------------------------------- */
  // rebond(object='') — discard the object's bonds and recompute them from
  // interatomic distances (covalent radii + 0.35 Å cutoff). Empty object -> all.
  ctx.command('rebond', (args, kwargs): Json => {
    const objName = ctx.str(pick(args, kwargs, 0, 'object'), '');
    const targets = objName ? [ex.molecule(objName)] : ex.moleculesInOrder();
    let count = 0;
    for (const mol of targets) {
      if (!mol) continue;
      mol.bonds.length = 0;
      clearBondOrders(mol);
      connectByDistance(mol);
      count += mol.bonds.length;
    }
    ctx.publish();
    return count;
  });

  /* --------------------------- fix_chemistry / sort ---------------------- */
  // fix_chemistry(selection1, selection2) — PyMOL repairs valences/charges at the
  // interface of two selections. This port has no partial-charge model, so it is
  // a no-op that reports success.
  ctx.command('fix_chemistry', (): Json => 0);

  // sort(object='') — re-sort atoms into PyMOL's canonical order
  // (ObjectMoleculeSort). Needed after `alter` changes naming properties (resi,
  // chain, name, ...) without moving atoms in the internal list. Empty object
  // name re-sorts every molecule.
  ctx.command('sort', (args, kwargs): Json => {
    const objName = ctx.str(pick(args, kwargs, 0, 'object'), '');
    const targets = objName ? [ex.molecule(objName)] : ex.moleculesInOrder();
    for (const mol of targets) {
      if (!mol) continue;
      sortAtomsInPlace(mol);
    }
    ctx.publish();
    return null;
  });
}

/* -------------------------- distance connectivity ------------------------ */

/** Connect-by-distance over state 1 (mirrors `pdb.ts`'s `ObjectMoleculeConnect`). */
function connectByDistance(mol: ObjectMolecule): void {
  const set = mol.states[0];
  if (!set) return;
  const seen = new Set<string>();
  const n = mol.natom;
  for (let i = 0; i < n; i++) {
    const ri = covalent(mol.atoms[i]!.elem);
    const xi = set[i * 3] ?? 0;
    const yi = set[i * 3 + 1] ?? 0;
    const zi = set[i * 3 + 2] ?? 0;
    for (let j = i + 1; j < n; j++) {
      const cutoff = ri + covalent(mol.atoms[j]!.elem) + CONNECT_CUTOFF;
      const dx = xi - (set[j * 3] ?? 0);
      const dy = yi - (set[j * 3 + 1] ?? 0);
      const dz = zi - (set[j * 3 + 2] ?? 0);
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 0.01 && d2 <= cutoff * cutoff) {
        const key = bondKey(i, j);
        if (!seen.has(key)) {
          seen.add(key);
          mol.bonds.push([i, j]);
        }
      }
    }
  }
}
