/**
 * Command- and rep-coverage KPI — the burndown for the "100% feature parity"
 * effort (`docs/parity-dashboard.md`, `docs/engine-backlog.md`).
 *
 * This is both a REPORT and a GATE. It reads the live registered command set
 * from a fresh {@link Engine} (`commandNames()`), measures it against the real
 * PyMOL command surface (the vendored `pymol/*.py` modules — the same source of
 * truth `packages/bridge/tests/test_api_surface.py` asserts at 404 flat
 * symbols), and:
 *
 *   - prints a scoreboard (always, visible under `pnpm coverage`),
 *   - rewrites `docs/parity-dashboard.md` when `TENMOL_COVERAGE_WRITE=1`,
 *   - asserts ratchet FLOORS so a wave can only ever raise a number.
 *
 * The floors live in {@link FLOORS} and are bumped up as each backlog wave
 * lands. Override for a one-off with `TENMOL_COVERAGE_*` env vars.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { Engine } from '@tenmol/engine-ts';
import { Rep } from '@tenmol/protocol';
import { REP_BUILDERS } from '../src/geometry/registry';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PYMOL = join(REPO, 'packages', 'engine', 'modules', 'pymol');

/**
 * Ratchet floors — a wave raises these; CI fails if a number drops below.
 * Wave 0 baseline: flat 263/390, namespaces 8/116, reps 13/21.
 * Wave 1 (command namespaces): flat 273/390, namespaces 77/116, reps 13/21.
 * Bump these up as each backlog wave lands.
 */
const FLOORS = {
  flatReal: Number(process.env.TENMOL_COVERAGE_FLAT ?? 273),
  nsReal: Number(process.env.TENMOL_COVERAGE_NS ?? 77),
  reps: Number(process.env.TENMOL_COVERAGE_REPS ?? 13),
};

/** Namespaced modules whose public functions are the `cmd.<ns>.*` surface. */
const NAMESPACES = ['preset', 'util', 'movie', 'editor', 'gui'] as const;

/**
 * The flat `cmd.*` verb surface from `api.py`. The AST-authoritative figure is
 * 404 *import entries*, but ~15 of those are bare `from . import <submodule>`
 * lines (`editing`, `viewing`, `util`, `movie`, `gui`, `setting`, …) — those are
 * namespaces, not callable verbs, so we require a `from .<module> import` form
 * and drop them. What remains is the set of flat verbs a port must actually
 * implement.
 */
function flatSurface(): Set<string> {
  const src = readFileSync(join(PYMOL, 'api.py'), 'utf8').replace(/\\\r?\n/g, ' ');
  const names = new Set<string>();
  for (const m of src.matchAll(/from\s+\.(\w+)\s+import\s+(.+)/g)) {
    for (const part of m[2]!.split(',')) {
      const tok = part.trim();
      if (!tok) continue;
      // `X as Y` re-exports as Y — the actual `cmd.Y` symbol (matches the AST).
      const name = tok
        .split(/\s+as\s+/)
        .pop()!
        .trim();
      if (/^[a-zA-Z_]\w*$/.test(name)) names.add(name);
    }
  }
  return names;
}

/** Public (non-underscore) `def` names in a vendored `pymol/<mod>.py`. */
function moduleDefs(mod: string): Set<string> {
  const src = readFileSync(join(PYMOL, `${mod}.py`), 'utf8');
  const names = new Set<string>();
  for (const m of src.matchAll(/^def\s+([a-zA-Z]\w*)/gm)) names.add(m[1]!);
  return names;
}

/** Names registered by the `noop(...)` batches in `cmd/extras.ts` (stubs). */
function stubNames(): Set<string> {
  const src = readFileSync(join(REPO, 'packages', 'engine-ts', 'src', 'cmd', 'extras.ts'), 'utf8');
  const names = new Set<string>();
  for (const m of src.matchAll(/noop\(\s*\[([\s\S]*?)\]/g)) {
    for (const q of m[1]!.matchAll(/['"]([\w.]+)['"]/g)) names.add(q[1]!);
  }
  return names;
}

interface NsRow {
  ns: string;
  real: number;
  denom: number;
  missing: string[];
}

interface Scoreboard {
  flat: { real: number; stub: number; denom: number; extensions: number; missing: string[] };
  namespaces: NsRow[];
  nsReal: number;
  nsDenom: number;
  reps: { built: number; denom: number; missing: string[] };
}

function computeScoreboard(): Scoreboard {
  const registered = new Set(new Engine().commandNames());
  const stubs = stubNames();
  const surface = flatSurface();

  // Flat surface: split registered flat names into real vs stub vs extension.
  const flatRegistered = [...registered].filter((n) => !n.includes('.'));
  const flatInSurface = flatRegistered.filter((n) => surface.has(n));
  const flatReal = flatInSurface.filter((n) => !stubs.has(n));
  const flatStub = flatInSurface.filter((n) => stubs.has(n));
  const flatExtensions = flatRegistered.filter((n) => !surface.has(n)); // tenmol_*, aliases
  const flatMissing = [...surface].filter((n) => !registered.has(n)).sort();

  // Namespaces: registered `ns.*` real handlers vs the module's public defs.
  const namespaces: NsRow[] = NAMESPACES.map((ns) => {
    const denomSet = moduleDefs(ns);
    const regNs = new Set(
      [...registered]
        .filter((n) => n.startsWith(`${ns}.`) && !stubs.has(n))
        .map((n) => n.slice(ns.length + 1)),
    );
    const real = [...regNs].filter((n) => denomSet.has(n)).length;
    const missing = [...denomSet].filter((n) => !regNs.has(n)).sort();
    return { ns, real, denom: denomSet.size, missing };
  });
  const nsReal = namespaces.reduce((a, r) => a + r.real, 0);
  const nsDenom = namespaces.reduce((a, r) => a + r.denom, 0);

  // Reps: builders in the registry vs every renderable slot (excl. None/All).
  const builtRepIds = new Set(Object.keys(REP_BUILDERS).map(Number));
  const slots = Object.entries(Rep).filter(([, v]) => (v as number) >= 0);
  const missingReps = slots
    .filter(([, v]) => !builtRepIds.has(v as number))
    .map(([k]) => k)
    .sort();

  return {
    flat: {
      real: flatReal.length,
      stub: flatStub.length,
      denom: surface.size,
      extensions: flatExtensions.length,
      missing: flatMissing,
    },
    namespaces,
    nsReal,
    nsDenom,
    reps: { built: builtRepIds.size, denom: slots.length, missing: missingReps },
  };
}

function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${((100 * n) / d).toFixed(1)}%`;
}

/** Render the committed burndown doc. */
function renderDashboard(s: Scoreboard): string {
  const nsLines = s.namespaces
    .map((r) => `| \`${r.ns}.*\` | ${r.real} / ${r.denom} | ${pct(r.real, r.denom)} |`)
    .join('\n');
  const totalReal = s.flat.real + s.nsReal;
  const totalDenom = s.flat.denom + s.nsDenom;
  return `# Parity dashboard — the backlog burndown

{/* GENERATED by packages/engine-ts/test/coverage.test.ts (\`pnpm coverage --write\`).
    Do not edit by hand — rerun after each wave. Mintlify parses .md as MDX, so
    this is an MDX comment, not an HTML one. */}

The hard KPIs for closing \`docs/engine-backlog.md\` to 100% feature parity. Command
coverage counts a symbol as **real** only when it has a genuine handler; the
documented no-ops in \`cmd/extras.ts\` (\`load\`, \`save\`, \`ray\`, …) count as **stub**,
not real. Visual parity is tracked separately by \`apps/web/e2e/visual.e2e.mjs\`
(a realtime WebGL renderer cannot pixel-match the ray-traced reference, so its
ceiling is ~93–95%, not 100%).

## Command coverage

| Surface | Real / total | % |
|---|---|---|
| Flat \`cmd.*\` | ${s.flat.real} / ${s.flat.denom} | ${pct(s.flat.real, s.flat.denom)} |
${nsLines}
| **All commands** | **${totalReal} / ${totalDenom}** | **${pct(totalReal, totalDenom)}** |

Flat \`cmd.*\` also has **${s.flat.stub} stub** (no-op) handlers and **${s.flat.extensions}**
engine-only extensions (e.g. \`tenmol_*\`) outside the PyMOL surface.

## Representation coverage

Builders present: **${s.reps.built} / ${s.reps.denom}** renderable slots (${pct(
    s.reps.built,
    s.reps.denom,
  )}).
Missing builders: ${s.reps.missing.length ? s.reps.missing.map((r) => `\`${r}\``).join(', ') : '—'}.

## Other tracked gates

| KPI | Source |
|---|---|
| Visual mean PyMOL similarity | \`apps/web/e2e/visual.e2e.mjs\` (\`report.json\`) |
| Feature-parity checklist | \`scripts/parity.mjs\` over \`docs/feature-parity.md\` |
| Engine differential (0 divergence) | \`scripts/parity-engine.mjs\`, \`tools/parity\` |
`;
}

describe('parity coverage scoreboard', () => {
  it('measures command + rep coverage and holds the ratchet floors', () => {
    const s = computeScoreboard();
    const totalReal = s.flat.real + s.nsReal;
    const totalDenom = s.flat.denom + s.nsDenom;

    const lines = [
      '',
      '  ── Parity coverage scoreboard ──',
      `  flat cmd.*   real ${s.flat.real}/${s.flat.denom} (${pct(s.flat.real, s.flat.denom)})` +
        `  +${s.flat.stub} stub  +${s.flat.extensions} ext`,
      ...s.namespaces.map(
        (r) => `  ${(r.ns + '.*').padEnd(10)} real ${r.real}/${r.denom} (${pct(r.real, r.denom)})`,
      ),
      `  NAMESPACES   real ${s.nsReal}/${s.nsDenom} (${pct(s.nsReal, s.nsDenom)})`,
      `  ALL COMMANDS real ${totalReal}/${totalDenom} (${pct(totalReal, totalDenom)})`,
      `  reps         built ${s.reps.built}/${s.reps.denom} (${pct(s.reps.built, s.reps.denom)})` +
        `  missing: ${s.reps.missing.join(', ') || '—'}`,
      '',
    ];

    console.log(lines.join('\n'));

    if (process.env.TENMOL_COVERAGE_DEBUG === '1') {
      console.log('FLAT MISSING (' + s.flat.missing.length + '):', s.flat.missing.join(' '));
    }

    if (process.env.TENMOL_COVERAGE_WRITE === '1') {
      writeFileSync(join(REPO, 'docs', 'parity-dashboard.md'), renderDashboard(s));
    }

    // Ratchet: a wave may only raise these.
    expect(s.flat.real).toBeGreaterThanOrEqual(FLOORS.flatReal);
    expect(s.nsReal).toBeGreaterThanOrEqual(FLOORS.nsReal);
    expect(s.reps.built).toBeGreaterThanOrEqual(FLOORS.reps);
  });
});
