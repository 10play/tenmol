#!/usr/bin/env node
/**
 * The parity-coverage scoreboard — `pnpm coverage`.
 *
 * Prints command- and rep-coverage (the burndown for closing
 * `docs/engine-backlog.md` to 100% feature parity) and holds the ratchet floors
 * baked into `packages/engine-ts/test/coverage.test.ts`. It is a thin wrapper:
 * the measurement lives in that vitest test (which can introspect the live
 * engine registry), and this script just runs it — the same node→TS bridge
 * `scripts/parity-engine.mjs` uses.
 *
 *   pnpm coverage           # print the scoreboard + assert floors
 *   pnpm coverage --write   # also regenerate docs/parity-dashboard.md
 */

import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const env = { ...process.env };
if (args.includes('--write')) env.TENMOL_COVERAGE_WRITE = '1';
if (args.includes('--debug')) env.TENMOL_COVERAGE_DEBUG = '1';

const result = spawnSync(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', 'packages/engine-ts/test/coverage.test.ts'],
  { stdio: 'inherit', env },
);

process.exit(result.status ?? 1);
