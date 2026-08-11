#!/usr/bin/env node
/**
 * Visual-parity scoreboard + ratchet — `pnpm parity:visual`.
 *
 * The single tracked number the renderer-parity effort chases: how close our
 * committed TS render (docs/screenshots/visual/golden/<id>.png) sits to the real
 * PyMOL ray reference (docs/screenshots/visual/refs/<id>.png), scored by the SAME
 * colour-aware metric the gallery and the visual regression suite use
 * (apps/web/e2e/score.mjs — mean of shape coverage and foreground colour fidelity).
 *
 * It is DETERMINISTIC and browser-free: it reads the committed PNGs only, so it
 * runs in a fraction of a second in CI with no headless Chromium, no bridge, no
 * GPU. That makes it the cheap gate that TRACKS the trend and RATCHETS it upward.
 *
 * Per scene it also reports a CEILING: the score of the PyMOL ref against a
 * one-pixel-shifted copy of ITSELF. Two different rasterisers (our GL vs PyMOL's
 * ray tracer) framing one camera cannot align better than ~1px, so this ceiling
 * is the practical maximum any renderer can reach on that scene under this metric
 * (the corpus mean ceiling is ~96%, NOT 100%). "headroom" = ceiling − current is
 * the real "how much better can this scene still get" signal.
 *
 *   node scripts/parity-visual.mjs           # print the table + write the scoreboard
 *   node scripts/parity-visual.mjs --check    # RATCHET: exit 1 if the mean dropped
 *                                             #   below the committed baseline
 *   node scripts/parity-visual.mjs --json     # machine-readable to stdout, no write
 *
 * Writes (unless --check/--json):
 *   docs/screenshots/visual/scoreboard.json   committed metric (per-scene + means)
 *   docs/screenshots/visual/scoreboard.md     committed human-readable table
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { score } from '../apps/web/e2e/score.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const REFS = join(REPO, 'docs/screenshots/visual/refs');
const GOLDEN = join(REPO, 'docs/screenshots/visual/golden');
const JSON_PATH = join(REPO, 'docs/screenshots/visual/scoreboard.json');
const MD_PATH = join(REPO, 'docs/screenshots/visual/scoreboard.md');

const argv = process.argv.slice(2);
const check = argv.includes('--check');
const jsonOut = argv.includes('--json');

/** Shift a PNG buffer one pixel right (clamped) — the ceiling probe. */
function shift1px(buf) {
  const p = PNG.sync.read(buf);
  const o = new PNG({ width: p.width, height: p.height });
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      const sx = Math.max(0, x - 1);
      const si = (y * p.width + sx) * 4;
      const di = (y * p.width + x) * 4;
      o.data[di] = p.data[si];
      o.data[di + 1] = p.data[si + 1];
      o.data[di + 2] = p.data[si + 2];
      o.data[di + 3] = p.data[si + 3];
    }
  }
  return PNG.sync.write(o);
}

const ids = readdirSync(REFS)
  .filter((f) => f.endsWith('.png'))
  .map((f) => f.replace(/\.png$/, ''))
  .sort();

const rows = [];
for (const id of ids) {
  const refBuf = readFileSync(join(REFS, `${id}.png`));
  const goldPath = join(GOLDEN, `${id}.png`);
  if (!existsSync(goldPath)) continue;
  const goldBuf = readFileSync(goldPath);
  const s = score(goldBuf, refBuf);
  const ceil = score(shift1px(refBuf), refBuf).scorePct;
  rows.push({
    id,
    comb: round1(s.scorePct),
    shape: round1(s.coveragePct),
    color: round1(s.colorPct),
    ceiling: round1(ceil),
    headroom: round1(ceil - s.scorePct),
  });
}

if (rows.length === 0) {
  console.error('parity-visual: no golden/ref pairs found');
  process.exit(1);
}

const mean = (k) => round1(rows.reduce((a, r) => a + r[k], 0) / rows.length);
const summary = {
  meanCombined: mean('comb'),
  meanShape: mean('shape'),
  meanColor: mean('color'),
  meanCeiling: mean('ceiling'),
  scenes: rows.length,
};

function round1(x) {
  return Math.round(x * 10) / 10;
}

if (jsonOut) {
  console.log(JSON.stringify({ summary, scenes: rows }, null, 2));
  process.exit(0);
}

// --check: RATCHET against the committed baseline mean. A drop fails CI; an
// improvement is fine (rewrite the scoreboard to lock the new floor in a commit).
if (check) {
  if (!existsSync(JSON_PATH)) {
    console.error(
      'parity-visual: no committed scoreboard.json to ratchet against; run without --check first.',
    );
    process.exit(1);
  }
  const prev = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
  const base = prev.summary?.meanCombined ?? 0;
  const now = summary.meanCombined;
  const EPS = 0.3; // allow sub-0.3% scorer noise; a real regression is bigger.
  printTable(rows, summary, base);
  if (now < base - EPS) {
    console.error(
      `\nparity-visual: FAIL — mean ${now}% dropped below the committed baseline ${base}% ` +
        `(tolerance ${EPS}). A renderer change made parity WORSE; fix it or, if intended, ` +
        `run \`node scripts/parity-visual.mjs\` to rebaseline and commit the new scoreboard.`,
    );
    process.exit(1);
  }
  console.log(
    `\nparity-visual: OK — mean ${now}% ≥ baseline ${base}% (ceiling ${summary.meanCeiling}%).`,
  );
  process.exit(0);
}

// Default: write the committed scoreboard (JSON + Markdown) and print.
const prevMean = existsSync(JSON_PATH)
  ? JSON.parse(readFileSync(JSON_PATH, 'utf8')).summary?.meanCombined
  : null;
writeFileSync(JSON_PATH, JSON.stringify({ summary, scenes: rows }, null, 2) + '\n');
writeFileSync(MD_PATH, renderMarkdown(rows, summary, prevMean));
printTable(rows, summary, prevMean);
const delta =
  prevMean == null
    ? ''
    : `  (Δ ${summary.meanCombined - prevMean >= 0 ? '+' : ''}${round1(summary.meanCombined - prevMean)} vs previous)`;
console.log(`\nparity-visual: wrote ${JSON_PATH} and ${MD_PATH}${delta}`);

function printTable(rows, summary, base) {
  const sorted = [...rows].sort((a, b) => a.comb - b.comb);
  console.log(`\nVisual parity — golden (ours) ↔ ref (PyMOL), worst-first`);
  console.log(
    `${'scene'.padEnd(24)} ${'comb'.padStart(6)} ${'shape'.padStart(6)} ${'color'.padStart(6)} ${'ceil'.padStart(6)} ${'gap'.padStart(6)}`,
  );
  for (const r of sorted) {
    console.log(
      `${r.id.padEnd(24)} ${String(r.comb).padStart(6)} ${String(r.shape).padStart(6)} ${String(r.color).padStart(6)} ${String(r.ceiling).padStart(6)} ${String(r.headroom).padStart(6)}`,
    );
  }
  const baseNote = base == null ? '' : `  (baseline ${base}%)`;
  console.log(
    `\nMEAN combined ${summary.meanCombined}%  (shape ${summary.meanShape}% · color ${summary.meanColor}%)  ` +
      `ceiling ${summary.meanCeiling}%${baseNote}`,
  );
}

function renderMarkdown(rows, summary, prevMean) {
  const sorted = [...rows].sort((a, b) => a.comb - b.comb);
  const deltaLine =
    prevMean == null
      ? ''
      : `\n> Δ vs previous scoreboard: **${summary.meanCombined - prevMean >= 0 ? '+' : ''}${round1(summary.meanCombined - prevMean)}%**\n`;
  const head =
    `<!-- Generated by scripts/parity-visual.mjs — do not edit by hand. -->\n` +
    `# Visual parity scoreboard\n\n` +
    `How close our committed TS render (**golden**) sits to the real **PyMOL** ray\n` +
    `reference, by the colour-aware metric in \`apps/web/e2e/score.mjs\` (mean of shape\n` +
    `coverage and foreground colour fidelity). Regenerate goldens with\n` +
    `\`node apps/web/e2e/visual.e2e.mjs --update\`, then \`node scripts/parity-visual.mjs\`.\n` +
    `View the scenes visually in the gallery: \`node apps/web/e2e/gallery.mjs\` →\n` +
    `\`/gallery.html\` on the front dev server.\n\n` +
    `**Mean combined: ${summary.meanCombined}%** (shape ${summary.meanShape}% · color ${summary.meanColor}%) ` +
    `across ${summary.scenes} scenes.\n` +
    `**Ceiling: ${summary.meanCeiling}%** — the max any renderer can reach under this metric ` +
    `(PyMOL ref scored against a 1px-shifted copy of itself; two different rasterisers ` +
    `can't align better than ~1px). "gap" = ceiling − current = remaining headroom.\n` +
    deltaLine +
    `\n| scene | combined | shape | color | ceiling | gap |\n` +
    `|---|--:|--:|--:|--:|--:|\n`;
  const body = sorted
    .map(
      (r) => `| \`${r.id}\` | ${r.comb} | ${r.shape} | ${r.color} | ${r.ceiling} | ${r.headroom} |`,
    )
    .join('\n');
  return head + body + '\n';
}
