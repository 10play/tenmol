/**
 * Exhaustive "unsupported surface" probe for the browser-only build.
 *
 *   node scripts/audit/unsupported-probe.mjs [out.md]
 *
 * Boots one isolated stack (vite + headless chrome, in-browser engine via
 * `?backend=local`), then systematically exercises every surface a user can
 * reach and captures any VISIBLE text (console feedback + inline panel text)
 * matching /not ported|unavailable|not supported|service unavailable/i, with the
 * DOM node it came from so each hit maps to a concrete affordance.
 *
 * Deterministic and read-only w.r.t. the repo. Writes a markdown report.
 */
/* global document, NodeFilter */
import { writeFileSync } from 'node:fs';
import { startWebOnly, openApp } from '../../apps/web/e2e/harness.mjs';

const OUT = process.argv[2] ?? '/tmp/unsupported-probe.md';
const RE = 'not ported|unavailable|not supported|service unavailable';
const CMDLINE = 'input.cmdline__input';

/** Scan the live DOM for visible text matching RE; return {text, where} hits. */
async function scan(page, label) {
  return page.evaluate(
    ({ re, label }) => {
      const rx = new RegExp(re, 'i');
      const hits = [];
      const seen = new Set();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        const t = (n.textContent ?? '').trim();
        if (!t || !rx.test(t) || seen.has(t)) continue;
        // Only VISIBLE text.
        const el = n.parentElement;
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        seen.add(t);
        // Nearest class for attribution.
        let cls = '';
        for (let e = el; e && !cls; e = e.parentElement) if (e.className && typeof e.className === 'string') cls = e.className.split(/\s+/)[0];
        hits.push({ text: t.slice(0, 180), where: cls, label });
      }
      return hits;
    },
    { re: RE, label },
  );
}

async function run(page, text) {
  await page.fill(CMDLINE, text);
  await page.press(CMDLINE, 'Enter');
  await page.waitForTimeout(300);
}

const findings = [];
function add(hits) {
  for (const h of hits) findings.push(h);
}

async function main() {
  const stack = await startWebOnly({ quiet: true });
  const report = [];
  try {
    const page = await openApp(stack, { query: '?backend=local' });
    await page.waitForSelector(CMDLINE, { timeout: 30000 });
    await page.waitForTimeout(3500); // demo + panel bootstraps settle

    /* ---- 0. Always-mounted (internal-gui: objects/movie/scenes/wizards) ---- */
    add(await scan(page, 'always-mounted (internal-gui + shell)'));

    /* ---- 1. Overlay launcher panels ---- */
    const launchers = await page.$$eval('.overlay-launcher__btn', (els) =>
      els.map((e) => e.getAttribute('title') ?? e.textContent ?? ''),
    );
    report.push(`Launcher buttons: ${launchers.join(', ')}`);
    for (const title of launchers) {
      const btn = page.locator(`.overlay-launcher__btn[title="${title}"]`).first();
      if (!(await btn.count())) continue;
      await btn.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1000);

      if (title === 'Settings') {
        for (const sub of ['Setting', 'Edit All…', 'Lighting']) {
          const sb = page.locator('button', { hasText: sub }).first();
          if (await sb.count()) {
            await sb.click({ timeout: 3000 }).catch(() => {});
            await page.waitForTimeout(800);
            add(await scan(page, `Settings ▸ ${sub}`));
          }
        }
      }
      if (title === 'Compute') {
        // Press every metric button (some throw NotPorted in local).
        const btns = await page.$$('.compute__btn');
        for (let i = 0; i < btns.length; i++) {
          await btns[i].click({ timeout: 2000 }).catch(() => {});
          await page.waitForTimeout(120);
          // dismiss any confirm dialog by clicking the danger confirm
          const conf = page.locator('.compute__confirm .is-danger').first();
          if (await conf.isVisible().catch(() => false)) {
            await conf.click({ timeout: 1500 }).catch(() => {});
            await page.waitForTimeout(200);
          }
        }
        await page.waitForTimeout(400);
      }
      add(await scan(page, `overlay: ${title}`));
      await btn.click({ timeout: 5000 }).catch(() => {}); // close
      await page.waitForTimeout(250);
    }

    /* ---- 2. Properties with a picked atom ---- */
    await run(page, 'edit (first name CA)');
    const propBtn = page.locator('.overlay-launcher__btn[title="Properties"]').first();
    if (await propBtn.count()) {
      await propBtn.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1200);
      add(await scan(page, 'Properties (picked atom)'));
      await propBtn.click({ timeout: 5000 }).catch(() => {});
    }

    /* ---- 3. Sequence viewer ---- */
    await run(page, 'set seq_view, 1');
    await page.waitForTimeout(1500);
    add(await scan(page, 'seqview (set seq_view,1)'));
    await run(page, 'set seq_view, 0');

    /* ---- 4. Menus ---- */
    const tops = await page.$$eval('.menubar__menus .menubar__item-wrap > button', (els) =>
      els.map((e) => e.textContent?.trim() ?? ''),
    );
    report.push(`Top-level menus: ${tops.join(', ')}`);
    const disabledLeaves = [];
    for (const top of tops) {
      const openBtn = page.locator('.menubar__menus .menubar__item-wrap button', { hasText: top }).first();
      await openBtn.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(250);
      await expandAll(page);
      // recent files / dynamic lists may resolve async
      await page.waitForTimeout(500);
      add(await scan(page, `menu: ${top} (open)`));
      const rows = await page.$$eval('.menu[role="menu"] .menu__row.is-disabled', (els) =>
        els.map((e) => ({
          label: e.querySelector('.menu__label')?.textContent?.trim() ?? '',
          title: e.getAttribute('title') ?? '',
        })),
      );
      for (const r of rows) disabledLeaves.push({ top, ...r });
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(150);
    }
    report.push(`\nDisabled menu leaves (${disabledLeaves.length}):`);
    for (const l of disabledLeaves) report.push(`  [${l.top}] ${l.label} — ${l.title}`);

    /* ---- 5. Menu leaves that only ERROR on click (call fns) + Open Recent ---- */
    // Open Recent (dynamic): hover it open and let the recent fetch resolve.
    await page.locator('.menubar__menus .menubar__item-wrap button', { hasText: 'File' }).first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(200);
    const rec = page.locator('.menu__row--sub', { has: page.locator('.menu__label', { hasText: 'Open Recent' }) }).first();
    if (await rec.count()) {
      await rec.hover({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(1200);
      add(await scan(page, 'menu: File ▸ Open Recent'));
    }
    await page.keyboard.press('Escape').catch(() => {});

    // Setting ▸ Rendering ▸ Modernize, and ▸ Shadows ▸ … — `call` fns that throw
    // NotPorted in local; the error lands in the console feedback pane. Leaves
    // are addressed by their UNIQUE title (the described call), because the label
    // "Modernize" appears in more than one place.
    for (const title of ['cmd.util.modernize_rendering(1)', 'cmd.util.ray_shadows("none")']) {
      await page.locator('.menubar__menus .menubar__item-wrap button', { hasText: 'Setting' }).first().click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(200);
      const rend = page.locator('.menu__row--sub', { has: page.locator('.menu__label', { hasText: 'Rendering' }) }).first();
      if (await rend.count()) await rend.hover({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(250);
      // Shadows leaves live one level deeper.
      const shad = page.locator('.menu__row--sub', { has: page.locator('.menu__label', { hasText: 'Shadows' }) }).first();
      if (title.includes('ray_shadows') && (await shad.count())) await shad.hover({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(250);
      const leaf = page.getByTitle(title, { exact: true }).first();
      if (await leaf.count()) {
        await leaf.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(500);
        add(await scan(page, `menu click: ${title} (console)`));
      } else {
        report.push(`  (menu leaf "${title}" is ABSENT — gated)`);
      }
      await page.keyboard.press('Escape').catch(() => {});
    }

    /* ---- report ---- */
    report.unshift('# Unsupported-surface probe (backend=local)\n');
    report.push(`\n## Regex hits (${findings.length})`);
    const byText = new Map();
    for (const f of findings) {
      const key = f.text;
      if (!byText.has(key)) byText.set(key, new Set());
      byText.get(key).add(`${f.label} [.${f.where}]`);
    }
    for (const [text, locs] of byText) {
      report.push(`- \`${text}\`\n  - seen in: ${[...locs].join('; ')}`);
    }
  } finally {
    await stack.close();
  }
  const text = report.join('\n');
  writeFileSync(OUT, text);
  console.log(text);
  console.log(`\n[probe] ${findings.length} regex hits (${new Set(findings.map((f) => f.text)).size} distinct) -> ${OUT}`);
}

async function expandAll(page) {
  for (let pass = 0; pass < 5; pass++) {
    const subs = await page.$$('.menu[role="menu"] .menu__row--sub:not(.is-open)');
    if (subs.length === 0) break;
    for (const s of subs) {
      await s.hover({ timeout: 1200 }).catch(() => {});
      await page.waitForTimeout(110);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
