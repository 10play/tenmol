/**
 * The renderable primitives the ray tracer intersects. Colors are RGB in 0..1
 * (the same space as `exec/color.ts` `rgbForIndex`).
 */
import type { Vec3 } from './vec';

export type Color = readonly [number, number, number];

export interface Sphere {
  kind: 'sphere';
  c: Vec3;
  r: number;
  color: Color;
}

export interface Cylinder {
  kind: 'cylinder';
  p0: Vec3;
  p1: Vec3;
  r: number;
  /** split colour: color0 for the p0 half, color1 for the p1 half. */
  color0: Color;
  color1: Color;
  caps: boolean;
}

export interface Triangle {
  kind: 'triangle';
  v0: Vec3;
  v1: Vec3;
  v2: Vec3;
  n0: Vec3;
  n1: Vec3;
  n2: Vec3;
  c0: Color;
  c1: Color;
  c2: Color;
}

export type Primitive = Sphere | Cylinder | Triangle;

/** Axis-aligned bounds of a primitive (for the BVH). */
export function primitiveBounds(p: Primitive): { min: Vec3; max: Vec3 } {
  if (p.kind === 'sphere') {
    return {
      min: [p.c[0] - p.r, p.c[1] - p.r, p.c[2] - p.r],
      max: [p.c[0] + p.r, p.c[1] + p.r, p.c[2] + p.r],
    };
  }
  if (p.kind === 'cylinder') {
    return {
      min: [
        Math.min(p.p0[0], p.p1[0]) - p.r,
        Math.min(p.p0[1], p.p1[1]) - p.r,
        Math.min(p.p0[2], p.p1[2]) - p.r,
      ],
      max: [
        Math.max(p.p0[0], p.p1[0]) + p.r,
        Math.max(p.p0[1], p.p1[1]) + p.r,
        Math.max(p.p0[2], p.p1[2]) + p.r,
      ],
    };
  }
  return {
    min: [
      Math.min(p.v0[0], p.v1[0], p.v2[0]),
      Math.min(p.v0[1], p.v1[1], p.v2[1]),
      Math.min(p.v0[2], p.v1[2], p.v2[2]),
    ],
    max: [
      Math.max(p.v0[0], p.v1[0], p.v2[0]),
      Math.max(p.v0[1], p.v1[1], p.v2[1]),
      Math.max(p.v0[2], p.v1[2], p.v2[2]),
    ],
  };
}
