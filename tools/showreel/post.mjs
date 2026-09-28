// WebGL finishing pass: two-level bloom, chromatic aberration, vignette, film grain, flash.

const VS = `
attribute vec2 p;
varying vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const BRIGHT = `
precision highp float;
varying vec2 uv;
uniform sampler2D src;
uniform float threshold;
void main() {
  vec3 c = texture2D(src, uv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(c * smoothstep(threshold, threshold + 0.4, l), 1.0);
}`;

const BLUR = `
precision highp float;
varying vec2 uv;
uniform sampler2D src;
uniform vec2 dir;
void main() {
  vec3 c = texture2D(src, uv).rgb * 0.2270270270;
  c += texture2D(src, uv + dir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(src, uv - dir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(src, uv + dir * 3.2307692308).rgb * 0.0702702703;
  c += texture2D(src, uv - dir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;

const FINAL = `
precision highp float;
varying vec2 uv;
uniform sampler2D scene;
uniform sampler2D b1;
uniform sampler2D b2;
uniform float bloom, ca, grain, vignette, flash, fade, time;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + time * 91.7) * 43758.5453); }
void main() {
  vec2 d = uv - 0.5;
  vec2 o = d * ca * (1.0 + 2.0 * dot(d, d));
  vec3 c;
  c.r = texture2D(scene, uv + o).r;
  c.g = texture2D(scene, uv).g;
  c.b = texture2D(scene, uv - o).b;
  vec3 bl = texture2D(b1, uv).rgb * 0.9 + texture2D(b2, uv).rgb * 1.1;
  c += bl * bloom;
  c += vec3(flash);
  c *= 1.0 - vignette * smoothstep(0.35, 0.95, length(d * vec2(1.0, 0.8)) * 1.35);
  c += (hash(uv * 1000.0) - 0.5) * grain;
  c = c / (1.0 + max(c - 1.0, 0.0));
  c *= 1.0 - fade;
  gl_FragColor = vec4(c, 1.0);
}`;

export function createPost(glCanvas, w, h) {
  const gl = glCanvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false });
  if (!gl) throw new Error('WebGL unavailable');
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  const prog = (fs) => {
    const p = gl.createProgram();
    for (const [type, src] of [
      [gl.VERTEX_SHADER, VS],
      [gl.FRAGMENT_SHADER, fs],
    ]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i).name;
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u, a: gl.getAttribLocation(p, 'p') };
  };
  const P = { bright: prog(BRIGHT), blur: prog(BLUR), final: prog(FINAL) };

  const tex = (tw, th) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (tw) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, tw, th, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return t;
  };
  const target = (tw, th) => {
    const t = tex(tw, th);
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { t, f, w: tw, h: th };
  };
  const sceneTex = tex();
  const q1 = [target(w / 4, h / 4), target(w / 4, h / 4)];
  const q2 = [target(w / 8, h / 8), target(w / 8, h / 8)];

  const draw = (pr, dst, bind, uniforms) => {
    gl.useProgram(pr.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.f : null);
    gl.viewport(0, 0, dst ? dst.w : w, dst ? dst.h : h);
    bind.forEach(([name, t], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(pr.u[name], i);
    });
    for (const [k, v] of Object.entries(uniforms)) {
      if (!pr.u[k]) continue;
      if (Array.isArray(v)) gl.uniform2f(pr.u[k], v[0], v[1]);
      else gl.uniform1f(pr.u[k], v);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(pr.a);
    gl.vertexAttribPointer(pr.a, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  const blur = (pair, src, passes) => {
    let s = src;
    for (let i = 0; i < passes; i++) {
      draw(P.blur, pair[1], [['src', s]], { dir: [1 / pair[0].w, 0] });
      draw(P.blur, pair[0], [['src', pair[1].t]], { dir: [0, 1 / pair[0].h] });
      s = pair[0].t;
    }
  };

  return (src2d, fx) => {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src2d);
    draw(P.bright, q1[0], [['src', sceneTex]], { threshold: fx.threshold });
    blur(q1, q1[0].t, 2);
    draw(P.blur, q2[0], [['src', q1[0].t]], { dir: [0.5 / q2[0].w, 0] });
    blur(q2, q2[0].t, 3);
    draw(
      P.final,
      null,
      [
        ['scene', sceneTex],
        ['b1', q1[0].t],
        ['b2', q2[0].t],
      ],
      {
        bloom: fx.bloom,
        ca: fx.ca,
        grain: fx.grain,
        vignette: fx.vignette,
        flash: fx.flash + 0,
        fade: Math.max(fx.fade, fx.fadeIn),
        time: fx.time,
      },
    );
  };
}
