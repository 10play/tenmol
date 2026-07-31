#!/usr/bin/env node
/**
 * tenmol ownership lint (WP-00 (f) stub; WP-27 owns the CI-grade version).
 *
 * docs/webclient/03-implementation-plan.md section 6 is the machine-readable
 * source of truth for file ownership: every work package lists the paths it
 * owns exclusively, and "a WP that needs a change elsewhere reports it, it does
 * not make it" (section 5.1, rule 1). This script parses that section and fails
 * when a changed file is not owned by the committing WP.
 *
 * Usage:
 *   pnpm ownership --wp WP-00                 # check the working tree + index
 *   pnpm ownership --wp WP-00 --base master   # check a branch's diff
 *   pnpm ownership --wp WP-00 -- path [...]   # check explicit paths
 *   pnpm ownership --who packages/ui/src/x.ts # who owns this path?
 *   pnpm ownership --list WP-09               # what does this WP own?
 *
 * The WP defaults to $TENMOL_WP, else it is inferred from the branch name
 * (e.g. `wp-09-viewport` -> WP-09).
 *
 * Exit 0 = clean, 1 = violation, 2 = usage error.
 *
 * Deliberately dependency-free: it runs before `pnpm install` has to have
 * succeeded.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const PLAN = join(REPO, 'docs', 'webclient', '03-implementation-plan.md');

// ---------------------------------------------------------------------------
// argv
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (name) => argv.includes(name);
const explicitPaths = argv.includes('--')
  ? argv.slice(argv.indexOf('--') + 1)
  : argv.filter((a) => !a.startsWith('-') && !isOptValue(a));

function isOptValue(a) {
  const i = argv.indexOf(a);
  return i > 0 && ['--wp', '--base', '--who', '--list'].includes(argv[i - 1]);
}

// ---------------------------------------------------------------------------
// plan parsing
// ---------------------------------------------------------------------------
/**
 * Owned patterns for one work package.
 * @typedef {{wp:string,title:string,include:string[],exclude:string[]}} Pkg
 */

/** Strip markdown noise from a fragment that should be a path. */
function cleanToken(tok) {
  return tok
    .replace(/`/g, '')
    .replace(/\*\*/g, '')
    .replace(/[,;]+$/, '')
    .replace(/^\(|\)$/g, '')
    .trim();
}

/** A token is a path if it looks like one and not like prose. */
function looksLikePath(tok) {
  if (!tok || tok.length < 3) return false;
  if (/\s/.test(tok)) return false;
  if (/^[A-Z]/.test(tok) && !tok.includes('/') && !tok.includes('.')) return false;
  return /[/.]/.test(tok) && /^[\w@.*{}![\]/-]+$/.test(tok);
}

/** Expand `a/{b,c}/d` into `a/b/d`, `a/c/d`. */
function expandBraces(pattern) {
  const m = /\{([^{}]*)\}/.exec(pattern);
  if (!m) return [pattern];
  const [whole, body] = m;
  return body
    .split(',')
    .map((alt) => pattern.replace(whole, alt.trim()))
    .flatMap(expandBraces);
}

/**
 * Resolve an EXCEPT clause against the positive pattern it qualifies.
 * `packages/viewport/src/**  EXCEPT src/input/**` -> `packages/viewport/src/input/**`
 * `packages/ui/src/**  EXCEPT packages/ui/src/menu/**` -> unchanged.
 */
const TOP_DIRS = [
  'packages/',
  'apps/',
  'bridge/',
  'tools/',
  'scripts/',
  'docs/',
  'layer4/',
  '.github/',
];
function resolveExcept(base, tok) {
  if (TOP_DIRS.some((d) => tok.startsWith(d))) return tok;
  // base is like `packages/viewport/src/**`; the except is relative to the
  // package root (`packages/viewport/`).
  const stripped = base.replace(/\/\*\*$/, '');
  const firstSeg = tok.split('/')[0];
  const idx = stripped.lastIndexOf(`/${firstSeg}`);
  const root = idx > 0 ? stripped.slice(0, idx + 1) : `${stripped}/`;
  return root + tok;
}

/** @returns {Pkg[]} */
function parsePlan() {
  const text = readFileSync(PLAN, 'utf8');
  const lines = text.split('\n');
  /** @type {Pkg[]} */
  const pkgs = [];
  /** @type {Pkg|null} */
  let cur = null;
  let inOwns = false;
  let inFence = false;

  const pushTokens = (line) => {
    if (!cur) return;
    // `EXCEPT` splits a line into includes and excludes.
    const parts = line.split(/\bEXCEPT\b/);
    const collect = (chunk, sink) => {
      // The plan writes `packages/viewport/package.json  tsconfig.json`: a bare
      // file name inherits the directory of the previous path on the same line.
      let lastDir = '';
      for (const raw of chunk.split(/[\s,]+/)) {
        let tok = cleanToken(raw);
        if (!looksLikePath(tok)) continue;
        if (!tok.includes('/') && lastDir) tok = lastDir + tok;
        const slash = tok.lastIndexOf('/');
        if (slash >= 0) lastDir = tok.slice(0, slash + 1);
        for (const p of expandBraces(tok)) sink.push(p);
      }
    };
    collect(parts[0] ?? '', cur.include);
    for (const ex of parts.slice(1)) {
      /** @type {string[]} */
      const tmp = [];
      collect(ex, tmp);
      const base = cur.include[cur.include.length - 1] ?? '';
      for (const t of tmp) cur.exclude.push(resolveExcept(base, t));
    }
  };

  for (const line of lines) {
    const head = /^####\s+(WP-\d+)\s*(?:—|--|-)\s*(.*)$/.exec(line.trim());
    if (head) {
      cur = { wp: head[1], title: head[2].trim(), include: [], exclude: [] };
      pkgs.push(cur);
      inOwns = false;
      inFence = false;
      continue;
    }
    if (!cur) continue;
    if (/^##\s/.test(line)) {
      cur = null;
      continue;
    }

    if (line.trim().startsWith('```')) {
      if (inOwns) inFence = !inFence;
      if (inOwns && !inFence) inOwns = false; // fence closed -> Owns block done
      continue;
    }
    if (/\*\*Owns:?\*\*/.test(line)) {
      inOwns = true;
      pushTokens(line.replace(/\*\*Owns:?\*\*/, ''));
      continue;
    }
    if (inOwns && inFence) {
      pushTokens(line);
      continue;
    }
    if (inOwns && !inFence) {
      // Inline (non-fenced) Owns lists continue until the next bold heading.
      if (/^\s*\*\*(Scope|Acceptance|Depends|Note)/.test(line)) {
        inOwns = false;
        continue;
      }
      if (line.trim() === '') continue;
      pushTokens(line);
    }
  }

  // WP-00 owns `.github/workflows/webclient-*.yml`; make the wildcard explicit
  // for readers of --list.
  return pkgs.filter((p) => p.include.length > 0);
}

// ---------------------------------------------------------------------------
// glob matching (subset: ** * ? and literal segments)
// ---------------------------------------------------------------------------
function globToRegExp(pattern) {
  let p = pattern.replace(/\/+$/, '/**'); // `dir/` means everything under dir
  if (!p.includes('*') && !/\.[a-z0-9]+$/i.test(p)) p = `${p}/**`; // bare dir
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        // `**` or `/**`
        re += '.*';
        i++;
        if (p[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') re += '[^/]';
    else if ('\\^$+.()|[]{}'.includes(c)) re += `\\${c}`;
    else re += c;
  }
  return new RegExp(`^${re}$`);
}

const matchers = new Map();
function matches(pattern, file) {
  let re = matchers.get(pattern);
  if (!re) {
    re = globToRegExp(pattern);
    matchers.set(pattern, re);
  }
  if (re.test(file)) return true;
  // `a/b/**` should also match `a/b` itself.
  if (pattern.endsWith('/**') && file === pattern.slice(0, -3)) return true;
  return false;
}

/** @param {Pkg} pkg */
function owns(pkg, file) {
  if (pkg.exclude.some((p) => matches(p, file))) return false;
  return pkg.include.some((p) => matches(p, file));
}

// ---------------------------------------------------------------------------
// changed files
// ---------------------------------------------------------------------------
const git = (args) =>
  execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function changedFiles(base) {
  /** @type {Set<string>} */
  const out = new Set();
  const push = (blob) => {
    for (const l of blob.split('\n')) if (l.trim()) out.add(l.trim());
  };
  if (base) {
    let range = base;
    try {
      range = git(['merge-base', base, 'HEAD']).trim() || base;
    } catch {
      /* base may be a bare sha */
    }
    push(git(['diff', '--name-only', `${range}..HEAD`]));
  }
  push(git(['diff', '--name-only']));
  push(git(['diff', '--name-only', '--cached']));
  push(git(['ls-files', '--others', '--exclude-standard']));
  return [...out].sort();
}

function inferWp() {
  if (process.env.TENMOL_WP) return process.env.TENMOL_WP.toUpperCase();
  const explicit = opt('--wp');
  if (explicit) return explicit.toUpperCase();
  try {
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    const m = /wp[-_]?(\d{1,2})/i.exec(branch);
    if (m) return `WP-${m[1].padStart(2, '0')}`;
  } catch {
    /* detached / not a repo */
  }
  return '';
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
const pkgs = parsePlan();

if (flag('--list')) {
  const wp = (opt('--list') ?? '').toUpperCase();
  const pkg = pkgs.find((p) => p.wp === wp);
  if (!pkg) {
    console.error(
      `ownership: no such work package '${wp}'. Known: ${pkgs.map((p) => p.wp).join(' ')}`,
    );
    process.exit(2);
  }
  console.log(`${pkg.wp} — ${pkg.title}`);
  for (const p of pkg.include) console.log(`  + ${p}`);
  for (const p of pkg.exclude) console.log(`  - ${p}`);
  process.exit(0);
}

if (flag('--who')) {
  const target = relative(REPO, resolve(process.cwd(), opt('--who') ?? ''));
  const hits = pkgs.filter((p) => owns(p, target));
  if (hits.length === 0) {
    console.log(`${target}: UNOWNED (not listed in section 6 of the plan)`);
    process.exit(1);
  }
  for (const h of hits) console.log(`${target}: ${h.wp} — ${h.title}`);
  process.exit(hits.length === 1 ? 0 : 1);
}

const WP = inferWp();
if (!WP) {
  console.error(
    'ownership: which work package is this? Pass --wp WP-NN, set $TENMOL_WP, or\n' +
      '           use a branch named like `wp-07-shell`.',
  );
  process.exit(2);
}
const me = pkgs.find((p) => p.wp === WP);
if (!me) {
  console.error(`ownership: '${WP}' is not in section 6 of ${relative(REPO, PLAN)}`);
  process.exit(2);
}

const files = (explicitPaths.length ? explicitPaths : changedFiles(opt('--base'))).map((f) =>
  f.startsWith('/') ? relative(REPO, f) : f,
);

// Files nobody should be linting: generated, ignored, or the plan itself.
const IGNORED = [
  /^node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)\.venv\//,
  /(^|\/)__pycache__\//,
  /(^|\/)\.deps\//,
  /\.tsbuildinfo$/,
  /^pnpm-lock\.yaml$/,
];

/** @type {string[]} */
const violations = [];
/** @type {string[]} */
const unowned = [];
let okCount = 0;

for (const f of files) {
  if (!f || IGNORED.some((r) => r.test(f))) continue;
  if (owns(me, f)) {
    okCount++;
    continue;
  }
  const other = pkgs.filter((p) => p.wp !== WP && owns(p, f));
  if (other.length) violations.push(`${f}  ->  owned by ${other.map((o) => o.wp).join(', ')}`);
  else unowned.push(f);
}

const plural = (n, s) => `${n} ${s}${n === 1 ? '' : 's'}`;
console.log(`ownership: ${WP} — ${me.title}`);
console.log(
  `  ${plural(files.length, 'changed file')}, ${okCount} owned, ` +
    `${violations.length} cross-WP, ${unowned.length} unowned`,
);

for (const v of violations) console.error(`  \x1b[31mVIOLATION\x1b[0m ${v}`);
for (const u of unowned) console.error(`  \x1b[33munowned\x1b[0m   ${u}`);

if (unowned.length && !violations.length) {
  console.error(
    '\n  Unowned paths are not a hard failure: section 6 does not enumerate every\n' +
      '  generated or repo-root file. Add them to the plan (plan owner) or to the\n' +
      '  IGNORED list in this script if they are build output.',
  );
}

process.exit(violations.length ? 1 : 0);
