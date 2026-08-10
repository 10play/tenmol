/**
 * Mode-G geometry for the `ellipsoids` representation — thermal (ADP) ellipsoids.
 *
 * Each ellipsoid is a `sphere`-style impostor emitted as an `ellipsoid` instance
 * (16 floats: center[3], m[9] column-major, rgba[4]) where the 3x3 block `m`'s
 * columns are the principal axes scaled by the semi-axis lengths — i.e.
 * `A = V·diag(L1,L2,L3)` with `V` the orthonormal eigenvectors of the atom's
 * ADP U matrix and `Li = scale·sqrt(λi)`. Atoms without an ANISOU record fall
 * back to an isotropic sphere from the B-factor. The viewport ray-traces the
 * quadric directly (it already has the ellipsoid material).
 */

import {
  Rep,
  INSTANCE_ITEM_SIZE,
  type BufferRef,
  type CgoDrawArraysHeader,
  type InstanceBuffer,
} from '@tenmol/protocol';
import { repBit } from '../model/atom';
import type { ObjectMolecule } from '../model/molecule';
import { rgbForIndex } from '../exec/color';
import { PayloadBuilder, encode } from './payload';

const PLACEHOLDER: BufferRef = { byteOffset: 0, byteLength: 0, dtype: 'f32', itemSize: 1 };

type M3 = number[]; // row-major 3x3
type V3 = [number, number, number];

/**
 * Jacobi eigendecomposition of a symmetric 3x3 (given as [u11,u22,u33,u12,u13,u23]).
 * Returns eigenvalues and orthonormal eigenvectors (as columns of `vec`, row-major).
 */
function jacobiSym3(u: readonly number[]): { val: V3; vec: M3 } {
  const a: M3 = [u[0]!, u[3]!, u[4]!, u[3]!, u[1]!, u[5]!, u[4]!, u[5]!, u[2]!];
  const v: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 24; sweep++) {
    // Largest off-diagonal magnitude.
    let p = 0, q = 1, max = Math.abs(a[1]!);
    if (Math.abs(a[2]!) > max) { max = Math.abs(a[2]!); p = 0; q = 2; }
    if (Math.abs(a[5]!) > max) { max = Math.abs(a[5]!); p = 1; q = 2; }
    if (max < 1e-12) break;
    const app = a[p * 3 + p]!;
    const aqq = a[q * 3 + q]!;
    const apq = a[p * 3 + q]!;
    const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    // Apply the rotation J^T A J and accumulate V J.
    for (let k = 0; k < 3; k++) {
      const akp = a[k * 3 + p]!;
      const akq = a[k * 3 + q]!;
      a[k * 3 + p] = c * akp - s * akq;
      a[k * 3 + q] = s * akp + c * akq;
    }
    for (let k = 0; k < 3; k++) {
      const apk = a[p * 3 + k]!;
      const aqk = a[q * 3 + k]!;
      a[p * 3 + k] = c * apk - s * aqk;
      a[q * 3 + k] = s * apk + c * aqk;
    }
    for (let k = 0; k < 3; k++) {
      const vkp = v[k * 3 + p]!;
      const vkq = v[k * 3 + q]!;
      v[k * 3 + p] = c * vkp - s * vkq;
      v[k * 3 + q] = s * vkp + c * vkq;
    }
  }
  return { val: [a[0]!, a[4]!, a[8]!], vec: v };
}

/**
 * Build the `ellipsoids` frame for one object/state, or null if no atom carries
 * the ellipsoids rep. `scale` maps a variance to a semi-axis length.
 */
export function buildEllipsoidsFrame(
  mol: ObjectMolecule,
  state: number,
  seq: number,
  scale: number,
): ArrayBuffer | null {
  const bit = repBit(Rep.Ellipsoid);
  const idx: number[] = [];
  for (let i = 0; i < mol.natom; i++) {
    if ((mol.atoms[i]!.visRep & bit) !== 0) idx.push(i);
  }
  if (idx.length === 0) return null;

  const n = INSTANCE_ITEM_SIZE.ellipsoid; // 16
  const data = new Float32Array(idx.length * n);
  const atom = new Int32Array(idx.length);
  const isoFromB = (b: number): number => scale * Math.sqrt(Math.max(b, 1) / (8 * Math.PI * Math.PI));

  for (let k = 0; k < idx.length; k++) {
    const i = idx[k]!;
    const a = mol.atoms[i]!;
    const [cx, cy, cz] = mol.coord(i, state);
    const rgb = rgbForIndex(a.color);
    let col: [V3, V3, V3];
    if (a.u) {
      const { val, vec } = jacobiSym3(a.u);
      // Semi-axis lengths = scale * sqrt(eigenvalue); guard tiny/negative variances.
      const L: V3 = [
        scale * Math.sqrt(Math.max(val[0], 1e-4)),
        scale * Math.sqrt(Math.max(val[1], 1e-4)),
        scale * Math.sqrt(Math.max(val[2], 1e-4)),
      ];
      // Columns of A = V·diag(L): column j = eigenvector j * L[j] (vec is row-major, columns are eigenvectors).
      col = [
        [vec[0]! * L[0], vec[3]! * L[0], vec[6]! * L[0]],
        [vec[1]! * L[1], vec[4]! * L[1], vec[7]! * L[1]],
        [vec[2]! * L[2], vec[5]! * L[2], vec[8]! * L[2]],
      ];
    } else {
      const r = isoFromB(a.b);
      col = [[r, 0, 0], [0, r, 0], [0, 0, r]];
    }
    const o = k * n;
    data[o] = cx; data[o + 1] = cy; data[o + 2] = cz;
    // m column-major: n1, n2, n3.
    data[o + 3] = col[0][0]; data[o + 4] = col[0][1]; data[o + 5] = col[0][2];
    data[o + 6] = col[1][0]; data[o + 7] = col[1][1]; data[o + 8] = col[1][2];
    data[o + 9] = col[2][0]; data[o + 10] = col[2][1]; data[o + 11] = col[2][2];
    data[o + 12] = rgb[0]; data[o + 13] = rgb[1]; data[o + 14] = rgb[2]; data[o + 15] = 1;
    atom[k] = a.id;
  }

  const pb = new PayloadBuilder();
  const inst: InstanceBuffer = { kind: 'ellipsoid', count: idx.length, itemSize: n, data: PLACEHOLDER };
  pb.addF32(data, n, (ref) => (inst.data = ref));
  pb.addI32(atom, 1, (ref) => (inst.atom = ref));
  const payload = pb.build();
  const header: CgoDrawArraysHeader = {
    v: 1,
    kind: 'cgo-draw-arrays',
    seq,
    payloadBytes: payload.byteLength,
    object: mol.name,
    state,
    rep: Rep.Ellipsoid,
    blocks: [],
    instances: [inst],
  };
  return encode(header, payload);
}
