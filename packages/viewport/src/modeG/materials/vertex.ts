/**
 * The plain vertex material: PyMOL's `default.vs`/`default.fs` and
 * `surface.vs`/`surface.fs` reduced to what a `cgo::draw::arrays` block and a
 * `RepSurface` mesh actually carry — position, optional normal, optional
 * per-vertex RGBA, optional per-vertex alpha and ambient occlusion.
 *
 * Everything that draws triangles, strips, fans, lines or points in Mode G
 * uses this one program; the impostors are the only special cases, exactly as
 * in PyMOL (`ShaderMgr`: `default`, `surface`, `sphere`, `cylinder`, `line`).
 *
 * `u_ao` reproduces `RepSurface::VAO` (`ambient_occlusion_mode`), which no
 * exporter carries — spike 06 measured it live on 5,235 vertices — and is
 * applied as a multiply on the diffuse term, as `surface.fs` does.
 */

import { DoubleSide, GLSL3, RawShaderMaterial } from 'three';

import { LIGHTING_GLSL, lightingUniforms } from './lighting';

const VERT = /* glsl */ `precision highp float;
precision highp int;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;
uniform vec4 u_color;
uniform bool u_hasColor;
uniform bool u_hasNormal;
uniform bool u_hasAlpha;
uniform bool u_hasAo;

in vec3 position;
in vec3 normal;
in vec4 color;
in float alpha;
in float ao;

out vec4 v_color;
out vec3 v_normal;
out float v_eyeZ;
out float v_ao;

void main() {
  vec4 eye = modelViewMatrix * vec4(position, 1.0);
  v_eyeZ = eye.z;
  v_normal = u_hasNormal ? normalize(normalMatrix * normal) : vec3(0., 0., 1.);
  vec4 c = u_hasColor ? color : u_color;
  if (u_hasAlpha) c.a = 1.0 - alpha;   // RepSurface::VA is TRANSPARENCY
  v_color = c;
  v_ao = u_hasAo ? ao : 1.0;
  gl_Position = projectionMatrix * eye;
  gl_PointSize = 2.0;
}
`;

const FRAG = /* glsl */ `precision highp float;
precision highp int;

uniform bool u_hasNormal;

in vec4 v_color;
in vec3 v_normal;
in float v_eyeZ;
in float v_ao;

out vec4 fragColor;

${LIGHTING_GLSL}

void main() {
  vec4 color = v_color;
  if (u_hasNormal) {
    // Two-sided lighting in VIEW space: light the side that faces the camera
    // (normal.z toward the eye), independent of triangle winding. Winding —
    // hence gl_FrontFacing — is not reliable for the marching-cubes surface or
    // the extruded cartoon, and keying the flip on it left front faces lit by a
    // back-facing normal, i.e. black. This matches how the sphere/cylinder
    // impostors face their normals at the camera.
    vec3 n = normalize(v_normal);
    if (n.z < 0.0) n = -n;
    color = ApplyLighting(color, n);
    color.rgb *= v_ao;
  }
  fragColor = ApplyFog(color, FogFactor(v_eyeZ));
}
`;

/** Which per-vertex attributes a geometry has, driving the vertex material. */
export interface VertexMaterialFlags {
  hasColor: boolean;
  hasNormal: boolean;
  hasAlpha?: boolean;
  hasAo?: boolean;
  /** Used when `hasColor` is false (`oneColorFlag`). */
  color?: readonly [number, number, number, number];
  transparent?: boolean;
}

/** Build the GLSL3 raw shader material for a mesh with the given vertex flags. */
export function createVertexMaterial(flags: VertexMaterialFlags): RawShaderMaterial {
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      ...lightingUniforms(),
      u_color: { value: flags.color ?? [1, 1, 1, 1] },
      u_hasColor: { value: flags.hasColor },
      u_hasNormal: { value: flags.hasNormal },
      u_hasAlpha: { value: flags.hasAlpha ?? false },
      u_hasAo: { value: flags.hasAo ?? false },
    },
    side: DoubleSide,
    transparent: flags.transparent ?? false,
    depthWrite: !(flags.transparent ?? false),
  });
  return material;
}
