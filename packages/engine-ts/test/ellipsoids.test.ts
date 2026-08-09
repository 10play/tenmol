import { describe, it, expect } from 'vitest';
import { decodeGeometryFrame, Rep, isCgoDrawArraysHeader, geometryFrameProblems, viewOf } from '@tenmol/protocol';
import { parsePdb } from '../src/model/pdb';
import { repBit } from '../src/model/atom';
import { buildEllipsoidsFrame } from '../src/geometry/ellipsoids';

// One atom with an ANISOU (anisotropic), one without (isotropic B fallback).
const PDB = [
  'ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00 20.00           N',
  'ANISOU    1  N   ALA A   1     2000   1000    500      0      0      0       N',
  'ATOM      2  CA  ALA A   1       3.000   0.000   0.000  1.00 40.00           C',
  'END',
].join('\n') + '\n';

function flagAll(mol: ReturnType<typeof parsePdb>) {
  for (const a of mol.atoms) a.visRep |= repBit(Rep.Ellipsoid);
}

describe('ellipsoids representation', () => {
  it('parses ANISOU and emits well-formed ellipsoid instances', () => {
    const mol = parsePdb(PDB, 'm');
    expect(mol.atoms[0]!.u).toBeDefined();
    expect(mol.atoms[0]!.u![0]).toBeCloseTo(0.2, 6); // U11 = 2000e-4
    expect(mol.atoms[1]!.u).toBeUndefined(); // no ANISOU -> isotropic fallback
    flagAll(mol);
    const buf = buildEllipsoidsFrame(mol, 1, 0, 1.5382)!;
    const f = decodeGeometryFrame(buf);
    expect(f.header.rep).toBe(Rep.Ellipsoid);
    expect(isCgoDrawArraysHeader(f.header) && f.header.instances[0]!.kind).toBe('ellipsoid');
    expect(isCgoDrawArraysHeader(f.header) && f.header.instances[0]!.count).toBe(2);
    expect(geometryFrameProblems(f.header)).toEqual([]);
  });

  it('anisotropic axes match the ANISOU eigenvalues; the columns stay orthogonal', () => {
    const mol = parsePdb(PDB, 'm');
    flagAll(mol);
    const buf = buildEllipsoidsFrame(mol, 1, 0, 1)!; // scale 1 for a clean check
    const f = decodeGeometryFrame(buf);
    if (!isCgoDrawArraysHeader(f.header)) throw new Error('expected cgo header');
    const data = viewOf(f, f.header.instances[0]!.data) as Float32Array;
    // instance 0: center [0..2], n1[3..5], n2[6..8], n3[9..11]
    const n1: number[] = [data[3]!, data[4]!, data[5]!];
    const n2: number[] = [data[6]!, data[7]!, data[8]!];
    const n3: number[] = [data[9]!, data[10]!, data[11]!];
    const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    // Diagonal U -> axes along x,y,z with lengths sqrt(U). Columns orthogonal.
    expect(Math.abs(dot(n1, n2))).toBeLessThan(1e-4);
    expect(Math.abs(dot(n1, n3))).toBeLessThan(1e-4);
    // The three semi-axis lengths are sqrt(0.2), sqrt(0.1), sqrt(0.05) in some order.
    const lens = [n1, n2, n3].map((v) => Math.hypot(v[0]!, v[1]!, v[2]!)).sort((a, b) => a - b);
    expect(lens[0]!).toBeCloseTo(Math.sqrt(0.05), 4);
    expect(lens[2]!).toBeCloseTo(Math.sqrt(0.2), 4);
  });

  it('returns null when no atom carries the ellipsoids bit', () => {
    const mol = parsePdb(PDB, 'm');
    expect(buildEllipsoidsFrame(mol, 1, 0, 1.5382)).toBeNull();
  });
});
