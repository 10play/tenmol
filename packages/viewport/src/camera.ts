/**
 * The camera contract — the ONE file that knows PyMOL's view matrix.
 *
 * `cmd.get_view()` (the PYTHON api, `modules/pymol/viewing.py:731`) returns
 * **18** floats; `_cmd.get_view()` returns **25** and the Python wrapper slices
 * `r[0:3] + r[4:7] + r[8:11] + r[16:25]`. `cmd.set_view()` accepts exactly 18.
 * WP-09's acceptance says that narrowing lives in exactly one file with a
 * golden test: it is `@tenmol/protocol`'s `toViewMatrix()`, re-exported here,
 * and `test/camera.test.ts` is the golden test.
 *
 * Layout (`modules/pymol/viewing.py:660-676`):
 *
 *   0-8    column-major 3x3, model space -> camera space
 *   9-11   origin of rotation relative to the camera (camera space)
 *   12-14  origin of rotation (model space)
 *   15     front plane distance from the camera
 *   16     rear plane distance from the camera
 *   17     orthoscopic flag (sign) and field of view (when abs(value) > 1)
 *
 * Everything below is pure: no three.js, no DOM. `modeG/camera.ts` turns these
 * numbers into a `THREE.Camera`.
 */

import {
  GET_VIEW_LENGTH,
  VIEW_MATRIX_LENGTH,
  toViewMatrix,
  type ViewMatrix,
} from '@tenmol/protocol';

export { GET_VIEW_LENGTH, VIEW_MATRIX_LENGTH, toViewMatrix };
export type { ViewMatrix };

/** `cSetting_field_of_view` default (`layer1/SettingInfo.h`, field_of_view). */
export const DEFAULT_FIELD_OF_VIEW = 20;

/**
 * Accept whatever the bridge returned for `cmd.get_view()` (18 floats) or
 * `_cmd.get_view()` (25) and narrow it to the 18 `set_view` takes.
 */
export function viewFromResult(result: unknown): ViewMatrix {
  if (!Array.isArray(result)) {
    throw new TypeError(`get_view() returned ${typeof result}, expected an array`);
  }
  const nums = result.map((n) => Number(n));
  if (nums.some((n) => !Number.isFinite(n))) {
    throw new TypeError('get_view() returned a non-finite element');
  }
  if (nums.length !== VIEW_MATRIX_LENGTH && nums.length !== GET_VIEW_LENGTH) {
    throw new RangeError(
      `get_view() returned ${nums.length} floats, expected ${VIEW_MATRIX_LENGTH} (cmd) or ${GET_VIEW_LENGTH} (_cmd)`,
    );
  }
  return toViewMatrix(nums);
}

/**
 * Is this view orthoscopic?
 *
 * THE SIGN IS THE OPPOSITE OF WHAT IT LOOKS LIKE. `SceneGetView` writes
 * `SettingGetGlobal_b(G, cSetting_ortho) ? fov : -fov`
 * (`layer1/Scene.cpp:902`, and `:580` for scenes), so a POSITIVE value means
 * orthoscopic and a NEGATIVE one means perspective — and `SceneSetView`
 * (`:972-981`) reads it back the same way. PyMOL's default (`ortho 0`) is
 * perspective, i.e. `view[17] == -20`.
 *
 * Measured: reading this backwards renders Mode G ~3 % larger than Mode P at
 * fov 20, which is exactly what the browser-side silhouette comparison caught.
 */
export function isOrthoscopic(view: ViewMatrix): boolean {
  return view[17] > 0;
}

/** Vertical field of view in degrees. `abs(view[17]) <= 1` means "the default". */
export function fieldOfView(view: ViewMatrix): number {
  const v = Math.abs(view[17]);
  return v > 1 ? v : DEFAULT_FIELD_OF_VIEW;
}

/**
 * `GetFovWidth` (`layer1/Scene.cpp:5654-5661`): the field-of-view WIDTH at a
 * depth of 1.0, `2 * tan(fov * PI / 360)`.
 *
 * PyMOL then passes this straight into `glm::perspective(GetFovWidth(G), ...)`
 * (`layer1/SceneRender.cpp:173`) whose first parameter is documented as an
 * ANGLE IN RADIANS. That is a real quirk of the upstream code, not a typo here:
 * the effective half-angle tangent is `tan(GetFovWidth / 2)`, not
 * `GetFovWidth / 2`. Reproducing it is the difference between a Mode-G image
 * that overlays the Mode-P image and one that is ~1 % off at fov 20.
 */
export function fovWidth(view: ViewMatrix): number {
  return 2 * Math.tan((fieldOfView(view) * Math.PI) / 360);
}

/** Distance from the camera to the origin of rotation (always positive). */
export function cameraDistance(view: ViewMatrix): number {
  return Math.abs(view[11]);
}

/**
 * The 4x4 model->camera matrix, column-major (GL / `THREE.Matrix4.elements`).
 *
 * `ScenePrepareMatrix` (`layer1/Scene.cpp:5306-5310`):
 *   translate(pos) * rotMatrix * translate(-origin)
 */
export function modelViewMatrix(view: ViewMatrix): Float32Array {
  const r = view;
  const m = new Float32Array(16);
  // Rotation, column-major 3x3 -> 4x4.
  m[0] = r[0];
  m[1] = r[1];
  m[2] = r[2];
  m[3] = 0;
  m[4] = r[3];
  m[5] = r[4];
  m[6] = r[5];
  m[7] = 0;
  m[8] = r[6];
  m[9] = r[7];
  m[10] = r[8];
  m[11] = 0;
  // translate(pos) on the left, translate(-origin) on the right: the
  // translation column is pos - R * origin.
  const ox = r[12];
  const oy = r[13];
  const oz = r[14];
  m[12] = r[9] - (r[0] * ox + r[3] * oy + r[6] * oz);
  m[13] = r[10] - (r[1] * ox + r[4] * oy + r[7] * oz);
  m[14] = r[11] - (r[2] * ox + r[5] * oy + r[8] * oz);
  m[15] = 1;
  return m;
}

/**
 * The projection matrix, column-major, byte-for-byte equivalent to
 * `SceneProjectionMatrix` (`layer1/SceneRender.cpp:166-181`).
 *
 * Perspective: `glm::perspective(GetFovWidth, aspect, front, back)`.
 * Ortho:       height = max(1e-4, -pos.z) * GetFovWidth / 2, width = height * aspect.
 */
export function projectionMatrix(view: ViewMatrix, aspect: number): Float32Array {
  const front = view[15];
  const back = view[16];
  const m = new Float32Array(16);
  if (!isOrthoscopic(view)) {
    const tanHalf = Math.tan(fovWidth(view) / 2);
    m[0] = 1 / (aspect * tanHalf);
    m[5] = 1 / tanHalf;
    m[10] = -(back + front) / (back - front);
    m[11] = -1;
    m[14] = -(2 * back * front) / (back - front);
  } else {
    // R_SMALL4 == 1e-4 (`layer0/os_predef.h`).
    const height = (Math.max(1e-4, -view[11]) * fovWidth(view)) / 2;
    const width = height * aspect;
    m[0] = 1 / width;
    m[5] = 1 / height;
    m[10] = -2 / (back - front);
    m[14] = -(back + front) / (back - front);
    m[15] = 1;
  }
  return m;
}

/**
 * Pinch-zoom, ported verbatim from `PyMOLGLWidget.gestureEvent`
 * (`modules/pmg_qt/pymol_gl_widget.py:152-166`):
 *
 *     z = pinch_start_z / totalScaleFactor
 *     delta = z - view[11]
 *     view[11] = z; view[15] -= delta; view[16] -= delta
 *
 * `startZ` is `get_view()[11]` sampled when the gesture began, NOT the current
 * value — a pinch is absolute, so re-deriving it per event makes the zoom
 * compound and run away.
 */
export function pinchZoom(view: ViewMatrix, startZ: number, totalScaleFactor: number): ViewMatrix {
  const scale = totalScaleFactor === 0 ? 1 : totalScaleFactor;
  const next = view.slice() as unknown as number[];
  const z = startZ / scale;
  const delta = z - next[11]!;
  next[11] = z;
  next[15] = next[15]! - delta;
  next[16] = next[16]! - delta;
  return next as unknown as ViewMatrix;
}

/** True when two views differ enough to be worth a redraw. */
export function viewChanged(a: ViewMatrix | null, b: ViewMatrix | null, eps = 1e-6): boolean {
  if (a === null || b === null) return a !== b;
  for (let i = 0; i < VIEW_MATRIX_LENGTH; i++) {
    if (Math.abs((a[i] as number) - (b[i] as number)) > eps) return true;
  }
  return false;
}
