/**
 * Mode-G geometry for the `mesh` representation — the molecular surface drawn as
 * a wireframe. It reuses the SAME {@link generateSurface} generator as `surface`,
 * then emits the triangulation's EDGES (deduplicated) as `line` instances, which
 * the viewport already draws. Each edge is coloured by its two endpoint vertex
 * colours (matching PyMOL's per-vertex surface colouring on the wire).
 */

import {
  Rep,
  INSTANCE_ITEM_SIZE,
  type BufferRef,
  type CgoDrawArraysHeader,
  type InstanceBuffer,
} from '@tenmol/protocol';
import { repBit } from '../model/atom';
import { PayloadBuilder, encode } from './payload';
import type { RepBuilder } from './registry';
import { generateSurface, DEFAULT_PROBE } from './surface_gen';

/** Filled in by the builder; never read before assignment. */
const PLACEHOLDER: BufferRef = { byteOffset: 0, byteLength: 0, dtype: 'f32', itemSize: 1 };

/**
 * Build the `mesh` frame for one object/state, or `null` when no atom carries
 * the mesh rep (or the generated surface is empty).
 */
export const buildMeshFrame: RepBuilder = ({ mol, state, seq, getSettingFloat }) => {
  const probe = getSettingFloat('solvent_radius') || DEFAULT_PROBE;
  const surf = generateSurface(mol, state, repBit(Rep.Mesh), { probe });
  if (!surf) return null;

  const { positions, colors, indices, atoms } = surf;
  const nVerts = atoms.length;

  // Dedupe the undirected triangle edges: key each by its ordered vertex pair.
  const seen = new Set<number>();
  const edges: Array<[number, number]> = [];
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]!;
    const b = indices[t + 1]!;
    const c = indices[t + 2]!;
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ] as Array<[number, number]>) {
      const lo = Math.min(u, v);
      const hi = Math.max(u, v);
      const key = lo * nVerts + hi;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([lo, hi]);
    }
  }

  const count = edges.length;
  if (count === 0) return null;

  const n = INSTANCE_ITEM_SIZE.line; // 14: v1[3], v2[3], rgba1[4], rgba2[4]
  const data = new Float32Array(count * n);
  const atom = new Int32Array(count);
  for (let e = 0; e < count; e++) {
    const [i, j] = edges[e]!;
    const o = e * n;
    const pi = i * 3;
    const pj = j * 3;
    const ci = i * 4;
    const cj = j * 4;
    data[o] = positions[pi]!;
    data[o + 1] = positions[pi + 1]!;
    data[o + 2] = positions[pi + 2]!;
    data[o + 3] = positions[pj]!;
    data[o + 4] = positions[pj + 1]!;
    data[o + 5] = positions[pj + 2]!;
    data[o + 6] = colors[ci]!;
    data[o + 7] = colors[ci + 1]!;
    data[o + 8] = colors[ci + 2]!;
    data[o + 9] = colors[ci + 3]!;
    data[o + 10] = colors[cj]!;
    data[o + 11] = colors[cj + 1]!;
    data[o + 12] = colors[cj + 2]!;
    data[o + 13] = colors[cj + 3]!;
    atom[e] = atoms[i]!;
  }

  const builder = new PayloadBuilder();
  const inst: InstanceBuffer = { kind: 'line', count, itemSize: n, data: PLACEHOLDER };
  builder.addF32(data, n, (ref) => (inst.data = ref));
  builder.addI32(atom, 1, (ref) => (inst.atom = ref));
  const payload = builder.build();

  const header: CgoDrawArraysHeader = {
    v: 1,
    kind: 'cgo-draw-arrays',
    seq,
    payloadBytes: payload.byteLength,
    object: mol.name,
    state,
    rep: Rep.Mesh,
    blocks: [],
    instances: [inst],
  };
  return encode(header, payload);
};
