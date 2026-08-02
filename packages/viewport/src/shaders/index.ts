/**
 * Raw GLSL for the Mode-G materials this work package adds.
 *
 * The GLSL lives here and the three.js `RawShaderMaterial` wrappers live in
 * `../materials`, so a shader can be read (and diffed against the PyMOL source
 * it was ported from) without three.js noise in the way.
 *
 * The lighting/fog chunk is NOT duplicated: every fragment shader here takes it
 * as a parameter and `../materials` passes `LIGHTING_GLSL` from
 * `../modeG/materials/lighting.ts`, which is the single port of
 * `data/shaders/compute_color_for_light.fs`.
 *
 * (`quadline` is the one whose wrapper lives in `../webgl/quadlines.ts`
 * instead: its material is inseparable from the geometry that feeds it — the
 * width uniform is recomputed from the camera on every draw — so the two are
 * kept in one file next to their only caller.)
 */

export { CONE_VERT, CONE_FRAG } from './cone';
export { ELLIPSOID_VERT, ELLIPSOID_FRAG } from './ellipsoid';
export { POINT_VERT, POINT_FRAG } from './point';
export { QUADLINE_VERT, QUADLINE_FRAG } from './quadline';
