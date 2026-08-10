/**
 * Element identity and Van-der-Waals radii.
 *
 * Ports the subset of PyMOL's element table (`packages/engine/layer2/AtomInfo.cpp`,
 * the `ElementTableRec ElementTable[]`) that the covered representations need:
 * the VDW radius drives the `spheres` rep radius (`vdw * sphere_scale`), and the
 * canonical symbol drives element-based selection (`elem C`) and CPK colouring.
 *
 * Values are the PyMOL defaults; a symbol not in the table falls back to the
 * PyMOL "generic" radius of 1.80 Å (`ElementTable` tail entry).
 */

export interface ElementRec {
  symbol: string;
  /** Van-der-Waals radius in Ångström. */
  vdw: number;
}

/** PyMOL default VDW radii, keyed by canonical (title-case) symbol. */
const ELEMENTS: Readonly<Record<string, number>> = {
  H: 1.2,
  He: 1.4,
  Li: 1.82,
  Be: 2.0,
  B: 2.0,
  C: 1.7,
  N: 1.55,
  O: 1.52,
  F: 1.47,
  Ne: 1.54,
  Na: 2.27,
  Mg: 1.73,
  Al: 2.0,
  Si: 2.1,
  P: 1.8,
  S: 1.8,
  Cl: 1.75,
  Ar: 1.88,
  K: 2.75,
  Ca: 1.9,
  Mn: 2.05,
  Fe: 1.1,
  Co: 2.0,
  Ni: 2.0,
  Cu: 2.0,
  Zn: 2.1,
  Se: 1.9,
  Br: 1.85,
  I: 1.98,
};

/** PyMOL's fallback radius for an element with no table entry. */
export const DEFAULT_VDW = 1.8;

/**
 * Canonicalise a raw element token to PyMOL's title-case symbol: first letter
 * upper, rest lower ('FE' -> 'Fe', 'c' -> 'C'). PyMOL stores `elem` this way
 * (`AtomInfoAssignParameters`), and selection/colour parity depends on it.
 */
export function canonicalElement(raw: string): string {
  const t = raw.trim();
  if (t === '') return '';
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

export function vdwForElement(symbol: string): number {
  return ELEMENTS[canonicalElement(symbol)] ?? DEFAULT_VDW;
}

export function isKnownElement(symbol: string): boolean {
  return canonicalElement(symbol) in ELEMENTS;
}
