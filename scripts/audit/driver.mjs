/**
 * Deterministic UI-audit driver.
 *
 * The whole point of this file: turn a declarative TestSpec (see schema.md) into
 * a repeatable PASS / FAIL / BLOCKED verdict backed by captured evidence, with
 * ZERO per-run judgement. Same spec + same source tree -> same verdict. The
 * agents in the audit workflow WRITE specs and JUDGE screenshots; they do not
 * drive the browser by hand (that is what made past passes non-reproducible).
 *
 * A stack is `startWebOnly` from the e2e harness: vite + a headless browser on
 * free ports, the in-browser TS engine (`?backend=local`), no bridge, no shared
 * global state. That is what makes N of these safe to run in PARALLEL — each
 * shard boots its own.
 */

/*
 * The `document` reference below is inside a `page.evaluate()` callback that is
 * serialised and run in the BROWSER, so it legitimately uses `document` even
 * though this file executes under node — same convention as apps/web/e2e.
 */
/* global document */
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { startWebOnly, openApp, REPO } from '../../apps/web/e2e/harness.mjs';

const CMDLINE = 'input.cmdline__input';
const ACTION_TIMEOUT = 6000;

/** Boot one isolated stack (vite + browser, local engine). Caller closes it. */
export async function bootStack() {
  return startWebOnly({ quiet: true });
}

/** A fresh page with error/console/network capture wired in. */
export async function newAuditPage(stack) {
  const page = await openApp(stack, { query: '?backend=local' });
  const consoleErrors = [];
  const netFailures = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300));
  });
  page.on('requestfailed', (r) => netFailures.push(`${r.method()} ${r.url()} ${r.failure()?.errorText ?? ''}`.slice(0, 300)));
  page.on('response', (r) => {
    if (r.status() >= 400) netFailures.push(`${r.status()} ${r.url()}`.slice(0, 300));
  });
  page.__consoleErrors = consoleErrors;
  page.__netFailures = netFailures;
  await page.waitForSelector(CMDLINE, { timeout: 30000 });
  // The local engine ships 1crn preloaded, so reps/colour/selection specs have
  // a real object to act on. Do NOT `delete all` first — that would leave the
  // app empty if the box were offline. Just settle on a known representation.
  await page.waitForTimeout(1200);
  await runCmd(page, 'hide everything');
  await runCmd(page, 'show cartoon');
  await page.waitForTimeout(400);
  return page;
}

async function runCmd(page, text) {
  await page.fill(CMDLINE, text);
  await page.press(CMDLINE, 'Enter');
  await page.waitForTimeout(250);
}

/** Reset to a known baseline between specs (cheap; no reload). */
export async function resetApp(page) {
  await runCmd(page, 'hide everything').catch(() => {});
  await runCmd(page, 'show cartoon').catch(() => {});
  // Close any stray overlay/menu by pressing Escape a couple of times.
  await page.keyboard.press('Escape').catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  // Normalise the Ray/Draw dialog to a known state (collapsed, on the setup
  // page). The render feature keeps its own component state across specs — a
  // Draw/Ray leaves the dialog EXPANDED on the RESULT page — so without this the
  // next spec's `.render__tab` click would time out (the tab only exists while
  // the dialog is collapsed). Guarded by `isVisible`, so this is a fast no-op in
  // every shard that never opens the dialog.
  if (await page.locator('.render__path').first().isVisible().catch(() => false)) {
    // On the result page: `< Back` returns to the setup page (the only button
    // in `.render__actions` there).
    await page.locator('.render__actions .render__btn').first().click({ timeout: 1000 }).catch(() => {});
  }
  if (await page.locator('.render__collapse').first().isVisible().catch(() => false)) {
    await page.locator('.render__collapse').first().click({ timeout: 1000 }).catch(() => {});
  }
}

async function bodyText(page) {
  try {
    return (await page.evaluate(() => document.body.innerText)) ?? '';
  } catch {
    return '';
  }
}

async function canvasHash(page) {
  try {
    const el = await page.$('canvas');
    if (!el) return 'no-canvas';
    const bb = await el.boundingBox();
    if (!bb) return 'no-bbox';
    // Clip a PAGE screenshot to the canvas box: this goes through the
    // compositor and reliably captures the WebGL surface, whereas an element
    // screenshot of a non-preserveDrawingBuffer canvas can come back blank.
    const buf = await page.screenshot({ clip: bb, timeout: ACTION_TIMEOUT });
    return createHash('sha1').update(buf).digest('hex');
  } catch {
    return 'err';
  }
}

/** ---- action primitives (the trigger/setup mini-DSL) ---- */
async function doAction(page, a) {
  switch (a.do) {
    case 'cmd':
      await runCmd(page, a.text);
      return;
    case 'click':
      await page.locator(a.selector).nth(a.nth ?? 0).click({ timeout: ACTION_TIMEOUT });
      return;
    case 'type':
      await page.locator(a.selector).nth(a.nth ?? 0).fill(a.text, { timeout: ACTION_TIMEOUT });
      return;
    case 'press':
      if (a.selector) await page.locator(a.selector).nth(a.nth ?? 0).press(a.key, { timeout: ACTION_TIMEOUT });
      else await page.keyboard.press(a.key);
      return;
    case 'hover':
      await page.locator(a.selector).nth(a.nth ?? 0).hover({ timeout: ACTION_TIMEOUT });
      return;
    case 'wait':
      await page.waitForTimeout(a.ms ?? 300);
      return;
    case 'waitFor':
      await page.waitForSelector(a.selector, { timeout: a.ms ?? ACTION_TIMEOUT });
      return;
    case 'menu':
      await openMenuPath(page, a.path);
      return;
    default:
      throw new Error(`unknown action: ${a.do}`);
  }
}

/**
 * Open a menu-bar path like ["Display","Sequence","On"]. Returns {blocked} when
 * the leaf renders `is-disabled` (an intentionally unbuilt/blocked leaf, which
 * the audit records as BLOCKED rather than FAIL).
 */
export async function openMenuPath(page, path) {
  const [top, ...rest] = path;
  await page.locator('.menubar__menus .menubar__item-wrap button', { hasText: top }).first().click({ timeout: ACTION_TIMEOUT });
  await page.waitForSelector('.menu[role="menu"]', { timeout: ACTION_TIMEOUT });
  for (let i = 0; i < rest.length; i++) {
    const label = rest[i];
    const isLeaf = i === rest.length - 1;
    const row = page.locator('.menu__row', { has: page.locator('.menu__label', { hasText: label }) }).first();
    await row.waitFor({ timeout: ACTION_TIMEOUT });
    const disabled = (await row.getAttribute('class'))?.includes('is-disabled');
    if (isLeaf && disabled) return { blocked: true };
    await row.click({ timeout: ACTION_TIMEOUT });
    if (!isLeaf) await page.waitForTimeout(150);
  }
  return { blocked: false };
}

/** ---- checks ---- */
async function evalCheck(page, c, before, after) {
  switch (c.expect) {
    case 'noPageError':
      return { ok: after.pageErrors.length === before.pageErrors, detail: after.pageErrors.slice(before.pageErrors) };
    case 'noConsoleError':
      return { ok: after.consoleErrors.length === before.consoleErrors, detail: page.__consoleErrors.slice(before.consoleErrors) };
    case 'noNetFailure':
      return { ok: page.__netFailures.length === before.netFailures, detail: page.__netFailures.slice(before.netFailures) };
    case 'feedbackMatches': {
      const ok = new RegExp(c.pattern, 'i').test(after.body);
      return { ok, detail: ok ? '' : `pattern /${c.pattern}/ not found` };
    }
    case 'feedbackNotMatches': {
      const bad = new RegExp(c.pattern, 'i');
      // only consider text that APPEARED after the trigger
      const added = after.body.slice(Math.max(0, before.bodyLen - 200));
      const ok = !bad.test(added);
      return { ok, detail: ok ? '' : `forbidden /${c.pattern}/ present` };
    }
    case 'selectorVisible': {
      const ok = await page.locator(c.selector).first().isVisible().catch(() => false);
      return { ok, detail: ok ? '' : `${c.selector} not visible` };
    }
    case 'selectorHidden': {
      const vis = await page.locator(c.selector).first().isVisible().catch(() => false);
      return { ok: !vis, detail: vis ? `${c.selector} still visible` : '' };
    }
    case 'domChanged':
      return { ok: after.body !== before.body || after.canvas !== before.canvas, detail: 'no DOM/canvas change' };
    case 'screenshotChanged':
      return { ok: after.canvas !== before.canvas, detail: after.canvas === before.canvas ? 'viewport unchanged' : '' };
    default:
      return { ok: false, detail: `unknown check ${c.expect}` };
  }
}

/**
 * Run one spec end-to-end. Returns a verdict object with evidence and a
 * screenshot path. `caps` is the capability set; a spec whose `requires` is not
 * a subset is returned BLOCKED without being driven.
 */
export async function runSpec(page, spec, { caps = new Set(), shotDir } = {}) {
  const missing = (spec.requires ?? []).filter((r) => !caps.has(r));
  if (missing.length) {
    return { id: spec.id, verdict: 'BLOCKED', reason: `requires ${missing.join(',')}`, checks: [], evidence: {} };
  }

  const evidence = { pageErrors: [], consoleErrors: [], netFailures: [] };
  try {
    await resetApp(page);
    for (const a of spec.setup ?? []) await doAction(page, a);

    const before = {
      pageErrors: page.__errors.length,
      consoleErrors: page.__consoleErrors.length,
      netFailures: page.__netFailures.length,
      body: await bodyText(page),
      canvas: await canvasHash(page),
    };
    before.bodyLen = before.body.length;

    let menuBlocked = false;
    for (const a of spec.trigger ?? []) {
      const r = await doAction(page, a);
      if (r?.blocked) menuBlocked = true;
    }
    await page.waitForTimeout(spec.settleMs ?? 400);

    if (menuBlocked) {
      return { id: spec.id, verdict: 'BLOCKED', reason: 'menu leaf disabled (intentionally unbuilt)', checks: [], evidence };
    }

    const after = {
      pageErrors: page.__errors,
      consoleErrors: page.__consoleErrors,
      netFailures: page.__netFailures,
      body: await bodyText(page),
      canvas: await canvasHash(page),
    };

    // Baseline check applied to EVERY spec unless it opts out: a control that
    // throws is broken regardless of what the spec author remembered to assert.
    const checks = [...(spec.checks ?? [])];
    if (!spec.allowPageError) checks.unshift({ expect: 'noPageError' });

    const results = [];
    for (const c of checks) {
      const r = await evalCheck(page, c, before, after);
      results.push({ expect: c.expect, pattern: c.pattern, selector: c.selector, ok: r.ok, detail: r.detail });
    }

    let shot = '';
    if (shotDir) {
      mkdirSync(shotDir, { recursive: true });
      shot = join(shotDir, `${spec.id.replace(/[^a-z0-9._-]/gi, '_')}.png`);
      await page.screenshot({ path: shot }).catch(() => {});
    }

    const failed = results.filter((r) => !r.ok);
    evidence.pageErrors = after.pageErrors.slice(before.pageErrors);
    evidence.consoleErrors = after.consoleErrors.slice(before.consoleErrors);
    evidence.netFailures = after.netFailures.slice(before.netFailures);
    return {
      id: spec.id,
      verdict: failed.length ? 'FAIL' : 'PASS',
      reason: failed.map((f) => `${f.expect}: ${JSON.stringify(f.detail)}`).join('; '),
      checks: results,
      evidence,
      screenshot: shot,
      needsVisual: !!spec.needsVisual,
      note: spec.note ?? '',
    };
  } catch (e) {
    return { id: spec.id, verdict: 'FAIL', reason: `driver error: ${String(e).slice(0, 300)}`, checks: [], evidence, error: true };
  }
}

export { REPO };
