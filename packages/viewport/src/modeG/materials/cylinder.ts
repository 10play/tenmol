/**
 * Cylinder impostor material — a port of `packages/engine/data/shaders/cylinder.vs` +
 * `cylinder.fs`.
 *
 * One instance = one 8-corner bounding box; the fragment shader intersects the
 * ray with the infinite cylinder, then handles the caps. Sticks, ribbons and
 * every `CGO_SHADER_CYLINDER*` op go through here, which is why the accessor
 * hands us `origin/axis/radius/cap/rgba1/rgba2` instead of triangles (1UBQ
 * sticks = 718 instances, not 718 tessellated tubes).
 *
 * Ported verbatim: the local (U,V,axis) basis, the quadratic in the cylinder
 * xy-plane, the `cap` bit decoding (front/end/round-front/round-end/interp),
 * flat- and round-cap intersection, the half-bond colour split, and the depth
 * write. The vertex shader's `attr_flags` bit trio is replaced by an explicit
 * `vec3 boxCorner` in {0,1}^3 — the same three bits, spelled out.
 */

import { GLSL3, RawShaderMaterial, DoubleSide } from 'three';

import { LIGHTING_GLSL, lightingUniforms } from './lighting';

const VERT = /* glsl */ `precision highp float;
precision highp int;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;
uniform float u_radiusScale;

in vec3 boxCorner;      // per-vertex: (out, up, right), each 0 or 1
// Per-instance, laid out EXACTLY as the wire has it (origin, axis, radius,
// capbits, rgba...) so the payload is uploaded interleaved and uncopied.
in vec3 a_v1;
in vec3 a_axis;
in float a_radius;
in float a_cap;
in vec4 a_color1;
in vec4 a_color2;

out vec3 v_surfacePoint;
out vec3 v_axis;
out vec3 v_base;
out vec3 v_end;
out vec3 v_U;
out vec3 v_V;
out float v_radius;
out float v_cap;
out float v_invSqrHeight;
out vec4 v_color1;
out vec4 v_color2;

void main() {
  float uniformglscale = length(normalMatrix[0]);
  float radius = a_radius * u_radiusScale;

  v_color1 = a_color1;
  v_color2 = a_color2;
  v_cap = a_cap;

  vec3 a_v2 = a_v1 + a_axis;
  vec3 attr_axis = a_axis;

  v_invSqrHeight = length(attr_axis) / uniformglscale;
  v_invSqrHeight *= v_invSqrHeight;
  v_invSqrHeight = 1.0 / v_invSqrHeight;

  vec3 h = normalize(attr_axis);
  v_axis = normalize(normalMatrix * h);

  vec3 u = cross(h, vec3(1.0, 0.0, 0.0));
  if (dot(u, u) < 0.001) u = cross(h, vec3(0.0, 1.0, 0.0));
  u = normalize(u);
  vec3 v = normalize(cross(u, h));

  v_U = normalize(normalMatrix * u);
  v_V = normalize(normalMatrix * v);

  vec4 base4 = modelViewMatrix * vec4(a_v1, 1.0);
  v_base = base4.xyz;
  vec4 end4 = modelViewMatrix * vec4(a_v2, 1.0);
  v_end = end4.xyz;

  float out_v = boxCorner.x;
  float up_v = boxCorner.y;
  float right_v = boxCorner.z;

  vec4 vertex = vec4(a_v1, 1.0);
  vertex.xyz += up_v * attr_axis;
  vertex.xyz += (2.0 * right_v - 1.0) * radius * u;
  vertex.xyz += (2.0 * out_v - 1.0) * radius * v;
  vertex.xyz += (2.0 * up_v - 1.0) * radius * h;

  vec4 tvertex = modelViewMatrix * vertex;
  v_surfacePoint = tvertex.xyz;
  gl_Position = projectionMatrix * tvertex;

  v_radius = radius / uniformglscale;

  // Clamp z on the front clipping plane if the impostor box would be clipped;
  // the real clipping happens on the computed depth in the fragment shader.
  if (gl_Position.z / gl_Position.w < -1.0) {
    float diff = abs(base4.z - end4.z) + v_radius * 3.5;
    vec4 inset = tvertex;
    inset.z -= diff;
    inset = projectionMatrix * inset;
    if (inset.z / inset.w > -1.0) {
      gl_Position.z = -gl_Position.w;
    }
  }
}
`;

const FRAG = /* glsl */ `precision highp float;
precision highp int;

uniform mat4 projectionMatrix;
uniform bool u_ortho;
uniform bool u_noFlatCaps;
uniform float u_halfBond;
uniform float u_invHeight;

in vec3 v_surfacePoint;
in vec3 v_axis;
in vec3 v_base;
in vec3 v_end;
in vec3 v_U;
in vec3 v_V;
in float v_radius;
in float v_cap;
in float v_invSqrHeight;
in vec4 v_color1;
in vec4 v_color2;

out vec4 fragColor;

${LIGHTING_GLSL}

bool get_bit_and_shift(inout float bits) {
  float bit = mod(bits, 2.0);
  bits = (bits - bit) / 2.0;
  return bit > 0.5;
}

void main() {
  vec3 ray_target = v_surfacePoint;
  vec3 ray_origin;
  vec3 ray_direction;
  if (u_ortho) {
    ray_origin = v_surfacePoint;
    ray_direction = vec3(0., 0., 1.);
  } else {
    ray_origin = vec3(0.);
    ray_direction = normalize(-ray_target);
  }

  mat3 basis = mat3(v_U, v_V, v_axis);

  vec2 P = ((ray_target - v_base) * basis).xy;
  vec2 D = (ray_direction * basis).xy;

  float radius2 = v_radius * v_radius;

  float a0 = P.x * P.x + P.y * P.y - radius2;
  float a1 = P.x * D.x + P.y * D.y;
  float a2 = D.x * D.x + D.y * D.y;
  float d = a1 * a1 - a0 * a2;
  if (d < 0.0) discard;

  float dist = (-a1 + sqrt(d)) / a2;
  vec3 new_point = ray_target + dist * ray_direction;
  vec3 tmp_point = new_point - v_base;
  vec3 normal = normalize(tmp_point - v_axis * dot(tmp_point, v_axis));

  float fcap = v_cap + .001;
  bool frontcap      = get_bit_and_shift(fcap);
  bool endcap        = get_bit_and_shift(fcap);
  bool frontcapround = get_bit_and_shift(fcap) && u_noFlatCaps;
  bool endcapround   = get_bit_and_shift(fcap) && u_noFlatCaps;
  bool nocolorinterp = !get_bit_and_shift(fcap);

  vec4 color;
  float ratio = dot(new_point - v_base, vec3(v_end - v_base)) * v_invSqrHeight;
  if (!u_lightingEnabled) {
    ratio = step(.5, ratio);
  } else if (nocolorinterp) {
    float dp = clamp(-u_halfBond * new_point.z * u_invHeight, 0., .5);
    ratio = smoothstep(.5 - dp, .5 + dp, ratio);
  } else {
    ratio = clamp(ratio, 0., 1.);
  }
  color = mix(v_color1, v_color2, ratio);

  bool cap_test_base = 0.0 > dot((new_point - v_base), v_axis);
  bool cap_test_end  = 0.0 < dot((new_point - v_end), v_axis);

  if (cap_test_base || cap_test_end) {
    vec3 thisaxis = -v_axis;
    vec3 thisbase = v_base;
    if (cap_test_end) {
      thisaxis = v_axis;
      thisbase = v_end;
      frontcap = endcap;
      frontcapround = endcapround;
    }
    if (!frontcap) discard;

    if (frontcapround) {
      vec3 sphere_direction = thisbase - ray_origin;
      float b = dot(sphere_direction, ray_direction);
      float pos = b * b + radius2 - dot(sphere_direction, sphere_direction);
      if (pos < 0.0) discard;
      float near = sqrt(pos) + b;
      new_point = near * ray_direction + ray_origin;
      normal = normalize(new_point - thisbase);
    } else {
      float dNV = dot(thisaxis, ray_direction);
      if (dNV < 0.0) discard;
      float near = dot(thisaxis, thisbase - ray_origin) / dNV;
      new_point = ray_direction * near + ray_origin;
      if (dot(new_point - thisbase, new_point - thisbase) > radius2) discard;
      normal = thisaxis;
    }
  }

  vec2 clipZW = new_point.z * projectionMatrix[2].zw + projectionMatrix[3].zw;
  float depth = 0.5 + 0.5 * clipZW.x / clipZW.y;
  if (depth <= 0.0) discard;
  gl_FragDepth = depth;

  color = ApplyLighting(color, normal);
  fragColor = ApplyFog(color, FogFactor(new_point.z));
}
`;

export function createCylinderMaterial(): RawShaderMaterial {
  return new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      ...lightingUniforms(),
      u_radiusScale: { value: 1 },
      u_ortho: { value: false },
      // `no_flat_caps` == !cSetting_cylinder_flat_caps; PyMOL's default is
      // round caps on shader cylinders.
      u_noFlatCaps: { value: true },
      // 0 disables the depth-dependent antialiasing of the half-bond seam,
      // giving the same hard split PyMOL uses at `half_bond 0`.
      u_halfBond: { value: 0 },
      u_invHeight: { value: 1 / 1000 },
    },
    side: DoubleSide,
    transparent: false,
    depthTest: true,
    depthWrite: true,
  });
}
