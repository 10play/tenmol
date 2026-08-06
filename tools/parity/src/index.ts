/**
 * @tenmol/parity — the differential equivalence harness.
 *
 * Two engines, one corpus, every observable compared:
 *
 *   * `runCorpus(backend)`   — run every script's ops and collect its snapshot.
 *   * `diffSnapshots(...)`   — minimal field-level diff of two snapshots.
 *
 * The vitest suite (`test/`) uses these against `@tenmol/engine-ts`'s
 * `LocalBackend` and the committed golden fixtures; `scripts/parity-engine.mjs`
 * uses them for the LIVE diff against real PyMOL over `@tenmol/client`.
 */

import { createLocalBackend } from '@tenmol/engine-ts';
import type { Backend } from '@tenmol/backend';
import { CORPUS, type Script } from './corpus';
import { probeSnapshot, diffSnapshots, type Snapshot } from './probe';

export { CORPUS, SMALL_PDB, FIXTURE_ATOMS, KNOWN_VIEW, GATED_VIEW_INDICES } from './corpus';
export type { Script, Op } from './corpus';
export { probeSnapshot, diffSnapshots } from './probe';
export type { Snapshot } from './probe';

/** Run the whole corpus against a backend; keyed by script name. */
export async function runCorpus(backend: Backend): Promise<Record<string, Snapshot>> {
  const out: Record<string, Snapshot> = {};
  for (const script of CORPUS) {
    // Each script starts from a clean slate; the engine keeps no cross-script
    // state because we rebuild it per script.
    await backend.call('delete', ['all']).catch(() => undefined);
    out[script.name] = await probeSnapshot(backend, script);
  }
  return out;
}

/** Run the corpus against a fresh LocalBackend (the TypeScript engine). */
export async function runLocalCorpus(): Promise<Record<string, Snapshot>> {
  const backend = createLocalBackend();
  await backend.connect();
  return runCorpus(backend);
}

/**
 * Diff a full corpus run against golden snapshots. Returns a flat list of
 * `"<script>: <field diff>"` strings; empty means the engines are identical
 * over the corpus.
 */
export function diffCorpus(
  golden: Record<string, Snapshot>,
  actual: Record<string, Snapshot>,
  corpus: readonly Script[] = CORPUS,
): string[] {
  const out: string[] = [];
  for (const script of corpus) {
    const g = golden[script.name];
    const a = actual[script.name];
    if (!g) {
      out.push(`${script.name}: no golden snapshot`);
      continue;
    }
    if (!a) {
      out.push(`${script.name}: no actual snapshot`);
      continue;
    }
    for (const d of diffSnapshots(script, g, a)) out.push(`${script.name}: ${d}`);
  }
  return out;
}
