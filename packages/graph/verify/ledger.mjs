// The durable ledger: one JSON file per feature under verify/status/. This is the
// single source of truth for the grind. It is crash-safe and idempotent — a killed
// run leaves each feature's file intact, so a fresh driver just re-scans and resumes.
// Per-feature files (not one big JSON) means parallel workers never contend on a write.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { STATUS_DIR } from './config.mjs';

// State machine:
//   pending   -> not yet attempted
//   claimed   -> a worker owns it (has a lease); reclaimable if the lease goes stale
//   passed    -> engine-ts already matched the oracle; committed probe exists (terminal success)
//   fixed     -> engine-ts was edited and now matches the oracle; committed probe (terminal success)
//   done      -> additionally confirmed by the browser e2e runner (terminal success, strongest)
//   blocked   -> could not be made to pass within budget (terminal; has a report)
//   skipped   -> not applicable / not verifiable in the TS backend (terminal)
// passed/fixed/done are all terminal-success: each has a committed probe whose differential passes.
export const TERMINAL = new Set(['passed', 'fixed', 'done', 'blocked', 'skipped']);
const LEASE_MS = 30 * 60 * 1000; // a claim older than this is considered abandoned

function ensureDir() {
  if (!existsSync(STATUS_DIR)) mkdirSync(STATUS_DIR, { recursive: true });
}
function fileFor(id) {
  return join(STATUS_DIR, `${id}.json`);
}

// Atomic write (write temp + rename) so a crash never leaves a half-written record.
function writeAtomic(path, obj) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  renameSync(tmp, path);
}

export function get(id) {
  const p = fileFor(id);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

// Create a record if absent; never clobber existing progress. Returns the record.
export function ensure(rec) {
  ensureDir();
  const existing = get(rec.id);
  if (existing) return existing;
  const now = new Date().toISOString();
  const created = { attempts: 0, history: [], createdAt: now, updatedAt: now, ...rec, state: rec.state || 'pending' };
  writeAtomic(fileFor(rec.id), created);
  return created;
}

export function update(id, patch) {
  const cur = get(id);
  if (!cur) throw new Error(`ledger.update: no record ${id}`);
  const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  writeAtomic(fileFor(id), next);
  return next;
}

export function list() {
  ensureDir();
  return readdirSync(STATUS_DIR)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'))
    .map((f) => get(f.replace(/\.json$/, '')))
    .filter(Boolean);
}

// Claim up to `n` workable features (pending, or a claim whose lease went stale).
// Optional `filter(rec)` narrows the pool (e.g. by probeKind). Sets a lease.
export function claimBatch(n, worker, filter = () => true) {
  const now = Date.now();
  const workable = list().filter((r) => {
    if (TERMINAL.has(r.state)) return false;
    if (!filter(r)) return false;
    if (r.state === 'claimed') {
      const age = now - new Date(r.leasedAt || 0).getTime();
      return age > LEASE_MS; // reclaim abandoned lease
    }
    return true; // pending / passed / fixed (not yet terminal) are workable
  });
  // Stable order: fewest attempts first, then id — spreads effort, retries last.
  workable.sort((a, b) => (a.attempts || 0) - (b.attempts || 0) || a.id.localeCompare(b.id));
  const picked = workable.slice(0, n);
  return picked.map((r) =>
    update(r.id, { state: 'claimed', worker, leasedAt: new Date().toISOString() }),
  );
}

export function stats() {
  const all = list();
  const by = {};
  for (const r of all) by[r.state] = (by[r.state] || 0) + 1;
  const done = all.filter((r) => TERMINAL.has(r.state)).length;
  return { total: all.length, terminal: done, remaining: all.length - done, byState: by };
}
