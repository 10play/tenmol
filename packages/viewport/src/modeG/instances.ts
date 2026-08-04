/**
 * Instance buffers -> instanced draws. NEVER tessellated.
 *
 * Plan §1.3 constraint 1 and the accessor's wire contract
 * (`INSTANCE_ITEM_SIZE` in `@tenmol/protocol`): a sphere is 8 floats, a
 * cylinder 12, a two-colour cylinder 16. Those float arrays are uploaded
 * VERBATIM as an interleaved instanced buffer — no deinterleave, no copy, no
 * geometry generation. The only client-side vertices in play are the 4 corners
 * of the impostor quad and the 8 corners of the impostor box, shared by every
 * instance in the scene.
 *
 * Wire layouts (`@tenmol/protocol/geometry`):
 *   sphere     8: cx,cy,cz, r, r,g,b,a
 *   cylinder  12: ox,oy,oz, ax,ay,az, radius, capbits, r,g,b,a
 *   cylinder2 16: ox,oy,oz, ax,ay,az, radius, capbits, rgba1[4], rgba2[4]
 *   cone      18 / ellipsoid 16: NOT DRAWN — reported as a fallback reason
 *   instead of being approximated with the wrong primitive.
 */

import {
  BufferAttribute,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  Sphere,
  Vector3,
} from 'three';
import type { Material } from 'three';

import { INSTANCE_ITEM_SIZE, type InstanceBuffer, type InstanceKind } from '@tenmol/protocol';

/** Instance kinds this renderer can draw today. */
export const DRAWABLE_INSTANCE_KINDS: readonly InstanceKind[] = ['sphere', 'cylinder', 'cylinder2'];

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
  // 12 triangles over the 8 corners, indexed by the same (out,up,right) bits.
  const idx = (out: number, up: number, right: number): number => out | (up << 1) | (right << 2);
  const quads: Array<[number, number, number, number]> = [
    // out = 0 / out = 1 faces
    [idx(0, 0, 0), idx(0, 1, 0), idx(0, 1, 1), idx(0, 0, 1)],
    [idx(1, 0, 0), idx(1, 0, 1), idx(1, 1, 1), idx(1, 1, 0)],
    // up = 0 / up = 1 faces
    [idx(0, 0, 0), idx(0, 0, 1), idx(1, 0, 1), idx(1, 0, 0)],
    [idx(0, 1, 0), idx(1, 1, 0), idx(1, 1, 1), idx(0, 1, 1)],
    // right = 0 / right = 1 faces
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

export interface InstancedDraw {
  mesh: Mesh;
  count: number;
  kind: InstanceKind;
}

/**
 * Build the instanced draw for one instance buffer.
 *
 * @param data the float32 view onto the frame payload, `count * itemSize` long
 */
export function buildInstancedDraw(
  buffer: InstanceBuffer,
  data: Float32Array,
  material: Material,
): InstancedDraw | null {
  const itemSize = INSTANCE_ITEM_SIZE[buffer.kind];
  if (!isDrawableInstanceKind(buffer.kind)) return null;
  if (data.length < buffer.count * itemSize) return null;

  const geometry = buffer.kind === 'sphere' ? quadGeometry() : boxGeometry();
  geometry.instanceCount = buffer.count;

  const interleaved = new InstancedInterleavedBuffer(data, itemSize, 1);

  if (buffer.kind === 'sphere') {
    geometry.setAttribute('a_centerRadius', new InterleavedBufferAttribute(interleaved, 4, 0));
    geometry.setAttribute('a_color', new InterleavedBufferAttribute(interleaved, 4, 4));
  } else {
    geometry.setAttribute('a_v1', new InterleavedBufferAttribute(interleaved, 3, 0));
    geometry.setAttribute('a_axis', new InterleavedBufferAttribute(interleaved, 3, 3));
    geometry.setAttribute('a_radius', new InterleavedBufferAttribute(interleaved, 1, 6));
    geometry.setAttribute('a_cap', new InterleavedBufferAttribute(interleaved, 1, 7));
    geometry.setAttribute('a_color1', new InterleavedBufferAttribute(interleaved, 4, 8));
    // A single-colour cylinder reuses the same four floats for both ends.
    const secondOffset = buffer.kind === 'cylinder2' ? 12 : 8;
    geometry.setAttribute('a_color2', new InterleavedBufferAttribute(interleaved, 4, secondOffset));
  }

  geometry.boundingSphere = boundingSphereOf(buffer.kind, data, buffer.count, itemSize);

  const mesh = new Mesh(geometry, material);
  // Impostor geometry is a unit primitive expanded in the vertex shader, so
  // three's own culling maths does not apply; we supply the bounding sphere
  // for the stats/zoom code and skip the frustum test.
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return { mesh, count: buffer.count, kind: buffer.kind };
}

function boundingSphereOf(
  kind: InstanceKind,
  data: Float32Array,
  count: number,
  itemSize: number,
): Sphere {
  const center = new Vector3();
  let n = 0;
  for (let i = 0; i < count; i++) {
    const o = i * itemSize;
    center.x += data[o] ?? 0;
    center.y += data[o + 1] ?? 0;
    center.z += data[o + 2] ?? 0;
    n++;
  }
  if (n > 0) center.multiplyScalar(1 / n);
  let radius = 0;
  const p = new Vector3();
  for (let i = 0; i < count; i++) {
    const o = i * itemSize;
    p.set(data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0);
    const extra = kind === 'sphere' ? (data[o + 3] ?? 0) : (data[o + 6] ?? 0) + axisLength(data, o);
    radius = Math.max(radius, p.distanceTo(center) + extra);
  }
  return new Sphere(center, radius);
}

function axisLength(data: Float32Array, offset: number): number {
  return Math.hypot(data[offset + 3] ?? 0, data[offset + 4] ?? 0, data[offset + 5] ?? 0);
}
