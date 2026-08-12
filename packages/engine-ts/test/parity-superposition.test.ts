/**
 * RED parity tests for structural superposition verbs — super / cealign /
 * usalign / pair_fit / alignto / extra_fit / fit / rms / rms_cur / intra_rms.
 *
 * Every expected value is derived from the vendored real-PyMOL ground truth:
 *   - packages/engine/modules/pymol/fitting.py  (the verb wrappers + return shapes)
 *   - packages/engine/testing/tests/api/test_fitting.py  (the golden assertions
 *     for usalign: keys tm_score_target/tm_score_mobile/RMSD/alignment_length/
 *     seq_identity, self-alignment tm≈1.0 & RMSD≈0).
 *
 * Current TS port (packages/engine-ts/src/cmd/align.ts + cmd/extras.ts):
 *   - `super` is a bare alias for the Cα *sequence* aligner (LCS on resn), NOT
 *     a structure-based superposition (align.ts:470).
 *   - `cealign`, `usalign` are documented no-ops returning `{}` (extras.ts:575).
 *   - `pair_fit` is a no-op returning `0`, moves nothing (extras.ts:584).
 *   - `alignto`, `extra_fit` are no-ops returning `[]`, move nothing (extras.ts:572).
 *   - `fit`/`rms`/`rms_cur` pair atoms by *selection order* (positional zip in
 *     gatherPairs, align.ts) instead of by atom identity as real PyMOL does
 *     (matchmaker=0 → match on segi,chain,resn,resi,name,alt).
 *   - `intra_rms` is unsuperposed (extras.ts:422 comment) while real PyMOL fits
 *     each state before computing the RMS (fitting.py intra_rms → intrafit mode 1).
 *
 * Each test therefore FAILS today and pins the real-PyMOL parity target.
 */
import { describe, it, expect } from 'vitest';
import { LocalBackend } from '@tenmol/engine-ts';
import { makePdb, type FixtureAtom } from './fixture';

/* ----------------------------- rigid transforms -------------------------- */

type Vec3 = [number, number, number];

/** A proper rotation (orthonormal, det = +1): axis-cycling with sign flips. */
const R: readonly number[] = [0, -1, 0, 0, 0, -1, 1, 0, 0];
const T1: Vec3 = [10, 5, -3];
const T2: Vec3 = [-8, 12, 4];

/** Apply p → R·p + t. */
function rigid(a: FixtureAtom, t: Vec3): FixtureAtom {
  const x = (R[0] as number) * a.x + (R[1] as number) * a.y + (R[2] as number) * a.z + t[0];
  const y = (R[3] as number) * a.x + (R[4] as number) * a.y + (R[5] as number) * a.z + t[1];
  const z = (R[6] as number) * a.x + (R[7] as number) * a.y + (R[8] as number) * a.z + t[2];
  return { ...a, x, y, z };
}

/* ----------------------------- test structures --------------------------- */

/**
 * A deterministic α-helix-like backbone: `n` residues, each with N, CA, C, O at
 * non-degenerate 3D positions (well-conditioned for a unique rigid fit, and
 * long enough — 16 residues → 16 Cα — to satisfy cealign's 2*window guide-atom
 * minimum with the default window of 8).
 */
function helixChain(n: number, resns: readonly string[]): FixtureAtom[] {
  const atoms: FixtureAtom[] = [];
  let serial = 1;
  for (let i = 0; i < n; i++) {
    const ang = (i * 100 * Math.PI) / 180;
    const cx = 5 * Math.cos(ang);
    const cy = 5 * Math.sin(ang);
    const cz = i * 1.5;
    const resn = resns[i % resns.length] as string;
    const put = (name: string, dx: number, dy: number, dz: number, elem: string): void => {
      atoms.push({ serial: serial++, name, resn, chain: 'A', resi: i + 1, x: cx + dx, y: cy + dy, z: cz + dz, elem });
    };
    put('N', -1.2, 0.1, -0.3, 'N');
    put('CA', 0, 0, 0, 'C');
    put('C', 1.1, 0.4, 0.2, 'C');
    put('O', 1.3, 1.5, 0.5, 'O');
  }
  return atoms;
}

const PROT = ['ALA', 'GLY', 'SER', 'VAL', 'LEU', 'THR'] as const;
/** A residue set DISJOINT from PROT — same fold, zero sequence identity. */
const ALT = ['PHE', 'TRP', 'TYR', 'HIS', 'LYS', 'ARG'] as const;

/** Wrap several coordinate sets of one atom table as MODEL/ENDMDL states. */
function multiModel(states: FixtureAtom[][]): string {
  const body = states
    .map((atoms, i) => `MODEL     ${i + 1}\n` + makePdb(atoms).replace(/\nEND\s*$/, '') + '\nENDMDL')
    .join('\n');
  return body + '\nEND\n';
}

/* -------------------------------- harness -------------------------------- */

async function boot(): Promise<LocalBackend> {
  const b = new LocalBackend();
  await b.connect();
  return b;
}

interface ModelAtom {
  name: string;
  resi: string;
  chain: string;
  coord: [number, number, number];
}

/** Read a selection's coordinates back keyed by chain/resi/name (order-free). */
async function coordMap(b: LocalBackend, sel: string): Promise<Map<string, Vec3>> {
  const model = (await b.call('get_model', [sel])) as { atom: ModelAtom[] };
  const out = new Map<string, Vec3>();
  for (const a of model.atom) out.set(`${a.chain}/${a.resi}/${a.name}`, a.coord as Vec3);
  return out;
}

/** The worst per-atom displacement between two coordinate maps (Å). */
function maxDisplacement(a: Map<string, Vec3>, b: Map<string, Vec3>): number {
  let worst = 0;
  for (const [k, p] of a) {
    const q = b.get(k);
    if (!q) return Infinity;
    worst = Math.max(worst, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
  }
  return worst;
}

/* ================================ TESTS ================================== */

describe('parity: structural superposition', () => {
  it('super: structure-based superposition ignores sequence identity (RMSD≈0, all Cα paired)', async () => {
    // PyMOL ref: fitting.py `super` — "performs a residue-based pairwise
    // alignment followed by a structural superposition". Unlike `align` it does
    // NOT require sequence similarity; two objects with the same fold but ZERO
    // shared residue names still pair fully and superpose to RMSD 0.
    const b = await boot();
    // targ and mob share the SAME fold but have DISJOINT residue names (PROT vs
    // ALT): zero sequence identity, so the sequence aligner (the current alias)
    // finds no Cα pairs, while a real structural `super` still pairs all six.
    await b.call('read_pdbstr', [makePdb(helixChain(6, PROT)), 'targ']);
    await b.call('read_pdbstr', [makePdb(helixChain(6, ALT).map((a) => rigid(a, T1))), 'mob']);

    const r = (await b.call('super', ['mob', 'targ'])) as number[];
    // Real return: [rmsd, n_atoms, n_cycles, rmsd_pre, n_pre, raw_score, n_res].
    expect(r[0]).toBeCloseTo(0, 2); // RMSD ≈ 0 for an identical fold
    expect(r[1]).toBe(6); // all six Cα paired by structure (0 today: LCS finds none)
    // …and the mobile object physically lands on the target (structure-paired
    // by residue position, compared name-for-name at matching residue indices).
    const tgt = await coordMap(b, 'targ');
    const mov = await coordMap(b, 'mob');
    // ALT vs PROT differ only by resn; positions are keyed by chain/resi/name.
    expect(maxDisplacement(tgt, mov)).toBeLessThan(0.01);
  });

  it('cealign: returns {alignment_length, RMSD} and transforms the mobile onto the target', async () => {
    // PyMOL ref: fitting.py `cealign(target, mobile, ...)` — the CE algorithm.
    // TARGET is the first argument; the MOBILE (2nd) is transformed (transform=1
    // default). Returns {"alignment_length": aliLen, "RMSD": RMSD,
    // "rotation_matrix": rotMat}. For a structure aligned to its own rigid copy
    // every residue aligns → aliLen == n, RMSD ≈ 0. (fitting.py:135)
    const b = await boot();
    const base = helixChain(16, PROT); // ≥ 2*window(8) Cα
    await b.call('read_pdbstr', [makePdb(base), 'targ']);
    await b.call('read_pdbstr', [makePdb(base.map((a) => rigid(a, T1))), 'mob']);

    const r = (await b.call('cealign', ['targ', 'mob'])) as { RMSD: number; alignment_length: number };
    expect(r.RMSD).toBeCloseTo(0, 2); // undefined today ({} no-op)
    expect(r.alignment_length).toBe(16);
    // transform=1 default → mob lands on targ.
    expect(maxDisplacement(await coordMap(b, 'targ'), await coordMap(b, 'mob'))).toBeLessThan(0.01);
  });

  it('usalign: TM-align self-superposition gives tm_score≈1.0, RMSD≈0 and the documented dict keys', async () => {
    // PyMOL ref: golden test_fitting.py::test_self_alignment / test_return_dict —
    // cmd.usalign(m2, m1, transform=0) on an identical copy returns a dict with
    // r["tm_score_target"]≈1.0, r["tm_score_mobile"]≈1.0, r["RMSD"]≈0.0 and the
    // keys tm_score_target, tm_score_mobile, RMSD, alignment_length, seq_identity.
    const b = await boot();
    const base = helixChain(16, PROT);
    await b.call('read_pdbstr', [makePdb(base), 'targ']);
    await b.call('read_pdbstr', [makePdb(base), 'mob']); // identical copy

    const r = (await b.call('usalign', ['mob', 'targ', 1, 1, 1, 0])) as Record<string, number>;
    expect(r.tm_score_target).toBeCloseTo(1.0, 2); // undefined today ({} no-op)
    expect(r.tm_score_mobile).toBeCloseTo(1.0, 2);
    expect(r.RMSD).toBeCloseTo(0, 2);
    for (const key of ['tm_score_target', 'tm_score_mobile', 'RMSD', 'alignment_length', 'seq_identity']) {
      expect(Object.prototype.hasOwnProperty.call(r, key), `usalign result must contain ${key}`).toBe(true);
    }
  });

  it('pair_fit: fits the named atom pairs and transforms the mobile object onto the target', async () => {
    // PyMOL ref: fitting.py `pair_fit(*arg)` → _cmd.fit_pairs — superimposes
    // matched atom pairs and MOVES the first (mobile) object. Identical pairs
    // (mobile is a rigid copy) → RMSD 0 and the mobile lands exactly on target.
    const b = await boot();
    const base = helixChain(6, PROT);
    await b.call('read_pdbstr', [makePdb(base), 'targ']);
    await b.call('read_pdbstr', [makePdb(base.map((a) => rigid(a, T1))), 'mob']);

    await b.call('pair_fit', ['mob and name CA', 'targ and name CA']);
    // The whole mobile object is carried by the fit; every atom lands on target.
    expect(maxDisplacement(await coordMap(b, 'targ'), await coordMap(b, 'mob'))).toBeLessThan(0.01); // no-op moves nothing today
  });

  it('alignto: superposes every other object onto the target object', async () => {
    // PyMOL ref: fitting.py `alignto(target, method, ...)` — a wrapper over
    // extra_fit that aligns ALL other loaded objects onto `target`. Each mobile
    // (a distinct rigid copy of the same fold) is carried onto the target.
    const b = await boot();
    const base = helixChain(6, PROT);
    await b.call('read_pdbstr', [makePdb(base), 'targ']);
    await b.call('read_pdbstr', [makePdb(base.map((a) => rigid(a, T1))), 'mob1']);
    await b.call('read_pdbstr', [makePdb(base.map((a) => rigid(a, T2))), 'mob2']);

    await b.call('alignto', ['targ', 'super']);
    const tgt = await coordMap(b, 'targ');
    expect(maxDisplacement(tgt, await coordMap(b, 'mob1'))).toBeLessThan(0.01); // [] no-op today
    expect(maxDisplacement(tgt, await coordMap(b, 'mob2'))).toBeLessThan(0.01);
  });

  it('extra_fit: superposes the listed objects onto the reference', async () => {
    // PyMOL ref: fitting.py `extra_fit(selection, reference, method, ...)` —
    // "Like intra_fit, but for multiple objects". Every non-reference object in
    // the selection is superposed onto `reference` via the given method.
    const b = await boot();
    const base = helixChain(6, PROT);
    await b.call('read_pdbstr', [makePdb(base), 'ref']);
    await b.call('read_pdbstr', [makePdb(base.map((a) => rigid(a, T1))), 'obj1']);
    await b.call('read_pdbstr', [makePdb(base.map((a) => rigid(a, T2))), 'obj2']);

    await b.call('extra_fit', ['all', 'ref', 'super']);
    const ref = await coordMap(b, 'ref');
    expect(maxDisplacement(ref, await coordMap(b, 'obj1'))).toBeLessThan(0.01); // [] no-op today
    expect(maxDisplacement(ref, await coordMap(b, 'obj2'))).toBeLessThan(0.01);
  });

  it('fit: matches atoms by identity (order-independent) then superposes to RMSD≈0', async () => {
    // PyMOL ref: fitting.py `fit(mobile, target, matchmaker=0)` — atoms are
    // paired by ALL identifiers (segi,chain,resn,resi,name,alt), NOT by storage
    // order (`_cmd.fit(...,2,...)`, mode 2 = fit+transform). The mobile here is a
    // rigid copy whose atom records are written in REVERSED order; identity
    // matching still yields RMSD 0 and lands the mobile on the target. The port
    // zips by selection order → a wrong correspondence → large RMSD.
    const b = await boot();
    const base = helixChain(6, PROT);
    await b.call('read_pdbstr', [makePdb(base), 'targ']);
    const movedReversed = base.map((a) => rigid(a, T1)).reverse();
    await b.call('read_pdbstr', [makePdb(movedReversed), 'mob']);

    const rms = (await b.call('fit', ['mob', 'targ'])) as number;
    expect(rms).toBeCloseTo(0, 2); // ≫0 today (zips reversed vs forward atoms)
    expect(maxDisplacement(await coordMap(b, 'targ'), await coordMap(b, 'mob'))).toBeLessThan(0.01);
  });

  it('rms: identity-matched RMS fit (no transform) is ≈0 for a rigid copy in any atom order', async () => {
    // PyMOL ref: fitting.py `rms(mobile, target, matchmaker=0)` — computes the
    // best-fit RMS by identifier matching but does NOT move the object
    // (`_cmd.fit(...,1,...)`, mode 1). Reversed-order rigid copy → RMS 0.
    const b = await boot();
    const base = helixChain(6, PROT);
    await b.call('read_pdbstr', [makePdb(base), 'targ']);
    await b.call('read_pdbstr', [makePdb(base.map((a) => rigid(a, T1)).reverse()), 'mob']);

    const rms = (await b.call('rms', ['mob', 'targ'])) as number;
    expect(rms).toBeCloseTo(0, 2); // ≫0 today (positional zip on reversed atoms)
  });

  it('rms_cur: identity-matched RMS without fitting is ≈0 for identical coords in any atom order', async () => {
    // PyMOL ref: fitting.py `rms_cur(mobile, target, matchmaker=0)` — RMS with no
    // fitting (`_cmd.fit(...,0,...)`). Atoms are matched by identifier, so a copy
    // with IDENTICAL coordinates but reversed storage order still gives RMS 0.
    const b = await boot();
    const base = helixChain(6, PROT);
    await b.call('read_pdbstr', [makePdb(base), 'targ']);
    await b.call('read_pdbstr', [makePdb([...base].reverse()), 'mob']); // same coords, reversed order

    const rms = (await b.call('rms_cur', ['mob', 'targ'])) as number;
    expect(rms).toBeCloseTo(0, 2); // ≫0 today (zips atom i of mob with a different atom of targ)
  });

  it('intra_rms: fits each state before measuring, so a rigid-body state gives ≈0', async () => {
    // PyMOL ref: fitting.py `intra_rms` → _cmd.intrafit(..., mode 1) — mode 1
    // FITS every state onto the reference state before computing the RMS
    // (coordinates left unchanged). A second state that is a rigid-body move of
    // state 1 therefore reports RMS ≈ 0. The port's intra_rms is unsuperposed
    // (extras.ts) so it reports the raw ~13 Å displacement instead. The
    // reference state entry is -1.0 in both.
    const b = await boot();
    const base = helixChain(6, PROT);
    await b.call('read_pdbstr', [multiModel([base, base.map((a) => rigid(a, T1))]), 'm']);

    const r = (await b.call('intra_rms', ['m'])) as number[];
    expect(r[0]).toBe(-1.0); // reference state sentinel
    expect(r[1]).toBeCloseTo(0, 2); // ≈0 after fitting; ≫0 today (unsuperposed)
  });
});
