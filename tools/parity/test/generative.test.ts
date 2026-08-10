import { describe, expect, it } from 'vitest';
import { createLocalBackend } from '@tenmol/engine-ts';
import type { Backend } from '@tenmol/backend';
import { SMALL_PDB } from '../src/index';

/**
 * Property-based sequences: a seeded generator emits random-but-valid command
 * sequences and asserts (a) the engine is DETERMINISTIC — the same seed yields
 * byte-identical observables, which is what makes a golden-fixture gate sound —
 * and (b) a set of invariants holds along the whole sequence. The exact numeric
 * agreement with real PyMOL over these same random sequences is asserted by the
 * live differential job (`scripts/parity-engine.mjs --remote`), where PyMOL
 * exists; here we lock down the properties that job depends on.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLORS = ['red', 'green', 'blue', 'cyan', 'yellow', 'orange', 'magenta'];
const REPS = ['lines', 'spheres', 'nonbonded'];
const SELECTORS = ['all', 'chain A', 'chain B', 'name CA', 'elem C', 'elem O', 'resi 1'];
const PROBES = [
  'all',
  'rep lines',
  'rep spheres',
  'color red',
  'color cyan',
  'color yellow',
  'chain A',
];

interface Cmd {
  call: [string, ...string[]];
}

function generate(seed: number, length: number): Cmd[] {
  const rnd = mulberry32(seed);
  const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)]!;
  const ops: Cmd[] = [];
  for (let i = 0; i < length; i++) {
    const kind = Math.floor(rnd() * 4);
    if (kind === 0) ops.push({ call: ['color', pick(COLORS), pick(SELECTORS)] });
    else if (kind === 1) ops.push({ call: ['show_as', pick(REPS), pick(SELECTORS)] });
    else if (kind === 2) ops.push({ call: ['show', pick(REPS), pick(SELECTORS)] });
    else ops.push({ call: ['hide', pick(REPS), pick(SELECTORS)] });
  }
  return ops;
}

async function run(ops: Cmd[]): Promise<Record<string, number>> {
  const backend: Backend = createLocalBackend();
  await backend.connect();
  await backend.call('read_pdbstr', [SMALL_PDB, 'm']);
  for (const op of ops) await backend.call(op.call[0], op.call.slice(1));
  const out: Record<string, number> = {};
  for (const sel of PROBES) out[sel] = Number(await backend.call('count_atoms', [sel]));
  return out;
}

describe('generative equivalence properties', () => {
  it('is deterministic: same seed -> identical observables', async () => {
    for (const seed of [1, 7, 42, 1234, 99999]) {
      const ops = generate(seed, 30);
      const a = await run(ops);
      const b = await run(ops);
      expect(a).toEqual(b);
    }
  });

  it('holds invariants along every sequence', async () => {
    for (const seed of [2, 13, 555, 88888]) {
      const snap = await run(generate(seed, 40));
      // The object never gains or loses atoms.
      expect(snap.all).toBe(9);
      // Every count is a subset of the whole.
      for (const [sel, n] of Object.entries(snap)) {
        expect(n, sel).toBeGreaterThanOrEqual(0);
        expect(n, sel).toBeLessThanOrEqual(9);
      }
    }
  });
});
