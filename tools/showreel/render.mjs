#!/usr/bin/env node
/* global window -- referenced only inside page.evaluate callbacks, which run in the browser */
// Render the tenmol motion reel to MP4.
//
//   node tools/showreel/render.mjs                       full render -> apps/web/public/reel/tenmol-reel.mp4 + docs/showreel/tenmol-reel.webp
//   node tools/showreel/render.mjs --stills 0,300,700    a few frames as JPEGs, for review
//   node tools/showreel/render.mjs --serve               live preview at http://127.0.0.1:<port>/?play
//
// Needs a Chromium for playwright-core (PLAYWRIGHT_BROWSERS_PATH or CHROME=/path/to/chrome) and an
// ffmpeg on PATH (or FFMPEG=/path/to/ffmpeg, e.g. from `npx ffmpeg-static`).

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { FPS, DURATION } from './lib.mjs';
import { writeSoundtrack } from './audio.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? dflt : (args[i + 1] ?? true);
};

function findFont(pkg, file) {
  const pnpm = path.join(ROOT, 'node_modules/.pnpm');
  const dir = fs.readdirSync(pnpm).find((d) => d.startsWith(`@fontsource-variable+${pkg}@`));
  if (!dir) throw new Error(`font package @fontsource-variable/${pkg} not installed — run pnpm install`);
  return path.join(pnpm, dir, 'node_modules/@fontsource-variable', pkg, 'files', file);
}

const ROUTES = {
  '/fonts/space-grotesk.woff2': findFont('space-grotesk', 'space-grotesk-latin-wght-normal.woff2'),
  '/fonts/jetbrains-mono.woff2': findFont('jetbrains-mono', 'jetbrains-mono-latin-wght-normal.woff2'),
  '/pdb/1tii.pdb': path.join(ROOT, 'packages/engine/test/dat/1tii.pdb'),
};
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.woff2': 'font/woff2' };

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x').pathname;
    const file = ROUTES[url] ?? path.join(HERE, url === '/' ? 'index.html' : path.normalize(url));
    if (!file.startsWith(HERE) && !Object.values(ROUTES).includes(file)) return res.writeHead(403).end();
    fs.readFile(file, (err, buf) => {
      if (err) return res.writeHead(404).end();
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise((ok) => server.listen(+opt('port', 0), '127.0.0.1', () => ok(server)));
}

async function openPage(url) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', (e) => console.error('[page]', e.message));
  await page.goto(url);
  await page.evaluate(() => window.ready);
  return { browser, page };
}

const decode = (dataUrl) => Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}/`;

if (opt('serve')) {
  console.log(`preview: ${base}?play   (add &t=12 to start at 12 s)`);
} else if (opt('stills')) {
  const out = path.resolve(opt('dir', path.join(os.tmpdir(), 'tenmol-reel-stills')));
  fs.mkdirSync(out, { recursive: true });
  const { browser, page } = await openPage(base);
  for (const f of String(opt('stills')).split(',').map(Number)) {
    const t0 = Date.now();
    fs.writeFileSync(path.join(out, `f${String(f).padStart(5, '0')}.jpg`), decode(await page.evaluate((i) => window.grab(i), f)));
    console.log(`frame ${f} (${(f / FPS).toFixed(2)} s) ${Date.now() - t0} ms`);
  }
  await browser.close();
  server.close();
  console.log(out);
} else {
  const total = FPS * DURATION;
  const workers = +opt('workers', Math.max(1, Math.min(8, os.cpus().length >> 1)));
  const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'tenmol-reel-'));
  const outFile = path.resolve(opt('out', path.join(ROOT, 'apps/web/public/reel/tenmol-reel.mp4')));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  console.log(`rendering ${total} frames with ${workers} workers -> ${frames}`);
  let done = 0;
  const t0 = Date.now();
  await Promise.all(
    Array.from({ length: workers }, async (_, w) => {
      const { browser, page } = await openPage(base);
      for (let f = w; f < total; f += workers) {
        const jpg = decode(await page.evaluate((i) => window.grab(i, 0.97), f));
        fs.writeFileSync(path.join(frames, `${String(f).padStart(5, '0')}.jpg`), jpg);
        if (++done % 60 === 0) console.log(`${done}/${total}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      }
      await browser.close();
    }),
  );
  server.close();

  const wav = path.join(frames, 'soundtrack.wav');
  writeSoundtrack(wav);
  // Video and audio are encoded in two steps: muxing in one pass buffers the whole stream
  // and blows past small memory limits.
  const ffmpeg = process.env.FFMPEG || 'ffmpeg';
  const video = path.join(frames, 'video.mp4');
  const run = (argv) => {
    const r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', ...argv], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`ffmpeg failed (${r.error?.message ?? r.signal ?? r.status})`);
  };
  run([
    '-threads', '1', '-framerate', String(FPS), '-i', path.join(frames, '%05d.jpg'),
    '-vf', 'fps=30,scale=1280:-2', '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p',
    '-threads', '3', '-x264-params', 'rc-lookahead=20', '-maxrate', '4M', '-bufsize', '8M',
    video,
  ]);
  run(['-i', video, '-i', wav, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outFile]);
  // Silent animated WebP that autoplays inline in the README.
  const webp = path.resolve(opt('webp', path.join(ROOT, 'docs/showreel/tenmol-reel.webp')));
  run([
    '-framerate', String(FPS), '-i', path.join(frames, '%05d.jpg'),
    '-vf', 'fps=20,scale=960:-1:flags=lanczos', '-c:v', 'libwebp_anim', '-loop', '0',
    '-quality', '65', '-compression_level', '4', webp,
  ]);
  if (!opt('keep')) fs.rmSync(frames, { recursive: true, force: true });
  console.log(`wrote ${outFile} (${(fs.statSync(outFile).size / 1e6).toFixed(1)} MB) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
