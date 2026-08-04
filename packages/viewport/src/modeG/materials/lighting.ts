/**
 * PyMOL's lighting model, ported.
 *
 * Source: `packages/engine/data/shaders/compute_color_for_light.fs` (`ComputeLighting` /
 * `ApplyLighting`) and the uniform values `SceneProgramLighting`
 * (`packages/engine/layer1/Scene.cpp:5012-5108`) feeds it.
 *
 * WHAT IS VERBATIM
 *   * `ComputeLighting`: N.L diffuse, half-vector `H = normalize(L + (0,0,1))`,
 *     `pow(max(N.H,0), shininess)` specular, both zero when `N.L <= 0`.
 *   * `ApplyLighting`: `color.rgb *= min(diffuse_sum, 1.0)` then
 *     `color.rgb += specular_sum` — note the specular is ADDED as white after
 *     the diffuse multiply, which is why PyMOL highlights blow out to white.
 *   * Light 0 is head-on at `(0,0,1)` with diffuse = `direct`; lights 1..n are
 *     the `light`/`light2`... settings with diffuse = `reflect`.
 *   * Fog: `(g_Fog_end + z) * g_Fog_scale`, applied as a mix toward the
 *     background colour.
 *
 * WHAT IS APPROXIMATED (and why it is honest to say so)
 *   * `SceneGetAdjustedLightValues` scales specular/shininess by the light
 *     count and `spec_count`; we take the default two-light values.
 *   * `reflect` is scaled by `SceneGetReflectScaleValue`; we use 1.0.
 *   * `precomputed_lighting` (the cube-map path), anaglyph, OIT and
 *     `ray_transparency_oblique` are not ported.
 * Every one of these is a uniform here, so the renderer can be corrected from
 * the settings channel later without touching the GLSL.
 */

/** Defaults from `packages/engine/layer1/SettingInfo.h`: ambient 0.14, direct 0.45, reflect 0.45. */
export const LIGHT_DEFAULTS = {
  ambient: 0.14,
  direct: 0.45,
  reflect: 0.45,
  /** `specular` 1.0 * `specular_intensity` 0.5. */
  specValue: 0.5,
  /** `shininess` 55. */
  shininess: 55,
  /** `spec_direct` 0.0 — light 0 has no specular by default. */
  specDirect: 0.0,
  /** `light` setting (-0.4, -0.4, -1); the position is its negation. */
  light: [-0.4, -0.4, -1] as const,
} as const;

/** Uniform block shared by every Mode-G material. */
export function lightingUniforms(): Record<string, { value: unknown }> {
  const l = LIGHT_DEFAULTS.light;
  const len = Math.hypot(l[0], l[1], l[2]) || 1;
  return {
    u_ambient: { value: LIGHT_DEFAULTS.ambient },
    u_direct: { value: LIGHT_DEFAULTS.direct },
    u_reflect: { value: LIGHT_DEFAULTS.reflect },
    u_specValue: { value: LIGHT_DEFAULTS.specValue },
    u_specDirect: { value: LIGHT_DEFAULTS.specDirect },
    u_shininess: { value: LIGHT_DEFAULTS.shininess },
    u_light1: { value: [-l[0] / len, -l[1] / len, -l[2] / len] },
    u_lightingEnabled: { value: true },
    u_fogEnabled: { value: true },
    u_fogEnd: { value: 0 },
    u_fogScale: { value: 0 },
    u_bgColor: { value: [0, 0, 0] },
  };
}

/** GLSL ES 3.00 fragment chunk. Include before `main()`. */
export const LIGHTING_GLSL = /* glsl */ `
uniform float u_ambient;
uniform float u_direct;
uniform float u_reflect;
uniform float u_specValue;
uniform float u_specDirect;
uniform float u_shininess;
uniform vec3  u_light1;
uniform bool  u_lightingEnabled;
uniform bool  u_fogEnabled;
uniform float u_fogEnd;
uniform float u_fogScale;
uniform vec3  u_bgColor;

// packages/engine/data/shaders/compute_color_for_light.fs :: ComputeLighting
vec2 ComputeLighting(vec3 normal, vec3 L, float diffuse, float spec, float shine) {
  L = normalize(L);
  float NdotL = dot(normal, L);
  if (NdotL > 0.0) {
    diffuse *= NdotL;
    vec3 H = normalize(L + vec3(0., 0., 1.));
    float NdotH = max(dot(normal, H), 0.0);
    spec *= pow(NdotH, shine);
    return vec2(diffuse, spec);
  }
  return vec2(0.0);
}

// packages/engine/data/shaders/compute_color_for_light.fs :: ApplyLighting
vec4 ApplyLighting(vec4 color, vec3 normal) {
  if (!u_lightingEnabled) return color;
  vec2 lighting = vec2(u_ambient, 0.0);
  lighting += ComputeLighting(normal, vec3(0., 0., 1.), u_direct, u_specDirect, u_shininess);
  lighting += ComputeLighting(normal, u_light1, u_reflect, u_specValue, u_shininess);
  color.rgb *= min(lighting.x, 1.0);
  color.rgb += lighting.y;
  return color;
}

// packages/engine/data/shaders/compute_fog_color.fs :: ApplyFog
vec4 ApplyFog(vec4 color, float fog) {
  if (!u_fogEnabled) return color;
  return vec4(mix(u_bgColor, color.rgb, clamp(fog, 0.0, 1.0)), color.a);
}

float FogFactor(float eyeZ) {
  return (u_fogEnd + eyeZ) * u_fogScale;
}
`;
