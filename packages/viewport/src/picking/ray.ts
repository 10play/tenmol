/**
 * Screen pixel -> eye-space ray, in PyMOL's conventions.
 *
 * THREE CONVENTIONS have to line up or the pick lands on the wrong atom, and
 * all three are easy to get silently wrong:
 *
 *  1. The Y AXIS IS FLIPPED. The DOM's origin is top-left; PyMOL's viewport and
 *     `glReadPixels` are bottom-left (`packages/engine/layer1/ScenePicking.cpp` reads
 *     `y = height - 1 - domY` worth of rows). `screenRay` takes DOM coordinates
 *     and flips internally, so callers pass what `PointerEvent` gave them.
 *  2. The SCENE RECTANGLE IS NOT THE CANVAS. `OrthoReshape`
 *     (`packages/engine/layer1/Ortho.cpp:2383-2390`) takes the movie panel and the internal
 *     feedback lines off the bottom, so `cmd.get_viewport()` can be 800x585
 *     inside an 800x600 canvas, and the scene is anchored at the TOP. The
 *     projection uses the SCENE aspect ratio, and a click below the scene
 *     rectangle is not a click on the scene at all.
 *  3. PERSPECTIVE AND ORTHOSCOPIC BUILD DIFFERENT RAYS. Perspective: origin at
 *     the eye, direction through the pixel. Orthoscopic: direction always
 *     (0,0,-1), origin on the front plane at the pixel. `isOrthoscopic()`
 *     already knows the sign trap in `view[17]`.
 *
 * Everything here is in EYE space (the space `modelViewMatrix()` maps into),
 * because that is the space the impostor shaders ray-trace in, so the picker
 * and the renderer agree by construction.
 */

import { fovWidth, isOrthoscopic, type ViewMatrix } from '../camera';

export interface Rect {
  /** The scene rectangle, in CSS pixels, anchored at the top-left of the canvas. */
  width: number;
  height: number;
}

export interface EyeRay {
  origin: [number, number, number];
  /** Unit length. */
  direction: [number, number, number];
  /** True when the ray is a parallel projection. */
  ortho: boolean;
}

/**
 * @param x DOM x within the canvas, CSS pixels
 * @param y DOM y within the canvas, CSS pixels (top-left origin)
 */
export function screenRay(view: ViewMatrix, rect: Rect, x: number, y: number): EyeRay {
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  const aspect = w / h;

  // Normalised device coordinates. The +0.5 samples the CENTRE of the pixel,
  // which is where the rasteriser samples too; without it every pick is biased
  // by half a pixel toward the origin.
  const ndcX = ((x + 0.5) / w) * 2 - 1;
  const ndcY = 1 - ((y + 0.5) / h) * 2; // the DOM/GL y flip

  const fw = fovWidth(view);

  if (isOrthoscopic(view)) {
    // `SceneProjectionMatrix`'s ortho branch: height = max(1e-4, -pos.z) * fw/2
    const height = (Math.max(1e-4, -view[11]) * fw) / 2;
    const width = height * aspect;
    return {
      origin: [ndcX * width, ndcY * height, -view[15]],
      direction: [0, 0, -1],
      ortho: true,
    };
  }

  // Perspective. `projectionMatrix` uses tan(fovWidth/2) as the half-angle
  // tangent (the upstream radians/degrees quirk documented in ../camera.ts);
  // the ray must use the SAME number or Mode-G picking is off by ~1 % at the
  // edge of the frame, which is a whole atom at typical zoom.
  const tanHalf = Math.tan(fw / 2);
  const dx = ndcX * aspect * tanHalf;
  const dy = ndcY * tanHalf;
  const len = Math.hypot(dx, dy, 1);
  return {
    origin: [0, 0, 0],
    direction: [dx / len, dy / len, -1 / len],
    ortho: false,
  };
}

/**
 * The exact inverse of `screenRay`: an EYE-space point -> DOM coordinates.
 *
 * Used by the rubber band, which has to ask "is this atom inside the
 * rectangle" rather than "what does this pixel hit". Sharing the projection
 * with `screenRay` is the point: a band that projected with its own copy of
 * the fov/ortho arithmetic would disagree with the ray at the frame edge, and
 * a user would see a click and a band select different atoms.
 *
 * `behind` is true for a point at or behind the eye, which has no screen
 * position at all under perspective.
 */
export function screenPoint(
  view: ViewMatrix,
  rect: Rect,
  eye: readonly [number, number, number],
): { x: number; y: number; behind: boolean } {
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  const aspect = w / h;
  const fw = fovWidth(view);

  let ndcX: number;
  let ndcY: number;
  let behind = false;

  if (isOrthoscopic(view)) {
    const height = (Math.max(1e-4, -view[11]) * fw) / 2;
    const width = height * aspect;
    ndcX = eye[0] / width;
    ndcY = eye[1] / height;
  } else {
    const tanHalf = Math.tan(fw / 2);
    const depth = -eye[2];
    if (depth <= 1e-6) {
      behind = true;
      ndcX = 0;
      ndcY = 0;
    } else {
      ndcX = eye[0] / depth / (aspect * tanHalf);
      ndcY = eye[1] / depth / tanHalf;
    }
  }

  return {
    x: ((ndcX + 1) / 2) * w - 0.5,
    y: ((1 - ndcY) / 2) * h - 0.5,
    behind,
  };
}

/**
 * `SceneRenderPickingSinglePick`, `packages/engine/layer1/ScenePicking.cpp:186-208`, VERBATIM.
 *
 * The pick pass reads a `(2*cRange+1)^2` window of FRAMEBUFFER pixels around
 * the click (`#define cRange 7`, `:13`) and takes the FIRST non-background
 * pixel in this order:
 *
 *     for (d = 0; d < cRange; ++d)
 *       for (a = -d; a <= d; ++a)
 *         for (b = -d; b <= d; ++b)
 *           index = indices[a + cRange + (b + cRange) * w];
 *
 * THREE THINGS ARE EASY TO GET WRONG HERE and each one costs picks:
 *
 *   * It is NOT a ring walk and it is NOT centre-first. Each `d` rescans the
 *     whole square from `a = -d`, so at `d = 1` the pixel one to the LEFT and
 *     one BELOW the click is tested before the click's own pixel. A
 *     centre-first ring walk therefore disagrees with the backend wherever two
 *     primitives are within a pixel of each other.
 *   * The loop is `d < cRange`, so the largest offset is 6, not 7.
 *   * `a` is the x offset and `b` the FRAMEBUFFER y offset, which points UP.
 *     A DOM caller must negate it — `pick()` in `./pick.ts` does.
 *
 * Duplicate visits (the C code rescans the inner square every `d`) are dropped:
 * re-testing a pixel that already missed cannot change the answer, and it turns
 * 1,015 casts into 169.
 */
export const PICK_RANGE = 7;

export function pickOffsets(range: number = PICK_RANGE): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const seen = new Set<number>();
  for (let d = 0; d < range; d++) {
    for (let a = -d; a <= d; a++) {
      for (let b = -d; b <= d; b++) {
        const tag = (a + range) * 1024 + (b + range);
        if (seen.has(tag)) continue;
        seen.add(tag);
        // `a || 0` normalises the -0 that `-d` produces at d = 0.
        out.push([a || 0, b || 0]);
      }
    }
  }
  return out;
}
