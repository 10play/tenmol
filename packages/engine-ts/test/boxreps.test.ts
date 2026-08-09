import { describe, it, expect } from 'vitest';
import { decodeGeometryFrame, Rep, isCgoDrawArraysHeader, geometryFrameProblems } from '@tenmol/protocol';
import { parsePdb } from '../src/model/pdb';
import { repBit } from '../src/model/atom';
import { buildExtentFrame } from '../src/geometry/extent';
import { buildCellFrame } from '../src/geometry/cell';

function line(serial: number, name: string, x: number, y: number, z: number): string {
  const b = ' '.repeat(80).split('');
  const put = (s: number, t: string) => { for (let i = 0; i < t.length; i++) b[s - 1 + i] = t[i]!; };
  put(1, 'ATOM'); put(7, String(serial).padStart(5)); put(14, name); put(18, 'ALA'); put(22, 'A');
  put(23, '   1'); put(31, x.toFixed(3).padStart(8)); put(39, y.toFixed(3).padStart(8));
  put(47, z.toFixed(3).padStart(8)); put(55, '1.00'); put(61, '0.00'); put(77, 'C'.padStart(2));
  return b.join('').replace(/\s+$/, '');
}
const CRYST = 'CRYST1   20.000   30.000   40.000  90.00  90.00  90.00 P 1           1';
const BODY = [line(1, 'C1', 0, 0, 0), line(2, 'C2', 10, 20, 30)].join('\n') + '\nEND\n';

describe('extent + cell wireframe reps', () => {
  it('extent draws the bounding box (12 edges) when flagged', () => {
    const mol = parsePdb(BODY, 'm');
    for (const a of mol.atoms) a.visRep |= repBit(Rep.Extent);
    const buf = buildExtentFrame({ mol, state: 1, seq: 0, getSettingFloat: () => 0 })!;
    const f = decodeGeometryFrame(buf);
    expect(f.header.rep).toBe(Rep.Extent);
    expect(isCgoDrawArraysHeader(f.header) && f.header.instances[0]!.kind).toBe('line');
    expect(isCgoDrawArraysHeader(f.header) && f.header.instances[0]!.count).toBe(12);
    expect(geometryFrameProblems(f.header)).toEqual([]);
  });

  it('extent is null when no atom is flagged', () => {
    const mol = parsePdb(BODY, 'm');
    expect(buildExtentFrame({ mol, state: 1, seq: 0, getSettingFloat: () => 0 })).toBeNull();
  });

  it('cell draws the unit cell from CRYST1 when flagged', () => {
    const mol = parsePdb(CRYST + '\n' + BODY, 'm');
    expect(mol.cell).toBeTruthy();
    for (const a of mol.atoms) a.visRep |= repBit(Rep.Cell);
    const buf = buildCellFrame({ mol, state: 1, seq: 0, getSettingFloat: () => 0 })!;
    const f = decodeGeometryFrame(buf);
    expect(f.header.rep).toBe(Rep.Cell);
    expect(isCgoDrawArraysHeader(f.header) && f.header.instances[0]!.count).toBe(12);
  });

  it('cell is null without a crystal cell', () => {
    const mol = parsePdb(BODY, 'm');
    for (const a of mol.atoms) a.visRep |= repBit(Rep.Cell);
    expect(buildCellFrame({ mol, state: 1, seq: 0, getSettingFloat: () => 0 })).toBeNull();
  });
});
