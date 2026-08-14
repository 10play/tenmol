/**
 * Built-in molecular fragments — `cmd.fragment(name)`.
 *
 * Upstream PyMOL reads these from pickled chempy fragments
 * (`data/chempy/fragments/*.pkl`). The port ships a small library of the common
 * amino-acid fragments as heavy-atom coordinate sets, rendered through the same
 * PDB path so bonding and reps come out identically. Exact coordinate parity
 * with the pickles is a follow-up (fragments are not in the differential gate);
 * this is enough for `fragment ala` and friends to load and render.
 */

import { ObjectMolecule } from './molecule';
import { defaultVisRep } from './atom';
import { parsePdb } from './pdb';
import { getAminoAcidFragment, resolveAminoAcidCode } from './aa-fragments';

interface FragAtom {
  name: string;
  elem: string;
  x: number;
  y: number;
  z: number;
}

/** Heavy-atom coordinate sets, roughly idealised residue geometry (Å). */
const FRAGMENTS: Readonly<Record<string, FragAtom[]>> = {
  gly: [
    { name: 'N', elem: 'N', x: 0.0, y: 0.0, z: 0.0 },
    { name: 'CA', elem: 'C', x: 1.458, y: 0.0, z: 0.0 },
    { name: 'C', elem: 'C', x: 2.009, y: 1.42, z: 0.0 },
    { name: 'O', elem: 'O', x: 1.251, y: 2.39, z: 0.0 },
  ],
  ala: [
    { name: 'N', elem: 'N', x: 0.0, y: 0.0, z: 0.0 },
    { name: 'CA', elem: 'C', x: 1.458, y: 0.0, z: 0.0 },
    { name: 'C', elem: 'C', x: 2.009, y: 1.42, z: 0.0 },
    { name: 'O', elem: 'O', x: 1.251, y: 2.39, z: 0.0 },
    { name: 'CB', elem: 'C', x: 2.0, y: -0.785, z: -1.207 },
  ],
  ser: [
    { name: 'N', elem: 'N', x: 0.0, y: 0.0, z: 0.0 },
    { name: 'CA', elem: 'C', x: 1.458, y: 0.0, z: 0.0 },
    { name: 'C', elem: 'C', x: 2.009, y: 1.42, z: 0.0 },
    { name: 'O', elem: 'O', x: 1.251, y: 2.39, z: 0.0 },
    { name: 'CB', elem: 'C', x: 2.0, y: -0.785, z: -1.207 },
    { name: 'OG', elem: 'O', x: 3.404, y: -0.68, z: -1.42 },
  ],
  cys: [
    { name: 'N', elem: 'N', x: 0.0, y: 0.0, z: 0.0 },
    { name: 'CA', elem: 'C', x: 1.458, y: 0.0, z: 0.0 },
    { name: 'C', elem: 'C', x: 2.009, y: 1.42, z: 0.0 },
    { name: 'O', elem: 'O', x: 1.251, y: 2.39, z: 0.0 },
    { name: 'CB', elem: 'C', x: 2.0, y: -0.785, z: -1.207 },
    { name: 'SG', elem: 'S', x: 3.79, y: -0.68, z: -1.42 },
  ],
  phe: [
    { name: 'N', elem: 'N', x: 0.0, y: 0.0, z: 0.0 },
    { name: 'CA', elem: 'C', x: 1.458, y: 0.0, z: 0.0 },
    { name: 'C', elem: 'C', x: 2.009, y: 1.42, z: 0.0 },
    { name: 'O', elem: 'O', x: 1.251, y: 2.39, z: 0.0 },
    { name: 'CB', elem: 'C', x: 2.0, y: -0.785, z: -1.207 },
    { name: 'CG', elem: 'C', x: 3.496, y: -0.943, z: -1.4 },
    { name: 'CD1', elem: 'C', x: 4.098, y: -2.2, z: -1.44 },
    { name: 'CD2', elem: 'C', x: 4.28, y: 0.196, z: -1.55 },
    { name: 'CE1', elem: 'C', x: 5.474, y: -2.316, z: -1.63 },
    { name: 'CE2', elem: 'C', x: 5.656, y: 0.08, z: -1.74 },
    { name: 'CZ', elem: 'C', x: 6.258, y: -1.177, z: -1.78 },
  ],
  leu: [
    { name: 'N', elem: 'N', x: 0.0, y: 0.0, z: 0.0 },
    { name: 'CA', elem: 'C', x: 1.458, y: 0.0, z: 0.0 },
    { name: 'C', elem: 'C', x: 2.009, y: 1.42, z: 0.0 },
    { name: 'O', elem: 'O', x: 1.251, y: 2.39, z: 0.0 },
    { name: 'CB', elem: 'C', x: 2.0, y: -0.785, z: -1.207 },
    { name: 'CG', elem: 'C', x: 3.535, y: -0.85, z: -1.32 },
    { name: 'CD1', elem: 'C', x: 4.05, y: -1.66, z: -2.51 },
    { name: 'CD2', elem: 'C', x: 4.16, y: -1.42, z: -0.04 },
  ],
};

function pad(s: string, width: number, right = true): string {
  const t = s.slice(0, width);
  const fill = ' '.repeat(Math.max(0, width - t.length));
  return right ? fill + t : t + fill;
}

function toPdb(atoms: FragAtom[], resn: string): string {
  const lines = atoms.map((a, i) => {
    const cols = ' '.repeat(80).split('');
    const put = (start: number, text: string): void => {
      for (let k = 0; k < text.length; k++) cols[start - 1 + k] = text[k]!;
    };
    put(1, 'ATOM  ');
    put(7, pad(String(i + 1), 5));
    put(13, a.name.length >= 4 ? a.name : ' ' + pad(a.name, 3, false));
    put(18, pad(resn.toUpperCase(), 3, false));
    put(22, 'A');
    put(23, pad('1', 4));
    put(31, pad(a.x.toFixed(3), 8));
    put(39, pad(a.y.toFixed(3), 8));
    put(47, pad(a.z.toFixed(3), 8));
    put(55, pad('1.00', 6));
    put(61, pad('0.00', 6));
    put(77, pad(a.elem, 2));
    return cols.join('').replace(/\s+$/, '');
  });
  return lines.join('\n') + '\nEND\n';
}

export function fragmentNames(): string[] {
  return Object.keys(FRAGMENTS);
}

export function hasFragment(name: string): boolean {
  return name.toLowerCase() in FRAGMENTS;
}

/**
 * Build the {@link ObjectMolecule} for `cmd.fragment(name)`, or `null` if the
 * fragment is not in the port's library.
 */
export function buildFragment(name: string, object: string): ObjectMolecule | null {
  const atoms = FRAGMENTS[name.toLowerCase()];
  if (!atoms) return null;
  return parsePdb(toPdb(atoms, name), object);
}

/**
 * Build the {@link ObjectMolecule} for `cmd.fragment(name)` from the real
 * chempy fragment library (`aa-fragments.json`) — complete residues with
 * hydrogens and explicit bonds, matching real PyMOL's `data/chempy/fragments`
 * pickles atom-for-atom (e.g. `fragment ala` → 10 atoms). Falls back to the
 * heavy-atom-only {@link buildFragment} table for any name the amino-acid
 * library does not carry. Returns `null` when the fragment is unknown.
 */
export function buildLibraryFragment(name: string, object: string): ObjectMolecule | null {
  const frag = getAminoAcidFragment(name);
  if (!frag) return buildFragment(name, object);
  const resn = resolveAminoAcidCode(name) ?? name.toUpperCase();
  const mol = new ObjectMolecule(object);
  const coords: number[] = [];
  frag.atoms.forEach((fa, i) => {
    mol.atoms.push({
      id: i + 1,
      name: fa.name,
      resn,
      resi: '1',
      resv: 1,
      chain: '',
      segi: '',
      alt: '',
      elem: fa.elem,
      hetatm: false,
      b: 0,
      q: 1,
      color: 0,
      ss: '',
      visRep: defaultVisRep(),
    });
    coords.push(fa.x, fa.y, fa.z);
  });
  mol.states.push(Float32Array.from(coords));
  for (const [i, j] of frag.bonds) mol.bonds.push(i < j ? [i, j] : [j, i]);
  return mol;
}
