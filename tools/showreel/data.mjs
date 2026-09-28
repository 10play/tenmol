// Scene data: the real 1TII structure from the engine's test set, and a hand-built caffeine.

import { alignToZ, rng } from './lib.mjs';

const CHAIN_ORDER = ['D', 'E', 'F', 'G', 'H', 'A', 'C'];

/** Parse 1TII into normalized atoms, bonds, per-chain CA traces and the 5-fold axis. */
export function buildProtein(pdbText) {
  const atoms = [];
  const ss = new Map();
  for (const line of pdbText.split('\n')) {
    const rec = line.slice(0, 6).trim();
    if (rec === 'HELIX') {
      const ch = line[19];
      for (let r = +line.slice(21, 25); r <= +line.slice(33, 37); r++) ss.set(ch + r, 'H');
    } else if (rec === 'SHEET') {
      const ch = line[21];
      for (let r = +line.slice(22, 26); r <= +line.slice(33, 37); r++) ss.set(ch + r, 'E');
    } else if (rec === 'ATOM' || rec === 'HETATM') {
      if (line.slice(17, 20) === 'HOH') continue;
      atoms.push({
        name: line.slice(12, 16).trim(),
        chain: line[21],
        res: +line.slice(22, 26),
        x: +line.slice(30, 38),
        y: +line.slice(38, 46),
        z: +line.slice(46, 54),
        el: (line.slice(76, 78).trim() || line.slice(12, 14).trim()).replace(/\d/g, '')[0],
      });
    }
  }

  // Bonds by distance on a spatial hash, in Ångström before normalizing.
  const cell = 2;
  const grid = new Map();
  const key = (a, b, c) => `${a},${b},${c}`;
  atoms.forEach((a, i) => {
    const k = key(Math.floor(a.x / cell), Math.floor(a.y / cell), Math.floor(a.z / cell));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  const bonds = [];
  atoms.forEach((a, i) => {
    const gx = Math.floor(a.x / cell);
    const gy = Math.floor(a.y / cell);
    const gz = Math.floor(a.z / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const j of grid.get(key(gx + dx, gy + dy, gz + dz)) ?? []) {
            if (j <= i) continue;
            const b = atoms[j];
            const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
            if (d < 1.9 && d > 0.4) bonds.push([i, j]);
          }
  });

  // Center on the B-pentamer and normalize so the whole toxin fits in radius ~1.
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let n = 0;
  for (const a of atoms)
    if ('DEFGH'.includes(a.chain)) {
      cx += a.x;
      cy += a.y;
      cz += a.z;
      n++;
    }
  cx /= n;
  cy /= n;
  cz /= n;
  let rmax = 0;
  for (const a of atoms) rmax = Math.max(rmax, Math.hypot(a.x - cx, a.y - cy, a.z - cz));
  const k = 1 / rmax;
  for (const a of atoms) {
    a.x = (a.x - cx) * k;
    a.y = (a.y - cy) * k;
    a.z = (a.z - cz) * k;
  }

  // Chains, CA traces and centroids.
  const chains = CHAIN_ORDER.map((id) => ({ id, ca: [], centroid: [0, 0, 0] }));
  const byId = Object.fromEntries(chains.map((c) => [c.id, c]));
  for (const a of atoms)
    if (a.name === 'CA' && byId[a.chain])
      byId[a.chain].ca.push({ p: [a.x, a.y, a.z], ss: ss.get(a.chain + a.res) ?? 'L', res: a.res });
  let g = 0;
  for (const c of chains) {
    for (const r of c.ca) {
      r.g = g++;
      c.centroid[0] += r.p[0] / c.ca.length;
      c.centroid[1] += r.p[1] / c.ca.length;
      c.centroid[2] += r.p[2] / c.ca.length;
    }
  }
  const nres = g;
  for (const c of chains) for (const r of c.ca) r.u = r.g / (nres - 1);

  // 5-fold axis: sum of cross products of consecutive pentamer centroids.
  const ring = chains.slice(0, 5).map((c) => c.centroid);
  const axis = [0, 0, 0];
  for (let i = 0; i < 5; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % 5];
    axis[0] += p[1] * q[2] - p[2] * q[1];
    axis[1] += p[2] * q[0] - p[0] * q[2];
    axis[2] += p[0] * q[1] - p[1] * q[0];
  }
  const al = Math.hypot(...axis);
  axis.forEach((v, i) => (axis[i] = v / al));
  // Point the A subunit away from the viewer in the top-down shot.
  let side = 0;
  for (const a of atoms) if (a.chain === 'A') side += a.x * axis[0] + a.y * axis[1] + a.z * axis[2];
  if (side > 0) axis.forEach((v, i) => (axis[i] = -v));

  // Smooth backbone: Catmull-Rom through CA, 5 samples per residue.
  for (const c of chains) c.spline = catmull(c.ca, 5);

  // Particle choreography: a five-armed galaxy that implodes into the structure.
  const rand = rng(1729);
  const R0 = alignToZ(axis);
  for (const a of atoms) {
    const arm = Math.floor(rand() * 5);
    const r = 1.2 + rand() ** 0.7 * 2.6;
    a.gθ = (arm * Math.PI * 2) / 5 + r * 1.1 + (rand() - 0.5) * 0.5;
    a.gr = r;
    a.gz = (rand() - 0.5) * 0.35;
    a.delay = Math.hypot(a.x, a.y, a.z) * 0.55 + rand() * 0.18;
    a.tw = rand();
  }

  return { atoms, bonds, chains, axis, R0, nres };
}

function catmull(ca, sub) {
  const pts = [];
  const P = (i) => ca[Math.max(0, Math.min(ca.length - 1, i))];
  for (let i = 0; i < ca.length - 1; i++) {
    const p0 = P(i - 1).p;
    const p1 = P(i).p;
    const p2 = P(i + 1).p;
    const p3 = P(i + 2).p;
    for (let s = 0; s < sub; s++) {
      const t = s / sub;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (k) =>
        0.5 *
        (2 * p1[k] +
          (-p0[k] + p2[k]) * t +
          (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 +
          (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
      const r = t < 0.5 ? P(i) : P(i + 1);
      pts.push({ p: [f(0), f(1), f(2)], ss: r.ss, u: P(i).u + (P(i + 1).u - P(i).u) * t });
    }
  }
  pts.push({ ...P(ca.length - 1), p: P(ca.length - 1).p });
  return pts;
}

/** Caffeine (1,3,7-trimethylxanthine), 14 heavy atoms + 10 H, in Å, laid out by hand. */
export function buildCaffeine() {
  const hx = (k) => [1.4 * Math.cos(Math.PI / 2 - (k * Math.PI) / 3), 1.4 * Math.sin(Math.PI / 2 - (k * Math.PI) / 3)];
  const [C6, C5, C4, N3, C2, N1] = [0, 1, 2, 3, 4, 5].map(hx);
  const pc = 1.212 + 0.963;
  const pv = (deg) => [pc + 1.191 * Math.cos((deg * Math.PI) / 180), 1.191 * Math.sin((deg * Math.PI) / 180)];
  const heavy = [
    ['C', C6],
    ['C', C5],
    ['C', C4],
    ['N', N3],
    ['C', C2],
    ['N', N1],
    ['O', [0, 2.62]],
    ['O', [-2.27, -1.31]],
    ['C', [-2.51, 1.45]],
    ['C', [0, -2.87]],
    ['N', pv(72)],
    ['C', pv(0)],
    ['N', pv(-72)],
    ['C', [pc + 1.66 * 0.309, 1.66 * 0.951]],
  ];
  //            0  1  2  3  4  5  6  7  8  9 10 11 12 13
  const bonds = [
    [0, 1, 1], [1, 2, 2], [2, 3, 1], [3, 4, 1], [4, 5, 1], [5, 0, 1],
    [0, 6, 2], [4, 7, 2], [5, 8, 1], [3, 9, 1],
    [1, 10, 1], [10, 11, 1], [11, 12, 2], [12, 2, 1], [10, 13, 1],
  ];
  const atoms = heavy.map(([el, [x, y]]) => ({ el, p: [x, y, 0] }));
  const addH = (ci, from) => {
    const c = atoms[ci].p;
    const f = atoms[from].p;
    const d = [c[0] - f[0], c[1] - f[1]];
    const l = Math.hypot(...d);
    d[0] /= l;
    d[1] /= l;
    const n = [-d[1], d[0]];
    for (let k = 0; k < 3; k++) {
      const th = (k * 2 * Math.PI) / 3 + 0.4;
      const h = [
        c[0] + 1.09 * (0.34 * d[0] + 0.94 * Math.cos(th) * n[0]),
        c[1] + 1.09 * (0.34 * d[1] + 0.94 * Math.cos(th) * n[1]),
        1.09 * 0.94 * Math.sin(th),
      ];
      bonds.push([ci, atoms.length, 1]);
      atoms.push({ el: 'H', p: h });
    }
  };
  addH(8, 5);
  addH(9, 3);
  addH(13, 10);
  bonds.push([11, atoms.length, 1]);
  const c8 = atoms[11].p;
  atoms.push({ el: 'H', p: [c8[0] + 1.08, c8[1], 0] });

  // Center and scale to unit-ish radius.
  const m = [0, 0, 0];
  for (const a of atoms) for (let k = 0; k < 3; k++) m[k] += a.p[k] / atoms.length;
  for (const a of atoms) a.p = a.p.map((v, k) => (v - m[k]) / 3.4);

  const rand = rng(42);
  atoms.forEach((a, i) => {
    a.i = i;
    const th = rand() * Math.PI * 2;
    const ph = (rand() - 0.5) * 1.6;
    a.from = [Math.cos(th) * Math.cos(ph) * 5, Math.sin(ph) * 4, Math.sin(th) * Math.cos(ph) * 3 + 1.5];
  });
  return { atoms, bonds };
}
