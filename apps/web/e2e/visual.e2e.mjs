#!/usr/bin/env node
/* global window */
/**
 * Visual regression suite for the in-browser TS renderer.
 *
 *   node apps/web/e2e/visual.e2e.mjs [--update] [--loud] [-t <substring>]
 *
 * For each committed reference (docs/screenshots/visual/refs/<id>.png), it opens
 * the render-only harness on `?backend=local` (our three.js render), screenshots
 * the canvas, and produces TWO comparisons:
 *   (a) TS-vs-PyMOL  — similarity % against the PyMOL reference. Per scene this
 *       is INFORMATIONAL, but the MEAN across all scenes is gated by a floor
 *       (MEAN_PYMOL_FLOOR) so a golden reseeded to something broadly further
 *       from PyMOL turns the build red. See the `tenmol-only:` note at the gate.
 *   (b) TS-vs-golden — against docs/screenshots/visual/golden/<id>.png. STRICT:
 *       our own render must not change unexpectedly. `--update` rewrites goldens.
 *
 * NOTE: this suite is the RENDERER (Mode-G pixels) gate. The ENGINE's exact
 * equivalence to real PyMOL (command observables — counts, colours, coords,
 * selections) is a separate, strict gate: the live differential in
 * tools/parity/test/live.test.ts, run against a real bridge in webclient-e2e.yml.
 *
 * Actual + diff PNGs are written to apps/web/e2e/output/visual/ (gitignored).
 * Runs bridge-free on ubuntu with swiftshader WebGL.
 *
 * Exit 0 all golden gates pass, 1 a golden regression, 2 the stack won't start.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { startWebOnly, REPO } from './harness.mjs';

const REFS = join(REPO, 'docs/screenshots/visual/refs');
const GOLDEN = join(REPO, 'docs/screenshots/visual/golden');
const OUT = join(REPO, 'apps/web/e2e/output/visual');
const argv = process.argv.slice(2);
const update = argv.includes('--update');
const loud = argv.includes('--loud');
const filterAt = argv.indexOf('-t');
const filter = filterAt >= 0 ? argv[filterAt + 1] : null;

/** A golden may drift this fraction of pixels before it is a regression. */
const GOLDEN_MAX_DIFF_RATIO = 0.02;

// tenmol-only: we do NOT gate per-scene TS-vs-PyMOL similarity. Two reasons:
// PyMOL's reference is a RAY render and our real-time WebGL target cannot match
// it pixel-for-pixel (no ray shadows / SES / AO — see docs/engine-backlog.md §4),
// and GPU-less CI (swiftshader) makes a single scene's % noisy. Instead we gate
// the MEAN across all scenes against a floor: stable over 22 scenes, yet it still
// fails the build if a golden is reseeded to something broadly further from PyMOL
// (the "renderer silently drifts away from PyMOL" case). Bump it consciously, as
// with the parity scoreboard's `--min`, when a change legitimately moves the mean.
// The engine's EXACT PyMOL equivalence is gated elsewhere (the live differential).
const MEAN_PYMOL_FLOOR = Number(process.env.TENMOL_VISUAL_PYMOL_FLOOR ?? 90);

mkdirSync(GOLDEN, { recursive: true });
mkdirSync(OUT, { recursive: true });

const scenes = readdirSync(REFS)
  .filter((f) => f.endsWith('.png'))
  .map((f) => f.replace(/\.png$/, ''))
  .filter((id) => !filter || id.includes(filter))
  .sort();

if (scenes.length === 0) {
  console.error('visual: no reference PNGs under docs/screenshots/visual/refs');
  process.exit(1);
}

/** pixelmatch two PNG buffers (same size); returns {diff count, total, out PNG}. */
function compare(aBuf, bBuf) {
  const a = PNG.sync.read(aBuf);
  const b = PNG.sync.read(bBuf);
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const out = new PNG({ width, height });
  const crop = (p) => {
    if (p.width === width && p.height === height) return p.data;
    const c = new PNG({ width, height });
    PNG.bitblt(p, c, 0, 0, width, height, 0, 0);
    return c.data;
  };
  const n = pixelmatch(crop(a), crop(b), out.data, width, height, { threshold: 0.12 });
  return {
    n,
    total: width * height,
    out,
    sizeMismatch: a.width !== b.width || a.height !== b.height,
  };
}

let stack;
try {
  process.stdout.write('visual: booting vite (web-only)… ');
  stack = await startWebOnly({ quiet: !loud });
  console.log(`vite:${stack.vitePort}`);
} catch (e) {
  console.error(`\nvisual: could not start the stack — ${e.message}`);
  process.exit(2);
}

let failed = 0;
const rows = [];
try {
  for (const id of scenes) {
    const refBuf = readFileSync(join(REFS, `${id}.png`));
    const refPng = PNG.sync.read(refBuf);
    const w = refPng.width;
    const h = refPng.height;

    const page = await stack.browser.newPage({
      viewport: { width: Math.max(w + 40, 800), height: Math.max(h + 40, 600) },
      deviceScaleFactor: 1,
    });
    let actualBuf;
    try {
      await page.goto(`${stack.url}?render=1&backend=local&scene=${id}&w=${w}&h=${h}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForFunction(() => window.__tenmolRenderReady != null, null, {
        timeout: 60_000,
      });
      const ready = await page.evaluate(() => window.__tenmolRenderReady);
      if (!ready.ok) throw new Error(`render not ok: ${ready.err}`);
      const el = await page.locator('[data-render-stage]');
      actualBuf = await el.screenshot({ type: 'png' });
    } finally {
      await page.close();
    }

    writeFileSync(join(OUT, `${id}.actual.png`), actualBuf);

    // (a) TS vs PyMOL — informational similarity.
    const vsRef = compare(actualBuf, refBuf);
    const simPct = (100 * (1 - vsRef.n / vsRef.total)).toFixed(1);
    writeFileSync(join(OUT, `${id}.pymol-diff.png`), PNG.sync.write(vsRef.out));

    // (b) TS vs golden — strict self-regression.
    const goldenPath = join(GOLDEN, `${id}.png`);
    let goldStatus;
    if (update || !existsSync(goldenPath)) {
      writeFileSync(goldenPath, actualBuf);
      goldStatus = update ? 'updated' : 'new';
    } else {
      const vsGold = compare(actualBuf, readFileSync(goldenPath));
      const ratio = vsGold.n / vsGold.total;
      writeFileSync(join(OUT, `${id}.golden-diff.png`), PNG.sync.write(vsGold.out));
      if (vsGold.sizeMismatch || ratio > GOLDEN_MAX_DIFF_RATIO) {
        goldStatus = `REGRESSED ${(ratio * 100).toFixed(2)}%`;
        failed++;
      } else {
        goldStatus = `ok ${(ratio * 100).toFixed(2)}%`;
      }
    }
    rows.push({ id, simPct, goldStatus });
    console.log(
      `  ${goldStatus.startsWith('REGRESSED') ? 'FAIL' : 'ok  '} ${id.padEnd(24)} PyMOL≈${simPct}%  golden:${goldStatus}`,
    );
  }
} finally {
  await stack.close();
}

// A committed report of the PyMOL-similarity trend (the "how close to PyMOL" metric).
const report = {
  generatedBy: 'visual.e2e.mjs',
  scenes: rows.map((r) => ({
    id: r.id,
    pymolSimilarityPct: Number(r.simPct),
    golden: r.goldStatus,
  })),
  meanPymolSimilarityPct:
    Math.round((rows.reduce((s, r) => s + Number(r.simPct), 0) / rows.length) * 10) / 10,
};
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(
  `\nvisual: mean PyMOL similarity ${report.meanPymolSimilarityPct}%  ·  ${scenes.length - failed}/${scenes.length} golden gates passed`,
);

// The mean-PyMOL floor (see MEAN_PYMOL_FLOOR). A drift AWAY from PyMOL that the
// self-regression gate can't see (because the golden moved with it) fails here.
// Only meaningful over the FULL corpus — a `-t` subset's mean isn't the real
// mean, so skip the floor when filtering (CI always runs unfiltered).
const belowFloor = !filter && report.meanPymolSimilarityPct < MEAN_PYMOL_FLOOR;
if (belowFloor) {
  console.error(
    `\nvisual: FAIL — mean PyMOL similarity ${report.meanPymolSimilarityPct}% is below the floor ${MEAN_PYMOL_FLOOR}%. ` +
      `The renderer drifted away from PyMOL; fix it, or bump MEAN_PYMOL_FLOOR consciously if the move is intended.`,
  );
}
process.exit(failed || belowFloor ? 1 : 0);
