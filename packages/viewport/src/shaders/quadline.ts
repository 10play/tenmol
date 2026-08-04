/**
 * Screen-space quad lines (WebGL2 / GLSL ES 3.00) — the port of PyMOL's own
 * `trilines`.
 *
 * WHY THIS EXISTS (parity row 131). WebGL2 core clamps `gl.lineWidth` to 1.0:
 * measured in the headless Chromium the e2e suite uses, `WebGL 2.0 (OpenGL ES
 * 3.0 Chromium)`, `ALIASED_LINE_WIDTH_RANGE` reads `[1, 1]`. So `GL_LINES`
 * cannot draw a `mesh_width 3` mesh, and until now Mode G drew every mesh one
 * pixel wide whatever the setting said.
 *
 * PyMOL hit the same wall in its own GL 3.3 core path and solved it with
 * `trilines` (`packages/engine/data/shaders/trilines.vs`, `packages/engine/layer1/CGO.cpp:7452`): each segment
 * becomes two triangles, offset perpendicular to the segment IN SCREEN SPACE by
 * half the line width. This is that shader, with two differences that are
 * bookkeeping rather than maths:
 *
 *  * the corner code is a `vec2` attribute instead of `trilines`' packed
 *    `a_UV` float, because an instanced draw can keep the four corners in a
 *    tiny shared buffer instead of repeating both endpoints six times;
 *  * the colour is interpolated across the quad. `trilines` hard-switches at
 *    the midpoint unless `a_interpolate` is set, which is right for
 *    `CGO_SPLITLINE` (a bond painted half one colour, half the other) and
 *    WRONG for a mesh: `RepMesh::VC` is a colour per VERTEX and PyMOL draws it
 *    with `GL_LINE_STRIP` under the default smooth shade model.
 *
 * The perpendicular maths is `trilines.vs` line for line. `perp` is normalised
 * in the mixed metric `(dy/W, dx/H)`, which looks like a bug and is not: the
 * offset that comes back out is exactly `width / 2` PIXELS on each side and is
 * exactly perpendicular to the segment in pixel space. The unit test
 * `p11meshwidth.test.ts` re-derives both facts from the shader's own algebra.
 *
 * Unlit on purpose: `mesh_lighting` defaults to 0 (`packages/engine/layer1/SettingInfo.h`) and
 * `RepMesh` ships no normals, exactly like `trilines.fs`, which applies fog and
 * nothing else.
 */

/** `line_smooth` is off: `trilines.vs` does `width = max(1.0, width)`. */
export const QUADLINE_VERT = /* glsl */ `precision highp float;
precision highp int;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
/** 1 / (viewport width, height), in DEVICE pixels (trilines' inv_dimensions). */
uniform vec2 u_invDim;
/** Device pixels. The dynamic-width factor is already applied by the caller. */
uniform float u_lineWidth;

/** x: 0 = this corner sits on v1, 1 = on v2. y: -1 / +1, which side. */
in vec2 corner;
in vec3 a_v1;
in vec3 a_v2;
in vec4 a_color1;
in vec4 a_color2;

out vec4 v_color;
out float v_eyeZ;

void main() {
  vec3 self = mix(a_v1, a_v2, corner.x);
  vec3 other = mix(a_v2, a_v1, corner.x);
  v_color = mix(a_color1, a_color2, corner.x);

  vec4 eye = modelViewMatrix * vec4(self, 1.0);
  v_eyeZ = eye.z;

  vec4 pointA = projectionMatrix * eye;
  vec4 pointB = projectionMatrix * modelViewMatrix * vec4(other, 1.0);
  // trilines.vs does the perspective divide itself, by abs(w), and continues
  // in NDC with w = 1. Kept verbatim: it is what puts the offset in pixels.
  pointA.xyz = pointA.xyz / abs(pointA.w);
  pointA.w = 1.0;
  pointB.xyz = pointB.xyz / abs(pointB.w);
  pointB.w = 1.0;

  // Perpendicular to the centreline. A degenerate segment (both endpoints on
  // the same pixel) would make normalize() return NaN and take the whole draw
  // with it, so it collapses to a zero-area quad instead.
  vec2 d = (pointA.yx - pointB.yx) * u_invDim;
  float len = length(d);
  vec2 perp = len > 0.0 ? (d / len) * vec2(1.0, -1.0) : vec2(0.0);

  float width = max(1.0, u_lineWidth);
  pointA.xy += width * perp * corner.y * u_invDim;
  gl_Position = pointA;
}
`;

/**
 * Fog and nothing else — `trilines.fs` minus anaglyph, OIT and the
 * `line_smooth` edge feather, none of which the mesh path uses.
 *
 * @param lighting `LIGHTING_GLSL`, for `ApplyFog`/`FogFactor`
 */
export const QUADLINE_FRAG = (lighting: string): string => /* glsl */ `precision highp float;
precision highp int;

in vec4 v_color;
in float v_eyeZ;

out vec4 fragColor;

${lighting}

void main() {
  fragColor = ApplyFog(v_color, FogFactor(v_eyeZ));
}
`;
