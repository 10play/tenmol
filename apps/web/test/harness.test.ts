/**
 * Unit tests for the e2e harness's non-trivial, environment-sensitive helpers:
 * `findChrome()` (the multi-cache / multi-platform browser lookup) and
 * `startWebOnly()`'s fail-fast when no browser is cached. The happy path of
 * `startWebOnly` (spawning vite + a real browser) is integration-only and is
 * exercised by the e2e scripts; here we pin the pure logic.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { findChrome, freePort, startWebOnly } from '../e2e/harness.mjs';

const LINUX = 'chrome-headless-shell-linux64/chrome-headless-shell';
const MAC_ARM = 'chrome-headless-shell-mac-arm64/chrome-headless-shell';

const tmpRoots: string[] = [];

/**
 * Build a fake Playwright browsers cache. Each entry is a shell build version
 * and the layout-relative binary to drop inside it (or null for a build dir
 * with no binary). Returns the cache root.
 */
function makeCache(builds: Array<{ ver: number; layout: string | null }>): string {
  const root = mkdtempSync(join(tmpdir(), 'tenmol-fc-'));
  tmpRoots.push(root);
  for (const { ver, layout } of builds) {
    const build = join(root, `chromium_headless_shell-${ver}`);
    if (layout) {
      mkdirSync(join(build, dirname(layout)), { recursive: true });
      writeFileSync(join(build, layout), '#!/bin/sh\n');
    } else {
      mkdirSync(build, { recursive: true });
    }
  }
  return root;
}

let savedBrowsersPath: string | undefined;
let savedHome: string | undefined;

beforeEach(() => {
  savedBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  savedHome = process.env.HOME;
});

afterEach(() => {
  if (savedBrowsersPath === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
  else process.env.PLAYWRIGHT_BROWSERS_PATH = savedBrowsersPath;
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  for (const r of tmpRoots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe('findChrome', () => {
  it('returns the shell binary from the explicit PLAYWRIGHT_BROWSERS_PATH cache', () => {
    const cache = makeCache([{ ver: 1200, layout: LINUX }]);
    process.env.PLAYWRIGHT_BROWSERS_PATH = cache;
    expect(findChrome()).toBe(join(cache, 'chromium_headless_shell-1200', LINUX));
  });

  it('picks the NEWEST build when several are present', () => {
    const cache = makeCache([
      { ver: 1140, layout: LINUX },
      { ver: 1200, layout: LINUX },
      { ver: 1099, layout: LINUX },
    ]);
    process.env.PLAYWRIGHT_BROWSERS_PATH = cache;
    expect(findChrome()).toBe(join(cache, 'chromium_headless_shell-1200', LINUX));
  });

  it('skips a newer build with no binary and falls through to an older one that has it', () => {
    const cache = makeCache([
      { ver: 1200, layout: null }, // newest, but empty
      { ver: 1140, layout: LINUX },
    ]);
    process.env.PLAYWRIGHT_BROWSERS_PATH = cache;
    expect(findChrome()).toBe(join(cache, 'chromium_headless_shell-1140', LINUX));
  });

  it('finds the macOS arm64 layout too', () => {
    const cache = makeCache([{ ver: 1200, layout: MAC_ARM }]);
    process.env.PLAYWRIGHT_BROWSERS_PATH = cache;
    expect(findChrome()).toBe(join(cache, 'chromium_headless_shell-1200', MAC_ARM));
  });

  it('returns null when no cache holds a shell', () => {
    const emptyBrowsers = makeCache([]); // exists but has no builds
    const emptyHome = mkdtempSync(join(tmpdir(), 'tenmol-home-'));
    tmpRoots.push(emptyHome);
    process.env.PLAYWRIGHT_BROWSERS_PATH = emptyBrowsers;
    process.env.HOME = emptyHome; // neutralise the macOS/Linux homedir caches
    expect(findChrome()).toBeNull();
  });
});

describe('freePort', () => {
  it('resolves a usable, positive TCP port', async () => {
    const port = await freePort();
    expect(typeof port).toBe('number');
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65_536);
  });
});

describe('startWebOnly', () => {
  it('fails fast with a clear message when no browser is cached (no stack spawned)', async () => {
    const emptyBrowsers = makeCache([]);
    const emptyHome = mkdtempSync(join(tmpdir(), 'tenmol-home-'));
    tmpRoots.push(emptyHome);
    process.env.PLAYWRIGHT_BROWSERS_PATH = emptyBrowsers;
    process.env.HOME = emptyHome;
    // Precondition: the environment really has no cached shell.
    expect(findChrome()).toBeNull();
    await expect(startWebOnly()).rejects.toThrow(/chrome-headless-shell/);
  });
});
