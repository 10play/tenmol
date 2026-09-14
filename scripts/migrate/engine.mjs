/**
 * Durable, idempotent, crash-safe migration engine.
 *
 * The problem this solves: our first big automated run died to a session limit
 * mid-flight and lost its progress, because state lived in the orchestrator's
 * memory. Here the ONLY source of truth is on disk, and every task is checked
 * against the ACTUAL REPO before doing anything — so a crash at any point is
 * safe: re-running re-derives what is already done from the working tree, not
 * from a checkpoint that might be stale.
 *
 * Three guarantees, by construction:
 *   1. SAVES PROGRESS      — every state transition is journaled (append-only)
 *                            and the materialized state is written atomically
 *                            (tmp + rename), so a crash never corrupts it.
 *   2. RESUMES             — `plan(state)` returns the next actionable task by
 *                            re-checking postconditions against the repo; a
 *                            task whose postcondition already holds is marked
 *                            done WITHOUT re-applying (idempotent).
 *   3. VERIFIES EVERYTHING — a task is only `verified` when its own gates pass.
 *                            A gate that cannot run (degraded sandbox) yields
 *                            `deferred`, never a false green, and a later run
 *                            re-checks it. Nothing is trusted, only observed.
 *
 * The engine is orchestrator-agnostic: a Workflow, a plain `node run.mjs`, or a
 * human can drive it. Whoever runs next reconciles from the same files.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const REPO = resolve(process.cwd());
const STATE_DIR = join(REPO, 'scripts/migrate/state');

/** Task lifecycle states. */
export const STATUS = {
  PENDING: 'pending', // not started (or postcondition not yet met)
  APPLIED: 'applied', // change made, but verification not yet green
  VERIFIED: 'verified', // change made AND all gates passed — terminal success
  FAILED: 'failed', // apply or verify failed hard — terminal until re-planned
  BLOCKED: 'blocked', // a dependency is not verified yet
};

function statePaths(planName) {
  return {
    state: join(STATE_DIR, `${planName}.state.json`),
    journal: join(STATE_DIR, `${planName}.journal.jsonl`),
  };
}

/** Load materialized state, or an empty ledger. Never throws on absence. */
export function loadState(planName) {
  const { state } = statePaths(planName);
  if (!existsSync(state)) return { plan: planName, tasks: {} };
  try {
    return JSON.parse(readFileSync(state, 'utf8'));
  } catch {
    // Corrupt materialized state (e.g. torn write from a kill before rename is
    // impossible, but a manual edit is not): rebuild from the journal.
    return replayJournal(planName);
  }
}

/** Rebuild state by replaying the append-only journal — the durable fallback. */
export function replayJournal(planName) {
  const { journal } = statePaths(planName);
  const st = { plan: planName, tasks: {} };
  if (!existsSync(journal)) return st;
  for (const line of readFileSync(journal, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      st.tasks[e.id] = { ...(st.tasks[e.id] ?? {}), ...e };
    } catch {
      /* skip a partial trailing line from a crash mid-append */
    }
  }
  return st;
}

/** Atomic write: tmp + rename, so a crash leaves either the old or new file. */
function saveStateAtomic(planName, st) {
  const { state } = statePaths(planName);
  mkdirSync(dirname(state), { recursive: true });
  const tmp = `${state}.tmp`;
  writeFileSync(tmp, JSON.stringify(st, null, 2));
  renameSync(tmp, state);
}

/** Append one immutable event to the journal (fsync-friendly, never rewrites). */
function journal(planName, event) {
  const { journal: jf } = statePaths(planName);
  mkdirSync(dirname(jf), { recursive: true });
  appendFileSync(jf, JSON.stringify(event) + '\n');
}

/**
 * Record a task transition: journal it (durable), then materialize (fast read).
 * The journal is authoritative; the materialized file is a cache.
 */
export function record(planName, st, id, patch) {
  const now = new Date().toISOString();
  const event = { id, at: now, ...patch };
  journal(planName, event);
  st.tasks[id] = { ...(st.tasks[id] ?? {}), id, ...patch, at: now };
  saveStateAtomic(planName, st);
  return st.tasks[id];
}

/* --------------------------- postcondition checks --------------------------- *
 * These are the crash-safety keystone: they answer "is this task's END STATE
 * already true in the repo?" purely by observing the working tree, so a task
 * whose edit landed before a crash (but was not recorded) is detected as done.
 * ---------------------------------------------------------------------------- */

/** Run `git grep -l` for a fixed string; returns matching tracked paths. */
function gitGrepFiles(pattern) {
  try {
    const out = execFileSync('git', ['grep', '-lF', '--', pattern], { cwd: REPO, encoding: 'utf8' });
    return out.split('\n').filter(Boolean);
  } catch (e) {
    // git grep exits 1 when there are NO matches — that is success for "absent".
    if (e.status === 1) return [];
    throw e;
  }
}

/** True if `path` (file or dir) does not exist in the working tree. */
function pathAbsent(p) {
  return !existsSync(join(REPO, p));
}

/**
 * Evaluate a postcondition object against the repo. Returns
 * { ok, failures: [reason] }. Supported keys:
 *   grepAbsent:  [{ pattern, allow?: [pathPrefix] }]  — string must not appear
 *                outside the allowlist (allow always includes scripts/migrate,
 *                docs/, packages/bridge, packages/engine — backend kept per the
 *                "browser-only UI, keep bridge code" decision).
 *   pathAbsent:  [ "apps/web/src/features/apbs" ]     — file/dir removed
 *   fileContains:[{ path, pattern }]                   — sanity anchors
 *   fileAbsentLine: [{ path, pattern }]                — line/string gone from a file
 */
const ALWAYS_ALLOW = ['scripts/migrate/', 'docs/', 'packages/bridge/', 'packages/engine/'];

export function checkPostcondition(pc) {
  if (!pc) return { ok: true, failures: [] };
  const failures = [];

  for (const g of pc.grepAbsent ?? []) {
    const allow = [...ALWAYS_ALLOW, ...(g.allow ?? [])];
    const hits = gitGrepFiles(g.pattern).filter((f) => !allow.some((a) => f.startsWith(a)));
    if (hits.length) failures.push(`grepAbsent "${g.pattern}" still in: ${hits.slice(0, 6).join(', ')}${hits.length > 6 ? ' …' : ''}`);
  }
  for (const p of pc.pathAbsent ?? []) {
    if (!pathAbsent(p)) failures.push(`pathAbsent: ${p} still exists`);
  }
  for (const fc of pc.fileContains ?? []) {
    const fp = join(REPO, fc.path);
    if (!existsSync(fp) || !readFileSync(fp, 'utf8').includes(fc.pattern)) {
      failures.push(`fileContains: ${fc.path} missing anchor "${fc.pattern}"`);
    }
  }
  for (const fa of pc.fileAbsentLine ?? []) {
    const fp = join(REPO, fa.path);
    if (existsSync(fp) && readFileSync(fp, 'utf8').includes(fa.pattern)) {
      failures.push(`fileAbsentLine: ${fa.path} still contains "${fa.pattern}"`);
    }
  }
  return { ok: failures.length === 0, failures };
}

/* ------------------------------- verify gates ------------------------------- */

/**
 * Run a shell verify gate. Returns { gate, status: 'pass'|'fail'|'deferred', detail }.
 * A gate that cannot even spawn (degraded sandbox: EAGAIN, missing tool) is
 * `deferred`, NOT `fail` — the run continues and a later pass re-checks it, so a
 * broken environment never produces a false verdict and never hard-crashes us.
 */
export function runGate(gate, cmd, { timeoutMs = 600_000 } = {}) {
  try {
    // Put a `pnpm` shim on PATH so both the gate command AND any pnpm it shells
    // out to internally (the `typecheck` script runs `pnpm -r`) resolve here,
    // where only `corepack` is installed.
    const env = { ...process.env, PATH: `${join(REPO, 'scripts/migrate/bin')}:${process.env.PATH}` };
    execFileSync(cmd[0], cmd.slice(1), { cwd: REPO, encoding: 'utf8', timeout: timeoutMs, stdio: 'pipe', env });
    return { gate, status: 'pass', detail: '' };
  } catch (e) {
    const infra = e.code === 'EAGAIN' || e.code === 'ENOMEM' || e.code === 'ENOENT' || e.signal === 'SIGKILL';
    const out = `${e.stdout ?? ''}\n${e.stderr ?? ''}`.trim().slice(-800);
    return { gate, status: infra ? 'deferred' : 'fail', detail: infra ? `infra: ${e.code ?? e.signal}` : out };
  }
}

/** Age (ms) of a state file, for "when did we last checkpoint" reporting. */
export function stateAge(planName) {
  const { state } = statePaths(planName);
  return existsSync(state) ? Date.now() - statSync(state).mtimeMs : Infinity;
}
