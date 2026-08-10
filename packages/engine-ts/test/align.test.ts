import { describe, expect, it } from 'vitest';

import { Executive } from '../src/exec/executive';
import { parsePdb } from '../src/model/pdb';
import { registerAlign } from '../src/cmd/align';
import type { CommandHandler } from '../src/cmd/registrar';

/* ------------------------------ PDB builder ------------------------------ */

type Vec3 = [number, number, number];

interface AtomSpec {
  name: string;
  resn: string;
  chain: string;
  resi: number;
  pos: Vec3;
  elem: string;
}

/** Format one ATOM record into the exact PDB fixed columns. */
function atomLine(serial: number, a: AtomSpec): string {
  const buf = ' '.repeat(80).split('');
  const put = (start: number, s: string): void => {
    for (let i = 0; i < s.length; i++) buf[start - 1 + i] = s[i]!;
  };
  put(1, 'ATOM');
  put(7, serial.toString().padStart(5));
  put(a.name.length >= 4 ? 13 : 14, a.name);
  put(18, a.resn.padStart(3));
  put(22, a.chain);
  put(23, a.resi.toString().padStart(4));
  put(31, a.pos[0].toFixed(3).padStart(8));
  put(39, a.pos[1].toFixed(3).padStart(8));
  put(47, a.pos[2].toFixed(3).padStart(8));
  put(55, '1.00');
  put(61, '0.00');
  put(77, a.elem.padStart(2));
  return buf.join('').replace(/\s+$/, '');
}

/** Single-model PDB from a list of atoms. */
function makePdb(atoms: AtomSpec[]): string {
  return atoms.map((a, i) => atomLine(i + 1, a)).join('\n');
}

/** Multi-model PDB: same atom table, one MODEL per coordinate frame. */
function makeMultiModelPdb(atoms: AtomSpec[], frames: Vec3[][]): string {
  const out: string[] = [];
  frames.forEach((frame, f) => {
    out.push(`MODEL     ${(f + 1).toString().padStart(4)}`);
    frame.forEach((pos, i) => {
      const a = atoms[i]!;
      out.push(atomLine(i + 1, { ...a, pos }));
    });
    out.push('ENDMDL');
  });
  return out.join('\n');
}

/* ------------------------------ geometry -------------------------------- */

/** Rotation by 120 deg about (1,1,1): cyclically permutes axes (x,y,z)->(z,x,y). */
function rot120(p: Vec3): Vec3 {
  return [p[2], p[0], p[1]];
}
/** Rotation by 90 deg about +z: (x,y,z)->(-y,x,z). */
function rotZ90(p: Vec3): Vec3 {
  return [-p[1], p[0], p[2]];
}
function add(p: Vec3, t: Vec3): Vec3 {
  return [p[0] + t[0], p[1] + t[1], p[2] + t[2]];
}
function rigid(p: Vec3, rot: (v: Vec3) => Vec3, t: Vec3): Vec3 {
  return add(rot(p), t);
}

/* ------------------------------- harness -------------------------------- */

function setup(mols: Array<{ name: string; pdb: string }>) {
  const ex = new Executive();
  for (const m of mols) ex.addMolecule(parsePdb(m.pdb, m.name));
  const handlers = new Map<string, CommandHandler>();
  let publishes = 0;
  const ctx = {
    command: (n: string, f: CommandHandler) => handlers.set(n, f),
    executive: ex,
    publish() {
      publishes++;
    },
    emitView() {},
    str: (v: unknown, d = '') => (v == null ? d : String(v)),
  };
  registerAlign(ctx);
  return {
    ex,
    call: (name: string, args: unknown[], kw: Record<string, unknown> = {}) =>
      handlers.get(name)!(args, kw),
    coord: (obj: string, i: number, state = 1): Vec3 => ex.molecule(obj)!.coord(i, state),
    publishes: () => publishes,
  };
}

const close = (a: number, b: number, eps = 1e-4) => expect(Math.abs(a - b)).toBeLessThan(eps);
const closeVec = (a: Vec3, b: Vec3, eps = 1e-3) => {
  close(a[0], b[0], eps);
  close(a[1], b[1], eps);
  close(a[2], b[2], eps);
};

/* Non-coplanar reference atom set (a tetrahedron). */
const TETRA: Vec3[] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/** Build an object of `elem C` atoms at the given positions. */
function pointCloud(positions: Vec3[]): string {
  return makePdb(
    positions.map((pos, i) => ({
      name: `C${i + 1}`,
      resn: 'UNK',
      chain: 'A',
      resi: i + 1,
      pos,
      elem: 'C',
    })),
  );
}

/* -------------------------------- rms_cur ------------------------------- */

describe('rms_cur (paired, no fit)', () => {
  it('is 0 for two identical point sets', () => {
    const t = setup([
      { name: 'tgt', pdb: pointCloud(TETRA) },
      { name: 'mob', pdb: pointCloud(TETRA) },
    ]);
    expect(t.call('rms_cur', ['mob', 'tgt'])).toBe(0);
  });

  it('equals the constant offset magnitude for a pure translation', () => {
    // Each paired atom is displaced by (1,2,2) => |d| = sqrt(1+4+4) = 3, so the
    // RMS over all pairs is exactly 3.0.
    const off: Vec3 = [1, 2, 2];
    const t = setup([
      { name: 'tgt', pdb: pointCloud(TETRA) },
      { name: 'mob', pdb: pointCloud(TETRA.map((p) => add(p, off))) },
    ]);
    close(t.call('rms_cur', ['mob', 'tgt']) as number, 3.0, 1e-4);
  });

  it('does NOT move the coordinates (measure only)', () => {
    const t = setup([
      { name: 'tgt', pdb: pointCloud(TETRA) },
      { name: 'mob', pdb: pointCloud(TETRA.map((p) => add(p, [1, 2, 2]))) },
    ]);
    t.call('rms_cur', ['mob', 'tgt']);
    closeVec(t.coord('mob', 0), [1, 2, 2]);
  });

  it('throws when the atom counts differ', () => {
    const t = setup([
      { name: 'tgt', pdb: pointCloud(TETRA) },
      { name: 'mob', pdb: pointCloud(TETRA.slice(0, 3)) },
    ]);
    expect(() => t.call('rms_cur', ['mob', 'tgt'])).toThrow();
  });
});

/* ---------------------------------- fit --------------------------------- */

describe('fit (Kabsch superposition)', () => {
  it('gives rms 0 and leaves coords put for identical sets', () => {
    const t = setup([
      { name: 'tgt', pdb: pointCloud(TETRA) },
      { name: 'mob', pdb: pointCloud(TETRA) },
    ]);
    close(t.call('fit', ['mob', 'tgt']) as number, 0);
    for (let i = 0; i < TETRA.length; i++) closeVec(t.coord('mob', i), TETRA[i]!);
  });

  it('recovers a pure translation: rms ~ 0 and mobile lands on target', () => {
    const t = setup([
      { name: 'tgt', pdb: pointCloud(TETRA) },
      { name: 'mob', pdb: pointCloud(TETRA.map((p) => add(p, [5, -3, 2]))) },
    ]);
    close(t.call('fit', ['mob', 'tgt']) as number, 0, 1e-3);
    for (let i = 0; i < TETRA.length; i++) closeVec(t.coord('mob', i), TETRA[i]!);
  });

  it('recovers a known 90-deg rotation about z', () => {
    const t = setup([
      { name: 'tgt', pdb: pointCloud(TETRA) },
      { name: 'mob', pdb: pointCloud(TETRA.map((p) => rigid(p, rotZ90, [5, 0, 0]))) },
    ]);
    close(t.call('fit', ['mob', 'tgt']) as number, 0, 1e-3);
    for (let i = 0; i < TETRA.length; i++) closeVec(t.coord('mob', i), TETRA[i]!);
  });

  it('recovers a general rotation + translation, mobile onto target', () => {
    const t = setup([
      { name: 'tgt', pdb: pointCloud(TETRA) },
      { name: 'mob', pdb: pointCloud(TETRA.map((p) => rigid(p, rot120, [10, -5, 3]))) },
    ]);
    close(t.call('fit', ['mob', 'tgt']) as number, 0, 1e-3);
    for (let i = 0; i < TETRA.length; i++) closeVec(t.coord('mob', i), TETRA[i]!);
    expect(t.publishes()).toBe(1);
  });

  it('moves only the mobile object; the target is untouched', () => {
    const t = setup([
      { name: 'tgt', pdb: pointCloud(TETRA) },
      { name: 'mob', pdb: pointCloud(TETRA.map((p) => rigid(p, rot120, [10, -5, 3]))) },
    ]);
    t.call('fit', ['mob', 'tgt']);
    for (let i = 0; i < TETRA.length; i++) closeVec(t.coord('tgt', i), TETRA[i]!);
  });

  it('reports a nonzero RMS for a non-rigid (sheared) copy', () => {
    // Stretch the tetra along x on the mobile only; no rigid transform can make
    // it coincide, so the post-fit RMS is strictly > 0.
    const sheared = TETRA.map((p): Vec3 => [p[0] * 2, p[1], p[2]]);
    const t = setup([
      { name: 'tgt', pdb: pointCloud(TETRA) },
      { name: 'mob', pdb: pointCloud(sheared) },
    ]);
    const rms = t.call('fit', ['mob', 'tgt']) as number;
    expect(rms).toBeGreaterThan(0.1);
  });
});

/* --------------------------------- align -------------------------------- */

/** A CA-only chain object; one residue per position, resn from `seq`. */
function caChain(seq: string[], positions: Vec3[]): string {
  return makePdb(
    seq.map((resn, i) => ({
      name: 'CA',
      resn,
      chain: 'A',
      resi: i + 1,
      pos: positions[i]!,
      elem: 'C',
    })),
  );
}

const SEQ = ['ALA', 'GLY', 'SER', 'VAL', 'LEU'];
const CA_POS: Vec3[] = [
  [0, 0, 0],
  [1.5, 0.5, 0],
  [3, 0, 1],
  [4.5, 0.5, 1],
  [6, 0, 0],
];

describe('align (CA sequence superposition)', () => {
  it('aligns identical sequences to rms ~ 0 over every residue', () => {
    const t = setup([
      { name: 'tgt', pdb: caChain(SEQ, CA_POS) },
      { name: 'mob', pdb: caChain(SEQ, CA_POS.map((p) => rigid(p, rot120, [10, -5, 3]))) },
    ]);
    const res = t.call('align', ['mob', 'tgt']) as number[];
    // [rmsd, n_atoms, n_cycles, rmsd_pre, n_pre, raw_score, n_residues]
    expect(res).toHaveLength(7);
    close(res[0]!, 0, 1e-3); // post-fit rmsd
    expect(res[1]).toBe(5); // atoms aligned
    expect(res[2]).toBe(0); // cycles
    expect(res[6]).toBe(5); // residues
    expect(res[3]).toBeGreaterThan(1); // rmsd_pre (mobile far away pre-fit)
    // Mobile CAs land on the target CAs.
    for (let i = 0; i < CA_POS.length; i++) closeVec(t.coord('mob', i), CA_POS[i]!);
  });

  it('skips an inserted residue via the LCS pairing (gap handling)', () => {
    // Mobile has an extra CYS inserted after GLY; the 5 shared residues are a
    // rigid image of the target, so only they pair and the fit is exact.
    const mobSeq = ['ALA', 'GLY', 'CYS', 'SER', 'VAL', 'LEU'];
    const mobPos: Vec3[] = [
      rigid(CA_POS[0]!, rot120, [10, -5, 3]),
      rigid(CA_POS[1]!, rot120, [10, -5, 3]),
      [100, 100, 100], // the inserted CYS, far off
      rigid(CA_POS[2]!, rot120, [10, -5, 3]),
      rigid(CA_POS[3]!, rot120, [10, -5, 3]),
      rigid(CA_POS[4]!, rot120, [10, -5, 3]),
    ];
    const t = setup([
      { name: 'tgt', pdb: caChain(SEQ, CA_POS) },
      { name: 'mob', pdb: caChain(mobSeq, mobPos) },
    ]);
    const res = t.call('align', ['mob', 'tgt']) as number[];
    expect(res[1]).toBe(5); // only the 5 matching residues paired
    close(res[0]!, 0, 1e-3);
  });

  it('super is an alias for align', () => {
    const t = setup([
      { name: 'tgt', pdb: caChain(SEQ, CA_POS) },
      { name: 'mob', pdb: caChain(SEQ, CA_POS.map((p) => rigid(p, rotZ90, [2, 2, 2]))) },
    ]);
    const res = t.call('super', ['mob', 'tgt']) as number[];
    close(res[0]!, 0, 1e-3);
    expect(res[1]).toBe(5);
  });
});

/* ------------------------------- intra_fit ------------------------------ */

describe('intra_fit (per-state superposition)', () => {
  it('fits each state onto the reference; ref state is -1, others ~ 0', () => {
    // Two models: model 2 is a rigid image of model 1. After intra_fit, state 2
    // must land on state 1 with rms ~ 0.
    const atoms: AtomSpec[] = TETRA.map((pos, i) => ({
      name: `C${i + 1}`,
      resn: 'UNK',
      chain: 'A',
      resi: i + 1,
      pos,
      elem: 'C',
    }));
    const frame1 = TETRA;
    const frame2 = TETRA.map((p) => rigid(p, rot120, [7, -2, 4]));
    const pdb = makeMultiModelPdb(atoms, [frame1, frame2]);
    const t = setup([{ name: 'm', pdb }]);
    expect(t.ex.molecule('m')!.nstate).toBe(2);

    const res = t.call('intra_fit', ['m', 1]) as number[];
    expect(res).toHaveLength(2);
    close(res[0]!, -1.0); // reference state marker
    close(res[1]!, 0, 1e-3); // state 2 fit onto state 1
    // State 2 coordinates now coincide with state 1.
    for (let i = 0; i < TETRA.length; i++) closeVec(t.coord('m', i, 2), TETRA[i]!);
  });
});

/* --------------------------------- stubs -------------------------------- */

describe('stubs', () => {
  it('rms returns the paired RMS like rms_cur', () => {
    const t = setup([
      { name: 'tgt', pdb: pointCloud(TETRA) },
      { name: 'mob', pdb: pointCloud(TETRA.map((p) => add(p, [1, 2, 2]))) },
    ]);
    close(t.call('rms', ['mob', 'tgt']) as number, 3.0, 1e-4);
  });

  it('get_raw_alignment returns an empty list', () => {
    const t = setup([{ name: 'tgt', pdb: pointCloud(TETRA) }]);
    expect(t.call('get_raw_alignment', ['aln'])).toEqual([]);
  });
});
