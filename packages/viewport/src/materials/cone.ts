import { DoubleSide, GLSL3, RawShaderMaterial } from 'three';

import { LIGHTING_GLSL, lightingUniforms } from '../modeG/materials/lighting';
import { CONE_FRAG, CONE_VERT } from '../shaders/cone';

/**
 * Ray-traced conical-frustum impostor (see `../shaders/cone.ts`).
 *
 * One instance = the same 8-corner impostor box the cylinder uses, sized by the
 * LARGER of the two end radii.
 */
export function createConeMaterial(): RawShaderMaterial {
  return new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: CONE_VERT,
    fragmentShader: CONE_FRAG(LIGHTING_GLSL),
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
