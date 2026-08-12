/**
 * The CPU ray tracer. Casts a ray per pixel, finds the nearest primitive hit,
 * and shades it with PyMOL's two-light model (mirroring
 * `packages/viewport/src/modeG/materials/lighting.ts`, which is itself a port of
 * `Ray.cpp`). Phase 1: brute-force intersection, no shadows/AA/fog — those layer
 * on in phase 2 without changing this interface.
 */
import type { Camera } from './camera';
import type { Color, Cylinder, Primitive, Sphere, Triangle } from './primitives';
import { primitiveBounds } from './primitives';
import {
  addScaled,
  clamp01,
  dot,
  len,
  norm,
  sub,
  type Vec3,
} from './vec';

const EPS = 1e-4;

interface Hit {
  t: number;
  normal: Vec3; // world-space, outward
  color: Color;
}

/* ------------------------------ intersections ---------------------------- */

function hitSphere(o: Vec3, d: Vec3, s: Sphere, tMax: number): Hit | null {
  const oc = sub(o, s.c);
  const b = dot(oc, d);
  const c = dot(oc, oc) - s.r * s.r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = -b - sq;
  if (t < EPS) t = -b + sq;
  if (t < EPS || t > tMax) return null;
  const p = addScaled(o, d, t);
  return { t, normal: norm(sub(p, s.c)), color: s.color };
}

function hitCylinder(o: Vec3, d: Vec3, cyl: Cylinder, tMax: number): Hit | null {
  const axisRaw = sub(cyl.p1, cyl.p0);
  const h = len(axisRaw) || 1;
  const a: Vec3 = [axisRaw[0] / h, axisRaw[1] / h, axisRaw[2] / h];
  const dp = sub(o, cyl.p0);
  const dPar = dot(d, a);
  const dpPar = dot(dp, a);
  const dPerp = sub(d, [a[0] * dPar, a[1] * dPar, a[2] * dPar]);
  const dpPerp = sub(dp, [a[0] * dpPar, a[1] * dpPar, a[2] * dpPar]);

  let best: Hit | null = null;
  const consider = (t: number, normal: Vec3, s: number): void => {
    if (t < EPS || t > tMax || (best && t >= best.t)) return;
    const frac = s / h;
    best = { t, normal, color: frac < 0.5 ? cyl.color0 : cyl.color1 };
  };

  // Body.
  const A = dot(dPerp, dPerp);
  if (A > 1e-12) {
    const B = 2 * dot(dPerp, dpPerp);
    const C = dot(dpPerp, dpPerp) - cyl.r * cyl.r;
    const disc = B * B - 4 * A * C;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
        const sAxis = dpPar + t * dPar;
        if (sAxis >= 0 && sAxis <= h) {
          const hp = addScaled(o, d, t);
          const axisPt: Vec3 = [
            cyl.p0[0] + a[0] * sAxis,
            cyl.p0[1] + a[1] * sAxis,
            cyl.p0[2] + a[2] * sAxis,
          ];
          consider(t, norm(sub(hp, axisPt)), sAxis);
          break; // nearer root first; if valid, it's the body hit
        }
      }
    }
  }

  // Caps.
  if (cyl.caps && Math.abs(dPar) > 1e-9) {
    for (const [center, nrm, sAxis] of [
      [cyl.p0, [-a[0], -a[1], -a[2]] as Vec3, 0],
      [cyl.p1, a, h],
    ] as Array<[Vec3, Vec3, number]>) {
      const t = -dot(sub(o, center), nrm) / dot(d, nrm);
      if (t < EPS || t > tMax) continue;
      const hp = addScaled(o, d, t);
      if (len(sub(hp, center)) <= cyl.r) consider(t, nrm, sAxis);
    }
  }
  return best;
}

/** A scene wrapped with a nearest-hit query (swapped for a BVH in phase 2). */
export interface Scene {
  intersect(o: Vec3, d: Vec3, tMax: number): Hit | null;
  /** Any hit within `tMax` (for shadow rays; can early-out). */
  occluded(o: Vec3, d: Vec3, tMax: number): boolean;
}

export function bruteScene(prims: Primitive[]): Scene {
  return {
    intersect(o, d, tMax) {
      let best: Hit | null = null;
      let lim = tMax;
      for (const p of prims) {
        const h = hitPrim(o, d, p, lim);
        if (h) {
          best = h;
          lim = h.t;
        }
      }
      return best;
    },
    occluded(o, d, tMax) {
      for (const p of prims) if (hitPrim(o, d, p, tMax)) return true;
      return false;
    },
  };
}

function hitPrim(o: Vec3, d: Vec3, p: Primitive, tMax: number): Hit | null {
  return p.kind === 'sphere'
    ? hitSphere(o, d, p, tMax)
    : p.kind === 'cylinder'
      ? hitCylinder(o, d, p, tMax)
      : hitTriangle(o, d, p, tMax);
}

/* ----------------------------------- BVH --------------------------------- */

type Aabb = { min: Vec3; max: Vec3 };
interface BvhNode {
  min: Vec3;
  max: Vec3;
  /** Leaf: indices into the primitive array. Interior: undefined. */
  prims?: number[];
  left?: BvhNode;
  right?: BvhNode;
}

const LEAF_SIZE = 4;

function unionBounds(a: Aabb, b: Aabb): Aabb {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

/** Slab test → near-t of the ray/box overlap, or null if it misses within tMax. */
function hitAabb(o: Vec3, invD: Vec3, node: BvhNode, tMax: number): number | null {
  let t0 = 0;
  let t1 = tMax;
  for (let k = 0; k < 3; k++) {
    const near = (node.min[k]! - o[k]!) * invD[k]!;
    const far = (node.max[k]! - o[k]!) * invD[k]!;
    const lo = near < far ? near : far;
    const hi = near < far ? far : near;
    if (lo > t0) t0 = lo;
    if (hi < t1) t1 = hi;
    if (t0 > t1) return null;
  }
  return t0;
}

/** Median-split BVH over primitive AABBs — the same nearest-hit / occlusion API. */
export function bvhScene(prims: Primitive[]): Scene {
  if (prims.length <= LEAF_SIZE) return bruteScene(prims);

  const bounds: Aabb[] = prims.map(primitiveBounds);
  const centroid = (i: number): Vec3 => [
    (bounds[i]!.min[0] + bounds[i]!.max[0]) * 0.5,
    (bounds[i]!.min[1] + bounds[i]!.max[1]) * 0.5,
    (bounds[i]!.min[2] + bounds[i]!.max[2]) * 0.5,
  ];

  const build = (idx: number[]): BvhNode => {
    let box = bounds[idx[0]!]!;
    for (let i = 1; i < idx.length; i++) box = unionBounds(box, bounds[idx[i]!]!);
    if (idx.length <= LEAF_SIZE) return { min: box.min, max: box.max, prims: idx };

    // Split along the axis of greatest centroid spread, at the median.
    let cmin: Vec3 = [Infinity, Infinity, Infinity];
    let cmax: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const i of idx) {
      const c = centroid(i);
      cmin = [Math.min(cmin[0], c[0]), Math.min(cmin[1], c[1]), Math.min(cmin[2], c[2])];
      cmax = [Math.max(cmax[0], c[0]), Math.max(cmax[1], c[1]), Math.max(cmax[2], c[2])];
    }
    const ext: Vec3 = [cmax[0] - cmin[0], cmax[1] - cmin[1], cmax[2] - cmin[2]];
    const axis = ext[0] >= ext[1] && ext[0] >= ext[2] ? 0 : ext[1] >= ext[2] ? 1 : 2;
    const sorted = [...idx].sort((a, b) => centroid(a)[axis] - centroid(b)[axis]);
    const mid = sorted.length >> 1;
    const leftIdx = sorted.slice(0, mid);
    const rightIdx = sorted.slice(mid);
    // Degenerate split (all centroids coincident) → keep as a leaf.
    if (leftIdx.length === 0 || rightIdx.length === 0) {
      return { min: box.min, max: box.max, prims: idx };
    }
    return { min: box.min, max: box.max, left: build(leftIdx), right: build(rightIdx) };
  };

  const root = build(prims.map((_, i) => i));

  const traverse = (o: Vec3, d: Vec3, tMax: number, anyHit: boolean): Hit | null => {
    const invD: Vec3 = [1 / d[0], 1 / d[1], 1 / d[2]];
    let best: Hit | null = null;
    let lim = tMax;
    const stack: BvhNode[] = [root];
    while (stack.length) {
      const node = stack.pop()!;
      if (hitAabb(o, invD, node, lim) === null) continue;
      if (node.prims) {
        for (const i of node.prims) {
          const h = hitPrim(o, d, prims[i]!, lim);
          if (h) {
            if (anyHit) return h;
            best = h;
            lim = h.t;
          }
        }
      } else {
        if (node.left) stack.push(node.left);
        if (node.right) stack.push(node.right);
      }
    }
    return best;
  };

  return {
    intersect: (o, d, tMax) => traverse(o, d, tMax, false),
    occluded: (o, d, tMax) => traverse(o, d, tMax, true) !== null,
  };
}

/** Möller–Trumbore triangle intersection with barycentric normal/color. */
function hitTriangle(o: Vec3, d: Vec3, tri: Triangle, tMax: number): Hit | null {
  const e1 = sub(tri.v1, tri.v0);
  const e2 = sub(tri.v2, tri.v0);
  const pvec: Vec3 = [
    d[1] * e2[2] - d[2] * e2[1],
    d[2] * e2[0] - d[0] * e2[2],
    d[0] * e2[1] - d[1] * e2[0],
  ];
  const det = dot(e1, pvec);
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const tvec = sub(o, tri.v0);
  const u = dot(tvec, pvec) * inv;
  if (u < 0 || u > 1) return null;
  const qvec: Vec3 = [
    tvec[1] * e1[2] - tvec[2] * e1[1],
    tvec[2] * e1[0] - tvec[0] * e1[2],
    tvec[0] * e1[1] - tvec[1] * e1[0],
  ];
  const v = dot(d, qvec) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = dot(e2, qvec) * inv;
  if (t < EPS || t > tMax) return null;
  const w = 1 - u - v;
  const normal = norm([
    tri.n0[0] * w + tri.n1[0] * u + tri.n2[0] * v,
    tri.n0[1] * w + tri.n1[1] * u + tri.n2[1] * v,
    tri.n0[2] * w + tri.n1[2] * u + tri.n2[2] * v,
  ]);
  const color: Color = [
    tri.c0[0] * w + tri.c1[0] * u + tri.c2[0] * v,
    tri.c0[1] * w + tri.c1[1] * u + tri.c2[1] * v,
    tri.c0[2] * w + tri.c1[2] * u + tri.c2[2] * v,
  ];
  return { t, normal, color };
}

/* -------------------------------- lighting ------------------------------- */

/** PyMOL defaults (`SettingInfo.h`, mirrored in `viewport/.../lighting.ts`). */
export interface LightModel {
  ambient: number;
  direct: number;
  reflect: number;
  specDirect: number;
  specValue: number;
  shininess: number;
  /** view-space directed light (the `light` setting), already negated+normalized. */
  light1: Vec3;
  light2: Vec3;
  shadows: boolean;
}

export const DEFAULT_LIGHTS: LightModel = {
  ambient: 0.14,
  direct: 0.45,
  reflect: 0.45,
  specDirect: 0.0,
  specValue: 0.5, // specular 1.0 * specular_intensity 0.5
  shininess: 55,
  light1: norm([0.4, 0.4, 1]), // -light where light = (-0.4,-0.4,-1)
  light2: norm([0.55, 0.7, -0.15]), // -light2 where light2 = (-0.55,-0.7,0.15)
  shadows: true,
};

const HALF_HEADON = norm([0, 0, 1]);

/** Diffuse+specular from one directed light in view space (mirrors ComputeLighting). */
function computeLight(
  Nv: Vec3,
  L: Vec3,
  diffuseW: number,
  specW: number,
  shininess: number,
  lit: number,
): { diffuse: number; spec: number } {
  const ndl = dot(Nv, L);
  if (ndl <= 0) return { diffuse: 0, spec: 0 };
  const h = norm([L[0], L[1], L[2] + 1]); // half-vector with head-on view (0,0,1)
  const ndh = Math.max(0, dot(Nv, h));
  return { diffuse: diffuseW * ndl * lit, spec: specW * Math.pow(ndh, shininess) * lit };
}

/* --------------------------------- render -------------------------------- */

export interface RenderOptions {
  bg: Color;
  lights?: LightModel;
  antialias?: number; // supersample factor per axis (1 = none)
  fog?: { near: number; far: number; start: number; amount: number } | null;
  shadowLen?: number; // distance to trace shadow rays (scene diameter)
}

export function render(scene: Scene, cam: Camera, opts: RenderOptions): Uint8ClampedArray {
  const { width, height } = cam;
  const lights = opts.lights ?? DEFAULT_LIGHTS;
  const aa = Math.max(1, Math.floor(opts.antialias ?? 1));
  const shadowLen = opts.shadowLen ?? 1e4;
  const out = new Uint8ClampedArray(width * height * 4);
  // camera basis for world→view normal transform (camZ points toward viewer).
  const { right, up, forward } = cam;
  const camZ: Vec3 = [-forward[0], -forward[1], -forward[2]];
  // world-space directions of the directed lights (view → world).
  const lightWorld = (Lv: Vec3): Vec3 =>
    norm([
      right[0] * Lv[0] + up[0] * Lv[1] + camZ[0] * Lv[2],
      right[1] * Lv[0] + up[1] * Lv[1] + camZ[1] * Lv[2],
      right[2] * Lv[0] + up[2] * Lv[1] + camZ[2] * Lv[2],
    ]);
  const L1world = lightWorld(lights.light1);
  const L2world = lightWorld(lights.light2);

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < aa; sy++) {
        for (let sx = 0; sx < aa; sx++) {
          const jx = (sx + 0.5) / aa;
          const jy = (sy + 0.5) / aa;
          const ray = cam.primaryRay(px, py, jx, jy);
          const hit = scene.intersect(ray.origin, ray.dir, Infinity);
          const c = hit
            ? shade(scene, hit, ray.origin, ray.dir, cam, lights, L1world, L2world, opts, shadowLen)
            : opts.bg;
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const inv = 1 / (aa * aa);
      const o = (py * width + px) * 4;
      out[o] = Math.round(clamp01(r * inv) * 255);
      out[o + 1] = Math.round(clamp01(g * inv) * 255);
      out[o + 2] = Math.round(clamp01(b * inv) * 255);
      out[o + 3] = 255;
    }
  }
  return out;
}

function shade(
  scene: Scene,
  hit: Hit,
  o: Vec3,
  d: Vec3,
  cam: Camera,
  lights: LightModel,
  L1world: Vec3,
  L2world: Vec3,
  opts: RenderOptions,
  shadowLen: number,
): Color {
  const { right, up, forward } = cam;
  const camZ: Vec3 = [-forward[0], -forward[1], -forward[2]];
  // World normal → view space; two-sided (face the viewer).
  let Nv: Vec3 = norm([dot(hit.normal, right), dot(hit.normal, up), dot(hit.normal, camZ)]);
  if (Nv[2] < 0) Nv = [-Nv[0], -Nv[1], -Nv[2]];

  const point = addScaled(o, d, hit.t);
  const shadowedBy = (Lworld: Vec3): number => {
    if (!lights.shadows) return 1;
    const origin = addScaled(point, hit.normal, EPS * 4);
    const dir: Vec3 = [-Lworld[0], -Lworld[1], -Lworld[2]]; // toward the light
    return scene.occluded(origin, dir, shadowLen) ? 0 : 1;
  };

  let diffuse = lights.ambient;
  let spec = 0;
  // light 0 — head-on (0,0,1), direct weight, no shadow.
  {
    const l = computeLight(Nv, HALF_HEADON, lights.direct, lights.specDirect, lights.shininess, 1);
    diffuse += l.diffuse; spec += l.spec;
  }
  // directed lights — reflect weight, shadow-tested.
  for (const [Lv, Lworld] of [[lights.light1, L1world], [lights.light2, L2world]] as Array<[Vec3, Vec3]>) {
    const lit = shadowedBy(Lworld);
    const l = computeLight(Nv, Lv, lights.reflect, lights.specValue, lights.shininess, lit);
    diffuse += l.diffuse; spec += l.spec;
  }
  const df = Math.min(diffuse, 1);
  let rgb: Color = [
    hit.color[0] * df + spec,
    hit.color[1] * df + spec,
    hit.color[2] * df + spec,
  ];

  // Fog / depth-cue: blend toward bg by camera-space depth.
  if (opts.fog) {
    const distCam = -dot(sub(point, cam.eye), forward); // depth along view axis
    const { near, far, start, amount } = opts.fog;
    if (far > near) {
      let f = clamp01((far - distCam) / (far - near)); // 1 near, 0 far
      f = clamp01((f - start) / (1 - start || 1));
      const k = 1 - amount * (1 - f);
      rgb = [
        rgb[0] * k + opts.bg[0] * (1 - k),
        rgb[1] * k + opts.bg[1] * (1 - k),
        rgb[2] * k + opts.bg[2] * (1 - k),
      ];
    }
  }
  return rgb;
}
