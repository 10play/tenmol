import { describe, expect, it } from 'vitest';
import { runLocalCorpus, diffCorpus, type Snapshot } from '../src/index';
import golden from '../fixtures/golden.json';

const GOLDEN = golden as unknown as Record<string, Snapshot>;

describe('engine equivalence — TypeScript engine vs. authoritative golden', () => {
  it('every observable in every script matches the golden (zero divergence)', async () => {
    const actual = await runLocalCorpus();
    const diffs = diffCorpus(GOLDEN, actual);
    // A non-empty list is printed field-by-field, so a failure names exactly
    // which script and which probe diverged.
    expect(diffs).toEqual([]);
  });

  // Independent ground-truth checks: these assert the KEY expected values
  // directly, so the golden gate is not merely engine-vs-itself.
  it('produces the hand-derived topology counts', async () => {
    const actual = await runLocalCorpus();
    expect(actual.load!.counts).toMatchObject({
      all: 9,
      'name CA': 2,
      'chain A': 5,
      'chain B': 4,
      'elem C': 5,
      'elem N': 2,
      'elem O': 2,
      'resi 1': 5,
    });
    expect(actual.load!.names).toEqual(['m']);
  });

  it('resolves PyMOL palette RGBs and per-atom colour counts', async () => {
    const actual = await runLocalCorpus();
    expect(actual.color_chains!.colorTuples).toMatchObject({
      cyan: [0, 1, 1],
      red: [1, 0, 0],
      green: [0, 1, 0],
      yellow: [1, 1, 0],
    });
    expect(actual.color_chains!.counts).toMatchObject({ 'color cyan': 5, 'color red': 4 });
  });

  it('reflects representation changes in `rep` selections', async () => {
    const actual = await runLocalCorpus();
    expect(actual.as_spheres!.counts).toMatchObject({ 'rep spheres': 9, 'rep lines': 0 });
    expect(actual.show_hide!.counts).toMatchObject({ 'rep spheres': 2, 'rep lines': 5 });
  });

  it('round-trips set_view -> get_view over the gated indices', async () => {
    const actual = await runLocalCorpus();
    const v = actual.view_roundtrip!.view!;
    expect(v[0]).toBeCloseTo(0.8660254, 5);
    expect(v[11]).toBeCloseTo(-30, 5);
    expect(v[17]).toBeCloseTo(-20, 5);
  });
});
