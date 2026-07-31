/**
 * The pick index: geometry frames in, `(object, atom index, bond index)` out.
 *
 * It stores the SAME typed arrays the renderer uploaded — no copy, no BVH, no
 * spatial structure. A brute-force ray cast over 15,040 dots or 10,472 surface
 * triangles is sub-millisecond in JS, and a structure that has to be rebuilt on
 * every recolour would cost more than it saves. If a 500k-atom scene ever needs
 * one, the place to add it is `castKey()` and nothing else changes.
 *
 * Coordinates: primitives are stored in MODEL space and the ray is built in EYE
 * space, so the ray is transformed into model space once per key (the inverse
 * of the modelview, which is a rigid transform, so the inverse is the transpose
 * of the rotation plus a translation — no general matrix inverse needed).
 */

import {
  geometryKey,
  isCgoDrawArraysHeader,
  isIndexedMeshHeader,
  viewOf,
  type GeometryFrame,
  type IndexedMeshHeader,
  type InstanceBuffer,
  type RepId,
} from '@tenmol/protocol';

import { fovWidth, isOrthoscopic, modelViewMatrix, type ViewMatrix } from '../camera';
import { pickOffsets, screenRay, type Rect } from './ray';

/** `cPickable*`, `layer1/Rep.h`. */
export const PICKABLE_ATOM = -1;
export const PICKABLE_NO_PICK = -4;

export interface PickHit {
  object: string;
  rep: RepId;
  state: number;
  /** `CGO_PICK_COLOR` operand 0 — an atom index within `object`. */
  index: number;
  /** `CGO_PICK_COLOR` operand 1: `cPickableAtom` (-1) or a bond index. */
  bond: number;
  /** Eye-space distance along the ray. */
  distance: number;
  /** Which primitive answered: useful for diagnosing a disagreement. */
  kind: 'sphere' | 'cylinder' | 'ellipsoid' | 'cone' | 'triangle' | 'point';
  /** How far from the click, in framebuffer pixels, the ring scan had to go. */
  ringRadius: number;
}

export interface PickOptions {
  /** Framebuffer pixels per CSS pixel. The ring scan is in framebuffer pixels. */
  pixelRatio?: number;
  /** Screen radius, in CSS pixels, a point (dots) is considered to cover. */
  pointRadius?: number;
  /** Restrict the search to these reps. */
  reps?: readonly RepId[];
}

export interface PickIndexStats {
  keys: number;
  spheres: number;
  cylinders: number;
  ellipsoids: number;
  cones: number;
  triangles: number;
  points: number;
  /** Keys that carried geometry but NO pick identity, so cannot be picked. */
  keysWithoutPickData: number;
}

export interface PickIndex {
  readonly stats: PickIndexStats;
  /** Add or replace one `object|rep|state` key. */
  apply(frame: GeometryFrame): void;
  remove(key: string): void;
  removeRep(rep: RepId): void;
  removeObject(object: string): void;
  clear(): void;
  keys(): string[];
  /**
   * Resolve a click. `x`/`y` are DOM coordinates within the canvas, in CSS
   * pixels; `rect` is the SCENE rectangle (`cmd.get_viewport()`), also in CSS
   * pixels.
   */
  pick(view: ViewMatrix, rect: Rect, x: number, y: number, options?: PickOptions): PickHit | null;
  /** One ray cast with no ring scan — for measuring what the snap is worth. */
  castExact(
    view: ViewMatrix,
    rect: Rect,
    x: number,
    y: number,
    options?: PickOptions,
  ): PickHit | null;
}

/* ------------------------------------------------------------------ *
 * Stored primitives
 * ------------------------------------------------------------------ */

interface InstanceEntry {
  kind: 'sphere' | 'cylinder' | 'ellipsoid' | 'cone' | 'point';
  count: number;
  itemSize: number;
  data: Float32Array;
  atom: Int32Array | null;
  bond: Int32Array | null;
  /** Second end of a two-atom cylinder (`pick2`). */
  atom2: Int32Array | null;
}

interface MeshEntry {
  position: Float32Array;
  index: Uint32Array | null;
  atom: Int32Array | null;
  vis: Int32Array | null;
  proximity: boolean;
}

interface KeyEntry {
  object: string;
  rep: RepId;
  state: number;
  instances: InstanceEntry[];
  meshes: MeshEntry[];
  hasPickData: boolean;
}

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

type Vec3 = [number, number, number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Nearest positive root of the ray-sphere quadratic, or null. */
function raySphere(o: Vec3, d: Vec3, c: Vec3, r: number): number | null {
  const oc = sub(o, c);
  const b = dot(oc, d);
  const cc = dot(oc, oc) - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t0 = -b - s;
  if (t0 > 0) return t0;
  const t1 = -b + s;
  return t1 > 0 ? t1 : null;
}

/**
 * Ray vs a capped cylinder given as origin + axis (the wire layout: `a_v1` and
 * `a_axis`, where the far end is `v1 + axis`).
 */
function rayCylinder(o: Vec3, d: Vec3, v1: Vec3, axis: Vec3, r: number): number | null {
  const h = Math.hypot(axis[0], axis[1], axis[2]);
  if (h < 1e-9) return raySphere(o, d, v1, r);
  const u: Vec3 = [axis[0] / h, axis[1] / h, axis[2] / h];
  const p = sub(o, v1);
  const pu = dot(p, u);
  const du = dot(d, u);
  const pPerp: Vec3 = [p[0] - pu * u[0], p[1] - pu * u[1], p[2] - pu * u[2]];
  const dPerp: Vec3 = [d[0] - du * u[0], d[1] - du * u[1], d[2] - du * u[2]];
  const a = dot(dPerp, dPerp);
  const b = dot(pPerp, dPerp);
  const c = dot(pPerp, pPerp) - r * r;
  let best: number | null = null;
  if (a > 1e-12) {
    const disc = b * b - a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      for (const t of [(-b - s) / a, (-b + s) / a]) {
        if (t <= 0) continue;
        const z = pu + t * du;
        if (z < 0 || z > h) continue;
        if (best === null || t < best) best = t;
      }
    }
  }
  // Round caps: PyMOL's shader cylinders are round-capped by default
  // (`cylinder_flat_caps 0`), and a stick's end really is a hemisphere.
  for (const centre of [v1, [v1[0] + axis[0], v1[1] + axis[1], v1[2] + axis[2]] as Vec3]) {
    const t = raySphere(o, d, centre, r);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

/** Ray vs the ellipsoid `{ c + A u : |u| = 1 }`, A's columns orthogonal. */
function rayEllipsoid(o: Vec3, d: Vec3, c: Vec3, n1: Vec3, n2: Vec3, n3: Vec3): number | null {
  const l1 = dot(n1, n1);
  const l2 = dot(n2, n2);
  const l3 = dot(n3, n3);
  if (l1 < 1e-12 || l2 < 1e-12 || l3 < 1e-12) return null;
  const rel = sub(o, c);
  const oo: Vec3 = [dot(n1, rel) / l1, dot(n2, rel) / l2, dot(n3, rel) / l3];
  const dd: Vec3 = [dot(n1, d) / l1, dot(n2, d) / l2, dot(n3, d) / l3];
  const a = dot(dd, dd);
  const b = dot(oo, dd);
  const cc = dot(oo, oo) - 1;
  const disc = b * b - a * cc;
  if (disc < 0 || a <= 0) return null;
  const s = Math.sqrt(disc);
  const t0 = (-b - s) / a;
  if (t0 > 0) return t0;
  const t1 = (-b + s) / a;
  return t1 > 0 ? t1 : null;
}

/**
 * Model units per CSS pixel at eye depth `eyeZ` (negative, in front of the eye).
 * The visible height is `2 * |z| * tan(fovWidth/2)` under perspective and a
 * constant `max(1e-4, -view[11]) * fovWidth` under ortho — the same two
 * expressions `projectionMatrix()` builds.
 */
function worldPerPixel(view: ViewMatrix, rect: Rect, eyeZ: number): number {
  const h = Math.max(1, rect.height);
  if (isOrthoscopic(view)) return (Math.max(1e-4, -view[11]) * fovWidth(view)) / h;
  return (2 * Math.abs(eyeZ) * Math.tan(fovWidth(view) / 2)) / h;
}

/** Moller-Trumbore, double sided (PyMOL's pick pass does not cull). */
function rayTriangle(o: Vec3, d: Vec3, a: Vec3, b: Vec3, c: Vec3): number | null {
  const e1 = sub(b, a);
  const e2 = sub(c, a);
  const pv = cross(d, e2);
  const det = dot(e1, pv);
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const tv = sub(o, a);
  const u = dot(tv, pv) * inv;
  if (u < 0 || u > 1) return null;
  const qv = cross(tv, e1);
  const v = dot(d, qv) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = dot(e2, qv) * inv;
  return t > 0 ? t : null;
}

/* ------------------------------------------------------------------ *
 * The index
 * ------------------------------------------------------------------ */

function bufferOrNull<T>(frame: GeometryFrame, ref: unknown): T | null {
  if (ref === undefined || ref === null) return null;
  try {
    return viewOf(frame, ref as never) as unknown as T;
  } catch {
    return null;
  }
}

function instanceEntry(frame: GeometryFrame, buffer: InstanceBuffer): InstanceEntry | null {
  const data = bufferOrNull<Float32Array>(frame, buffer.data);
  if (data === null || buffer.count === 0) return null;
  const raw = buffer as unknown as { atom?: unknown; bond?: unknown; atom2?: unknown };
  const atom = bufferOrNull<Int32Array>(frame, raw.atom);
  const bond = bufferOrNull<Int32Array>(frame, raw.bond);
  const atom2 = bufferOrNull<Int32Array>(frame, raw.atom2);
  const itemSize = buffer.itemSize;

  let kind: InstanceEntry['kind'];
  switch (buffer.kind) {
    case 'sphere': {
      let maxR = 0;
      for (let i = 0; i < buffer.count; i++) maxR = Math.max(maxR, data[i * itemSize + 3] ?? 0);
      kind = maxR === 0 ? 'point' : 'sphere';
      break;
    }
    case 'ellipsoid':
      kind = 'ellipsoid';
      break;
    case 'cone':
      kind = 'cone';
      break;
    default:
      kind = 'cylinder';
      break;
  }
  return { kind, count: buffer.count, itemSize, data, atom, bond, atom2 };
}

export function createPickIndex(): PickIndex {
  const keys = new Map<string, KeyEntry>();
  const stats: PickIndexStats = {
    keys: 0,
    spheres: 0,
    cylinders: 0,
    ellipsoids: 0,
    cones: 0,
    triangles: 0,
    points: 0,
    keysWithoutPickData: 0,
  };

  function recount(): void {
    stats.keys = keys.size;
    stats.spheres = 0;
    stats.cylinders = 0;
    stats.ellipsoids = 0;
    stats.cones = 0;
    stats.triangles = 0;
    stats.points = 0;
    stats.keysWithoutPickData = 0;
    for (const entry of keys.values()) {
      if (!entry.hasPickData) stats.keysWithoutPickData++;
      for (const inst of entry.instances) {
        if (inst.kind === 'sphere') stats.spheres += inst.count;
        else if (inst.kind === 'cylinder') stats.cylinders += inst.count;
        else if (inst.kind === 'ellipsoid') stats.ellipsoids += inst.count;
        else if (inst.kind === 'cone') stats.cones += inst.count;
        else stats.points += inst.count;
      }
      for (const mesh of entry.meshes) {
        stats.triangles += mesh.index === null ? 0 : Math.floor(mesh.index.length / 3);
      }
    }
  }

  const api: PickIndex = {
    stats,

    apply(frame: GeometryFrame): void {
      const header = frame.header;
      const key = geometryKey(header);
      const entry: KeyEntry = {
        object: header.object,
        rep: header.rep,
        state: header.state,
        instances: [],
        meshes: [],
        hasPickData: false,
      };

      if (isIndexedMeshHeader(header)) {
        const h = header as IndexedMeshHeader;
        const position = bufferOrNull<Float32Array>(frame, h.buffers.position);
        if (position !== null) {
          const rawIndex = bufferOrNull<Int32Array>(frame, h.buffers.index);
          entry.meshes.push({
            position,
            index:
              rawIndex === null
                ? null
                : new Uint32Array(rawIndex.buffer, rawIndex.byteOffset, rawIndex.length),
            atom: bufferOrNull<Int32Array>(frame, h.buffers.atom),
            vis: bufferOrNull<Int32Array>(frame, h.buffers.vis),
            proximity: h.proximity,
          });
          if (h.buffers.atom) entry.hasPickData = true;
        }
      } else if (isCgoDrawArraysHeader(header)) {
        for (const buffer of header.instances) {
          const built = instanceEntry(frame, buffer);
          if (built === null) continue;
          entry.instances.push(built);
          if (built.atom !== null) entry.hasPickData = true;
        }
      }

      if (entry.instances.length === 0 && entry.meshes.length === 0) keys.delete(key);
      else keys.set(key, entry);
      recount();
    },

    remove(key: string): void {
      keys.delete(key);
      recount();
    },
    removeRep(rep: RepId): void {
      for (const [id, entry] of [...keys.entries()]) if (entry.rep === rep) keys.delete(id);
      recount();
    },
    removeObject(object: string): void {
      for (const [id, entry] of [...keys.entries()]) if (entry.object === object) keys.delete(id);
      recount();
    },
    clear(): void {
      keys.clear();
      recount();
    },
    keys(): string[] {
      return [...keys.keys()];
    },

    castExact(view, rect, x, y, options = {}): PickHit | null {
      return cast(view, rect, x, y, options, 0);
    },

    pick(view, rect, x, y, options = {}): PickHit | null {
      const dpr = options.pixelRatio ?? 1;
      // The backend scans a window of FRAMEBUFFER pixels; on a HiDPI display
      // that is a SMALLER distance in CSS pixels, which is what we work in.
      // `oy` is a framebuffer offset, which points UP: negate it for the DOM.
      for (const [ox, oy] of pickOffsets()) {
        const hit = cast(
          view,
          rect,
          x + ox / dpr,
          y - oy / dpr,
          options,
          Math.max(Math.abs(ox), Math.abs(oy)),
        );
        if (hit !== null) return hit;
      }
      return null;
    },
  };

  function cast(
    view: ViewMatrix,
    rect: Rect,
    x: number,
    y: number,
    options: PickOptions,
    ringRadius: number,
  ): PickHit | null {
    if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return null;
    const ray = screenRay(view, rect, x, y);

    // Eye -> model. The modelview is rigid (rotation + translation), so the
    // inverse is R^T applied to (v - t) for a point and R^T v for a direction.
    const m = Array.from(modelViewMatrix(view)) as number[];
    const mv = (i: number): number => m[i] ?? 0;
    const inv = (v: Vec3, isPoint: boolean): Vec3 => {
      const p: Vec3 = isPoint ? [v[0] - mv(12), v[1] - mv(13), v[2] - mv(14)] : v;
      return [
        mv(0) * p[0] + mv(1) * p[1] + mv(2) * p[2],
        mv(4) * p[0] + mv(5) * p[1] + mv(6) * p[2],
        mv(8) * p[0] + mv(9) * p[1] + mv(10) * p[2],
      ];
    };
    const o = inv(ray.origin, true);
    const d = inv(ray.direction, false);

    const wanted = options.reps;
    let best: PickHit | null = null;
    const take = (
      t: number,
      entry: KeyEntry,
      index: number,
      bond: number,
      kind: PickHit['kind'],
    ): void => {
      if (t <= 0 || (best !== null && t >= best.distance)) return;
      best = {
        object: entry.object,
        rep: entry.rep,
        state: entry.state,
        index,
        bond,
        distance: t,
        kind,
        ringRadius,
      };
    };

    // The screen-space radius a radius-0 dot covers, converted to model units
    // at the depth of the dot. Approximated with the depth of the point itself.
    const pointRadiusPx = options.pointRadius ?? 2;

    for (const entry of keys.values()) {
      if (wanted !== undefined && !wanted.includes(entry.rep)) continue;

      for (const inst of entry.instances) {
        const { data, itemSize, count } = inst;
        for (let i = 0; i < count; i++) {
          const b = i * itemSize;
          const bond = inst.bond?.[i] ?? PICKABLE_ATOM;
          if (bond === PICKABLE_NO_PICK) continue;
          const atom = inst.atom?.[i];
          if (atom === undefined) continue;

          switch (inst.kind) {
            case 'sphere': {
              const t = raySphere(
                o,
                d,
                [data[b] ?? 0, data[b + 1] ?? 0, data[b + 2] ?? 0],
                data[b + 3] ?? 0,
              );
              if (t !== null) take(t, entry, atom, bond, 'sphere');
              break;
            }
            case 'point': {
              // A dot has no volume. Treat it as a sphere whose radius is the
              // screen size the point sprite covers, converted to model units
              // at that dot's own depth.
              const centre: Vec3 = [data[b] ?? 0, data[b + 1] ?? 0, data[b + 2] ?? 0];
              const eyeZ = mv(2) * centre[0] + mv(6) * centre[1] + mv(10) * centre[2] + mv(14);
              const r = Math.max(1e-4, worldPerPixel(view, rect, eyeZ) * pointRadiusPx);
              const t = raySphere(o, d, centre, r);
              if (t !== null) take(t, entry, atom, bond, 'point');
              break;
            }
            case 'ellipsoid': {
              const t = rayEllipsoid(
                o,
                d,
                [data[b] ?? 0, data[b + 1] ?? 0, data[b + 2] ?? 0],
                [data[b + 3] ?? 0, data[b + 4] ?? 0, data[b + 5] ?? 0],
                [data[b + 6] ?? 0, data[b + 7] ?? 0, data[b + 8] ?? 0],
                [data[b + 9] ?? 0, data[b + 10] ?? 0, data[b + 11] ?? 0],
              );
              if (t !== null) take(t, entry, atom, bond, 'ellipsoid');
              break;
            }
            case 'cone': {
              // v2 is absolute; the picker treats a cone as the capsule around
              // its larger radius, which is a conservative over-estimate.
              const v1: Vec3 = [data[b] ?? 0, data[b + 1] ?? 0, data[b + 2] ?? 0];
              const axis: Vec3 = [
                (data[b + 3] ?? 0) - v1[0],
                (data[b + 4] ?? 0) - v1[1],
                (data[b + 5] ?? 0) - v1[2],
              ];
              const t = rayCylinder(o, d, v1, axis, Math.max(data[b + 6] ?? 0, data[b + 7] ?? 0));
              if (t !== null) take(t, entry, atom, bond, 'cone');
              break;
            }
            default: {
              const v1: Vec3 = [data[b] ?? 0, data[b + 1] ?? 0, data[b + 2] ?? 0];
              const axis: Vec3 = [data[b + 3] ?? 0, data[b + 4] ?? 0, data[b + 5] ?? 0];
              const t = rayCylinder(o, d, v1, axis, data[b + 6] ?? 0);
              if (t === null) break;
              // Half-bond: the near half belongs to atom1, the far half to
              // atom2 (`pick2`), which is exactly how RepCylBond colours it.
              let picked = atom;
              if (inst.atom2 !== null) {
                const px = o[0] + t * d[0] - v1[0];
                const py = o[1] + t * d[1] - v1[1];
                const pz = o[2] + t * d[2] - v1[2];
                const h2 = axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2];
                const s = h2 > 0 ? (px * axis[0] + py * axis[1] + pz * axis[2]) / h2 : 0;
                if (s > 0.5) picked = inst.atom2[i] ?? atom;
              }
              take(t, entry, picked, bond, 'cylinder');
              break;
            }
          }
        }
      }

      for (const mesh of entry.meshes) {
        if (mesh.index === null || mesh.atom === null) continue;
        const { position, index, atom, vis } = mesh;
        const tris = Math.floor(index.length / 3);
        for (let t = 0; t < tris; t++) {
          const ia = index[t * 3] ?? 0;
          const ib = index[t * 3 + 1] ?? 0;
          const ic = index[t * 3 + 2] ?? 0;
          if (vis !== null) {
            // layer2/RepSurface.cpp:209-216 — the same test the renderer uses.
            const ok = mesh.proximity
              ? (vis[ia] ?? 0) !== 0 || (vis[ib] ?? 0) !== 0 || (vis[ic] ?? 0) !== 0
              : (vis[ia] ?? 0) !== 0 && (vis[ib] ?? 0) !== 0 && (vis[ic] ?? 0) !== 0;
            if (!ok) continue;
          }
          const hit = rayTriangle(
            o,
            d,
            [position[ia * 3] ?? 0, position[ia * 3 + 1] ?? 0, position[ia * 3 + 2] ?? 0],
            [position[ib * 3] ?? 0, position[ib * 3 + 1] ?? 0, position[ib * 3 + 2] ?? 0],
            [position[ic * 3] ?? 0, position[ic * 3 + 1] ?? 0, position[ic * 3 + 2] ?? 0],
          );
          if (hit === null) continue;
          // THE PROVOKING VERTEX. Flat shading, last index. See ./index.ts.
          take(hit, entry, atom[ic] ?? 0, PICKABLE_ATOM, 'triangle');
        }
      }
    }

    return best;
  }

  return api;
}
