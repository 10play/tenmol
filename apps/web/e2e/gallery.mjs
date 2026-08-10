#!/usr/bin/env node
/**
 * Visual parity gallery — a self-contained HTML viewer for eyeballing how close
 * our TS render (golden) sits to real PyMOL (ref).
 *
 *   node apps/web/e2e/gallery.mjs [--open]
 *
 * For every scene it pairs:
 *   ref    docs/screenshots/visual/refs/<id>.png    — real PyMOL ray render (target)
 *   golden docs/screenshots/visual/golden/<id>.png  — our committed TS baseline
 *   actual apps/web/e2e/output/visual/<id>.actual.png (if a run produced one)
 * computes a pixelmatch golden-vs-ref diff + similarity %, and writes ONE
 * self-contained file (all PNGs inlined as data URIs) to two places:
 *
 *   apps/web/e2e/output/visual/gallery.html   (gitignored artifact)
 *   apps/web/public/gallery.html              (served by the front dev server
 *                                              at /gallery.html; gitignored)
 *
 * Open http://<front-host>:<port>/gallery.html . Per scene: a wipe slider
 * between PyMOL (left) and Ours (right), plus Ref / Ours / Actual / Diff
 * toggles. Cards are sorted worst-match-first.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const REFS = join(REPO, 'docs/screenshots/visual/refs');
const GOLDEN = join(REPO, 'docs/screenshots/visual/golden');
const OUT = join(REPO, 'apps/web/e2e/output/visual');
const HTML = join(OUT, 'gallery.html');
// Also drop a copy under the web app's public/ so it is reachable via the
// already-running (and network-exposed) front dev server at /gallery.html.
const PUBLIC_HTML = join(REPO, 'apps/web/public/gallery.html');

mkdirSync(OUT, { recursive: true });

/** pixelmatch two PNG buffers (cropped to the shared box); returns diff PNG + counts. */
function diff(aBuf, bBuf) {
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
  return { n, total: width * height, out, width, height };
}

const dataUri = (buf) => `data:image/png;base64,${buf.toString('base64')}`;

const ids = readdirSync(REFS)
  .filter((f) => f.endsWith('.png'))
  .map((f) => f.replace(/\.png$/, ''))
  .sort();

if (ids.length === 0) {
  console.error('gallery: no reference PNGs under docs/screenshots/visual/refs');
  process.exit(1);
}

const scenes = [];
for (const id of ids) {
  const refBuf = readFileSync(join(REFS, `${id}.png`));
  const goldPath = join(GOLDEN, `${id}.png`);
  if (!existsSync(goldPath)) {
    console.warn(`gallery: skip ${id} (no golden)`);
    continue;
  }
  const goldBuf = readFileSync(goldPath);
  const actualPath = join(OUT, `${id}.actual.png`);
  const actualBuf = existsSync(actualPath) ? readFileSync(actualPath) : null;

  const d = diff(goldBuf, refBuf);
  const sim = 100 * (1 - d.n / d.total);
  scenes.push({
    id,
    sim,
    w: d.width,
    h: d.height,
    ref: dataUri(refBuf),
    gold: dataUri(goldBuf),
    actual: actualBuf ? dataUri(actualBuf) : null,
    diff: dataUri(PNG.sync.write(d.out)),
  });
  console.log(`  ${sim.toFixed(1).padStart(5)}%  ${id}`);
}

scenes.sort((a, b) => a.sim - b.sim);
const mean = scenes.reduce((s, x) => s + x.sim, 0) / scenes.length;

const html = renderHtml(scenes, mean);
writeFileSync(HTML, html);
writeFileSync(PUBLIC_HTML, html);
console.log(`\ngallery: wrote ${HTML}`);
console.log(`gallery: served by front dev server at /gallery.html  (${scenes.length} scenes, mean ${mean.toFixed(1)}% golden↔ref)`);
if (process.argv.includes('--open')) {
  const { spawn } = await import('node:child_process');
  spawn('xdg-open', [HTML], { detached: true, stdio: 'ignore' }).unref();
}

function renderHtml(scenes, mean) {
  const cards = scenes
    .map((s, i) => {
      const cls = s.sim >= 90 ? 'good' : s.sim >= 80 ? 'mid' : 'bad';
      return `
    <section class="card" data-i="${i}">
      <header>
        <h2>${s.id}</h2>
        <span class="pct ${cls}">${s.sim.toFixed(1)}%</span>
      </header>
      <div class="stage" style="aspect-ratio:${s.w}/${s.h}">
        <!-- wipe view: base = Ours (golden), top (left side) = PyMOL (ref) -->
        <div class="wipe" data-mode="wipe">
          <img class="base" src="${s.gold}" alt="ours">
          <img class="top" src="${s.ref}" alt="pymol">
          <span class="lbl l">PyMOL</span>
          <span class="lbl r">Ours</span>
          <div class="divider"></div>
          <div class="handle">◂ ▸</div>
        </div>
        <!-- single-image views -->
        <img class="single" data-view="ref" src="${s.ref}" hidden>
        <img class="single" data-view="gold" src="${s.gold}" hidden>
        ${s.actual ? `<img class="single" data-view="actual" src="${s.actual}" hidden>` : ''}
        <img class="single" data-view="diff" src="${s.diff}" hidden>
      </div>
      <nav class="modes">
        <button data-m="wipe" class="on">Wipe</button>
        <button data-m="ref">PyMOL</button>
        <button data-m="gold">Ours</button>
        ${s.actual ? '<button data-m="actual">Actual</button>' : ''}
        <button data-m="diff">Diff</button>
      </nav>
    </section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Visual parity — golden ↔ PyMOL</title>
<style>
  :root { color-scheme: dark; --bg:#0d0f13; --panel:#161a21; --line:#262c36; --fg:#e6e9ef; --dim:#8a93a3; }
  * { box-sizing:border-box; }
  body { margin:0; font:14px/1.4 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--fg); }
  .top-bar { position:sticky; top:0; z-index:5; display:flex; align-items:baseline; gap:16px; flex-wrap:wrap;
    padding:14px 20px; background:linear-gradient(#0d0f13,rgba(13,15,19,.92)); border-bottom:1px solid var(--line); backdrop-filter:blur(6px); }
  .top-bar h1 { font-size:16px; margin:0; font-weight:600; }
  .top-bar .mean { font-variant-numeric:tabular-nums; color:var(--dim); }
  .top-bar .mean b { color:var(--fg); font-size:18px; }
  .hint { color:var(--dim); font-size:12px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(340px,1fr)); gap:16px; padding:16px 20px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  .card header { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:10px 12px; border-bottom:1px solid var(--line); }
  .card h2 { font-size:13px; margin:0; font-weight:600; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
  .pct { font-variant-numeric:tabular-nums; font-weight:700; padding:2px 8px; border-radius:999px; font-size:12px; }
  .pct.good { background:#123021; color:#5ce39a; } .pct.mid { background:#332a12; color:#e9c65c; } .pct.bad { background:#3a1a1a; color:#f0857d; }
  .stage { position:relative; width:100%; background:#000; }
  .stage img { display:block; width:100%; height:100%; object-fit:contain; }
  .stage img[hidden], .stage [hidden] { display:none; }  /* beat .stage img specificity */
  /* wipe: both imgs fill the SAME box; the top one is cropped with clip-path
     (crops, never resizes) so the two halves stay pixel-aligned. */
  .wipe { position:absolute; inset:0; cursor:ew-resize; user-select:none; }
  .wipe .base, .wipe .top { position:absolute; inset:0; }
  .wipe .top { clip-path: inset(0 50% 0 0); }
  .wipe .divider { position:absolute; top:0; bottom:0; left:50%; width:2px; background:#4da3ff; transform:translateX(-1px); pointer-events:none; }
  .wipe .handle { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
    font-size:11px; color:#fff; background:#4da3ff; padding:3px 6px; border-radius:6px; white-space:nowrap; pointer-events:none; }
  .lbl { position:absolute; top:6px; padding:1px 6px; font-size:10px; border-radius:4px;
    background:rgba(0,0,0,.6); color:#cdd6e3; pointer-events:none; z-index:2; }
  .lbl.l { left:6px; } .lbl.r { right:6px; }
  .single { position:absolute; inset:0; }
  nav.modes { display:flex; gap:2px; padding:8px; flex-wrap:wrap; }
  nav.modes button { flex:1; min-width:52px; background:#1e242e; color:var(--dim); border:1px solid var(--line); padding:5px 6px;
    border-radius:6px; cursor:pointer; font-size:12px; }
  nav.modes button:hover { color:var(--fg); }
  nav.modes button.on { background:#24405f; color:#cfe4ff; border-color:#39628f; }
</style>
</head>
<body>
  <div class="top-bar">
    <h1>Visual parity <span class="hint">golden (ours) ↔ ref (PyMOL)</span></h1>
    <div class="mean">mean similarity <b>${mean.toFixed(1)}%</b> · ${scenes.length} scenes · sorted worst-first</div>
    <div class="hint">Drag the blue handle to wipe · left = PyMOL, right = Ours</div>
  </div>
  <div class="grid">
${cards}
  </div>
<script>
  for (const card of document.querySelectorAll('.card')) {
    const wipe = card.querySelector('.wipe');
    const top = wipe.querySelector('.top');
    const divider = wipe.querySelector('.divider');
    const handle = wipe.querySelector('.handle');
    const singles = card.querySelectorAll('.single');

    // wipe drag — p = fraction shown from the left (the PyMOL side)
    let dragging = false;
    const setX = (clientX) => {
      const r = wipe.getBoundingClientRect();
      let p = (clientX - r.left) / r.width;
      p = Math.max(0, Math.min(1, p));
      const pct = (p * 100).toFixed(1) + '%';
      top.style.clipPath = 'inset(0 ' + ((1 - p) * 100).toFixed(1) + '% 0 0)';
      divider.style.left = pct;
      handle.style.left = pct;
    };
    const down = (e) => { dragging = true; setX((e.touches ? e.touches[0] : e).clientX); e.preventDefault(); };
    const move = (e) => { if (dragging) setX((e.touches ? e.touches[0] : e).clientX); };
    const up = () => { dragging = false; };
    wipe.addEventListener('mousedown', down);
    wipe.addEventListener('touchstart', down, { passive: false });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup', up);
    window.addEventListener('touchend', up);

    // mode buttons
    for (const btn of card.querySelectorAll('nav.modes button')) {
      btn.addEventListener('click', () => {
        const m = btn.dataset.m;
        card.querySelectorAll('nav.modes button').forEach((b) => b.classList.toggle('on', b === btn));
        wipe.hidden = m !== 'wipe';
        singles.forEach((img) => { img.hidden = !(m !== 'wipe' && img.dataset.view === m); });
      });
    }
  }
</script>
</body>
</html>`;
}
