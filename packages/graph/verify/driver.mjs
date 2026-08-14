#!/usr/bin/env node
// Driver control surface for the grind. Ledger-only ops (git is done in the shell tick).
//   node verify/driver.mjs remaining [--kind state]     # count of workable features (goal signal)
//   node verify/driver.mjs claim <n> [--kind state] [--worker w]   # claim + print batch JSON
//   node verify/driver.mjs release-stale                # reset abandoned 'claimed' leases
//   node verify/driver.mjs reconcile                    # heal ledger from committed probes
//   node verify/driver.mjs status
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as ledger from './ledger.mjs';
import { PROBES_DIR } from './config.mjs';

const cmd = process.argv[2];
const arg = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const kind = arg('--kind', null);
const workable = (r) =>
  !ledger.TERMINAL.has(r.state) && r.oracleable !== false && (!kind || r.probeKind === kind) && r.state !== 'claimed';

if (cmd === 'remaining') {
  const n = ledger.list().filter(workable).length;
  process.stdout.write(String(n));
} else if (cmd === 'claim') {
  const n = Number(process.argv[3] || 8);
  const worker = arg('--worker', `tick-${process.pid}`);
  const picked = ledger.claimBatch(n, worker, (r) => r.oracleable !== false && (!kind || r.probeKind === kind));
  const slim = picked.map((r) => ({
    id: r.id, feature: r.feature, kind: r.kind, category: r.category,
    subcategory: r.subcategory, summary: r.summary, signature: r.signature,
    doc: r.doc, probeKind: r.probeKind, attempts: r.attempts || 0,
  }));
  process.stdout.write(JSON.stringify(slim));
} else if (cmd === 'release-stale') {
  // Any 'claimed' whose lease is old, back to pending (a dead run left it hanging).
  const now = Date.now();
  let n = 0;
  for (const r of ledger.list()) {
    if (r.state === 'claimed' && now - new Date(r.leasedAt || 0).getTime() > 20 * 60 * 1000) {
      ledger.update(r.id, { state: 'pending', worker: null });
      n++;
    }
  }
  console.log(`released ${n} stale claim(s)`);
} else if (cmd === 'reconcile') {
  // A committed probe is the durable proof of a verified feature; heal the ledger to match.
  let n = 0;
  if (existsSync(PROBES_DIR)) {
    for (const f of readdirSync(PROBES_DIR).filter((x) => x.endsWith('.json'))) {
      const id = f.replace(/\.json$/, '');
      const r = ledger.get(id);
      if (r && !ledger.TERMINAL.has(r.state) && r.state !== 'passed' && r.state !== 'fixed') {
        ledger.update(id, { state: 'passed', probe: join('packages/graph/verify/probes', f), note: 'reconciled from probe' });
        n++;
      }
    }
  }
  console.log(`reconciled ${n} record(s) from committed probes`);
} else {
  const s = ledger.stats();
  console.log(JSON.stringify(s, null, 2));
}
