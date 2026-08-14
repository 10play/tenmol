import { describe, it } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { createLocalBackend } from '@tenmol/engine-ts';
import { createRemoteBackend, type WebSocketCtor } from '@tenmol/client';
import type { Backend } from '@tenmol/backend';

/**
 * The node-level DIFFERENTIAL that drives the per-feature fix loop.
 *
 * Reads a probe from `TENMOL_PROBE_FILE` (a JSON `{ ops, checks }`), runs it
 * through BOTH real PyMOL (the oracle, over the bridge) and the TypeScript engine
 * (engine-ts), and writes `{ expected, actual, diffs, ok }` to `TENMOL_DIFF_OUT`.
 *
 * This is the ground-truth engine of the graph: `expected` comes from real PyMOL,
 * `actual` from engine-ts. A worker fixes engine-ts until `diffs` is empty.
 *
 * Self-skips unless `TENMOL_PROBE_FILE` is set, so it never runs in `pnpm test`.
 */
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
}
interface Probe {
  id?: string;
  feature?: string;
  ops: Op[];
  checks: Check[];
  tol?: number;
}

const PROBE_FILE = process.env['TENMOL_PROBE_FILE'];
const DIFF_OUT = process.env['TENMOL_DIFF_OUT'];
const ORACLE_WS = process.env['TENMOL_ORACLE_WS'] || 'ws://100.71.244.15:8002/ws';
const ORACLE_ORIGIN = process.env['TENMOL_ORACLE_ORIGIN'] || 'http://100.71.244.15:3002';

const suite = PROBE_FILE ? describe : describe.skip;

function approx(a: unknown, b: unknown, tol: number): boolean {
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

// The oracle is ONE shared PyMOL singleton, so its reinitialize+ops+reads must be
// serialized across concurrently-running differential processes. A crude, stale-safe
// directory lock does it without a dependency.
const ORACLE_LOCK = process.env['TENMOL_ORACLE_LOCK'] || '/tmp/tenmol-oracle.lock';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function withOracleLock<T>(fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      mkdirSync(ORACLE_LOCK);
      break;
    } catch {
      try {
        // Steal an abandoned lock (holder crashed) after 100s.
        if (Date.now() - statSync(ORACLE_LOCK).mtimeMs > 100_000) rmSync(ORACLE_LOCK, { recursive: true, force: true });
      } catch {
        /* race on the steal is fine */
      }
      if (Date.now() > deadline) throw new Error('oracle lock timeout');
      await sleep(100 + Math.random() * 250);
    }
  }
  try {
    return await fn();
  } finally {
    try {
      rmSync(ORACLE_LOCK, { recursive: true, force: true });
    } catch {
      /* already gone */
    }
  }
}

async function runOn(backend: Backend, probe: Probe): Promise<unknown[]> {
  await backend.call('reinitialize', []).catch(() => undefined);
  for (const op of probe.ops) {
    if (typeof op.do === 'string') await backend.do(op.do);
    else if (op.call) await backend.call(op.call[0], op.call.slice(1), op.kwargs ?? {});
  }
  const out: unknown[] = [];
  for (const c of probe.checks) {
    try {
      out.push(await backend.call(c.call[0], c.call.slice(1), c.kwargs ?? {}));
    } catch (e) {
      out.push({ __error: String((e as Error)?.message ?? e) });
    }
  }
  return out;
}

suite('feature differential (oracle vs engine-ts)', () => {
  it('runs the probe on both engines and records the diff', async () => {
    const probe: Probe = JSON.parse(readFileSync(PROBE_FILE!, 'utf8'));
    const tol = probe.tol ?? 1e-3;

    // Oracle: real PyMOL over the bridge (Node ws needs the allowed Origin header).
    const WS = (await import('ws')).default;
    const WsCtor = class extends WS {
      constructor(url: string) {
        super(url, { origin: ORACLE_ORIGIN });
      }
    } as unknown as WebSocketCtor;
    const remote = createRemoteBackend({ url: ORACLE_WS, autoReconnect: false, WebSocketImpl: WsCtor });

    let expected: unknown[] = [];
    let oracleError: string | null = null;
    try {
      await withOracleLock(async () => {
        await remote.connect();
        expected = await runOn(remote, probe);
      });
    } catch (e) {
      oracleError = String((e as Error)?.message ?? e);
    } finally {
      remote.close();
    }

    // Actual: engine-ts in-process.
    const local = createLocalBackend();
    await local.connect();
    const actual = await runOn(local, probe);
    local.close();

    const diffs = probe.checks
      .map((c, i) => ({
        label: c.label || c.call.join(' '),
        expected: expected[i],
        actual: actual[i],
        ok: expected[i] !== undefined && approx(expected[i], actual[i], c.tol ?? tol),
      }))
      .filter((d) => !d.ok);

    const result = {
      feature: probe.feature ?? probe.id ?? 'unknown',
      oracleError,
      expected,
      actual,
      diffs,
      ok: oracleError === null && diffs.length === 0,
    };
    if (DIFF_OUT) writeFileSync(DIFF_OUT, JSON.stringify(result, null, 2) + '\n');
    // Never fail the vitest process on a diff — the worker reads DIFF_OUT and decides.
    // Only a thrown/infra error should surface as a test failure.
  }, 60_000);
});
