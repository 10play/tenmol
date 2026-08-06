/**
 * The shared probe. Runs a {@link Script}'s ops against ANY {@link Backend},
 * then reads back a canonical observable snapshot using only the public PyMOL
 * API both engines implement. The SAME code runs against the TypeScript engine
 * and against real PyMOL — the snapshot shape is the parity contract.
 */

import type { Backend } from '@tenmol/backend';
import type { Script } from './corpus';
import { GATED_VIEW_INDICES } from './corpus';

export interface Snapshot {
  names?: string[];
  counts: Record<string, number>;
  view?: number[];
  colorTuples?: Record<string, [number, number, number] | null>;
}

/** Run the ops, then collect the observables the script gates. */
export async function probeSnapshot(backend: Backend, script: Script): Promise<Snapshot> {
  for (const op of script.ops) {
    if ('do' in op) await backend.do(op.do);
    else await backend.call(op.call[0], op.call.slice(1));
  }

  const counts: Record<string, number> = {};
  for (const sel of script.selectors) {
    counts[sel] = Number(await backend.call('count_atoms', [sel]));
  }

  const snap: Snapshot = { counts };

  if (script.gateNames) {
    snap.names = (await backend.call<string[]>('get_names', ['objects'])) ?? [];
  }

  if (script.gateView) {
    const view = (await backend.call<number[]>('get_view', [])) ?? [];
    snap.view = view.map((n) => Number(n));
  }

  if (script.gateColorTuples) {
    const tuples: Record<string, [number, number, number] | null> = {};
    for (const name of script.gateColorTuples) {
      const idx = Number(await backend.call('get_color_index', [name]));
      const t = await backend.call<number[] | null>('get_color_tuple', [idx]);
      tuples[name] = t ? [round(t[0]!), round(t[1]!), round(t[2]!)] : null;
    }
    snap.colorTuples = tuples;
  }

  return snap;
}

function round(n: number, dp = 6): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

const VIEW_TOL = 1e-4;
const RGB_TOL = 1e-5;

/**
 * Compare two snapshots for one script; returns a minimal, human-readable list
 * of the fields that diverged (empty when identical). This is what the gate
 * prints and what the vitest suite asserts is empty.
 */
export function diffSnapshots(
  script: Script,
  expected: Snapshot,
  actual: Snapshot,
): string[] {
  const out: string[] = [];

  if (script.gateNames) {
    const a = JSON.stringify(expected.names ?? []);
    const b = JSON.stringify(actual.names ?? []);
    if (a !== b) out.push(`names: expected ${a}, got ${b}`);
  }

  for (const sel of script.selectors) {
    const e = expected.counts[sel];
    const g = actual.counts[sel];
    if (e !== g) out.push(`count_atoms('${sel}'): expected ${e}, got ${g}`);
  }

  if (script.gateView) {
    const e = expected.view ?? [];
    const g = actual.view ?? [];
    for (const i of GATED_VIEW_INDICES) {
      if (Math.abs((e[i] ?? NaN) - (g[i] ?? NaN)) > VIEW_TOL) {
        out.push(`get_view()[${i}]: expected ${e[i]}, got ${g[i]}`);
      }
    }
  }

  if (script.gateColorTuples) {
    for (const name of script.gateColorTuples) {
      const e = expected.colorTuples?.[name] ?? null;
      const g = actual.colorTuples?.[name] ?? null;
      if (!rgbEqual(e, g)) {
        out.push(`get_color_tuple('${name}'): expected ${JSON.stringify(e)}, got ${JSON.stringify(g)}`);
      }
    }
  }

  return out;
}

function rgbEqual(
  a: [number, number, number] | null,
  b: [number, number, number] | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.every((v, i) => Math.abs(v - b[i]!) <= RGB_TOL);
}
