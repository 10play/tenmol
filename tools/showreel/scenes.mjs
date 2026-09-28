/* global document */
// Every frame of the reel is a pure function of time: drawFrame(t) paints the 2D layer and
// returns the post-processing parameters (flash, chromatic split, bloom, ...) for that instant.

import {
  W,
  H,
  FPS,
  BEAT,
  ACTS,
  COMMANDS,
  LAND_T0,
  LAND_DT,
  H_T0,
  H_DT,
  STACK_WORDS,
  PIPE_T0,
  PIPE_NODES,
  TAU,
  PALETTE,
  actAt,
  camera,
  chain,
  clamp,
  ease,
  hexRgb,
  impactEnv,
  lerp,
  mixRgb,
  rainbow,
  remap,
  rgbStr,
  riserEnv,
  rng,
  rotX,
  rotY,
  rotZ,
  smooth,
} from './lib.mjs';

const SG = '"SG", sans-serif';
const JB = '"JB", monospace';
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];

const CHAIN_RGB = {
  D: hexRgb('#6366f1'),
  E: hexRgb('#a78bfa'),
  F: hexRgb('#38e1ff'),
  G: hexRgb('#7c9cff'),
  H: hexRgb('#e879f9'),
  A: hexRgb('#ff6b6b'),
  C: hexRgb('#f5b642'),
};
// PyMOL's own automatic carbon colors, used once the command line takes over.
const PYMOL_C = {
  D: hexRgb('#33ff33'),
  E: hexRgb('#00ffff'),
  F: hexRgb('#ff33cc'),
  G: hexRgb('#ffff00'),
  H: hexRgb('#ff9999'),
  A: hexRgb('#e5e5e5'),
  C: hexRgb('#7f7fff'),
};
const EL_RGB = { N: hexRgb('#5b5bff'), O: hexRgb('#ff4d4d'), S: hexRgb('#e6c540') };
const CAF_RGB = {
  C: hexRgb('#c9cdd8'),
  N: hexRgb('#6d72ff'),
  O: hexRgb('#ff5d6c'),
  H: hexRgb('#ffffff'),
};

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Soft additive glow dot. */
function glowSprite(rgb, size = 64) {
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const r = size / 2;
  const grd = g.createRadialGradient(r, r, 0, r, r, r);
  grd.addColorStop(0, rgbStr(mixRgb(rgb, WHITE, 0.75), 1));
  grd.addColorStop(0.18, rgbStr(mixRgb(rgb, WHITE, 0.25), 0.85));
  grd.addColorStop(0.45, rgbStr(rgb, 0.25));
  grd.addColorStop(1, rgbStr(rgb, 0));
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}

/** Lit sphere with key light, rim light and a specular hotspot. */
function ballSprite(rgb, size = 256) {
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const r = size / 2 - 2;
  const o = size / 2;
  g.beginPath();
  g.arc(o, o, r, 0, TAU);
  g.clip();
  let grd = g.createRadialGradient(o - r * 0.38, o - r * 0.42, r * 0.05, o, o, r * 1.05);
  grd.addColorStop(0, rgbStr(mixRgb(rgb, WHITE, 0.55)));
  grd.addColorStop(0.35, rgbStr(rgb));
  grd.addColorStop(0.85, rgbStr(mixRgb(rgb, BLACK, 0.7)));
  grd.addColorStop(1, rgbStr(mixRgb(rgb, BLACK, 0.85)));
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  grd = g.createRadialGradient(o + r * 0.25, o + r * 0.3, r * 0.6, o, o, r);
  grd.addColorStop(0, 'rgba(120,140,255,0)');
  grd.addColorStop(1, 'rgba(140,160,255,0.55)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  grd = g.createRadialGradient(o - r * 0.4, o - r * 0.45, 0, o - r * 0.4, o - r * 0.45, r * 0.3);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}

const fmt = (n) => Math.round(n).toLocaleString('en-US');

export function createReel(ctx, { protein, caffeine }) {
  const sprites = {
    glow: Object.fromEntries(
      Object.entries({ ...CHAIN_RGB, W: WHITE, I: hexRgb(PALETTE.indigo), Y: hexRgb(PALETTE.cyan) }).map(
        ([k, v]) => [k, glowSprite(v)],
      ),
    ),
    ball: Object.fromEntries(Object.entries(CAF_RGB).map(([k, v]) => [k, ballSprite(v)])),
    mark: [PALETTE.indigo, PALETTE.violet, PALETTE.cyan].map((h) => ballSprite(hexRgb(h))),
  };

  // Protein atoms in the axis-aligned frame, so every camera just spins/tilts.
  const R0 = protein.R0;
  for (const a of protein.atoms) {
    a.ax = R0[0] * a.x + R0[1] * a.y + R0[2] * a.z;
    a.ay = R0[3] * a.x + R0[4] * a.y + R0[5] * a.z;
    a.az = R0[6] * a.x + R0[7] * a.y + R0[8] * a.z;
    a.rgb = CHAIN_RGB[a.chain] ?? WHITE;
    a.lineRgb = a.el === 'C' ? (PYMOL_C[a.chain] ?? WHITE) : (EL_RGB[a.el] ?? WHITE);
  }
  for (const c of protein.chains) {
    c.pts = c.spline.map((s) => {
      const p = s.p;
      return {
        ...s,
        a: [
          R0[0] * p[0] + R0[1] * p[1] + R0[2] * p[2],
          R0[3] * p[0] + R0[4] * p[1] + R0[5] * p[2],
          R0[6] * p[0] + R0[7] * p[1] + R0[8] * p[2],
        ],
      };
    });
    const q = c.centroid;
    c.ac = [
      R0[0] * q[0] + R0[1] * q[1] + R0[2] * q[2],
      R0[3] * q[0] + R0[4] * q[1] + R0[5] * q[2],
      R0[6] * q[0] + R0[7] * q[1] + R0[8] * q[2],
    ];
  }

  // Logo particle targets, sampled from the rendered wordmark.
  ctx.font = `700 250px ${SG}`;
  const wordW = ctx.measureText('tenmol').width;
  const markW = 190;
  const gap = 60;
  const logoX0 = W / 2 - (markW + gap + wordW) / 2;
  const wordX = logoX0 + markW + gap;
  const logoY = 500;
  const logoTargets = (() => {
    const c = canvas(W, H);
    const g = c.getContext('2d');
    g.font = `700 250px ${SG}`;
    g.textBaseline = 'middle';
    g.fillStyle = '#fff';
    g.fillText('tenmol', wordX, logoY);
    const img = g.getImageData(0, 0, W, H).data;
    const pts = [];
    for (let y = 0; y < H; y += 5) for (let x = 0; x < W; x += 5) if (img[(y * W + x) * 4 + 3] > 128) pts.push([x, y]);
    const rand = rng(7);
    return pts.map(([x, y]) => {
      const th = rand() * TAU;
      return {
        x,
        y,
        th,
        r0: 260 + rand() * 780,
        delay: 0.32 * ((x - wordX) / wordW) + rand() * 0.12,
        swirl: (rand() - 0.5) * 160,
        tw: rand(),
      };
    });
  })();

  const wordLayer = canvas(W, 360);

  // --------------------------------------------------------------------------- helpers

  function bg(color = PALETTE.bg) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, W, H);
  }

  function vignetteGlow(x, y, r, rgb, a) {
    const grd = ctx.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, rgbStr(rgb, a));
    grd.addColorStop(1, rgbStr(rgb, 0));
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);
  }

  function dotGrid(alpha, ox = 0, oy = 0, step = 48) {
    if (alpha <= 0) return;
    ctx.fillStyle = `rgba(160,170,255,${alpha})`;
    const sx = ((ox % step) + step) % step;
    const sy = ((oy % step) + step) % step;
    for (let y = sy; y < H; y += step) for (let x = sx; x < W; x += step) ctx.fillRect(x, y, 2, 2);
  }

  /** Text revealed from behind a horizontal mask, sliding up. */
  function maskText(str, x, y, size, k, { font = SG, weight = 700, color = '#fff', align = 'left', stroke = 0 } = {}) {
    if (k <= 0) return;
    ctx.save();
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    const w = ctx.measureText(str).width;
    const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    ctx.beginPath();
    ctx.rect(x0 - 20, y - size * 1.0, w + 40, size * 1.28);
    ctx.clip();
    const dy = (1 - ease.outExpo(k)) * size * 1.15;
    if (stroke) {
      ctx.strokeStyle = color;
      ctx.lineWidth = stroke;
      ctx.strokeText(str, x, y + dy);
    } else {
      ctx.fillStyle = color;
      ctx.fillText(str, x, y + dy);
    }
    ctx.restore();
  }

  /** Per-character typing. */
  function typed(str, x, y, t0, dt, { size = 22, color = '#9aa0b4', font = JB, weight = 400, t, align = 'left' }) {
    const n = clamp(Math.floor((t - t0) / dt), 0, str.length);
    if (n <= 0) return;
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(str.slice(0, n), x, y);
  }

  function project3(cam, p) {
    return cam(p[0], p[1], p[2]);
  }

  // --------------------------------------------------------------------------- tubes

  /**
   * Backbone "cartoon" as depth-sorted, shaded stroke segments.
   * colorOf(chain, pt) -> rgb; reveal(ci) -> 0..1 fraction drawn; mode 'glow' | 'toon'.
   */
  function drawTubes(cam, { colorOf, reveal = () => 1, mode = 'glow', width = 1, alpha = 1, dist = 3.2, tips = false }) {
    const segs = [];
    protein.chains.forEach((c, ci) => {
      const r = reveal(ci, c);
      if (r <= 0) return;
      const n = c.pts.length;
      const last = r * (n - 1);
      let prev = project3(cam, c.pts[0].a);
      for (let j = 0; j < Math.min(n - 1, Math.ceil(last)); j++) {
        const pa = c.pts[j];
        const pb = c.pts[j + 1];
        let b = project3(cam, pb.a);
        let f = 1;
        if (j + 1 > last) {
          f = last - j;
          const q = [lerp(pa.a[0], pb.a[0], f), lerp(pa.a[1], pb.a[1], f), lerp(pa.a[2], pb.a[2], f)];
          b = project3(cam, q);
        }
        if (prev && b) {
          const s = (prev[3] + b[3]) / 2;
          const w = (pa.ss === 'H' ? 0.042 : pa.ss === 'E' ? 0.034 : 0.02) * s * width;
          segs.push({ a: prev, b, d: (prev[2] + b[2]) / 2, w, rgb: colorOf(c, pa, ci) });
        }
        if (tips && j === Math.ceil(last) - 1 && r < 1 && b) segs.push({ tip: true, b, d: b[2] - 0.01, rgb: colorOf(c, pb, ci) });
        prev = project3(cam, pb.a);
      }
    });
    segs.sort((x, y) => y.d - x.d);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalAlpha = alpha;
    for (const s of segs) {
      if (s.tip) {
        const z = 90;
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(sprites.glow.W, s.b[0] - z / 2, s.b[1] - z / 2, z, z);
        ctx.globalCompositeOperation = 'source-over';
        continue;
      }
      const fog = clamp((s.d - (dist - 0.9)) / 1.8);
      if (mode === 'toon') {
        ctx.strokeStyle = '#111';
        ctx.lineWidth = s.w + 6;
        line(s.a, s.b);
        ctx.strokeStyle = rgbStr(mixRgb(s.rgb, [244, 241, 234], 0.12));
        ctx.lineWidth = s.w;
        line(s.a, s.b);
        continue;
      }
      const base = mixRgb(s.rgb, [6, 8, 14], fog * 0.7);
      ctx.strokeStyle = rgbStr(mixRgb(base, BLACK, 0.65));
      ctx.lineWidth = s.w + 3;
      line(s.a, s.b);
      ctx.strokeStyle = rgbStr(base);
      ctx.lineWidth = s.w;
      line(s.a, s.b);
      ctx.strokeStyle = rgbStr(mixRgb(base, WHITE, 0.5), 0.9);
      ctx.lineWidth = s.w * 0.3;
      const o = -s.w * 0.22;
      ctx.beginPath();
      ctx.moveTo(s.a[0], s.a[1] + o);
      ctx.lineTo(s.b[0], s.b[1] + o);
      ctx.stroke();
    }
    ctx.restore();
  }

  function line(a, b) {
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }

  function ring3(cam, radius, alpha, rgb, lw = 2) {
    ctx.strokeStyle = rgbStr(rgb, alpha);
    ctx.lineWidth = lw;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i <= 160; i++) {
      const a = (i / 160) * TAU;
      const p = cam(Math.cos(a) * radius, Math.sin(a) * radius, 0);
      if (!p) continue;
      if (started) ctx.lineTo(p[0], p[1]);
      else ctx.moveTo(p[0], p[1]);
      started = true;
    }
    ctx.stroke();
  }

  // =========================================================================== ACT 1

  function ignite(t) {
    bg();
    vignetteGlow(W / 2, H / 2, 700, hexRgb(PALETTE.indigo), 0.1 + 0.1 * smooth(remap(t, 0.5, 1.5)));
    const zoom = 1 + 9 * ease.inExpo(remap(t, 1.35, 2.0));
    const cx = W / 2;
    const cy = H / 2;

    // Line draws out then collapses into the nucleus.
    const li = ease.outExpo(remap(t, 0.04, 0.42));
    const lo = ease.inExpo(remap(t, 0.42, 0.66));
    const half = 560 * li * (1 - lo);
    if (half > 0.5) {
      const grd = ctx.createLinearGradient(cx - half, 0, cx + half, 0);
      grd.addColorStop(0, 'rgba(99,102,241,0)');
      grd.addColorStop(0.5, 'rgba(235,238,255,1)');
      grd.addColorStop(1, 'rgba(99,102,241,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(cx - half, cy - 1.5, half * 2, 3);
    }

    // Electron orbits.
    const phase = 2.4 * t + 9 * Math.max(0, t - 1.3) ** 2;
    const tilts = [
      chain(rotX(1.15), rotZ(0.2)),
      chain(rotZ(TAU / 3), rotX(1.15)),
      chain(rotZ((2 * TAU) / 3), rotX(1.15)),
    ];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    tilts.forEach((M, i) => {
      const grow = ease.outExpo(remap(t, 0.66 + i * 0.09, 1.3 + i * 0.09));
      if (grow <= 0) return;
      const R = 250 * grow * zoom;
      const spin = chain(rotY(t * 0.6), M);
      const cam = camera({ R: spin, dist: 4, focal: 4 * R, cx, cy });
      ctx.lineWidth = 1.6;
      for (let k = 0; k < 128; k++) {
        const a0 = (k / 128) * TAU;
        const a1 = ((k + 1) / 128) * TAU;
        const p0 = cam(Math.cos(a0), Math.sin(a0), 0);
        const p1 = cam(Math.cos(a1), Math.sin(a1), 0);
        const front = clamp(1.3 - p0[2] / 4);
        ctx.strokeStyle = `rgba(150,160,255,${0.2 + 0.6 * front * front})`;
        line(p0, p1);
      }
      // Electron + comet trail.
      const e0 = phase * (1 + i * 0.27) + i * 2.1;
      for (let k = 22; k >= 0; k--) {
        const a = e0 - k * 0.045;
        const p = cam(Math.cos(a), Math.sin(a), 0);
        const s = (1 - k / 23) ** 0.7 * (7 + 5 * riserEnv(t)) * Math.min(zoom, 4) * (p[3] / (R / 4));
        ctx.globalAlpha = (1 - k / 23) ** 1.5;
        ctx.drawImage(sprites.glow.Y, p[0] - s, p[1] - s, s * 2, s * 2);
      }
      ctx.globalAlpha = 1;
    });

    // Nucleus.
    const pop = ease.outBack(remap(t, 0.6, 0.86), 3);
    if (pop > 0) {
      const beat = t > 0.9 ? Math.exp(-(((t - 1) % BEAT) + BEAT) % BEAT * 9) : 0;
      const r = 17 * pop * (1 + 0.35 * beat) * Math.min(zoom, 3);
      ctx.drawImage(sprites.glow.I, cx - r * 6, cy - r * 6, r * 12, r * 12);
      ctx.drawImage(sprites.glow.W, cx - r * 2.2, cy - r * 2.2, r * 4.4, r * 4.4);
    }
    ctx.restore();

    // Caption.
    ctx.globalAlpha = 1 - remap(t, 1.45, 1.7);
    typed('every structure starts with a single atom', cx, cy + 300, 0.75, 0.016, {
      t,
      size: 22,
      align: 'center',
      color: '#8e94ad',
    });
    ctx.globalAlpha = 1;
  }

  // =========================================================================== ACT 2

  function assemble(t) {
    bg();
    const out = ease.inExpo(remap(t, 5.3, 6.0));
    vignetteGlow(1240, 540, 900, hexRgb(PALETTE.indigo), 0.12 * (1 - out));
    dotGrid(0.05 * (1 - out), -(t - 2) * 18, 0);

    const lt = (i) => (i < 14 ? LAND_T0 + i * LAND_DT : H_T0 + (i - 14) * H_DT);
    const cx = lerp(1330, W / 2, ease.inOutCubic(remap(t, 5.1, 5.85)));
    const zoom = (1 - out) * (0.96 + 0.08 * ease.outCubic(remap(t, 2, 5)));
    const R = chain(rotX(0.35 * Math.sin((t - 2) * 0.8) - 0.1), rotY(0.75 * Math.sin((t - 2) * 0.95) + out * 3), rotZ((t - 2) * 0.12));
    const cam = camera({ R, dist: 4, focal: 1500, cx, cy: 540, zoom });
    const items = [];
    const pos = caffeine.atoms.map((a, i) => {
      const k = remap(t, lt(i) - 0.42, lt(i));
      if (k <= 0) return null;
      const e = ease.outCubic(k);
      const p = [lerp(a.from[0], a.p[0], e), lerp(a.from[1], a.p[1], e), lerp(a.from[2], a.p[2], e)];
      const s = cam(...p);
      if (!s) return null;
      const back = remap(k - 0.12, 0, 1);
      const eb = ease.outCubic(back);
      const tail = cam(lerp(a.from[0], a.p[0], eb), lerp(a.from[1], a.p[1], eb), lerp(a.from[2], a.p[2], eb));
      return { s, tail, k, landed: t >= lt(i), pop: ease.outElastic(remap(t, lt(i), lt(i) + 0.55)) };
    });

    caffeine.bonds.forEach(([i, j, order]) => {
      const a = pos[i];
      const b = pos[j];
      if (!a || !b || !a.landed || !b.landed) return;
      const g = ease.outCubic(remap(t, Math.max(lt(i), lt(j)), Math.max(lt(i), lt(j)) + 0.22));
      if (g <= 0) return;
      items.push({ d: (a.s[2] + b.s[2]) / 2 + 0.001, bond: [a.s, b.s, g, order, caffeine.atoms[i].el, caffeine.atoms[j].el] });
    });
    pos.forEach((p, i) => p && items.push({ d: p.s[2], atom: [p, caffeine.atoms[i]] }));
    items.sort((x, y) => y.d - x.d);

    ctx.lineCap = 'round';
    for (const it of items) {
      if (it.bond) {
        const [a, b, g, order, ea, eb] = it.bond;
        const e = [lerp(a[0], b[0], g), lerp(a[1], b[1], g)];
        const m = [lerp(a[0], b[0], 0.5 * g), lerp(a[1], b[1], 0.5 * g)];
        const w = 0.05 * (a[3] + b[3]) * 0.5;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const l = Math.hypot(dx, dy) || 1;
        const offs = order === 2 ? [-w * 0.75, w * 0.75] : [0];
        for (const o of offs) {
          const ox = (-dy / l) * o;
          const oy = (dx / l) * o;
          const lw = order === 2 ? w * 0.55 : w;
          for (const [p, q, el] of [
            [a, m, ea],
            [m, e, eb],
          ]) {
            if (q === e && g < 0.5) continue;
            ctx.strokeStyle = rgbStr(mixRgb(CAF_RGB[el], BLACK, 0.55));
            ctx.lineWidth = lw + 3;
            ctx.beginPath();
            ctx.moveTo(p[0] + ox, p[1] + oy);
            ctx.lineTo(q[0] + ox, q[1] + oy);
            ctx.stroke();
            ctx.strokeStyle = rgbStr(CAF_RGB[el]);
            ctx.lineWidth = lw;
            ctx.stroke();
          }
        }
      } else {
        const [p, a] = it.atom;
        const rad = (a.el === 'H' ? 0.075 : 0.13) * p.s[3] * (p.landed ? 0.6 + 0.4 * p.pop : 0.55);
        if (!p.landed && p.tail) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          const grd = ctx.createLinearGradient(p.tail[0], p.tail[1], p.s[0], p.s[1]);
          grd.addColorStop(0, rgbStr(CAF_RGB[a.el], 0));
          grd.addColorStop(1, rgbStr(CAF_RGB[a.el], 0.9));
          ctx.strokeStyle = grd;
          ctx.lineWidth = rad * 1.1;
          line(p.tail, p.s);
          ctx.restore();
        }
        ctx.drawImage(sprites.ball[a.el], p.s[0] - rad, p.s[1] - rad, rad * 2, rad * 2);
        // Landing shockwave.
        const lk = remap(t, lt(a.i), lt(a.i) + 0.45);
        if (lk > 0 && lk < 1) {
          ctx.strokeStyle = rgbStr(mixRgb(CAF_RGB[a.el], WHITE, 0.4), (1 - lk) * 0.8);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.s[0], p.s[1], rad + 70 * ease.outExpo(lk) * (a.el === 'H' ? 0.5 : 1), 0, TAU);
          ctx.stroke();
        }
      }
    }

    // Kinetic type.
    const exit = ease.inExpo(remap(t, 5.05, 5.5)) * 1300;
    const words = [
      ['ATOMS.', 2.5, PALETTE.ink],
      ['BONDS.', 3.5, PALETTE.ink],
      ['STRUCTURE.', 4.5, PALETTE.indigo],
    ];
    ctx.save();
    ctx.translate(-exit, 0);
    words.forEach(([w, tw, col], i) => {
      let shift = 0;
      for (let j = i + 1; j < words.length; j++) shift += ease.outExpo(remap(t, words[j][1], words[j][1] + 0.5));
      const k = remap(t, tw, tw + 0.55);
      const dim = clamp(shift);
      const y = 610 - shift * 128;
      ctx.globalAlpha = 1 - dim * 0.72;
      if (dim > 0.5) maskText(w, 150, y, 124, k, { color: col, stroke: 2 });
      else maskText(w, 150, y, 124, k, { color: col });
    });
    ctx.globalAlpha = 1;
    // Live counter.
    const landed = caffeine.atoms.filter((_, i) => t >= lt(i)).length;
    const bonded = caffeine.bonds.filter(([i, j]) => t >= Math.max(lt(i), lt(j)) + 0.1).length;
    const ck = remap(t, 2.4, 2.7);
    if (ck > 0) {
      ctx.globalAlpha = ck;
      ctx.font = `500 24px ${JB}`;
      ctx.fillStyle = '#8e94ad';
      ctx.textAlign = 'left';
      ctx.fillText(`C8H10N4O2 · caffeine`, 156, 710);
      ctx.fillStyle = PALETTE.ink;
      ctx.fillText(`atoms ${String(landed).padStart(2, '0')}/24   bonds ${String(bonded).padStart(2, '0')}/25`, 156, 750);
      ctx.fillStyle = PALETTE.indigo;
      ctx.fillRect(156, 772, 380 * (landed / 24), 3);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(156 + 380 * (landed / 24), 772, 380 * (1 - landed / 24), 3);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // =========================================================================== ACT 3

  function machineCam(t) {
    const pitch = lerp(-1.18, 0, ease.inOutCubic(remap(t, 9.7, 11.0)));
    const yaw = 0.35 * Math.sin(t * 0.45) * (1 - ease.inOutCubic(remap(t, 9.7, 11.0)));
    const spin = t * 0.32;
    let dist = 3.5 - 0.45 * ease.outCubic(remap(t, 6, 9.5));
    dist -= 2.95 * ease.inExpo(remap(t, 11.3, 12.0));
    return { R: chain(rotX(pitch), rotY(yaw), rotZ(spin)), dist };
  }

  function machine(t) {
    bg();
    const { R, dist } = machineCam(t);
    const cam = camera({ R, dist, focal: 1650 });
    vignetteGlow(W / 2, H / 2, 900, hexRgb(PALETTE.indigo), 0.14 + 0.08 * impactEnv(t, 3));

    // Particles: burst into a galaxy, then implode into the real atom positions.
    const burst = ease.outExpo(remap(t, 6.0, 6.55));
    const fade = 1 - 0.88 * remap(t, 8.4, 9.7);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (fade > 0.02)
      for (const a of protein.atoms) {
        const k = ease.inOutCubic(remap(t, 6.5 + a.delay, 7.5 + a.delay));
        const th = a.gθ + (t - 6) * 0.55;
        const gx = Math.cos(th) * a.gr * burst;
        const gy = Math.sin(th) * a.gr * burst;
        let x = lerp(gx, a.ax, k);
        let y = lerp(gy, a.ay, k);
        const z = lerp(a.gz * burst, a.az, k);
        const sw = (1 - k) * 1.3;
        const c = Math.cos(sw);
        const s = Math.sin(sw);
        [x, y] = [x * c - y * s, x * s + y * c];
        const p = cam(x, y, z);
        if (!p) continue;
        const tw = 0.75 + 0.25 * Math.sin(t * 9 + a.tw * TAU);
        const size = (0.011 + 0.014 * (1 - k)) * p[3] * tw;
        ctx.globalAlpha = fade * (0.9 - 0.3 * k);
        ctx.drawImage(sprites.glow[a.chain] ?? sprites.glow.W, p[0] - size, p[1] - size, size * 2, size * 2);
      }
    ctx.restore();

    // Backbone draws on, chain by chain, with a spark at each growing tip.
    drawTubes(cam, {
      colorOf: (c) => CHAIN_RGB[c.id],
      reveal: (ci) => ease.inOutCubic(remap(t, 8.15 + ci * 0.07, 9.55 + ci * 0.07)),
      dist,
      tips: true,
    });

    // Shockwaves through the ring on the downbeats.
    for (const tb of [10, 11]) {
      const k = remap(t, tb, tb + 0.8);
      if (k > 0 && k < 1) ring3(cam, 0.25 + 1.5 * ease.outExpo(k), (1 - k) * 0.7, hexRgb(PALETTE.cyan), 2.5);
    }

    // HUD callouts once we're looking straight down the pore.
    const hud = remap(t, 9.9, 10.2) * (1 - remap(t, 11.3, 11.55));
    if (hud > 0) {
      ctx.save();
      ctx.globalAlpha = hud;
      protein.chains.slice(0, 5).forEach((c, i) => {
        const k = remap(t, 10.25 + i * 0.125, 10.65 + i * 0.125);
        if (k <= 0) return;
        const p = cam(...c.ac);
        if (!p) return;
        const dx = p[0] - W / 2;
        const dy = p[1] - H / 2;
        const l = Math.hypot(dx, dy) || 1;
        const r = 50;
        ctx.strokeStyle = 'rgba(230,235,255,0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p[0], p[1], r, -Math.PI / 2, -Math.PI / 2 + TAU * ease.outCubic(k));
        ctx.stroke();
        const e = ease.outExpo(remap(k, 0.3, 1));
        const x1 = p[0] + (dx / l) * r;
        const y1 = p[1] + (dy / l) * r;
        const x2 = p[0] + (dx / l) * (r + 120 * e);
        const y2 = p[1] + (dy / l) * (r + 120 * e);
        const x3 = x2 + Math.sign(dx) * 50 * e;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.lineTo(x3, y2);
        ctx.stroke();
        ctx.fillStyle = rgbStr(CHAIN_RGB[c.id]);
        ctx.fillRect(x3 - 3, y2 - 3, 6, 6);
        ctx.globalAlpha = hud * e;
        ctx.textAlign = dx > 0 ? 'left' : 'right';
        ctx.font = `600 22px ${JB}`;
        ctx.fillStyle = '#fff';
        ctx.fillText(`CHAIN ${c.id}`, x3 + Math.sign(dx) * 14, y2 + 2);
        ctx.font = `400 17px ${JB}`;
        ctx.fillStyle = '#8e94ad';
        ctx.fillText(`${c.ca.length} residues`, x3 + Math.sign(dx) * 14, y2 + 26);
        ctx.globalAlpha = hud;
      });

      // Title + counters.
      maskText('1TII', 120, 250, 120, remap(t, 9.95, 10.5), { color: '#fff' });
      typed('HEAT-LABILE ENTEROTOXIN IIb · E. coli', 126, 296, 10.15, 0.012, { t, size: 20, color: '#8e94ad' });
      const cnt = ease.outExpo(remap(t, 10.1, 10.9));
      const stats = [
        [fmt(5469 * cnt), 'ATOMS'],
        [fmt(protein.nres * cnt), 'RESIDUES'],
        [fmt(7 * cnt), 'CHAINS'],
        ['5-FOLD', 'SYMMETRY'],
      ];
      stats.forEach(([v, lbl], i) => {
        const k = remap(t, 10.1 + i * 0.08, 10.45 + i * 0.08);
        ctx.globalAlpha = hud * k;
        ctx.textAlign = 'left';
        ctx.font = `700 46px ${SG}`;
        ctx.fillStyle = '#fff';
        ctx.fillText(v, 124 + i * 230, 900);
        ctx.font = `400 16px ${JB}`;
        ctx.fillStyle = '#8e94ad';
        ctx.fillText(lbl, 126 + i * 230, 930);
        ctx.fillStyle = rgbStr(hexRgb(PALETTE.indigo));
        ctx.fillRect(126 + i * 230, 850, 28 * k, 3);
      });
      ctx.restore();
    }

    // Side-view caption while the structure assembles.
    const cap = remap(t, 6.9, 7.2) * (1 - remap(t, 9.4, 9.7));
    if (cap > 0) {
      ctx.globalAlpha = cap;
      maskText('5,469 atoms.', W / 2, 940, 64, remap(t, 6.9, 7.4), { align: 'center' });
      maskText('One machine.', W / 2, 1010, 64, remap(t, 8.0, 8.5), { align: 'center', color: PALETTE.indigo });
      ctx.globalAlpha = 1;
    }
  }

  // =========================================================================== ACT 4

  function commandAct(t) {
    bg('#06080c');
    dotGrid(0.06, 0, -(t - 12) * 12);
    const vcx = 690;
    const vcy = 560;
    vignetteGlow(vcx, vcy, 700, hexRgb(PALETTE.indigo), 0.1);
    const pitch = -0.78;
    const R = chain(rotX(pitch), rotY(0.28), rotZ(t * 0.3 + 1.1));
    const pop = ease.outBack(remap(t, 12.5, 12.85), 2.2);
    const cam = camera({ R, dist: 3.3, focal: 1450 * (0.4 + 0.6 * pop), cx: vcx, cy: vcy });
    const [cLoad, cCart, cSpec, cRay] = COMMANDS.map((c) => c.enter);

    const paper = t >= cRay;
    const wipe = ease.outExpo(remap(t, cRay, cRay + 0.4)) * 2400;

    const drawScene = (toon) => {
      // Lines: PyMOL's default representation, all 5,569 bonds.
      const la = t < cLoad ? 0 : lerp(1, toon ? 0 : 0.14, ease.outCubic(remap(t, cCart, cCart + 0.35)));
      if (la > 0) {
        const P = protein.atoms.map((a) => cam(a.ax, a.ay, a.az));
        const buckets = new Map();
        for (const [i, j] of protein.bonds) {
          const a = P[i];
          const b = P[j];
          if (!a || !b) continue;
          const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          for (const [p, q, at] of [
            [a, m, protein.atoms[i]],
            [m, b, protein.atoms[j]],
          ]) {
            const key = at.lineRgb;
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push(p[0], p[1], q[0], q[1]);
          }
        }
        ctx.lineWidth = 1.3;
        ctx.globalAlpha = la;
        for (const [rgb, arr] of buckets) {
          ctx.strokeStyle = rgbStr(rgb);
          ctx.beginPath();
          for (let k = 0; k < arr.length; k += 4) {
            ctx.moveTo(arr[k], arr[k + 1]);
            ctx.lineTo(arr[k + 2], arr[k + 3]);
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      if (t >= cCart) {
        const front = ease.inOutCubic(remap(t, cSpec, cSpec + 0.55)) * 1.12;
        drawTubes(cam, {
          mode: toon ? 'toon' : 'glow',
          dist: 3.3,
          reveal: (ci) => ease.outCubic(remap(t, cCart + ci * 0.02, cCart + 0.42 + ci * 0.02)),
          colorOf: (c, p) => {
            const m = smooth(clamp((front - p.u) / 0.08));
            let rgb = mixRgb(PYMOL_C[c.id], rainbow(p.u), m);
            const glint = Math.exp(-(((p.u - front + 0.04) / 0.025) ** 2)) * (front < 1.1 ? 1 : 0);
            if (glint > 0.01) rgb = mixRgb(rgb, WHITE, glint * 0.9);
            return rgb;
          },
        });
      }
    };

    drawScene(false);
    if (paper) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(vcx, vcy, wipe, 0, TAU);
      ctx.clip();
      bg(PALETTE.paper);
      drawScene(true);
      ctx.restore();
    }

    // Big kinetic label for the representation just applied.
    const labels = ['lines', 'cartoon', 'spectrum', 'ray'];
    COMMANDS.forEach((c, i) => {
      const next = COMMANDS[i + 1]?.enter ?? 16.4;
      const kin = remap(t, c.enter, c.enter + 0.4);
      const kout = ease.inExpo(remap(t, next - 0.14, next));
      if (kin <= 0 || kout >= 1) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 800, 1080, 200);
      ctx.clip();
      ctx.translate(0, -kout * 170);
      maskText(labels[i], 110, 960, 150, kin, { color: paper ? '#111' : '#fff' });
      ctx.font = `500 20px ${JB}`;
      ctx.fillStyle = paper ? '#555' : '#8e94ad';
      ctx.globalAlpha = kin;
      ctx.fillText(`0${i + 1}`, 116, 820 + (1 - ease.outExpo(kin)) * 30);
      ctx.restore();
    });

    // The terminal.
    const px = lerp(W + 40, 1080, ease.outExpo(remap(t, 12.0, 12.45)));
    const py = 250;
    const pw = 760;
    const ph = 560;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 60;
    ctx.shadowOffsetY = 24;
    ctx.fillStyle = 'rgba(16,18,26,0.92)';
    roundRect(px, py, pw, ph, 18);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1.5;
    roundRect(px, py, pw, ph, 18);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(px + 1, py + 56, pw - 2, 1);
    ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(px + 30 + i * 24, py + 28, 7, 0, TAU);
      ctx.fill();
    });
    ctx.font = `500 18px ${JB}`;
    ctx.fillStyle = '#6f7690';
    ctx.textAlign = 'center';
    ctx.fillText('tenmol — command line', px + pw / 2, py + 34);
    ctx.textAlign = 'left';

    let y = py + 110;
    const lh = 50;
    const fontSize = 25;
    let cursor = null;
    COMMANDS.forEach((c) => {
      if (t < c.start) return;
      const n = clamp(Math.floor((t - c.start) / 0.03) + 1, 0, c.text.length);
      ctx.font = `700 ${fontSize}px ${JB}`;
      ctx.fillStyle = '#8b8dff';
      ctx.fillText('PyMOL>', px + 36, y);
      const pw2 = ctx.measureText('PyMOL> ').width;
      ctx.font = `400 ${fontSize}px ${JB}`;
      ctx.fillStyle = '#f2f3ff';
      const shown = c.text.slice(0, n);
      ctx.fillText(shown, px + 36 + pw2, y);
      if (t < c.enter) cursor = [px + 36 + pw2 + ctx.measureText(shown).width + 2, y, true];
      y += lh * 0.75;
      if (t >= c.enter) {
        const k = remap(t, c.enter + 0.04, c.enter + 0.2);
        ctx.globalAlpha = k;
        ctx.font = `400 19px ${JB}`;
        ctx.fillStyle = '#6f7690';
        ctx.fillText(` ${c.out}`, px + 36, y);
        ctx.globalAlpha = 1;
        // Enter flash on the line.
        const f = Math.exp(-(t - c.enter) * 10);
        ctx.fillStyle = `rgba(139,141,255,${0.18 * f})`;
        ctx.fillRect(px + 16, y - lh * 0.75 - 30, pw - 32, lh * 0.75 + 8);
      }
      y += lh * 0.95;
    });
    const last = COMMANDS.findLast((c) => t >= c.enter);
    if (!cursor && t > 12.1) {
      const nextC = COMMANDS.find((c) => t < c.start);
      if (nextC || last) {
        ctx.font = `700 ${fontSize}px ${JB}`;
        ctx.fillStyle = '#8b8dff';
        ctx.fillText('PyMOL>', px + 36, y);
        cursor = [px + 36 + ctx.measureText('PyMOL> ').width, y, false];
      }
    }
    if (cursor) {
      const on = cursor[2] || Math.floor(t / (BEAT / 2)) % 2 === 0;
      if (on) {
        ctx.fillStyle = '#e6e8ff';
        ctx.fillRect(cursor[0], cursor[1] - 22, 13, 28);
      }
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // =========================================================================== ACT 5

  const GLYPHS = '01<>/{}[]#$%&*+=?;:~^';

  function stackAct(t, frame) {
    if (t < PIPE_T0) {
      const idx = Math.floor((t - 16) / BEAT);
      const wd = STACK_WORDS[idx];
      const k = (t - wd.t) / BEAT;
      const captions = [
        'upstream PyMOL, kept whole',
        'packages/bridge · owns the PyMOL process',
        'packages/protocol · one set of wire types',
        'apps/web · the new front-end',
      ];
      const bgc = { slam: PALETTE.indigo, split: PALETTE.bg, decode: PALETTE.paper, orbit: PALETTE.coral }[wd.fx];
      const ink = wd.fx === 'decode' ? '#0b0c10' : '#ffffff';
      bg(bgc);
      const cx = W / 2;
      const cy = H / 2 + 50;
      ctx.textBaseline = 'alphabetic';
      if (wd.fx === 'slam') {
        ctx.font = `700 200px ${SG}`;
        const total = ctx.measureText(wd.text).width;
        let x = cx - total / 2;
        for (let i = 0; i < wd.text.length; i++) {
          const ch = wd.text[i];
          const cw = ctx.measureText(ch).width;
          const kk = remap(t, wd.t + i * 0.018, wd.t + i * 0.018 + 0.22);
          const s = lerp(2.8, 1, ease.outExpo(kk));
          ctx.save();
          ctx.translate(x + cw / 2, cy - 70);
          ctx.scale(s, s);
          ctx.globalAlpha = clamp(kk * 3);
          ctx.fillStyle = ink;
          ctx.textAlign = 'center';
          ctx.fillText(ch, 0, 70);
          ctx.restore();
          x += cw;
        }
      } else if (wd.fx === 'split') {
        ctx.font = `700 170px ${SG}`;
        ctx.textAlign = 'center';
        const off = (1 - ease.outExpo(remap(k, 0, 0.55))) * 1100;
        const mid = cy - 60;
        for (const [top, dir] of [
          [true, -1],
          [false, 1],
        ]) {
          ctx.save();
          ctx.beginPath();
          if (top) ctx.rect(0, 0, W, mid);
          else ctx.rect(0, mid, W, H);
          ctx.clip();
          ctx.fillStyle = ink;
          ctx.fillText(wd.text, cx + dir * off, cy);
          ctx.restore();
        }
        ctx.fillStyle = `rgba(56,225,255,${1 - remap(k, 0.2, 0.9)})`;
        ctx.fillRect(0, mid - 1, W * ease.outExpo(remap(k, 0, 0.4)), 3);
      } else if (wd.fx === 'decode') {
        ctx.font = `800 150px ${JB}`;
        ctx.textAlign = 'left';
        const cw = ctx.measureText('M').width;
        const x0 = cx - (cw * wd.text.length) / 2;
        const rand = rng(frame * 31 + 5);
        for (let i = 0; i < wd.text.length; i++) {
          const ch = wd.text[i];
          if (ch === ' ') continue;
          const tr = wd.t + 0.04 + i * 0.022;
          const appear = wd.t + i * 0.008;
          if (t < appear) continue;
          const g = t >= tr ? ch : GLYPHS[Math.floor(rand() * GLYPHS.length)];
          ctx.fillStyle = t >= tr ? ink : PALETTE.indigo;
          ctx.fillText(g, x0 + i * cw, cy);
        }
      } else if (wd.fx === 'orbit') {
        const s = ease.outBack(remap(k, 0, 0.5), 2);
        ctx.save();
        ctx.translate(cx, cy - 60);
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 7;
        for (let i = 0; i < 3; i++) {
          ctx.save();
          ctx.rotate(i * (Math.PI / 3) + (1 - ease.outExpo(remap(k, 0, 0.7))) * 1.4 + t * 0.4);
          ctx.beginPath();
          ctx.ellipse(0, 0, 560 * s, 200 * s, 0, 0, TAU * ease.outCubic(remap(k, 0.05 * i, 0.5 + 0.05 * i)));
          ctx.stroke();
          ctx.restore();
        }
        ctx.restore();
        ctx.font = `700 230px ${SG}`;
        ctx.textAlign = 'center';
        ctx.save();
        ctx.translate(cx, cy - 60);
        ctx.scale(lerp(0.6, 1, s), lerp(0.6, 1, s));
        ctx.fillStyle = ink;
        ctx.fillText(wd.text, 0, 80);
        ctx.restore();
      }
      ctx.textAlign = 'center';
      ctx.font = `500 26px ${JB}`;
      ctx.fillStyle = wd.fx === 'decode' ? '#555a66' : 'rgba(255,255,255,0.75)';
      ctx.globalAlpha = remap(k, 0.15, 0.4);
      ctx.fillText(captions[idx], cx, cy + 150);
      ctx.globalAlpha = 1;
      return;
    }

    // Pipeline diagram.
    bg();
    dotGrid(0.05, -(t - 18) * 30, 0);
    vignetteGlow(W / 2, H / 2, 900, hexRgb(PALETTE.indigo), 0.1);
    const col = ease.inExpo(remap(t, 19.5, 19.98));
    const drift = -(t - PIPE_T0) * 26;
    const n = PIPE_NODES.length;
    const spacing = 250;
    const nx = (i) => lerp(W / 2 - ((n - 1) * spacing) / 2 + i * spacing + drift, W / 2, col);
    const ny = 560;
    const scale = 1 - col;

    // Connectors + travelling data pulses.
    for (let i = 0; i < n - 1; i++) {
      const k = ease.outCubic(remap(t, PIPE_T0 + (i + 1) * 0.125, PIPE_T0 + (i + 1) * 0.125 + 0.2));
      if (k <= 0) continue;
      ctx.strokeStyle = 'rgba(139,141,255,0.45)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 8]);
      ctx.lineDashOffset = -t * 60;
      line([nx(i) + 95 * scale, ny], [lerp(nx(i) + 95 * scale, nx(i + 1) - 95 * scale, k), ny]);
      ctx.setLineDash([]);
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let p = 0; p < 5; p++) {
      const u = (t - 18.9 - p * 0.18) / 0.9;
      if (u < 0 || u > 1) continue;
      const x = lerp(nx(0), nx(n - 1), ease.inOutCubic(u));
      const s = 40 * scale;
      ctx.drawImage(sprites.glow[p % 2 ? 'Y' : 'I'], x - s, ny - s, s * 2, s * 2);
    }
    ctx.restore();
    PIPE_NODES.forEach((name, i) => {
      const k = ease.outBack(remap(t, PIPE_T0 + i * 0.125, PIPE_T0 + i * 0.125 + 0.35), 2.2) * scale;
      if (k <= 0) return;
      // Lights up as the pulse passes.
      let lit = 0;
      for (let p = 0; p < 5; p++) {
        const u = (t - 18.9 - p * 0.18) / 0.9;
        const x = lerp(nx(0), nx(n - 1), ease.inOutCubic(clamp(u)));
        if (u > 0 && u < 1) lit = Math.max(lit, Math.exp(-(((x - nx(i)) / 80) ** 2)));
      }
      ctx.save();
      ctx.translate(nx(i), ny);
      ctx.scale(k, k);
      ctx.fillStyle = rgbStr(mixRgb([18, 20, 30], hexRgb(PALETTE.indigo), 0.25 + 0.75 * lit));
      roundRect(-95, -42, 190, 84, 14);
      ctx.fill();
      ctx.strokeStyle = rgbStr(mixRgb([90, 95, 140], WHITE, lit), 0.9);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.font = `600 24px ${JB}`;
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(name, 0, 9);
      ctx.restore();
    });
    if (col > 0.5) {
      const s = 30 * (col - 0.5) * 2;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(sprites.glow.W, W / 2 - s * 3, ny - s * 3, s * 6, s * 6);
      ctx.restore();
    }
    // Brackets + headline.
    ctx.globalAlpha = 1 - col;
    const bk = ease.outExpo(remap(t, 18.85, 19.25));
    if (bk > 0) {
      const groups = [
        [0, 1, 'C++ · Python'],
        [2, 6, 'TypeScript · React · WebGL'],
      ];
      for (const [a, b, lbl] of groups) {
        const x0 = nx(a) - 95;
        const x1 = lerp(x0, nx(b) + 95, bk);
        ctx.strokeStyle = 'rgba(160,165,200,0.6)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x0, ny + 70);
        ctx.lineTo(x0, ny + 82);
        ctx.lineTo(x1, ny + 82);
        ctx.lineTo(x1, ny + 70);
        ctx.stroke();
        ctx.globalAlpha = (1 - col) * bk;
        ctx.font = `400 20px ${JB}`;
        ctx.fillStyle = '#8e94ad';
        ctx.textAlign = 'center';
        ctx.fillText(lbl, (x0 + nx(b) + 95) / 2, ny + 118);
        ctx.globalAlpha = 1 - col;
      }
    }
    const words = ["PyMOL's", 'engine,', 'streamed', 'to', 'your', 'browser.'];
    ctx.font = `600 64px ${SG}`;
    const space = ctx.measureText(' ').width;
    const tot = words.reduce((s, w) => s + ctx.measureText(w).width, 0) + space * (words.length - 1);
    let x = W / 2 - tot / 2;
    words.forEach((w, i) => {
      maskText(w, x, 380, 64, remap(t, 18.2 + i * 0.06, 18.7 + i * 0.06), {
        weight: 600,
        color: i >= 2 ? PALETTE.cyan : '#fff',
      });
      ctx.font = `600 64px ${SG}`;
      x += ctx.measureText(w).width + space;
    });
    ctx.globalAlpha = 1;
  }

  // =========================================================================== ACT 6

  function logoAct(t) {
    bg();
    vignetteGlow(W / 2, logoY, 1000, hexRgb(PALETTE.indigo), 0.18 * ease.outCubic(remap(t, 20, 21.5)));

    // Giant benzene ring drifting behind everything.
    ctx.save();
    ctx.translate(W / 2, logoY + 40);
    ctx.rotate(t * 0.08);
    ctx.strokeStyle = `rgba(139,141,255,${0.07 * remap(t, 20.2, 21)})`;
    ctx.lineWidth = 2;
    for (const R of [430, 470]) {
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * TAU + Math.PI / 6;
        const r = R * ease.outExpo(remap(t, 20.1, 21.2));
        if (i) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.stroke();
    }
    ctx.restore();

    // Particles: burst, then home into the wordmark from left to right.
    const burst = ease.outExpo(remap(t, 20, 20.45));
    const pa = 1 - remap(t, 21.75, 22.15);
    if (pa > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const p of logoTargets) {
        const k = ease.inOutCubic(remap(t, 20.4 + p.delay, 21.3 + p.delay));
        const th = p.th + (t - 20) * 0.8;
        const sx = W / 2 + Math.cos(th) * p.r0 * burst;
        const sy = logoY + Math.sin(th) * p.r0 * burst * 0.6;
        const sw = Math.sin(k * Math.PI) * p.swirl;
        const x = lerp(sx, p.x, k) + sw;
        const y = lerp(sy, p.y, k) - sw * 0.4;
        const s = lerp(9, 6, k) * (0.8 + 0.2 * Math.sin(t * 11 + p.tw * TAU));
        ctx.globalAlpha = pa * (0.55 + 0.45 * k);
        ctx.drawImage(sprites.glow[p.tw < 0.5 ? 'I' : 'Y'], x - s, y - s, s * 2, s * 2);
      }
      ctx.restore();
    }

    // Crisp wordmark with a specular sweep.
    const crisp = ease.inOutCubic(remap(t, 21.6, 22.0));
    if (crisp > 0) {
      const off = wordLayer;
      const g = off.getContext('2d');
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, W, 360);
      g.font = `700 250px ${SG}`;
      g.textBaseline = 'middle';
      g.fillStyle = '#fff';
      g.fillText('tenmol', wordX, 180);
      const sk = remap(t, 22.55, 23.25);
      if (sk > 0 && sk < 1) {
        g.globalCompositeOperation = 'source-atop';
        const sx = lerp(wordX - 300, wordX + wordW + 300, ease.inOutCubic(sk));
        const grd = g.createLinearGradient(sx - 160, 0, sx + 160, 0);
        grd.addColorStop(0, 'rgba(99,102,241,0)');
        grd.addColorStop(0.5, 'rgba(56,225,255,1)');
        grd.addColorStop(1, 'rgba(99,102,241,0)');
        g.fillStyle = grd;
        g.fillRect(0, 0, W, 360);
      }
      ctx.globalAlpha = crisp;
      ctx.drawImage(off, 0, logoY - 180);
      ctx.globalAlpha = 1;
    }

    // Mark: three bonded atoms, after the favicon.
    const mc = [logoX0 + markW / 2, logoY + 6];
    const rot = (1 - ease.outExpo(remap(t, 20.8, 21.7))) * -1.6;
    const tri = [
      [-62, -40],
      [62, -40],
      [0, 62],
    ].map(([x, y]) => [mc[0] + x * Math.cos(rot) - y * Math.sin(rot), mc[1] + x * Math.sin(rot) + y * Math.cos(rot)]);
    const bk = ease.outCubic(remap(t, 21.2, 21.55));
    if (bk > 0) {
      ctx.strokeStyle = 'rgba(220,225,255,0.85)';
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      for (const [a, b] of [
        [0, 1],
        [1, 2],
        [2, 0],
      ])
        line(tri[a], [lerp(tri[a][0], tri[b][0], bk), lerp(tri[a][1], tri[b][1], bk)]);
    }
    tri.forEach((p, i) => {
      const s = ease.outElastic(remap(t, 20.85 + i * 0.125, 21.6 + i * 0.125)) * 48;
      if (s <= 0) return;
      ctx.drawImage(sprites.mark[i], p[0] - s, p[1] - s, s * 2, s * 2);
    });

    // Tagline + URL.
    const tag = "PyMOL's engine. Rebuilt for the web.";
    ctx.font = `400 30px ${JB}`;
    ctx.textAlign = 'left';
    const tw = ctx.measureText(tag).width;
    let x = W / 2 - tw / 2;
    for (let i = 0; i < tag.length; i++) {
      const k = remap(t, 22.0 + i * 0.012, 22.3 + i * 0.012);
      ctx.globalAlpha = k;
      ctx.fillStyle = '#b4b9d0';
      ctx.fillText(tag[i], x, 690 + (1 - ease.outCubic(k)) * 16);
      x += ctx.measureText(tag[i]).width;
    }
    const uk = remap(t, 22.45, 22.75);
    ctx.globalAlpha = uk;
    ctx.font = `500 26px ${JB}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#8b8dff';
    ctx.fillText('10play.github.io/tenmol', W / 2, 760);
    const uw = ctx.measureText('10play.github.io/tenmol').width;
    ctx.fillRect(W / 2 - uw / 2, 774, uw * ease.inOutCubic(remap(t, 22.6, 23.0)), 2);
    ctx.globalAlpha = 1;
  }

  // =========================================================================== HUD

  function hud(t) {
    const a = remap(t, 0.25, 0.6) * (1 - remap(t, 21.6, 22.0));
    if (a <= 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'difference';
    ctx.globalAlpha = a * 0.8;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    const m = 48;
    const L = 26;
    for (const [x, y, sx, sy] of [
      [m, m, 1, 1],
      [W - m, m, -1, 1],
      [m, H - m, 1, -1],
      [W - m, H - m, -1, -1],
    ]) {
      ctx.beginPath();
      ctx.moveTo(x, y + sy * L);
      ctx.lineTo(x, y);
      ctx.lineTo(x + sx * L, y);
      ctx.stroke();
    }
    ctx.font = `500 16px ${JB}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('TENMOL  ▸  MOTION REEL  ’26', m + 40, m + 4);
    const f = Math.floor(t * FPS);
    const tc = `00:00:${String(Math.floor(f / FPS)).padStart(2, '0')}:${String(f % FPS).padStart(2, '0')}`;
    ctx.textAlign = 'right';
    ctx.fillText(tc, W - m - 40, m + 4);
    const act = actAt(t);
    const idx = ACTS.indexOf(act);
    const sc = remap(t, act.t0, act.t0 + 0.25);
    const rand = rng(f);
    const label = act.label
      .split('')
      .map((ch, i) => (sc >= (i + 1) / act.label.length ? ch : GLYPHS[Math.floor(rand() * GLYPHS.length)]))
      .join('');
    ctx.textAlign = 'left';
    ctx.fillText(`0${idx + 1} / 06   ${label}`, m + 40, H - m - 4);
    // Progress.
    const px0 = W - m - 40 - 360;
    ctx.globalAlpha = a * 0.25;
    ctx.fillRect(px0, H - m - 5, 360, 2);
    ctx.globalAlpha = a * 0.9;
    ctx.fillRect(px0, H - m - 5, 360 * (t / 24), 2);
    ctx.restore();
  }

  // =========================================================================== frame

  return function drawFrame(frame) {
    const t = frame / FPS;
    const act = actAt(t);
    const shake = impactEnv(t, 11) * 16;
    const sr = rng(frame + 99);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.translate((sr() - 0.5) * shake, (sr() - 0.5) * shake);
    ctx.fillStyle = '#000';
    ctx.fillRect(-40, -40, W + 80, H + 80);
    ({ ignite, assemble, machine, command: commandAct, stack: stackAct, logo: logoAct })[act.id](t, frame);
    ctx.restore();
    ctx.save();
    hud(t);
    ctx.restore();

    // Word-cut spikes in act 5.
    let cut = 0;
    for (const w of STACK_WORDS) if (t >= w.t) cut = Math.max(cut, Math.exp(-(t - w.t) * 14));
    const light = act.id === 'stack' && t < PIPE_T0 ? 1 : t >= COMMANDS[3].enter && t < 16 ? 1 : 0;
    return {
      flash: (t < 16 || t >= 20 ? 0.85 : 0.35) * impactEnv(t, 12),
      ca: 0.0015 + 0.014 * impactEnv(t, 8) + 0.004 * riserEnv(t) + 0.008 * cut,
      bloom: light ? 0.25 : 0.85,
      threshold: light ? 0.85 : act.id === 'logo' ? 0.62 : 0.5,
      grain: 0.03,
      vignette: light ? 0.25 : 0.5,
      fade: remap(t, 23.55, 24),
      fadeIn: 1 - remap(t, 0, 0.08),
      time: t,
    };
  };
}
