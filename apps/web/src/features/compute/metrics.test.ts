import { describe, expect, it } from 'vitest';

import { METRICS, formatResult, runnable, type Metric } from './metrics';

const byId = (id: string): Metric => {
  const m = METRICS.find((x) => x.id === id);
  if (!m) throw new Error(`no metric ${id}`);
  return m;
};

describe('metric catalogue', () => {
  it('routes every call through the util module', () => {
    // The dispatcher resolves an unlisted root to `pymol.<root>`, so these
    // reach pymol.util.* with no bridge panel. Verified over the wire.
    for (const m of METRICS) expect(m.fn.startsWith('util.')).toBe(true);
  });

  it('marks the tuple-keyed helper unsupported rather than offering it', () => {
    const m = byId('sasa_rel');
    expect(m.kind).toBe('unsupported');
    expect(m.unsupportedReason).toMatch(/NotSerializable/);
    expect(runnable().map((x) => x.id)).not.toContain('sasa_rel');
  });

  it('marks the model-mutating helper destructive and warns', () => {
    const m = byId('esp');
    expect(m.kind).toBe('destructive');
    expect(m.warning).toMatch(/deletes alternate conformers/);
    expect(m.warning).toMatch(/_e_chg/);
  });

  it('offers every other helper', () => {
    expect(runnable().map((m) => m.id)).toEqual([
      'area', 'sasa', 'mass', 'formal', 'partial', 'surf_res', 'surf_atoms', 'esp',
    ]);
  });
});

describe('formatResult', () => {
  it('applies each metric’s own precision and unit', () => {
    expect(formatResult(byId('area'), 70434.359375)).toBe('70434.36 Å²');
    expect(formatResult(byId('formal'), -5)).toBe('-5');
    expect(formatResult(byId('partial'), 0)).toBe('0.0000');
  });

  it('reports a selection by name', () => {
    expect(formatResult(byId('surf_res'), 'surf_res')).toBe('selection "surf_res"');
    expect(formatResult(byId('surf_res'), '')).toBe('no selection made');
  });

  it('does not print NaN or Infinity as a number', () => {
    expect(formatResult(byId('mass'), Number.NaN)).toBe('NaN');
    expect(formatResult(byId('mass'), Number.POSITIVE_INFINITY)).toBe('Infinity');
  });

  it('renders a missing result as a dash, not as "undefined"', () => {
    expect(formatResult(byId('mass'), undefined)).toBe('—');
    expect(formatResult(byId('mass'), null)).toBe('—');
  });
});

describe('quiet keyword', () => {
  it('is suppressed for the finders, which do not accept it', () => {
    // Caught in a browser run: find_surface_residues(sele, name='') raises
    // "unexpected keyword argument 'quiet'".
    expect(byId('surf_res').quiet).toBe(false);
    expect(byId('surf_atoms').quiet).toBe(false);
  });

  it('is left on by default for the helpers that do accept it', () => {
    for (const id of ['area', 'sasa', 'mass', 'formal', 'partial', 'esp']) {
      expect(byId(id).quiet).not.toBe(false);
    }
  });
});
