// A 24-second, 120 BPM soundtrack synthesized from scratch, locked to the same timeline as the
// picture: kicks on the downbeats, a pluck per landing atom, a click per keystroke, a boom per cut.

import fs from 'node:fs';
import {
  BEAT,
  DURATION,
  IMPACTS,
  RISERS,
  LAND_T0,
  LAND_DT,
  H_T0,
  H_DT,
  STACK_WORDS,
  COMMANDS,
  keystrokes,
  rng,
  TAU,
} from './lib.mjs';

const SR = 44100;
const N = Math.ceil(SR * DURATION);
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

export function renderSoundtrack() {
  const L = new Float32Array(N);
  const R = new Float32Array(N);
  const DL = new Float32Array(N); // drums: not sidechained
  const DR = new Float32Array(N);
  let drums = false;
  const send = new Float32Array(N); // reverb bus (mono in, stereo out)
  const duck = new Float32Array(N).fill(1); // sidechain from the kick
  const rand = rng(2024);
  const noise = () => rand() * 2 - 1;

  const add = (i, v, pan = 0, rev = 0) => {
    if (i < 0 || i >= N) return;
    (drums ? DL : L)[i] += v * (1 - Math.max(0, pan));
    (drums ? DR : R)[i] += v * (1 + Math.min(0, pan));
    send[i] += v * rev;
  };

  // ------------------------------------------------------------------ instruments

  let kick = function (t, amp = 1) {
    const i0 = Math.floor(t * SR);
    let ph = 0;
    for (let k = 0; k < SR * 0.5; k++) {
      const s = k / SR;
      const f = 45 + 110 * Math.exp(-s * 28);
      ph += (TAU * f) / SR;
      const env = Math.exp(-s * 7.5);
      const click = k < 200 ? noise() * (1 - k / 200) * 0.35 : 0;
      add(i0 + k, (Math.sin(ph) * env + click) * 0.9 * amp);
    }
    for (let k = 0; k < SR * 0.3; k++) {
      const i = i0 + k;
      if (i < N) duck[i] = Math.min(duck[i], 1 - 0.6 * Math.exp(-(k / SR) * 9));
    }
  }

  let clap = function (t, amp = 0.5) {
    const i0 = Math.floor(t * SR);
    let lp = 0;
    let prev = 0;
    for (let k = 0; k < SR * 0.25; k++) {
      const s = k / SR;
      const burst = s < 0.03 ? (Math.floor(s / 0.01) % 2 ? 0.6 : 1) : 1;
      const env = Math.exp(-s * 18) * burst;
      const n = noise();
      lp += 0.35 * (n - lp);
      const hp = lp - prev;
      prev = lp;
      add(i0 + k, hp * env * amp * 2.2, 0, 0.35);
    }
  }

  let hat = function (t, amp = 0.16, open = false, pan = 0.25) {
    const i0 = Math.floor(t * SR);
    let prev = 0;
    for (let k = 0; k < SR * (open ? 0.25 : 0.06); k++) {
      const n = noise();
      const hp = n - prev;
      prev = n;
      const env = Math.exp(-(k / SR) * (open ? 14 : 60));
      add(i0 + k, hp * env * amp, pan);
    }
  }

  function pluck(t, midi, amp = 0.22, pan = 0) {
    const i0 = Math.floor(t * SR);
    const f = mtof(midi);
    let lp = 0;
    for (let k = 0; k < SR * 0.6; k++) {
      const s = k / SR;
      const saw = 2 * ((f * s) % 1) - 1;
      const sq = Math.sin(TAU * f * 2 * s) * 0.3;
      const cut = 0.04 + 0.5 * Math.exp(-s * 14);
      lp += cut * (saw + sq - lp);
      add(i0 + k, lp * Math.exp(-s * 6) * amp, pan, 0.45);
    }
  }

  function bell(t, midi, amp = 0.12, pan = 0) {
    const i0 = Math.floor(t * SR);
    const f = mtof(midi);
    for (let k = 0; k < SR * 2.5; k++) {
      const s = k / SR;
      const m = Math.sin(TAU * f * 3.5 * s) * 2.2 * Math.exp(-s * 3);
      add(i0 + k, Math.sin(TAU * f * s + m) * Math.exp(-s * 1.6) * amp, pan, 0.6);
    }
  }

  let click = function (t, amp = 0.12, big = false) {
    const i0 = Math.floor(t * SR);
    let prev = 0;
    const len = big ? 0.05 : 0.018;
    for (let k = 0; k < SR * len; k++) {
      const n = noise();
      const hp = n - prev;
      prev = n;
      const env = Math.exp(-(k / SR) * (big ? 70 : 260));
      const tone = Math.sin(TAU * (big ? 900 : 2400) * (k / SR)) * 0.4;
      add(i0 + k, (hp + tone) * env * amp, 0.35, 0.15);
    }
  }

  let boom = function (t, amp = 1) {
    const i0 = Math.floor(t * SR);
    let lp = 0;
    let prev = 0;
    for (let k = 0; k < SR * 2.2; k++) {
      const s = k / SR;
      const sub = Math.sin(TAU * (38 + 30 * Math.exp(-s * 6)) * s) * Math.exp(-s * 2.2);
      const n = noise();
      lp += 0.08 * (n - lp);
      const crash = (n - prev) * Math.exp(-s * 2.8) * 0.28;
      prev = n;
      add(i0 + k, (sub * 0.95 + lp * Math.exp(-s * 5) * 0.9) * amp, 0, 0.1);
      add(i0 + k, crash * amp, 0, 0.6);
    }
  }

  function riser(t0, t1, amp = 0.35) {
    const i0 = Math.floor(t0 * SR);
    const n = Math.floor((t1 - t0) * SR);
    let bp1 = 0;
    let bp2 = 0;
    let ph = 0;
    for (let k = 0; k < n; k++) {
      const u = k / n;
      const fc = 300 + 7000 * u * u;
      const f = 2 * Math.sin((Math.PI * fc) / SR);
      const x = noise();
      bp1 += f * (x - bp1 - 0.35 * bp2);
      bp2 += f * bp1;
      ph += (TAU * (110 + 700 * u * u)) / SR;
      const env = u ** 2.2;
      add(i0 + k, (bp1 * 0.9 + Math.sin(ph) * 0.12) * env * amp, Math.sin(u * 30) * 0.3, 0.3);
    }
  }

  // Chords: Am – F – C – G, one per bar (2 s).
  const CHORDS = [
    [57, 60, 64, 71],
    [53, 57, 60, 67],
    [48, 55, 60, 64],
    [55, 59, 62, 69],
  ];
  const ROOTS = [33, 29, 36, 31];

  function pad(t0, t1, amp = 0.05) {
    for (let bar = Math.floor(t0 / 2); bar * 2 < t1; bar++) {
      const chord = CHORDS[bar % 4];
      const s0 = Math.max(t0, bar * 2);
      const s1 = Math.min(t1, bar * 2 + 2);
      for (const m of chord)
        for (const det of [-0.08, 0, 0.08]) {
          const f = mtof(m + det);
          let lp = 0;
          const i0 = Math.floor(s0 * SR);
          const len = Math.floor((s1 - s0 + 0.4) * SR);
          for (let k = 0; k < len; k++) {
            const s = k / SR;
            const saw = 2 * ((f * (s + s0)) % 1) - 1;
            lp += 0.03 * (saw - lp);
            const env = Math.min(1, s / 0.25) * Math.min(1, Math.max(0, (s1 - s0 + 0.4 - s) / 0.4));
            add(i0 + k, lp * env * amp, det * 6, 0.5);
          }
        }
    }
  }

  function bass(t0, t1, amp = 0.32) {
    const step = BEAT / 2;
    for (let t = t0; t < t1 - 1e-6; t += step) {
      const root = ROOTS[Math.floor(t / 2) % 4];
      const m = Math.floor((t + 1e-6) / step) % 2 ? root + 12 : root;
      const f = mtof(m);
      const i0 = Math.floor(t * SR);
      let lp = 0;
      for (let k = 0; k < step * SR; k++) {
        const s = k / SR;
        const saw = 2 * ((f * s) % 1) - 1;
        lp += (0.02 + 0.1 * Math.exp(-s * 16)) * (saw - lp);
        add(i0 + k, lp * Math.exp(-s * 3) * amp);
      }
    }
  }

  const drum =
    (fn) =>
    (...a) => {
      drums = true;
      fn(...a);
      drums = false;
    };
  kick = drum(kick);
  clap = drum(clap);
  hat = drum(hat);
  click = drum(click);
  boom = drum(boom);

  // ------------------------------------------------------------------ arrangement

  // Act 1: shimmer + riser into the first hit.
  pad(0.4, 2, 0.03);
  for (let i = 0; i < 4; i++) bell(0.62 + i * 0.25, [81, 76, 72, 69][i], 0.05, (i % 2) * 0.6 - 0.3);

  // Kicks: four-on-the-floor with breaks before each impact.
  const breaks = [
    [5.5, 6],
    [11, 12],
    [19.5, 20],
  ];
  for (let t = 2; t < 20 - 1e-6; t += BEAT) {
    if (breaks.some(([a, b]) => t >= a && t < b)) continue;
    kick(t, t < 6 ? 0.85 : 1);
  }
  // Claps on 2 and 4 from act 3.
  for (let t = 6 + BEAT; t < 19.5; t += 2 * BEAT) if (!(t >= 11 && t < 12)) clap(t);
  // Hats: offbeat 8ths, 16ths in act 5.
  for (let t = 6; t < 19.5; t += BEAT / 4) {
    const pos = Math.round((t - 6) / (BEAT / 4)) % 4;
    if (t >= 11 && t < 12) continue;
    if (pos === 2) hat(t, 0.13, true);
    else if (t >= 16 || pos === 0) hat(t, t >= 16 ? 0.08 : 0.05, false, -0.25);
  }
  bass(2, 5.5);
  bass(6, 11);
  bass(12, 19.5);
  pad(2, 20, 0.022);

  // Atom landings: a rising pentatonic pluck per heavy atom, sparkle for each hydrogen.
  const PENTA = [57, 60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84, 86, 88];
  for (let i = 0; i < 14; i++) pluck(LAND_T0 + i * LAND_DT, PENTA[i], 0.16, ((i % 3) - 1) * 0.5);
  for (let i = 0; i < 10; i++) bell(H_T0 + i * H_DT, 93 + (i % 3) * 2, 0.02, ((i % 2) - 0.5) * 0.8);

  // Protein assembly: a sweep of plucks as the tube draws on.
  for (let i = 0; i < 12; i++) pluck(8.2 + i * (BEAT / 4), PENTA[(i * 2) % 14] - 12, 0.1, ((i % 2) - 0.5) * 0.7);
  // HUD callouts.
  for (let i = 0; i < 5; i++) bell(10.25 + i * 0.125, 88 - i * 3, 0.04, ((i % 2) - 0.5) * 0.9);

  // Typing.
  for (const k of keystrokes()) click(k, 0.1, COMMANDS.some((c) => Math.abs(c.enter - k) < 1e-6));
  COMMANDS.forEach((c, i) => pluck(c.enter, [57, 60, 64, 69][i] + 12, 0.14));
  boom(COMMANDS[3].enter, 0.35);

  // Act 5 word cuts: a chord stab each.
  STACK_WORDS.forEach((w, i) => {
    for (const m of CHORDS[i % 4]) pluck(w.t, m + 12, 0.07);
  });
  for (let i = 0; i < 7; i++) bell(18 + i * 0.125, 76 + [0, 2, 4, 7, 9, 12, 14][i], 0.035, ((i % 2) - 0.5));

  // Risers + impacts.
  for (const [a, b] of RISERS) riser(a, b, a < 1 ? 0.22 : 0.3);
  IMPACTS.forEach((t) => boom(t, t === 20 ? 1.1 : 0.8));

  // Logo: the mark atoms chime, then a big Am(add9) that rings out.
  [0, 1, 2].forEach((i) => bell(20.85 + i * 0.125, [69, 72, 76][i], 0.09, (i - 1) * 0.6));
  for (const m of [45, 57, 60, 64, 71, 76]) {
    const f = mtof(m);
    const i0 = Math.floor(20 * SR);
    for (let k = 0; k < 4 * SR; k++) {
      const s = k / SR;
      const v = (Math.sin(TAU * f * s) + 0.3 * Math.sin(TAU * f * 2.003 * s)) * Math.exp(-s * 0.9) * Math.min(1, s / 0.02);
      add(i0 + k, v * 0.045, ((m % 5) - 2) * 0.2, 0.5);
    }
  }
  bell(21.8, 88, 0.07, 0.3);
  bell(21.8, 93, 0.05, -0.3);

  // ------------------------------------------------------------------ mix

  for (let i = 0; i < N; i++) {
    L[i] = L[i] * duck[i] + DL[i];
    R[i] = R[i] * duck[i] + DR[i];
  }
  // Freeverb-ish send: 4 damped combs + 2 allpasses per side.
  const reverb = (spread) => {
    const out = new Float32Array(N);
    for (const len of [1557, 1617, 1491, 1422].map((x) => x + spread)) {
      const buf = new Float32Array(len);
      let idx = 0;
      let lp = 0;
      for (let i = 0; i < N; i++) {
        const y = buf[idx];
        lp = y * 0.6 + lp * 0.4;
        buf[idx] = send[i] + lp * 0.83;
        out[i] += y * 0.25;
        idx = (idx + 1) % len;
      }
    }
    for (const len of [556 + spread, 441 + spread]) {
      const buf = new Float32Array(len);
      let idx = 0;
      for (let i = 0; i < N; i++) {
        const b = buf[idx];
        const x = out[i];
        buf[idx] = x + b * 0.5;
        out[i] = b - x;
        idx = (idx + 1) % len;
      }
    }
    return out;
  };
  const rl = reverb(0);
  const rr = reverb(23);
  let peak = 0;
  for (let i = 0; i < N; i++) {
    const fadeOut = Math.min(1, Math.max(0, (DURATION - i / SR) / 0.45));
    L[i] = Math.tanh((L[i] + rl[i] * 0.35) * 1.1) * fadeOut;
    R[i] = Math.tanh((R[i] + rr[i] * 0.35) * 1.1) * fadeOut;
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const g = 0.89 / peak;
  for (let i = 0; i < N; i++) {
    L[i] *= g;
    R[i] *= g;
  }
  return { L, R };
}

export function writeSoundtrack(file) {
  const { L, R } = renderSoundtrack();
  const buf = Buffer.alloc(44 + N * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + N * 4, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(N * 4, 40);
  for (let i = 0; i < N; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), 46 + i * 4);
  }
  fs.writeFileSync(file, buf);
}

if (import.meta.url === `file://${process.argv[1]}`) writeSoundtrack(process.argv[2] ?? 'soundtrack.wav');
