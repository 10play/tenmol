#!/usr/bin/env node
/**
 * tenmol parity coverage (WP-00 (f) STUB).
 *
 * docs/feature-parity.md is the definition of done: 365 rows,
 * every one carrying a checkbox in the first table cell. This reads those
 * checkboxes and reports coverage per area.
 *
 * This is deliberately a stub. WP-27 owns `tools/parity/**` and replaces it
 * with the real harness (feature matrix + command-trace equivalence +
 * state-snapshot equivalence + visual parity). What is implemented here and
 * must survive that rewrite:
 *
 *   - escaped pipes: cells contain `\|` (critique C3, e.g. inventory lines
 *     55/59/98). A naive split('|') mis-columns dozens of rows.
 *   - `[ ]` unchecked, `[x]` done, `[~]` partial, `[-]` not applicable.
 *
 * Usage:
 *   pnpm parity                 human table
 *   pnpm parity --json          machine readable
 *   pnpm parity --min 100       exit 1 if fewer than N rows are checked
 *   pnpm parity --list-open     print every unchecked feature title
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The repo root: `scripts/` sits directly under it.
const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const INVENTORY = join(REPO, 'docs', 'feature-parity.md');

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const LIST_OPEN = argv.includes('--list-open');
const MIN = (() => {
  const i = argv.indexOf('--min');
  return i >= 0 ? Number(argv[i + 1]) : 0;
})();

/**
 * Split a markdown table row on unescaped pipes (C3).
 * @param {string} line
 * @returns {string[]}
 */
export function splitRow(line) {
  /** @type {string[]} */
  const cells = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\' && line[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (c === '|') {
      cells.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  cells.push(cur);
  // A markdown row starts and ends with a pipe -> drop the empty edges.
  if (cells[0].trim() === '') cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map((c) => c.trim());
}

const STATE = { ' ': 'open', x: 'done', X: 'done', '~': 'partial', '-': 'n/a' };

const text = readFileSync(INVENTORY, 'utf8');
const lines = text.split('\n');

let area = '(preamble)';
/** @type {{area:string,state:string,title:string,line:number}[]} */
const rows = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const h = /^##\s+(.*)$/.exec(line);
  if (h) {
    area = h[1].trim();
    continue;
  }
  if (!line.startsWith('|')) continue;
  const cells = splitRow(line);
  const m = /^\[([ xX~-])\]$/.exec(cells[0] ?? '');
  if (!m) continue;
  const title = (cells[1] ?? '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .split(' — ')[0]
    .split(' -- ')[0]
    .trim();
  rows.push({ area, state: STATE[m[1]], title, line: i + 1 });
}

/** @type {Map<string,{done:number,partial:number,open:number,na:number,total:number}>} */
const byArea = new Map();
for (const r of rows) {
  const e = byArea.get(r.area) ?? { done: 0, partial: 0, open: 0, na: 0, total: 0 };
  if (r.state === 'done') e.done++;
  else if (r.state === 'partial') e.partial++;
  else if (r.state === 'n/a') e.na++;
  else e.open++;
  e.total++;
  byArea.set(r.area, e);
}

const totals = { done: 0, partial: 0, open: 0, na: 0, total: rows.length };
for (const e of byArea.values()) {
  totals.done += e.done;
  totals.partial += e.partial;
  totals.open += e.open;
  totals.na += e.na;
}

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        inventory: 'docs/feature-parity.md',
        totals,
        areas: [...byArea].map(([a, e]) => ({ area: a, ...e })),
      },
      null,
      2,
    ),
  );
} else if (LIST_OPEN) {
  for (const r of rows.filter((x) => x.state === 'open')) {
    console.log(`${String(r.line).padStart(6)}  ${r.area.slice(0, 28).padEnd(28)}  ${r.title}`);
  }
} else {
  const width = Math.max(...[...byArea.keys()].map((a) => a.length), 10);
  console.log('\nparity coverage  (docs/feature-parity.md)\n');
  console.log(`  ${'area'.padEnd(width)}  done  part  open   n/a  total`);
  for (const [a, e] of byArea) {
    console.log(
      `  ${a.padEnd(width)}  ${String(e.done).padStart(4)}  ${String(e.partial).padStart(4)}  ` +
        `${String(e.open).padStart(4)}  ${String(e.na).padStart(4)}  ${String(e.total).padStart(5)}`,
    );
  }
  const pct = totals.total ? ((100 * totals.done) / totals.total).toFixed(1) : '0.0';
  console.log(`\n  ${totals.done}/${totals.total} rows checked (${pct} %)\n`);
  console.log('  NOTE: this is the WP-00 stub. WP-27 owns tools/parity/** and the real gates.\n');
}

if (MIN && totals.done < MIN) {
  console.error(`parity: only ${totals.done} rows checked, --min ${MIN} required`);
  process.exit(1);
}
