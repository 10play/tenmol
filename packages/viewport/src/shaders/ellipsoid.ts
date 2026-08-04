/**
 * Ellipsoid impostor GLSL (WebGL2 / GLSL ES 3.00).
 *
 * PyMOL has NO ellipsoid shader: `RepEllipsoid` only exists on the ray-tracing
 * path (`CRay::ellipsoid3fv`, `packages/engine/layer1/Ray.cpp:7173`) and the GL path tessellates
 * it into a CGO sphere approximation. The accessor therefore ships us exactly
 * what the ray tracer gets — `CGO_ELLIPSOID` = `centre[3], r, n1[3], n2[3],
 * n3[3]` (`packages/engine/layer1/CGO.cpp:896-918`) — and this shader ray-traces the same
 * quadric per fragment, which is both cheaper and more accurate than any
 * tessellation.
 *
 * The three axis vectors are ORTHOGONAL and NOT unit: their lengths are the
 * semi-axes (`Ray.cpp:7196-7200` stores `length3f(n1..n3)` and then normalises
 * them). So with `A = [n1 n2 n3]` as columns the ellipsoid is
 * `{ c + A u : |u| = 1 }`, and because the columns are orthogonal
 * `A^-1 = diag(1/L_i^2) A^T` — three dot products, no matrix inverse.
 *
 * The impostor quad is the SPHERE quad of radius `max(L_i)`, including
 * `outer_tangent_adjustment()` from `packages/engine/data/shaders/sphere.vs`, so a perspective
 * silhouette is never clipped.
 */

export const ELLIPSOID_VERT = /* glsl */ `precision highp float;
precision highp int;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;
uniform bool u_ortho;

in vec2 corner;        // per-vertex quad corner in {-1,+1}^2
in vec3 a_center;      // per-instance
in vec3 a_n1;
in vec3 a_n2;
in vec3 a_n3;
in vec4 a_color;

out vec4 v_color;
out vec3 v_center;     // eye space
out vec3 v_point;      // eye space
out mat3 v_axes;       // eye-space A = [n1 n2 n3] (columns, NOT normalised)
out vec3 v_invLen2;    // 1 / L_i^2

// packages/engine/data/shaders/sphere.vs :: outer_tangent_adjustment
vec2 outer_tangent_adjustment(vec3 center, float radius_sq) {
  vec2 xy_dist = vec2(length(center.xz), length(center.yz));
  vec2 cos_a = clamp(center.z / xy_dist, -1., 1.);
  vec2 cos_b = xy_dist / sqrt(radius_sq + (xy_dist * xy_dist));
  vec2 cos_ab = (cos_a * cos_b + sqrt((1. - cos_a * cos_a) * (1. - cos_b * cos_b)));
  vec2 cos_ab_sq = cos_ab * cos_ab;
  vec2 tan_ab_sq = (1. - cos_ab_sq) / cos_ab_sq;
  return min(sqrt(tan_ab_sq + 1.), 10.);
}

void main() {
  v_color = a_color;

  vec3 e1 = normalMatrix * a_n1;
  vec3 e2 = normalMatrix * a_n2;
  vec3 e3 = normalMatrix * a_n3;
  v_axes = mat3(e1, e2, e3);

  vec3 len2 = vec3(dot(e1, e1), dot(e2, e2), dot(e3, e3));
  // A degenerate axis (zero-length) would divide by zero; clamp it to a
  // vanishingly thin one instead, which the fragment test then discards.
  len2 = max(len2, vec3(1e-12));
  v_invLen2 = 1.0 / len2;

  float bound = sqrt(max(max(len2.x, len2.y), len2.z));

  vec4 tmppos = modelViewMatrix * vec4(a_center, 1.0);
  v_center = tmppos.xyz / tmppos.w;

  vec2 offset = corner;
  if (!u_ortho) offset *= outer_tangent_adjustment(tmppos.xyz, bound * bound);

  vec4 eye = tmppos;
  eye.xy += bound * offset;
  v_point = eye.xyz / eye.w;

  gl_Position = projectionMatrix * eye;
}
`;

export const ELLIPSOID_FRAG = (lighting: string): string => /* glsl */ `precision highp float;
precision highp int;

uniform mat4 projectionMatrix;
uniform bool u_ortho;

in vec4 v_color;
in vec3 v_center;
in vec3 v_point;
in mat3 v_axes;
in vec3 v_invLen2;

out vec4 fragColor;

${lighting}

void main() {
  vec3 origin;
  vec3 dir;
  if (u_ortho) {
    origin = v_point;
    dir = vec3(0., 0., -1.);
  } else {
    origin = vec3(0.);
    dir = normalize(v_point);
  }

  // A^-1 v = diag(1/L^2) A^T v  (the columns of A are orthogonal).
  vec3 rel = origin - v_center;
  vec3 o = vec3(dot(v_axes[0], rel), dot(v_axes[1], rel), dot(v_axes[2], rel)) * v_invLen2;
  vec3 d = vec3(dot(v_axes[0], dir), dot(v_axes[1], dir), dot(v_axes[2], dir)) * v_invLen2;

  float a = dot(d, d);
  float b = dot(o, d);
  float c = dot(o, o) - 1.0;
  float disc = b * b - a * c;
  if (disc < 0.0 || a <= 0.0) discard;

  float t = (-b - sqrt(disc)) / a;   // near root
  vec3 local = o + t * d;
  vec3 ipoint = origin + t * dir;

  // n = A^-T local = A diag(1/L^2) local
  vec3 normal = normalize(v_axes * (local * v_invLen2));

  vec2 clipZW = ipoint.z * projectionMatrix[2].zw + projectionMatrix[3].zw;
  float depth = 0.5 + 0.5 * clipZW.x / clipZW.y;
  if (depth <= 0.0 || depth >= 1.0) discard;
  gl_FragDepth = depth;

  vec4 color = ApplyLighting(v_color, normal);
  fragColor = ApplyFog(color, FogFactor(ipoint.z));
}
`;
