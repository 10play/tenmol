/**
 * Tests for the XYZ reader (packages/engine-ts/src/model/xyz.ts).
 *
 * Drives the parser over the two sample structures shipped with the native
 * engine (`elements.xyz`, an every-element single frame; `ligs3d.xyz`, a
 * multi-frame ligand file whose frames differ in atom count) plus synthetic
 * strings that exercise the trajectory and atomic-number code paths.
 *
 * Assertions check real load effects: a non-empty finite atom table, canonical
 * element symbols, distance-inferred bonds, and the per-frame state count.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseXyz } from '../src/model/xyz';

// Test file lives at packages/engine-ts/test/; three levels up is the repo root.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

const allFinite = (a: Float32Array): boolean => a.every((v) => Number.isFinite(v));

describe('parseXyz — sample files', () => {
  it('parses elements.xyz (single frame, every element)', () => {
    const mol = parseXyz(read('packages/engine/testing/data/elements.xyz'), 'elements');
    expect(mol.natom).toBeGreaterThan(0);
    expect(mol.states.length).toBe(1);
    expect(mol.states[0]!.length).toBe(mol.natom * 3);
    expect(allFinite(mol.states[0]!)).toBe(true);

    // Elements are canonicalised (title-case) and used as the atom name.
    const first = mol.atoms[0]!;
    expect(first.name).toBe(first.elem);
    expect(first.elem).toBe(first.elem.charAt(0).toUpperCase() + first.elem.slice(1).toLowerCase());
    // Symbolic-token elements from the file are recognised (H, He, ... C).
    const symbols = mol.atoms.map((a) => a.elem);
    expect(symbols).toContain('C');
    expect(symbols).toContain('He');

    // Generic HETATM/UNK fielding for a format with no residue info.
    expect(first.resn).toBe('UNK');
    expect(first.resi).toBe('1');
    expect(first.resv).toBe(1);
    expect(first.hetatm).toBe(true);
    expect(first.q).toBe(1);
    expect(first.id).toBe(1);
  });

  it('parses ligs3d.xyz and infers bonds by distance', () => {
    const mol = parseXyz(read('packages/engine/testing/data/ligs3d.xyz'), 'ligs3d');
    expect(mol.natom).toBeGreaterThan(0);
    expect(allFinite(mol.states[0]!)).toBe(true);
    // A real 3D ligand yields distance-inferred connectivity.
    expect(mol.bonds.length).toBeGreaterThan(0);
    // ligs3d.xyz frames have differing atom counts, so the trajectory stops
    // after frame 1 (constant-topology guard): exactly one state.
    expect(mol.states.length).toBe(1);
    expect(mol.states[0]!.length).toBe(mol.natom * 3);
  });
});

describe('parseXyz — trajectory and atomic numbers', () => {
  it('reads a constant-count multi-frame file as a trajectory', () => {
    const text = [
      '2',
      'frame 1',
      'O 0.0 0.0 0.0',
      'H 0.96 0.0 0.0',
      '2',
      'frame 2',
      'O 0.0 0.0 0.0',
      'H 0.0 0.96 0.0',
      '', // tolerated trailing blank line
    ].join('\n');
    const mol = parseXyz(text, 'traj');
    expect(mol.natom).toBe(2);
    expect(mol.states.length).toBeGreaterThan(1);
    expect(mol.states.length).toBe(2);
    // Distinct coordinates across states (the H moved).
    expect(mol.states[0]![4]).toBeCloseTo(0);
    expect(mol.states[1]![4]).toBeCloseTo(0.96);
    expect(mol.bonds.length).toBe(1);
  });

  it('stops when a later frame changes atom count', () => {
    const text = [
      '2',
      'a',
      'C 0 0 0',
      'C 1.5 0 0',
      '3',
      'b',
      'C 0 0 0',
      'C 1.5 0 0',
      'C 3 0 0',
    ].join('\n');
    const mol = parseXyz(text, 'mixed');
    expect(mol.natom).toBe(2);
    expect(mol.states.length).toBe(1);
  });

  it('maps all-digit tokens as atomic numbers', () => {
    const text = ['2', 'Z-encoded', '8 0 0 0', '1 0.96 0 0'].join('\n');
    const mol = parseXyz(text, 'znum');
    expect(mol.atoms.map((a) => a.elem)).toEqual(['O', 'H']);
    expect(mol.atoms[0]!.name).toBe('O');
  });

  it('ignores extra trailing columns on an atom line', () => {
    const text = ['1', 'extra', 'C 1.0 2.0 3.0 99.9 ignored'].join('\n');
    const mol = parseXyz(text, 'extra');
    expect(mol.natom).toBe(1);
    expect(Array.from(mol.states[0]!)).toEqual([1, 2, 3]);
    expect(mol.atoms[0]!.elem).toBe('C');
  });

  it('drops a frame whose LATER row is malformed — no partial atoms + zero coords', () => {
    // Rows 1-2 parse, row 3 is malformed. The frame (and its staged atoms) must
    // be dropped WHOLE: never a 2-atom table paired with an all-zero state.
    const text = ['3', 'bad3', 'C 0 0 0', 'N 1 0 0', 'O x y z'].join('\n');
    const mol = parseXyz(text, 'bad');
    expect(mol.natom).toBe(0); // partial atoms were NOT committed
    expect(mol.states.length).toBe(0);
  });

  it('does not choke on a prototype-polluting element token', () => {
    // `__proto__` as an element must not resolve COVALENT to Object.prototype and
    // NaN-out the bonding pass; a normal C-C pair still bonds.
    const text = ['3', 'proto', '__proto__ 0 0 0', 'C 5 0 0', 'C 6.5 0 0'].join('\n');
    const mol = parseXyz(text, 'proto');
    expect(mol.natom).toBe(3);
    expect(mol.bonds.some(([a, b]) => (a === 1 && b === 2) || (a === 2 && b === 1))).toBe(true);
  });
});
