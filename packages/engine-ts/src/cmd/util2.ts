/**
 * Remaining cmd.util.* helpers (analysis + coloring) not in coloring.ts — ported
 * from pymol/util.py.
 *
 * Registers its handlers through the shared {@link RegistrarCtx}. Orchestration
 * verbs compose lower-level commands via `ctx.call(...)` (e.g. `spectrum`, `dss`,
 * `label`, `align`); simple recolours go straight through `ctx.executive.color`
 * or per-atom mutation. Always `ctx.publish()` after a state mutation.
 *
 * The `util.cbc`/`util.rainbow` and `util.cbag`/`cbac`/… carbon colourers live in
 * coloring.ts and are NOT re-registered here.
 */
import type { Json } from '@tenmol/protocol';
import type { AtomInfo } from '../model/atom';
import type { ObjectMolecule } from '../model/molecule';
import { ELEMENT_COLOR, getColorIndex, setColor, type RGB } from '../exec/color';
import { DEFAULT_PROBE } from '../geometry/surface_gen';
import type { RegistrarCtx } from './registrar';

/* --------------------------------------------------------------------------
 * Small numeric helpers.
 * ------------------------------------------------------------------------ */

type Vec3 = [number, number, number];

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/**
 * Signed dihedral (degrees, [-180,180]) about the p2->p3 axis in PyMOL's IUPAC
 * convention — copied from analysis.ts so a helix reads (phi,psi) ≈ (-57,-47).
 */
function dihedral(p1: Vec3, p2: Vec3, p3: Vec3, p4: Vec3): number {
  const b1 = sub(p2, p1);
  const b2 = sub(p3, p2);
  const b3 = sub(p4, p3);
  const n1 = cross(b1, b2);
  const n2 = cross(b2, b3);
  const m1 = cross(n1, norm(b2));
  const x = dot3(n1, n2);
  const y = dot3(m1, n2);
  return (-Math.atan2(y, x) * 180) / Math.PI;
}

/* --------------------------------------------------------------------------
 * Colour helpers.
 * ------------------------------------------------------------------------ */

/** A colour name -> index, defining it from `rgb` if not already in the table. */
function resolveOrDefine(name: string, rgb: RGB): number {
  const idx = getColorIndex(name);
  return idx >= 0 ? idx : setColor(name, rgb);
}

/** Element -> CPK colour name PyMOL's pseudo-colour `atomic` resolves per atom. */
function cpkColorName(elem: string): string | undefined {
  return elem === 'C' ? 'carbon' : ELEMENT_COLOR[elem];
}

/* --------------------------------------------------------------------------
 * Atomic masses (u), PyMOL's element table subset used by `compute_mass`.
 * ------------------------------------------------------------------------ */

const ATOMIC_MASS: Readonly<Record<string, number>> = {
  H: 1.008,
  He: 4.003,
  Li: 6.94,
  Be: 9.012,
  B: 10.81,
  C: 12.011,
  N: 14.007,
  O: 15.999,
  F: 18.998,
  Ne: 20.18,
  Na: 22.99,
  Mg: 24.305,
  Al: 26.982,
  Si: 28.085,
  P: 30.974,
  S: 32.06,
  Cl: 35.45,
  Ar: 39.948,
  K: 39.098,
  Ca: 40.078,
  Mn: 54.938,
  Fe: 55.845,
  Co: 58.933,
  Ni: 58.693,
  Cu: 63.546,
  Zn: 65.38,
  Se: 78.971,
  Br: 79.904,
  I: 126.904,
};

/* --------------------------------------------------------------------------
 * Solvent-accessible surface area (Shrake–Rupley dot sampling).
 * ------------------------------------------------------------------------ */

/** A near-uniform set of `n` unit-sphere directions (Fibonacci spiral). */
function fibonacciSphere(n: number): Vec3[] {
  const pts: Vec3[] = new Array(n);
  const phi = Math.PI * (3 - Math.sqrt(5)); // golden angle
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * i + 1) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const t = phi * i;
    pts[i] = [Math.cos(t) * r, y, Math.sin(t) * r];
  }
  return pts;
}

/** Map PyMOL's `dot_density` (0..4) to a per-atom dot count. */
function dotCount(density: number): number {
  const d = Math.max(0, Math.min(4, Math.trunc(density)));
  return [50, 100, 250, 500, 1000][d]!;
}

interface AreaAtom {
  pos: Vec3;
  r: number;
}

/**
 * Shrake–Rupley surface area (Å²) of the flagged atoms. Each atom's radius is
 * `vdw + probe`; a dot on that sphere counts as exposed unless it falls inside
 * another atom's sphere. When `loadB` is set, the per-atom area is written to
 * `atom.b`. Faithful to PyMOL's algorithm (dot_solvent/dot_density); the
 * absolute value is not bit-identical because the dot pattern differs.
 */
function shrakeRupley(
  entries: Array<{ atom: AtomInfo; pos: Vec3; vdw: number }>,
  occluders: Array<{ atom: AtomInfo; pos: Vec3; vdw: number }>,
  probe: number,
  density: number,
  loadB: boolean,
): number {
  const n = entries.length;
  const spheres: AreaAtom[] = entries.map((e) => ({ pos: e.pos, r: e.vdw + probe }));
  // The occluder shells: every atom of the enclosing objects. A measured atom is
  // its own occluder too (matched by identity below), so it never buries itself.
  const occ: Array<AreaAtom & { atom: AtomInfo }> = occluders.map((e) => ({
    pos: e.pos,
    r: e.vdw + probe,
    atom: e.atom,
  }));
  const dots = fibonacciSphere(dotCount(density));
  let total = 0;
  for (let i = 0; i < n; i++) {
    const si = spheres[i]!;
    const self = entries[i]!.atom;
    // Neighbours whose spheres can overlap atom i's dot shell (excluding itself).
    const neigh: AreaAtom[] = [];
    for (const sj of occ) {
      if (sj.atom === self) continue;
      const d2 =
        (si.pos[0] - sj.pos[0]) ** 2 + (si.pos[1] - sj.pos[1]) ** 2 + (si.pos[2] - sj.pos[2]) ** 2;
      const reach = si.r + sj.r;
      if (d2 < reach * reach) neigh.push(sj);
    }
    let free = 0;
    for (const u of dots) {
      const px = si.pos[0] + si.r * u[0];
      const py = si.pos[1] + si.r * u[1];
      const pz = si.pos[2] + si.r * u[2];
      let buried = false;
      for (const sj of neigh) {
        const dx = px - sj.pos[0];
        const dy = py - sj.pos[1];
        const dz = pz - sj.pos[2];
        if (dx * dx + dy * dy + dz * dz < sj.r * sj.r) {
          buried = true;
          break;
        }
      }
      if (!buried) free++;
    }
    const area = (free / dots.length) * 4 * Math.PI * si.r * si.r;
    if (loadB) entries[i]!.atom.b = area;
    total += area;
  }
  return total;
}

/* --------------------------------------------------------------------------
 * Registration.
 * ------------------------------------------------------------------------ */

export function registerUtil2(ctx: RegistrarCtx): void {
  const ex = ctx.executive;
  const sel0 = (v: unknown): string => ctx.str(v, 'all') || 'all';

  /** Colour every atom of `sel` by its element (CPK), PyMOL's `color atomic`. */
  const colorAtomic = (sel: string): number => {
    const atoms = ex.atomsMatching(sel);
    for (const ua of atoms) {
      const name = cpkColorName(ua.atom.elem);
      if (!name) continue;
      const idx = getColorIndex(name);
      if (idx >= 0) ua.atom.color = idx;
    }
    return atoms.length;
  };

  /* ----------------------- util.sum_*_charges --------------------------- */

  // util.py:269/277 — total the per-atom formal / partial charge over a
  // selection. Absent charge ⇒ 0 (an atom with no assigned charge).
  ctx.command('util.sum_formal_charges', (args): Json => {
    let sum = 0;
    for (const ua of ex.atomsMatching(sel0(args[0]))) sum += ua.atom.formalCharge ?? 0;
    return sum;
  });
  ctx.command('util.sum_partial_charges', (args): Json => {
    let sum = 0;
    for (const ua of ex.atomsMatching(sel0(args[0]))) sum += ua.atom.partialCharge ?? 0;
    return sum;
  });

  /* ------------------------------- util.cnc ----------------------------- */

  // Colour by element but leave carbon (and its current colour) untouched.
  ctx.command('util.cnc', (args): Json => {
    const s = sel0(args[0]);
    const n = colorAtomic(`(${s}) and not elem C`);
    ctx.publish();
    return n;
  });

  /* ---------------------- util.cba / cbh / color_carbon ----------------- */

  // Colour non-carbons by element, carbons by `color` (util.py cba; the extra
  // flags=1 colour-all pass is omitted — the port has no per-object colour
  // flags, so this is the atomic + carbon recolour only).
  ctx.command('util.cba', (args): Json => {
    const color = ctx.str(args[0]);
    const s = sel0(args[1]);
    colorAtomic(`(${s}) and not elem C`);
    ex.color(color, `(${s}) and elem C`);
    ctx.publish();
    return null;
  });

  // As cba but the special element is hydrogen (util.py cbh).
  ctx.command('util.cbh', (args): Json => {
    const color = ctx.str(args[0]);
    const s = sel0(args[1]);
    colorAtomic(`(${s}) and not elem H`);
    ex.color(color, `(${s}) and elem H`);
    ctx.publish();
    return null;
  });

  // Colour only the carbons of the selection (util.py color_carbon).
  ctx.command('util.color_carbon', (args): Json => {
    const color = ctx.str(args[0]);
    const s = sel0(args[1]);
    const n = ex.color(color, `(${s}) and elem C`);
    ctx.publish();
    return n;
  });

  /* --------------- util.cbab / cbao / cbak / cbam (by element) ---------- */

  // Element colouring where carbon takes a fixed colour (util.py variants that
  // coloring.ts did not already register). RGBs are PyMOL's for the two colours
  // absent from the base table.
  const cbVariants: Array<[verb: string, carbon: string, rgb: RGB]> = [
    ['util.cbab', 'slate', [0.5, 0.5, 1]],
    ['util.cbao', 'brightorange', [1.0, 0.7, 0.2]],
    ['util.cbak', 'pink', [1, 0.65, 0.85]],
    ['util.cbam', 'lightmagenta', [1.0, 0.2, 0.8]],
  ];
  for (const [verb, carbon, rgb] of cbVariants) {
    ctx.command(verb, (args): Json => {
      const s = sel0(args[0]);
      colorAtomic(`(${s}) and not elem C`);
      const idx = resolveOrDefine(carbon, rgb);
      for (const ua of ex.atomsMatching(`(${s}) and elem C`)) ua.atom.color = idx;
      ctx.publish();
      return null;
    });
  }

  /* ------------------------------- util.cbss ---------------------------- */

  // Colour by secondary structure (helix/sheet/loop). Assumes `dss` has run.
  ctx.command('util.cbss', (args): Json => {
    const s = sel0(args[0]);
    const helix = ctx.str(args[1], 'red') || 'red';
    const sheet = ctx.str(args[2], 'yellow') || 'yellow';
    const loop = ctx.str(args[3], 'green') || 'green';
    ex.color(helix, `(ss H and (${s}))`);
    ex.color(sheet, `(ss S and (${s}))`);
    ex.color(loop, `((not (ss S+H)) and (${s}))`);
    ctx.publish();
    return null;
  });

  /* -------------------------------- util.ss ----------------------------- */

  // Legacy secondary-structure assignment — delegates to `dss`.
  ctx.command('util.ss', (args): Json => {
    const s = sel0(args[0]);
    const state = Number(args[1] ?? 1) || 1;
    return ctx.call('dss', [s, state]);
  });

  /* ----------------------------- util.chainbow -------------------------- */

  // Spectrum-colour each chain of each object over its residues (byres).
  ctx.command('util.chainbow', (args): Json => {
    const s = sel0(args[0]);
    const palette = ctx.str(args[1], 'rainbow') || 'rainbow';
    for (const mol of ex.moleculesInOrder()) {
      const chains = new Set<string>();
      for (const ua of ex.atomsMatching(`model ${mol.name} and (${s})`)) chains.add(ua.atom.chain);
      const named = [...chains].filter((c) => c);
      for (const c of chains.size ? [...chains] : ['']) {
        // A blank chain id is NOT "no chain filter": select only the atoms not
        // in any named chain, so this pass never overwrites the named chains it
        // just coloured. With no named chains, that is the whole object (one
        // group, as intended).
        const target = c
          ? `(chain ${c} and model ${mol.name} and (${s}))`
          : named.length
            ? `(model ${mol.name} and (${s}) and not (${named.map((n) => `chain ${n}`).join(' or ')}))`
            : `(model ${mol.name} and (${s}))`;
        ctx.call('spectrum', ['count', palette, target], { byres: 1 });
      }
    }
    return null;
  });

  /* ----------------------------- util.color_objs ------------------------ */

  // Colour every object a different colour from a cycle.
  const OBJ_COLOR_CYCLE = [
    'carbon',
    'cyan',
    'lightmagenta',
    'yellow',
    'salmon',
    'slate',
    'orange',
    'green',
    'teal',
    'pink',
    'marine',
    'forest',
    'violet',
    'wheat',
    'purple',
  ];
  ctx.command('util.color_objs', (args): Json => {
    const s = sel0(args[0]);
    const names = ex.getNames('objects');
    let c = 0;
    for (const name of names) {
      const color = OBJ_COLOR_CYCLE[c % OBJ_COLOR_CYCLE.length]!;
      const idx = resolveOrDefine(color, [1, 0.2, 0.8]);
      const target = s === 'all' || s === '(all)' ? name : `(${name} and (${s}))`;
      for (const ua of ex.atomsMatching(target)) ua.atom.color = idx;
      c++;
    }
    ctx.publish();
    return names.length;
  });

  /* ------------------------------ util.color_deep ----------------------- */

  // Deprecated PyMOL wrapper around cmd.color_deep. The port has no per-object
  // or per-atom colour *settings* to unset, so this is a plain recolour.
  ctx.command('util.color_deep', (args): Json => {
    const color = ctx.str(args[0]);
    const name = sel0(args[1]);
    const n = ex.color(color, name);
    ctx.publish();
    return n;
  });

  /* --------------------------- util.get_area / sasa --------------------- */

  /** Collect the atoms of `sel` with their coordinates + vdw for area maths. */
  const areaEntries = (sel: string): Array<{ atom: AtomInfo; pos: Vec3; vdw: number }> => {
    const out: Array<{ atom: AtomInfo; pos: Vec3; vdw: number }> = [];
    for (const ua of ex.atomsMatching(sel)) {
      const mol = ex.molecule(ua.objName);
      if (!mol) continue;
      out.push({ atom: ua.atom, pos: mol.coord(ua.index, 1), vdw: mol.vdw(ua.index) });
    }
    return out;
  };

  const getArea = (sel: string, dotSolvent: boolean, density: number, loadB: boolean): number => {
    const entries = areaEntries(sel);
    if (entries.length === 0) return 0;
    // Occlude the measured atoms against EVERY atom of the objects the selection
    // touches, not just the selection itself — otherwise a buried residue reads
    // as fully exposed (the neighbours that bury it were excluded). This matches
    // PyMOL's whole-object area context.
    const occluders = occluderEntries(sel);
    const probe = dotSolvent ? ex.getSettingFloat('solvent_radius') || DEFAULT_PROBE : 0;
    const area = shrakeRupley(entries, occluders, probe, density, loadB);
    if (loadB) ctx.publish();
    return area;
  };

  /** Every atom of the objects that `sel` touches — the occluder context. */
  const occluderEntries = (sel: string): Array<{ atom: AtomInfo; pos: Vec3; vdw: number }> => {
    const objNames = new Set(ex.atomsMatching(sel).map((ua) => ua.objName));
    const out: Array<{ atom: AtomInfo; pos: Vec3; vdw: number }> = [];
    for (const name of objNames) {
      const mol = ex.molecule(name);
      if (!mol) continue;
      for (let i = 0; i < mol.natom; i++) {
        out.push({ atom: mol.atoms[i]!, pos: mol.coord(i, 1), vdw: mol.vdw(i) });
      }
    }
    return out;
  };

  // Van-der-Waals / molecular surface area (dot_solvent 0 by default).
  ctx.command('util.get_area', (args, kwargs): Json => {
    const s = sel0(args[0]);
    const dotSolvent = Number(args[2] ?? kwargs.dot_solvent ?? 0) !== 0;
    const density = Number(args[3] ?? kwargs.dot_density ?? 5);
    return getArea(s, dotSolvent, density, Boolean(kwargs.load_b));
  });

  // Solvent-accessible surface area (dot_solvent forced on).
  ctx.command('util.get_sasa', (args, kwargs): Json => {
    const s = sel0(args[0]);
    const density = Number(args[2] ?? kwargs.dot_density ?? 5);
    return getArea(s, true, density, Boolean(kwargs.load_b));
  });

  /* ----------------- util.find_surface_atoms / _residues ---------------- */

  const cutoffOf = (v: unknown): number => {
    const c = Number(v ?? -1);
    if (Number.isFinite(c) && c >= 0) return c;
    const setting = ex.getSettingFloat('surface_residue_cutoff');
    return setting > 0 ? setting : 2.5; // PyMOL default
  };

  // Exposed atoms: per-atom SASA into b, then select b > cutoff.
  ctx.command('util.find_surface_atoms', (args): Json => {
    const s = sel0(args[0]);
    const name = ctx.str(args[1]) || 'exposed';
    const cutoff = cutoffOf(args[2]);
    getArea(s, true, 3, true); // load per-atom SASA into b
    ex.select(name, `(${s}) and b > ${cutoff}`);
    ctx.publish();
    return name;
  });

  // Exposed residues: per-atom SASA into b, sum per residue, keep residues whose
  // exposed area clears the cutoff (a byres selection over their atoms).
  ctx.command('util.find_surface_residues', (args): Json => {
    const s = sel0(args[0]);
    const name = ctx.str(args[1]) || 'exposed';
    const cutoff = cutoffOf(args[2]);
    getArea(s, true, 3, true);
    // Key by OBJECT + chain + resi — two structures sharing a chain/resi label
    // must not have their exposed areas merged, and the generated selection must
    // be scoped to the right object.
    const resArea = new Map<string, number>();
    for (const ua of ex.atomsMatching(s)) {
      const key = `${ua.objName}|${ua.atom.chain}|${ua.atom.resi}`;
      resArea.set(key, (resArea.get(key) ?? 0) + ua.atom.b);
    }
    const clauses: string[] = [];
    for (const [key, v] of resArea) {
      if (v < cutoff) continue;
      const [obj, chain, resi] = key.split('|');
      clauses.push(`(model ${obj} and chain ${chain} and resi ${resi})`);
    }
    ex.select(name, clauses.length ? `byres ((${s}) and (${clauses.join(' or ')}))` : 'none');
    ctx.publish();
    return name;
  });

  /* ----------------------------- util.compute_mass ---------------------- */

  ctx.command('util.compute_mass', (args): Json => {
    const s = sel0(args[0]);
    let mass = 0;
    for (const ua of ex.atomsMatching(s)) mass += ATOMIC_MASS[ua.atom.elem] ?? 0;
    return mass;
  });

  /* ------------------------------- util.phipsi -------------------------- */

  // Backbone (phi, psi) of the first residue in the selection. Approximate: the
  // previous/next residues are taken from load order (a PDB lists residues
  // sequentially), not by walking the N/C bond graph as PyMOL's `neighbor` does.
  ctx.command('util.phipsi', (args): Json => {
    const s = sel0(args[0]);
    const matched = ex.atomsMatching(s);
    if (matched.length === 0) return [null, null];
    const first = matched[0]!;
    const mol = ex.molecule(first.objName);
    if (!mol) return [null, null];
    const residues = groupResidues(mol);
    const key = resKey(first.atom);
    const i = residues.findIndex((r) => r.key === key);
    if (i < 0) return [null, null];
    const res = residues[i]!;
    const prev = residues[i - 1];
    const next = residues[i + 1];
    const same = (r?: Residue): boolean => !!r && r.chain === res.chain && r.segi === res.segi;
    let phi: number | null = null;
    let psi: number | null = null;
    if (res.n && res.ca && res.c) {
      if (same(prev) && prev!.c) phi = dihedral(prev!.c, res.n, res.ca, res.c);
      if (same(next) && next!.n) psi = dihedral(res.n, res.ca, res.c, next!.n);
    }
    return [phi, psi];
  });

  /* ------------------------------ util.mass_align ----------------------- */

  // Align every other (non-overlapping) object onto `target` by Cα sequence.
  ctx.command('util.mass_align', (args, kwargs): Json => {
    const target = ctx.str(args[0]);
    const enabledOnly = Number(args[1] ?? kwargs.enabled_only ?? 0) !== 0;
    const names = ex.getNames('objects', enabledOnly);
    let aligned = 0;
    for (const name of names) {
      if (name === target) continue;
      if (ex.countAtoms(`(${target}) and (${name})`) !== 0) continue;
      ctx.call('align', [
        `polymer and name CA and (${name})`,
        `polymer and name CA and (${target})`,
      ]);
      aligned++;
    }
    return aligned;
  });

  /* ------------------- util.label_chains / label_segments --------------- */

  const labelBy = (sel: string, field: 'chain' | 'segi'): Json => {
    for (const mol of ex.moleculesInOrder()) {
      const groups = new Set<string>();
      for (const ua of ex.atomsMatching(`model ${mol.name} and (${sel})`)) {
        groups.add(field === 'chain' ? ua.atom.chain : ua.atom.segi);
      }
      for (const g of groups) {
        if (!g) continue;
        ctx.call('label', [
          `first (model ${mol.name} and ${field} ${g} and (${sel}))`,
          `'${field} '+${field}`,
        ]);
      }
    }
    return null;
  };

  // Label the first atom of each chain with "chain <id>".
  ctx.command('util.label_chains', (args): Json => labelBy(sel0(args[0]), 'chain'));

  // Label the first atom of each segment with "segi <id>".
  ctx.command('util.label_segments', (args): Json => labelBy(sel0(args[0]), 'segi'));
}

/* --------------------------------------------------------------------------
 * Residue grouping (for phipsi) — mirrors analysis.ts's assignSS grouping.
 * ------------------------------------------------------------------------ */

interface Residue {
  key: string;
  chain: string;
  segi: string;
  n?: Vec3;
  ca?: Vec3;
  c?: Vec3;
}

function resKey(a: AtomInfo): string {
  return `${a.chain}|${a.segi}|${a.resi}`;
}

function groupResidues(mol: ObjectMolecule): Residue[] {
  const residues: Residue[] = [];
  const byKey = new Map<string, Residue>();
  for (let i = 0; i < mol.atoms.length; i++) {
    const a = mol.atoms[i]!;
    const key = resKey(a);
    let res = byKey.get(key);
    if (!res) {
      res = { key, chain: a.chain, segi: a.segi };
      byKey.set(key, res);
      residues.push(res);
    }
    const name = a.name.toUpperCase();
    if (name === 'N') res.n = mol.coord(i, 1);
    else if (name === 'CA') res.ca = mol.coord(i, 1);
    else if (name === 'C') res.c = mol.coord(i, 1);
  }
  return residues;
}
