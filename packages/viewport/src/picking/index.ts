/**
 * CLIENT-SIDE PICKING — the second of the two reasons the backend still needs a
 * GL context (the other is rasterizing Mode P).
 *
 * Today a click is resolved by `layer1/ScenePicking.cpp`: PyMOL re-renders the
 * scene with pick colours into the framebuffer and calls `glReadPixels`. That
 * is the ONLY pick path in the tree, and it is why a headless Linux/Windows
 * bridge needs EGL/WGL even if it never shows a pixel to anyone.
 *
 * The geometry Mode G already downloads carries the same identity the pick
 * colours encode — `CGO_PICK_COLOR`'s (atom index, bond index) per instance and
 * `RepSurface::AT` per vertex — so the click can be resolved against those
 * buffers with no GL at all. This module is that resolver.
 *
 *   ray.ts    screen pixel -> eye-space ray, plus PyMOL's cRange=7 ring scan
 *   index.ts  a pick index built from geometry frames, and `pick()`
 *
 * TWO BACKEND CONVENTIONS ARE REPRODUCED HERE ON PURPOSE. Skipping either one
 * makes the client disagree with Mode P, which is worse than not picking at all
 * because the two modes would then select different atoms from the same click:
 *
 *   1. The cRange=7 outward square-ring scan (`./ray.ts`).
 *   2. For a triangle mesh, the atom of the LAST index of the hit triangle —
 *      `atom[index[3*t + 2]]` — because the pick pass is FLAT shaded
 *      (`SceneSetupGLPicking`, `layer1/Scene.cpp:5186`) and GL's default
 *      provoking vertex for a triangle is its last one. Taking the nearest
 *      barycentric corner instead scores 10/15 against a real GL pick; taking
 *      the provoking vertex scores 15/15.
 */

export { screenRay, screenPoint, pickOffsets, PICK_RANGE, type EyeRay, type Rect } from './ray';
export {
  createPickIndex,
  type PickIndex,
  type PickHit,
  type PickOptions,
  type PickIndexStats,
  type BandRect,
  type BoxHit,
} from './pick';
