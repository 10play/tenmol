/**
 * Distance-based connectivity — the shared bond-inference pass used by every
 * loader that lacks explicit bonds (PDB without CONECT, XYZ, most CIF).
 *
 * Two atoms bond when their separation is within the sum of their covalent radii
 * plus a slack of {@link CONNECT_CUTOFF}. O(n²) over the first state; the covered
 * corpus is small (a spatial grid is a later optimisation, see the backlog).
 */
import { canonicalElement } from './element';
import type { ObjectMolecule } from './molecule';

/** Covalent radii (Å) for the distance-bonding pass. Common biomolecular set. */
const COVALENT: Readonly<Record<string, number>> = {
  H: 0.31,
  C: 0.76,
  N: 0.71,
  O: 0.66,
  F: 0.57,
  P: 1.07,
  S: 1.05,
  Cl: 1.02,
  Se: 1.2,
  Br: 1.2,
  Fe: 1.32,
  Zn: 1.22,
  Mg: 1.41,
  Ca: 1.76,
  Na: 1.66,
  K: 2.03,
};
const DEFAULT_COVALENT = 0.77;
const CONNECT_CUTOFF = 0.35;

/** Covalent radius (Å) for an element token, defaulting for the unknown. */
export function covalent(elem: string): number {
  // A file-controlled element token can be `__proto__` / `constructor` etc.;
  // `COVALENT[key]` would then resolve to an inherited Object.prototype member
  // (not undefined), so the `??` fallback would never fire and a non-number
  // would poison the distance maths. Guard on the value actually being a number.
  const r = COVALENT[canonicalElement(elem)];
  return typeof r === 'number' ? r : DEFAULT_COVALENT;
}

/**
 * A deduping bond adder bound to `mol.bonds`: stores each undirected pair once,
 * smaller 0-based index first. Loaders with an explicit bond block use this too.
 */
export function makeBondAdder(mol: ObjectMolecule): (a: number, b: number) => void {
  const seen = new Set<string>();
  for (const [a, b] of mol.bonds) seen.add(a < b ? `${a}:${b}` : `${b}:${a}`);
  return (a, b) => {
    if (a === b) return;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    mol.bonds.push(a < b ? [a, b] : [b, a]);
  };
}

/** Infer bonds by interatomic distance over the first state, adding via `addBond`. */
export function connectByDistance(
  mol: ObjectMolecule,
  addBond: (a: number, b: number) => void = makeBondAdder(mol),
): void {
  const set = mol.states[0];
  if (!set) return;
  const n = mol.natom;
  for (let i = 0; i < n; i++) {
    const ri = covalent(mol.atoms[i]!.elem);
    const xi = set[i * 3]!;
    const yi = set[i * 3 + 1]!;
    const zi = set[i * 3 + 2]!;
    for (let j = i + 1; j < n; j++) {
      const cutoff = ri + covalent(mol.atoms[j]!.elem) + CONNECT_CUTOFF;
      const dx = xi - set[j * 3]!;
      const dy = yi - set[j * 3 + 1]!;
      const dz = zi - set[j * 3 + 2]!;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 0.01 && d2 <= cutoff * cutoff) addBond(i, j);
    }
  }
}
