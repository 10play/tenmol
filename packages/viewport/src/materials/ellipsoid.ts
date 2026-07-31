import { DoubleSide, GLSL3, RawShaderMaterial } from 'three';

import { LIGHTING_GLSL, lightingUniforms } from '../modeG/materials/lighting';
import { ELLIPSOID_FRAG, ELLIPSOID_VERT } from '../shaders/ellipsoid';

/**
 * Ray-traced ellipsoid impostor (see `../shaders/ellipsoid.ts`).
 *
 * One instance = one 4-vertex quad, exactly like the sphere. `side:
 * DoubleSide` for the same reason the sphere needs it: the quad is a proxy, the
 * ray test decides coverage, and back-face culling would drop instances the
 * camera is inside.
 */
export function createEllipsoidMaterial(): RawShaderMaterial {
  return new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: ELLIPSOID_VERT,
    fragmentShader: ELLIPSOID_FRAG(LIGHTING_GLSL),
    uniforms: {
      ...lightingUniforms(),
      u_ortho: { value: false },
    },
    side: DoubleSide,
    transparent: false,
    depthTest: true,
    depthWrite: true,
  });
}
