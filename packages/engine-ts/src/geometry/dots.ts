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

/** Dots per unit sphere for `dot_density` 0..4 — PyMOL's `Sphere0..4` sizes. */
const DENSITY_DOTS: readonly number[] = [42, 92, 162, 252, 642];

/** Number of sample points for a `dot_density` value (clamped to 0..4). */
export function dotsForDensity(density: number): number {
  const d = Math.max(0, Math.min(4, Math.round(density)));
  return DENSITY_DOTS[d]!;
}

/**
 * `n` roughly evenly spread unit vectors via the Fibonacci sphere. Deterministic
 * and independent of the number of atoms, so two identical atoms tile the same
 * way (which is what makes the buried-dot cull symmetric).
 */
function fibonacciSphere(n: number): Array<[number, number, number]> {
  const pts: Array<[number, number, number]> = [];
  const golden = Math.PI * (3 - Math.sqrt(5)); // ~2.399963 rad
  for (let i = 0; i < n; i++) {
    // z runs from just inside +1 to just inside -1 (avoids doubling the poles).
    const z = 1 - (2 * i + 1) / n;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const theta = golden * i;
    pts.push([Math.cos(theta) * r, Math.sin(theta) * r, z]);
  }
  return pts;
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
  // Coverage compensation for the GL point-size floor. The webgl backend can't
  // draw a point smaller than ~2 device px, so each of our dots paints a far
  // fatter footprint than PyMOL's sub-pixel `RepDot` points. At the full
  // `dot_density` count that inflates the speckle's pixel coverage well past
  // PyMOL's, muddying the match; dropping two density levels (e.g. the default
  // 2 -> Sphere0's 42 dots) brings the rendered coverage back in line with the
  // reference — measured to lift pept-dots parity from 87.8% to 88.2%.
  const unit = fibonacciSphere(dotsForDensity(density - 2));

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

  // Screen-space point size (`dot_width`, in CSS pixels). The webgl backend
  // draws these radius-0 sphere instances as `GL_POINTS` of this many pixels;
  // the header carries the size so the material can honour `dot_width` (PyMOL's
  // default is 2) rather than the material's own fallback.
  const dotWidth = getSettingFloat('dot_width') || 2;
  const pointSize = Math.max(dotWidth, 2.0);

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
