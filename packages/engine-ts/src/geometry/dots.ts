/**
 * Mode-G geometry for the `dots` representation — the molecular dot surface.
 *
 * PyMOL's `RepDot` (`packages/engine/layer2/RepDot.cpp`): for every dots-flagged
 * atom it lays a roughly even set of points on the atom's probe sphere, then
 * drops every point that falls *inside* another atom's sphere, leaving only the
 * exposed surface. Two knobs steer it:
 *
 *   - `dot_solvent` (default off): off ⇒ the van-der-Waals dot surface (sphere
 *     radius = vdw); on ⇒ the solvent-accessible surface (radius =
 *     vdw + `solvent_radius`, PyMOL's probe).
 *   - `dot_density` (default 2, clamped 0..4): picks how many points tile the
 *     unit sphere, matching PyMOL's five precomputed `Sphere0..Sphere4` records
 *     (42, 92, 162, 252, 642 dots). We reproduce the *counts* with an evenly
 *     spread Fibonacci sphere rather than the exact icosahedral point set — the
 *     surface is visually equivalent and far simpler to derive.
 *
 * The survivors are emitted as `sphere` instances of radius 0 (the viewport
 * draws radius-0 spheres as a point cloud), coloured by and picking-tagged with
 * the owning atom. `Rep.Dot` is in `INSTANCED_ONLY_REPS`, so this MUST stay an
 * instance frame — never tessellation.
 */

import {
  Rep,
  INSTANCE_ITEM_SIZE,
  type BufferRef,
  type CgoDrawArraysHeader,
  type InstanceBuffer,
} from '@tenmol/protocol';
import { repBit } from '../model/atom';
import { rgbForIndex } from '../exec/color';
import { PayloadBuilder, encode } from './payload';
import type { RepBuilder } from './registry';

/**
 * Dots per unit sphere for `dot_density` 0..4 — PyMOL's exact `Sphere_nDot`
 * (`packages/engine/layer0/SphereData.h`): the vertex counts of its icosahedral
 * geodesic spheres, {@link geodesicSphere} level 0..4.
 */
const DENSITY_DOTS: readonly number[] = [12, 42, 162, 642, 2562];

/** Number of sample points for a `dot_density` value (clamped to 0..4). */
export function dotsForDensity(density: number): number {
  const d = Math.max(0, Math.min(4, Math.round(density)));
  return DENSITY_DOTS[d]!;
}

// Icosahedron seed — PyMOL's `start_points`/`icosahedron` (`Sphere.cpp:34-73`).
// tau = t/sqrt(1+t^2), one = 1/sqrt(1+t^2), t = (1+sqrt(5))/2.
const ICOS_TAU = 0.8506508084;
const ICOS_ONE = 0.5257311121;
const ICOS_VERTS: ReadonlyArray<readonly [number, number, number]> = [
  [ICOS_TAU, ICOS_ONE, 0], [-ICOS_TAU, ICOS_ONE, 0], [-ICOS_TAU, -ICOS_ONE, 0], [ICOS_TAU, -ICOS_ONE, 0],
  [ICOS_ONE, 0, ICOS_TAU], [ICOS_ONE, 0, -ICOS_TAU], [-ICOS_ONE, 0, -ICOS_TAU], [-ICOS_ONE, 0, ICOS_TAU],
  [0, ICOS_TAU, ICOS_ONE], [0, -ICOS_TAU, ICOS_ONE], [0, -ICOS_TAU, -ICOS_ONE], [0, ICOS_TAU, -ICOS_ONE],
];
const ICOS_TRIS: ReadonlyArray<readonly [number, number, number]> = [
  [4, 8, 7], [4, 7, 9], [5, 6, 11], [5, 10, 6], [0, 4, 3], [0, 3, 5], [2, 7, 1], [2, 1, 6], [8, 0, 11], [8, 11, 1],
  [9, 10, 3], [9, 2, 10], [8, 4, 0], [11, 0, 5], [4, 9, 3], [5, 3, 10], [7, 8, 1], [6, 1, 11], [7, 2, 9], [6, 10, 2],
];

/**
 * PyMOL's exact dot-sphere tessellation, ported from `MakeDotSphere`
 * (`packages/engine/layer0/Sphere.cpp:390`): start from the 12 icosahedron
 * vertices and 20 faces, then `level` times split every triangle into four by
 * inserting the normalised midpoint of each edge (deduped so a shared edge makes
 * ONE vertex). Level 0..4 yields 12, 42, 162, 642, 2562 unit vectors — the same
 * geodesic point set PyMOL lays on each probe sphere, so our dot cloud sits on
 * PyMOL's dots rather than the spiral a Fibonacci sphere produced.
 */
function geodesicSphere(level: number): Array<[number, number, number]> {
  const L = Math.max(0, Math.min(4, Math.round(level)));
  const verts: Array<[number, number, number]> = ICOS_VERTS.map(([x, y, z]) => {
    const l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  });
  let tris: Array<[number, number, number]> = ICOS_TRIS.map((t) => [t[0], t[1], t[2]]);
  const mids = new Map<number, number>();
  const midpoint = (a: number, b: number): number => {
    const key = a < b ? a * 100000 + b : b * 100000 + a;
    const seen = mids.get(key);
    if (seen !== undefined) return seen;
    const va = verts[a]!;
    const vb = verts[b]!;
    const mx = va[0] + vb[0];
    const my = va[1] + vb[1];
    const mz = va[2] + vb[2];
    const l = Math.hypot(mx, my, mz) || 1;
    const idx = verts.length;
    verts.push([mx / l, my / l, mz / l]);
    mids.set(key, idx);
    return idx;
  };
  for (let c = 0; c < L; c++) {
    const next: Array<[number, number, number]> = [];
    for (const [h, k, l] of tris) {
      const hk = midpoint(h, k);
      const kl = midpoint(k, l);
      const hl = midpoint(h, l);
      next.push([h, hk, hl], [k, kl, hk], [l, hl, kl], [hk, kl, hl]);
    }
    tris = next;
  }
  return verts;
}

/** Filled in by the builder; never read before assignment. */
const PLACEHOLDER: BufferRef = { byteOffset: 0, byteLength: 0, dtype: 'f32', itemSize: 1 };

export const buildDotsFrame: RepBuilder = ({ mol, state, seq, getSettingFloat }) => {
  const bit = repBit(Rep.Dot);
  const flagged: number[] = [];
  for (let i = 0; i < mol.natom; i++) {
    if ((mol.atoms[i]!.visRep & bit) !== 0) flagged.push(i);
  }
  if (flagged.length === 0) return null;

  const dotSolvent = getSettingFloat('dot_solvent') !== 0;
  const probe = dotSolvent ? getSettingFloat('solvent_radius') || 1.4 : 0;
  const density = getSettingFloat('dot_density') || 2;
  // PyMOL's `dot_density` 2 tiles each probe sphere with Sphere2's 162 icosahedral
  // geodesic points; the ray reference is a DENSE, fully-covered dot surface. Use
  // PyMOL's EXACT tessellation (not a Fibonacci spiral) so our dots land on PyMOL's.
  const unit = geodesicSphere(density);

  // Per-atom probe sphere: centre + radius (vdw, plus the solvent probe when on).
  // Precomputed once so the buried-point test is a cheap centre/radius compare.
  const cx: number[] = [];
  const cy: number[] = [];
  const cz: number[] = [];
  const rad: number[] = [];
  for (let i = 0; i < mol.natom; i++) {
    const [x, y, z] = mol.coord(i, state);
    cx.push(x);
    cy.push(y);
    cz.push(z);
    rad.push(mol.vdw(i) + probe);
  }

  // Sample every flagged atom's sphere; keep only points outside every OTHER
  // atom's sphere (the exposed molecular dot surface). `CULL_BIAS` widens each
  // neighbour's cull radius by ~sqrt(1.2)≈0.55 Å², trimming the dots that pile up
  // deep in the crevices where two atoms nearly touch (those seam dots are
  // shaded near-black at grazing angles and only muddy the speckle) — this tracks
  // real PyMOL's cleaner surface far more closely than a raw vdw cull does.
  const CULL_BIAS = 1.2;
  const verts: number[] = [];
  const atomIds: number[] = [];
  // `RepDot::VN`: each dot's model-space normal is the outward unit vector that
  // placed it on the probe sphere. Shipped as an optional sub-buffer so the
  // point material shades the cloud (PyMOL's dots are lit, not flat) — without
  // it our dots read far too bright against the reference.
  const normals: number[] = [];
  for (const i of flagged) {
    const cxi = cx[i]!;
    const cyi = cy[i]!;
    const czi = cz[i]!;
    const ri = rad[i]!;
    const [r, g, b] = rgbForIndex(mol.atoms[i]!.color);
    const id = mol.atoms[i]!.id;
    for (const [ux, uy, uz] of unit) {
      const px = cxi + ux * ri;
      const py = cyi + uy * ri;
      const pz = czi + uz * ri;
      let buried = false;
      for (let j = 0; j < mol.natom; j++) {
        if (j === i) continue;
        const rj = rad[j]!;
        const dx = px - cx[j]!;
        const dy = py - cy[j]!;
        const dz = pz - cz[j]!;
        if (dx * dx + dy * dy + dz * dz < rj * rj + CULL_BIAS) {
          buried = true;
          break;
        }
      }
      if (buried) continue;
      verts.push(px, py, pz, 0, r, g, b, 1);
      normals.push(ux, uy, uz);
      atomIds.push(id);
    }
  }

  // Every dot buried (e.g. a single atom fully swallowed by a larger neighbour):
  // nothing to draw. Emit nothing rather than an empty instance buffer.
  if (atomIds.length === 0) return null;

  const data = new Float32Array(verts);
  const atom = new Int32Array(atomIds);
  const normal = new Float32Array(normals);

  const builder = new PayloadBuilder();
  const inst: InstanceBuffer & { normal?: BufferRef } = {
    kind: 'sphere',
    count: atomIds.length,
    itemSize: INSTANCE_ITEM_SIZE.sphere,
    data: PLACEHOLDER,
  };
  builder.addF32(data, INSTANCE_ITEM_SIZE.sphere, (ref) => (inst.data = ref));
  builder.addI32(atom, 1, (ref) => (inst.atom = ref));
  builder.addF32(normal, 3, (ref) => (inst.normal = ref));
  const payload = builder.build();

  // Screen-space point size, in CSS pixels. The webgl backend draws these
  // radius-0 sphere instances as `GL_POINTS`. PyMOL's `dot_width` is 2, but the
  // ray reference is 2x-oversampled and down-filtered, so each dot lands as a
  // soft ~3-4 px disc, not a hard 2 px square — the antialiased footprint. We
  // size our GL points to that footprint so the cloud's coverage and colour
  // match the ray render instead of reading as a sparse sub-pixel scatter.
  const dotWidth = getSettingFloat('dot_width') || 2;
  const pointSize = Math.max(dotWidth * 2, 4.0);

  const header: CgoDrawArraysHeader & { pointSize: number } = {
    v: 1,
    kind: 'cgo-draw-arrays',
    seq,
    payloadBytes: payload.byteLength,
    object: mol.name,
    state,
    rep: Rep.Dot,
    blocks: [],
    instances: [inst],
    pointSize,
  };
  return encode(header, payload);
};
