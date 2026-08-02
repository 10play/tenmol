/**
 * End-to-end harness — WP-27.
 *
 * Boots a real PyMOL bridge and a real vite dev server on FREE ports, drives
 * the app in a headless browser, and tears everything down. Replaces the
 * ad-hoc scratchpad scripts every wave has been re-inventing, so a parity claim
 * can be re-checked by anyone instead of trusted.
 *
 * Two things it deliberately does NOT do:
 *
 *  - It does not use the playwright test runner. Only `playwright-core` is a
 *    dependency (no browser download, no runner); the assertions here are plain
 *    and the runner is thirty lines. Adding `@playwright/test` would pull a
 *    second browser copy for no gain at this size.
 *  - It does not hardcode a chromium build number. The cache holds several and
 *    they rotate; it picks the newest present and fails with a clear message if
 *    none is.
 *
 * KEYCHAIN: `--use-mock-keychain` and `--password-store=basic` are mandatory.
 * Without them Chromium prompts for the macOS login password, which interrupts
 * whoever is at the keyboard. Do not remove them.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '../../..');

const CHROME_ARGS = [
  '--use-mock-keychain',
  '--password-store=basic',
  '--no-first-run',
  '--no-default-browser-check',
  '--enable-unsafe-swiftshader',
];

/** Newest cached chrome-headless-shell, or null. */
export function findChrome() {
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  if (!existsSync(cache)) return null;
  const builds = readdirSync(cache)
    .filter((d) => d.startsWith('chromium_headless_shell-'))
    .map((d) => ({ d, n: Number(d.split('-')[1]) || 0 }))
    .sort((a, b) => b.n - a.n);
  for (const { d } of builds) {
    const exe = join(cache, d, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell');
    if (existsSync(exe)) return exe;
  }
  return null;
}

export function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

async function waitFor(label, probe, { timeoutMs = 90_000, everyMs = 400 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      if (await probe()) return;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error(`timed out waiting for ${label}${last ? `: ${last.message}` : ''}`);
}

/** Turn a spawn failure into a rejected promise instead of an unhandled event. */
function watchSpawn(child, label) {
  return new Promise((_res, rej) => {
    child.once('error', (e) => rej(new Error(`${label} failed to start: ${e.message}`)));
    child.once('exit', (code) => {
      if (code !== 0 && code !== null) rej(new Error(`${label} exited early with code ${code}`));
    });
  });
}

async function httpOk(url) {
  try {
    const r = await fetch(url);
    return r.ok;
  } catch {
    return false;
  }
}

/** Boot bridge + vite + browser. Always pair with `stack.close()` in a finally. */
export async function startStack({ quiet = true, noGl = false } = {}) {
  const procs = [];
  const kill = () => {
    for (const p of procs) {
      try {
        p.kill('SIGTERM');
      } catch {
        /* already gone */
      }
    }
  };

  try {
    const bridgePort = await freePort();
    const vitePort = await freePort();

    const bridge = spawn(
      'bash',
      [
        join(REPO, 'scripts/dev-bridge.sh'),
        '--port',
        String(bridgePort),
        '--no-token',
        // The bridge's Origin allow-list is a fixed range (5173-5183 / 4173-4183,
        // `config.py:108`). This suite uses an EPHEMERAL vite port, so without
        // this the socket closes 1006 and every spec silently tests a
        // disconnected app.
        '--origin',
        `http://127.0.0.1:${vitePort}`,
        '--origin',
        `http://localhost:${vitePort}`,
        // `--no-gl` refuses to create a context at all, which is how the
        // cross-platform path (Linux without EGL, Windows without WGL) is
        // tested on a machine that does have GL.
        ...(noGl ? ['--no-gl'] : []),
      ],
      { cwd: REPO, stdio: quiet ? 'ignore' : 'inherit' },
    );
    procs.push(bridge);
    const bridgeSpawn = watchSpawn(bridge, 'bridge');
    await Promise.race([
      waitFor('bridge', () => httpOk(`http://127.0.0.1:${bridgePort}/healthz`)),
      bridgeSpawn,
    ]);

    // Run vite directly: `pnpm --filter ... dev -- --port N` does NOT forward
    // the flag (observed: it silently served 5173 instead), which would make
    // two concurrent runs collide.
    // pnpm does not hoist to the root .bin; vite is in the app's own.
    const viteBin = [
      join(REPO, 'apps/web/node_modules/.bin/vite'),
      join(REPO, 'node_modules/.bin/vite'),
    ].find((p) => existsSync(p));
    if (!viteBin) throw new Error('vite binary not found; run `pnpm install`');

    const vite = spawn(
      viteBin,
      ['--port', String(vitePort), '--strictPort'],
      {
        cwd: join(REPO, 'apps/web'),
        stdio: quiet ? 'ignore' : 'inherit',
        // The supported override (`app/config.ts:39`). The app has no
        // `?bridge=` query param, so a random port must arrive this way.
        env: { ...process.env, VITE_TENMOL_WS_URL: `ws://127.0.0.1:${bridgePort}/ws` },
      },
    );
    procs.push(vite);
    const viteSpawn = watchSpawn(vite, 'vite');
    await Promise.race([
      waitFor('vite', () => httpOk(`http://127.0.0.1:${vitePort}/`)),
      viteSpawn,
    ]);

    const exe = findChrome();
    if (!exe) {
      throw new Error(
        'no cached chrome-headless-shell found under ~/Library/Caches/ms-playwright. ' +
          'Run `npx playwright install chromium-headless-shell`.',
      );
    }
    const { chromium } = await import(join(REPO, 'node_modules/playwright-core/index.mjs'));
    const browser = await chromium.launch({ headless: true, executablePath: exe, args: CHROME_ARGS });

    return {
      bridgePort,
      vitePort,
      browser,
      url: `http://127.0.0.1:${vitePort}/`,
      healthz: `http://127.0.0.1:${bridgePort}/healthz`,
      async close() {
        try {
          await browser.close();
        } catch {
          /* already closed */
        }
        kill();
      },
    };
  } catch (e) {
    kill();
    throw e;
  }
}

/**
 * Open the app. The bridge URL was already wired via VITE_TENMOL_WS_URL.
 *
 * `viewport` is overridable because the internal-gui column is a flex column
 * and its panels SHRINK: measured at 1280x900 with six objects loaded,
 * `.objpanel` is 36 px tall (its row list 19 px, scrollHeight 128) while
 * `.mvpanel` takes 221 — so an object row is only reachable through a 19 px
 * scroll window that any poll can reset. At 1280x1400 the same panel is 534 px
 * and nothing scrolls. A spec about ROW BEHAVIOUR should not be a test of that
 * squeeze; see the row-98 spec, which says so and still hit-tests every click.
 */
export async function openApp(stack, { query = '', viewport = { width: 1280, height: 900 } } = {}) {
  const page = await stack.browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${stack.url}${query}`, { waitUntil: 'networkidle' });
  page.__errors = errors;
  return page;
}
