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

/** `MAX_VDW` (`packages/engine/layer0/Base.h`) — the zoom-radius floor. */
const MAX_VDW = 2.5;

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

/** One row of a column-major 3x3 (row `r` across the three columns). */
function rowOf(m: Mat3, r: number): [number, number, number] {
  return [m[r]!, m[3 + r]!, m[6 + r]!];
}

function dot3(a: readonly number[], b: readonly number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}

function cross3(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ];
}

/**
 * Eigen-decomposition of a symmetric 3x3 (given as [xx,yy,zz,xy,xz,yz]) by
 * cyclic Jacobi rotation. Returns the eigenvalues and unit eigenvectors sorted
 * in ascending eigenvalue order — matching `MatrixEigensolveC33d`
 * (`packages/engine/layer0/Matrix.cpp`), whose JAMA symmetric solver yields
 * ascending eigenvalues.
 */
function symEigen3(
  sym: readonly [number, number, number, number, number, number],
): { values: [number, number, number]; vectors: [[number, number, number], [number, number, number], [number, number, number]] } {
  const [xx, yy, zz, xy, xz, yz] = sym;
  const a = [xx, xy, xz, xy, yy, yz, xz, yz, zz]; // row-major working matrix
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1]; // accumulated eigenvectors (columns)
  for (let sweep = 0; sweep < 50; sweep++) {
    let p = 0, q = 1, max = Math.abs(a[1]!);
    if (Math.abs(a[2]!) > max) { max = Math.abs(a[2]!); p = 0; q = 2; }
    if (Math.abs(a[5]!) > max) { max = Math.abs(a[5]!); p = 1; q = 2; }
    if (max < 1e-14) break;
    const app = a[p * 3 + p]!;
    const aqq = a[q * 3 + q]!;
    const apq = a[p * 3 + q]!;
    const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    for (let k = 0; k < 3; k++) {
      const akp = a[k * 3 + p]!;
      const akq = a[k * 3 + q]!;
      a[k * 3 + p] = c * akp - s * akq;
      a[k * 3 + q] = s * akp + c * akq;
    }
    for (let k = 0; k < 3; k++) {
      const apk = a[p * 3 + k]!;
      const aqk = a[q * 3 + k]!;
      a[p * 3 + k] = c * apk - s * aqk;
      a[q * 3 + k] = s * apk + c * aqk;
    }
    for (let k = 0; k < 3; k++) {
      const vkp = v[k * 3 + p]!;
      const vkq = v[k * 3 + q]!;
      v[k * 3 + p] = c * vkp - s * vkq;
      v[k * 3 + q] = s * vkp + c * vkq;
    }
  }
  // Eigenvector j is column j of `v` (row-major storage).
  const cols: [number, number, number][] = [
    [v[0]!, v[3]!, v[6]!],
    [v[1]!, v[4]!, v[7]!],
    [v[2]!, v[5]!, v[8]!],
  ];
  const vals: [number, number, number] = [a[0]!, a[4]!, a[8]!];
  const order = [0, 1, 2].sort((i, j) => vals[i]! - vals[j]!);
  const norm = (u: [number, number, number]): [number, number, number] => {
    const n = Math.hypot(u[0], u[1], u[2]) || 1;
    return [u[0] / n, u[1] / n, u[2] / n];
  };
  return {
    values: [vals[order[0]!]!, vals[order[1]!]!, vals[order[2]!]!],
    vectors: [norm(cols[order[0]!]!), norm(cols[order[1]!]!), norm(cols[order[2]!]!)],
  };
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

  /**
   * `cmd.orient` (`ExecutiveOrient`, layer3/Executive.cpp) — align the
   * selection's principal components with the XYZ axes, then frame it.
   *
   * `moment` is the unweighted moment-of-inertia tensor [xx,yy,zz,xy,xz,yz]
   * about the centroid; `center`/`radius` are the window-zoom framing. The
   * model->camera rotation is built from the eigenvectors (smallest moment ->
   * camera X), made right-handed, then nudged by the least-perturbation 180°
   * flips PyMOL uses to pick the orientation closest to the current view.
   */
  orientTo(
    moment: readonly [number, number, number, number, number, number],
    center: [number, number, number],
    radius: number,
  ): void {
    const old = rotOf(this.view);
    const { values: egval, vectors: evec } = symEigen3(moment);

    // Fill the rotation so its rows are the eigenvectors (column-major storage):
    // rot[c*3 + i] = evec[i][c]. Then rot * evec[i] = camera axis i.
    let rot: Mat3 = [
      evec[0][0], evec[1][0], evec[2][0],
      evec[0][1], evec[1][1], evec[2][1],
      evec[0][2], evec[1][2], evec[2][2],
    ];

    // Ensure a right-handed matrix: flip the third eigenvector row if needed.
    const r0 = rowOf(rot, 0);
    const r1 = rowOf(rot, 1);
    const r2 = rowOf(rot, 2);
    if (dot3(cross3(r0, r1), r2) < 0) {
      rot[2] = -rot[2]!; rot[5] = -rot[5]!; rot[8] = -rot[8]!;
    }

    // Eigenvalue-ordering swaps (dead for the ascending order symEigen3
    // returns, but kept for fidelity with ExecutiveOrient).
    const [e0, e1, e2] = egval;
    if (e0 < e2 && e2 < e1) rot = mul3(axisAngle('x', 90), rot);
    else if (e1 < e0 && e0 < e2) rot = mul3(axisAngle('z', 90), rot);
    else if (e1 < e2 && e2 < e0) rot = mul3(axisAngle('z', 90), mul3(axisAngle('y', 90), rot));
    else if (e2 < e1 && e1 < e0) rot = mul3(axisAngle('y', 90), rot);
    else if (e2 < e0 && e0 < e1) rot = mul3(axisAngle('x', 90), mul3(axisAngle('y', 90), rot));

    // Choose the orientation with the least perturbation from the current view.
    const x = dot3(rowOf(old, 0), rowOf(rot, 0));
    const y = dot3(rowOf(old, 1), rowOf(rot, 1));
    const z = dot3(rowOf(old, 2), rowOf(rot, 2));
    if (x > 0 && y < 0 && z < 0) rot = mul3(axisAngle('x', 180), rot);
    else if (x < 0 && y > 0 && z < 0) rot = mul3(axisAngle('y', 180), rot);
    else if (x < 0 && y < 0 && z > 0) rot = mul3(axisAngle('z', 180), rot);

    writeRot(this.view, rot);
    this.windowSphere(center, radius);
  }

  /**
   * `SceneWindowSphere` (`packages/engine/layer1/Scene.cpp`) — dolly the camera
   * so a sphere of `radius` about `center` fills the field of view, bracketing
   * the clipping slab at ±1.2·radius. `center` becomes the rotation origin, so
   * the camera-space offset is zero and only the Z distance changes.
   */
  private windowSphere(center: [number, number, number], radius: number): void {
    const r = Math.max(radius, MAX_VDW);
    const dist = r / Math.tan((DEFAULT_FOV * Math.PI) / 360);
    this.view[12] = center[0];
    this.view[13] = center[1];
    this.view[14] = center[2];
    this.view[9] = 0;
    this.view[10] = 0;
    this.view[11] = -dist;
    this.view[15] = dist - r * 1.2;
    this.view[16] = dist + r * 1.2;
  }
}
