#!/usr/bin/env node
// Ledger write CLI used BY the verification agents to record an outcome.
//   node verify/mark.mjs <id> --state done   --probe packages/graph/verify/probes/<id>.json
//   node verify/mark.mjs <id> --state blocked --reason "needs full port of map_new"
//   node verify/mark.mjs <id> --state passed  --note "matched oracle first try"
// Always bumps attempts and appends a short history entry.
import * as ledger from './ledger.mjs';

const id = process.argv[2];
if (!id) {
  console.error('usage: mark.mjs <id> --state <state> [--reason r] [--note n] [--probe p] [--diff json]');
  process.exit(2);
}
const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const state = arg('--state');
const reason = arg('--reason');
const note = arg('--note');
const probe = arg('--probe');
const diff = arg('--diff');

const cur = ledger.get(id);
if (!cur) {
  console.error(`mark.mjs: no ledger record ${id} (seed first)`);
  process.exit(2);
}
const patch = {
  attempts: (cur.attempts || 0) + 1,
  history: [
    ...(cur.history || []),
    { at: new Date().toISOString(), state: state || cur.state, note: note || reason || '' },
  ].slice(-20),
};
if (state) patch.state = state;
if (reason) patch.blockedReason = reason;
if (note) patch.lastNote = note;
if (probe) patch.probe = probe;
if (diff) {
  try {
    patch.lastDiff = JSON.parse(diff);
  } catch {
    patch.lastDiff = diff;
  }
}
// Releasing a lease unless still working.
if (state && state !== 'claimed') patch.worker = null;

const next = ledger.update(id, patch);
console.log(`marked ${id} -> ${next.state} (attempt ${next.attempts})`);
