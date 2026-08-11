/**
 * Measurement objects — the non-molecule objects `cmd.distance` / `cmd.angle` /
 * `cmd.dihedral` create. Each is a set of dashed line segments (plus the numeric
 * value and a label position); it renders through the `dashes` rep as `line`
 * instances, which the viewport already draws.
 */

import { Rep, INSTANCE_ITEM_SIZE, type BufferRef, type CgoDrawArraysHeader, type InstanceBuffer } from '@tenmol/protocol';
import { rgbForIndex } from './color';
import { PayloadBuilder, encode } from '../geometry/payload';

export type Vec3 = [number, number, number];

export interface MeasurementLabel {
  pos: Vec3;
  text: string;
}

export interface MeasurementObject {
  name: string;
  enabled: boolean;
  /** Colour table index (dash_color / measurement colour). */
  color: number;
  kind: 'distance' | 'angle' | 'dihedral';
  /** Dashed line segments, each an endpoint pair. */
  segments: Array<[Vec3, Vec3]>;
  labels: MeasurementLabel[];
  /** The measured value (Å for distance, degrees for angle/dihedral). */
  value: number;
}

/* ------------------------------ geometry math ------------------------------ */

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const mid = (a: Vec3, b: Vec3): Vec3 => scale(add(a, b), 0.5);

export function distanceOf(a: Vec3, b: Vec3): number {
  return norm(sub(a, b));
}

export function angleOf(a: Vec3, b: Vec3, c: Vec3): number {
  const u = sub(a, b);
  const v = sub(c, b);
  const cosang = dot(u, v) / (norm(u) * norm(v) || 1);
  return (Math.acos(Math.max(-1, Math.min(1, cosang))) * 180) / Math.PI;
}

export function dihedralOf(p1: Vec3, p2: Vec3, p3: Vec3, p4: Vec3): number {
  const b1 = sub(p2, p1);
  const b2 = sub(p3, p2);
  const b3 = sub(p4, p3);
  const n1 = cross(b1, b2);
  const n2 = cross(b2, b3);
  const b2n = scale(b2, 1 / (norm(b2) || 1));
  const m1 = cross(n1, b2n);
  return (Math.atan2(dot(m1, n2), dot(n1, n2)) * 180) / Math.PI;
}

/** Sample a short arc (a few segments) sweeping from `a` to `c` about vertex `b`. */
function arcSegments(a: Vec3, b: Vec3, c: Vec3, radius: number, steps = 6): Array<[Vec3, Vec3]> {
  const u0 = sub(a, b);
  const v0 = sub(c, b);
  const lu = norm(u0) || 1;
  const lv = norm(v0) || 1;
  const u: Vec3 = scale(u0, 1 / lu);
  const v: Vec3 = scale(v0, 1 / lv);
  const total = Math.acos(Math.max(-1, Math.min(1, dot(u, v))));
  // Orthonormal in-plane basis (u, w).
  let w = sub(v, scale(u, dot(u, v)));
  const lw = norm(w) || 1;
  w = scale(w, 1 / lw);
  const pt = (t: number): Vec3 => {
    const ang = total * t;
    const dir: Vec3 = add(scale(u, Math.cos(ang)), scale(w, Math.sin(ang)));
    return add(b, scale(dir, radius));
  };
  const out: Array<[Vec3, Vec3]> = [];
  for (let i = 0; i < steps; i++) out.push([pt(i / steps), pt((i + 1) / steps)]);
  return out;
}

/**
 * PyMOL default dash spacing (Å): each dashed line is split into short solid
 * dashes of `DASH_LENGTH` separated by `DASH_GAP` empty space.
 */
const DASH_LENGTH = 0.1;
const DASH_GAP = 0.4;

/** Split a single endpoint pair into PyMOL-style gapped dash segments. */
function dashSegments(a: Vec3, b: Vec3): Array<[Vec3, Vec3]> {
  const d = sub(b, a);
  const len = norm(d);
  if (len <= DASH_LENGTH) return [[a, b]];
  const dir = scale(d, 1 / len);
  const period = DASH_LENGTH + DASH_GAP;
  const out: Array<[Vec3, Vec3]> = [];
  for (let t = 0; t < len; t += period) {
    const t2 = Math.min(t + DASH_LENGTH, len);
    out.push([add(a, scale(dir, t)), add(a, scale(dir, t2))]);
  }
  return out;
}

export function makeDistance(name: string, pairs: Array<[Vec3, Vec3]>, color: number): MeasurementObject {
  const segments = pairs.flatMap(([a, b]) => dashSegments(a, b));
  const values = pairs.map(([a, b]) => distanceOf(a, b));
  const value = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
  const labels = pairs.map(([a, b], i) => ({ pos: mid(a, b), text: (values[i] ?? 0).toFixed(2) }));
  return { name, enabled: true, color, kind: 'distance', segments, labels, value };
}

export function makeAngle(name: string, a: Vec3, b: Vec3, c: Vec3, color: number): MeasurementObject {
  const value = angleOf(a, b, c);
  const r = Math.min(distanceOf(a, b), distanceOf(c, b)) * 0.4 || 0.5;
  const segments: Array<[Vec3, Vec3]> = [[a, b], [b, c], ...arcSegments(a, b, c, r)];
  return { name, enabled: true, color, kind: 'angle', segments, labels: [{ pos: b, text: value.toFixed(1) }], value };
}

export function makeDihedral(name: string, a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: number): MeasurementObject {
  const value = dihedralOf(a, b, c, d);
  const segments: Array<[Vec3, Vec3]> = [[a, b], [b, c], [c, d]];
  return {
    name,
    enabled: true,
    color,
    kind: 'dihedral',
    segments,
    labels: [{ pos: mid(b, c), text: value.toFixed(1) }],
    value,
  };
}

/* ------------------------------ dash frame ------------------------------ */

const PLACEHOLDER: BufferRef = { byteOffset: 0, byteLength: 0, dtype: 'f32', itemSize: 1 };

/**
 * Build the Mode-G `dashes` frame (line instances) for a measurement object, or
 * null if it has no segments. Keyed by the object name and `Rep.Dash`.
 */
export function buildMeasurementFrame(m: MeasurementObject, seq: number): ArrayBuffer | null {
  if (m.segments.length === 0) return null;
  const rgb = rgbForIndex(m.color);
  const n = INSTANCE_ITEM_SIZE.line; // 14: v1[3] v2[3] rgba1[4] rgba2[4]
  const count = m.segments.length;
  const data = new Float32Array(count * n);
  const atom = new Int32Array(count).fill(-1);
  for (let k = 0; k < count; k++) {
    const [a, b] = m.segments[k]!;
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
    object: m.name,
    state: 1,
    rep: Rep.Dash,
    blocks: [],
    instances: [inst],
  };
  return encode(header, payload);
}
