/**
 * The `analysis` command subsystem. Registers its `cmd.*` handlers via the
 * {@link RegistrarCtx}. See docs/engine-port-gaps.md.
 *
 * Ports the per-atom/per-object query surface of PyMOL's executive:
 *
 *   dss           — assign secondary structure ('H'/'S'/'') from backbone geometry
 *   get_chains    — the sorted distinct chain identifiers of a selection
 *   count_states  — the max number of coordinate states across matched objects
 *   identify      — the atom IDs (or (object, id) pairs) of a selection
 *   iterate       — run an expression per matched atom (read-only + `stored`)
 *   iterate_state — as `iterate`, with per-atom coordinates x/y/z in scope
 *   alter         — as `iterate`, but assigned atom fields are written back
 *
 * NOTE: unlike real PyMOL, the `iterate`/`alter` expression is **JavaScript**,
 * not Python. The atom's fields (name, resn, resi, resv, chain, segi, alt, elem,
 * b, q, color, ss, id, index, hetatm, model) are in scope as bare variables, plus
 * a mutable `stored` object for collecting side effects (supply it via the
 * `space.stored` kwarg, PyMOL-style). For `alter`, a statement like `b=42` or
 * `ss='H'` reassigns the in-scope variable and the new value is written back to
 * the atom. `iterate_state`/`alter_state` additionally expose x/y/z.
 */
import type { Json } from '@tenmol/protocol';
import type { ObjectMolecule } from '../model/molecule';
import type { RegistrarCtx } from './registrar';

type Vec3 = [number, number, number];

/* ------------------------------ vector math ------------------------------ */

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/**
 * Signed dihedral angle (degrees) about the p2->p3 axis, in [-180, 180].
 * Mirrors PyMOL's `get_dihedral3` convention.
 */
function dihedral(p1: Vec3, p2: Vec3, p3: Vec3, p4: Vec3): number {
  const b1 = sub(p2, p1);
  const b2 = sub(p3, p2);
  const b3 = sub(p4, p3);
  const n1 = cross(b1, b2);
  const n2 = cross(b2, b3);
  const m1 = cross(n1, norm(b2));
  const x = dot(n1, n2);
  const y = dot(m1, n2);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/* ------------------------------ secondary structure ---------------------- */

/** One polymer residue's backbone, in chain order. */
interface Residue {
  chain: string;
  segi: string;
  atomIdx: number[];
  n?: Vec3;
  ca?: Vec3;
  c?: Vec3;
}

/**
 * Classify a residue from its (phi, psi) backbone dihedrals. Ranges are widened
 * around the ideal alpha-helix (-57, -47) and beta-strand (-120, 130) so a real
 * protein's helices and strands are detected; this is a heuristic, not exact
 * PyMOL `SSTypeAssignment` (which uses a full H-bond pattern search).
 */
function classify(phi: number | undefined, psi: number | undefined): string {
  if (phi === undefined || psi === undefined) return '';
  if (phi >= -120 && phi <= -30 && psi >= -80 && psi <= 10) return 'H';
  if (phi >= -180 && phi <= -50 && (psi >= 80 || psi <= -170)) return 'S';
  return '';
}

/** Assign `.ss` on every polymer atom of `mol` from backbone phi/psi geometry. */
function assignSS(mol: ObjectMolecule, state: number): void {
  // Group atoms into residues in load order (a PDB lists residues sequentially).
  const residues: Residue[] = [];
  const byKey = new Map<string, Residue>();
  for (let i = 0; i < mol.atoms.length; i++) {
    const a = mol.atoms[i]!;
    const key = `${a.chain}|${a.segi}|${a.resi}`;
    let res = byKey.get(key);
    if (!res) {
      res = { chain: a.chain, segi: a.segi, atomIdx: [] };
      byKey.set(key, res);
      residues.push(res);
    }
    res.atomIdx.push(i);
    const name = a.name.toUpperCase();
    if (name === 'N') res.n = mol.coord(i, state);
    else if (name === 'CA') res.ca = mol.coord(i, state);
    else if (name === 'C') res.c = mol.coord(i, state);
  }

  // Reset ss on everything we are about to (re)assign.
  for (const res of residues) for (const i of res.atomIdx) mol.atoms[i]!.ss = '';

  // Per-residue phi/psi using the previous/next residue when they are the
  // sequential chain neighbour (same chain + segment).
  const codes: string[] = residues.map(() => '');
  for (let i = 0; i < residues.length; i++) {
    const res = residues[i]!;
    if (!res.n || !res.ca || !res.c) continue;
    const prev = residues[i - 1];
    const next = residues[i + 1];
    const sameChain = (r?: Residue): boolean =>
      !!r && r.chain === res.chain && r.segi === res.segi;
    let phi: number | undefined;
    let psi: number | undefined;
    if (sameChain(prev) && prev!.c) phi = dihedral(prev!.c, res.n, res.ca, res.c);
    if (sameChain(next) && next!.n) psi = dihedral(res.n, res.ca, res.c, next!.n);
    codes[i] = classify(phi, psi);
  }

  // Run-length smoothing: a helix needs >=3 consecutive H, a strand >=2
  // consecutive S; shorter runs are noise -> loop. This prevents isolated
  // residues from being called helix/strand.
  smoothRuns(codes, 'H', 3);
  smoothRuns(codes, 'S', 2);

  for (let i = 0; i < residues.length; i++) {
    const ss = codes[i]!;
    if (ss === '') continue;
    for (const idx of residues[i]!.atomIdx) mol.atoms[idx]!.ss = ss;
  }
}

/** Drop runs of `code` shorter than `minLen` (set them back to loop). */
function smoothRuns(codes: string[], code: string, minLen: number): void {
  let i = 0;
  while (i < codes.length) {
    if (codes[i] !== code) {
      i++;
      continue;
    }
    let j = i;
    while (j < codes.length && codes[j] === code) j++;
    if (j - i < minLen) for (let k = i; k < j; k++) codes[k] = '';
    i = j;
  }
}

/* ------------------------------ iterate / alter -------------------------- */

/** Atom fields exposed as bare variables and (for `alter`) written back. */
const ATOM_FIELDS = [
  'name',
  'resn',
  'resi',
  'resv',
  'chain',
  'segi',
  'alt',
  'elem',
  'b',
  'q',
  'color',
  'ss',
  'id',
] as const;

/** Fields that must be coerced to a number when written back by `alter`. */
const NUMERIC_FIELDS = new Set(['resv', 'b', 'q', 'color', 'id']);

/**
 * Compile an `iterate`/`alter` expression into a function that, given an atom's
 * field values, evaluates the JS body (mutating `stored`) and returns the
 * possibly-reassigned atom-field values in `ATOM_FIELDS` order.
 */
function compileExpr(expr: string, extraParams: string[]): (...a: unknown[]) => unknown[] {
  const params = [...ATOM_FIELDS, 'index', 'hetatm', 'model', ...extraParams, 'stored'];
  const body = `${expr}\n;return [${ATOM_FIELDS.join(',')}];`;
   
  const fn = new Function(...params, body) as (...a: unknown[]) => unknown[];
  return fn;
}

/** Resolve the caller's `stored` namespace object (PyMOL's `space`). */
function resolveStored(kwargs: Record<string, unknown>): Record<string, unknown> {
  const space = kwargs.space as Record<string, unknown> | undefined;
  if (space && typeof space.stored === 'object' && space.stored) {
    return space.stored as Record<string, unknown>;
  }
  if (kwargs.stored && typeof kwargs.stored === 'object') {
    return kwargs.stored as Record<string, unknown>;
  }
  return {};
}

/* -------------------------------- registrar ------------------------------ */

export function registerAnalysis(ctx: RegistrarCtx): void {
  const ex = ctx.executive;
  const sel0 = (v: unknown): string => ctx.str(v, 'all') || 'all';

  // ---- get_chains --------------------------------------------------------
  ctx.command('get_chains', (args) => {
    const chains = new Set<string>();
    for (const ua of ex.atomsMatching(sel0(args[0]))) chains.add(ua.atom.chain);
    return [...chains].sort() as Json;
  });

  // ---- count_states ------------------------------------------------------
  ctx.command('count_states', (args) => {
    const names = new Set<string>();
    for (const ua of ex.atomsMatching(sel0(args[0]))) names.add(ua.objName);
    let max = 0;
    for (const n of names) max = Math.max(max, ex.molecule(n)?.nstate ?? 0);
    return max || 1;
  });

  // ---- identify ----------------------------------------------------------
  ctx.command('identify', (args, kwargs) => {
    const mode = Number(args[1] ?? kwargs.mode ?? 0) || 0;
    const out: Json[] = [];
    for (const ua of ex.atomsMatching(sel0(args[0]))) {
      out.push(mode === 1 ? [ua.objName, ua.atom.id] : ua.atom.id);
    }
    return out;
  });

  // ---- dss ---------------------------------------------------------------
  ctx.command('dss', (args) => {
    const sel = sel0(args[0]);
    const state = Number(args[1] ?? 0) || 0;
    const objNames = new Set<string>();
    for (const ua of ex.atomsMatching(sel)) objNames.add(ua.objName);
    for (const name of objNames) {
      const mol = ex.molecule(name);
      if (mol) assignSS(mol, state > 0 ? state : 1);
    }
    ctx.publish();
    return null;
  });

  // ---- iterate / iterate_state / alter -----------------------------------
  const runPerAtom = (
    sel: string,
    expr: string,
    kwargs: Record<string, unknown>,
    opts: { writeBack: boolean; state?: number },
  ): number => {
    const stored = resolveStored(kwargs);
    const withCoords = opts.state !== undefined;
    const fn = compileExpr(expr, withCoords ? ['x', 'y', 'z'] : []);
    const matched = ex.atomsMatching(sel);
    for (const ua of matched) {
      const a = ua.atom;
      const base: unknown[] = ATOM_FIELDS.map((f) => a[f]);
      base.push(ua.index + 1, a.hetatm, ua.objName);
      if (withCoords) {
        const mol = ex.molecule(ua.objName)!;
        const [x, y, z] = mol.coord(ua.index, opts.state && opts.state > 0 ? opts.state : 1);
        base.push(x, y, z);
      }
      base.push(stored);
      const result = fn(...base);
      if (opts.writeBack) {
        for (let k = 0; k < ATOM_FIELDS.length; k++) {
          const field = ATOM_FIELDS[k]!;
          const raw = result[k];
          const rec = a as unknown as Record<string, unknown>;
          if (NUMERIC_FIELDS.has(field)) {
            rec[field] = Number(raw);
          } else if (field === 'ss' || field === 'name' || field === 'resn' ||
                     field === 'resi' || field === 'chain' || field === 'segi' ||
                     field === 'alt' || field === 'elem') {
            rec[field] = String(raw);
          }
        }
      }
    }
    return matched.length;
  };

  ctx.command('iterate', (args, kwargs) =>
    runPerAtom(sel0(args[0]), ctx.str(args[1]), kwargs, { writeBack: false }),
  );

  ctx.command('iterate_state', (args, kwargs) => {
    const state = Number(args[0] ?? 1) || 1;
    return runPerAtom(sel0(args[1]), ctx.str(args[2]), kwargs, { writeBack: false, state });
  });

  ctx.command('alter', (args, kwargs) => {
    const n = runPerAtom(sel0(args[0]), ctx.str(args[1]), kwargs, { writeBack: true });
    ctx.publish();
    return n;
  });
}
