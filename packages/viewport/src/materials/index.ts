/**
 * three.js materials for the Mode-G primitives added by the D6 work package.
 *
 * They follow the conventions the two existing impostor materials established
 * (`../modeG/materials/{sphere,cylinder}.ts`): `RawShaderMaterial` + GLSL3,
 * PyMOL's own lighting/fog chunk, `u_ortho` switching the ray construction, and
 * a `gl_FragDepth` write so an impostor interpenetrates correctly with the
 * triangle reps.
 *
 * `../modeG/renderer.ts` pushes `u_ortho`, `u_fogEnd`, `u_fogScale`,
 * `u_bgColor` and `u_invHeight` into every material it is handed, so anything
 * here that declares those uniform names is driven by the camera for free.
 */

export { createConeMaterial } from './cone';
export { createEllipsoidMaterial } from './ellipsoid';
export { createPointMaterial, type PointMaterialOptions } from './point';
