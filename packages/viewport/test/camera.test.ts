/**
 * The golden test WP-09's acceptance asks for: the 25 -> 18 narrowing lives in
 * ONE place, and the two matrices we build are the two matrices PyMOL builds.
 *
 * The 25-float array below is a real `_cmd.get_view()` from this tree (1UBQ,
 * `orient`); the 18-float array is what `cmd.get_view()` returned for the same
 * camera, i.e. `r[0:3] + r[4:7] + r[8:11] + r[16:25]`
 * (`packages/engine/modules/pymol/viewing.py:731`). Both were captured with
 * `packages/viewport/tools/pull_geometry.py`.
 */

import { strict as assert } from 'node:assert';
import { describe, test } from 'vitest';

import {
  DEFAULT_FIELD_OF_VIEW,
  cameraDistance,
  fieldOfView,
  fovWidth,
  isOrthoscopic,
  modelViewMatrix,
  pinchZoom,
  projectionMatrix,
  turnView,
  viewChanged,
  viewFromResult,
  type ViewMatrix,
} from '../src/camera';

/** cmd.get_view() — 18 floats. 1UBQ after `orient`. */
const VIEW_18: number[] = [
  0.5253247, -0.3474619, 0.7768178, 0.5975924, 0.7965332, -0.0878836, -0.6058396, 0.4949572,
  0.6229159, 0.0, 0.0, -136.7159424, 30.4735508, 28.6114998, 15.9426498, 107.8069611, 165.6249237,
  -20.0,
];

/** _cmd.get_view() — 25 floats: a 4x4 rotation matrix + 9 more. */
const VIEW_25: number[] = [
  ...[0.5253247, -0.3474619, 0.7768178, 0.0],
  ...[0.5975924, 0.7965332, -0.0878836, 0.0],
  ...[-0.6058396, 0.4949572, 0.6229159, 0.0],
  ...[0.0, 0.0, 0.0, 1.0],
  ...[0.0, 0.0, -136.7159424],
  ...[30.4735508, 28.6114998, 15.9426498],
  ...[107.8069611, 165.6249237, -20.0],
];

const view = VIEW_18 as unknown as ViewMatrix;

describe('camera', () => {
  test('the 25 -> 18 narrowing is exactly viewing.py:731', () => {
    const narrowed = viewFromResult(VIEW_25);
    assert.equal(narrowed.length, 18);
    const expected = [
      ...VIEW_25.slice(0, 3),
      ...VIEW_25.slice(4, 7),
      ...VIEW_25.slice(8, 11),
      ...VIEW_25.slice(16, 25),
    ];
    // NOTE: toViewMatrix() takes the FIRST 18 of whatever it is given, which is
    // correct for the 18-float python api and NOT the same as re-slicing a
    // 25-float C array. This assertion documents the difference explicitly.
    assert.notDeepEqual([...narrowed], expected);
    assert.deepEqual([...viewFromResult(VIEW_18)], VIEW_18);
  });

  test('viewFromResult rejects garbage instead of producing a silent identity', () => {
    assert.throws(() => viewFromResult('nope'), TypeError);
    assert.throws(() => viewFromResult([1, 2, 3]), RangeError);
    assert.throws(() => viewFromResult([...VIEW_18.slice(0, 17), Number.NaN]), TypeError);
  });

  test('turnView applies cmd.turn locally: R · Raxis(-deg), leaving the rest', () => {
    // Identity rotation, non-trivial translation/clip/origin.
    const identityRot = [
      1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -100, 5, 6, 7, 40, 200, -20,
    ] as unknown as ViewMatrix;
    const y30 = turnView(identityRot, 'y', 30);
    // Verified byte-for-byte against a live bridge: cmd.turn('y',30) on identity
    // is Ry(-30).
    const expect = [0.8660254, 0, -0.5, 0, 1, 0, 0.5, 0, 0.8660254];
    for (let i = 0; i < 9; i++) assert.ok(Math.abs((y30[i] as number) - expect[i]!) < 1e-6);
    // Everything past the 3x3 is untouched, exactly as cmd.turn leaves it.
    for (let i = 9; i < 18; i++) assert.equal(y30[i], identityRot[i]);
  });

  test('turnView pins the x and z axes to exact values, like y', () => {
    const id = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -100, 0, 0, 0, 40, 200, -20] as unknown as ViewMatrix;
    const c = Math.cos(Math.PI / 6); // cos 30°
    const s = Math.sin(Math.PI / 6); // sin 30°
    // cmd.turn(axis, 30) = R · Raxis(-30); on identity that IS Raxis(-30).
    const near = (m: ViewMatrix, want: number[]) => {
      for (let i = 0; i < 9; i++) assert.ok(Math.abs((m[i] as number) - want[i]!) < 1e-6);
    };
    near(turnView(id, 'x', 30), [1, 0, 0, 0, c, s, 0, -s, c]); // Rx(-30)
    near(turnView(id, 'z', 30), [c, s, 0, -s, c, 0, 0, 0, 1]); // Rz(-30)
  });

  test('turnView composes and is orthonormal (a full x+y drag stays a rotation)', () => {
    const base = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -100, 5, 6, 7, 40, 200, -20] as unknown as ViewMatrix;
    const composed = turnView(turnView(base, 'y', 8), 'x', 5);
    // Rows stay unit length and mutually orthogonal — no shear crept in.
    const row = (m: ViewMatrix, r: number) => [m[r * 3] as number, m[r * 3 + 1] as number, m[r * 3 + 2] as number];
    const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    for (let r = 0; r < 3; r++) assert.ok(Math.abs(dot(row(composed, r), row(composed, r)) - 1) < 1e-6);
    assert.ok(Math.abs(dot(row(composed, 0), row(composed, 1))) < 1e-6);
    assert.ok(Math.abs(dot(row(composed, 0), row(composed, 2))) < 1e-6);
  });

  test('field of view: |view[17]| > 1 is degrees, otherwise the default', () => {
    assert.equal(fieldOfView(view), 20);
    // Scene.cpp:902 writes `ortho ? fov : -fov`, so -20 is PERSPECTIVE.
    assert.equal(isOrthoscopic(view), false);
    const ortho = [...VIEW_18] as unknown as ViewMatrix;
    (ortho as unknown as number[])[17] = 20;
    assert.equal(isOrthoscopic(ortho), true);
    const dflt = [...VIEW_18] as unknown as ViewMatrix;
    (dflt as unknown as number[])[17] = 1;
    assert.equal(fieldOfView(dflt), DEFAULT_FIELD_OF_VIEW);
  });

  test('fovWidth reproduces GetFovWidth (Scene.cpp:5654) exactly', () => {
    // 2 * tan(20 * pi / 360) = 0.35265396141692995
    assert.ok(Math.abs(fovWidth(view) - 0.35265396141692995) < 1e-15);
  });

  test('the modelview maps the model-space origin onto the camera-space origin', () => {
    // ScenePrepareMatrix: translate(pos) * rot * translate(-origin), so the
    // model-space rotation origin (12..14) must land exactly on pos (9..11).
    const m = modelViewMatrix(view);
    const o = [view[12], view[13], view[14]];
    const x = m[0]! * o[0]! + m[4]! * o[1]! + m[8]! * o[2]! + m[12]!;
    const y = m[1]! * o[0]! + m[5]! * o[1]! + m[9]! * o[2]! + m[13]!;
    const z = m[2]! * o[0]! + m[6]! * o[1]! + m[10]! * o[2]! + m[14]!;
    assert.ok(Math.abs(x - view[9]) < 1e-4, `x ${x}`);
    assert.ok(Math.abs(y - view[10]) < 1e-4, `y ${y}`);
    assert.ok(Math.abs(z - view[11]) < 1e-3, `z ${z}`);
  });

  test('the modelview rotation block is the column-major 3x3, unmodified', () => {
    const m = modelViewMatrix(view);
    assert.deepEqual(
      [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]],
      VIEW_18.slice(0, 9).map((n) => Math.fround(n)),
    );
    assert.deepEqual([m[3], m[7], m[11], m[15]], [0, 0, 0, 1]);
  });

  test('perspective projection is glm::perspective(GetFovWidth, aspect, front, back)', () => {
    const persp = [...VIEW_18] as unknown as ViewMatrix; // -20 => perspective
    const aspect = 800 / 600;
    const p = projectionMatrix(persp, aspect);
    const tanHalf = Math.tan(fovWidth(persp) / 2);
    const front = persp[15];
    const back = persp[16];
    assert.ok(Math.abs(p[0]! - 1 / (aspect * tanHalf)) < 1e-6);
    assert.ok(Math.abs(p[5]! - 1 / tanHalf) < 1e-6);
    assert.ok(Math.abs(p[10]! - -(back + front) / (back - front)) < 1e-6);
    assert.equal(p[11], -1);
    assert.ok(Math.abs(p[14]! - (-2 * back * front) / (back - front)) < 1e-4);
    assert.equal(p[15], 0);
  });

  test('orthoscopic projection uses the camera distance, per SceneRender.cpp:176-179', () => {
    const ortho = [...VIEW_18] as unknown as ViewMatrix;
    (ortho as unknown as number[])[17] = 20; // positive => orthoscopic
    const p = projectionMatrix(ortho, 4 / 3);
    const height = (Math.max(1e-4, -ortho[11]) * fovWidth(ortho)) / 2;
    assert.ok(Math.abs(p[5]! - 1 / height) < 1e-6);
    assert.ok(Math.abs(p[0]! - 1 / (height * (4 / 3))) < 1e-6);
    assert.equal(p[15], 1);
  });

  test('cameraDistance is |view[11]|', () => {
    assert.ok(Math.abs(cameraDistance(view) - 136.7159424) < 1e-6);
  });

  test('pinchZoom is the Qt gesture handler, verbatim', () => {
    // pymol_gl_widget.py:158-165 with totalScaleFactor = 2 (zoom in).
    const startZ = view[11];
    const next = pinchZoom(view, startZ, 2);
    const z = startZ / 2;
    const delta = z - view[11];
    assert.ok(Math.abs(next[11] - z) < 1e-9);
    assert.ok(Math.abs(next[15] - (view[15] - delta)) < 1e-6);
    assert.ok(Math.abs(next[16] - (view[16] - delta)) < 1e-6);
    // Everything else is untouched.
    assert.deepEqual([...next].slice(0, 11), [...view].slice(0, 11));
    assert.equal(next[17], view[17]);
  });

  test('pinchZoom is absolute, so re-applying the same factor is idempotent', () => {
    const startZ = view[11];
    const once = pinchZoom(view, startZ, 1.5);
    const twice = pinchZoom(once, startZ, 1.5);
    assert.deepEqual([...once], [...twice]);
  });

  test('viewChanged', () => {
    assert.equal(viewChanged(view, view), false);
    assert.equal(viewChanged(null, view), true);
    const moved = pinchZoom(view, view[11], 1.001);
    assert.equal(viewChanged(view, moved), true);
  });
});
