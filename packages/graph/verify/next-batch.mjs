#!/usr/bin/env node
// Driver step: atomically CLAIM up to N workable features and print them as JSON.
// The driver passes this JSON to the verification Workflow as its work list.
//   node verify/next-batch.mjs 8 --kind state --worker tick-42
import * as ledger from './ledger.mjs';

const n = Number(process.argv[2] || 8);
const kindIdx = process.argv.indexOf('--kind');
const kind = kindIdx >= 0 ? process.argv[kindIdx + 1] : null;
const wIdx = process.argv.indexOf('--worker');
const worker = wIdx >= 0 ? process.argv[wIdx + 1] : `tick-${process.pid}`;

const filter = (r) => {
  if (kind && r.probeKind !== kind) return false;
  // Only attempt features the current oracle can ground-truth.
  if (r.oracleable === false) return false;
  return true;
};

const picked = ledger.claimBatch(n, worker, filter);
const slim = picked.map((r) => ({
  id: r.id,
  feature: r.feature,
  kind: r.kind,
  category: r.category,
  subcategory: r.subcategory,
  summary: r.summary,
  signature: r.signature,
  doc: r.doc,
  probeKind: r.probeKind,
  attempts: r.attempts || 0,
}));
process.stdout.write(JSON.stringify(slim, null, 0));
