#!/usr/bin/env node
/**
 * The engine-parity gate — `pnpm parity:engine`.
 *
 * Runs the differential equivalence suite in `tools/parity`:
 *   * fixture gate      — the TypeScript engine vs. authoritative golden
 *                         snapshots (always);
 *   * generative gate   — determinism + invariants over random sequences;
 *   * contract gate     — both backends satisfy `Backend`;
 *   * live differential — TypeScript engine vs. real PyMOL, when a bridge URL is
 *                         provided (`--remote <ws>` or `TENMOL_PARITY_REMOTE`).
 *
 * Any divergence fails the process with a field-level diff (printed by the
 * vitest assertion). Regenerate the golden from real PyMOL with
 * `--remote <ws> --regen`.
 */

import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const env = { ...process.env };

const remoteIdx = args.indexOf('--remote');
if (remoteIdx >= 0) {
  const url = args[remoteIdx + 1];
  if (!url) {
    console.error('--remote requires a WebSocket URL, e.g. --remote ws://127.0.0.1:8765/ws');
    process.exit(2);
  }
  env.TENMOL_PARITY_REMOTE = url;
}
if (args.includes('--regen')) env.TENMOL_PARITY_REGEN = '1';

const result = spawnSync(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', 'tools/parity'],
  { stdio: 'inherit', env },
);

process.exit(result.status ?? 1);
