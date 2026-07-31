import { GLSL3, RawShaderMaterial } from 'three';

import { LIGHTING_GLSL, lightingUniforms } from '../modeG/materials/lighting';
import { POINT_FRAG, POINT_VERT } from '../shaders/point';

export interface PointMaterialOptions {
  /** `dot_width` / `line_width`, in CSS pixels. The frame header carries it. */
  pointSize?: number;
  /** Framebuffer pixels per CSS pixel (`devicePixelRatio`). */
  pixelRatio?: number;
}

/**
 * Screen-space round points — the radius-0 `dots` rep (see
 * `../shaders/point.ts` for why radius 0 is the DEFAULT, not an edge case).
 *
 * Deliberately unlit: the wire buffer for a radius-0 dot carries position and
 * colour only (`xyzr` + `rgba`, no normal), so there is nothing to light with.
 * `RepDot` does light its dots when `dot_normals` is on, which is a real
 * divergence and is recorded as such rather than faked with an invented normal.
 */
export function createPointMaterial(options: PointMaterialOptions = {}): RawShaderMaterial {
  return new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: POINT_VERT,
    fragmentShader: POINT_FRAG(LIGHTING_GLSL),
    uniforms: {
      ...lightingUniforms(),
      u_pointSize: { value: options.pointSize ?? 2 },
      u_pixelRatio: { value: options.pixelRatio ?? 1 },
      u_ortho: { value: false },
    },
    transparent: false,
    depthTest: true,
    depthWrite: true,
  });
}
