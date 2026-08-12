/**
 * RED parity tests for STILL-UNPORTED selection-language keywords.
 *
 * Wave 1 already landed within/around/expand/gap/neighbor/bound_to/byres/bymol/
 * byobject/bychain/first/last, the numeric `b`/`q` comparisons, `ss`, the flag &
 * chemistry keywords and slash notation (see test/selection-ext.test.ts). This
 * file pins the selectors that are genuinely MISSING from
 * packages/engine-ts/src/select/selector.ts, deriving every expected count from
 * the vendored PyMOL ground truth in packages/engine/layer3/Selector.cpp and
 * packages/engine/layer2/ObjectMolecule*.cpp.
 *
 * Confirmed missing (each raises no keyword in selector.ts, so the port resolves
 * the bare word as an object reference and returns 0 — hence these all fail RED):
 *   - byring          (Selector.cpp SELE_RING,  keyword table line 684)
 *   - bycalpha / bca. (Selector.cpp SELE_CAS1,  line 457)
 *   - pepseq / ps.    (Selector.cpp SELE_PEPs,  line 612)
 *   - formal_charge / fc.  (SELE_FCHx, line 548; stubbed to 0 in matchCmp)
 *   - partial_charge / pc. (SELE_PCHx, line 539; stubbed to 0 in matchCmp)
 *   - altloc          (Selector.cpp SELE_ALTs alias of `alt`, line 530)
 */

import { describe, it, expect } from 'vitest';
import { LocalBackend } from '@tenmol/engine-ts';
import { SMALL_PDB } from './fixture';

async function boot() {
  const b = new LocalBackend();
  await b.connect();
  await b.call('read_pdbstr', [SMALL_PDB, 'm']);
  return b;
}

/** count_atoms that survives an unported-selector throw by returning -1, so the
 * test always reaches its assertion instead of crashing the whole file. */
async function count(b: LocalBackend, sel: string): Promise<number> {
  try {
    return (await b.call('count_atoms', [sel])) as number;
  } catch {
    return -1;
  }
}

/* ---------------------------------------------------------------------------
 * byring — atoms belonging to a ring (SSSR up to size 7).
 * Selector.cpp:8709 `case SELE_RING` runs SelectorRingFinder (maxringsize=7,
 * Selector.cpp:8670) seeded from the operand; every atom found on a ring is
 * selected. A benzene ring (6 carbons, 6 ring bonds) => all 6 are ring atoms.
 * ------------------------------------------------------------------------- */
describe('parity: byring', () => {
  it('byring selects every atom on a ring (benzene => 6)', async () => {
    const b = new LocalBackend();
    await b.connect();
    // Regular hexagon of carbons, side 1.39 A, closed by 6 alternating bonds.
    const benzene = [
      '',
      '  parity',
      '',
      '  6  6  0  0  0  0  0  0  0  0999 V2000',
      '    1.3900    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
      '    0.6950    1.2038    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
      '   -0.6950    1.2038    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
      '   -1.3900    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
      '   -0.6950   -1.2038    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
      '    0.6950   -1.2038    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
      '  1  2  2  0',
      '  2  3  1  0',
      '  3  4  2  0',
      '  4  5  1  0',
      '  5  6  2  0',
      '  6  1  1  0',
      'M  END',
    ].join('\n');
    await b.call('read_molstr', [benzene, 'ring']);
    expect(await count(b, 'all')).toBe(6); // fixture sanity: all 6 carbons loaded
    // PyMOL ref: SelectorRingFinder marks all six ring members.
    expect(await count(b, 'byring all')).toBe(6); // RED: byring unported -> 0
  });
});

/* ---------------------------------------------------------------------------
 * bycalpha / bca. — expand to whole residue, then keep only the CA atom.
 * Selector.cpp:8785 handles SELE_CAS1 as SELE_BYR1 (grow to the whole residue)
 * then Selector.cpp:8835 keeps only atoms where protons==C and name=="CA".
 * On the ALA(A/1)+GLY(B/2) di-peptide: one CA per residue => 2.
 * ------------------------------------------------------------------------- */
describe('parity: bycalpha', () => {
  it('bycalpha keeps the C-alpha of every touched residue', async () => {
    const b = await boot();
    // PyMOL ref: bycalpha(all) -> {ALA:CA, GLY:CA} = 2 alpha carbons.
    expect(await count(b, 'bycalpha all')).toBe(2); // RED: bycalpha unported -> 0
    // Restricting to chain A leaves only ALA's CA.
    expect(await count(b, 'bycalpha (chain A)')).toBe(1); // RED
  });
});

/* ---------------------------------------------------------------------------
 * pepseq / ps. — one-letter peptide-sequence motif; selects EVERY atom of each
 * residue in a matching consecutive stretch.
 * Selector.cpp:7738 `case SELE_PEPs` walks residues in table order, matching the
 * one-letter code (SeekerGetAbbr) against the pattern; on a hit it flags the
 * complete residue (inner d-loop, Selector.cpp:7772). ALA=A, GLY=G, so pattern
 * "AG" matches the ALA->GLY pair and selects all 9 atoms.
 * ------------------------------------------------------------------------- */
describe('parity: pepseq', () => {
  it('pepseq matches a one-letter motif and selects whole residues', async () => {
    const b = await boot();
    // PyMOL ref: pepseq AG -> full ALA (5) + full GLY (4) = 9 atoms.
    expect(await count(b, 'pepseq AG')).toBe(9); // RED: pepseq unported -> 0
    // A single-letter motif selects just that residue.
    expect(await count(b, 'pepseq G')).toBe(4); // RED: whole GLY
  });
});

/* ---------------------------------------------------------------------------
 * formal_charge / fc. — numeric comparison against the per-atom formal charge.
 * Selector.cpp:8532/8561 compares at1->formalCharge; the MOL V2000 reader loads
 * it from `M  CHG` records (ObjectMolecule.cpp:7861-7864). The TS port has no
 * formalCharge field and matchCmp() returns 0 for the `fc` field, so any nonzero
 * comparison is wrong today.
 * ------------------------------------------------------------------------- */
describe('parity: formal_charge', () => {
  it('fc. compares the real per-atom formal charge', async () => {
    const b = new LocalBackend();
    await b.connect();
    // 3 atoms; M CHG assigns atom1 = +1, atom2 = -1, atom3 unset (0).
    const mol = [
      '',
      '  parity',
      '',
      '  3  0  0  0  0  0  0  0  0  0999 V2000',
      '    0.0000    0.0000    0.0000 N   0  0  0  0  0  0  0  0  0  0  0  0',
      '    1.2000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0',
      '    2.4000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
      'M  CHG  2   1   1   2  -1',
      'M  END',
    ].join('\n');
    await b.call('read_molstr', [mol, 'chg']);
    expect(await count(b, 'all')).toBe(3); // fixture sanity
    // PyMOL ref: exactly the N carries formal charge +1.
    expect(await count(b, 'fc. = 1')).toBe(1); // RED: fc stubbed to 0 -> 0
    // And exactly the O carries -1.
    expect(await count(b, 'formal_charge = -1')).toBe(1); // RED
  });
});

/* ---------------------------------------------------------------------------
 * partial_charge / pc. — numeric comparison against the per-atom partial charge.
 * Selector.cpp:8531/8560 compares at1->partialCharge; the MOL2 reader loads it
 * from the trailing charge column (ObjectMolecule.cpp:8286). The TS port drops
 * the MOL2 charge column and matchCmp() returns 0 for `pc`, so any comparison
 * against a nonzero threshold is wrong today.
 * ------------------------------------------------------------------------- */
describe('parity: partial_charge', () => {
  it('pc. compares the real per-atom partial charge', async () => {
    const b = new LocalBackend();
    await b.connect();
    // MOL2 charge column: +0.5, -0.5, 0.0 across three atoms.
    const mol2 = [
      '@<TRIPOS>MOLECULE',
      'chg',
      '    3     0     1     0     0',
      'SMALL',
      'USER_CHARGES',
      '',
      '@<TRIPOS>ATOM',
      '      1 N1        0.0000   0.0000   0.0000 N.3     1  LIG1        0.5000',
      '      2 O1        1.2000   0.0000   0.0000 O.3     1  LIG1       -0.5000',
      '      3 C1        2.4000   0.0000   0.0000 C.3     1  LIG1        0.0000',
      '@<TRIPOS>BOND',
    ].join('\n');
    await b.call('read_mol2str', [mol2, 'chg']);
    expect(await count(b, 'all')).toBe(3); // fixture sanity
    // PyMOL ref: only N1 has partial charge > 0.
    expect(await count(b, 'pc. > 0')).toBe(1); // RED: pc stubbed to 0 -> 0
    // Only O1 has partial charge < 0.
    expect(await count(b, 'partial_charge < 0')).toBe(1); // RED
  });
});

/* ---------------------------------------------------------------------------
 * altloc — alias of `alt` (Selector.cpp:530-531 both map to SELE_ALTs).
 * The port only registers `alt`/`alt.`, not the full `altloc` spelling, so
 * `altloc A` resolves as an object reference and selects nothing.
 * ------------------------------------------------------------------------- */
describe('parity: altloc alias', () => {
  it('altloc selects by alternate-location identifier like alt', async () => {
    const b = new LocalBackend();
    await b.connect();
    // Two atoms at altloc A, two at altloc B (PDB column 17).
    const pdb = [
      'ATOM      1  N  AALA A   1       0.000   0.000   0.000  0.50  0.00           N',
      'ATOM      2  N  BALA A   1       0.100   0.000   0.000  0.50  0.00           N',
      'ATOM      3  CA AALA A   1       1.458   0.000   0.000  0.50  0.00           C',
      'ATOM      4  CA BALA A   1       1.558   0.000   0.000  0.50  0.00           C',
      'END',
    ].join('\n');
    await b.call('read_pdbstr', [pdb, 'alt']);
    expect(await count(b, 'all')).toBe(4); // fixture sanity
    // PyMOL ref: altloc == alt, so `altloc A` selects the two A conformers.
    expect(await count(b, 'altloc A')).toBe(2); // RED: altloc unported -> 0
  });
});
