/**
 * CCP4 sigma-normalization on load (normalize_ccp4_maps) + the limited
 * get_volume_histogram (volume_data_range) — ports of ObjectMap.cpp:2532-2614
 * and ObjectMapStateGetHistogram (ObjectMap.cpp:291-334).
 *
 * Ground truth is the oracle (real PyMOL 3.2.0a) on the mode-2 test map
 * packages/engine/testing/data/h2o-elf-nstart.ccp4; see the committed probe
 * command__get_volume_histogram.json.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LocalBackend } from '@tenmol/engine-ts';

const REPO = join(__dirname, '../../..');
const CCP4 = new Uint8Array(readFileSync(join(REPO, 'packages/engine/testing/data/h2o-elf-nstart.ccp4')));

describe('CCP4 normalize + get_volume_histogram', () => {
  it('normalizes density to mean≈0, stdev≈1 and trims to mean±5σ', async () => {
    const b = new LocalBackend();
    await b.connect();
    await b.call('load_ccp4map', ['dm', CCP4]);
    const h = (await b.call('get_volume_histogram', ['dm', 10])) as number[];
    const [minHis, maxHis, mean, stdev, ...counts] = h;
    // Normalized: mean ~ 0, stdev ~ 1.
    expect(mean!).toBeCloseTo(0, 3);
    expect(stdev!).toBeCloseTo(1, 2);
    // Trimmed range: max clamps to mean + 5σ ≈ 5; min stays the (higher) data min.
    expect(maxHis!).toBeCloseTo(5, 1);
    expect(minHis!).toBeCloseTo(-0.4897, 2);
    // 10 bins, dominated by the background peak (matches the oracle counts).
    expect(counts.length).toBe(10);
    expect(counts[0]).toBe(53511);
    expect(counts.reduce((a, c) => a + c, 0)).toBe(64000);
    b.close();
  });

  it('leaves the map raw when normalize_ccp4_maps is off', async () => {
    const b = new LocalBackend();
    await b.connect();
    await b.call('set', ['normalize_ccp4_maps', 0]);
    await b.call('load_ccp4map', ['dm', CCP4]);
    const h = (await b.call('get_volume_histogram', ['dm', 10])) as number[];
    // Raw ELF values live in ~[0,1], so the mean is not ~0 and stdev not ~1.
    expect(h[2]!).toBeGreaterThan(0.01);
    expect(h[3]!).toBeLessThan(0.5);
    b.close();
  });
});
