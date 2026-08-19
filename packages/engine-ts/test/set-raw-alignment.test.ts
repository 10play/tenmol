/**
 * set_raw_alignment / volume_ramp_new — return-value + store parity.
 *
 * `set_raw_alignment` (creating.py) builds an alignment object from raw columns
 * of (model, index) and returns None; `get_raw_alignment` reads it back. NOTE:
 * the real-PyMOL oracle SEGFAULTS on `_cmd.set_raw_alignment` for every tried
 * input, so this feature has no differential probe (see
 * packages/graph/verify/reports/command__set_raw_alignment.md) — this test pins
 * the engine's own contract instead.
 *
 * `volume_ramp_new` (colorramping.py) returns the `_cmd` result (None), not the
 * name, and does not register an executive object — verified vs the oracle in
 * probe command__volume_ramp_new.json.
 */
import { describe, it, expect } from 'vitest';
import { LocalBackend } from '@tenmol/engine-ts';

describe('set_raw_alignment', () => {
  it('stores the raw columns and roundtrips through get_raw_alignment (returns None)', async () => {
    const b = new LocalBackend();
    await b.connect();
    const raw = [
      [['p1', 1], ['p2', 1]],
      [['p1', 10], ['p2', 10]],
    ];
    expect(await b.call('set_raw_alignment', ['aln', raw])).toBeNull();
    expect(await b.call('get_raw_alignment', ['aln'])).toEqual(raw);
    b.close();
  });
});

describe('volume_ramp_new', () => {
  it('returns None and does not create an executive object', async () => {
    const b = new LocalBackend();
    await b.connect();
    await b.call('read_pdbstr', ['ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00  0.00           N\n', 'p']);
    const ret = await b.call('volume_ramp_new', ['myramp', [-1, 1, 0, 0, 0.3, 1, 1, 1, 1, 1]]);
    expect(ret).toBeNull();
    expect(await b.call('get_names', [])).toEqual(['p']);
    b.close();
  });
});

describe('map_generate', () => {
  it('raises a bare CmdException (no MTZ reader in the open-source port)', async () => {
    const { LocalBackend } = await import('@tenmol/engine-ts');
    const b = new LocalBackend();
    await b.connect();
    await expect(b.call('map_generate', ['m1', 'nonexistent.mtz', 'FWT', 'PHWT'])).rejects.toThrow(
      /Error:/,
    );
    expect(await b.call('get_names', [])).toEqual([]);
    b.close();
  });
});
