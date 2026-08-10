/**
 * Mode-G geometry for the `ribbon` representation — a thin smoothed trace
 * through the Cα (and nucleic-acid phosphate) backbone atoms. Emitted as `line`
 * instances (the viewport already draws that instance kind), one per spline
 * sub-segment, coloured by the residue the segment runs through.
 *
 * PyMOL's `RepRibbon` walks the backbone trace of each chain, fits a smooth
 * curve through the guide atoms (Cα for protein, P for nucleic acid) and draws
 * it as a poly-line. We reproduce that by ordering the guide atoms per chain (in
 * load order, which is the trace order for a well-formed structure), fitting a
 * Catmull-Rom spline through them, sampling several sub-segments per residue
 * span, and emitting each consecutive sample pair as a `line` instance.
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

/** Sub-segments emitted per residue span; >1 so the curve is visibly smoothed. */
const SAMPLES_PER_SPAN = 8;

/** Guide-atom names for the backbone trace (protein Cα, nucleic-acid P). */
const GUIDE_NAMES = new Set(['CA', 'P']);

/** Filled in by the builder; never read before assignment. */
const PLACEHOLDER: BufferRef = { byteOffset: 0, byteLength: 0, dtype: 'f32', itemSize: 1 };

interface Guide {
  /** 0-based atom index. */
  i: number;
  pos: [number, number, number];
  rgb: readonly [number, number, number];
  id: number;
}

/** Catmull-Rom interpolation of one coordinate component at parameter t∈[0,1]. */
function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

function point(a: Guide, b: Guide, c: Guide, d: Guide, t: number): [number, number, number] {
  return [
    catmull(a.pos[0], b.pos[0], c.pos[0], d.pos[0], t),
    catmull(a.pos[1], b.pos[1], c.pos[1], d.pos[1], t),
    catmull(a.pos[2], b.pos[2], c.pos[2], d.pos[2], t),
  ];
}

/**
 * Build the `ribbon` frame for one object/state, or `null` when no atom carries
 * the ribbon rep (or no chain has enough guide atoms to trace).
 */
export const buildRibbonFrame: RepBuilder = ({ mol, state, seq }) => {
  const bit = repBit(Rep.Ribbon);

  // Group ribbon-flagged guide atoms by chain, preserving load order (the
  // backbone trace order for a well-formed structure).
  const chains = new Map<string, Guide[]>();
  for (let i = 0; i < mol.natom; i++) {
    const atom = mol.atoms[i]!;
    if ((atom.visRep & bit) === 0) continue;
    if (!GUIDE_NAMES.has(atom.name)) continue;
    let list = chains.get(atom.chain);
    if (!list) {
      list = [];
      chains.set(atom.chain, list);
    }
    list.push({ i, pos: mol.coord(i, state), rgb: rgbForIndex(atom.color), id: atom.id });
  }

  // Emit one line per consecutive spline-sample pair.
  const verts: number[] = [];
  const cols: number[] = [];
  const atomIdx: number[] = [];

  for (const guides of chains.values()) {
    const m = guides.length;
    if (m < 2) continue; // a single guide atom traces nothing

    // Build the smoothed poly-line: for each span [k, k+1] sample the
    // Catmull-Rom curve, using clamped neighbours at the ends.
    const pts: Array<[number, number, number]> = [];
    const ptCol: Array<readonly [number, number, number]> = [];
    const ptAtom: number[] = [];
    for (let k = 0; k < m - 1; k++) {
      const p0 = guides[k - 1] ?? guides[k]!;
      const p1 = guides[k]!;
      const p2 = guides[k + 1]!;
      const p3 = guides[k + 2] ?? guides[k + 1]!;
      // Include t=0 only for the first span; later spans reuse the previous
      // span's endpoint so the poly-line is continuous with no dupes.
      const startStep = k === 0 ? 0 : 1;
      for (let s = startStep; s <= SAMPLES_PER_SPAN; s++) {
        const t = s / SAMPLES_PER_SPAN;
        pts.push(point(p0, p1, p2, p3, t));
        // Colour/pick the span by its start residue (p1), matching PyMOL's
        // per-guide-atom ribbon colouring.
        ptCol.push(p1.rgb);
        ptAtom.push(p1.id);
      }
    }

    for (let s = 0; s < pts.length - 1; s++) {
      const a = pts[s]!;
      const b = pts[s + 1]!;
      const c1 = ptCol[s]!;
      const c2 = ptCol[s + 1]!;
      verts.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      cols.push(c1[0], c1[1], c1[2], 1, c2[0], c2[1], c2[2], 1);
      atomIdx.push(ptAtom[s]!);
    }
  }

  const count = atomIdx.length;
  if (count === 0) return null;

  const n = INSTANCE_ITEM_SIZE.line; // 14: v1[3], v2[3], rgba1[4], rgba2[4]
  const data = new Float32Array(count * n);
  const atom = new Int32Array(count);
  for (let k = 0; k < count; k++) {
    const o = k * n;
    const vo = k * 6;
    const co = k * 8;
    data[o] = verts[vo]!;
    data[o + 1] = verts[vo + 1]!;
    data[o + 2] = verts[vo + 2]!;
    data[o + 3] = verts[vo + 3]!;
    data[o + 4] = verts[vo + 4]!;
    data[o + 5] = verts[vo + 5]!;
    data[o + 6] = cols[co]!;
    data[o + 7] = cols[co + 1]!;
    data[o + 8] = cols[co + 2]!;
    data[o + 9] = cols[co + 3]!;
    data[o + 10] = cols[co + 4]!;
    data[o + 11] = cols[co + 5]!;
    data[o + 12] = cols[co + 6]!;
    data[o + 13] = cols[co + 7]!;
    atom[k] = atomIdx[k]!;
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
    rep: Rep.Ribbon,
    blocks: [],
    instances: [inst],
  };
  return encode(header, payload);
};
