// Runs the GENERATED per-feature e2e probes against engine-ts (?backend=local) in a
// real headless browser — one booted stack, every probe. Each probe under
// packages/graph/verify/probes/<id>.json is a spec: { feature, ops, checks, expected }.
// `expected` was baked from REAL PyMOL (the oracle) at author time, so this asserts
// engine-ts reproduces real PyMOL's observable behaviour in the actual app.
//
//   node apps/web/e2e/run-generated.mjs            # all committed probes
//   node apps/web/e2e/run-generated.mjs -t show    # filter by feature/id substring
//   node apps/web/e2e/run-generated.mjs --file /abs/probe.json   # one explicit probe
//
// Exit: 0 all pass · 1 a probe failed · 2 stack couldn't start.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)); // apps/web/e2e
const harness = await import(pathToFileURL(join(HERE, 'harness.mjs')).href);
const { startWebOnly, openApp } = harness;

const PROBES_DIR = join(HERE, '..', '..', '..', 'packages', 'graph', 'verify', 'probes');
const argv = process.argv.slice(2);
const tIdx = argv.indexOf('-t');
const filter = tIdx >= 0 ? argv[tIdx + 1] : null;
const fIdx = argv.indexOf('--file');
const explicit = fIdx >= 0 ? argv[fIdx + 1] : null;

const CMDLINE = 'input.cmdline__input';
const jsArg = (v) => JSON.stringify(v);
const callExpr = (call) => `cmd.${call[0]}(${call.slice(1).map(jsArg).join(', ')})`;

async function type(page, line, waitMs = 500) {
  await page.fill(CMDLINE, line);
  await page.press(CMDLINE, 'Enter');
  await page.waitForTimeout(waitMs);
}
// Robust readback: wrap the value in unique markers and JSON it, take the last hit.
async function evalValue(page, expr) {
  const tag = 'TMV' + Math.floor(performance.now());
  await type(page, `print("<<${tag}:" + JSON.stringify(${expr}) + ":${tag}>>")`, 350);
  const text = await page.evaluate(() => globalThis.document.body.innerText);
  const re = new RegExp(`<<${tag}:(.*?):${tag}>>`, 'g');
  const hits = [...text.matchAll(re)];
  if (!hits.length) return { __noread: true };
  try {
    return JSON.parse(hits[hits.length - 1][1]);
  } catch {
    return hits[hits.length - 1][1];
  }
}

function approx(a, b, tol) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= tol + 1e-9 * Math.max(Math.abs(a), Math.abs(b));
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => approx(x, b[i], tol));
  return JSON.stringify(a) === JSON.stringify(b);
}

function loadProbes() {
  if (explicit) return [JSON.parse(readFileSync(explicit, 'utf8'))];
  if (!existsSync(PROBES_DIR)) return [];
  return readdirSync(PROBES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(PROBES_DIR, f), 'utf8')))
    .filter((p) => !filter || (p.feature || p.id || '').includes(filter) || (p.id || '').includes(filter));
}

const probes = loadProbes();
if (probes.length === 0) {
  console.log('no probes to run');
  process.exit(0);
}

let stack;
try {
  stack = await startWebOnly({ quiet: true });
} catch (e) {
  console.error('stack failed to start:', e?.message || e);
  process.exit(2);
}

let failed = 0;
try {
  const page = await openApp(stack, { query: '?viewportHandle=1' });
  await page.locator('canvas').first().waitFor({ state: 'attached', timeout: 20000 });
  await page.waitForTimeout(800);

  for (const probe of probes) {
    const name = probe.feature || probe.id || 'unknown';
    const tol = probe.tol ?? 1e-3;
    try {
      await type(page, 'reinitialize', 500);
      for (const op of probe.ops || []) {
        if (typeof op.do === 'string') await type(page, op.do, op.waitMs ?? 600);
        else if (op.call) await type(page, callExpr(op.call), op.waitMs ?? 600);
      }
      const bad = [];
      for (let i = 0; i < (probe.checks || []).length; i++) {
        const c = probe.checks[i];
        const got = await evalValue(page, callExpr(c.call));
        const want = (probe.expected || [])[i];
        if (!approx(got, want, c.tol ?? tol)) bad.push(`${c.label || c.call.join(' ')}: want ${jsArg(want)} got ${jsArg(got)}`);
      }
      if (bad.length) {
        failed++;
        console.log(`✗ ${name}`);
        for (const b of bad) console.log(`    ${b}`);
      } else {
        console.log(`✓ ${name} (${(probe.checks || []).length} checks)`);
      }
    } catch (e) {
      failed++;
      console.log(`✗ ${name} — threw: ${e?.message || e}`);
    }
  }
  await page.close();
} finally {
  await stack.close();
}

console.log(`\n${probes.length - failed}/${probes.length} probes passed`);
process.exit(failed ? 1 : 0);
