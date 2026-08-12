/**
 * Camera derived from PyMOL's 18-float view (`view/view.ts`):
 *   [0..8]  column-major 3×3 rotation R (model → camera)
 *   [9..11] rotation origin in camera space (default (0,0,-dist))
 *   [12..14] rotation origin in model space
 *   [15],[16] near / far clip distance from the camera
 *   [17] sign*fov — negative ⇒ perspective, positive ⇒ orthoscopic; |.| = fov°
 * R is a pure rotation, so R⁻¹ = Rᵀ.
 */
import { addScaled, applyMat3T, norm, sub, type Vec3 } from './vec';

export interface Ray {
  origin: Vec3;
  dir: Vec3;
}

export interface Camera {
  eye: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
  width: number;
  height: number;
  near: number;
  far: number;
  ortho: boolean;
  /** Primary ray through pixel (px,py); (jx,jy) ∈ [0,1) is the subpixel offset. */
  primaryRay(px: number, py: number, jx: number, jy: number): Ray;
}

export function makeCamera(view: readonly number[], width: number, height: number): Camera {
  const R = view.slice(0, 9);
  const camOffset: Vec3 = [view[9] ?? 0, view[10] ?? 0, view[11] ?? -40];
  const originModel: Vec3 = [view[12] ?? 0, view[13] ?? 0, view[14] ?? 0];

  // Eye (model space) = model origin − Rᵀ·camOffset; camera looks down −z.
  const eye = sub(originModel, applyMat3T(R, camOffset));
  const forward = norm(applyMat3T(R, [0, 0, -1]));
  const up = norm(applyMat3T(R, [0, 1, 0]));
  const right = norm(applyMat3T(R, [1, 0, 0]));

  const fov = Math.abs(view[17] ?? -20) || 20;
  const ortho = (view[17] ?? -20) > 0;
  const near = view[15] ?? 0;
  const far = view[16] ?? 0;
  const tanHalf = Math.tan((fov * Math.PI) / 360);
  const aspect = height > 0 ? width / height : 1;
  const dist = Math.abs(camOffset[2]) || 40;

  return {
    eye, forward, right, up, width, height, near, far, ortho,
    primaryRay(px, py, jx, jy): Ray {
      // Screen NDC in [-1,1]; +sy is up (image row 0 is the top).
      const sx = (2 * (px + jx)) / width - 1;
      const sy = 1 - (2 * (py + jy)) / height;
      if (ortho) {
        const origin = addScaled(
          addScaled(eye, right, sx * dist * tanHalf * aspect),
          up,
          sy * dist * tanHalf,
        );
        return { origin, dir: forward };
      }
      const dir = norm(
        addScaled(
          addScaled(forward, right, sx * tanHalf * aspect),
          up,
          sy * tanHalf,
        ),
      );
      return { origin: eye, dir };
    },
  };
}
