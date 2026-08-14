#!/usr/bin/env node
// Human dashboard for the grind. `node verify/status.mjs [--blocked] [--kind state]`
import * as ledger from './ledger.mjs';

const args = process.argv.slice(2);
const showBlocked = args.includes('--blocked');
const kindIdx = args.indexOf('--kind');
const kindFilter = kindIdx >= 0 ? args[kindIdx + 1] : null;

const all = ledger.list().filter((r) => !kindFilter || r.probeKind === kindFilter);
const by = {};
const byProbe = {};
for (const r of all) {
  by[r.state] = (by[r.state] || 0) + 1;
  byProbe[r.probeKind] = byProbe[r.probeKind] || {};
  byProbe[r.probeKind][r.state] = (byProbe[r.probeKind][r.state] || 0) + 1;
}
const terminal = all.filter((r) => ledger.TERMINAL.has(r.state)).length;
const pct = all.length ? ((terminal / all.length) * 100).toFixed(1) : '0';

console.log(`\n=== feature-verification ledger ===`);
console.log(`total ${all.length} | terminal ${terminal} (${pct}%) | remaining ${all.length - terminal}`);
console.log(`byState: ${JSON.stringify(by)}`);
console.log(`\nby probeKind:`);
for (const [pk, states] of Object.entries(byProbe)) {
  console.log(`  ${pk.padEnd(7)} ${JSON.stringify(states)}`);
}

if (showBlocked) {
  const blocked = all.filter((r) => r.state === 'blocked');
  console.log(`\n=== ${blocked.length} blocked ===`);
  for (const r of blocked) console.log(`  ${r.id}  — ${r.blockedReason || r.lastError || '?'}`);
}
