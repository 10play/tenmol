/**
 * The APBS panel's binary probe.
 *
 * The parity row defers the dialog port with "neither binary is present on
 * this machine". A panel that only prints that sentence is unfalsifiable, so
 * `apbsProbe` asks — and it has to ask the way the Qt plugin asks, or a
 * "not found" here would not mean the plugin fails too.
 *
 * The expectations below are pinned against the real source:
 *   `packages/engine/data/startup/apbs_gui/electrostatics.py:49-57`  -> APBS_CANDIDATES
 *   `packages/engine/data/startup/apbs_gui/__init__.py:224-231`      -> PDB2PQR_CANDIDATES
 *
 * The values used for "what the backend answers" are the ones measured over a
 * real socket in `packages/bridge/tests/test_wf_apbs.py`: `subproc.which('apbs')` and
 * `subproc.which('pdb2pqr')` both `null`, and `cmd.exp_path` returning
 * `$SCHRODINGER/utilities/apbs` unexpanded because the variable is unset.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  APBS_CANDIDATES,
  PDB2PQR_CANDIDATES,
  describeProgram,
  firstProgram,
  pipelineIsRunnable,
  probeApbs,
  type CallFn,
} from './apbsProbe';

/** A backend stub: `which` answers from a table, everything else is scripted. */
function fakeBackend(which: Record<string, string | null>, extra: Record<string, unknown> = {}) {
  const calls: Array<[string, readonly unknown[]]> = [];
  const call = (async (fn: string, args: readonly unknown[] = []) => {
    calls.push([fn, args]);
    if (fn === 'subproc.which') return which[String(args[0])] ?? null;
    // PyMOL's `exp_path` leaves an unset variable in place.
    if (fn === 'cmd.exp_path') return String(args[0]);
    if (fn in extra) return extra[fn];
    throw new Error(`unexpected call ${fn}`);
  }) as CallFn;
  return { call, calls };
}

describe('candidate lists mirror the plugin', () => {
  it('looks for apbs where find_apbs_exe() looks', () => {
    expect([...APBS_CANDIDATES]).toEqual(['apbs', '$SCHRODINGER/utilities/apbs']);
  });

  it('looks for all three pdb2pqr names, in the plugin order', () => {
    // acellera::htmd-pdb2pqr ships the third one; dropping it would report
    // "missing" for an install the plugin would happily drive.
    expect([...PDB2PQR_CANDIDATES]).toEqual(['pdb2pqr', 'pdb2pqr30', 'pdb2pqr_cli']);
  });
});

describe('firstProgram', () => {
  it('returns null after trying every candidate — the measured case here', async () => {
    const { call, calls } = fakeBackend({});
    const status = await firstProgram(call, APBS_CANDIDATES);

    expect(status).toEqual({
      name: 'apbs',
      path: null,
      tried: APBS_CANDIDATES,
    });
    // The `$SCHRODINGER` fallback really was attempted, and expanded first.
    expect(calls.map(([fn]) => fn)).toEqual(['subproc.which', 'cmd.exp_path', 'subproc.which']);
    expect(calls[2]![1][0]).toBe('$SCHRODINGER/utilities/apbs');
  });

  it('stops at the first hit and does not expand what it never needed', async () => {
    const { call, calls } = fakeBackend({ apbs: '/opt/homebrew/bin/apbs' });
    const status = await firstProgram(call, APBS_CANDIDATES);

    expect(status.path).toBe('/opt/homebrew/bin/apbs');
    expect(calls).toHaveLength(1);
  });

  it('falls through to a later candidate', async () => {
    const { call } = fakeBackend({ pdb2pqr30: '/usr/local/bin/pdb2pqr30' });
    const status = await firstProgram(call, PDB2PQR_CANDIDATES);

    // Reported under the name the plugin uses, with the path that was found.
    expect(status.name).toBe('pdb2pqr');
    expect(status.path).toBe('/usr/local/bin/pdb2pqr30');
  });
});

describe('probeApbs', () => {
  const plugins = {
    'plugins.get_startup_path': ['/x/pmg_tk/startup', '/x/pymol/data/startup'],
    'plugins.findPlugins': {
      apbs_gui: '/x/pymol/data/startup/apbs_gui/__init__.py',
      lightingsettings_gui: '/x/pymol/data/startup/lightingsettings_gui/__init__.py',
    },
  };

  it('reports this machine: plugin present, neither program installed', async () => {
    const { call } = fakeBackend({}, plugins);
    const probe = await probeApbs(call);

    expect(probe.error).toBeNull();
    expect(probe.pluginOnStartupPath).toBe(true);
    expect(probe.apbs.path).toBeNull();
    expect(probe.pdb2pqr.path).toBeNull();
    expect(pipelineIsRunnable(probe)).toBe(false);
  });

  it('says the pipeline is runnable only when BOTH programs exist', async () => {
    const half = await probeApbs(fakeBackend({ apbs: '/usr/bin/apbs' }, plugins).call);
    expect(pipelineIsRunnable(half)).toBe(false);

    const both = await probeApbs(
      fakeBackend({ apbs: '/usr/bin/apbs', pdb2pqr: '/usr/bin/pdb2pqr' }, plugins).call,
    );
    expect(pipelineIsRunnable(both)).toBe(true);
  });

  it('degrades to a stated error rather than an empty panel', async () => {
    // The realistic failure is the policy refusing the namespace on a bridge
    // that predates `policy/grants/wp-25-apbs.py`. The panel must say so, not
    // silently render "not found" and mislead the user into installing apbs.
    const call = vi.fn(async () => {
      throw new Error("'subproc' is not an addressable namespace");
    }) as unknown as CallFn;
    const probe = await probeApbs(call);

    expect(probe.error).toBe("'subproc' is not an addressable namespace");
    expect(probe.pluginOnStartupPath).toBe(false);
  });
});

describe('describeProgram', () => {
  it('names every candidate it tried when nothing was found', () => {
    expect(describeProgram({ name: 'apbs', path: null, tried: APBS_CANDIDATES })).toBe(
      'apbs: not found (tried apbs, $SCHRODINGER/utilities/apbs)',
    );
  });

  it('shows the resolved path when it was', () => {
    expect(describeProgram({ name: 'apbs', path: '/usr/bin/apbs', tried: APBS_CANDIDATES })).toBe(
      'apbs: /usr/bin/apbs',
    );
  });
});
