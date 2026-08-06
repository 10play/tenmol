import { GLSL3, RawShaderMaterial } from 'three';

import { LIGHTING_GLSL, lightingUniforms } from '../modeG/materials/lighting';
import { POINT_FRAG, POINT_VERT } from '../shaders/point';

/** Options controlling the screen-space point (dots) material. */
export interface PointMaterialOptions {
  /** `dot_width` / `line_width`, in CSS pixels. The frame header carries it. */
  pointSize?: number;
  /** Framebuffer pixels per CSS pixel (`devicePixelRatio`). */
  pixelRatio?: number;
  /**
   * The instance carried `RepDot::VN`, so the dots can be shaded the way
   * `RepDot` shades them. False (the default) keeps the old flat look, which
   * is what a frame from a bridge that does not send normals gets.
   */
  hasNormal?: boolean;
}

/**
 * Screen-space round points — the radius-0 `dots` rep (see
 * `../shaders/point.ts` for why radius 0 is the DEFAULT, not an edge case).
 *
 * Lit when — and only when — the frame carried a normal per dot. `RepDot`
 * keeps `VN` and the accessor has always returned it; until wave 10 the wire
 * had no slot for it and these points were flat (parity row 131). Nothing is
 * ever invented: `hasNormal: false` shades exactly as before.
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
      u_hasNormal: { value: options.hasNormal ?? false },
      u_ortho: { value: false },
    },
    transparent: false,
    depthTest: true,
    depthWrite: true,
  });
}
