/**
 * Shared helper: build a Mode-G `line`-instance frame for a wireframe box (used
 * by the `extent` bounding box and the `cell` unit-cell reps). The 12 edges are
 * emitted as line instances, which the viewport already draws.
 */

import {
  INSTANCE_ITEM_SIZE,
  type BufferRef,
  type CgoDrawArraysHeader,
  type InstanceBuffer,
  type RepId,
} from '@tenmol/protocol';
import { PayloadBuilder, encode } from './payload';

export type Vec3 = [number, number, number];

const PLACEHOLDER: BufferRef = { byteOffset: 0, byteLength: 0, dtype: 'f32', itemSize: 1 };

/** The 12 edges of a box given its 8 corners (indexed as a unit cube). */
export function boxEdgesFromCorners(c: Vec3[]): Array<[Vec3, Vec3]> {
  const E: Array<[number, number]> = [
    [0, 1], [1, 3], [3, 2], [2, 0], // bottom face (z=0)
    [4, 5], [5, 7], [7, 6], [6, 4], // top face (z=1)
    [0, 4], [1, 5], [2, 6], [3, 7], // verticals
  ];
  return E.map(([a, b]) => [c[a]!, c[b]!] as [Vec3, Vec3]);
}

/** Corners of an axis-aligned box from its min/max, ordered as a unit cube. */
export function aabbCorners(min: Vec3, max: Vec3): Vec3[] {
  return [
    [min[0], min[1], min[2]],
    [max[0], min[1], min[2]],
    [min[0], max[1], min[2]],
    [max[0], max[1], min[2]],
    [min[0], min[1], max[2]],
    [max[0], min[1], max[2]],
    [min[0], max[1], max[2]],
    [max[0], max[1], max[2]],
  ];
}

/** Encode a wireframe box as a `line`-instance frame for `rep`. */
export function buildBoxFrame(
  object: string,
  state: number,
  seq: number,
  rep: RepId,
  edges: Array<[Vec3, Vec3]>,
  rgb: readonly [number, number, number],
): ArrayBuffer | null {
  if (edges.length === 0) return null;
  const n = INSTANCE_ITEM_SIZE.line; // 14
  const count = edges.length;
  const data = new Float32Array(count * n);
  const atom = new Int32Array(count).fill(-1);
  for (let k = 0; k < count; k++) {
    const [a, b] = edges[k]!;
    const o = k * n;
    data[o] = a[0]; data[o + 1] = a[1]; data[o + 2] = a[2];
    data[o + 3] = b[0]; data[o + 4] = b[1]; data[o + 5] = b[2];
    data[o + 6] = rgb[0]; data[o + 7] = rgb[1]; data[o + 8] = rgb[2]; data[o + 9] = 1;
    data[o + 10] = rgb[0]; data[o + 11] = rgb[1]; data[o + 12] = rgb[2]; data[o + 13] = 1;
  }
  const pb = new PayloadBuilder();
  const inst: InstanceBuffer = { kind: 'line', count, itemSize: n, data: PLACEHOLDER };
  pb.addF32(data, n, (ref) => (inst.data = ref));
  pb.addI32(atom, 1, (ref) => (inst.atom = ref));
  const payload = pb.build();
  const header: CgoDrawArraysHeader = {
    v: 1,
    kind: 'cgo-draw-arrays',
    seq,
    payloadBytes: payload.byteLength,
    object,
    state,
    rep,
    blocks: [],
    instances: [inst],
  };
  return encode(header, payload);
}
