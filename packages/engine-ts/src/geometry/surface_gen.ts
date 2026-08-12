/**
 * Molecular-surface generator shared by the `surface` and `mesh` reps.
 *
 * Given the atoms flagged for either rep (a visRep bit MASK — the union of the
 * surface and mesh bits), it builds a triangle mesh of an approximate solvent
 * surface:
 *
 *   1. A scalar field over a padded axis-aligned grid,
 *          f(p) = min over atoms of ( |p - center_i| - (vdw_i + probe) ),
 *      the solvent-ACCESSIBLE surface (SAS) at f = 0. The SAS is puffy, so the
 *      field is then shifted inward by {@link SES_SHRINK}·probe toward the vdW
 *      surface — a cheap approximation of PyMOL's solvent-EXCLUDED surface
 *      (`RepSurface` / `SurfaceJob`) that markedly improves the visual match.
 *      True probe-rolling of re-entrant saddles is still not modelled (concave
 *      pockets remain approximate), but the level shift removes most of the SAS
 *      puffiness the exact SES lacks.
 *   2. Marching cubes at isolevel 0 (the full 256-case table is embedded below),
 *      with vertices de-duplicated per grid edge so the result is a connected,
 *      closed-ish mesh rather than a triangle soup.
 *   3. Per-vertex normal from the field gradient (central differences of the
 *      analytic field), per-vertex nearest atom → its colour and atom id
 *      (`RepSurface::AT`, the only per-vertex atom mapping PyMOL keeps).
 *
 * The grid is capped at `maxCells` points (default 90³); if the atoms' box would
 * need more, the spacing is coarsened until it fits rather than exploding.
 */

import { repBit } from '../model/atom';
import type { ObjectMolecule } from '../model/molecule';
import { rgbForIndex, type RGB } from '../exec/color';

/** The triangulated surface. Buffer layouts match the indexed-mesh frame. */
export interface SurfaceMesh {
  /** xyz per vertex, `3 * verts` floats. */
  positions: Float32Array;
  /** Unit outward normal per vertex, `3 * verts` floats. */
  normals: Float32Array;
  /** rgba per vertex (a = 1), `4 * verts` floats. */
  colors: Float32Array;
  /** Triangle vertex indices, `3 * tris` uints. */
  indices: Uint32Array;
  /** Nearest-atom id per vertex (PyMOL `id`, 1-based), `verts` ints. */
  atoms: Int32Array;
  /** Grid spacing actually used (after any coarsening). */
  spacing: number;
}

/** Tunables for {@link generateSurface}. */
export interface SurfaceGenOptions {
  /** Solvent probe radius (Å), PyMOL `solvent_radius`. Default 1.4. */
  probe?: number;
  /** Target grid spacing (Å). Default 0.6; coarsened if the box is too large. */
  spacing?: number;
  /** Hard cap on total grid points; spacing coarsens until under it. Default 90³. */
  maxCells?: number;
  /**
   * Apply Taubin surface smoothing (default false). The filled `surface` rep
   * turns it on for an SES-like smooth solid; the `mesh` wireframe turns it on
   * too (over a coarse grid) so the wire follows a smooth blob.
   */
  smooth?: boolean;
  /**
   * Number of Taubin λ|μ smoothing iterations when {@link smooth} is set.
   * Default {@link DEFAULT_SMOOTH_PASSES}. PyMOL's solvent-excluded surface is
   * markedly smoother/more fused than a raw marching-cubes SAS, so the filled
   * `surface` rep raises this to melt away the per-atom bumps.
   */
  smoothPasses?: number;
  /**
   * Number of separable [1,2,1]/4 box-blur passes applied to the SCALAR FIELD
   * before marching cubes (default 0). Unlike Taubin mesh smoothing — which is
   * tangential and volume-preserving, so it cannot fill the concave crevices
   * BETWEEN atoms — a field blur performs isotropic mean-curvature smoothing:
   * it rounds convex per-atom bumps inward AND bulges concave crevices outward,
   * fusing the atoms into the smooth solvent-excluded blob PyMOL renders. The
   * field is first clamped to a narrow signed band so the far-outside sentinels
   * cannot bleed into the zero-crossing region.
   */
  fieldBlur?: number;
  /**
   * Override the inward SES level-shift fraction ({@link SES_SHRINK}); 0 = raw
   * SAS, 1 = the vdW surface. Lets the filled `surface` rep tighten its
   * silhouette independently of the `mesh` wireframe (which keeps the default).
   */
  shrink?: number;
  /**
   * Compute the TRUE solvent-EXCLUDED surface instead of the {@link shrink}
   * approximation. PyMOL's SES (RepSurface `SolventDotNew`/`SurfaceJob`) is the
   * morphological CLOSING of the vdW solid by the probe: `erode(dilate(vdW,probe),
   * probe)`. `dilate(vdW,probe)` is the SAS solid (our raw field ≤ 0); the erosion
   * keeps points whose Euclidean distance to the SAS boundary exceeds the probe,
   * which we get from a grid distance transform. The result carries PyMOL's smooth
   * re-entrant surfaces in concave crevices (which the isotropic shrink+blur only
   * crudely approximates) while leaving the convex contact patches on the atoms.
   * Overrides {@link shrink} and {@link fieldBlur}.
   */
  ses?: boolean;
}

/** PyMOL `solvent_radius` default. */
export const DEFAULT_PROBE = 1.4;
/**
 * SES-approximation inward shift, as a fraction of the probe radius (0 = raw
 * SAS, 1 = the vdW surface). ~0.9 best matches PyMOL's solvent-excluded surface
 * across the visual corpus; the surface reads far less puffy than the SAS.
 */
const SES_SHRINK = 0.9;
/** Default marching-cubes grid spacing (Å). */
export const DEFAULT_SPACING = 0.6;
/** Default Taubin smoothing iterations when {@link SurfaceGenOptions.smooth} is set. */
export const DEFAULT_SMOOTH_PASSES = 3;
/** Default grid-point cap (90³). */
export const DEFAULT_MAX_CELLS = 90 * 90 * 90;

interface SurfAtom {
  x: number;
  y: number;
  z: number;
  /** vdw + probe. */
  r: number;
  color: number;
  id: number;
}

/**
 * Build the surface mesh for every atom whose `visRep` intersects `bitMask`, or
 * `null` when no atom is flagged (so callers can emit no frame).
 */
export function generateSurface(
  mol: ObjectMolecule,
  state: number,
  bitMask: number,
  opts: SurfaceGenOptions = {},
): SurfaceMesh | null {
  const probe = opts.probe ?? DEFAULT_PROBE;
  const maxCells = opts.maxCells ?? DEFAULT_MAX_CELLS;

  // Collect the flagged atoms as (center, radius=vdw+probe).
  const atoms: SurfAtom[] = [];
  for (let i = 0; i < mol.natom; i++) {
    const a = mol.atoms[i];
    if (!a) continue;
    if ((a.visRep & bitMask) === 0) continue;
    const [x, y, z] = mol.coord(i, state);
    atoms.push({ x, y, z, r: mol.vdw(i) + probe, color: a.color, id: a.id });
  }
  if (atoms.length === 0) return null;

  // Raw box over the (vdw+probe) spheres.
  const rawMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const rawMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const a of atoms) {
    rawMin[0] = Math.min(rawMin[0], a.x - a.r);
    rawMin[1] = Math.min(rawMin[1], a.y - a.r);
    rawMin[2] = Math.min(rawMin[2], a.z - a.r);
    rawMax[0] = Math.max(rawMax[0], a.x + a.r);
    rawMax[1] = Math.max(rawMax[1], a.y + a.r);
    rawMax[2] = Math.max(rawMax[2], a.z + a.r);
  }

  // Choose a spacing that keeps the grid under the cell cap, padding by 2 cells
  // so the isosurface never touches the grid boundary (else it would not close).
  let spacing = opts.spacing ?? DEFAULT_SPACING;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let origin: [number, number, number] = [0, 0, 0];
  for (;;) {
    const pad = spacing * 2;
    const lo: [number, number, number] = [rawMin[0] - pad, rawMin[1] - pad, rawMin[2] - pad];
    const hi: [number, number, number] = [rawMax[0] + pad, rawMax[1] + pad, rawMax[2] + pad];
    nx = Math.max(2, Math.ceil((hi[0] - lo[0]) / spacing) + 1);
    ny = Math.max(2, Math.ceil((hi[1] - lo[1]) / spacing) + 1);
    nz = Math.max(2, Math.ceil((hi[2] - lo[2]) / spacing) + 1);
    origin = lo;
    if (nx * ny * nz <= maxCells) break;
    spacing *= 1.3;
  }

  const nxy = nx * ny;
  const gridIdx = (i: number, j: number, k: number): number => i + nx * j + nxy * k;

  // Scalar field, initialised outside (large positive). Each atom writes only
  // its local window (radius r + a couple cells) — correct because f is a min
  // and points beyond every atom's window are genuinely outside (no crossing).
  const field = new Float32Array(nx * ny * nz);
  field.fill(1e9);
  const [ox, oy, oz] = origin;
  const margin = spacing * 2;
  for (const a of atoms) {
    const rr = a.r + margin;
    const i0 = Math.max(0, Math.floor((a.x - rr - ox) / spacing));
    const i1 = Math.min(nx - 1, Math.ceil((a.x + rr - ox) / spacing));
    const j0 = Math.max(0, Math.floor((a.y - rr - oy) / spacing));
    const j1 = Math.min(ny - 1, Math.ceil((a.y + rr - oy) / spacing));
    const k0 = Math.max(0, Math.floor((a.z - rr - oz) / spacing));
    const k1 = Math.min(nz - 1, Math.ceil((a.z + rr - oz) / spacing));
    for (let k = k0; k <= k1; k++) {
      const pz = oz + k * spacing;
      const dz = pz - a.z;
      for (let j = j0; j <= j1; j++) {
        const py = oy + j * spacing;
        const dy = py - a.y;
        const rowBase = nx * j + nxy * k;
        for (let i = i0; i <= i1; i++) {
          const px = ox + i * spacing;
          const dx = px - a.x;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - a.r;
          const idx = i + rowBase;
          if (d < field[idx]!) field[idx] = d;
        }
      }
    }
  }

  if (opts.ses) {
    // TRUE solvent-EXCLUDED surface via morphological closing (see the `ses`
    // option): SES_solid = erode(SAS_solid, probe). Our raw `field` is the SAS:
    // `field ≤ 0` is the dilate(vdW, probe) solid. Erosion keeps the points whose
    // Euclidean distance to the nearest OUTSIDE-of-SAS voxel exceeds the probe —
    // so a rolling probe of that radius fits entirely inside the SAS there. The
    // distance to the boundary is a grid distance transform (edtSquared3d).
    const INF = 1e20;
    const dt = new Float64Array(field.length);
    // Features = the OUTSIDE of the SAS solid (field ≥ 0). dt→squared cell distance.
    for (let i = 0; i < field.length; i++) dt[i] = field[i]! < 0 ? INF : 0;
    edtSquared3d(dt, nx, ny, nz);
    // Rewrite the field as the SES level set: g = probe − distance-to-SAS-boundary.
    // g < 0 inside the SES, g = 0 on the SES surface, g > 0 outside. The convex
    // atom contact patches survive; concave crevices become smooth re-entrant
    // surfaces exactly where a probe of this radius cannot reach.
    for (let i = 0; i < field.length; i++) field[i] = probe - Math.sqrt(dt[i]!) * spacing;
  } else {
    // SES APPROXIMATION (mesh + legacy path): shift the isosurface inward toward
    // the vdW surface. Adding K·probe moves the zero-crossing from `dist = vdw+probe`
    // toward `dist = vdw`. Applied to written cells only (1e9 sentinels stay out).
    const shrink = probe * (opts.shrink ?? SES_SHRINK);
    for (let i = 0; i < field.length; i++) {
      const v = field[i]!;
      if (v < 1e8) field[i] = v + shrink;
    }
    // Optional field-level mean-curvature smoothing: clamp to a narrow signed band
    // (so the sentinels become a finite +band), then run separable [1,2,1]/4 passes
    // to fuse adjacent atoms and fill tight crevices a rolling probe would bridge.
    if (opts.fieldBlur && opts.fieldBlur > 0) {
      const band = spacing * 2;
      for (let i = 0; i < field.length; i++) {
        const v = field[i]!;
        field[i] = v > band ? band : v < -band ? -band : v;
      }
      blurField(field, nx, ny, nz, opts.fieldBlur);
    }
  }

  /** Analytic field value at an arbitrary point (min over atoms of dist − r). */
  const fieldAt = (x: number, y: number, z: number): number => {
    let m = 1e9;
    for (const a of atoms) {
      const dx = x - a.x;
      const dy = y - a.y;
      const dz = z - a.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - a.r;
      if (d < m) m = d;
    }
    return m;
  };

  /**
   * Trilinear sample of the grid `field`. Used for SES-mode normals: the SES field
   * is the distance-transform level set (only defined on the grid), so its gradient
   * — the outward surface normal — must be read from the grid, not from the analytic
   * SAS `fieldAt`. Coordinates are clamped to the interpolable interior.
   */
  const gridSample = (x: number, y: number, z: number): number => {
    let fi = (x - ox) / spacing;
    let fj = (y - oy) / spacing;
    let fk = (z - oz) / spacing;
    if (fi < 0) fi = 0;
    else if (fi > nx - 1) fi = nx - 1;
    if (fj < 0) fj = 0;
    else if (fj > ny - 1) fj = ny - 1;
    if (fk < 0) fk = 0;
    else if (fk > nz - 1) fk = nz - 1;
    const i0 = Math.min(nx - 2, fi | 0);
    const j0 = Math.min(ny - 2, fj | 0);
    const k0 = Math.min(nz - 2, fk | 0);
    const tx = fi - i0;
    const ty = fj - j0;
    const tz = fk - k0;
    const g = (di: number, dj: number, dk: number): number => field[gridIdx(i0 + di, j0 + dj, k0 + dk)]!;
    const c00 = g(0, 0, 0) * (1 - tx) + g(1, 0, 0) * tx;
    const c10 = g(0, 1, 0) * (1 - tx) + g(1, 1, 0) * tx;
    const c01 = g(0, 0, 1) * (1 - tx) + g(1, 0, 1) * tx;
    const c11 = g(0, 1, 1) * (1 - tx) + g(1, 1, 1) * tx;
    const c0 = c00 * (1 - ty) + c10 * ty;
    const c1 = c01 * (1 - ty) + c11 * ty;
    return c0 * (1 - tz) + c1 * tz;
  };

  /** Field sampler for the outward-normal gradient: grid for SES, analytic otherwise. */
  const sampleField = opts.ses ? gridSample : fieldAt;

  /** Nearest atom to a point (argmin of dist − r): its colour and id. */
  const nearest = (x: number, y: number, z: number): { rgb: RGB; id: number } => {
    let best = 1e9;
    let bestA = atoms[0]!;
    for (const a of atoms) {
      const dx = x - a.x;
      const dy = y - a.y;
      const dz = z - a.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - a.r;
      if (d < best) {
        best = d;
        bestA = a;
      }
    }
    return { rgb: rgbForIndex(bestA.color), id: bestA.id };
  };

  // Marching cubes with per-edge vertex dedup.
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const atomsOut: number[] = [];
  const indices: number[] = [];
  const edgeCache = new Map<number, number>();
  const total = nx * ny * nz;
  const h = spacing * 0.5;
  const cornerVal = new Float64Array(8);

  /** Get or create the interpolated vertex on the given cube edge. */
  const vertexForEdge = (i: number, j: number, k: number, edge: number): number => {
    const [ca, cb] = EDGE_CORNERS[edge]!;
    const [ax, ay, az] = CORNER[ca]!;
    const [bx, by, bz] = CORNER[cb]!;
    const gi0 = gridIdx(i + ax, j + ay, k + az);
    const gi1 = gridIdx(i + bx, j + by, k + bz);
    const key = gi0 < gi1 ? gi0 * total + gi1 : gi1 * total + gi0;
    const hit = edgeCache.get(key);
    if (hit !== undefined) return hit;

    const v1 = cornerVal[ca]!;
    const v2 = cornerVal[cb]!;
    const denom = v2 - v1;
    let t = denom === 0 ? 0.5 : -v1 / denom;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;

    const p1x = ox + (i + ax) * spacing;
    const p1y = oy + (j + ay) * spacing;
    const p1z = oz + (k + az) * spacing;
    const p2x = ox + (i + bx) * spacing;
    const p2y = oy + (j + by) * spacing;
    const p2z = oz + (k + bz) * spacing;
    const px = p1x + t * (p2x - p1x);
    const py = p1y + t * (p2y - p1y);
    const pz = p1z + t * (p2z - p1z);

    // Outward normal = normalised gradient of the field (increases outward).
    let gx = sampleField(px + h, py, pz) - sampleField(px - h, py, pz);
    let gy = sampleField(px, py + h, pz) - sampleField(px, py - h, pz);
    let gz = sampleField(px, py, pz + h) - sampleField(px, py, pz - h);
    let gl = Math.sqrt(gx * gx + gy * gy + gz * gz);
    const near = nearest(px, py, pz);
    if (gl < 1e-9) {
      // Degenerate gradient: fall back to the direction from the nearest atom.
      const a = atoms[0]!;
      let bestD = 1e9;
      let ca2 = a;
      for (const at of atoms) {
        const dx = px - at.x;
        const dy = py - at.y;
        const dz = pz - at.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - at.r;
        if (d < bestD) {
          bestD = d;
          ca2 = at;
        }
      }
      gx = px - ca2.x;
      gy = py - ca2.y;
      gz = pz - ca2.z;
      gl = Math.sqrt(gx * gx + gy * gy + gz * gz);
      if (gl < 1e-9) {
        gx = 0;
        gy = 0;
        gz = 1;
        gl = 1;
      }
    }

    const index = atomsOut.length;
    positions.push(px, py, pz);
    normals.push(gx / gl, gy / gl, gz / gl);
    colors.push(near.rgb[0], near.rgb[1], near.rgb[2], 1);
    atomsOut.push(near.id);
    edgeCache.set(key, index);
    return index;
  };

  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let cubeindex = 0;
        for (let c = 0; c < 8; c++) {
          const [dx, dy, dz] = CORNER[c]!;
          const v = field[gridIdx(i + dx, j + dy, k + dz)]!;
          cornerVal[c] = v;
          if (v < 0) cubeindex |= 1 << c;
        }
        const tri = TRI_TABLE[cubeindex]!;
        for (let t = 0; tri[t]! !== -1; t += 3) {
          const a = vertexForEdge(i, j, k, tri[t]!);
          const b = vertexForEdge(i, j, k, tri[t + 1]!);
          const c = vertexForEdge(i, j, k, tri[t + 2]!);
          // Skip accidental degenerate triangles (two edges collapsing to the
          // same grid vertex through the dedup cache).
          if (a === b || b === c || a === c) continue;
          indices.push(a, b, c);
        }
      }
    }
  }

  if (atomsOut.length === 0 || indices.length === 0) return null;

  const verts = atomsOut.length;
  const pos = Float32Array.from(positions);
  const idx = Uint32Array.from(indices);
  let nrm: Float32Array = Float32Array.from(normals);
  if (opts.smooth) {
    // Marching cubes over a coarse grid leaves the surface visibly faceted and
    // SAS-bumpy — a reason it reads unlike desktop PyMOL's smooth solvent-
    // excluded surface. Taubin λ|μ smoothing (a low-pass that alternates a
    // shrinking and an inflating Laplacian step) removes the grid faceting
    // WITHOUT the volume loss plain Laplacian smoothing causes, so the
    // silhouette stays put. Normals are then rebuilt from the smoothed
    // triangles, oriented to agree with the analytic outward gradient (winding
    // alone is ambiguous; the field gradient is unambiguously outward).
    taubinSmooth(pos, idx, verts, opts.smoothPasses ?? DEFAULT_SMOOTH_PASSES);
    nrm = recomputeNormals(pos, idx, verts, nrm);
  }

  return {
    positions: pos,
    normals: nrm,
    colors: Float32Array.from(colors),
    indices: idx,
    atoms: Int32Array.from(atomsOut),
    spacing,
  };
}

/**
 * `passes` separable [1,2,1]/4 box-blur passes over a scalar field on an
 * `nx·ny·nz` grid, in place. Boundary samples clamp to the edge value. Each
 * pass smooths along x, then y, then z, so the kernel stays cheap and separable.
 */
/**
 * In-place 1-D squared Euclidean distance transform of one grid line (Felzenszwalb
 * & Huttenlocher 2012). `f` holds, per sample along the line, 0 at feature samples
 * and a large value elsewhere; on return each entry is the squared distance (in
 * grid units) to the nearest feature along the composed lower envelope of parabolas.
 * `v`/`z`/`d` are scratch buffers of length ≥ n / n+1 reused across lines.
 */
function edt1d(
  f: Float64Array,
  n: number,
  stride: number,
  base: number,
  d: Float64Array,
  v: Int32Array,
  z: Float64Array,
): void {
  for (let i = 0; i < n; i++) d[i] = f[base + i * stride]!;
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (d[q]! + q * q - (d[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k--;
      s = (d[q]! + q * q - (d[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    const dv = q - v[k]!;
    f[base + q * stride] = dv * dv + d[v[k]!]!;
  }
}

/**
 * In-place 3-D squared Euclidean distance transform: on entry `f[idx]` is 0 at
 * feature voxels and a large sentinel elsewhere; on return it is the squared
 * distance (in grid cells) to the nearest feature voxel. Separable — run the 1-D
 * transform along x, then y, then z (Felzenszwalb & Huttenlocher).
 */
function edtSquared3d(f: Float64Array, nx: number, ny: number, nz: number): void {
  const nxy = nx * ny;
  const maxN = Math.max(nx, ny, nz);
  const d = new Float64Array(maxN);
  const v = new Int32Array(maxN);
  const z = new Float64Array(maxN + 1);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++) edt1d(f, nx, 1, nx * j + nxy * k, d, v, z);
  for (let k = 0; k < nz; k++)
    for (let i = 0; i < nx; i++) edt1d(f, ny, nx, i + nxy * k, d, v, z);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) edt1d(f, nz, nxy, i + nx * j, d, v, z);
}

function blurField(field: Float32Array, nx: number, ny: number, nz: number, passes: number): void {
  const nxy = nx * ny;
  const tmp = new Float32Array(field.length);
  for (let p = 0; p < passes; p++) {
    // X.
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        const base = nx * j + nxy * k;
        for (let i = 0; i < nx; i++) {
          const c = field[base + i]!;
          const l = i > 0 ? field[base + i - 1]! : c;
          const r = i < nx - 1 ? field[base + i + 1]! : c;
          tmp[base + i] = 0.25 * l + 0.5 * c + 0.25 * r;
        }
      }
    }
    // Y.
    for (let k = 0; k < nz; k++) {
      for (let i = 0; i < nx; i++) {
        const base = i + nxy * k;
        for (let j = 0; j < ny; j++) {
          const idx = base + nx * j;
          const c = tmp[idx]!;
          const l = j > 0 ? tmp[idx - nx]! : c;
          const r = j < ny - 1 ? tmp[idx + nx]! : c;
          field[idx] = 0.25 * l + 0.5 * c + 0.25 * r;
        }
      }
    }
    // Z.
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const base = i + nx * j;
        for (let k = 0; k < nz; k++) {
          const idx = base + nxy * k;
          const c = field[idx]!;
          const l = k > 0 ? field[idx - nxy]! : c;
          const r = k < nz - 1 ? field[idx + nxy]! : c;
          tmp[idx] = 0.25 * l + 0.5 * c + 0.25 * r;
        }
      }
    }
    field.set(tmp);
  }
}

/**
 * Build vertex → neighbour-vertex adjacency (unique) from a triangle index
 * buffer, as flat CSR arrays so the smoothing loop touches no per-vertex Set.
 */
function buildAdjacency(idx: Uint32Array, verts: number): { off: Uint32Array; nbr: Uint32Array } {
  const seen = new Set<number>();
  const deg = new Uint32Array(verts);
  // Count unique undirected neighbour pairs per vertex.
  const addPair = (a: number, b: number): void => {
    const key = a < b ? a * verts + b : b * verts + a;
    if (seen.has(key)) return;
    seen.add(key);
    deg[a]!++;
    deg[b]!++;
  };
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]!;
    const b = idx[t + 1]!;
    const c = idx[t + 2]!;
    addPair(a, b);
    addPair(b, c);
    addPair(c, a);
  }
  const off = new Uint32Array(verts + 1);
  for (let v = 0; v < verts; v++) off[v + 1] = off[v]! + deg[v]!;
  const nbr = new Uint32Array(off[verts]!);
  const cursor = off.slice(0, verts);
  seen.clear();
  const emit = (a: number, b: number): void => {
    const key = a < b ? a * verts + b : b * verts + a;
    if (seen.has(key)) return;
    seen.add(key);
    nbr[cursor[a]!++] = b;
    nbr[cursor[b]!++] = a;
  };
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]!;
    const b = idx[t + 1]!;
    const c = idx[t + 2]!;
    emit(a, b);
    emit(b, c);
    emit(c, a);
  }
  return { off, nbr };
}

/** One umbrella-Laplacian pass: move each vertex `factor` toward its neighbour centroid. */
function laplacianStep(
  pos: Float32Array,
  off: Uint32Array,
  nbr: Uint32Array,
  verts: number,
  factor: number,
): void {
  const out = new Float32Array(pos.length);
  for (let v = 0; v < verts; v++) {
    const s = off[v]!;
    const e = off[v + 1]!;
    const n = e - s;
    const o = v * 3;
    if (n === 0) {
      out[o] = pos[o]!;
      out[o + 1] = pos[o + 1]!;
      out[o + 2] = pos[o + 2]!;
      continue;
    }
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = s; k < e; k++) {
      const w = nbr[k]! * 3;
      cx += pos[w]!;
      cy += pos[w + 1]!;
      cz += pos[w + 2]!;
    }
    cx /= n;
    cy /= n;
    cz /= n;
    out[o] = pos[o]! + factor * (cx - pos[o]!);
    out[o + 1] = pos[o + 1]! + factor * (cy - pos[o + 1]!);
    out[o + 2] = pos[o + 2]! + factor * (cz - pos[o + 2]!);
  }
  pos.set(out);
}

/** `iterations` Taubin λ|μ passes (near volume-preserving) applied in place. */
function taubinSmooth(
  pos: Float32Array,
  idx: Uint32Array,
  verts: number,
  iterations: number,
): void {
  const { off, nbr } = buildAdjacency(idx, verts);
  const lambda = 0.5;
  const mu = -0.53;
  for (let i = 0; i < iterations; i++) {
    laplacianStep(pos, off, nbr, verts, lambda);
    laplacianStep(pos, off, nbr, verts, mu);
  }
}

/**
 * Area-weighted per-vertex normals from the (smoothed) triangle mesh, each
 * flipped to agree with the outward reference normal for that vertex.
 */
function recomputeNormals(
  pos: Float32Array,
  idx: Uint32Array,
  verts: number,
  outward: Float32Array,
): Float32Array {
  const nrm = new Float32Array(verts * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const ia = idx[t]! * 3;
    const ib = idx[t + 1]! * 3;
    const ic = idx[t + 2]! * 3;
    const ux = pos[ib]! - pos[ia]!;
    const uy = pos[ib + 1]! - pos[ia + 1]!;
    const uz = pos[ib + 2]! - pos[ia + 2]!;
    const vx = pos[ic]! - pos[ia]!;
    const vy = pos[ic + 1]! - pos[ia + 1]!;
    const vz = pos[ic + 2]! - pos[ia + 2]!;
    // Cross product, magnitude ∝ 2*triangle area → area weighting for free.
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    nrm[ia] = nrm[ia]! + nx;
    nrm[ia + 1] = nrm[ia + 1]! + ny;
    nrm[ia + 2] = nrm[ia + 2]! + nz;
    nrm[ib] = nrm[ib]! + nx;
    nrm[ib + 1] = nrm[ib + 1]! + ny;
    nrm[ib + 2] = nrm[ib + 2]! + nz;
    nrm[ic] = nrm[ic]! + nx;
    nrm[ic + 1] = nrm[ic + 1]! + ny;
    nrm[ic + 2] = nrm[ic + 2]! + nz;
  }
  for (let v = 0; v < verts; v++) {
    const o = v * 3;
    const l = Math.hypot(nrm[o]!, nrm[o + 1]!, nrm[o + 2]!);
    if (l > 1e-12) {
      // Flip to the outward reference so the normal points away from the solid.
      const sign =
        nrm[o]! * outward[o]! + nrm[o + 1]! * outward[o + 1]! + nrm[o + 2]! * outward[o + 2]! < 0
          ? -1
          : 1;
      nrm[o] = (sign * nrm[o]!) / l;
      nrm[o + 1] = (sign * nrm[o + 1]!) / l;
      nrm[o + 2] = (sign * nrm[o + 2]!) / l;
    } else {
      nrm[o] = outward[o]!;
      nrm[o + 1] = outward[o + 1]!;
      nrm[o + 2] = outward[o + 2]!;
    }
  }
  return nrm;
}

/** The visRep bit-mask covering both surface reps (surface OR mesh). */
export function surfaceRepMask(): number {
  // Rep.Surface = 2, Rep.Mesh = 8.
  return repBit(2) | repBit(8);
}

/* ------------------------------------------------------------------ *
 * Marching-cubes topology tables (standard Lorensen/Bourke layout)
 * ------------------------------------------------------------------ */

/** Cube-corner offsets, in the ordering the triangle table assumes. */
const CORNER: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];

/** The two corners each of the 12 cube edges connects. */
const EDGE_CORNERS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

/**
 * The full 256-case marching-cubes triangle table. Row `cubeindex` lists the
 * cube edges (0..11), in triples, that form the output triangles, terminated by
 * -1. Verbatim from the canonical Lorensen table (Paul Bourke's polygonise).
 */
const TRI_TABLE: ReadonlyArray<readonly number[]> = [
  [-1],
  [0, 8, 3, -1],
  [0, 1, 9, -1],
  [1, 8, 3, 9, 8, 1, -1],
  [1, 2, 10, -1],
  [0, 8, 3, 1, 2, 10, -1],
  [9, 2, 10, 0, 2, 9, -1],
  [2, 8, 3, 2, 10, 8, 10, 9, 8, -1],
  [3, 11, 2, -1],
  [0, 11, 2, 8, 11, 0, -1],
  [1, 9, 0, 2, 3, 11, -1],
  [1, 11, 2, 1, 9, 11, 9, 8, 11, -1],
  [3, 10, 1, 11, 10, 3, -1],
  [0, 10, 1, 0, 8, 10, 8, 11, 10, -1],
  [3, 9, 0, 3, 11, 9, 11, 10, 9, -1],
  [9, 8, 10, 10, 8, 11, -1],
  [4, 7, 8, -1],
  [4, 3, 0, 7, 3, 4, -1],
  [0, 1, 9, 8, 4, 7, -1],
  [4, 1, 9, 4, 7, 1, 7, 3, 1, -1],
  [1, 2, 10, 8, 4, 7, -1],
  [3, 4, 7, 3, 0, 4, 1, 2, 10, -1],
  [9, 2, 10, 9, 0, 2, 8, 4, 7, -1],
  [2, 10, 9, 2, 9, 7, 2, 7, 3, 7, 9, 4, -1],
  [8, 4, 7, 3, 11, 2, -1],
  [11, 4, 7, 11, 2, 4, 2, 0, 4, -1],
  [9, 0, 1, 8, 4, 7, 2, 3, 11, -1],
  [4, 7, 11, 9, 4, 11, 9, 11, 2, 9, 2, 1, -1],
  [3, 10, 1, 3, 11, 10, 7, 8, 4, -1],
  [1, 11, 10, 1, 4, 11, 1, 0, 4, 7, 11, 4, -1],
  [4, 7, 8, 9, 0, 11, 9, 11, 10, 11, 0, 3, -1],
  [4, 7, 11, 4, 11, 9, 9, 11, 10, -1],
  [9, 5, 4, -1],
  [9, 5, 4, 0, 8, 3, -1],
  [0, 5, 4, 1, 5, 0, -1],
  [8, 5, 4, 8, 3, 5, 3, 1, 5, -1],
  [1, 2, 10, 9, 5, 4, -1],
  [3, 0, 8, 1, 2, 10, 4, 9, 5, -1],
  [5, 2, 10, 5, 4, 2, 4, 0, 2, -1],
  [2, 10, 5, 3, 2, 5, 3, 5, 4, 3, 4, 8, -1],
  [9, 5, 4, 2, 3, 11, -1],
  [0, 11, 2, 0, 8, 11, 4, 9, 5, -1],
  [0, 5, 4, 0, 1, 5, 2, 3, 11, -1],
  [2, 1, 5, 2, 5, 8, 2, 8, 11, 4, 8, 5, -1],
  [10, 3, 11, 10, 1, 3, 9, 5, 4, -1],
  [4, 9, 5, 0, 8, 1, 8, 10, 1, 8, 11, 10, -1],
  [5, 4, 0, 5, 0, 11, 5, 11, 10, 11, 0, 3, -1],
  [5, 4, 8, 5, 8, 10, 10, 8, 11, -1],
  [9, 7, 8, 5, 7, 9, -1],
  [9, 3, 0, 9, 5, 3, 5, 7, 3, -1],
  [0, 7, 8, 0, 1, 7, 1, 5, 7, -1],
  [1, 5, 3, 3, 5, 7, -1],
  [9, 7, 8, 9, 5, 7, 10, 1, 2, -1],
  [10, 1, 2, 9, 5, 0, 5, 3, 0, 5, 7, 3, -1],
  [8, 0, 2, 8, 2, 5, 8, 5, 7, 10, 5, 2, -1],
  [2, 10, 5, 2, 5, 3, 3, 5, 7, -1],
  [7, 9, 5, 7, 8, 9, 3, 11, 2, -1],
  [9, 5, 7, 9, 7, 2, 9, 2, 0, 2, 7, 11, -1],
  [2, 3, 11, 0, 1, 8, 1, 7, 8, 1, 5, 7, -1],
  [11, 2, 1, 11, 1, 7, 7, 1, 5, -1],
  [9, 5, 8, 8, 5, 7, 10, 1, 3, 10, 3, 11, -1],
  [5, 7, 0, 5, 0, 9, 7, 11, 0, 1, 0, 10, 11, 10, 0, -1],
  [11, 10, 0, 11, 0, 3, 10, 5, 0, 8, 0, 7, 5, 7, 0, -1],
  [11, 10, 5, 7, 11, 5, -1],
  [10, 6, 5, -1],
  [0, 8, 3, 5, 10, 6, -1],
  [9, 0, 1, 5, 10, 6, -1],
  [1, 8, 3, 1, 9, 8, 5, 10, 6, -1],
  [1, 6, 5, 2, 6, 1, -1],
  [1, 6, 5, 1, 2, 6, 3, 0, 8, -1],
  [9, 6, 5, 9, 0, 6, 0, 2, 6, -1],
  [5, 9, 8, 5, 8, 2, 5, 2, 6, 3, 2, 8, -1],
  [2, 3, 11, 10, 6, 5, -1],
  [11, 0, 8, 11, 2, 0, 10, 6, 5, -1],
  [0, 1, 9, 2, 3, 11, 5, 10, 6, -1],
  [5, 10, 6, 1, 9, 2, 9, 11, 2, 9, 8, 11, -1],
  [6, 3, 11, 6, 5, 3, 5, 1, 3, -1],
  [0, 8, 11, 0, 11, 5, 0, 5, 1, 5, 11, 6, -1],
  [3, 11, 6, 0, 3, 6, 0, 6, 5, 0, 5, 9, -1],
  [6, 5, 9, 6, 9, 11, 11, 9, 8, -1],
  [5, 10, 6, 4, 7, 8, -1],
  [4, 3, 0, 4, 7, 3, 6, 5, 10, -1],
  [1, 9, 0, 5, 10, 6, 8, 4, 7, -1],
  [10, 6, 5, 1, 9, 7, 1, 7, 3, 7, 9, 4, -1],
  [6, 1, 2, 6, 5, 1, 4, 7, 8, -1],
  [1, 2, 5, 5, 2, 6, 3, 0, 4, 3, 4, 7, -1],
  [8, 4, 7, 9, 0, 5, 0, 6, 5, 0, 2, 6, -1],
  [7, 3, 9, 7, 9, 4, 3, 2, 9, 5, 9, 6, 2, 6, 9, -1],
  [3, 11, 2, 7, 8, 4, 10, 6, 5, -1],
  [5, 10, 6, 4, 7, 2, 4, 2, 0, 2, 7, 11, -1],
  [0, 1, 9, 4, 7, 8, 2, 3, 11, 5, 10, 6, -1],
  [9, 2, 1, 9, 11, 2, 9, 4, 11, 7, 11, 4, 5, 10, 6, -1],
  [8, 4, 7, 3, 11, 5, 3, 5, 1, 5, 11, 6, -1],
  [5, 1, 11, 5, 11, 6, 1, 0, 11, 7, 11, 4, 0, 4, 11, -1],
  [0, 5, 9, 0, 6, 5, 0, 3, 6, 11, 6, 3, 8, 4, 7, -1],
  [6, 5, 9, 6, 9, 11, 4, 7, 9, 7, 11, 9, -1],
  [10, 4, 9, 6, 4, 10, -1],
  [4, 10, 6, 4, 9, 10, 0, 8, 3, -1],
  [10, 0, 1, 10, 6, 0, 6, 4, 0, -1],
  [8, 3, 1, 8, 1, 6, 8, 6, 4, 6, 1, 10, -1],
  [1, 4, 9, 1, 2, 4, 2, 6, 4, -1],
  [3, 0, 8, 1, 2, 9, 2, 4, 9, 2, 6, 4, -1],
  [0, 2, 4, 4, 2, 6, -1],
  [8, 3, 2, 8, 2, 4, 4, 2, 6, -1],
  [10, 4, 9, 10, 6, 4, 11, 2, 3, -1],
  [0, 8, 2, 2, 8, 11, 4, 9, 10, 4, 10, 6, -1],
  [3, 11, 2, 0, 1, 6, 0, 6, 4, 6, 1, 10, -1],
  [6, 4, 1, 6, 1, 10, 4, 8, 1, 2, 1, 11, 8, 11, 1, -1],
  [9, 6, 4, 9, 3, 6, 9, 1, 3, 11, 6, 3, -1],
  [8, 11, 1, 8, 1, 0, 11, 6, 1, 9, 1, 4, 6, 4, 1, -1],
  [3, 11, 6, 3, 6, 0, 0, 6, 4, -1],
  [6, 4, 8, 11, 6, 8, -1],
  [7, 10, 6, 7, 8, 10, 8, 9, 10, -1],
  [0, 7, 3, 0, 10, 7, 0, 9, 10, 6, 7, 10, -1],
  [10, 6, 7, 1, 10, 7, 1, 7, 8, 1, 8, 0, -1],
  [10, 6, 7, 10, 7, 1, 1, 7, 3, -1],
  [1, 2, 6, 1, 6, 8, 1, 8, 9, 8, 6, 7, -1],
  [2, 6, 9, 2, 9, 1, 6, 7, 9, 0, 9, 3, 7, 3, 9, -1],
  [7, 8, 0, 7, 0, 6, 6, 0, 2, -1],
  [7, 3, 2, 6, 7, 2, -1],
  [2, 3, 11, 10, 6, 8, 10, 8, 9, 8, 6, 7, -1],
  [2, 0, 7, 2, 7, 11, 0, 9, 7, 6, 7, 10, 9, 10, 7, -1],
  [1, 8, 0, 1, 7, 8, 1, 10, 7, 6, 7, 10, 2, 3, 11, -1],
  [11, 2, 1, 11, 1, 7, 10, 6, 1, 6, 7, 1, -1],
  [8, 9, 6, 8, 6, 7, 9, 1, 6, 11, 6, 3, 1, 3, 6, -1],
  [0, 9, 1, 11, 6, 7, -1],
  [7, 8, 0, 7, 0, 6, 3, 11, 0, 11, 6, 0, -1],
  [7, 11, 6, -1],
  [7, 6, 11, -1],
  [3, 0, 8, 11, 7, 6, -1],
  [0, 1, 9, 11, 7, 6, -1],
  [8, 1, 9, 8, 3, 1, 11, 7, 6, -1],
  [10, 1, 2, 6, 11, 7, -1],
  [1, 2, 10, 3, 0, 8, 6, 11, 7, -1],
  [2, 9, 0, 2, 10, 9, 6, 11, 7, -1],
  [6, 11, 7, 2, 10, 3, 10, 8, 3, 10, 9, 8, -1],
  [7, 2, 3, 6, 2, 7, -1],
  [7, 0, 8, 7, 6, 0, 6, 2, 0, -1],
  [2, 7, 6, 2, 3, 7, 0, 1, 9, -1],
  [1, 6, 2, 1, 8, 6, 1, 9, 8, 8, 7, 6, -1],
  [10, 7, 6, 10, 1, 7, 1, 3, 7, -1],
  [10, 7, 6, 1, 7, 10, 1, 8, 7, 1, 0, 8, -1],
  [0, 3, 7, 0, 7, 10, 0, 10, 9, 6, 10, 7, -1],
  [7, 6, 10, 7, 10, 8, 8, 10, 9, -1],
  [6, 8, 4, 11, 8, 6, -1],
  [3, 6, 11, 3, 0, 6, 0, 4, 6, -1],
  [8, 6, 11, 8, 4, 6, 9, 0, 1, -1],
  [9, 4, 6, 9, 6, 3, 9, 3, 1, 11, 3, 6, -1],
  [6, 8, 4, 6, 11, 8, 2, 10, 1, -1],
  [1, 2, 10, 3, 0, 11, 0, 6, 11, 0, 4, 6, -1],
  [4, 11, 8, 4, 6, 11, 0, 2, 9, 2, 10, 9, -1],
  [10, 9, 3, 10, 3, 2, 9, 4, 3, 11, 3, 6, 4, 6, 3, -1],
  [8, 2, 3, 8, 4, 2, 4, 6, 2, -1],
  [0, 4, 2, 4, 6, 2, -1],
  [1, 9, 0, 2, 3, 4, 2, 4, 6, 4, 3, 8, -1],
  [1, 9, 4, 1, 4, 2, 2, 4, 6, -1],
  [8, 1, 3, 8, 6, 1, 8, 4, 6, 6, 10, 1, -1],
  [10, 1, 0, 10, 0, 6, 6, 0, 4, -1],
  [4, 6, 3, 4, 3, 8, 6, 10, 3, 0, 3, 9, 10, 9, 3, -1],
  [10, 9, 4, 6, 10, 4, -1],
  [4, 9, 5, 7, 6, 11, -1],
  [0, 8, 3, 4, 9, 5, 11, 7, 6, -1],
  [5, 0, 1, 5, 4, 0, 7, 6, 11, -1],
  [11, 7, 6, 8, 3, 4, 3, 5, 4, 3, 1, 5, -1],
  [9, 5, 4, 10, 1, 2, 7, 6, 11, -1],
  [6, 11, 7, 1, 2, 10, 0, 8, 3, 4, 9, 5, -1],
  [7, 6, 11, 5, 4, 10, 4, 2, 10, 4, 0, 2, -1],
  [3, 4, 8, 3, 5, 4, 3, 2, 5, 10, 5, 2, 11, 7, 6, -1],
  [7, 2, 3, 7, 6, 2, 5, 4, 9, -1],
  [9, 5, 4, 0, 8, 6, 0, 6, 2, 6, 8, 7, -1],
  [3, 6, 2, 3, 7, 6, 1, 5, 0, 5, 4, 0, -1],
  [6, 2, 8, 6, 8, 7, 2, 1, 8, 4, 8, 5, 1, 5, 8, -1],
  [9, 5, 4, 10, 1, 6, 1, 7, 6, 1, 3, 7, -1],
  [1, 6, 10, 1, 7, 6, 1, 0, 7, 8, 7, 0, 9, 5, 4, -1],
  [4, 0, 10, 4, 10, 5, 0, 3, 10, 6, 10, 7, 3, 7, 10, -1],
  [7, 6, 10, 7, 10, 8, 5, 4, 10, 4, 8, 10, -1],
  [6, 9, 5, 6, 11, 9, 11, 8, 9, -1],
  [3, 6, 11, 0, 6, 3, 0, 5, 6, 0, 9, 5, -1],
  [0, 11, 8, 0, 5, 11, 0, 1, 5, 5, 6, 11, -1],
  [6, 11, 3, 6, 3, 5, 5, 3, 1, -1],
  [1, 2, 10, 9, 5, 11, 9, 11, 8, 11, 5, 6, -1],
  [0, 11, 3, 0, 6, 11, 0, 9, 6, 5, 6, 9, 1, 2, 10, -1],
  [11, 8, 5, 11, 5, 6, 8, 0, 5, 10, 5, 2, 0, 2, 5, -1],
  [6, 11, 3, 6, 3, 5, 2, 10, 3, 10, 5, 3, -1],
  [5, 8, 9, 5, 2, 8, 5, 6, 2, 3, 8, 2, -1],
  [9, 5, 6, 9, 6, 0, 0, 6, 2, -1],
  [1, 5, 8, 1, 8, 0, 5, 6, 8, 3, 8, 2, 6, 2, 8, -1],
  [1, 5, 6, 2, 1, 6, -1],
  [1, 3, 6, 1, 6, 10, 3, 8, 6, 5, 6, 9, 8, 9, 6, -1],
  [10, 1, 0, 10, 0, 6, 9, 5, 0, 5, 6, 0, -1],
  [0, 3, 8, 5, 6, 10, -1],
  [10, 5, 6, -1],
  [11, 5, 10, 7, 5, 11, -1],
  [11, 5, 10, 11, 7, 5, 8, 3, 0, -1],
  [5, 11, 7, 5, 10, 11, 1, 9, 0, -1],
  [10, 7, 5, 10, 11, 7, 9, 8, 1, 8, 3, 1, -1],
  [11, 1, 2, 11, 7, 1, 7, 5, 1, -1],
  [0, 8, 3, 1, 2, 7, 1, 7, 5, 7, 2, 11, -1],
  [9, 7, 5, 9, 2, 7, 9, 0, 2, 2, 11, 7, -1],
  [7, 5, 2, 7, 2, 11, 5, 9, 2, 3, 2, 8, 9, 8, 2, -1],
  [2, 5, 10, 2, 3, 5, 3, 7, 5, -1],
  [8, 2, 0, 8, 5, 2, 8, 7, 5, 10, 2, 5, -1],
  [9, 0, 1, 5, 10, 3, 5, 3, 7, 3, 10, 2, -1],
  [9, 8, 2, 9, 2, 1, 8, 7, 2, 10, 2, 5, 7, 5, 2, -1],
  [1, 3, 5, 3, 7, 5, -1],
  [0, 8, 7, 0, 7, 1, 1, 7, 5, -1],
  [9, 0, 3, 9, 3, 5, 5, 3, 7, -1],
  [9, 8, 7, 5, 9, 7, -1],
  [5, 8, 4, 5, 10, 8, 10, 11, 8, -1],
  [5, 0, 4, 5, 11, 0, 5, 10, 11, 11, 3, 0, -1],
  [0, 1, 9, 8, 4, 10, 8, 10, 11, 10, 4, 5, -1],
  [10, 11, 4, 10, 4, 5, 11, 3, 4, 9, 4, 1, 3, 1, 4, -1],
  [2, 5, 1, 2, 8, 5, 2, 11, 8, 4, 5, 8, -1],
  [0, 4, 11, 0, 11, 3, 4, 5, 11, 2, 11, 1, 5, 1, 11, -1],
  [0, 2, 5, 0, 5, 9, 2, 11, 5, 4, 5, 8, 11, 8, 5, -1],
  [9, 4, 5, 2, 11, 3, -1],
  [2, 5, 10, 3, 5, 2, 3, 4, 5, 3, 8, 4, -1],
  [5, 10, 2, 5, 2, 4, 4, 2, 0, -1],
  [3, 10, 2, 3, 5, 10, 3, 8, 5, 4, 5, 8, 0, 1, 9, -1],
  [5, 10, 2, 5, 2, 4, 1, 9, 2, 9, 4, 2, -1],
  [8, 4, 5, 8, 5, 3, 3, 5, 1, -1],
  [0, 4, 5, 1, 0, 5, -1],
  [8, 4, 5, 8, 5, 3, 9, 0, 5, 0, 3, 5, -1],
  [9, 4, 5, -1],
  [4, 11, 7, 4, 9, 11, 9, 10, 11, -1],
  [0, 8, 3, 4, 9, 7, 9, 11, 7, 9, 10, 11, -1],
  [1, 10, 11, 1, 11, 4, 1, 4, 0, 7, 4, 11, -1],
  [3, 1, 4, 3, 4, 8, 1, 10, 4, 7, 4, 11, 10, 11, 4, -1],
  [4, 11, 7, 9, 11, 4, 9, 2, 11, 9, 1, 2, -1],
  [9, 7, 4, 9, 11, 7, 9, 1, 11, 2, 11, 1, 0, 8, 3, -1],
  [11, 7, 4, 11, 4, 2, 2, 4, 0, -1],
  [11, 7, 4, 11, 4, 2, 8, 3, 4, 3, 2, 4, -1],
  [2, 9, 10, 2, 7, 9, 2, 3, 7, 7, 4, 9, -1],
  [9, 10, 7, 9, 7, 4, 10, 2, 7, 8, 7, 0, 2, 0, 7, -1],
  [3, 7, 10, 3, 10, 2, 7, 4, 10, 1, 10, 0, 4, 0, 10, -1],
  [1, 10, 2, 8, 7, 4, -1],
  [4, 9, 1, 4, 1, 7, 7, 1, 3, -1],
  [4, 9, 1, 4, 1, 7, 0, 8, 1, 8, 7, 1, -1],
  [4, 0, 3, 7, 4, 3, -1],
  [4, 8, 7, -1],
  [9, 10, 8, 10, 11, 8, -1],
  [3, 0, 9, 3, 9, 11, 11, 9, 10, -1],
  [0, 1, 10, 0, 10, 8, 8, 10, 11, -1],
  [3, 1, 10, 11, 3, 10, -1],
  [1, 2, 11, 1, 11, 9, 9, 11, 8, -1],
  [3, 0, 9, 3, 9, 11, 1, 2, 9, 2, 11, 9, -1],
  [0, 2, 11, 8, 0, 11, -1],
  [3, 2, 11, -1],
  [2, 3, 8, 2, 8, 10, 10, 8, 9, -1],
  [9, 10, 2, 0, 9, 2, -1],
  [2, 3, 8, 2, 8, 10, 0, 1, 8, 1, 10, 8, -1],
  [1, 10, 2, -1],
  [1, 3, 8, 9, 1, 8, -1],
  [0, 9, 1, -1],
  [0, 3, 8, -1],
  [-1],
];
