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
  settings?: Record<string, number>;
  chains?: string[];
  /** Per-atom coordinates keyed by `chain/resi/name`, rounded to 3 dp. */
  coords?: Record<string, [number, number, number]>;
}

interface ModelAtom {
  name: string;
  resi: string;
  chain: string;
  coord: [number, number, number];
}
interface GetModel {
  atom: ModelAtom[];
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

  if (script.gateSettings) {
    const settings: Record<string, number> = {};
    for (const name of script.gateSettings) {
      settings[name] = round(Number(await backend.call('get_setting_float', [name])));
    }
    snap.settings = settings;
  }

  if (script.gateChains) {
    snap.chains = (await backend.call<string[]>('get_chains', ['all'])) ?? [];
  }

  if (script.gateModel !== undefined) {
    const model = await backend.call<GetModel>('get_model', [script.gateModel]);
    const coords: Record<string, [number, number, number]> = {};
    for (const a of model?.atom ?? []) {
      coords[`${a.chain}/${a.resi}/${a.name}`] = [
        round(a.coord[0], 3),
        round(a.coord[1], 3),
        round(a.coord[2], 3),
      ];
    }
    snap.coords = coords;
  }

  return snap;
}

function round(n: number, dp = 6): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

const VIEW_TOL = 1e-4;
const RGB_TOL = 1e-5;
const SETTING_TOL = 1e-5;
/** Coords are compared at 3-dp (float32 through two get_model encodings). */
const COORD_TOL = 1.5e-3;

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

  if (script.gateSettings) {
    for (const name of script.gateSettings) {
      const e = expected.settings?.[name] ?? NaN;
      const g = actual.settings?.[name] ?? NaN;
      if (Math.abs(e - g) > SETTING_TOL) {
        out.push(`get_setting_float('${name}'): expected ${e}, got ${g}`);
      }
    }
  }

  if (script.gateChains) {
    const a = JSON.stringify(expected.chains ?? []);
    const b = JSON.stringify(actual.chains ?? []);
    if (a !== b) out.push(`get_chains(): expected ${a}, got ${b}`);
  }

  if (script.gateModel !== undefined) {
    const e = expected.coords ?? {};
    const g = actual.coords ?? {};
    const keys = new Set([...Object.keys(e), ...Object.keys(g)]);
    for (const k of keys) {
      const ec = e[k];
      const gc = g[k];
      if (!ec || !gc || ec.some((v, i) => Math.abs(v - gc[i]!) > COORD_TOL)) {
        out.push(`get_model coord '${k}': expected ${JSON.stringify(ec)}, got ${JSON.stringify(gc)}`);
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
