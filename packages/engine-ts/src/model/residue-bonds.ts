/**
 * Standard-residue intra-residue bond-order templates, extracted verbatim from
 * the vendored `chempy/bonds.py` (`scripts/extract-residue-bonds` → this JSON).
 * Used to *perceive* bond orders on structures loaded without them (e.g. PDB,
 * whose bonds are a distance heuristic) so valence-aware operations — `h_add`,
 * `protonate`, `cycle_valence` — fill the right number of hydrogens (a backbone
 * carbonyl O is double-bonded, so it takes zero H).
 */
import raw from './residue-bonds.json';

interface Template {
  /** atom-name variant → canonical name (e.g. `OT1` → `O`, `1HB` → `HB1`). */
  aliases: Record<string, string>;
  /** canonical bonds as `[nameA, nameB, order]` (order 1/2/3, 4 = aromatic). */
  bonds: Array<[string, string, number]>;
}

const TEMPLATES = raw as unknown as Record<string, Template>;

function canonical(t: Template, name: string): string | undefined {
  return t.aliases[name] ?? t.aliases[name.toUpperCase()];
}

/**
 * The template order of the intra-residue bond between two atom names in `resn`,
 * or `undefined` when the residue or atom pair isn't in the standard template.
 */
export function templateBondOrder(
  resn: string,
  nameA: string,
  nameB: string,
): number | undefined {
  const t = TEMPLATES[resn.toUpperCase()];
  if (!t) return undefined;
  const cA = canonical(t, name(nameA));
  const cB = canonical(t, name(nameB));
  if (cA === undefined || cB === undefined) return undefined;
  for (const [n1, n2, order] of t.bonds) {
    if ((n1 === cA && n2 === cB) || (n1 === cB && n2 === cA)) return order;
  }
  return undefined;
}

/** True when a standard-residue template exists for `resn`. */
export function hasResidueTemplate(resn: string): boolean {
  return Object.prototype.hasOwnProperty.call(TEMPLATES, resn.toUpperCase());
}

const name = (s: string): string => s.trim();
