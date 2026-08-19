/**
 * Probe-replay regression harness (shared by the `probe-replay.<shard>.spec.ts` files).
 *
 * The 1,300+ probes under `verify/probes/*.json` were each validated against REAL
 * PyMOL: their baked `expected` is ground truth (see `oracle-diff.spec.ts`, which
 * produced them). That differential needs a live PyMOL bridge, so it self-skips in
 * `pnpm test` and the probes were durable documentation but NOT regression-executed.
 *
 * This harness closes that gap with NO oracle: it replays each probe through the
 * TypeScript engine (`@tenmol/engine-ts`) ONLY and asserts the engine's output still
 * deep-equals the committed `expected` (honouring each check's float `tol`). It is the
 * engine-side half of `oracle-diff.spec.ts` — same `runOn`, same `approx` — turned into
 * a standing gate that runs in the ordinary unit lane.
 *
 * Runtime: engine construction is ~0.3ms, but parsing the 5,684-atom `1tii.pdb` that
 * ~540 probes load costs ~0.8s each. The probes are therefore SHARDED across several
 * spec files so vitest's worker pool runs them in parallel. A handful of probes
 * (`too-slow`) run a full surface/map pipeline (5s–105s each) and are skipped here —
 * they stay covered by the oracle differential.
 *
 * The manifest (`probe-replay.manifest.json`) records, relative to CURRENT master:
 *   - `knownFailures`: probes whose engine output does NOT yet match real PyMOL (genuine
 *     engine gaps). Each is asserted to STILL diverge; if one starts matching, its test
 *     fails telling you to promote it out of the list — a forward ratchet, never a
 *     silent pass.
 *   - `tooSlow`: probes excluded for wall-clock (logged as skipped, not silently passed).
 * Probes with no usable `expected` are skipped with a logged reason.
 */
import { it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalBackend } from '@tenmol/engine-ts';
import type { Backend } from '@tenmol/backend';

type Call = [string, ...unknown[]];
interface Op {
  do?: string;
  call?: Call;
  kwargs?: Record<string, unknown>;
}
interface Check {
  call: Call;
  kwargs?: Record<string, unknown>;
  tol?: number;
  label?: string;
  /** A few probes carry `expected` per-check instead of at the top level. */
  expected?: unknown;
}
interface Probe {
  id?: string;
  feature?: string;
  ops: Op[];
  checks: Check[];
  tol?: number;
  expected?: unknown[];
}

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBES_DIR = join(HERE, '..', 'verify', 'probes');
const REPO_ROOT = join(HERE, '..', '..', '..');

interface Manifest {
  knownFailures: string[];
  tooSlow: string[];
}
const MANIFEST: Manifest = JSON.parse(
  readFileSync(join(HERE, 'probe-replay.manifest.json'), 'utf8'),
);

/**
 * The probes bake ABSOLUTE load paths from the worktree they were verified in
 * (`.../sessions/<name>/tenmol/packages/engine/test/dat/*`). Retarget any such path at
 * the local worktree so `load` finds the identical data file here. The `expected`
 * values are unaffected — it is the same bytes on disk.
 */
function localize(s: unknown): unknown {
  if (typeof s !== 'string') return s;
  return s.replace(/\/[^\s,"'()]*\/packages\/engine\//g, `${REPO_ROOT}/packages/engine/`);
}

/** Deep, tolerance-aware equality — identical to `oracle-diff.spec.ts`. */
export function approx(a: unknown, b: unknown, tol: number): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    return Math.abs(a - b) <= tol + 1e-9 * Math.max(Math.abs(a), Math.abs(b));
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => approx(x, b[i], tol));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    return ka.every((k) =>
      approx((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], tol),
    );
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Run the probe's ops then checks on `backend` — the engine-ts half of `oracle-diff`. */
async function runOn(backend: Backend, probe: Probe): Promise<unknown[]> {
  await backend.call('reinitialize', []).catch(() => undefined);
  for (const op of probe.ops) {
    if (typeof op.do === 'string') await backend.do(localize(op.do) as string);
    else if (op.call)
      await backend.call(op.call[0], op.call.slice(1).map(localize), op.kwargs ?? {});
  }
  const out: unknown[] = [];
  for (const c of probe.checks) {
    try {
      out.push(await backend.call(c.call[0], c.call.slice(1).map(localize), c.kwargs ?? {}));
    } catch (e) {
      out.push({ __error: String((e as Error)?.message ?? e) });
    }
  }
  return out;
}

/** The `expected` value for check `i`: top-level array first, else the check's own field. */
function expectedFor(probe: Probe, i: number): { has: boolean; value: unknown } {
  if (Array.isArray(probe.expected) && i < probe.expected.length) {
    return { has: true, value: probe.expected[i] };
  }
  const c = probe.checks[i];
  if (c && 'expected' in c) return { has: true, value: c.expected };
  return { has: false, value: undefined };
}

export interface Drift {
  index: number;
  label: string;
  expected: unknown;
  actual: unknown;
}

/**
 * Replay one probe through a fresh-state engine and return the checks that drifted from
 * `expected`. Returns `null` when the probe has no usable `expected` (caller skips it).
 */
export async function replayProbe(probe: Probe): Promise<Drift[] | null> {
  const anyExpected = probe.checks.some((_, i) => expectedFor(probe, i).has);
  if (!anyExpected) return null;
  const tol = probe.tol ?? 1e-3;
  const backend = createLocalBackend();
  let actual: unknown[];
  try {
    await backend.connect();
    actual = await runOn(backend, probe);
  } finally {
    backend.close();
  }
  const drift: Drift[] = [];
  probe.checks.forEach((c, i) => {
    const exp = expectedFor(probe, i);
    if (!exp.has) return; // a check with no expected can't drift
    if (!approx(exp.value, actual[i], c.tol ?? tol)) {
      drift.push({
        index: i,
        label: c.label || c.call.join(' '),
        expected: exp.value,
        actual: actual[i],
      });
    }
  });
  return drift;
}

const ALL_FILES = readdirSync(PROBES_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();

function loadProbe(file: string): Probe {
  return JSON.parse(readFileSync(join(PROBES_DIR, file), 'utf8'));
}

function driftSummary(drift: Drift[]): string {
  return drift
    .map(
      (d) =>
        `  check[${d.index}] "${d.label}": expected ${JSON.stringify(d.expected)} got ${JSON.stringify(d.actual)}`,
    )
    .join('\n');
}

/**
 * Register the vitest cases for shard `shard` of `shardCount`. Probes are assigned to
 * shards round-robin over the sorted file list so each shard mixes cheap and expensive
 * probes evenly.
 */
export function registerShard(shard: number, shardCount: number): void {
  const known = new Set(MANIFEST.knownFailures);
  const slow = new Set(MANIFEST.tooSlow);
  const files = ALL_FILES.filter((_, i) => i % shardCount === shard);

  for (const file of files) {
    const id = file.replace(/\.json$/, '');
    if (slow.has(id)) {
      it.skip(`${id} [skipped: too slow for the unit lane — covered by oracle-diff]`, () => {});
      continue;
    }
    if (known.has(id)) {
      // Forward ratchet: this probe is a KNOWN engine gap. Assert it still diverges;
      // when the engine is fixed, this fails and asks to promote it to a real assertion.
      it(`${id} [known engine gap — still diverges from real PyMOL]`, async () => {
        const drift = await replayProbe(loadProbe(file));
        if (drift === null)
          throw new Error(`${id}: listed in knownFailures but has no usable expected`);
        if (drift.length === 0) {
          throw new Error(
            `${id}: now MATCHES real PyMOL — remove it from probe-replay.manifest.json "knownFailures".`,
          );
        }
      });
      continue;
    }
    it(`${id}`, async () => {
      const drift = await replayProbe(loadProbe(file));
      if (drift === null) {
        // No usable expected: don't silently pass — surface a skip reason.
        console.warn(`probe-replay: SKIP ${id} — no usable "expected" to compare against`);
        return;
      }
      if (drift.length > 0) {
        throw new Error(
          `${id}: engine output drifted from committed expected:\n${driftSummary(drift)}`,
        );
      }
    });
  }
}

/**
 * Assert every manifest entry names a real probe, so a renamed or deleted probe can't
 * leave a stale exemption that silently downgrades coverage. Registered once (shard 0).
 */
export function registerManifestGuard(): void {
  it('manifest: every tooSlow/knownFailures id names a committed probe', () => {
    const present = new Set(ALL_FILES.map((f) => f.replace(/\.json$/, '')));
    const stale = [...MANIFEST.tooSlow, ...MANIFEST.knownFailures].filter((id) => !present.has(id));
    if (stale.length > 0) {
      throw new Error(
        `probe-replay.manifest.json references probes that no longer exist: ${stale.join(', ')}`,
      );
    }
  });
}

export { ALL_FILES, loadProbe, PROBES_DIR };
