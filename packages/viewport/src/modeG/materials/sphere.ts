/**
 * Sphere impostor material — a port of `packages/engine/data/shaders/sphere.vs` + `sphere.fs`.
 *
 * A sphere is ONE instance of a 4-vertex quad. It is never tessellated: PyMOL
 * ray-traces it per fragment and writes `gl_FragDepth`, which is why PyMOL
 * spheres are pixel-perfect at any zoom and why an icosphere client-side would
 * be both wrong and 100x heavier (spike 03 §4 measured the exporters turning
 * 1UBQ `mesh` into 63,420 spheres' worth of triangles).
 *
 * Ported verbatim:
 *   * `outer_tangent_adjustment()` — the quad has to be grown by the outer
 *     tangent under perspective or the silhouette gets clipped;
 *   * the ray-sphere intersection and the `nearest = b - sqrt(...)` root;
 *   * the depth computation `0.5 + 0.5 * clipZ/clipW` and the
 *     `depth <= 0 || depth >= 1` discard (the "workaround necessary for Mac").
 *
 * Changed for WebGL2/three.js: GLSL ES 3.00 (`in`/`out`, no `varying`),
 * `gl_FragDepth` is core rather than `GL_EXT_frag_depth`, `gl_ClipVertex` is
 * gone (three has no fixed-function clip planes here), and PyMOL's
 * `g_ModelViewMatrix`/`g_ProjectionMatrix`/`g_NormalMatrix` are three's
 * `modelViewMatrix`/`projectionMatrix`/`normalMatrix`.
 */

import { DoubleSide, GLSL3, RawShaderMaterial } from 'three';

import { LIGHTING_GLSL, lightingUniforms } from './lighting';

const VERT = /* glsl */ `precision highp float;
precision highp int;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;
uniform float u_sphereScale;
uniform bool u_ortho;

in vec2 corner;            // per-vertex: (right, up) in {-1,+1}
in vec4 a_centerRadius;    // per-instance: xyz = centre, w = radius
in vec4 a_color;           // per-instance: rgba

out vec4 v_color;
out vec3 v_sphereCenter;
out float v_radius2;
out vec3 v_point;

// packages/engine/data/shaders/sphere.vs :: outer_tangent_adjustment
vec2 outer_tangent_adjustment(vec3 center, float radius_sq) {
  vec2 xy_dist = vec2(length(center.xz), length(center.yz));
  vec2 cos_a = clamp(center.z / xy_dist, -1., 1.);
  vec2 cos_b = xy_dist / sqrt(radius_sq + (xy_dist * xy_dist));
  vec2 cos_ab = (cos_a * cos_b + sqrt((1. - cos_a * cos_a) * (1. - cos_b * cos_b)));
  vec2 cos_ab_sq = cos_ab * cos_ab;
  vec2 tan_ab_sq = (1. - cos_ab_sq) / cos_ab_sq;
  vec2 adjustment = sqrt(tan_ab_sq + 1.);
  return min(adjustment, 10.);
}

void main() {
  float radius = a_centerRadius.w * u_sphereScale;
  radius /= length(normalMatrix[0]);          // support uniform scaling

  vec4 tmppos = modelViewMatrix * vec4(a_centerRadius.xyz, 1.);

  v_color = a_color;
  v_radius2 = radius * radius;

  vec2 corner_offset = corner;
  if (!u_ortho) {
    corner_offset *= outer_tangent_adjustment(tmppos.xyz, v_radius2);
  }

  vec4 eye_space_pos = tmppos;
  eye_space_pos.xy += radius * corner_offset;

  v_sphereCenter = tmppos.xyz / tmppos.w;
  v_point = eye_space_pos.xyz / eye_space_pos.w;

  gl_Position = projectionMatrix * eye_space_pos;
}
`;

const FRAG = /* glsl */ `precision highp float;
precision highp int;

uniform mat4 projectionMatrix;
uniform bool u_ortho;

in vec4 v_color;
in vec3 v_sphereCenter;
in float v_radius2;
in vec3 v_point;

out vec4 fragColor;

${LIGHTING_GLSL}

void main() {
  vec3 ray_origin;
  vec3 ray_direction;
  vec3 sphere_direction;
  if (u_ortho) {
    ray_origin = v_point;
    ray_direction = vec3(0., 0., -1.);
    sphere_direction = ray_origin - v_sphereCenter;
  } else {
    ray_origin = vec3(0., 0., 0.);
    ray_direction = normalize(v_point);
    sphere_direction = v_sphereCenter;
  }

  float b = dot(sphere_direction, ray_direction);
  float position = b * b + v_radius2 - dot(sphere_direction, sphere_direction);
  if (position < 0.0) discard;

  float nearest = b - sqrt(position);
  vec3 ipoint = nearest * ray_direction + ray_origin;
  vec3 normal = normalize(ipoint - v_sphereCenter);

  vec2 clipZW = ipoint.z * projectionMatrix[2].zw + projectionMatrix[3].zw;
  float depth = 0.5 + 0.5 * clipZW.x / clipZW.y;
  if (depth <= 0.0 || depth >= 1.0) discard;
  gl_FragDepth = depth;

  vec4 color = ApplyLighting(v_color, normal);
  fragColor = ApplyFog(color, FogFactor(ipoint.z));
}
`;

/** Uniform bag for the impostor shaders: a name-keyed map of `{ value }` cells. */
export interface ImpostorUniforms {
  [key: string]: { value: unknown };
}

/** Build the ray-traced sphere-impostor material used by Mode G. */
export function createSphereMaterial(): RawShaderMaterial {
  return new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      ...lightingUniforms(),
      u_sphereScale: { value: 1 },
      u_ortho: { value: false },
    },
    // The impostor quad faces the camera but the ray test is what decides
    // coverage; culling would drop the quad for spheres behind the origin.
    side: DoubleSide,
    transparent: false,
    depthTest: true,
    depthWrite: true,
  });
}
