/**
 * Screen-space point GLSL (WebGL2 / GLSL ES 3.00) — the `dots` rep.
 *
 * WHY THIS EXISTS (measured, not assumed): `cSetting_dot_radius` defaults to 0
 * (`layer1/SettingInfo.h`), and at radius 0 `RepDot` does not draw spheres at
 * all — it draws `GL_POINTS` of `dot_width` pixels. The accessor honours that
 * faithfully: a `dots` frame for 1UBQ arrives as 15,040 `sphere` instances with
 * `w == 0` and a header carrying `pointSize: 2, dotSize: 0`.
 *
 * A radius-0 sphere impostor covers zero fragments, so the previous Mode-G
 * build drew 15,040 instances and lit exactly NOTHING while reporting no
 * problem — a silently empty rep. This material is the radius-0 branch.
 *
 * Round, not square: PyMOL's dots are round because `point_smooth` is on by
 * default, so the fragment shader discards outside the unit disc.
 */

export const POINT_VERT = /* glsl */ `precision highp float;
precision highp int;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float u_pointSize;    // dot_width, in CSS pixels
uniform float u_pixelRatio;   // framebuffer pixels per CSS pixel

in vec3 position;
in vec4 color;

out vec4 v_color;
out float v_eyeZ;

void main() {
  v_color = color;
  vec4 eye = modelViewMatrix * vec4(position, 1.0);
  v_eyeZ = eye.z;
  gl_Position = projectionMatrix * eye;
  gl_PointSize = max(1.0, u_pointSize * u_pixelRatio);
}
`;

export const POINT_FRAG = (lighting: string): string => /* glsl */ `precision highp float;
precision highp int;

in vec4 v_color;
in float v_eyeZ;

out vec4 fragColor;

${lighting}

void main() {
  // point_smooth: round dots, not squares.
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  if (dot(d, d) > 1.0) discard;
  fragColor = ApplyFog(v_color, FogFactor(v_eyeZ));
}
`;
