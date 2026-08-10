#!/usr/bin/env node
/* global window, requestAnimationFrame */
/**
 * Performance harness for the in-browser TS renderer.
 *
 *   node apps/web/e2e/perf.e2e.mjs [--loud] [-t <substring>]
 *
 * Per scene, on ?backend=local, it measures two numbers that reflect the render
 * cost the Part-6 fixes target:
 *   buildMs   — nav -> render-settled: build every rep's geometry + first paint.
 *   recolorMs — `color white, all` -> re-settled: the engine re-emits and the
 *               viewport re-applies every rep. This is the cost F1 (engine
 *               geometry memoization) and F2 (viewport material pooling) cut.
 *
 * Writes apps/web/e2e/output/perf/report.json. Report-only (no hard gate — a
 * GPU-less CI runner's numbers are noisy; the value is the committed before/after
 * trend). Exit 0 unless the stack won't start (2).
 */

import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startWebOnly, REPO } from './harness.mjs';

const REFS = join(REPO, 'docs/screenshots/visual/refs');
const OUT = join(REPO, 'apps/web/e2e/output/perf');
const argv = process.argv.slice(2);
const loud = argv.includes('--loud');
const filterAt = argv.indexOf('-t');
const filter = filterAt >= 0 ? argv[filterAt + 1] : null;

mkdirSync(OUT, { recursive: true });

const scenes = readdirSync(REFS)
  .filter((f) => f.endsWith('.png'))
  .map((f) => f.replace(/\.png$/, ''))
  .filter((id) => !filter || id.includes(filter))
  .sort();

let stack;
try {
  process.stdout.write('perf: booting vite (web-only)… ');
  stack = await startWebOnly({ quiet: !loud });
  console.log(`vite:${stack.vitePort}`);
} catch (e) {
  console.error(`\nperf: could not start the stack — ${e.message}`);
  process.exit(2);
}

const rows = [];
try {
  for (const id of scenes) {
    const page = await stack.browser.newPage({ viewport: { width: 800, height: 640 }, deviceScaleFactor: 1 });
    try {
      await page.goto(`${stack.url}?render=1&backend=local&scene=${id}&w=640&h=480`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForFunction(() => window.__tenmolRenderReady?.ok === true, null, { timeout: 60_000 });
      const buildMs = await page.evaluate(() => window.__tenmolRenderReady.buildMs);

      // Trigger a full re-emit/re-apply and time it (the F1/F2 target).
      const recolorMs = await page.evaluate(async () => {
        const vp = window.__tenmolViewport;
        const conn = window.__tenmol.conn;
        const before = vp.stats.geometryFrames;
        const t0 = performance.now();
        await conn.call('color', ['white', 'all']);
        // wait until frames advance past `before` and then stop advancing
        let last = -1;
        let stable = 0;
        while (stable < 10) {
          await new Promise((r) => requestAnimationFrame(r));
          const f = vp.stats.geometryFrames;
          if (f === last && f > before) stable += 1;
          else stable = 0;
          last = f;
          if (performance.now() - t0 > 8000) break;
        }
        return performance.now() - t0;
      });

      rows.push({ id, buildMs: Math.round(buildMs), recolorMs: Math.round(recolorMs) });
      console.log(`  ${id.padEnd(24)} build ${Math.round(buildMs)}ms  recolor ${Math.round(recolorMs)}ms`);
    } finally {
      await page.close();
    }
  }
} finally {
  await stack.close();
}

const mean = (k) => Math.round(rows.reduce((s, r) => s + r[k], 0) / Math.max(rows.length, 1));
const report = {
  generatedBy: 'perf.e2e.mjs',
  note: 'swiftshader/GPU-less numbers are noisy; use for before/after trend',
  scenes: rows,
  meanBuildMs: mean('buildMs'),
  meanRecolorMs: mean('recolorMs'),
};
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`\nperf: mean build ${report.meanBuildMs}ms · mean recolor ${report.meanRecolorMs}ms`);
process.exit(0);
