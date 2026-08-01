import { describe, expect, it } from 'vitest';

import {
  METRICS,
  buildArgs,
  formatResult,
  missingParams,
  paramsOf,
  runnable,
  type Metric,
} from './metrics';

const byId = (id: string): Metric => {
  const m = METRICS.find((x) => x.id === id);
  if (!m) throw new Error(`no metric ${id}`);
  return m;
};

describe('metric catalogue', () => {
  it('routes every call through util, except the one that cannot be', () => {
    /*
     * The dispatcher resolves an unlisted root to `pymol.<root>`, so `util.*`
     * reaches `pymol.util.*` with no bridge panel at all. Verified over the
     * wire. Exactly one helper needs a panel — `get_sasa_relative`, whose
     * tuple-keyed return the codec refuses — and this pins that it stays
     * exactly one, because a panel is a bootstrap round trip and a module to
     * keep in step with upstream.
     */
    const viaPanel = METRICS.filter((m) => !m.fn.startsWith('util.'));
    expect(viaPanel.map((m) => m.fn)).toEqual(['cmd.tenmol_compute.sasa_relative']);
  });

  /*
   * WAS: "marks the tuple-keyed helper unsupported rather than offering it".
   * That was the honest state before the bridge shim existed — the codec
   * really does refuse a tuple-keyed dict. It is offered now because
   * `panels/compute.py` re-keys it, so the assertion is inverted rather than
   * deleted: the point is that it stopped being a dead button.
   */
  it('offers the tuple-keyed helper now that the shim re-keys it', () => {
    const m = byId('sasa_rel');
    expect(m.kind).toBe('table');
    expect(m.unsupportedReason).toBeUndefined();
    expect(runnable().map((x) => x.id)).toContain('sasa_rel');
  });

  it('marks the model-mutating helper destructive and warns', () => {
    const m = byId('esp');
    expect(m.kind).toBe('destructive');
    expect(m.warning).toMatch(/deletes alternate conformers/);
    expect(m.warning).toMatch(/_e_chg/);
  });

  it('offers every helper, including the eight B9 recorded as unbuilt', () => {
    expect(runnable().map((m) => m.id)).toEqual([
      'area', 'sasa', 'mass', 'formal', 'partial', 'surf_res', 'surf_atoms', 'esp',
      'sasa_rel',
      // Previously unnamed anywhere, and therefore never scheduled.
      'label_chains', 'label_segments', 'phipsi', 'b2vdw', 'interchain',
      'mass_align', 'ff_copy', 'shaders',
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

/* -------------------------------------------------------------------------- *
 * Declared arguments.
 *
 * The panel used to call every helper as `fn(selection, quiet=1)`. Three of the
 * helpers added here take something else entirely, and the bug that shape would
 * cause is silent: `mass_align('polymer')` aligns onto an object literally
 * named "polymer", finds none, and reports nothing wrong.
 * -------------------------------------------------------------------------- */

describe('argument shapes', () => {
  const byId = (id: string) => {
    const m = METRICS.find((x) => x.id === id);
    if (!m) throw new Error(`no metric ${id}`);
    return m;
  };

  it('defaults to a single selection when nothing is declared', () => {
    expect(paramsOf(byId('area'))).toEqual([{ kind: 'selection' }]);
    expect(buildArgs(byId('area'), 'polymer', {})).toEqual(['polymer']);
  });

  it('passes NO arguments to enable_all_shaders', () => {
    expect(buildArgs(byId('shaders'), 'polymer', {})).toEqual([]);
  });

  it('puts the distance object name BEFORE the selection', () => {
    // `interchain_distances(name, selection, ...)` — the only helper here whose
    // first positional is an output name.
    expect(
      buildArgs(byId('interchain'), 'polymer', {
        name: 'ic',
        cutoff: 3.5,
        mode: 0,
        label: false,
        reset: true,
      }),
    ).toEqual(['ic', 'polymer', 3.5, 0, 0, 1]);
  });

  it('does not pass the shared selection to helpers that take neither', () => {
    for (const id of ['mass_align', 'ff_copy', 'shaders']) {
      expect(buildArgs(byId(id), 'polymer', {})).not.toContain('polymer');
    }
  });

  it('sends booleans as 0/1, which is what the helpers test', () => {
    const args = buildArgs(byId('interchain'), 'p', {
      name: 'x',
      cutoff: 3.5,
      mode: 0,
      label: true,
      reset: false,
    });
    expect(args).toEqual(['x', 'p', 3.5, 0, 1, 0]);
  });

  it('NEVER sends a null cutoff to interchain_distances', () => {
    /*
     * Upstream's `cutoff=None` becomes -1.0 in `cmd.distance`, i.e. no cutoff,
     * i.e. every atom pair between every chain — 12.4M measurements on 1tii,
     * and `std::length_error: vector` thrown inside PyMOL_Draw takes the whole
     * bridge process down. Not catchable client-side: the socket just dies.
     *
     * A blank field must therefore fall back to the declared 3.5, never null.
     */
    for (const form of [{}, { cutoff: NaN }, { cutoff: '' }] as const) {
      const args = buildArgs(byId('interchain'), 'p', { name: 'x', ...form });
      expect(args[2]).toBe(3.5);
    }
  });

  it('falls back to the declared default rather than sending NaN', () => {
    // A cleared number input yields '' -> Number('') is 0, but a half-typed
    // '-' yields NaN, which JSON-encodes as null and errors server-side.
    expect(buildArgs(byId('mass_align'), 'p', { target: 'a', max_gap: NaN })).toEqual(['a', 0, 50]);
  });

  it('requires the arguments that have no sensible default', () => {
    expect(missingParams(byId('mass_align'), { target: '' })).toEqual(['target object']);
    expect(missingParams(byId('ff_copy'), { src: 'a', dst: '' })).toEqual(['to']);
    expect(missingParams(byId('ff_copy'), { src: 'a', dst: 'b' })).toEqual([]);
    // A default that is non-empty is not "missing" when left alone.
    expect(missingParams(byId('interchain'), {})).toEqual([]);
  });
});

describe('result formatting for the new kinds', () => {
  const byId = (id: string) => METRICS.find((x) => x.id === id)!;

  it('reports a side-effect helper as done, not as null', () => {
    expect(formatResult(byId('label_chains'), null)).toBe('done');
  });

  it('formats phi/psi, and says n/a at a chain terminus', () => {
    // `util.phipsi` returns None for the angle whose neighbour is absent.
    expect(formatResult(byId('phipsi'), [-57.8, -47.0])).toBe('phi -57.8°, psi -47.0°');
    expect(formatResult(byId('phipsi'), [null, -47.0])).toBe('phi n/a, psi -47.0°');
  });
});

describe('the SASA helper is no longer unsupported', () => {
  it('goes through the bridge shim, not util directly', () => {
    const m = METRICS.find((x) => x.id === 'sasa_rel')!;
    expect(m.kind).toBe('table');
    // Calling `util.get_sasa_relative` over the wire returns a dict keyed by a
    // 4-tuple and the codec refuses it. The shim re-keys it.
    expect(m.fn).toBe('cmd.tenmol_compute.sasa_relative');
  });

  it('warns, because it overwrites an atom property', () => {
    expect(METRICS.find((x) => x.id === 'sasa_rel')!.warning).toMatch(/writes the computed value/);
  });

  it('leaves nothing marked unsupported', () => {
    expect(METRICS.filter((m) => m.kind === 'unsupported')).toEqual([]);
  });
});
