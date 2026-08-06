/**
 * A tiny, fully-deterministic structure for the engine tests and the parity
 * corpus: a two-residue di-peptide across two chains, written through a
 * column-exact PDB formatter so the expected selection counts are derivable by
 * hand and the coordinates round-trip through float32 unchanged.
 */

export interface FixtureAtom {
  serial: number;
  name: string;
  resn: string;
  chain: string;
  resi: number;
  x: number;
  y: number;
  z: number;
  elem: string;
  hetatm?: boolean;
}

/** ALA (chain A, resi 1) + GLY (chain B, resi 2): 9 atoms. */
export const FIXTURE_ATOMS: FixtureAtom[] = [
  { serial: 1, name: 'N', resn: 'ALA', chain: 'A', resi: 1, x: 0.0, y: 0.0, z: 0.0, elem: 'N' },
  { serial: 2, name: 'CA', resn: 'ALA', chain: 'A', resi: 1, x: 1.458, y: 0.0, z: 0.0, elem: 'C' },
  { serial: 3, name: 'C', resn: 'ALA', chain: 'A', resi: 1, x: 2.0, y: 1.42, z: 0.0, elem: 'C' },
  { serial: 4, name: 'O', resn: 'ALA', chain: 'A', resi: 1, x: 1.25, y: 2.39, z: 0.0, elem: 'O' },
  { serial: 5, name: 'CB', resn: 'ALA', chain: 'A', resi: 1, x: 2.0, y: -0.77, z: 1.2, elem: 'C' },
  { serial: 6, name: 'N', resn: 'GLY', chain: 'B', resi: 2, x: 3.33, y: 1.5, z: 0.0, elem: 'N' },
  { serial: 7, name: 'CA', resn: 'GLY', chain: 'B', resi: 2, x: 4.0, y: 2.79, z: 0.0, elem: 'C' },
  { serial: 8, name: 'C', resn: 'GLY', chain: 'B', resi: 2, x: 5.5, y: 2.66, z: 0.0, elem: 'C' },
  { serial: 9, name: 'O', resn: 'GLY', chain: 'B', resi: 2, x: 6.1, y: 3.7, z: 0.0, elem: 'O' },
];

function pad(s: string, width: number, right = true): string {
  const t = s.slice(0, width);
  const fill = ' '.repeat(Math.max(0, width - t.length));
  return right ? fill + t : t + fill;
}

/** Format one atom as a column-exact PDB ATOM/HETATM record (80 cols). */
function formatAtom(a: FixtureAtom): string {
  const cols = ' '.repeat(80).split('');
  const put = (start: number, text: string): void => {
    for (let i = 0; i < text.length; i++) cols[start - 1 + i] = text[i]!;
  };
  put(1, a.hetatm ? 'HETATM' : 'ATOM  ');
  put(7, pad(String(a.serial), 5));
  // Atom name: PDB left-justifies names of <4 chars starting at col 14.
  put(13, a.name.length >= 4 ? a.name : ' ' + pad(a.name, 3, false));
  put(18, pad(a.resn, 3, false));
  put(22, a.chain);
  put(23, pad(String(a.resi), 4));
  put(31, pad(a.x.toFixed(3), 8));
  put(39, pad(a.y.toFixed(3), 8));
  put(47, pad(a.z.toFixed(3), 8));
  put(55, pad('1.00', 6));
  put(61, pad('0.00', 6));
  put(77, pad(a.elem, 2));
  return cols.join('').replace(/\s+$/, '');
}

/** Build column-exact PDB text from an atom list (for ad-hoc test inputs). */
export function makePdb(atoms: FixtureAtom[]): string {
  return atoms.map(formatAtom).join('\n') + '\nEND\n';
}

/** The fixture as PDB text. */
export const SMALL_PDB: string = makePdb(FIXTURE_ATOMS);

/** Expected, hand-derived counts — the ground truth PyMOL also produces. */
export const EXPECTED = {
  total: 9,
  ca: 2,
  chainA: 5,
  chainB: 4,
  elemC: 5,
  elemN: 2,
  elemO: 2,
  resi1: 5,
  cb: 1,
};
