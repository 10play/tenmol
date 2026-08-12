/**
 * Instance buffers -> instanced draws. NEVER tessellated.
 *
 * This supersedes `../modeG/instances.ts`, which drew three of the five
 * instance kinds and reported the other two as a fallback reason. All five are
 * drawn here:
 *
 *   sphere     8: cx,cy,cz, r, r,g,b,a
 *   cylinder  12: ox,oy,oz, ax,ay,az, radius, capbits, r,g,b,a
 *   cylinder2 16: ox,oy,oz, ax,ay,az, radius, capbits, rgba1[4], rgba2[4]
 *   cone      18: v1[3], v2[3], r1, r2, cap1, cap2, rgba1[4], rgba2[4]
 *   ellipsoid 16: centre[3], n1[3], n2[3], n3[3], rgba[4]
 *
 * (The `cone: 16` at `@tenmol/protocol/geometry.ts:404` is NOT a contradiction
 * of the `cone: 18` at :437 — the first table is `CGO_*_SZ`, the raw operand
 * count of the CGO op, the second is the WIRE layout, which additionally
 * carries an alpha per colour. 16 + 2 = 18. Both are right.)
 *
 * The radius-0 sphere is the interesting case: `cSetting_dot_radius` defaults
 * to 0, so a `dots` frame is a legitimate instance buffer of 15,040 spheres of
 * radius zero, which an impostor draws as nothing at all. `buildInstancedDraw`
 * routes those to a screen-space point material instead — see
 * `../materials/point.ts`.
 */

import {
  BufferAttribute,
  BufferGeometry,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  Points,
  Sphere,
  Vector3,
} from 'three';
import type { Material, Object3D } from 'three';

import { INSTANCE_ITEM_SIZE, type InstanceBuffer, type InstanceKind } from '@tenmol/protocol';

import { createConeMaterial } from '../materials/cone';
import { createEllipsoidMaterial } from '../materials/ellipsoid';
import { createPointMaterial } from '../materials/point';
import { createCylinderMaterial } from '../modeG/materials/cylinder';
import { createSphereMaterial } from '../modeG/materials/sphere';
import { buildQuadLines } from './quadlines';

/** Every instance kind on the wire is drawable now. */
export const DRAWABLE_INSTANCE_KINDS: readonly InstanceKind[] = [
  'sphere',
  'cylinder',
  'cylinder2',
  'cone',
  'ellipsoid',
  'line',
  'cross',
];

/**
 * Half-length of a nonbonded cross arm when the frame carries no
 * `nonbondedSize`. Matches `cSetting_nonbonded_size`'s 0.25 default; PyMOL
 * draws arms of +/- that along each axis (`RepNonbonded`).
 */
const DEFAULT_NONBONDED_SIZE = 0.25;

/** Whether an instance kind has a GPU impostor/point renderer in this module. */
export function isDrawableInstanceKind(kind: InstanceKind): boolean {
  return DRAWABLE_INSTANCE_KINDS.includes(kind);
}

/** A screen-facing unit quad, corners in {-1,+1}^2 (`sphere.vs`'s rightUp flags). */
function quadGeometry(): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();
  // prettier-ignore
  const corners = new Float32Array([
    -1, -1,
     1, -1,
     1,  1,
    -1,  1,
  ]);
  geometry.setAttribute('corner', new BufferAttribute(corners, 2));
  geometry.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
  return geometry;
}

/**
 * The impostor box: all 8 combinations of (out, up, right).
 * `cylinder.vs` expands these into the oriented bounding box of the cylinder.
 */
function boxGeometry(): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();
  const corners = new Float32Array(8 * 3);
  for (let i = 0; i < 8; i++) {
    corners[i * 3 + 0] = (i >> 0) & 1; // out
    corners[i * 3 + 1] = (i >> 1) & 1; // up
    corners[i * 3 + 2] = (i >> 2) & 1; // right
  }
  const idx = (out: number, up: number, right: number): number => out | (up << 1) | (right << 2);
  const quads: Array<[number, number, number, number]> = [
    [idx(0, 0, 0), idx(0, 1, 0), idx(0, 1, 1), idx(0, 0, 1)],
    [idx(1, 0, 0), idx(1, 0, 1), idx(1, 1, 1), idx(1, 1, 0)],
    [idx(0, 0, 0), idx(0, 0, 1), idx(1, 0, 1), idx(1, 0, 0)],
    [idx(0, 1, 0), idx(1, 1, 0), idx(1, 1, 1), idx(0, 1, 1)],
    [idx(0, 0, 0), idx(1, 0, 0), idx(1, 1, 0), idx(0, 1, 0)],
    [idx(0, 0, 1), idx(0, 1, 1), idx(1, 1, 1), idx(1, 0, 1)],
  ];
  const index = new Uint16Array(quads.length * 6);
  quads.forEach((q, i) => {
    index.set([q[0], q[1], q[2], q[0], q[2], q[3]], i * 6);
  });
  geometry.setAttribute('boxCorner', new BufferAttribute(corners, 3));
  geometry.setIndex(new BufferAttribute(index, 1));
  return geometry;
}

/** A built instanced draw: the scene object, its material and instance count. */
export interface InstancedDraw {
  object: Object3D;
  material: Material;
  count: number;
  kind: InstanceKind;
  /** True when the draw is a point cloud rather than an impostor. */
  points: boolean;
}

/** Per-frame tuning for building instanced draws (point size, pixel ratio, normals). */
export interface InstanceDrawOptions {
  /** `dot_width` from the frame header, in CSS pixels. */
  pointSize?: number;
  /** Framebuffer pixels per CSS pixel. */
  pixelRatio?: number;
  /** `nonbonded_size` from the frame header; the cross arm half-length. */
  nonbondedSize?: number;
  /**
   * `RepDot::VN`, one MODEL-space normal per dot, when the frame carried the
   * optional `normal` sub-buffer. Absent for every other kind and for a bridge
   * that does not send it — the points are then flat, as they always were.
   */
  normal?: Float32Array;
  /**
   * Raw PyMOL width setting for a `line`-kind buffer — `line_width` for the
   * `lines` rep, `ribbon_width` for `ribbon`. When present, the segments are
   * drawn as screen-space quad lines (`buildQuadLines`) so the width and the
   * distance-scaling match Mode P / PyMOL instead of the 1px `GL_LINES` clamp.
   * Absent for reps that have not (yet) plumbed a width; those stay 1px.
   */
  lineWidth?: number;
}

/** Largest `w` in a sphere buffer. 0 means "these are dots, not spheres". */
export function maxSphereRadius(data: Float32Array, count: number): number {
  let r = 0;
  for (let i = 0; i < count; i++) r = Math.max(r, data[i * 8 + 3] ?? 0);
  return r;
}

/**
 * Build the draw for one instance buffer, material included.
 *
 * @param data the float32 view onto the frame payload, `count * itemSize` long
 */
export function buildInstancedDraw(
  buffer: InstanceBuffer,
  data: Float32Array,
  options: InstanceDrawOptions = {},
): InstancedDraw | null {
  const itemSize = INSTANCE_ITEM_SIZE[buffer.kind];
  if (!isDrawableInstanceKind(buffer.kind)) return null;
  if (data.length < buffer.count * itemSize) return null;
  if (buffer.count === 0) return null;

  if (buffer.kind === 'sphere' && maxSphereRadius(data, buffer.count) === 0) {
    return buildPointCloud(buffer, data, options);
  }
  if (buffer.kind === 'line') {
    return options.lineWidth === undefined
      ? buildLineSegments(buffer, data)
      : buildWideLines(buffer, data, options.lineWidth);
  }
  if (buffer.kind === 'cross') return buildCrosses(buffer, data, options);

  const geometry =
    buffer.kind === 'sphere' || buffer.kind === 'ellipsoid' ? quadGeometry() : boxGeometry();
  geometry.instanceCount = buffer.count;

  const interleaved = new InstancedInterleavedBuffer(data, itemSize, 1);
  const at = (size: number, offset: number): InterleavedBufferAttribute =>
    new InterleavedBufferAttribute(interleaved, size, offset);

  let material: Material;
  switch (buffer.kind) {
    case 'sphere':
      geometry.setAttribute('a_centerRadius', at(4, 0));
      geometry.setAttribute('a_color', at(4, 4));
      material = createSphereMaterial();
      break;
    case 'ellipsoid':
      geometry.setAttribute('a_center', at(3, 0));
      geometry.setAttribute('a_n1', at(3, 3));
      geometry.setAttribute('a_n2', at(3, 6));
      geometry.setAttribute('a_n3', at(3, 9));
      geometry.setAttribute('a_color', at(4, 12));
      material = createEllipsoidMaterial();
      break;
    case 'cone':
      geometry.setAttribute('a_v1', at(3, 0));
      geometry.setAttribute('a_v2', at(3, 3));
      geometry.setAttribute('a_r1', at(1, 6));
      geometry.setAttribute('a_r2', at(1, 7));
      geometry.setAttribute('a_cap1', at(1, 8));
      geometry.setAttribute('a_cap2', at(1, 9));
      geometry.setAttribute('a_color1', at(4, 10));
      geometry.setAttribute('a_color2', at(4, 14));
      material = createConeMaterial();
      break;
    default: {
      geometry.setAttribute('a_v1', at(3, 0));
      geometry.setAttribute('a_axis', at(3, 3));
      geometry.setAttribute('a_radius', at(1, 6));
      geometry.setAttribute('a_cap', at(1, 7));
      geometry.setAttribute('a_color1', at(4, 8));
      // A single-colour cylinder reuses the same four floats for both ends.
      geometry.setAttribute('a_color2', at(4, buffer.kind === 'cylinder2' ? 12 : 8));
      material = createCylinderMaterial();
      break;
    }
  }

  geometry.boundingSphere = boundingSphereOf(buffer.kind, data, buffer.count, itemSize);

  const mesh = new Mesh(geometry, material);
  // Impostor geometry is a unit primitive expanded in the vertex shader, so
  // three's own culling maths does not apply; we supply the bounding sphere
  // for the stats/zoom code and skip the frustum test.
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return { object: mesh, material, count: buffer.count, kind: buffer.kind, points: false };
}

/**
 * `line` (14): v1[3], v2[3], rgba1[4], rgba2[4] -> GL_LINES, which is exactly
 * what PyMOL draws for `CGO_LINE`/`CGO_SPLITLINE`. Expanded to two vertices per
 * segment with per-vertex colour so a split line keeps both of its colours.
 *
 * One segment per instance, so this takes `lines`, `ribbon`, `cell`, `extent`,
 * `dashes`, `angles` and `dihedrals` off the Mode-P fallback list at once.
 *
 * KNOWN DIVERGENCE: `line_width` cannot be honoured. WebGL2 core clamps
 * `lineWidth` to 1.0, so a `set line_width, 3` scene is thinner in Mode G than
 * in Mode P. Matching it needs instanced quad lines, the same fix `mesh_width`
 * is waiting on.
 */
function buildLineSegments(buffer: InstanceBuffer, data: Float32Array): InstancedDraw {
  const n = buffer.count;
  const positions = new Float32Array(n * 6);
  const colors = new Float32Array(n * 8);
  for (let i = 0; i < n; i++) {
    const o = i * 14;
    positions.set(data.subarray(o, o + 6), i * 6);
    colors.set(data.subarray(o + 6, o + 10), i * 8);
    colors.set(data.subarray(o + 10, o + 14), i * 8 + 4);
  }
  return lineDraw(positions, colors, n * 2, 'line');
}

/**
 * Wide `line` segments — the same 14-float records `buildLineSegments` reads,
 * but drawn through the screen-space quad-line path (`buildQuadLines`) so a
 * `line_width`/`ribbon_width` above 1 is actually rasterised. WebGL2 clamps
 * `GL_LINES` to a single pixel, which left `ribbon` (default width 3) and
 * `lines` (1.49) far thinner than PyMOL's ray render; the quad path applies
 * PyMOL's own `dynamic_line_width` factor per frame. The buffer layout already
 * matches `QUADLINE_ITEM_SIZE` (14), so the float view is fed straight in.
 */
function buildWideLines(
  buffer: InstanceBuffer,
  data: Float32Array,
  width: number,
): InstancedDraw {
  const draw = buildQuadLines(data, buffer.count, width);
  return {
    object: draw.object,
    material: draw.material,
    count: buffer.count,
    kind: 'line',
    points: false,
  };
}

/**
 * `cross` (7): centre[3], rgba[4] -> three axis-aligned segments per centre,
 * which is how `RepNonbonded` draws a nonbonded atom. Expanded here rather than
 * on the wire: it keeps the payload at a third the size, and the arm length
 * follows `nonbonded_size` without refetching geometry.
 */
function buildCrosses(
  buffer: InstanceBuffer,
  data: Float32Array,
  options: InstanceDrawOptions,
): InstancedDraw {
  const n = buffer.count;
  const h = options.nonbondedSize ?? DEFAULT_NONBONDED_SIZE;
  const positions = new Float32Array(n * 18); // 3 segments * 2 verts * 3
  const colors = new Float32Array(n * 24); // 6 verts * 4
  for (let i = 0; i < n; i++) {
    const o = i * 7;
    const x = data[o] ?? 0;
    const y = data[o + 1] ?? 0;
    const z = data[o + 2] ?? 0;
    const p = i * 18;
    // -x/+x, -y/+y, -z/+z
    positions.set([x - h, y, z, x + h, y, z], p);
    positions.set([x, y - h, z, x, y + h, z], p + 6);
    positions.set([x, y, z - h, x, y, z + h], p + 12);
    for (let v = 0; v < 6; v++) colors.set(data.subarray(o + 3, o + 7), i * 24 + v * 4);
  }
  return lineDraw(positions, colors, n * 6, 'cross');
}

function lineDraw(
  positions: Float32Array,
  colors: Float32Array,
  vertexCount: number,
  kind: InstanceKind,
): InstancedDraw {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 4));
  geometry.computeBoundingSphere();
  const material = new LineBasicMaterial({ vertexColors: true, transparent: true });
  const segments = new LineSegments(geometry, material);
  segments.matrixAutoUpdate = false;
  // `count` is instances-on-the-wire, not vertices, so the HUD keeps counting
  // segments the way the bridge does.
  return {
    object: segments,
    material,
    count: vertexCount / 2,
    kind,
    points: false,
  };
}

/** Radius-0 spheres: PyMOL draws GL_POINTS of `dot_width` pixels. */
function buildPointCloud(
  buffer: InstanceBuffer,
  data: Float32Array,
  options: InstanceDrawOptions,
): InstancedDraw {
  const geometry = new BufferGeometry();
  const interleaved = new InterleavedBuffer(data, 8);
  geometry.setAttribute('position', new InterleavedBufferAttribute(interleaved, 3, 0));
  geometry.setAttribute('color', new InterleavedBufferAttribute(interleaved, 4, 4));
  geometry.boundingSphere = boundingSphereOf('sphere', data, buffer.count, 8);
  // `RepDot::VN`, if the frame carried it. A short buffer is IGNORED rather
  // than half-applied: three would read past the end and light the tail of the
  // cloud with garbage, which is worse than the flat look it replaces.
  const normal =
    options.normal !== undefined && options.normal.length >= buffer.count * 3
      ? options.normal
      : null;
  if (normal !== null) geometry.setAttribute('normal', new BufferAttribute(normal, 3));
  const material = createPointMaterial({
    ...(options.pointSize === undefined ? {} : { pointSize: options.pointSize }),
    ...(options.pixelRatio === undefined ? {} : { pixelRatio: options.pixelRatio }),
    hasNormal: normal !== null,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.matrixAutoUpdate = false;
  return { object: points, material, count: buffer.count, kind: 'sphere', points: true };
}

function boundingSphereOf(
  kind: InstanceKind,
  data: Float32Array,
  count: number,
  itemSize: number,
): Sphere {
  const center = new Vector3();
  for (let i = 0; i < count; i++) {
    const o = i * itemSize;
    center.x += data[o] ?? 0;
    center.y += data[o + 1] ?? 0;
    center.z += data[o + 2] ?? 0;
  }
  if (count > 0) center.multiplyScalar(1 / count);
  let radius = 0;
  const p = new Vector3();
  for (let i = 0; i < count; i++) {
    const o = i * itemSize;
    p.set(data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0);
    radius = Math.max(radius, p.distanceTo(center) + extentOf(kind, data, o));
  }
  return new Sphere(center, radius);
}

function extentOf(kind: InstanceKind, data: Float32Array, o: number): number {
  switch (kind) {
    case 'sphere':
      return data[o + 3] ?? 0;
    case 'ellipsoid':
      return Math.max(
        Math.hypot(data[o + 3] ?? 0, data[o + 4] ?? 0, data[o + 5] ?? 0),
        Math.hypot(data[o + 6] ?? 0, data[o + 7] ?? 0, data[o + 8] ?? 0),
        Math.hypot(data[o + 9] ?? 0, data[o + 10] ?? 0, data[o + 11] ?? 0),
      );
    case 'cone': {
      // v2 is absolute here, not an offset from v1.
      const len = Math.hypot(
        (data[o + 3] ?? 0) - (data[o] ?? 0),
        (data[o + 4] ?? 0) - (data[o + 1] ?? 0),
        (data[o + 5] ?? 0) - (data[o + 2] ?? 0),
      );
      return len + Math.max(data[o + 6] ?? 0, data[o + 7] ?? 0);
    }
    default:
      return (data[o + 6] ?? 0) + Math.hypot(data[o + 3] ?? 0, data[o + 4] ?? 0, data[o + 5] ?? 0);
  }
}
