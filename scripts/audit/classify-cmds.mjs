/**
 * Classify which commands behind UI affordances throw NotPorted in the
 * browser-only build. Read-only against the repo; disposable session.
 *
 *   node scripts/audit/classify-cmds.mjs
 *
 * For each candidate `cmd.*` symbol it calls the LOCAL engine directly
 * (`window.__tenmol.conn.call`) with no args and records whether the rejection
 * is NotPorted (the engine throws before executing when there is no handler, so
 * an unported symbol is detected without side effect) vs some other outcome.
 */
/* global window */
import { readFileSync } from 'node:fs';
import { startWebOnly, openApp } from '../../apps/web/e2e/harness.mjs';

const CMDLINE = 'input.cmdline__input';

// Every `call` fn the menu tree uses (from generated/menudata.ts), plus the
// panel/bridge symbols each overlay/feature relies on.
const menudata = readFileSync(
  new URL('../../apps/web/src/features/menubar/generated/menudata.ts', import.meta.url),
  'utf8',
);
const menuFns = [...new Set([...menudata.matchAll(/"fn":\s*"([^"]+)"/g)].map((m) => m[1]))];

const panelFns = [
  'tenmol_menus', // menu recent / settings feed
  'cmd.tenmol_seqview', // sequence viewer
  'setting.tenmol_settings_status', // settings catalogue
  'setting.tenmol_settings_catalogue',
  'cmd.tenmol_compute.hello', // compute SASA shim
  'util.get_area',
  'util.get_sasa',
  'util.compute_mass',
  'util.sum_formal_charges',
  'util.protein_vacuum_esp',
  'plugins.initialize', // plugin manager scan
  'cmd.get_names', // control (known ported)
];

const candidates = [...new Set([...menuFns, ...panelFns])];

async function main() {
  const stack = await startWebOnly({ quiet: true });
  try {
    const page = await openApp(stack, { query: '?backend=local' });
    await page.waitForSelector(CMDLINE, { timeout: 30000 });
    await page.waitForTimeout(2000);

    const results = await page.evaluate(async (fns) => {
      const conn = window.__tenmol?.conn;
      const out = [];
      for (const fn of fns) {
        try {
          await conn.call(fn, [], {});
          out.push({ fn, verdict: 'ok' });
        } catch (e) {
          const msg = String((e && e.message) || e);
          const type = e && e.type;
          out.push({
            fn,
            verdict: /not ported/i.test(msg) ? 'NOT_PORTED' : type || 'error',
            msg: msg.slice(0, 100),
          });
        }
      }
      return out;
    }, candidates);

    const notPorted = results.filter((r) => r.verdict === 'NOT_PORTED').map((r) => r.fn);
    const other = results.filter((r) => r.verdict !== 'NOT_PORTED');
    console.log('=== NOT PORTED (throws "not ported") ===');
    for (const fn of notPorted) console.log('  ' + fn);
    console.log('\n=== ported / other error (safe) ===');
    for (const r of other) console.log(`  ${r.fn}  [${r.verdict}] ${r.msg ?? ''}`);
    console.log(`\nTOTAL: ${notPorted.length} not-ported of ${results.length}`);
  } finally {
    await stack.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
