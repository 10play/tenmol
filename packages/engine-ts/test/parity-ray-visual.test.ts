/**
 * Visual parity for the CPU ray tracer, scored against REAL PyMOL ray references.
 *
 * Unlike parity-render.test.ts (which only proves a non-blank frame), this replays
 * the shared visual corpus (tools/visual/src/scenes.ts) — the SAME PDB, ops and
 * 18-float camera that PyMOL used to generate docs/screenshots/visual/refs/<id>.png
 * — then ray-traces it headlessly and scores the render against PyMOL's own ray
 * output with the exact colour-aware metric the renderer scoreboard uses
 * (apps/web/e2e/score.mjs: mean of shape coverage + foreground colour fidelity).
 *
 * It is the strongest parity signal available: a pixel comparison of our ray
 * tracer against PyMOL's. Scoped to the reps the tracer renders today
 * (spheres/sticks/lines/surface/cartoon); mesh/ribbon wireframes and label/dash
 * overlays are covered by the WebGL scoreboard, not here. Browser-free, no PyMOL.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LocalBackend } from '../src/index';
import { SCENES } from '../../../tools/visual/src/scenes';
// score.mjs is plain JS (shared with the gallery + visual regression suite).
// @ts-expect-error no types for the .mjs scorer
import { score } from '../../../apps/web/e2e/score.mjs';

const REPO = join(__dirname, '../../..');
const VIS = join(REPO, 'apps/web/public/visual');
const REFS = join(REPO, 'docs/screenshots/visual/refs');
const views = JSON.parse(readFileSync(join(VIS, 'views.json'), 'utf8')) as Record<string, number[]>;

/** Scenes whose reps the CPU tracer renders, with a per-scene parity floor (%). */
const SUPPORTED: Array<[id: string, floor: number]> = [
  ['pept-spheres', 92],
  ['pept-spheres-half', 90],
  ['3al1-spheres', 92],
  ['pept-sticks-element', 88],
  ['pept-sticks-thick', 88],
  ['3al1-sticks-element', 80],
  ['pept-lines', 88],
  ['pept-surface', 86],
  ['helix-surface', 86],
  ['3al1-surface', 78],
  ['3al1-cartoon-ss', 86],
  ['helix-cartoon', 86],
];

/** Ray-trace one corpus scene headlessly and return its PNG bytes. */
async function rayScene(id: string): Promise<Buffer> {
  const s = SCENES.find((x) => x.id === id);
  if (!s) throw new Error(`unknown scene ${id}`);
  const b = new LocalBackend();
  await b.connect();
  const obj = s.obj ?? s.pdb.replace(/\.pdb$/, '');
  await b.call('read_pdbstr', [readFileSync(join(VIS, s.pdb), 'utf8'), obj]);
  for (const [k, v] of s.settings ?? []) await b.call('set', [k, v]);
  for (const op of s.ops) await b.call(op[0], op.slice(1));
  await b.call('bg_color', [s.bg]);
  if (views[id]) await b.call('set_view', [views[id]]);
  await b.call('ray', [s.width, s.height]);
  const img = (await b.call('png', ['', s.width, s.height, -1, 0])) as number[];
  return Buffer.from(img);
}

describe('parity: ray tracer vs real PyMOL ray references', () => {
  const scores: number[] = [];

  for (const [id, floor] of SUPPORTED) {
    it(`${id} matches PyMOL ≥ ${floor}%`, async () => {
      const png = await rayScene(id);
      const ref = readFileSync(join(REFS, `${id}.png`));
      const s = score(png, ref);
      scores.push(s.scorePct);
      console.log(
        `ray-parity ${id.padEnd(22)} ${s.scorePct.toFixed(1)}% (shape ${s.coveragePct.toFixed(1)} · color ${s.colorPct.toFixed(1)})`,
      );
      expect(s.sizeMismatch).toBe(false);
      expect(s.scorePct).toBeGreaterThanOrEqual(floor);
    }, 60_000);
  }

  it('mean parity across supported reps clears the ratchet floor', () => {
    // Ratchet: the shadow-corrected tracer means ~92% here; keep a margin for
    // sub-% scorer noise. Raise consciously as lighting/colour parity improves.
    const mean = scores.reduce((a, n) => a + n, 0) / scores.length;
    console.log(`ray-parity MEAN ${mean.toFixed(1)}% across ${scores.length} scenes`);
    expect(scores.length).toBe(SUPPORTED.length); // every scene rendered
    expect(mean).toBeGreaterThanOrEqual(88);
  });
});
