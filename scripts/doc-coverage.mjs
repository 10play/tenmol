/**
 * Documentation-coverage scoreboard and ratchet gate.
 *
 *     node scripts/doc-coverage.mjs                       # print the scoreboard
 *     node scripts/doc-coverage.mjs --max-undocumented 900 # gate: fail if worse
 *     node scripts/doc-coverage.mjs --list                # also list what's missing
 *
 * This is the "is everything documented" gate, built in the same shape as
 * scripts/parity.mjs: it only PRINTS unless you pass a threshold, and the
 * threshold is a CEILING on the number of UNDOCUMENTED public symbols. That is
 * the ratchet — a newly added export or def with no doc comment raises the
 * count and fails CI, while the existing backlog (everything below the ceiling)
 * never blocks a merge. Lower the ceiling as the backlog is paid down.
 *
 * Two surfaces, one number:
 *   - TypeScript: exported declarations under each package's src/, counted with
 *     the TypeScript compiler API. A symbol is documented when a `/** ... *\/`
 *     block sits immediately above it.
 *   - Python: the bridge's public modules/classes/defs, via
 *     scripts/doc_coverage.py (stdlib ast, runs on the CI runner's python3).
 *
 * Generated code, type declarations and tests are out of scope on both sides.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

/** TypeScript source roots that make up the client's public API surface. */
const TS_ROOTS = [
  'packages/protocol/src',
  'packages/client/src',
  'packages/stores/src',
  'packages/viewport/src',
  'apps/web/src',
];

const PY_ROOTS = ['packages/bridge/tenmol_bridge'];

/** Paths that are never source we own: generated, declarations, tests. */
function skipTsFile(path) {
  return (
    /(^|\/)generated(\/|$)/.test(path) ||
    /\.d\.ts$/.test(path) ||
    /\.(test|spec)\.tsx?$/.test(path) ||
    /(^|\/)(__tests__|__mocks__|tests?|e2e)(\/)/.test(path)
  );
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/** True if a `/** ... *\/` block sits immediately above `node`. */
function hasJsDoc(text, node) {
  const ranges = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
  return ranges.some(
    (r) => r.kind === ts.SyntaxKind.MultiLineCommentTrivia && text.slice(r.pos, r.pos + 3) === '/**',
  );
}

function isExported(node) {
  return (node.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/** [total, documented, missing[]] for one TypeScript file. */
function scanTsFile(path) {
  const text = readFileSync(path, 'utf8');
  const kind = extname(path) === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);

  let total = 0;
  let documented = 0;
  const missing = [];
  const rel = relative(REPO, path);

  for (const stmt of sf.statements) {
    if (!isExported(stmt)) continue;

    /** @type {{name:string,line:number}[]} */
    let names = [];
    if (
      ts.isFunctionDeclaration(stmt) ||
      ts.isClassDeclaration(stmt) ||
      ts.isInterfaceDeclaration(stmt) ||
      ts.isTypeAliasDeclaration(stmt) ||
      ts.isEnumDeclaration(stmt)
    ) {
      if (stmt.name) {
        names = [{ name: stmt.name.text, line: pos(sf, stmt) }];
      }
    } else if (ts.isVariableStatement(stmt)) {
      names = stmt.declarationList.declarations
        .filter((d) => ts.isIdentifier(d.name))
        .map((d) => ({ name: d.name.text, line: pos(sf, stmt) }));
    } else {
      continue; // export {...}, export * from, etc. — re-exports need no doc
    }

    const documentedHere = hasJsDoc(text, stmt);
    for (const n of names) {
      total += 1;
      if (documentedHere) documented += 1;
      else missing.push(`${rel}:${n.line}: ${n.name}`);
    }
  }
  return [total, documented, missing];
}

function pos(sf, node) {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function scanTs() {
  const byRoot = [];
  const missing = [];
  let total = 0;
  let documented = 0;
  for (const root of TS_ROOTS) {
    const abs = join(REPO, root);
    let rt = 0;
    let rd = 0;
    for (const file of walk(abs)) {
      if (skipTsFile(file.replace(/\\/g, '/'))) continue;
      const [t, d, m] = scanTsFile(file);
      rt += t;
      rd += d;
      missing.push(...m);
    }
    byRoot.push({ root, total: rt, documented: rd });
    total += rt;
    documented += rd;
  }
  return { byRoot, total, documented, undocumented: total - documented, missing };
}

function scanPy() {
  try {
    const out = execFileSync('python3', [join(REPO, 'scripts', 'doc_coverage.py'), ...PY_ROOTS], {
      cwd: REPO,
      encoding: 'utf8',
    });
    return JSON.parse(out);
  } catch (err) {
    console.error('doc-coverage: python scan failed:', err.message);
    process.exit(2);
  }
}

function pct(d, t) {
  return t === 0 ? '100.0' : ((100 * d) / t).toFixed(1);
}

function main() {
  const argv = process.argv.slice(2);
  const list = argv.includes('--list');
  const maxIdx = argv.indexOf('--max-undocumented');
  const ceiling = maxIdx >= 0 ? Number(argv[maxIdx + 1]) : null;

  const tsr = scanTs();
  const pyr = scanPy();

  const total = tsr.total + pyr.total;
  const documented = tsr.documented + pyr.documented;
  const undocumented = total - documented;

  console.log('\ndoc coverage\n');
  for (const r of tsr.byRoot) {
    console.log(
      `  ${r.root.padEnd(28)} ${String(r.documented).padStart(4)}/${String(r.total).padStart(4)}  ${pct(r.documented, r.total)}%`,
    );
  }
  console.log(
    `  ${'packages/bridge (python)'.padEnd(28)} ${String(pyr.documented).padStart(4)}/${String(pyr.total).padStart(4)}  ${pct(pyr.documented, pyr.total)}%`,
  );
  console.log(
    `\n  total ${documented}/${total} documented (${pct(documented, total)}%), ${undocumented} undocumented\n`,
  );

  if (list) {
    for (const m of [...tsr.missing, ...pyr.missing]) console.log('  •', m);
    console.log('');
  }

  if (ceiling !== null) {
    if (Number.isNaN(ceiling)) {
      console.error('doc-coverage: --max-undocumented needs a number');
      return 2;
    }
    if (undocumented > ceiling) {
      console.error(
        `::error::doc coverage regressed: ${undocumented} undocumented public symbols, ceiling is ${ceiling}. ` +
          `Document the new symbol(s) — run with --list to see them.`,
      );
      return 1;
    }
    console.log(`doc-coverage OK: ${undocumented} undocumented <= ceiling ${ceiling}`);
  }
  return 0;
}

process.exit(main());
