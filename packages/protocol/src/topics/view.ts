/**
 * Topic `view` — the camera.  OWNER: WP-09.
 *
 * THE ASYMMETRY THAT BREAKS EVERY NAIVE IMPLEMENTATION: `cmd.get_view()`
 * returns **25** floats (`modules/pymol/viewing.py:634`, layout at `:660-676`)
 * while `cmd.set_view()` requires exactly **18**. WP-09's acceptance says that
 * slice lives in exactly one file with a golden test; this is the type that
 * makes the 18 explicit on the wire.
 *
 *   0-8   column-major 3x3 model->camera rotation
 *   9-11  origin of rotation relative to camera (camera space)
 *   12-14 origin of rotation (model space)
 *   15    front plane distance from camera
 *   16    rear plane distance from camera
 *   17    orthoscopic flag (+/-) and field of view when abs(value) > 1
 *   18-24 (get_view only) the 4x4-ish extras `set_view` rejects
 */

export type ViewMatrix = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export const VIEW_MATRIX_LENGTH = 18;
/** What `cmd.get_view()` actually returns. */
export const GET_VIEW_LENGTH = 25;

export function isViewMatrix(v: unknown): v is ViewMatrix {
  return (
    Array.isArray(v) && v.length === VIEW_MATRIX_LENGTH && v.every((n) => typeof n === 'number')
  );
}

/** The one legal narrowing of a 25-float `get_view()` to a `set_view()` argument. */
export function toViewMatrix(v: readonly number[]): ViewMatrix {
  if (v.length < VIEW_MATRIX_LENGTH) {
    throw new RangeError(
      `get_view() returned ${v.length} floats, need at least ${VIEW_MATRIX_LENGTH}`,
    );
  }
  return v.slice(0, VIEW_MATRIX_LENGTH) as unknown as ViewMatrix;
}

export interface ViewPayload {
  view: ViewMatrix;
  /**
   * `cmd.get_viewport()`. With `internal_gui 0` + `internal_feedback 0` this
   * equals the canvas size; without them `reshape(640,480)` yields (420,462)
   * and every mouse coordinate is wrong (plan §1.1 step 6, spike 04).
   */
  viewport?: readonly [number, number];
}
