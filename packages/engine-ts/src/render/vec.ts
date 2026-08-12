/**
 * Minimal vec3 / mat3 helpers for the CPU ray tracer. Self-contained (the engine
 * has no shared vec-math module) and allocation-light where it matters.
 */

export type Vec3 = readonly [number, number, number];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const addScaled = (a: Vec3, b: Vec3, s: number): Vec3 => [
  a[0] + b[0] * s,
  a[1] + b[1] * s,
  a[2] + b[2] * s,
];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Apply a column-major 3×3 matrix to a vector: `m · v`. */
export const applyMat3 = (m: ArrayLike<number>, v: Vec3): Vec3 => [
  m[0]! * v[0] + m[3]! * v[1] + m[6]! * v[2],
  m[1]! * v[0] + m[4]! * v[1] + m[7]! * v[2],
  m[2]! * v[0] + m[5]! * v[1] + m[8]! * v[2],
];

/** Apply the transpose of a column-major 3×3 matrix: `mᵀ · v` (= inverse for a
 *  pure rotation). */
export const applyMat3T = (m: ArrayLike<number>, v: Vec3): Vec3 => [
  m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
  m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2],
  m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2],
];

/** Apply a row-major homogeneous 4×4 to a point (w=1). Used for objectMatrix. */
export const applyMat4Point = (m: ArrayLike<number>, p: Vec3): Vec3 => [
  m[0]! * p[0] + m[1]! * p[1] + m[2]! * p[2] + m[3]!,
  m[4]! * p[0] + m[5]! * p[1] + m[6]! * p[2] + m[7]!,
  m[8]! * p[0] + m[9]! * p[1] + m[10]! * p[2] + m[11]!,
];

/** Apply a row-major homogeneous 4×4's rotation part to a direction (w=0). */
export const applyMat4Dir = (m: ArrayLike<number>, v: Vec3): Vec3 => [
  m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
  m[4]! * v[0] + m[5]! * v[1] + m[6]! * v[2],
  m[8]! * v[0] + m[9]! * v[1] + m[10]! * v[2],
];

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
