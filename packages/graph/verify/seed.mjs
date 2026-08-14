#!/usr/bin/env node
// Seed the ledger from manifest.json: one pending record per feature, routed to a
// probeKind. Idempotent — re-running never clobbers progress (ensure() skips existing).
// `--reroute` refreshes routing on still-pending records only.
import { readFileSync } from 'node:fs';
import { MANIFEST, featureId } from './config.mjs';
import { route } from './router.mjs';
import * as ledger from './ledger.mjs';

const reroute = process.argv.includes('--reroute');
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const features = manifest.features || [];

let created = 0;
const byKind = {};
for (const f of features) {
  const id = featureId(f.kind, f.name);
  const r = route(f);
  byKind[r.probeKind] = (byKind[r.probeKind] || 0) + 1;
  const seedState = r.probeKind === 'na' ? 'skipped' : 'pending';
  const rec = {
    id,
    feature: f.name,
    kind: f.kind,
    category: f.category,
    subcategory: f.subcategory || '',
    summary: f.summary || '',
    signature: f.signature || '',
    doc: f.doc || '',
    parityStatus: f.parityStatus || 'unknown',
    probeKind: r.probeKind,
    oracleable: r.oracleable,
    routeReason: r.reason,
    state: seedState,
  };
  const before = ledger.get(id);
  const rec2 = ledger.ensure(rec);
  if (!before) created++;
  else if (reroute && !ledger.TERMINAL.has(rec2.state) && rec2.state !== 'claimed') {
    ledger.update(id, { probeKind: r.probeKind, oracleable: r.oracleable, routeReason: r.reason });
  }
}

const s = ledger.stats();
console.log(`seeded: ${created} new record(s); ${features.length} features in manifest`);
console.log(`routing (probeKind): ${JSON.stringify(byKind)}`);
console.log(`ledger: ${s.total} total | ${s.terminal} terminal | ${s.remaining} remaining`);
console.log(`byState: ${JSON.stringify(s.byState)}`);
