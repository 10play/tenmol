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

/** Number of `@<TRIPOS>MOLECULE` blocks in the file (== state count). */
function blockCount(text: string): number {
  return (text.match(/^@<TRIPOS>MOLECULE/gm) ?? []).length;
}

/**
 * Grand `num_atoms num_bonds` totals summed across EVERY molecule block's counts
 * line (the second line of each block). PyMOL reads every block into one object,
 * so these are the totals the merged atom/bond table must match.
 */
function declaredCounts(text: string): { atoms: number; bonds: number } {
  const lines = text.split(/\r?\n/);
  let atoms = 0;
  let bonds = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^@<TRIPOS>MOLECULE/.test(lines[i]!)) {
      const nums = (lines[i + 2] ?? '')
        .trim()
        .split(/\s+/)
        .map((n) => parseInt(n, 10));
      atoms += nums[0] ?? 0;
      bonds += nums[1] ?? 0;
    }
  }
  return { atoms, bonds };
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
      // PyMOL reads EVERY molecule block into one (discrete, multi-state) object,
      // so the merged atom/bond table matches the sum over all blocks.
      const declared = declaredCounts(text);
      const nBlocks = blockCount(text);
      const mol = parseMol2(text, 'lig');

      it('parses a non-empty atom table matching every block combined', () => {
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

      it('has one Float32 coordinate state per block with finite coords', () => {
        // Single-block files stay one state; multi-block files become discrete
        // multi-state objects (one state per @<TRIPOS>MOLECULE block).
        expect(mol.states.length).toBe(nBlocks);
        expect(mol.discrete).toBe(nBlocks > 1);
        for (const set of mol.states) {
          expect(set).toBeInstanceOf(Float32Array);
          expect(set.length).toBe(mol.natom * 3);
          for (const v of set) expect(Number.isFinite(v)).toBe(true);
        }
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

  it('reads every molecule of a multi-molecule file into one discrete object', () => {
    const text = readFileSync(join(REPO, 'packages/engine/test/dat/small03.mol2'), 'utf8');
    const mol = parseMol2(text, 'all');
    // small03.mol2 holds 16 molecules totalling 389 atoms; PyMOL merges them all
    // into one 16-state discrete object (verified against the real-PyMOL oracle:
    // count_atoms=389, count_states=16, count_discrete=1). The first block
    // (AGLYSL01, 10 atoms) still leads the merged table.
    expect(mol.natom).toBe(389);
    expect(mol.states.length).toBe(16);
    expect(mol.discrete).toBe(true);
    expect(mol.atoms[0]!.resn).toBe('AGLY');
  });
});
