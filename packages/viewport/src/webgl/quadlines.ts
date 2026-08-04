/**
 * Wide lines that WebGL2 can actually draw — `mesh_width`, parity row 131.
 *
 * THE PROBLEM, MEASURED. WebGL2 core clamps `gl.lineWidth` to 1.0. Measured
 * in the headless Chromium the e2e suite uses: `ALIASED_LINE_WIDTH_RANGE`
 * reads `[1, 1]` (`gl.lineWidth(5)` is remembered as state — `LINE_WIDTH`
 * reads back 5 — and rasterised as 1), so
 * `LineSegments` renders `set mesh_width, 3` and `set mesh_width, 1`
 * identically. PyMOL hit the same wall in its GL 3.3 core path and answered it
 * with `trilines`: each segment becomes a screen-space quad. `../shaders/
 * quadline.ts` is that shader; this file is the geometry and the material.
 *
 * THE WIDTH IS NOT THE SETTING. `RepMesh::render` draws with
 * `SceneGetDynamicLineWidth(info, I->Width)` (`packages/engine/layer2/RepMesh.cpp:535`, and
 * `packages/engine/layer1/CGOGL.cpp:1095` for the shader path), and `dynamic_width` is ON by
 * default (`packages/engine/layer1/SettingInfo.h:710`). The rasterised width is therefore
 *
 *     clamp(dynamic_width_factor / vertex_scale, min, max) * mesh_width
 *
 * with `vertex_scale` = model units per pixel at the origin of rotation
 * (`SceneGetScreenVertexScale`, `packages/engine/layer1/Scene.cpp:3667`). That is a CAMERA
 * quantity, so it cannot be baked into a cached geometry frame: the bridge
 * sends the raw setting and the factor is recomputed here on every draw, from
 * the projection matrix and the viewport, in `onBeforeRender`.
 *
 * THE FACTOR IS NOT 1, so the quad path is used for EVERY mesh and not only
 * for wide ones. Measured in a browser at a 776x544 scene rectangle: 2.00 on
 * `fragment ala` zoomed to 6 A of buffer (`vertex_scale` 0.030) and 0.75 —
 * the `dynamic_width_min` clamp — on 1tii residues 1-40 (`vertex_scale`
 * 0.160). Drawing `mesh_width 1` as one pixel would be wrong in both.
 */

import {
  BufferAttribute,
  DoubleSide,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  GLSL3,
  Mesh,
  RawShaderMaterial,
  Sphere,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import type { Camera, WebGLRenderer } from 'three';

import { LIGHTING_GLSL, lightingUniforms } from '../modeG/materials/lighting';
import { QUADLINE_FRAG, QUADLINE_VERT } from '../shaders/quadline';

/** Floats per segment: v1[3], v2[3], rgba1[4], rgba2[4]. */
export const QUADLINE_ITEM_SIZE = 14;

/* `packages/engine/layer1/SettingInfo.h:711-713`. Global settings with no wire slot yet; the
 * same treatment `FOG_START` and `DEFAULT_NONBONDED_SIZE` already get. */
export const DYNAMIC_WIDTH_FACTOR = 0.06;
export const DYNAMIC_WIDTH_MIN = 0.75;
export const DYNAMIC_WIDTH_MAX = 2.5;
/** `R_SMALL4` (`packages/engine/layer0/os_predef.h`), the floor `SceneGetScreenVertexScale` uses. */
const R_SMALL4 = 1e-4;

/**
 * `SceneGetScreenVertexScale(G, nullptr)` — model units per pixel at the
 * origin of rotation — recovered from the projection matrix.
 *
 * `ratio = depth * GetFovWidth(G) / Scene->Height` (`packages/engine/layer1/Scene.cpp:3667`).
 *
 * ORTHO is exact: `projectionMatrix()` builds `m[5] = 1 / (|view[11]| *
 * fovWidth / 2)`, so `depth * fovWidth` is `2 / m[5]` with nothing assumed.
 *
 * PERSPECTIVE has one assumption, named here because it is the only one in the
 * file: the projection carries the near and far PLANES, not the camera
 * distance, so `depth` is taken as their midpoint. That is exact for every
 * camera PyMOL produces from `zoom`/`orient`/`reset` — `SceneWindowSphere`
 * sets `Front = dist - radius`, `Back = dist + radius`, and rotation and
 * translation move all three together — and wrong by exactly the asymmetry a
 * user introduces with `clip near`/`clip far` on one side only.
 *
 * @param p `camera.projectionMatrix.elements`, column-major
 * @param heightPx viewport height in DEVICE pixels (PyMOL's `Scene->Height`)
 */
export function vertexScaleOf(p: ArrayLike<number>, heightPx: number): number {
  const h = Math.max(1, heightPx);
  const m22 = Math.abs(p[5] ?? 1) || 1;
  // m44: 1 for glm::ortho, 0 for glm::perspective.
  const ortho = (p[15] ?? 0) !== 0;
  if (ortho) return Math.max(R_SMALL4, 2 / (m22 * h));
  const m33 = p[10] ?? -1;
  const m34 = p[14] ?? 0;
  const near = m34 / (m33 - 1);
  const far = m34 / (m33 + 1);
  const depth = (near + far) / 2;
  // `GetFovWidth` is passed to glm::perspective as if it were an angle in
  // radians (see `camera.ts`), so m[5] == 1 / tan(fovWidth / 2).
  const fovWidth = 2 * Math.atan(1 / m22);
  return Math.max(R_SMALL4, (depth * fovWidth) / h);
}

/**
 * `SceneGetDynamicLineWidth` (`packages/engine/layer1/Scene.cpp:5416-5433`), verbatim.
 *
 * @param vertexScale model units per pixel
 * @param width the raw setting (`mesh_width`, `line_width`, ...)
 * @returns the width PyMOL would hand to `glLineWidth`, in pixels
 */
export function dynamicLineWidth(vertexScale: number, width: number): number {
  let factor =
    vertexScale > R_SMALL4 ? DYNAMIC_WIDTH_FACTOR / vertexScale : DYNAMIC_WIDTH_MAX;
  if (factor > DYNAMIC_WIDTH_MAX) factor = DYNAMIC_WIDTH_MAX;
  if (factor < DYNAMIC_WIDTH_MIN) factor = DYNAMIC_WIDTH_MIN;
  return factor * width;
}

/**
 * One 14-float record per segment, built from an indexed line list.
 *
 * This is the only place a mesh's floats are copied. `stripLineIndices` gives
 * `[a, b, a, b, ...]` into PyMOL's own vertex array; a quad needs BOTH
 * endpoints available at every corner, which an index cannot express.
 *
 * @param position `nverts * 3`, PyMOL's `RepMesh::V`
 * @param index    `segments * 2` vertex indices
 * @param color    `nverts * 4` RGBA, or null for a flat mesh
 * @param flat     the flat colour, used when `color` is null
 */
export function quadLineRecords(
  position: Float32Array,
  index: ArrayLike<number>,
  color: Float32Array | null,
  flat: readonly [number, number, number, number],
): Float32Array {
  const segments = Math.floor(index.length / 2);
  const out = new Float32Array(segments * QUADLINE_ITEM_SIZE);
  for (let s = 0; s < segments; s++) {
    const a = index[s * 2] ?? 0;
    const b = index[s * 2 + 1] ?? 0;
    const o = s * QUADLINE_ITEM_SIZE;
    out[o] = position[a * 3] ?? 0;
    out[o + 1] = position[a * 3 + 1] ?? 0;
    out[o + 2] = position[a * 3 + 2] ?? 0;
    out[o + 3] = position[b * 3] ?? 0;
    out[o + 4] = position[b * 3 + 1] ?? 0;
    out[o + 5] = position[b * 3 + 2] ?? 0;
    for (let k = 0; k < 4; k++) {
      out[o + 6 + k] = color === null ? flat[k] ?? 1 : color[a * 4 + k] ?? 1;
      out[o + 10 + k] = color === null ? flat[k] ?? 1 : color[b * 4 + k] ?? 1;
    }
  }
  return out;
}

/**
 * The four corners of the quad: (which endpoint, which side).
 *
 * THE SIDE CODE MEANS OPPOSITE PHYSICAL SIDES AT THE TWO ENDS, and the index
 * order below is the only thing that makes that harmless. The shader computes
 * the perpendicular from `self - other`, which negates when the corner sits on
 * `v2`, so `(v2, +1)` lands on the far side from `(v1, +1)`. `trilines` has
 * exactly the same property and answers it by choosing the diagonal to match:
 * `trilinesBufferAddVertices` (`packages/engine/layer1/CGO.cpp:7479`) emits the uv codes
 * `1,3,0` then `3,2,1`, i.e. `(A,+) (B,+) (A,-)` then `(B,+) (B,-) (A,+)`.
 * That is this index list, de-duplicated to four corners.
 *
 * Taking the "obvious" `0,1,2 0,2,3` instead makes the two triangles pick
 * DIFFERENT diagonals; they then overlap over half the rectangle and leave the
 * other half unfilled — a bow tie, not a line. The unit test measures all four
 * corners rather than trusting this comment.
 */
function cornerGeometry(): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();
  // prettier-ignore
  const corners = new Float32Array([
    0,  1,   // A, +side
    1,  1,   // B, -side (the sign flips with the perpendicular)
    1, -1,   // B, +side
    0, -1,   // A, -side
  ]);
  geometry.setAttribute('corner', new BufferAttribute(corners, 2));
  geometry.setIndex(new BufferAttribute(new Uint16Array([0, 1, 3, 1, 2, 0]), 1));
  return geometry;
}

export interface QuadLineDraw {
  object: Mesh;
  material: RawShaderMaterial;
  /** Segments drawn (= instances), not vertices. */
  segments: number;
  /** The RAW setting the draw was built with, before the dynamic factor. */
  width: number;
}

/**
 * Build the instanced quad-line draw for `count` 14-float records.
 *
 * `data` is used AS IT ARRIVES — the `line` instance kind on the wire already
 * has exactly this layout (`v1[3] v2[3] rgba1[4] rgba2[4]`, see
 * `@tenmol/protocol/geometry.ts`), so feeding a CGO line buffer straight in
 * costs no copy at all.
 */
export function buildQuadLines(
  data: Float32Array,
  count: number,
  width: number,
): QuadLineDraw {
  const geometry = cornerGeometry();
  geometry.instanceCount = count;

  const interleaved = new InstancedInterleavedBuffer(data, QUADLINE_ITEM_SIZE, 1);
  geometry.setAttribute('a_v1', new InterleavedBufferAttribute(interleaved, 3, 0));
  geometry.setAttribute('a_v2', new InterleavedBufferAttribute(interleaved, 3, 3));
  geometry.setAttribute('a_color1', new InterleavedBufferAttribute(interleaved, 4, 6));
  geometry.setAttribute('a_color2', new InterleavedBufferAttribute(interleaved, 4, 10));
  geometry.boundingSphere = boundingSphereOf(data, count);

  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: QUADLINE_VERT,
    fragmentShader: QUADLINE_FRAG(LIGHTING_GLSL),
    uniforms: {
      ...lightingUniforms(),
      u_invDim: { value: new Vector2(1 / 800, 1 / 600) },
      u_lineWidth: { value: Math.max(1, width) },
    },
    // DOUBLE SIDED, and not for aesthetics: the winding of a screen-space quad
    // follows the direction the segment happens to run in, so with the default
    // FrontSide roughly half of any mesh is back-facing and culled. The vertex
    // material this replaces is DoubleSide for its own reasons.
    side: DoubleSide,
    transparent: false,
    depthTest: true,
    depthWrite: true,
  });

  const mesh = new Mesh(geometry, material);
  // The quad is expanded in the vertex shader from a unit corner, so three's
  // own culling maths does not apply — same reason the impostors set this.
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;

  const viewport = new Vector4();
  mesh.onBeforeRender = (renderer: WebGLRenderer, _scene, camera: Camera): void => {
    // The viewport, not the canvas: PyMOL's scene rectangle is smaller than
    // the window when the movie panel is up, and `Scene->Height` is the
    // rectangle. `renderer.getViewport` returns what `setViewport` was given,
    // which the renderer scales by the pixel ratio on the way to GL.
    renderer.getViewport(viewport);
    const ratio = renderer.getPixelRatio();
    const w = Math.max(1, viewport.z * ratio);
    const h = Math.max(1, viewport.w * ratio);
    material.uniforms['u_invDim']?.value.set(1 / w, 1 / h);
    const uniform = material.uniforms['u_lineWidth'];
    if (uniform) {
      uniform.value = dynamicLineWidth(
        vertexScaleOf(camera.projectionMatrix.elements, h),
        width,
      );
    }
  };

  return { object: mesh, material, segments: count, width };
}

/** Centre and radius over both endpoints of every record. */
function boundingSphereOf(data: Float32Array, count: number): Sphere {
  const center = new Vector3();
  const n = Math.max(1, count * 2);
  for (let i = 0; i < count; i++) {
    const o = i * QUADLINE_ITEM_SIZE;
    center.x += (data[o] ?? 0) + (data[o + 3] ?? 0);
    center.y += (data[o + 1] ?? 0) + (data[o + 4] ?? 0);
    center.z += (data[o + 2] ?? 0) + (data[o + 5] ?? 0);
  }
  center.multiplyScalar(1 / n);
  let radius = 0;
  const p = new Vector3();
  for (let i = 0; i < count; i++) {
    const o = i * QUADLINE_ITEM_SIZE;
    p.set(data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0);
    radius = Math.max(radius, p.distanceTo(center));
    p.set(data[o + 3] ?? 0, data[o + 4] ?? 0, data[o + 5] ?? 0);
    radius = Math.max(radius, p.distanceTo(center));
  }
  return new Sphere(center, radius);
}
