import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseMol2 } from '../src/model/mol2';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Read the FIRST molecule block's raw text (up to the second MOLECULE marker). */
function firstBlock(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let seen = 0;
  for (const l of lines) {
    if (/^@<TRIPOS>MOLECULE/.test(l)) {
      seen++;
      if (seen === 2) break;
    }
    out.push(l);
  }
  return out.join('\n');
}

/** `num_atoms num_bonds …` from the first molecule block's counts line. */
function declaredCounts(block: string): { atoms: number; bonds: number } {
  const lines = block.split(/\r?\n/);
  const i = lines.findIndex((l) => /^@<TRIPOS>MOLECULE/.test(l));
  const nums = (lines[i + 2] ?? '')
    .trim()
    .split(/\s+/)
    .map((n) => parseInt(n, 10));
  return { atoms: nums[0] ?? 0, bonds: nums[1] ?? 0 };
}

/** Whether the first block's BOND section contains a double or aromatic bond. */
function hasDoubleOrAromatic(block: string): boolean {
  const lines = block.split(/\r?\n/);
  let inBond = false;
  for (const l of lines) {
    if (/^@<TRIPOS>BOND/.test(l)) {
      inBond = true;
      continue;
    }
    if (/^@<TRIPOS>/.test(l)) {
      inBond = false;
      continue;
    }
    if (!inBond) continue;
    const t = l.trim().split(/\s+/);
    const type = (t[3] ?? '').toLowerCase();
    if (type === '2' || type === '3' || type === 'ar' || type === 'am') return true;
  }
  return false;
}

describe('parseMol2', () => {
  const cases: Array<{ label: string; path: string }> = [
    { label: 'ligs3d (no subst columns)', path: 'packages/engine/testing/data/ligs3d.mol2' },
    {
      label: 'small03 (full atom rows, multi-molecule)',
      path: 'packages/engine/test/dat/small03.mol2',
    },
  ];

  for (const { label, path } of cases) {
    describe(label, () => {
      const text = readFileSync(join(REPO, path), 'utf8');
      const block = firstBlock(text);
      const declared = declaredCounts(block);
      const mol = parseMol2(text, 'lig');

      it('parses a non-empty atom table matching the first block', () => {
        expect(mol.natom).toBeGreaterThan(0);
        expect(mol.natom).toBe(declared.atoms);
      });

      it('takes bonds from the explicit BOND block (count matches the counts line)', () => {
        expect(mol.bonds.length).toBe(declared.bonds);
        // Every bond references an in-range 0-based atom index.
        for (const [a, b] of mol.bonds) {
          expect(a).toBeGreaterThanOrEqual(0);
          expect(b).toBeGreaterThanOrEqual(0);
          expect(a).toBeLessThan(mol.natom);
          expect(b).toBeLessThan(mol.natom);
          expect(a).not.toBe(b);
        }
      });

      it('has one Float32 coordinate state with finite coords', () => {
        expect(mol.states.length).toBe(1);
        const set = mol.states[0]!;
        expect(set).toBeInstanceOf(Float32Array);
        expect(set.length).toBe(mol.natom * 3);
        for (const v of set) expect(Number.isFinite(v)).toBe(true);
      });

      it('canonicalises elements from the SYBYL atom type (part before ".")', () => {
        // Title-case symbols, never a dotted SYBYL type.
        for (const atom of mol.atoms) {
          expect(atom.elem).not.toContain('.');
          expect(atom.elem).toBe(
            atom.elem.charAt(0).toUpperCase() + atom.elem.slice(1).toLowerCase(),
          );
        }
        // The sample ligands are organic — carbon must be present.
        expect(mol.atoms.some((a) => a.elem === 'C')).toBe(true);
      });

      it('exercises a double or aromatic bond in the first block', () => {
        expect(hasDoubleOrAromatic(block)).toBe(true);
      });
    });
  }

  it('C.ar / N.am SYBYL types map to C / N', () => {
    const mol = parseMol2(
      readFileSync(join(REPO, 'packages/engine/testing/data/ligs3d.mol2'), 'utf8'),
      'lig',
    );
    // Atom 3 is C.ar, atom 20 is N.am in ligs3d.mol2 (1-based file ids == load order here).
    expect(mol.atoms[2]!.elem).toBe('C');
    expect(mol.atoms[19]!.elem).toBe('N');
  });

  it('loads only the first molecule of a multi-molecule file', () => {
    const text = readFileSync(join(REPO, 'packages/engine/test/dat/small03.mol2'), 'utf8');
    const mol = parseMol2(text, 'first');
    // small03.mol2 holds 16 molecules; the first (AGLYSL01) has 10 atoms.
    expect(mol.natom).toBe(10);
    expect(mol.atoms[0]!.resn).toBe('AGLY');
  });
});
