/**
 * Execute one shard of TestSpecs against a freshly-booted isolated stack.
 *
 *   node scripts/audit/run-shard.mjs <shard.json> <out.json> [shotDir]
 *
 * <shard.json> is { caps: string[], specs: TestSpec[] }. Writes <out.json> =
 * { results: Verdict[] } and one screenshot per spec into shotDir. Deterministic:
 * the ONLY inputs are the spec file and the source tree. Safe to run many in
 * parallel — each invocation boots its own vite+browser on free ports.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { bootStack, newAuditPage, runSpec } from './driver.mjs';

const [shardPath, outPath, shotDir] = process.argv.slice(2);
if (!shardPath || !outPath) {
  console.error('usage: run-shard.mjs <shard.json> <out.json> [shotDir]');
  process.exit(2);
}

const shard = JSON.parse(readFileSync(shardPath, 'utf8'));
const caps = new Set(shard.caps ?? ['local-backend', 'webgl']);
const specs = shard.specs ?? [];

const stack = await bootStack();
const results = [];
try {
  const page = await newAuditPage(stack);
  for (const spec of specs) {
    let r;
    try {
      r = await runSpec(page, spec, { caps, shotDir });
    } catch (e) {
      r = { id: spec.id, verdict: 'FAIL', reason: `runner crash: ${String(e).slice(0, 300)}`, error: true };
    }
    results.push(r);
    console.error(`[${r.verdict}] ${spec.id}${r.reason ? ' — ' + r.reason.slice(0, 120) : ''}`);
  }
} finally {
  await stack.close();
}

writeFileSync(outPath, JSON.stringify({ results }, null, 2));
const tally = results.reduce((m, r) => ((m[r.verdict] = (m[r.verdict] ?? 0) + 1), m), {});
console.error('shard done:', JSON.stringify(tally));
