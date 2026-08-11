/**
 * Mode-G geometry for the `cartoon` representation.
 *
 * Cartoon is a triangulated ribbon/tube through the backbone, its cross-section
 * chosen by secondary structure (`atom.ss`, assigned by `dss`): a flat arrowed
 * ribbon for strands ('S'), a wide flat helix ribbon for 'H', a thin tube for
 * loops. It is emitted as an `indexed-mesh` frame (position/normal/color/index),
 * which the viewport already draws with its lit triangle-mesh material — so no
 * renderer changes are needed, only this geometry builder.
 *
 * The path is a Catmull-Rom spline through each chain's ordered Cα atoms,
 * sampled `SAMPLES_PER_SEGMENT` times per residue segment. A smooth coordinate
 * frame is carried along the spline by parallel transport (no carbonyl needed),
 * and a fixed 8-point cross-section is extruded along it: a rectangle for
 * helix/strand (strands tapering to an arrowhead at the C-terminal end) and a
 * thin circle for loops. Each vertex is coloured by its residue's Cα colour and
 * tagged with that Cα's atom id (so `geometryFrameProblems` — which requires the
 * per-vertex `atom` mapping — passes).
 */

import {
  Rep,
  type BufferRef,
  type IndexedMeshHeader,
} from '@tenmol/protocol';
import { repBit } from '../model/atom';
import type { ObjectMolecule } from '../model/molecule';
import { rgbForIndex } from '../exec/color';
import type { RepBuilder } from './registry';
import { PayloadBuilder, encode } from './payload';

/** Sub-samples of the spline per residue segment. Higher = smoother, heavier. */
const SAMPLES_PER_SEGMENT = 8;
/** Points around each extruded cross-section (fixed so rings connect uniformly). */
const CROSS_SECTION_POINTS = 8;
/** Loop tube radius (Å) — PyMOL `cartoon_loop_radius` default is 0.2. */
const DEFAULT_LOOP_RADIUS = 0.2;
/** Helix ribbon half-width along the binormal (full width ≈ 2.4 Å). */
const HELIX_HALF_WIDTH = 1.2;
/**
 * Strand ribbon half-width along the binormal. PyMOL's `ExtrudeRectangle` puts
 * the rectangle corners at `sin(π/4) * cartoon_rect_length`, so the effective
 * half-width is `0.707 * 1.40 ≈ 0.99`, NOT `cartoon_rect_length` itself.
 */
const STRAND_HALF_WIDTH = 0.99;
/** Helix ribbon half-thickness along the normal (full thickness ≈ 0.4 Å). */
const HELIX_HALF_THICKNESS = 0.3;
/**
 * Strand ribbon half-thickness along the normal — `0.707 * cartoon_rect_width`
 * (`0.707 * 0.40 ≈ 0.283`). The β-slab is flat but not paper-thin: its edges
 * catch the light and read as depth, which is why the ray reference shows a
 * shaded rim along each strand. The previous 0.03 collapsed that rim to nothing.
 */
const STRAND_HALF_THICKNESS = 0.283;
/** Strand arrowhead base is this multiple of the strand half-width. */
const ARROW_WIDTH_SCALE = 1.9;

type Vec3 = [number, number, number];

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function len(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}
function norm(a: Vec3): Vec3 {
  const l = len(a);
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}
function addScaled(base: Vec3, v: Vec3, s: number): Vec3 {
  return [base[0] + v[0] * s, base[1] + v[1] * s, base[2] + v[2] * s];
}

/** Catmull-Rom interpolation at parameter `u` in [0,1] between p1 and p2. */
function catmull(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, u: number): Vec3 {
  const u2 = u * u;
  const u3 = u2 * u;
  const out: Vec3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const a = p0[k]!;
    const b = p1[k]!;
    const c = p2[k]!;
    const d = p3[k]!;
    out[k] =
      0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
  }
  return out;
}

/** Rotate `v` around unit axis `k` by angle whose cos/sin are given (Rodrigues). */
function rotate(v: Vec3, k: Vec3, cos: number, sin: number): Vec3 {
  const kv = cross(k, v);
  const kd = dot(k, v) * (1 - cos);
  return [
    v[0] * cos + kv[0] * sin + k[0] * kd,
    v[1] * cos + kv[1] * sin + k[1] * kd,
    v[2] * cos + kv[2] * sin + k[2] * kd,
  ];
}

/** One CA of the ordered backbone: its residue index, position, ss and colour. */
interface CaResidue {
  pos: Vec3;
  ss: string;
  color: number;
  atomId: number;
}

/** A sampled point on the spline plus which residue owns it (for colour/ss/atom). */
interface Sample {
  pos: Vec3;
  res: number;
  /** Fraction 0..1 along this residue's outgoing segment (for arrow taper). */
  u: number;
}

/** Ordered CA residues per chain (in atom-table order), cartoon-visible only. */
function chainsOfCartoonCAs(mol: ObjectMolecule, state: number): CaResidue[][] {
  const bit = repBit(Rep.Cartoon);
  const byChain = new Map<string, CaResidue[]>();
  const order: string[] = [];
  for (let i = 0; i < mol.natom; i++) {
    const a = mol.atoms[i]!;
    if (a.name !== 'CA') continue;
    if ((a.visRep & bit) === 0) continue;
    let list = byChain.get(a.chain);
    if (!list) {
      list = [];
      byChain.set(a.chain, list);
      order.push(a.chain);
    }
    list.push({ pos: mol.coord(i, state), ss: a.ss, color: a.color, atomId: a.id });
  }
  return order.map((c) => byChain.get(c)!);
}

/** Sample the Catmull-Rom spline of one chain's CAs into ordered points. */
function sampleChain(cas: CaResidue[]): Sample[] {
  const n = cas.length;
  const p = (i: number): Vec3 => cas[Math.max(0, Math.min(n - 1, i))]!.pos;
  const out: Sample[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < SAMPLES_PER_SEGMENT; k++) {
      const u = k / SAMPLES_PER_SEGMENT;
      out.push({ pos: catmull(p(i - 1), p(i), p(i + 1), p(i + 2), u), res: i, u });
    }
  }
  // Terminal cap: the last CA exactly.
  out.push({ pos: [...cas[n - 1]!.pos] as Vec3, res: n - 1, u: 0 });
  return out;
}

/** Unit tangents at each sample by central difference along the path. */
function tangents(samples: Sample[]): Vec3[] {
  const n = samples.length;
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const a = samples[Math.max(0, i - 1)]!.pos;
    const b = samples[Math.min(n - 1, i + 1)]!.pos;
    let t = norm(sub(b, a));
    if (len(t) < 0.5) t = [0, 0, 1];
    out.push(t);
  }
  return out;
}

/**
 * Per-residue ribbon normal (the ribbon's THIN direction) derived from the local
 * backbone curvature — the Carson-Bugg CA-only method. For three consecutive Cα
 * the vector (CA_i−CA_{i-1})×(CA_{i+1}−CA_i) is perpendicular to the local peptide
 * plane; it points radially out of a helix and out of a β-sheet, so extruding the
 * flat ribbon with this as its thin axis makes the wide face point the same way
 * PyMOL's does (helix faces spiral outward, strands lie flat). Signs are made
 * consistent along the chain so the ribbon does not flip from residue to residue.
 */
function residueNormals(cas: CaResidue[]): Vec3[] {
  const n = cas.length;
  const raw: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const prev = cas[Math.max(0, i - 1)]!.pos;
    const cur = cas[i]!.pos;
    const next = cas[Math.min(n - 1, i + 1)]!.pos;
    raw.push(cross(sub(cur, prev), sub(next, cur)));
  }
  const out: Vec3[] = [];
  let prevN: Vec3 | null = null;
  for (let i = 0; i < n; i++) {
    let nv = raw[i]!;
    if (len(nv) < 1e-6) {
      nv = prevN ?? [0, 1, 0];
    } else {
      nv = norm(nv);
      if (prevN && dot(nv, prevN) < 0) nv = [-nv[0], -nv[1], -nv[2]];
    }
    out.push(nv);
    prevN = nv;
  }
  return out;
}

/** Parallel-transport frame normals along the tangents (smooth, flip-free). */
function transportNormals(tans: Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  // Seed: any unit vector perpendicular to the first tangent.
  const t0 = tans[0]!;
  const ref: Vec3 = Math.abs(t0[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let prevN = norm(sub(ref, [t0[0] * dot(ref, t0), t0[1] * dot(ref, t0), t0[2] * dot(ref, t0)]));
  out.push(prevN);
  for (let i = 1; i < tans.length; i++) {
    const tp = tans[i - 1]!;
    const tc = tans[i]!;
    const axis = cross(tp, tc);
    const s = len(axis);
    let n: Vec3;
    if (s < 1e-6) {
      n = prevN;
    } else {
      const k = [axis[0] / s, axis[1] / s, axis[2] / s] as Vec3;
      const c = Math.max(-1, Math.min(1, dot(tp, tc)));
      n = rotate(prevN, k, c, s);
    }
    // Re-orthogonalise against the current tangent to fight drift.
    n = norm(sub(n, [tc[0] * dot(n, tc), tc[1] * dot(n, tc), tc[2] * dot(n, tc)]));
    out.push(n);
    prevN = n;
  }
  return out;
}

/** 2-D cross-section boundary (CCW) and its outward per-point normals. */
function crossSection(shape: 'rect' | 'circle', hw: number, ht: number): {
  pts: [number, number][];
  nrm: [number, number][];
} {
  const pts: [number, number][] = [];
  if (shape === 'circle') {
    for (let k = 0; k < CROSS_SECTION_POINTS; k++) {
      const a = (k / CROSS_SECTION_POINTS) * Math.PI * 2;
      pts.push([Math.cos(a) * hw, Math.sin(a) * ht]);
    }
  } else {
    // Rectangle: 4 corners + 4 edge midpoints, CCW.
    pts.push(
      [hw, -ht],
      [hw, 0],
      [hw, ht],
      [0, ht],
      [-hw, ht],
      [-hw, 0],
      [-hw, -ht],
      [0, -ht],
    );
  }
  // Outward vertex normals = average of adjacent edge normals ((dy,-dx) for CCW).
  const c = pts.length;
  const nrm: [number, number][] = [];
  for (let k = 0; k < c; k++) {
    const prev = pts[(k - 1 + c) % c]!;
    const cur = pts[k]!;
    const next = pts[(k + 1) % c]!;
    const e0: [number, number] = [cur[0] - prev[0], cur[1] - prev[1]];
    const e1: [number, number] = [next[0] - cur[0], next[1] - cur[1]];
    const n0: [number, number] = [e0[1], -e0[0]];
    const n1: [number, number] = [e1[1], -e1[0]];
    let nx = n0[0] + n1[0];
    let ny = n0[1] + n1[1];
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    nrm.push([nx, ny]);
  }
  return { pts, nrm };
}

/**
 * Build the `cartoon` indexed-mesh frame for one object/state, or `null` when no
 * Cα carries the cartoon rep (or no chain has ≥2 such CAs to spline through).
 */
export const buildCartoonFrame: RepBuilder = ({ mol, state, seq, getSettingFloat }) => {
  const chains = chainsOfCartoonCAs(mol, state);
  if (chains.length === 0) return null;

  const loopRadius = getSettingFloat('cartoon_loop_radius') || DEFAULT_LOOP_RADIUS;

  const position: number[] = [];
  const normal: number[] = [];
  const color: number[] = [];
  const atom: number[] = [];
  const index: number[] = [];

  for (const cas of chains) {
    if (cas.length < 2) continue;
    const nRes = cas.length;
    const samples = sampleChain(cas);
    const tans = tangents(samples);
    const transportN = transportNormals(tans);
    const resN = residueNormals(cas);
    // Per-sample thin-axis normal: interpolate the curvature normals of the two
    // residues this sample bridges, then project off the tangent. Fall back to
    // the smooth parallel-transport normal wherever the curvature is degenerate
    // (straight runs), so caps and colinear stretches stay artefact-free.
    const nrms: Vec3[] = samples.map((s, si) => {
      const r0 = resN[s.res]!;
      const r1 = resN[Math.min(nRes - 1, s.res + 1)]!;
      const w = s.u;
      const nv: Vec3 = [
        r0[0] * (1 - w) + r1[0] * w,
        r0[1] * (1 - w) + r1[1] * w,
        r0[2] * (1 - w) + r1[2] * w,
      ];
      const t = tans[si]!;
      // `nv` is the curvature binormal; the ribbon's thin axis is the Frenet
      // normal (radial for a helix, in-plane for a strand) = tangent × binormal.
      const frenet = cross(t, nv);
      return len(frenet) < 1e-3 ? transportN[si]! : norm(frenet);
    });

    const isArrowRes = (r: number): boolean =>
      cas[r]!.ss === 'S' && (r + 1 >= nRes || cas[r + 1]!.ss !== 'S');

    // Emit one ring of CROSS_SECTION_POINTS vertices per sample.
    const ringBase: number[] = [];
    for (let si = 0; si < samples.length; si++) {
      const s = samples[si]!;
      const ca = cas[s.res]!;
      const tan = tans[si]!;
      const nrm = nrms[si]!;
      const bnm = norm(cross(tan, nrm));

      let shape: 'rect' | 'circle';
      let hw: number;
      let ht: number;
      if (ca.ss === 'H' || ca.ss === 'S') {
        shape = 'rect';
        ht = ca.ss === 'S' ? STRAND_HALF_THICKNESS : HELIX_HALF_THICKNESS;
        if (ca.ss === 'S' && isArrowRes(s.res)) {
          // Taper from a wide base at the residue to a point at the next.
          hw = STRAND_HALF_WIDTH * ARROW_WIDTH_SCALE * (1 - s.u) + 0.02;
        } else {
          hw = ca.ss === 'S' ? STRAND_HALF_WIDTH : HELIX_HALF_WIDTH;
        }
      } else {
        shape = 'circle';
        hw = loopRadius;
        ht = loopRadius;
      }

      const { pts, nrm: n2 } = crossSection(shape, hw, ht);
      const [cr, cg, cb] = rgbForIndex(ca.color);
      ringBase.push(position.length / 3);
      for (let k = 0; k < CROSS_SECTION_POINTS; k++) {
        const [a2, b2] = pts[k]!;
        const [na, nb] = n2[k]!;
        const pos = addScaled(addScaled(s.pos, bnm, a2), nrm, b2);
        const nvec = norm([
          bnm[0] * na + nrm[0] * nb,
          bnm[1] * na + nrm[1] * nb,
          bnm[2] * na + nrm[2] * nb,
        ]);
        position.push(pos[0], pos[1], pos[2]);
        normal.push(nvec[0], nvec[1], nvec[2]);
        color.push(cr, cg, cb, 1);
        atom.push(ca.atomId);
      }
    }

    // Connect consecutive rings into a tube of quads (two triangles each).
    const C = CROSS_SECTION_POINTS;
    for (let si = 0; si < samples.length - 1; si++) {
      const a0 = ringBase[si]!;
      const b0 = ringBase[si + 1]!;
      for (let k = 0; k < C; k++) {
        const kn = (k + 1) % C;
        const a = a0 + k;
        const b = a0 + kn;
        const c = b0 + kn;
        const d = b0 + k;
        index.push(a, b, c, a, c, d);
      }
    }
  }

  const verts = position.length / 3;
  const tris = index.length / 3;
  if (verts === 0 || tris === 0) return null;

  const builder = new PayloadBuilder();
  const buffers: IndexedMeshHeader['buffers'] = { position: PLACEHOLDER };
  builder.addF32(Float32Array.from(position), 3, (ref) => (buffers.position = ref));
  builder.addF32(Float32Array.from(normal), 3, (ref) => (buffers.normal = ref));
  builder.addF32(Float32Array.from(color), 4, (ref) => (buffers.color = ref));
  builder.addU32(Uint32Array.from(index), 3, (ref) => (buffers.index = ref));
  builder.addI32(Int32Array.from(atom), 1, (ref) => (buffers.atom = ref));
  const payload = builder.build();

  const header: IndexedMeshHeader = {
    v: 1,
    kind: 'indexed-mesh',
    seq,
    payloadBytes: payload.byteLength,
    object: mol.name,
    state,
    rep: Rep.Cartoon,
    counts: { verts, tris },
    buffers,
    proximity: false,
    oneColor: null,
  };
  return encode(header, payload);
};

/** Filled in by the builder; never read before assignment. */
const PLACEHOLDER: BufferRef = { byteOffset: 0, byteLength: 0, dtype: 'f32', itemSize: 3 };
