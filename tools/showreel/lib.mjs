// Shared timeline, easing and math for the showreel. Runs in both the browser (frames)
// and Node (the soundtrack), so every cut, keystroke and impact lands on the same beat.

export const W = 1920;
export const H = 1080;
export const FPS = 60;
export const BPM = 120;
export const BEAT = 60 / BPM;
export const DURATION = 24;

/** Six acts, each exactly two bars (4 s) except the 2 s cold open. */
export const ACTS = [
  { id: 'ignite', label: 'ATOM', t0: 0, t1: 2 },
  { id: 'assemble', label: 'MOLECULE', t0: 2, t1: 6 },
  { id: 'machine', label: 'PROTEIN', t0: 6, t1: 12 },
  { id: 'command', label: 'COMMAND', t0: 12, t1: 16 },
  { id: 'stack', label: 'STACK', t0: 16, t1: 20 },
  { id: 'logo', label: 'TENMOL', t0: 20, t1: 24 },
];

/** Downbeats that get a hit: flash, shake, chromatic split and a boom in the mix. */
export const IMPACTS = [2, 6, 12, 16, 20];
/** Rising tension into each impact. */
export const RISERS = [
  [0.6, 2],
  [5, 6],
  [11, 12],
  [15.2, 16],
  [19, 20],
];

/** Terminal commands in act 4. `enter` sits on a beat; typing is back-timed from it. */
export const CHAR_DT = 0.03;
export const COMMANDS = [
  { enter: 12.5, text: 'load 1tii.pdb', out: 'ObjectMolecule: read 5,469 atoms, 7 chains' },
  { enter: 13.5, text: 'show cartoon', out: 'Cartoon: 712 residues' },
  { enter: 14.5, text: 'spectrum count, rainbow', out: 'Spectrum: 712 residues, blue → red' },
  { enter: 15.5, text: 'set ray_trace_mode, 1', out: 'Ray: outline mode' },
].map((c) => ({ ...c, start: c.enter - c.text.length * CHAR_DT - 0.06 }));

export function keystrokes() {
  const out = [];
  for (const c of COMMANDS) {
    for (let i = 0; i < c.text.length; i++) out.push(c.start + i * CHAR_DT);
    out.push(c.enter);
  }
  return out;
}

/** Caffeine heavy atoms land on sixteenth notes; hydrogens rattle in after. */
export const LAND_T0 = 2.25;
export const LAND_DT = BEAT / 4;
export const H_T0 = LAND_T0 + 14 * LAND_DT + 0.05;
export const H_DT = 0.03;

/** Act 5 fast-cut words, one per beat. */
export const STACK_WORDS = [
  { t: 16.0, text: 'C++ ENGINE', fx: 'slam' },
  { t: 16.5, text: 'PYTHON BRIDGE', fx: 'split' },
  { t: 17.0, text: 'WIRE PROTOCOL', fx: 'decode' },
  { t: 17.5, text: 'REACT', fx: 'orbit' },
];
export const PIPE_T0 = 18.0;
export const PIPE_NODES = ['engine', 'bridge', 'protocol', 'client', 'stores', 'viewport', 'web'];

// ---------------------------------------------------------------- easing & helpers

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const remap = (t, a, b) => clamp((t - a) / (b - a));
export const smooth = (t) => t * t * (3 - 2 * t);
export const TAU = Math.PI * 2;

export const ease = {
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - (1 - t) ** 3,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outQuart: (t) => 1 - (1 - t) ** 4,
  inOutQuart: (t) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2),
  inExpo: (t) => (t <= 0 ? 0 : 2 ** (10 * t - 10)),
  outExpo: (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
  inOutExpo: (t) =>
    t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2,
  outBack: (t, s = 1.70158) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2,
  outElastic: (t) =>
    t <= 0 ? 0 : t >= 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1,
};

/** Seeded PRNG (mulberry32) — every "random" thing in the reel is reproducible. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 0..1 envelope that spikes at each impact and decays exponentially. */
export function impactEnv(t, decay = 7) {
  let v = 0;
  for (const i of IMPACTS) if (t >= i) v = Math.max(v, Math.exp(-(t - i) * decay));
  return v;
}

export function riserEnv(t) {
  let v = 0;
  for (const [a, b] of RISERS) if (t >= a && t < b) v = Math.max(v, ((t - a) / (b - a)) ** 2);
  return v;
}

export const actAt = (t) => ACTS.find((a) => t >= a.t0 && t < a.t1) ?? ACTS[ACTS.length - 1];

// ---------------------------------------------------------------- 3x3 rotation math

export const rotX = (a) => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [1, 0, 0, 0, c, -s, 0, s, c];
};
export const rotY = (a) => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
};
export const rotZ = (a) => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
};
export function mul(A, B) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  return r;
}
export const chain = (...ms) => ms.reduce((a, b) => mul(a, b));

/** Rotation taking unit vector `a` onto +Z (towards the camera). */
export function alignToZ(a) {
  const [x, y, z] = a;
  const v = [y, -x, 0]; // a × z
  const s = Math.hypot(v[0], v[1]);
  if (s < 1e-9) return z > 0 ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : rotX(Math.PI);
  const c = z;
  const k = [v[0] / s, v[1] / s, 0];
  const t = 1 - c;
  return [
    t * k[0] * k[0] + c,
    t * k[0] * k[1],
    s * k[1],
    t * k[0] * k[1],
    t * k[1] * k[1] + c,
    -s * k[0],
    -s * k[1],
    s * k[0],
    c,
  ];
}

/**
 * Perspective camera. World units in, screen pixels out. Returns
 * [sx, sy, depth, pxPerUnit] or null when behind the near plane.
 */
export function camera({ R, dist = 3.2, focal = 1150, cx = W / 2, cy = H / 2, zoom = 1 }) {
  return (x, y, z) => {
    const X = R[0] * x + R[1] * y + R[2] * z;
    const Y = R[3] * x + R[4] * y + R[5] * z;
    const Z = R[6] * x + R[7] * y + R[8] * z;
    const d = dist - Z;
    if (d < 0.08) return null;
    const s = (focal * zoom) / d;
    return [cx + X * s, cy - Y * s, d, s];
  };
}

// ---------------------------------------------------------------- color

export function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function mixRgb(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
export const rgbStr = (c, a = 1) =>
  `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

export function hslRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** PyMOL's `rainbow`: blue at the N-terminus through to red at the C-terminus. */
export const rainbow = (u) => hslRgb(lerp(240, 0, clamp(u)), 0.92, 0.58);

export const PALETTE = {
  bg: '#05070a',
  ink: '#eef0ff',
  indigo: '#6366f1',
  violet: '#a78bfa',
  cyan: '#38e1ff',
  coral: '#ff6b6b',
  amber: '#f5b642',
  paper: '#f4f1ea',
};
