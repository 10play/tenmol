#!/usr/bin/env node
/**
 * Assert that the web suite actually RAN, not merely that it did not fail.
 *
 * THE HOLE THIS CLOSES, measured rather than argued:
 *
 *     $ pnpm exec vitest run --passWithNoTests zzz-no-such-test
 *     No test files found, exiting with code 0
 *     EXIT=0
 *
 * `pnpm test` is `vitest run --passWithNoTests`, and `vitest.workspace.ts` sets
 * `passWithNoTests: true` in both projects. Its include glob is exactly two
 * path levels (see `vitest.workspace.ts`) and this repo
 * was reorganised into that shape recently enough that another move is
 * plausible. One rename of `apps/`, or one package nested a level deeper, and
 * all 1,900+ tests stop being collected while CI stays green. That failure is
 * silent, permanent and points the wrong way: it reads as "everything passes".
 *
 * pytest and the e2e runner do not need this. `pytest` exits 5 when it collects
 * nothing, and `apps/web/e2e/run.mjs` exits 1 when `-t` matches no spec — both
 * already fail loudly.
 *
 * WHY A FLOOR AND NOT AN EXACT COUNT. An exact count is a chore that fails on
 * every honest new test, so it gets bumped without thought and stops meaning
 * anything. A floor only moves when someone deletes coverage, which is exactly
 * the event worth a red build. Raise it deliberately when the suite grows.
 *
 * Usage:  node scripts/test-floor.mjs [--floor N] [--json <file>]
 *         (with no --json it runs vitest itself)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The floor. 1,906 tests pass today across 161 files; 1,800 leaves room for a
 * genuine consolidation without leaving room for a glob that silently matches
 * nothing.
 */
const DEFAULT_FLOOR = 1800;
/** Files, too: a single mega-file passing the count floor is still a red flag. */
const DEFAULT_FILE_FLOOR = 150;

const argv = process.argv.slice(2);
const at = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const floor = Number(at('--floor') ?? DEFAULT_FLOOR);
const fileFloor = Number(at('--file-floor') ?? DEFAULT_FILE_FLOOR);

let report;
let scratch;
try {
  const given = at('--json');
  if (given) {
    report = JSON.parse(readFileSync(given, 'utf8'));
  } else {
    scratch = mkdtempSync(join(tmpdir(), 'tenmol-testfloor-'));
    const out = join(scratch, 'vitest.json');
    // `--reporter=json` needs an outputFile or it interleaves with test stdout
    // and the parse fails for a reason that looks nothing like the real one.
    execFileSync(
      'pnpm',
      ['exec', 'vitest', 'run', '--reporter=json', '--outputFile', out],
      { cwd: REPO, stdio: ['ignore', 'inherit', 'inherit'] },
    );
    report = JSON.parse(readFileSync(out, 'utf8'));
  }
} catch (err) {
  // A non-zero vitest exit is a real test failure; it has already printed.
  console.error(`test-floor: vitest failed (${err.status ?? err.message})`);
  process.exit(err.status ?? 1);
} finally {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
}

const total = report.numTotalTests ?? 0;
const passed = report.numPassedTests ?? 0;
// `testResults` is one entry per FILE. `numTotalTestSuites` counts `describe`
// blocks (676 today vs 161 files), which is not the number worth guarding.
const files = report.testResults?.length ?? 0;

const problems = [];
if (total < floor) problems.push(`collected ${total} tests, floor is ${floor}`);
if (files < fileFloor) problems.push(`collected ${files} test files, floor is ${fileFloor}`);
if (report.numFailedTests > 0) problems.push(`${report.numFailedTests} tests failed`);

if (problems.length > 0) {
  console.error('\ntest-floor: FAILED');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    '\nIf this is a deliberate reduction, lower the floor in scripts/test-floor.mjs\n' +
      'in the same commit, so the reduction is reviewable. If it is not, the\n' +
      'include glob in vitest.workspace.ts has probably stopped matching:\n' +
      "  include: '{packages,apps,tools}/*/{src,test,tests}/**'\n",
  );
  process.exit(1);
}

console.log(`test-floor: ${passed}/${total} tests in ${files} files (floor ${floor}/${fileFloor}) OK`);
