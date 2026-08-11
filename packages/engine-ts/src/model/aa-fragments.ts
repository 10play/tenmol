/**
 * Amino-acid fragment library — the real chempy fragment geometry extracted
 * from PyMOL's `data/chempy/fragments/*.pkl` into {@link aaFragments}.
 *
 * Each entry is a complete residue in its pickled internal frame: heavy atoms
 * plus hydrogens (a single amide `H` on the backbone `N`, matching the plain
 * mid-chain `ala`/`gly`/… fragments PyMOL's `editor.attach_amino_acid` loads —
 * no `OXT`, no N-terminal caps), with 0-based bond index pairs. `editor.ts`
 * superposes the `N,CA,C` triple onto a backbone terminus to grow a residue.
 */

import raw from './aa-fragments.json';

export interface FragmentAtom {
  name: string;
  elem: string;
  x: number;
  y: number;
  z: number;
}

export interface AminoAcidFragment {
  atoms: FragmentAtom[];
  bonds: Array<[number, number]>;
}

/** resn (uppercase 3-letter) -> fragment geometry. (JSON bond pairs are typed
 * structurally as `number[][]`; the extractor guarantees length-2 pairs.) */
const FRAGMENTS = raw as unknown as Record<string, AminoAcidFragment>;

/** One-letter -> three-letter code, for `build_peptide` sequences. */
const ONE_TO_THREE: Readonly<Record<string, string>> = {
  A: 'ALA',
  R: 'ARG',
  N: 'ASN',
  D: 'ASP',
  C: 'CYS',
  Q: 'GLN',
  E: 'GLU',
  G: 'GLY',
  H: 'HIS',
  I: 'ILE',
  L: 'LEU',
  K: 'LYS',
  M: 'MET',
  F: 'PHE',
  P: 'PRO',
  S: 'SER',
  T: 'THR',
  W: 'TRP',
  Y: 'TYR',
  V: 'VAL',
};

/**
 * Resolve a residue token — a one-letter code (`G`), a three-letter code
 * (`gly`/`GLY`), case-insensitive — to the uppercase 3-letter key of a fragment
 * that exists in the library, or `null` when there is no such fragment.
 */
export function resolveAminoAcidCode(token: string): string | null {
  const t = token.trim().toUpperCase();
  if (t.length >= 3 && t in FRAGMENTS) return t;
  if (t.length === 1) {
    const three = ONE_TO_THREE[t];
    if (three && three in FRAGMENTS) return three;
  }
  return null;
}

/** The fragment for a residue token (1- or 3-letter), or `null` if unknown. */
export function getAminoAcidFragment(token: string): AminoAcidFragment | null {
  const key = resolveAminoAcidCode(token);
  return key ? (FRAGMENTS[key] ?? null) : null;
}

/** Every residue name the library carries (uppercase 3-letter). */
export function aminoAcidNames(): string[] {
  return Object.keys(FRAGMENTS);
}
