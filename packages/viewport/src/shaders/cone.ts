/**
 * Cone / conical-frustum impostor GLSL (WebGL2 / GLSL ES 3.00).
 *
 * `CGO_CONE` is `v1[3], v2[3], r1, r2, cap1, cap2, rgb1[3], rgb2[3]`
 * (`packages/engine/layer1/CGO.h:719-731`); the accessor widens the colours to RGBA, so the
 * wire instance is 18 floats:
 *
 *   v1[3] v2[3] r1 r2 cap1 cap2 rgba1[4] rgba2[4]
 *
 * PyMOL's GL path TESSELLATES a cone (`CGOConev` -> a fan of triangles), so
 * there is no upstream shader to port. Ray-tracing the frustum per fragment is
 * what the ray tracer does (`cPrimCone`, `packages/engine/layer1/Ray.cpp`) and it is what keeps
 * the plan's "never tessellate client-side" constraint true for CGO arrows,
 * which are a cone plus a cylinder.
 *
 * `CGO_CYLINDER` and the `*_CUSTOM_CYLINDER*` family land in the same bucket
 * with `r1 == r2`, i.e. an exact cylinder, which this shader handles as the
 * degenerate `k = 0` case with no special-casing.
 */

export const CONE_VERT = /* glsl */ `precision highp float;
precision highp int;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;

in vec3 boxCorner;    // per-vertex: (out, up, right), each 0 or 1
in vec3 a_v1;         // per-instance
in vec3 a_v2;
in float a_r1;
in float a_r2;
in float a_cap1;
in float a_cap2;
in vec4 a_color1;
in vec4 a_color2;

out vec3 v_point;     // eye space
out vec3 v_base;
out vec3 v_axis;      // unit, eye space
out float v_height;
out float v_r1;
out float v_r2;
out float v_cap1;
out float v_cap2;
out vec4 v_color1;
out vec4 v_color2;

void main() {
  v_color1 = a_color1;
  v_color2 = a_color2;
  v_cap1 = a_cap1;
  v_cap2 = a_cap2;
  v_r1 = a_r1;
  v_r2 = a_r2;

  vec3 axis = a_v2 - a_v1;
  float height = length(axis);
  v_height = height;
  vec3 h = height > 1e-9 ? axis / height : vec3(0., 0., 1.);

  vec3 u = cross(h, vec3(1.0, 0.0, 0.0));
  if (dot(u, u) < 0.001) u = cross(h, vec3(0.0, 1.0, 0.0));
  u = normalize(u);
  vec3 v = normalize(cross(u, h));

  vec4 base4 = modelViewMatrix * vec4(a_v1, 1.0);
  v_base = base4.xyz;
  v_axis = normalize(normalMatrix * h);

  // One bounding box wide enough for BOTH end radii; the fragment test trims it.
  float r = max(a_r1, a_r2);
  float out_v = boxCorner.x;
  float up_v = boxCorner.y;
  float right_v = boxCorner.z;

  vec4 vertex = vec4(a_v1, 1.0);
  vertex.xyz += up_v * axis;
  vertex.xyz += (2.0 * right_v - 1.0) * r * u;
  vertex.xyz += (2.0 * out_v - 1.0) * r * v;
  vertex.xyz += (2.0 * up_v - 1.0) * r * h;

  vec4 tvertex = modelViewMatrix * vertex;
  v_point = tvertex.xyz;
  gl_Position = projectionMatrix * tvertex;
}
`;

export const CONE_FRAG = (lighting: string): string => /* glsl */ `precision highp float;
precision highp int;

uniform mat4 projectionMatrix;
uniform bool u_ortho;

in vec3 v_point;
in vec3 v_base;
in vec3 v_axis;
in float v_height;
in float v_r1;
in float v_r2;
in float v_cap1;
in float v_cap2;
in vec4 v_color1;
in vec4 v_color2;

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

  float H = max(v_height, 1e-9);
  float k = (v_r2 - v_r1) / H;               // dr/ds along the axis

  vec3 A = origin - v_base;
  float a0 = dot(A, v_axis);
  float ad = dot(dir, v_axis);
  vec3 W0 = A - a0 * v_axis;
  vec3 Wd = dir - ad * v_axis;

  float rb = v_r1 + k * a0;                  // radius at the ray origin's height
  float qa = dot(Wd, Wd) - k * k * ad * ad;
  float qb = dot(W0, Wd) - k * ad * rb;
  float qc = dot(W0, W0) - rb * rb;

  float best = 1e30;
  vec3 normal = vec3(0.);
  bool hit = false;

  if (abs(qa) > 1e-12) {
    float disc = qb * qb - qa * qc;
    if (disc >= 0.0) {
      float sq = sqrt(disc);
      // Both roots, nearest valid one wins; the ray can enter through the far
      // sheet when it starts inside.
      for (int i = 0; i < 2; i++) {
        float t = (i == 0) ? (-qb - sq) / qa : (-qb + sq) / qa;
        float s = a0 + t * ad;
        if (t > 0.0 && t < best && s >= 0.0 && s <= H && (v_r1 + k * s) >= 0.0) {
          best = t;
          vec3 p = origin + t * dir - v_base;
          vec3 radial = p - dot(p, v_axis) * v_axis;
          float rl = length(radial);
          normal = rl > 1e-9 ? normalize(radial / rl - k * v_axis) : v_axis;
          hit = true;
        }
      }
    }
  } else if (abs(qb) > 1e-12) {
    float t = -qc / (2.0 * qb);
    float s = a0 + t * ad;
    if (t > 0.0 && s >= 0.0 && s <= H) {
      best = t;
      vec3 p = origin + t * dir - v_base;
      vec3 radial = p - dot(p, v_axis) * v_axis;
      float rl = length(radial);
      normal = rl > 1e-9 ? normalize(radial / rl - k * v_axis) : v_axis;
      hit = true;
    }
  }

  // Flat end caps.
  for (int i = 0; i < 2; i++) {
    bool capped = (i == 0) ? (v_cap1 > 0.5) : (v_cap2 > 0.5);
    if (!capped) continue;
    float s = (i == 0) ? 0.0 : H;
    float rr = (i == 0) ? v_r1 : v_r2;
    if (abs(ad) < 1e-9) continue;
    float t = (s - a0) / ad;
    if (t <= 0.0 || t >= best) continue;
    vec3 p = origin + t * dir - v_base;
    vec3 radial = p - dot(p, v_axis) * v_axis;
    if (dot(radial, radial) > rr * rr) continue;
    best = t;
    normal = (i == 0) ? -v_axis : v_axis;
    hit = true;
  }

  if (!hit) discard;

  vec3 ipoint = origin + best * dir;
  float ratio = clamp(dot(ipoint - v_base, v_axis) / H, 0.0, 1.0);
  vec4 color = mix(v_color1, v_color2, ratio);

  vec2 clipZW = ipoint.z * projectionMatrix[2].zw + projectionMatrix[3].zw;
  float depth = 0.5 + 0.5 * clipZW.x / clipZW.y;
  if (depth <= 0.0 || depth >= 1.0) discard;
  gl_FragDepth = depth;

  color = ApplyLighting(color, normalize(normal));
  fragColor = ApplyFog(color, FogFactor(ipoint.z));
}
`;
