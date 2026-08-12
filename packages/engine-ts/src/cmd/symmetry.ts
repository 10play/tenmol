/**
 * The `symmetry` / crystallography command subsystem.
 *
 * Ports the crystal-symmetry corner of PyMOL: reading and writing a molecule's
 * unit cell (`get_symmetry` / `set_symmetry`, `symmetry_copy`) and generating
 * symmetry mates within a cutoff of a selection (`symexp`, the C
 * `ObjectMoleculeSymexp`).
 *
 * The maths follows the standard PDB/CCP4 convention. From the cell we build the
 * orthogonalisation matrix `M` (fractional -> Cartesian) and its inverse `Minv`
 * (Cartesian -> fractional):
 *
 *   Mx0 = a          Mx1 = b·cosγ      Mx2 = c·cosβ
 *   My0 = 0          My1 = b·sinγ      My2 = c·(cosα − cosβ·cosγ)/sinγ
 *   Mz0 = 0          Mz1 = 0           Mz2 = V/(a·b·sinγ)
 *
 * with cell volume V = a·b·c·√(1 − cos²α − cos²β − cos²γ + 2·cosα·cosβ·cosγ).
 *
 * A symmetry mate is `cart' = M·(R·(Minv·cart) + t + L)`, where `(R, t)` is a
 * space-group operator in fractional coordinates and `L` an integer lattice
 * translation. We embed operator tables for P1, P2₁, P2₁2₁2₁ and C2, and fall
 * back to a bare identity (P1) for anything else.
 */
import type { Json } from '@tenmol/protocol';
import type { RegistrarCtx } from './registrar';
import type { Executive } from '../exec/executive';
import type { AtomInfo } from '../model/atom';
import type { CrystalCell } from '../model/molecule';
import { ObjectMolecule } from '../model/molecule';

/* --------------------------------- linalg -------------------------------- */

type Vec3 = [number, number, number];
/** Row-major 3x3: index = row*3 + col. */
type Mat3 = number[];

function deg2rad(d: number): number {
  return (d * Math.PI) / 180;
}

/** Orthogonalisation matrix `M` (fractional -> Cartesian) for a cell. */
function orthoMatrix(cell: CrystalCell): Mat3 {
  const { a, b, c } = cell;
  const ca = Math.cos(deg2rad(cell.alpha));
  const cb = Math.cos(deg2rad(cell.beta));
  const cg = Math.cos(deg2rad(cell.gamma));
  const sg = Math.sin(deg2rad(cell.gamma));
  const vol = a * b * c * Math.sqrt(Math.max(0, 1 - ca * ca - cb * cb - cg * cg + 2 * ca * cb * cg));
  const m22 = sg === 0 ? 0 : vol / (a * b * sg);
  const m12 = sg === 0 ? 0 : (c * (ca - cb * cg)) / sg;
  return [
    a, b * cg, c * cb,
    0, b * sg, m12,
    0, 0, m22,
  ];
}

/** Inverse of a general 3x3 matrix (row-major). */
function inverse(m: Mat3): Mat3 {
  const a = m[0]!, b = m[1]!, c = m[2]!;
  const d = m[3]!, e = m[4]!, f = m[5]!;
  const g = m[6]!, h = m[7]!, i = m[8]!;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const inv = det === 0 ? 0 : 1 / det;
  return [
    A * inv, (c * h - b * i) * inv, (b * f - c * e) * inv,
    B * inv, (a * i - c * g) * inv, (c * d - a * f) * inv,
    C * inv, (b * g - a * h) * inv, (a * e - b * d) * inv,
  ];
}

/** `m · v` for a row-major 3x3 and a 3-vector. */
function apply(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
    m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2],
    m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2],
  ];
}

/* ---------------------------- space-group table -------------------------- */

interface SymOp {
  R: Mat3;
  t: Vec3;
}

const I3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
/** Diagonal rotation (the only kind these low-symmetry groups need). */
function diag(x: number, y: number, z: number): Mat3 {
  return [x, 0, 0, 0, y, 0, 0, 0, z];
}

const IDENTITY_OPS: SymOp[] = [{ R: I3, t: [0, 0, 0] }];

const P21_OPS: SymOp[] = [
  { R: I3, t: [0, 0, 0] },
  // -x, y+1/2, -z  (unique axis b)
  { R: diag(-1, 1, -1), t: [0, 0.5, 0] },
];

const P212121_OPS: SymOp[] = [
  { R: I3, t: [0, 0, 0] },
  { R: diag(-1, -1, 1), t: [0.5, 0, 0.5] }, // -x+1/2, -y, z+1/2
  { R: diag(-1, 1, -1), t: [0, 0.5, 0.5] }, // -x, y+1/2, -z+1/2
  { R: diag(1, -1, -1), t: [0.5, 0.5, 0] }, // x+1/2, -y+1/2, -z
];

const P2_OPS: SymOp[] = [
  { R: I3, t: [0, 0, 0] }, // x, y, z
  { R: diag(-1, 1, -1), t: [0, 0, 0] }, // -x, y, -z (2-fold along b, No. 3)
];

const C2_OPS: SymOp[] = [
  { R: I3, t: [0, 0, 0] }, // x, y, z
  { R: diag(-1, 1, -1), t: [0, 0, 0] }, // -x, y, -z
  { R: I3, t: [0.5, 0.5, 0] }, // C-centring of the above two
  { R: diag(-1, 1, -1), t: [0.5, 0.5, 0] },
];

/** Operators for a space-group symbol; identity (P1) fallback for the unknown. */
function operatorsFor(spacegroup: string | undefined): SymOp[] {
  const k = (spacegroup ?? 'P1').replace(/\s+/g, '').toUpperCase();
  if (k === 'P21' || k === 'P1211') return P21_OPS;
  if (k === 'P2' || k === 'P121') return P2_OPS;
  if (k === 'P212121') return P212121_OPS;
  if (k === 'C2' || k === 'C121') return C2_OPS;
  return IDENTITY_OPS; // P1 and everything unrecognised
}

/* ------------------------------- helpers --------------------------------- */

/** The molecule a selection refers to: a direct object name, else the object of
 * the first matched atom. */
function resolveMolecule(ex: Executive, sel: string): ObjectMolecule | undefined {
  const direct = ex.molecule(sel);
  if (direct) return direct;
  const first = ex.atomsMatching(sel)[0];
  return first ? ex.molecule(first.objName) : undefined;
}

function cloneAtom(a: AtomInfo): AtomInfo {
  return { ...a, visRep: a.visRep };
}

/* ------------------------------- registrar ------------------------------- */

export function registerSymmetry(ctx: RegistrarCtx): void {
  const ex = ctx.executive;

  /** `cmd.get_symmetry(selection)` -> `[a,b,c,alpha,beta,gamma,spacegroup]`. */
  ctx.command('get_symmetry', (args): Json => {
    const sel = ctx.str(args[0], 'all');
    const mol = resolveMolecule(ex, sel);
    if (!mol || !mol.cell) return null;
    const { a, b, c, alpha, beta, gamma } = mol.cell;
    return [a, b, c, alpha, beta, gamma, mol.spacegroup ?? 'P 1'];
  });

  /** `cmd.set_symmetry(selection, a, b, c, alpha, beta, gamma, spacegroup)`. */
  ctx.command('set_symmetry', (args): Json => {
    const sel = ctx.str(args[0], 'all');
    const mol = resolveMolecule(ex, sel);
    if (!mol) return 0;
    const a = Number(args[1]);
    const b = Number(args[2]);
    const c = Number(args[3]);
    const alpha = Number(args[4]);
    const beta = Number(args[5]);
    const gamma = Number(args[6]);
    if (![a, b, c, alpha, beta, gamma].every((v) => Number.isFinite(v))) return 0;
    mol.cell = { a, b, c, alpha, beta, gamma };
    mol.spacegroup = ctx.str(args[7], mol.spacegroup ?? 'P 1');
    return 1;
  });

  /** `cmd.symmetry_copy(source, target)` — copy cell + space group. */
  ctx.command('symmetry_copy', (args): Json => {
    const src = resolveMolecule(ex, ctx.str(args[0]));
    const dst = resolveMolecule(ex, ctx.str(args[1]));
    if (!src || !dst || !src.cell) return 0;
    dst.cell = { ...src.cell };
    if (src.spacegroup !== undefined) dst.spacegroup = src.spacegroup;
    return 1;
  });

  /** `cmd.get_assembly_ids(...)` — biological-assembly ids (unsupported: []). */
  ctx.command('get_assembly_ids', (): Json => []);

  /**
   * `cmd.symexp(prefix, object, selection, cutoff, segi=0)` — generate every
   * space-group + lattice symmetry mate of `object` that has an atom within
   * `cutoff` Å of `selection`, as a fresh object `prefix##`. Returns the list of
   * names created. The source copy (identity operator, zero translation) is
   * skipped, exactly as PyMOL does.
   */
  ctx.command('symexp', (args): Json => {
    const prefix = ctx.str(args[0], 'sym');
    const objName = ctx.str(args[1]);
    const selection = ctx.str(args[2], objName);
    const cutoff = Number(args[3] ?? 2.0);

    const mol = ex.molecule(objName);
    if (!mol || !mol.cell || mol.natom === 0) return [];
    const cutoff2 = cutoff * cutoff;

    const M = orthoMatrix(mol.cell);
    const Minv = inverse(M);
    // Cartesian lattice basis vectors = columns of M.
    const colA: Vec3 = [M[0]!, M[3]!, M[6]!];
    const colB: Vec3 = [M[1]!, M[4]!, M[7]!];
    const colC: Vec3 = [M[2]!, M[5]!, M[8]!];

    // Selection Cartesian coordinates (state 1) and their fractional extent.
    const selCart: Vec3[] = [];
    const selFmin: Vec3 = [Infinity, Infinity, Infinity];
    const selFmax: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const ua of ex.atomsMatching(selection)) {
      const m = ex.molecule(ua.objName);
      if (!m) continue;
      const cart = m.coord(ua.index, 1) as Vec3;
      selCart.push(cart);
      const f = apply(Minv, cart);
      for (let k = 0; k < 3; k++) {
        if (f[k]! < selFmin[k]!) selFmin[k] = f[k]!;
        if (f[k]! > selFmax[k]!) selFmax[k] = f[k]!;
      }
    }
    if (selCart.length === 0) return [];

    // Fractional coordinates of every object atom in state 1.
    const objFrac: Vec3[] = [];
    for (let i = 0; i < mol.natom; i++) {
      objFrac.push(apply(Minv, mol.coord(i, 1) as Vec3));
    }

    const cf: Vec3 = [cutoff / mol.cell.a, cutoff / mol.cell.b, cutoff / mol.cell.c];
    const ops = operatorsFor(mol.spacegroup);
    const created: string[] = [];
    let counter = 0;

    for (let oi = 0; oi < ops.length; oi++) {
      const op = ops[oi]!;
      // Op-transformed fractional coords (before lattice translation) + extent.
      const tf: Vec3[] = [];
      const tfMin: Vec3 = [Infinity, Infinity, Infinity];
      const tfMax: Vec3 = [-Infinity, -Infinity, -Infinity];
      for (const f of objFrac) {
        const r = apply(op.R, f);
        const v: Vec3 = [r[0]! + op.t[0], r[1]! + op.t[1], r[2]! + op.t[2]];
        tf.push(v);
        for (let k = 0; k < 3; k++) {
          if (v[k]! < tfMin[k]!) tfMin[k] = v[k]!;
          if (v[k]! > tfMax[k]!) tfMax[k] = v[k]!;
        }
      }
      // Lattice-translation window per axis that could bring `tf` within cutoff.
      const lo: Vec3 = [0, 0, 0];
      const hi: Vec3 = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.floor(selFmin[k]! - tfMax[k]! - cf[k]!) - 1;
        hi[k] = Math.ceil(selFmax[k]! - tfMin[k]! + cf[k]!) + 1;
      }

      for (let i = lo[0]; i <= hi[0]; i++) {
        for (let j = lo[1]; j <= hi[1]; j++) {
          for (let k = lo[2]; k <= hi[2]; k++) {
            if (oi === 0 && i === 0 && j === 0 && k === 0) continue; // the source
            const shift: Vec3 = [
              i * colA[0] + j * colB[0] + k * colC[0],
              i * colA[1] + j * colB[1] + k * colC[1],
              i * colA[2] + j * colB[2] + k * colC[2],
            ];
            // Keep the mate iff any of its atoms lies within cutoff of selection.
            let near = false;
            for (let ai = 0; ai < tf.length && !near; ai++) {
              const c = apply(M, tf[ai]!);
              const px = c[0] + shift[0];
              const py = c[1] + shift[1];
              const pz = c[2] + shift[2];
              for (const s of selCart) {
                const dx = px - s[0];
                const dy = py - s[1];
                const dz = pz - s[2];
                if (dx * dx + dy * dy + dz * dz <= cutoff2) {
                  near = true;
                  break;
                }
              }
            }
            if (!near) continue;

            // Materialise the mate: atoms + bonds + cell copied, coords
            // transformed for every state.
            const name = ex.uniqueName(`${prefix}${String(counter).padStart(2, '0')}`);
            counter++;
            const mate = new ObjectMolecule(name);
            for (const atom of mol.atoms) mate.atoms.push(cloneAtom(atom));
            for (const [bi, bj] of mol.bonds) mate.bonds.push([bi, bj]);
            for (let si = 0; si < mol.nstate; si++) {
              const out = new Float32Array(mol.natom * 3);
              for (let ai = 0; ai < mol.natom; ai++) {
                const f = apply(Minv, mol.coord(ai, si + 1) as Vec3);
                const r = apply(op.R, f);
                const c = apply(M, [r[0]! + op.t[0], r[1]! + op.t[1], r[2]! + op.t[2]]);
                out[ai * 3] = c[0] + shift[0];
                out[ai * 3 + 1] = c[1] + shift[1];
                out[ai * 3 + 2] = c[2] + shift[2];
              }
              mate.states.push(out);
            }
            mate.cell = { ...mol.cell };
            if (mol.spacegroup !== undefined) mate.spacegroup = mol.spacegroup;
            ex.addMolecule(mate);
            created.push(name);
          }
        }
      }
    }

    if (created.length > 0) ctx.publish();
    return created;
  });
}
