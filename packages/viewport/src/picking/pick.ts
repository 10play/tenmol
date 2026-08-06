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
  cgoArraysLayout,
} from '@tenmol/protocol';

import { fovWidth, isOrthoscopic, modelViewMatrix, type ViewMatrix } from '../camera';
import { pickOffsets, screenPoint, screenRay, type Rect } from './ray';

/** `cPickable*`, `layer1/Rep.h`. */
export const PICKABLE_ATOM = -1;

/**
 * Draw-arrays primitive modes that describe triangles.
 *
 * MEASURED, and the reason an earlier version indexed nothing: a 1TII cartoon
 * emits 1220 blocks, of which 1036 are STRIP (5) and 184 are FAN (6). NONE are
 * plain `GL_TRIANGLES` (4). Accepting only mode 4 discarded every block, left
 * the index empty, and made every click miss.
 */
const GL_TRIANGLES = 4;
const GL_TRIANGLE_STRIP = 5;
const GL_TRIANGLE_FAN = 6;

/**
 * Face index for a draw-arrays block, or null when the mode is not triangles.
 *
 * Winding is ignored: ray-triangle intersection does not care, so the strip's
 * alternating order needs no special case.
 */
function faceIndex(mode: number, nverts: number): Uint32Array | null {
  if (nverts < 3) return null;
  if (mode === GL_TRIANGLES) return null; // already face soup; caller uses null
  const faces = nverts - 2;
  if (mode !== GL_TRIANGLE_STRIP && mode !== GL_TRIANGLE_FAN) return null;
  const out = new Uint32Array(faces * 3);
  for (let f = 0; f < faces; f++) {
    if (mode === GL_TRIANGLE_FAN) {
      out[f * 3] = 0;
      out[f * 3 + 1] = f + 1;
      out[f * 3 + 2] = f + 2;
    } else {
      out[f * 3] = f;
      out[f * 3 + 1] = f + 1;
      out[f * 3 + 2] = f + 2;
    }
  }
  return out;
}
/** `cPickableNoPick` — an instance the ray cast and box scan must skip. */
export const PICKABLE_NO_PICK = -4;

/** A successful pick: which object/rep/atom (and the far atom of a bond) the ray hit, and where. */
export interface PickHit {
  object: string;
  rep: RepId;
  state: number;
  /** `CGO_PICK_COLOR` operand 0 — an atom index within `object`. */
  index: number;
  /**
   * THE OTHER END OF A PICKED BOND, or null when the hit identifies one atom.
   *
   * A stick is drawn as a HALF BOND: one cylinder instance carrying both atom
   * ids (`pick` and `pick2` — `InstanceBuffer.atom` / `.atom2`), split at the
   * midpoint. `index` is the half that was hit; this is the far end. Together
   * they are the two atom indices a bond pick needs
   * (`cmd.builder_pick(..., mode='bond')` -> `cmd.edit(a, b, pkbond=1)`), which
   * no field of this struct could express before: `bond` is PyMOL's bond INDEX
   * inside the object, not an atom, and it is -1 (`cPickableAtom`) for every
   * instance a stick rep emits.
   */
  index2: number | null;
  /** `CGO_PICK_COLOR` operand 1: `cPickableAtom` (-1) or a bond index. */
  bond: number;
  /** Eye-space distance along the ray. */
  distance: number;
  /** Which primitive answered: useful for diagnosing a disagreement. */
  kind: 'sphere' | 'cylinder' | 'ellipsoid' | 'cone' | 'triangle' | 'point';
  /** How far from the click, in framebuffer pixels, the ring scan had to go. */
  ringRadius: number;
}

/** Tuning for a pick or box query: pixel ratio, point radius, and an optional rep filter. */
export interface PickOptions {
  /** Framebuffer pixels per CSS pixel. The ring scan is in framebuffer pixels. */
  pixelRatio?: number;
  /** Screen radius, in CSS pixels, a point (dots) is considered to cover. */
  pointRadius?: number;
  /** Restrict the search to these reps. */
  reps?: readonly RepId[];
}

/** Live primitive counts held by a `PickIndex`, for the HUD and tests. */
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

/** The pick index: apply/remove geometry frames, then resolve a click, exact cast, or rubber-band box to atom identities. */
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
  /**
   * Every atom whose geometry projects inside a screen rectangle — the client
   * half of the rubber band.
   */
  box(view: ViewMatrix, rect: Rect, band: BandRect, options?: PickOptions): BoxHit[];
}

/** A rubber-band rectangle in DOM CSS pixels, already normalised. */
export interface BandRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** One atom caught by the rubber band: its object and atom index. */
export interface BoxHit {
  object: string;
  /** `CGO_PICK_COLOR` operand 0 — an atom index within `object`, 0-based. */
  index: number;
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

/** Build an empty pick index that stores uploaded geometry and answers ray casts against it. */
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
        // A null index means NON-INDEXED, i.e. every 3 vertices is a face —
        // not "no faces". Counting it as zero made a fully pickable block
        // report an empty index, which is the single most misleading number
        // this struct can produce.
        stats.triangles +=
          mesh.index === null
            ? Math.floor(mesh.position.length / 9)
            : Math.floor(mesh.index.length / 3);
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
        // DRAW-ARRAYS TRIANGLE BLOCKS. Without these a cartoon-only scene
        // indexes NOTHING and every click misses: cartoon is not spheres or
        // cylinders, it is `CGO_DRAW_ARRAYS` triangles, and the instance loop
        // below never sees it. Measured before this existed: 8 clicks, 8
        // misses, `stats.keys === 0`.
        //
        // Sub-arrays are CONSECUTIVE, not interleaved (`cgoArraysLayout`), and
        // the pick block is itself split rgba-then-index, so the atom mapping
        // is the SECOND half of it.
        for (const block of header.blocks) {
          const isTriangles =
            block.mode === GL_TRIANGLES ||
            block.mode === GL_TRIANGLE_STRIP ||
            block.mode === GL_TRIANGLE_FAN;
          if (!isTriangles) continue; // lines and points are not pickable here
          const data = bufferOrNull<Float32Array>(frame, block.data);
          if (data === null) continue;
          const layout = cgoArraysLayout(block.arraybits, block.nverts);
          const position = data.subarray(
            layout.vertex.offset,
            layout.vertex.offset + layout.vertex.length,
          );
          let atom: Int32Array | null = null;
          if (layout.pickColorIndex) {
            // {atom, bond} pairs as floats; the index we want is every other one.
            const pick = data.subarray(
              layout.pickColorIndex.offset,
              layout.pickColorIndex.offset + layout.pickColorIndex.length,
            );
            atom = new Int32Array(block.nverts);
            for (let v = 0; v < block.nverts; v++) atom[v] = pick[v * 2] ?? -1;
            entry.hasPickData = true;
          }
          entry.meshes.push({
            position: new Float32Array(position),
            // Strips and fans get an explicit face index; plain triangles stay
            // null, which the ray walk reads as "every 3 vertices is a face".
            index: faceIndex(block.mode, block.nverts),
            atom,
            vis: null,
            // Draw-arrays faces are exact geometry, not a proximity hull, so
            // the nearest-vertex relaxation the surface path uses must be off.
            proximity: false,
          });
        }
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

    /**
     * RUBBER BAND. `SceneMultipick` renders the pick buffer over the rectangle
     * and collects every DISTINCT id that survived the depth test
     * (`layer1/ScenePicking.cpp`), so PyMOL's band takes only atoms whose
     * pixels are actually visible. With no GL there is no depth buffer, so
     * this projects each primitive's identifying vertex and takes everything
     * that lands inside the rectangle: an atom hidden BEHIND another one is
     * included here and would not be by PyMOL. That is the one known
     * divergence, and it is a superset, never a subset.
     */
    box(view, rect, band, options = {}): BoxHit[] {
      const wanted = options.reps;
      const m = Array.from(modelViewMatrix(view)) as number[];
      const mv = (i: number): number => m[i] ?? 0;
      const eyeOf = (x: number, y: number, z: number): [number, number, number] => [
        mv(0) * x + mv(4) * y + mv(8) * z + mv(12),
        mv(1) * x + mv(5) * y + mv(9) * z + mv(13),
        mv(2) * x + mv(6) * y + mv(10) * z + mv(14),
      ];

      const out: BoxHit[] = [];
      const seen = new Set<string>();
      const take = (object: string, index: number, x: number, y: number, z: number): void => {
        const key = `${object} ${index}`;
        if (seen.has(key)) return;
        const p = screenPoint(view, rect, eyeOf(x, y, z));
        if (p.behind) return;
        if (p.x < band.left || p.x > band.right || p.y < band.top || p.y > band.bottom) return;
        seen.add(key);
        out.push({ object, index });
      };

      for (const entry of keys.values()) {
        if (wanted !== undefined && !wanted.includes(entry.rep)) continue;
        for (const inst of entry.instances) {
          const { data, itemSize, count } = inst;
          for (let i = 0; i < count; i++) {
            const b = i * itemSize;
            if ((inst.bond?.[i] ?? PICKABLE_ATOM) === PICKABLE_NO_PICK) continue;
            const atom = inst.atom?.[i];
            if (atom === undefined) continue;
            const x = data[b] ?? 0;
            const y = data[b + 1] ?? 0;
            const z = data[b + 2] ?? 0;
            if (inst.kind === 'cylinder' && inst.atom2 !== null) {
              // A half-bond carries two identities; each end is its own atom,
              // exactly as the ray cast splits them at the midpoint.
              take(entry.object, atom, x, y, z);
              const other = inst.atom2[i];
              if (other !== undefined)
                take(
                  entry.object,
                  other,
                  x + (data[b + 3] ?? 0),
                  y + (data[b + 4] ?? 0),
                  z + (data[b + 5] ?? 0),
                );
              continue;
            }
            take(entry.object, atom, x, y, z);
          }
        }
        for (const mesh of entry.meshes) {
          const { position, atom, vis } = mesh;
          if (atom === null) continue;
          const verts = Math.floor(position.length / 3);
          for (let v = 0; v < verts; v++) {
            if (vis !== null && (vis[v] ?? 0) === 0) continue;
            const id = atom[v];
            if (id === undefined) continue;
            take(
              entry.object,
              id,
              position[v * 3] ?? 0,
              position[v * 3 + 1] ?? 0,
              position[v * 3 + 2] ?? 0,
            );
          }
        }
      }
      return out;
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
      index2: number | null = null,
    ): void => {
      if (t <= 0 || (best !== null && t >= best.distance)) return;
      best = {
        object: entry.object,
        rep: entry.rep,
        state: entry.state,
        index,
        index2,
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
              // The far end travels with it: a cylinder that carries two atom
              // ids IS a bond, and both are needed to name it.
              let other: number | null = inst.atom2 === null ? null : (inst.atom2[i] ?? null);
              if (inst.atom2 !== null) {
                const px = o[0] + t * d[0] - v1[0];
                const py = o[1] + t * d[1] - v1[1];
                const pz = o[2] + t * d[2] - v1[2];
                const h2 = axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2];
                const s = h2 > 0 ? (px * axis[0] + py * axis[1] + pz * axis[2]) / h2 : 0;
                if (s > 0.5) {
                  picked = inst.atom2[i] ?? atom;
                  other = atom;
                }
              }
              take(t, entry, picked, bond, 'cylinder', other);
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
