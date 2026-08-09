/**
 * The camera contract — the ONE file that knows PyMOL's view matrix.
 *
 * `cmd.get_view()` (the PYTHON api, `packages/engine/modules/pymol/viewing.py:731`) returns
 * **18** floats; `_cmd.get_view()` returns **25** and the Python wrapper slices
 * `r[0:3] + r[4:7] + r[8:11] + r[16:25]`. `cmd.set_view()` accepts exactly 18.
 * WP-09's acceptance says that narrowing lives in exactly one file with a
 * golden test: it is `@tenmol/protocol`'s `toViewMatrix()`, re-exported here,
 * and `packages/engine/test/camera.test.ts` is the golden test.
 *
 * Layout (`packages/engine/modules/pymol/viewing.py:660-676`):
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

/** `cSetting_field_of_view` default (`packages/engine/layer1/SettingInfo.h`, field_of_view). */
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
 * (`packages/engine/layer1/Scene.cpp:902`, and `:580` for scenes), so a POSITIVE value means
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
 * `GetFovWidth` (`packages/engine/layer1/Scene.cpp:5654-5661`): the field-of-view WIDTH at a
 * depth of 1.0, `2 * tan(fov * PI / 360)`.
 *
 * PyMOL then passes this straight into `glm::perspective(GetFovWidth(G), ...)`
 * (`packages/engine/layer1/SceneRender.cpp:173`) whose first parameter is documented as an
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
 * `ScenePrepareMatrix` (`packages/engine/layer1/Scene.cpp:5306-5310`):
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
 * `SceneProjectionMatrix` (`packages/engine/layer1/SceneRender.cpp:166-181`).
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
    // R_SMALL4 == 1e-4 (`packages/engine/layer0/os_predef.h`).
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
 * (`packages/engine/modules/pmg_qt/pymol_gl_widget.py:152-166`):
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

/**
 * tenmol-only: apply `cmd.turn(axis, degrees)` to a view matrix locally, so a
 * GL-free client can render a rotation WITHOUT the `cmd.turn` + `get_view` round
 * trip that otherwise caps a remote drag at one frame per RTT (measured ~2 fps).
 * PyMOL stays authoritative — this only advances the client between the turns it
 * has already sent, and `get_view` reconciles the moment the drag pauses.
 *
 * The relationship is `R' = R · Raxis(-degrees)`, verified byte-for-byte against
 * a live bridge for x, y, z and composed drags (`cmd.turn('y',θ)` on identity
 * yields `Ry(-θ)`; on a non-trivial `R` it post-multiplies). Only the 3×3
 * rotation submatrix (`view[0..8]`) changes; translation, clipping and the
 * origin are untouched, exactly as `cmd.turn` leaves them. `get_view` remains
 * authoritative and reconciles the moment the drag pauses.
 */
export function turnView(view: ViewMatrix, axis: 'x' | 'y' | 'z', degrees: number): ViewMatrix {
  const t = (-degrees * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  // Row-major rotation about the eye-space axis, matching PyMOL's convention.
  const rot =
    axis === 'x'
      ? [1, 0, 0, 0, c, -s, 0, s, c]
      : axis === 'y'
        ? [c, 0, s, 0, 1, 0, -s, 0, c]
        : [c, -s, 0, s, c, 0, 0, 0, 1];
  const next = view.slice() as unknown as number[];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += (view[i * 3 + k] as number) * rot[k * 3 + j]!;
      next[i * 3 + j] = sum;
    }
  }
  return next as unknown as ViewMatrix;
}

/**
 * True when two views differ enough to be worth a redraw.
 *
 * NOT A SETTLE DETECTOR. `false` here means "these two samples are equal", and
 * during a camera sweep two samples taken less than one key frame apart are
 * ALWAYS equal — see `createSettleDetector` below for why that matters.
 */
export function viewChanged(a: ViewMatrix | null, b: ViewMatrix | null, eps = 1e-6): boolean {
  if (a === null || b === null) return a !== b;
  for (let i = 0; i < VIEW_MATRIX_LENGTH; i++) {
    if (Math.abs((a[i] as number) - (b[i] as number)) > eps) return true;
  }
  return false;
}

/* ==========================================================================
 * Camera ANIMATION — when the backend camera actually arrives.
 *
 * `feature-parity.md:337`, measured over the socket in
 * `packages/bridge/tests/test_f7_camera.py`. Everything below is the client-side half of
 * those measurements; none of it is guesswork.
 *
 * THE THREE FACTS:
 *
 * 1. `cmd.zoom/center/orient/set_view` with `animate != 0` return in ~0.3 ms
 *    with the camera BYTE-IDENTICAL to where it started — `SceneLoadAnimation`
 *    ends by putting the camera back on key frame 0 (`packages/engine/layer1/Scene.cpp:420`).
 *    Reading `get_view()` in the `.then()` of such a call reads the OLD camera.
 *    `turn`, `move`, `clip`, `origin` and `reset` take no `animate` at all and
 *    land before the reply.
 *
 * 2. The sweep is `int(duration * 30)` DISCRETE key frames (`Scene.cpp:401`,
 *    capped at `MAX_ANI_ELEM` 300) and `SceneUpdateAnimation` SNAPS to the
 *    current one (`:4523-4531`) instead of blending. Measured distinct
 *    `view[11]` values while polling at ~4 kHz: 4 / 16 / 31 for 0.1 / 0.5 /
 *    1.0 s — exactly `int(d*30) + 1`.
 *
 * 3. So "poll until two consecutive reads agree" is WRONG. A `get_view` round
 *    trip is 0.24 ms; the second read of a freshly started sweep is inside the
 *    same 33 ms key frame and therefore identical. Measured: that detector
 *    reports "settled" on its FIRST poll, 161 A from the target.
 *
 * Two more consequences a caller has to know:
 *   * `cmd.turn`/`cmd.move` issued during a sweep are silently discarded — the
 *     next key frame restores all 18 floats. A drag on top of a toolbar
 *     `zoom animate=1.0` does nothing.
 *   * A second animated command ABANDONS the first where it stands
 *     (`ScenePrimeAnimation`, `Scene.cpp:326-328`); the first target is never
 *     reached and nothing reports it. There is no `cmd.is_animating`.
 * ========================================================================== */

/** Key frames per second: `int(duration * 30)` in `SceneLoadAnimation`. */
export const ANI_ELEM_HZ = 30;

/** `packages/engine/layer1/SceneDef.h:39` — the key-frame array is this long, so a sweep
 * longer than `MAX_ANI_ELEM / ANI_ELEM_HZ` = 10 s simply gets coarser. */
export const MAX_ANI_ELEM = 300;

/** Milliseconds between key frames: 33.33 at 30 Hz. */
export const KEY_FRAME_MS = 1000 / ANI_ELEM_HZ;

/** `animation_duration` default (`packages/engine/layer1/SettingInfo.h:484`). */
export const DEFAULT_ANIMATION_DURATION = 0.75;

/** How many key frames a sweep of `duration` seconds is cut into. */
export function animationKeyFrames(duration: number): number {
  if (!(duration > 0)) return 0;
  return Math.min(MAX_ANI_ELEM, Math.max(1, Math.floor(duration * ANI_ELEM_HZ)));
}

/**
 * The seconds a camera command will actually sweep for.
 *
 * `animate < 0` means "ask the settings": `animation ? animation_duration : 0`.
 * That resolution is repeated verbatim in `ExecutiveWindowZoom`
 * (`packages/engine/layer3/Executive.cpp:13433-13438`), `ExecutiveCenter` (`:13494`),
 * `ExecutiveOrient` (`:10065`) and `SceneSetView` (`packages/engine/layer1/Scene.cpp:924-929`).
 * Returns 0 for "lands instantly".
 *
 * NOTE the different setting pair for scenes: `cmd.scene(...)` resolves through
 * `scene_animation` / `scene_animation_duration` (2.25 s), not these.
 */
export function resolveAnimate(
  animate: number,
  animationOn: boolean,
  animationDuration: number = DEFAULT_ANIMATION_DURATION,
): number {
  if (animate < 0) return animationOn ? Math.max(0, animationDuration) : 0;
  return Math.max(0, animate);
}

/** A poll-based "has the backend camera stopped moving?" test. */
export interface SettleDetector {
  /**
   * Feed one `get_view()` sample. Returns true once the view has been
   * unchanged for at least the quiet window.
   */
  push(view: ViewMatrix | null, nowMs: number): boolean;
  /** Forget everything — call when a new command is issued. */
  reset(): void;
}

/**
 * The settle detector fact (3) above says you need.
 *
 * `quietMs` must exceed one key frame or the detector is the broken two-sample
 * one again; the default is two key frames, which tolerates a missed draw.
 * Feeding `null` (no sample yet) never settles.
 */
export function createSettleDetector(quietMs: number = KEY_FRAME_MS * 2): SettleDetector {
  if (!(quietMs > KEY_FRAME_MS)) {
    throw new RangeError(
      `quiet window ${quietMs} ms is not longer than one key frame (${KEY_FRAME_MS} ms); ` +
        'two samples inside one key frame are always equal, so this would settle instantly',
    );
  }
  let last: ViewMatrix | null = null;
  let stillSince: number | null = null;
  return {
    push(view: ViewMatrix | null, nowMs: number): boolean {
      if (view === null) {
        last = null;
        stillSince = null;
        return false;
      }
      if (last === null || viewChanged(last, view, 0)) {
        last = view;
        stillSince = nowMs;
        return false;
      }
      return nowMs - (stillSince as number) >= quietMs;
    },
    reset(): void {
      last = null;
      stillSince = null;
    },
  };
}
