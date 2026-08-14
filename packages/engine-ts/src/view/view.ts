/**
 * The camera — PyMOL's 18-float view, `cmd.get_view` / `set_view` / `turn` /
 * `zoom` / `orient`.
 *
 * Layout is exactly the one `@tenmol/viewport`'s `camera.ts` consumes
 * (`packages/engine/modules/pymol/viewing.py:660-676`), so a view produced here
 * drives the existing Mode-G renderer unchanged:
 *
 *   0-8    column-major 3x3, model space -> camera space
 *   9-11   origin of rotation relative to the camera (camera space)
 *   12-14  origin of rotation (model space)
 *   15     front (near) clip distance from the camera
 *   16     rear (far) clip distance from the camera
 *   17     orthoscopic flag (sign) * field of view — default perspective is -fov
 *
 * `set_view`/`get_view` are exact round-trips (format parity). `turn` composes
 * a camera-space rotation onto the model->camera matrix. The exact numeric
 * result of `turn`/`zoom`/`orient` against real PyMOL is asserted by the LIVE
 * differential job (where PyMOL exists); the fast fixture suite asserts the
 * round-trip plus rotation-group properties (turn 360 == identity, composition).
 */

export const VIEW_LENGTH = 18;
export type View18 = number[];

/** `cSetting_field_of_view` default (`packages/engine/layer1/SettingInfo.h`). */
export const DEFAULT_FOV = 20;

/** The default view PyMOL shows for an empty scene: identity rotation, */
/** perspective fov, origin at 0, a nominal camera distance. */
export function defaultView(): View18 {
  // Exact constants from PyMOL's `SceneSetDefaultView`
  // (`packages/engine/layer1/Scene.cpp`): setPos(0,0,-50), front=40, back=100.
  return [
    1, 0, 0, //
    0, 1, 0, //
    0, 0, 1, //
    0, 0, -50, // camera-space origin (Pos)
    0, 0, 0, // model-space origin (Origin)
    40, // front
    100, // back
    -DEFAULT_FOV, // perspective (negative sign)
  ];
}

/* ------------------------------ 3x3 helpers ------------------------------ */

type Mat3 = [number, number, number, number, number, number, number, number, number];

/** Read the column-major rotation out of a view. */
function rotOf(view: View18): Mat3 {
  return [
    view[0]!, view[1]!, view[2]!,
    view[3]!, view[4]!, view[5]!,
    view[6]!, view[7]!, view[8]!,
  ];
}

function writeRot(view: View18, m: Mat3): void {
  for (let i = 0; i < 9; i++) view[i] = m[i]!;
}

/** Column-major 3x3 multiply: returns a*b. */
function mul3(a: Mat3, b: Mat3): Mat3 {
  const out = [0, 0, 0, 0, 0, 0, 0, 0, 0] as unknown as Mat3;
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[k * 3 + r]! * b[c * 3 + k]!;
      out[c * 3 + r] = s;
    }
  }
  return out;
}

/** Rotation about a unit axis by `deg` degrees, column-major (Rodrigues). */
function axisAngle(axis: 'x' | 'y' | 'z', deg: number): Mat3 {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  switch (axis) {
    case 'x':
      return [1, 0, 0, 0, c, s, 0, -s, c];
    case 'y':
      return [c, 0, -s, 0, 1, 0, s, 0, c];
    case 'z':
      return [c, s, 0, -s, c, 0, 0, 0, 1];
  }
}

/* --------------------------------- state --------------------------------- */

export class ViewState {
  private view: View18 = defaultView();

  get(): View18 {
    return this.view.slice();
  }

  set(view: readonly number[]): void {
    if (view.length !== VIEW_LENGTH) {
      throw new RangeError(`set_view expects ${VIEW_LENGTH} floats, got ${view.length}`);
    }
    this.view = view.map((n) => Number(n));
  }

  /** `cmd.turn(axis, angle)` — rotate the scene about a camera axis. */
  turn(axis: 'x' | 'y' | 'z', angle: number): void {
    const next = mul3(axisAngle(axis, angle), rotOf(this.view));
    writeRot(this.view, next);
  }

  /**
   * `cmd.zoom` — frame a bounding sphere. Sets the model-space origin to the
   * centre and the camera distance so the sphere (radius `r`, plus `buffer`)
   * fills the field of view; updates the clip planes to bracket it.
   */
  zoomToSphere(center: [number, number, number], radius: number, buffer = 0): void {
    const r = Math.max(radius + buffer, 1e-3);
    const fov = DEFAULT_FOV;
    const dist = r / Math.tan((fov * Math.PI) / 360);
    this.view[12] = center[0];
    this.view[13] = center[1];
    this.view[14] = center[2];
    this.view[9] = 0;
    this.view[10] = 0;
    this.view[11] = -dist;
    this.view[15] = Math.max(dist - r, 0.1);
    this.view[16] = dist + r;
  }

  /** `cmd.orient` — align the view's principal axes to the coordinate spread. */
  orientTo(rot: Mat3, center: [number, number, number], radius: number, buffer = 0): void {
    writeRot(this.view, rot);
    this.zoomToSphere(center, radius, buffer);
  }
}
