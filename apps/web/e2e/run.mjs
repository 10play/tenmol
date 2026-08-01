#!/usr/bin/env node
/**
 * E2E runner — WP-27.
 *
 *   node apps/web/e2e/run.mjs [--loud] [-t <substring>]
 *
 * Boots ONE stack and runs every spec against it, because booting PyMOL costs
 * a few seconds and the specs do not need isolation from each other — each one
 * opens its own page and closes it.
 *
 * Exit 0 all passed, 1 any failure, 2 the stack could not start (missing venv,
 * no cached chromium). The two are distinguished so CI can tell "the product is
 * broken" from "this machine cannot run the suite".
 */

import { startStack } from './harness.mjs';
import { tests } from './smoke.e2e.mjs';

const argv = process.argv.slice(2);
const loud = argv.includes('--loud');
const filterAt = argv.indexOf('-t');
const filter = filterAt >= 0 ? argv[filterAt + 1] : null;

class AssertionFailure extends Error {}
const assert = (cond, message) => {
  if (!cond) throw new AssertionFailure(message);
};

const selected = filter ? tests.filter((t) => t.name.includes(filter)) : tests;
if (selected.length === 0) {
  console.error(`e2e: no test matches ${JSON.stringify(filter)}`);
  process.exit(1);
}

let stack;
try {
  process.stdout.write('e2e: booting bridge + vite… ');
  stack = await startStack({ quiet: !loud });
  console.log(`bridge:${stack.bridgePort} vite:${stack.vitePort}`);
} catch (e) {
  console.error(`\ne2e: could not start the stack — ${e.message}`);
  process.exit(2);
}

let failed = 0;
try {
  for (const t of selected) {
    const t0 = Date.now();
    let last;
    // ONE visible retry. Chromium's GPU process occasionally dies under
    // repeated page creation with swiftshader ("GPU process exited
    // unexpectedly"), which fails a spec that passes on its own. A real
    // regression reproduces and still goes red; a transient is marked
    // `(retried)` so it stays visible rather than being silently swallowed.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await t.fn({ stack, assert });
        const tag = attempt > 0 ? '  (retried)' : '';
        console.log(`  ok    ${t.name}  (${Date.now() - t0}ms)${tag}`);
        last = null;
        break;
      } catch (e) {
        last = e;
        // An assertion that failed is a real result; only retry infrastructure
        // errors, which is what a GPU crash surfaces as.
        if (e instanceof AssertionFailure) break;
      }
    }
    if (last) {
      failed++;
      const kind = last instanceof AssertionFailure ? 'FAIL' : 'ERROR';
      console.log(`  ${kind}  ${t.name}  (${Date.now() - t0}ms)`);
      console.log(`        ${last.message}`);
      if (loud && !(last instanceof AssertionFailure)) console.log(last.stack);
    }
  }
} finally {
  await stack.close();
}

console.log(`\ne2e: ${selected.length - failed}/${selected.length} passed`);
process.exit(failed ? 1 : 0);
