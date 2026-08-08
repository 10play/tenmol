import { describe, it, expect } from 'vitest';
import { Executive } from '../src/exec/executive';
import { parsePdb } from '../src/model/pdb';
import { registerAnalysis } from '../src/cmd/analysis';
import type { RegistrarCtx } from '../src/cmd/registrar';
import type { CommandHandler } from '../src/cmd/registrar';

/* ------------------------------------------------------------------------ */
/* Build ideal backbone geometry (NeRF placement) so phi/psi are exact.      */
/* ------------------------------------------------------------------------ */

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V, b: V): V => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V): V => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Place atom D given A,B,C, bond length l (C-D), bond angle theta (B-C-D),
 *  and dihedral chi (A-B-C-D). Self-Normalizing NeRF. */
function place(A: V, B: V, C: V, l: number, thetaDeg: number, chiDeg: number): V {
  const theta = (thetaDeg * Math.PI) / 180;
  // Negated so the placed atom's A-B-C-D dihedral equals `chiDeg` under the
  // `dihedral()` convention used by the engine (right-handed, matching PyMOL).
  const chi = (-chiDeg * Math.PI) / 180;
  const bc = norm(sub(C, B));
  const n = norm(cross(sub(B, A), bc));
  const m = cross(n, bc);
  const d2: V = [-l * Math.cos(theta), l * Math.sin(theta) * Math.cos(chi), l * Math.sin(theta) * Math.sin(chi)];
  return [
    C[0] + bc[0] * d2[0] + m[0] * d2[1] + n[0] * d2[2],
    C[1] + bc[1] * d2[0] + m[1] * d2[1] + n[1] * d2[2],
    C[2] + bc[2] * d2[0] + m[2] * d2[1] + n[2] * d2[2],
  ];
}

interface Atom {
  name: string;
  elem: string;
  resi: number;
  chain: string;
  pos: V;
}

/** Build an ideal backbone (N,CA,C,O per residue) for `nres` residues with a
 *  constant (phi, psi). Returns the atoms in load order. */
function buildChain(chain: string, nres: number, phi: number, psi: number, offset: V): Atom[] {
  // Seed the first three main-chain atoms (N0, CA0, C0) in a plane.
  const N0: V = [0, 0, 0];
  const CA0: V = [1.458, 0, 0];
  // C0: angle N-CA-C = 111 from the CA->N direction, in the xy-plane.
  const ang = (111 * Math.PI) / 180;
  const dir = 180 + 111; // degrees; CA->N points along 180.
  const C0: V = [
    CA0[0] + 1.525 * Math.cos((dir * Math.PI) / 180),
    CA0[1] + 1.525 * Math.sin((dir * Math.PI) / 180),
    0,
  ];
  void ang;

  const S: V[] = [N0, CA0, C0]; // main-chain sequence N,CA,C,N,CA,C,...
  for (let i = 1; i < nres; i++) {
    // N(i): dihedral psi(i-1); angle CA(i-1)-C(i-1)-N = 116; bond C-N = 1.329.
    const N = place(S[S.length - 3]!, S[S.length - 2]!, S[S.length - 1]!, 1.329, 116, psi);
    // CA(i): dihedral omega = 180; angle C(i-1)-N(i)-CA = 122; bond N-CA = 1.458.
    const CA = place(S[S.length - 2]!, S[S.length - 1]!, N, 1.458, 122, 180);
    // C(i): dihedral phi(i); angle N(i)-CA(i)-C = 111; bond CA-C = 1.525.
    const C = place(S[S.length - 1]!, N, CA, 1.525, 111, phi);
    S.push(N, CA, C);
  }

  const atoms: Atom[] = [];
  for (let i = 0; i < nres; i++) {
    const N = S[i * 3]!;
    const CA = S[i * 3 + 1]!;
    const C = S[i * 3 + 2]!;
    // O off the carbonyl C: bond 1.231, angle CA-C-O = 120.5, dihedral N-CA-C-O = psi+180.
    const O = place(N, CA, C, 1.231, 120.5, psi + 180);
    const add = (name: string, elem: string, p: V): void =>
      atoms.push({ name, elem, resi: i + 1, chain, pos: [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]] });
    add('N', 'N', N);
    add('CA', 'C', CA);
    add('C', 'C', C);
    add('O', 'O', O);
  }
  return atoms;
}

function toPdb(atoms: Atom[]): string {
  const lines: string[] = [];
  atoms.forEach((a, k) => {
    const s = ' '.repeat(80).split('');
    const put = (start: number, str: string): void => {
      for (let i = 0; i < str.length; i++) s[start - 1 + i] = str[i]!;
    };
    put(1, 'ATOM  ');
    put(7, String(k + 1).padStart(5));
    put(13, (' ' + a.name).padEnd(4)); // cols 13-16
    put(18, 'ALA'.padStart(3));
    put(22, a.chain);
    put(23, String(a.resi).padStart(4));
    put(31, a.pos[0].toFixed(3).padStart(8));
    put(39, a.pos[1].toFixed(3).padStart(8));
    put(47, a.pos[2].toFixed(3).padStart(8));
    put(77, a.elem.padStart(2));
    lines.push(s.join(''));
  });
  lines.push('END');
  return lines.join('\n');
}

// Chain A: 8-residue right-handed alpha helix (phi -57, psi -47).
// Chain B: 6-residue beta strand (phi -120, psi 130), offset far away.
const HELIX = buildChain('A', 8, -57, -47, [0, 0, 0]);
const STRAND = buildChain('B', 6, -120, 130, [60, 0, 0]);
const PDB = toPdb([...HELIX, ...STRAND]);

/* ------------------------------------------------------------------------ */
/* Test harness — isolated Executive + analysis registrar only.              */
/* ------------------------------------------------------------------------ */

function setup(pdb = PDB): {
  ex: Executive;
  call: (name: string, args: unknown[], kwargs?: Record<string, unknown>) => unknown;
  ssCount: (code: string) => number;
} {
  const ex = new Executive();
  ex.addMolecule(parsePdb(pdb, 'm'));
  const handlers = new Map<string, CommandHandler>();
  const ctx: RegistrarCtx = {
    command: (n, f) => void handlers.set(n, f),
    executive: ex,
    publish() {},
    emitView() {},
    str: (v, d = '') => (v == null ? d : String(v)),
  };
  registerAnalysis(ctx);
  const call = (name: string, args: unknown[], kwargs: Record<string, unknown> = {}): unknown => {
    const h = handlers.get(name);
    if (!h) throw new Error(`no handler ${name}`);
    return h(args, kwargs);
  };
  // Local `ss` counter (selector.ts has no `ss` selector; we must not edit it).
  const ssCount = (code: string): number =>
    ex.atomsMatching('all').filter((ua) => ua.atom.ss === code).length;
  return { ex, call, ssCount };
}

/* ------------------------------------------------------------------------ */

describe('analysis subsystem', () => {
  it('dss detects a helix and a strand', () => {
    const { call, ssCount, ex } = setup();
    // Before dss, nothing is assigned.
    expect(ssCount('H')).toBe(0);
    expect(ssCount('S')).toBe(0);

    call('dss', ['all', 0]);

    const helixAtoms = ssCount('H');
    const strandAtoms = ssCount('S');
    expect(helixAtoms).toBeGreaterThan(0);
    expect(strandAtoms).toBeGreaterThan(0);

    // Helix H atoms belong to chain A; strand S atoms to chain B.
    for (const ua of ex.atomsMatching('all')) {
      if (ua.atom.ss === 'H') expect(ua.atom.chain).toBe('A');
      if (ua.atom.ss === 'S') expect(ua.atom.chain).toBe('B');
    }
    // A whole residue is labelled together: all 4 atoms of a helical residue.
    const helixResis = new Set(
      ex.atomsMatching('all').filter((u) => u.atom.ss === 'H').map((u) => u.atom.resi),
    );
    expect(helixAtoms).toBe(helixResis.size * 4);
  });

  it('get_chains returns sorted distinct chains', () => {
    const { call } = setup();
    expect(call('get_chains', ['all'])).toEqual(['A', 'B']);
    expect(call('get_chains', ['chain B'])).toEqual(['B']);
  });

  it('count_states returns the max state count', () => {
    const { call } = setup();
    expect(call('count_states', ['all'])).toBe(1);
  });

  it('identify returns atom ids, and (obj,id) pairs in mode 1', () => {
    const { call, ex } = setup();
    const nAtoms = ex.atomsMatching('all').length;
    const ids = call('identify', ['all', 0]) as number[];
    expect(ids.length).toBe(nAtoms);
    // ids are the 1-based atom ids in load order.
    expect(ids[0]).toBe(1);
    expect(ids[ids.length - 1]).toBe(nAtoms);

    const pairs = call('identify', ['chain B and name CA', 1]) as Array<[string, number]>;
    expect(pairs.length).toBe(6); // 6 strand residues, one CA each
    for (const p of pairs) expect(p[0]).toBe('m');
  });

  it('alter writes back a numeric field to every matched atom', () => {
    const { call, ex } = setup();
    const n = call('alter', ['all', 'b=42']);
    expect(n).toBe(ex.atomsMatching('all').length);
    for (const ua of ex.atomsMatching('all')) expect(ua.atom.b).toBe(42);
  });

  it('alter writes back a string field (ss)', () => {
    const { call, ex } = setup();
    call('alter', ['chain A', "ss='H'"]);
    const aAtoms = ex.atomsMatching('all').filter((u) => u.atom.chain === 'A');
    expect(aAtoms.every((u) => u.atom.ss === 'H')).toBe(true);
    // Chain B untouched.
    expect(ex.atomsMatching('all').filter((u) => u.atom.chain === 'B').every((u) => u.atom.ss === '')).toBe(true);
  });

  it('alter can compute from existing fields', () => {
    const { call, ex } = setup();
    call('alter', ['name CA', 'b=resv*10']);
    const cas = ex.atomsMatching('all').filter((u) => u.atom.name === 'CA' && u.atom.chain === 'A');
    // resv 1..8 -> b 10..80
    expect(cas.map((u) => u.atom.b).sort((x, y) => x - y)).toEqual([10, 20, 30, 40, 50, 60, 70, 80]);
  });

  it('iterate collects values into the stored namespace without mutating atoms', () => {
    const { call, ex } = setup();
    const stored = { names: [] as string[], total: 0 };
    const n = call('iterate', ['name CA', 'stored.names.push(resn); stored.total += 1'], { space: { stored } });
    expect(n).toBe(14); // 8 helix + 6 strand CA atoms
    expect(stored.total).toBe(14);
    expect(stored.names.every((r) => r === 'ALA')).toBe(true);
    // iterate is read-only: b unchanged.
    expect(ex.atomsMatching('all').every((u) => u.atom.b === 0)).toBe(true);
  });

  it('iterate_state exposes per-atom coordinates', () => {
    const { call } = setup();
    const stored = { xs: [] as number[] };
    call('iterate_state', [1, 'chain B and name CA', 'stored.xs.push(x)'], { space: { stored } });
    expect(stored.xs.length).toBe(6);
    // Strand chain was offset by +60 in x, so every CA x is well beyond 50.
    expect(stored.xs.every((x) => x > 50)).toBe(true);
  });
});
