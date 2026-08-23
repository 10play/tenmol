/**
 * H-bond donor/acceptor perception — a port of PyMOL's two-stage chemistry
 * inference (`packages/engine/layer2/ObjectMolecule.cpp`):
 *   1. `ObjectMoleculeInferChemFromBonds` (5958) — assign each atom a `geom`
 *      (hybridization) and a `valence` (its expected total connectivity INCLUDING
 *      implicit hydrogens), from the perceived bond orders.
 *   2. `ObjectMoleculeInferHBondFromChem` (5804) — set `hb_donor`/`hb_acceptor`
 *      from valence, geom, formalCharge and the bonded-atom topology.
 *
 * Runs after {@link assignPdbKnownResidueCharges}, which supplies the formal
 * charges and Kekulé bond orders these passes read. Every atom is treated as
 * `chemFlag == false` on entry (a plain PDB carries no prior chemistry), so the
 * bond-order inference drives everything. Results are stored as
 * `hbDonor`/`hbAcceptor` on the atoms and read by the `donor`/`acceptor`
 * selectors.
 */
import type { ObjectMolecule } from './molecule';
import { canonicalElement } from './element';

// geom codes (AtomInfo.h)
const NONE = 5;
const SINGLE = 1;
const LINEAR = 2;
const PLANAR = 3;
const TETRA = 4;

/** `AtomInfoGetExpectedValence` (AtomInfo.cpp:2186) keyed by element + charge.
 *  A negative value is a *minimum* (used as its absolute value). */
function expectedValence(elem: string, fc: number): number {
  const e = canonicalElement(elem);
  if (fc === 0) {
    switch (e) {
      case 'H': case 'F': case 'Cl': case 'Br': case 'I': case 'Na': case 'Ca': case 'K': return 1;
      case 'C': return 4;
      case 'N': return 3;
      case 'O': case 'Mg': return 2;
      case 'Zn': return -1;
      case 'S': return -2;
      case 'P': return -3;
    }
  } else if (fc === 1) {
    switch (e) {
      case 'N': return 4;
      case 'O': return 3;
      case 'Na': case 'Ca': case 'K': return 0;
      case 'Mg': return 1;
      case 'Zn': return -1;
      case 'S': return -2;
      case 'P': return -3;
    }
  } else if (fc === -1) {
    switch (e) {
      case 'N': return 2;
      case 'O': return 1;
      case 'C': return 3;
      case 'Zn': return -1;
      case 'S': return -2;
      case 'P': return -3;
    }
  } else if (fc === 2) {
    switch (e) {
      case 'Mg': return 0;
      case 'Zn': return -1;
      case 'S': return -2;
      case 'P': return -3;
    }
  }
  return -1;
}

const METALS = new Set(['Fe', 'Ca', 'Cu', 'K', 'Na', 'Mg', 'Zn', 'Hg', 'Sr', 'Ba']);

/**
 * Perceive `hb_donor`/`hb_acceptor` for every atom and store them on the record.
 * `mol.bonds` carry the Kekulé orders from {@link assignPdbKnownResidueCharges}.
 */
export function inferHBond(mol: ObjectMolecule): void {
  const atoms = mol.atoms;
  const n = atoms.length;
  if (n === 0) return;

  // Adjacency with bond order: nbrs[a] = [{atm, order}], degree = nbrs[a].length.
  const nbrs: Array<Array<{ atm: number; order: number }>> = Array.from({ length: n }, () => []);
  for (const b of mol.bonds) {
    const a0 = b[0]!;
    const a1 = b[1]!;
    const o = b[2] ?? 1;
    if (a0 < 0 || a1 < 0 || a0 >= n || a1 >= n) continue;
    nbrs[a0]!.push({ atm: a1, order: o });
    nbrs[a1]!.push({ atm: a0, order: o });
  }

  // --- Stage 1: InferChemFromBonds -> geom[], valence[] ---
  const geom = new Array<number>(n).fill(0); // accumulates max bond order first
  const valSum = new Array<number>(n).fill(0); // sum of bond orders
  const valence = new Array<number>(n).fill(0);
  const chemFlag = new Array<boolean>(n).fill(false);

  for (const b of mol.bonds) {
    const a0 = b[0]!;
    const a1 = b[1]!;
    if (a0 < 0 || a1 < 0 || a0 >= n || a1 >= n) continue;
    const order = b[2] ?? 1;
    if (order > geom[a0]!) geom[a0] = order;
    valSum[a0]! += order;
    if (order > geom[a1]!) geom[a1] = order;
    valSum[a1]! += order;
    if (order === 3) {
      // triple bond -> linear; carbon keeps 2 neighbours, else 1.
      for (const a of [a0, a1]) {
        geom[a] = LINEAR;
        valence[a] = canonicalElement(atoms[a]!.elem) === 'C' ? 2 : 1;
        chemFlag[a] = true;
      }
    }
    // order === 4 (explicit aromatic) is not produced by the PDB Kekulé pass.
  }

  for (let a = 0; a < n; a++) {
    if (chemFlag[a]) continue;
    const ai = atoms[a]!;
    const nn = nbrs[a]!.length;
    let expect = expectedValence(ai.elem, ai.formalCharge ?? 0);
    const maxOrder = geom[a]!;
    if (maxOrder === 3) {
      geom[a] = LINEAR;
      valence[a] = canonicalElement(ai.elem) === 'C' ? 2 : 1;
      chemFlag[a] = true;
      continue;
    }
    if (expect < 0) expect = -expect;
    const sum = valSum[a]!;
    const geomFromMax = (): number =>
      maxOrder === 2 ? PLANAR : maxOrder === 3 ? LINEAR : expect === 1 ? SINGLE : TETRA;
    if (sum === expect) {
      valence[a] = nn;
      geom[a] = maxOrder === 0 ? NONE : geomFromMax();
    } else if (sum < expect) {
      valence[a] = nn + (expect - sum); // implicit hydrogens
      geom[a] = geomFromMax();
    } else {
      valence[a] = nn;
      geom[a] = geomFromMax();
      if (nn > 3) geom[a] = TETRA;
    }
    chemFlag[a] = true;
  }

  // Conjugated-amine planarization: an uncharged tetrahedral N bonded to a
  // planar C/N is likely delocalized -> planar (and valence 3 when neutral).
  let changed = true;
  while (changed) {
    changed = false;
    for (let a = 0; a < n; a++) {
      const ai = atoms[a]!;
      if (canonicalElement(ai.elem) !== 'N' || (ai.formalCharge ?? 0) >= 1) continue;
      if (geom[a] !== TETRA) continue;
      for (const nb of nbrs[a]!) {
        const el = canonicalElement(atoms[nb.atm]!.elem);
        if (geom[nb.atm] === PLANAR && (el === 'C' || el === 'N')) {
          geom[a] = PLANAR;
          if ((ai.formalCharge ?? 0) === 0) valence[a] = 3;
          changed = true;
          break;
        }
      }
    }
  }

  // --- Stage 2: InferHBondFromChem ---
  for (let a = 0; a < n; a++) {
    const ai = atoms[a]!;
    const el = canonicalElement(ai.elem);
    const nn = nbrs[a]!.length;
    const fc = ai.formalCharge ?? 0;
    ai.hbDonor = false;
    ai.hbAcceptor = false;

    let hasHydro = nn < valence[a]!;
    if (!hasHydro && (el === 'N' || el === 'O')) {
      for (const nb of nbrs[a]!) {
        if (canonicalElement(atoms[nb.atm]!.elem) === 'H') {
          hasHydro = true;
          break;
        }
      }
    }

    if (METALS.has(el)) {
      ai.hbDonor = true;
      continue;
    }
    if (el === 'N') {
      if (hasHydro) {
        ai.hbDonor = true;
      } else {
        let delocalized = false;
        let hasDouble = false;
        let neighborHasDouble = false;
        for (const nb of nbrs[a]!) {
          if (nb.order > 1) delocalized = true;
          if (nb.order === 2) hasDouble = true;
          for (const nb2 of nbrs[nb.atm]!) {
            if (nb2.atm !== a && nb2.order === 2) neighborHasDouble = true;
          }
        }
        if (fc <= 0 && delocalized && nn < 3) ai.hbAcceptor = true;
        if (delocalized && neighborHasDouble && !hasDouble && geom[a] === PLANAR && nn === 2 && fc >= 0)
          ai.hbDonor = true;
        if (geom[a] !== PLANAR && nn === 3 && fc >= 0 && !delocalized) ai.hbDonor = true;
      }
    } else if (el === 'O') {
      if (fc <= 0) ai.hbAcceptor = true;
      if (hasHydro) {
        ai.hbDonor = true;
      } else {
        let hasDouble = false;
        let neighborHasAromatic = false;
        for (const nb of nbrs[a]!) {
          if (nb.order === 2) hasDouble = true;
          for (const nb2 of nbrs[nb.atm]!) {
            if (nb2.atm !== a && nb2.order === 4) neighborHasAromatic = true;
          }
        }
        if (hasDouble && neighborHasAromatic && fc >= 0) ai.hbDonor = true;
      }
    }
  }
}
