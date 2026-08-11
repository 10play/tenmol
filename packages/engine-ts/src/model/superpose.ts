/**
 * A minimal 3-point rigid-body superposition — the transform that maps one
 * ordered triple of non-collinear points onto another.
 *
 * `editor.attach_amino_acid` needs to drop a library residue onto a backbone
 * terminus. Rather than a full Kabsch least-squares fit (which `align.ts` keeps
 * module-private), the placement is fully determined by three reference atoms
 * (N, CA, C) whose *directions* set the residue's orientation, so an exact
 * orthonormal-frame change of basis suffices and is numerically simpler:
 *
 *   - build a right-handed orthonormal frame at each triple's first point,
 *   - the rotation carries the source frame onto the destination frame,
 *   - a point `p` maps to `dst0 + R·(p − src0)`.
 *
 * The map takes `src[0] → dst[0]` exactly, aligns the `src0→src1` axis onto the
 * `dst0→dst1` axis, and places `src[2]` on the same side of that axis as
 * `dst[2]`. Because only directions matter, the bond length that the caller
 * builds into `dst` (e.g. the 1.33 Å peptide C–N) is reproduced exactly.
 */

export type Vec3 = [number, number, number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

function unit(a: Vec3): Vec3 {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** Any unit vector perpendicular to `a` (stable choice), for degenerate input. */
function anyPerp(a: Vec3): Vec3 {
  const ax = Math.abs(a[0]);
  const ay = Math.abs(a[1]);
  const az = Math.abs(a[2]);
  const ref: Vec3 = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  const p = cross(a, ref);
  return len(p) < 1e-6 ? [0, 1, 0] : unit(p);
}

interface Frame {
  o: Vec3;
  e1: Vec3;
  e2: Vec3;
  e3: Vec3;
}

/** Right-handed orthonormal frame at `o`: e1 along o→p1, e2 in the o→p2 plane. */
function frameOf(o: Vec3, p1: Vec3, p2: Vec3): Frame {
  const e1 = unit(sub(p1, o));
  const rel2 = sub(p2, o);
  const proj = dot(rel2, e1);
  const perp = sub(rel2, scale(e1, proj));
  const e2 = len(perp) > 1e-8 ? unit(perp) : anyPerp(e1);
  const e3 = cross(e1, e2);
  return { o, e1, e2, e3 };
}

/**
 * Build the rigid transform mapping the ordered triple `src` onto `dst`. Returns
 * a function that applies `p → dst0 + R·(p − src0)` to any point (so it can be
 * reused across every atom of the fragment being placed).
 */
export function rigidFit3(
  src: readonly [Vec3, Vec3, Vec3],
  dst: readonly [Vec3, Vec3, Vec3],
): (p: Vec3) => Vec3 {
  const fs = frameOf(src[0], src[1], src[2]);
  const fd = frameOf(dst[0], dst[1], dst[2]);
  return (p: Vec3): Vec3 => {
    const rel = sub(p, fs.o);
    const a = dot(rel, fs.e1);
    const b = dot(rel, fs.e2);
    const c = dot(rel, fs.e3);
    return [
      fd.o[0] + a * fd.e1[0] + b * fd.e2[0] + c * fd.e3[0],
      fd.o[1] + a * fd.e1[1] + b * fd.e2[1] + c * fd.e3[1],
      fd.o[2] + a * fd.e1[2] + b * fd.e2[2] + c * fd.e3[2],
    ];
  };
}
