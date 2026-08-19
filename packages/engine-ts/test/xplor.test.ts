/**
 * XPLOR/CNS ASCII density-map loading via read_xplorstr
 * (Selector-independent; ObjectMapXPLORStrToMap, layer2/ObjectMap.cpp:3205).
 * Ground truth is the oracle (real PyMOL 3.2.0a) on a synthesized 2x2x2 grid;
 * see the committed probe feature__XPLOR.json.
 */
import { describe, it, expect } from 'vitest';
import { LocalBackend } from '@tenmol/engine-ts';

const XPLOR = `
       1
REMARK test map
       2       0       1       2       0       1       2       0       1
 1.00000E+01 1.00000E+01 1.00000E+01 9.00000E+01 9.00000E+01 9.00000E+01
ZYX
       0
 0.00000E+00 1.00000E+00 2.00000E+00 3.00000E+00
       1
 4.00000E+00 5.00000E+00 6.00000E+00 7.00000E+00
   -9999
 3.50000E+00 1.50000E+00
`;

describe('XPLOR map loading', () => {
  it('parses an XPLOR ASCII grid into a map object with the right values', async () => {
    const b = new LocalBackend();
    await b.connect();
    await b.call('read_xplorstr', [XPLOR, 'xm']);
    expect(await b.call('get_names', [])).toEqual(['xm']);
    expect(await b.call('get_type', ['xm'])).toBe('object:map');
    const h = (await b.call('get_volume_histogram', ['xm', 4])) as number[];
    // 8 grid values 0..7: min 0, max 7, mean 3.5.
    expect(h[0]).toBeCloseTo(0, 6);
    expect(h[1]).toBeCloseTo(7, 6);
    expect(h[2]).toBeCloseTo(3.5, 6);
    expect(h.slice(4).reduce((a, c) => a + c, 0)).toBe(8);
    b.close();
  });
});
