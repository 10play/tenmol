/**
 * Formal-charge and bond-order perception for standard PDB residues — a faithful
 * port of `assign_pdb_known_residue` (`packages/engine/layer2/ObjectMolecule2.cpp:837`),
 * driven from the distance-bond perception in `ObjectMoleculeConnect`
 * (`ObjectMolecule2.cpp:3798`).
 *
 * Real PyMOL, while perceiving connectivity, both (1) assigns integer formal
 * charges to well-known ionisable atoms — LYS `NZ` (+1), ARG `NH1` (+1, `NH2`
 * forced to 0), deprotonated ASP `OD2` / GLU `OE2` (−1), protonated-His `ND1`
 * (+1), C-terminal `OXT` (−1), nucleotide phosphate `O2P`/`OP2` (−1) — and
 * (2) raises the tentative bond ORDER to 2 for the backbone carbonyl and the
 * aromatic/double bonds of standard residues and nucleobases. Without this pass
 * the TS engine leaves every `formalCharge` at 0 and every bond order at 1, so
 * `fc.`/`formal_charge` and `delocalized`/`deloc.` selections diverge from the
 * oracle.
 *
 * The load caller's guard is `!ai1->hetatm || resn == MSE` plus
 * `AtomInfoSameResidue`. Bond order is stored in the optional 3rd element of the
 * engine's `[a, b, order?]` bond tuple.
 */
import type { ObjectMolecule } from './molecule';
import type { AtomInfo } from './atom';

/** `AtomInfoKnownProteinResName` (AtomInfo.cpp:594) — compared as loaded. */
const KNOWN_PROTEIN = new Set([
  'ALA', 'ARG', 'ASN', 'ASP', 'CYS', 'CYX', 'GLN', 'GLU', 'GLY', 'HID', 'HIE',
  'HIP', 'HIS', 'ILE', 'LEU', 'LYS', 'MET', 'MSE', 'PHE', 'PRO', 'PTR', 'SER',
  'THR', 'TRP', 'TYR', 'VAL',
]);

/** Same-residue test mirroring `AtomInfoSameResidue`. */
function sameResidue(a: AtomInfo, b: AtomInfo): boolean {
  return (
    a.resv === b.resv &&
    a.chain === b.chain &&
    a.hetatm === b.hetatm &&
    a.segi === b.segi &&
    a.resi === b.resi &&
    a.resn === b.resn
  );
}

/** Apply PyMOL's known-residue charge + bond-order assignment over every
 *  intra-residue bond. */
export function assignPdbKnownResidueCharges(mol: ObjectMolecule): void {
  const atoms = mol.atoms;
  for (const bond of mol.bonds) {
    const ai1 = atoms[bond[0]!];
    const ai2 = atoms[bond[1]!];
    if (!ai1 || !ai2) continue;
    if (ai1.hetatm && ai1.resn !== 'MSE') continue;
    if (!sameResidue(ai1, ai2)) continue;

    const name1 = ai1.name;
    const name2 = ai2.name;
    const resn = ai1.resn;
    const r1 = resn.charAt(1);
    const r2 = resn.charAt(2);
    const r3 = resn.charAt(3);

    // Unordered name-pair test for the two bond endpoints.
    const pair = (x: string, y: string): boolean =>
      (name1 === x && name2 === y) || (name1 === y && name2 === x);
    const setOrder = (o: number): void => {
      bond[2] = o;
    };

    // 1) backbone carbonyl C=O of any known protein residue → double bond.
    if (pair('C', 'O') && KNOWN_PROTEIN.has(resn)) {
      setOrder(2);
      continue;
    }
    // 2) C-terminal carboxylate OXT (−1); leaves the OXT–C bond order at 1.
    if (name2 === 'C' && name1 === 'OXT') {
      ai1.formalCharge = -1;
      continue;
    }
    if (name1 === 'C' && name2 === 'OXT') {
      ai2.formalCharge = -1;
      continue;
    }

    const setIf = (target: string, charge: number): void => {
      if (name1 === target) ai1.formalCharge = charge;
      else if (name2 === target) ai2.formalCharge = charge;
    };
    const phosphateMinus = (): void => {
      if (name1 === 'O2P' || name1 === 'OP2') ai1.formalCharge = -1;
      else if (name2 === 'O2P' || name2 === 'OP2') ai2.formalCharge = -1;
    };
    // Nucleotide base + phosphate double bonds shared by A/C/G/I/T/U (+ D*).
    const phosphoDouble = (): void => {
      if (pair('P', 'O1P') || pair('P', 'OP1')) setOrder(2);
    };
    const purineDouble = (): void => {
      if (pair('C8', 'N7') || pair('C4', 'C5') || pair('C6', 'N1') || pair('C2', 'N3')) setOrder(2);
      else phosphoDouble();
    };

    switch (resn.charAt(0)) {
      case 'A':
        if (r1 === 'R') {
          // ARG/ARGP — guanidinium: NH1 = +1, NH2 = 0; CZ=NH1 double, CZ–NH2 single.
          if (r2 === 'G' && (r3 === '' || r3 === 'P')) {
            setIf('NH1', 1);
            setIf('NH2', 0);
          }
          if (pair('CZ', 'NH1')) setOrder(2);
          else if (pair('CZ', 'NH2')) setOrder(1);
        } else if (r1 === 'S' && r2 === 'P') {
          // ASP/ASPM
          if (r3 === '' || r3 === 'M') setIf('OD2', -1);
          if (pair('CG', 'OD1')) setOrder(2);
        } else if (r1 === 'S' && r2 === 'N') {
          if (pair('CG', 'OD1')) setOrder(2); // ASN
        } else if (r1 === '') {
          phosphateMinus(); // adenine "A"
          purineDouble();
        }
        break;
      case 'C':
        if (r1 === '') {
          phosphateMinus(); // cytidine "C"
          if (pair('C2', 'O2') || pair('C4', 'N3') || pair('C5', 'C6')) setOrder(2);
          else phosphoDouble();
        }
        break;
      case 'D': // deoxynucleotides DA/DC/DT/DG/DU
        if (r2 === '') {
          if (r1 === 'A') {
            phosphateMinus();
            purineDouble();
          } else if (r1 === 'C') {
            phosphateMinus();
            if (pair('C2', 'O2') || pair('C4', 'N3') || pair('C5', 'C6')) setOrder(2);
            else phosphoDouble();
          } else if (r1 === 'T') {
            phosphateMinus();
            if (pair('C2', 'O2') || pair('C4', 'O4') || pair('C5', 'C6')) setOrder(2);
            else phosphoDouble();
          } else if (r1 === 'G') {
            phosphateMinus();
            if (pair('C6', 'O6') || pair('C2', 'N3') || pair('C8', 'N7') || pair('C4', 'C5'))
              setOrder(2);
            else phosphoDouble();
          } else if (r1 === 'U') {
            phosphateMinus();
            if (pair('C2', 'O2') || pair('C4', 'O4') || pair('C5', 'C6')) setOrder(2);
            else phosphoDouble();
          }
        }
        break;
      case 'G':
        if (r1 === 'L' && r2 === 'U') {
          if (r3 === '' || r3 === 'M') setIf('OE2', -1); // GLU/GLUM
          if (pair('CD', 'OE1')) setOrder(2);
        } else if (r1 === 'L' && r2 === 'N') {
          if (pair('CD', 'OE1')) setOrder(2); // GLN
        } else if (r1 === '') {
          phosphateMinus(); // guanosine "G"
          if (pair('C6', 'O6') || pair('C2', 'N3') || pair('C8', 'N7') || pair('C4', 'C5'))
            setOrder(2);
          else phosphoDouble();
        }
        break;
      case 'H':
        if (r1 === 'I') {
          const prot = r2 === 'P' || (r2 === 'S' && (r3 === 'H' || r3 === 'P'));
          if (prot) setIf('ND1', 1); // HIP / HISH / HISP
          // Ring double bonds: CG=CD2 always; the second depends on tautomer.
          if (pair('CG', 'CD2')) setOrder(2);
          else if (r2 === 'D' || (r2 === 'S' && r3 === 'A') || (r2 === 'S' && r3 === 'D')) {
            if (pair('CE1', 'NE2')) setOrder(2); // HID / HISA / HISD
          } else if (pair('CE1', 'ND1')) setOrder(2); // HIS/HIE/HIP/HISB/HISE/HISH/HISP
        }
        break;
      case 'I':
        if (r1 === '') {
          phosphateMinus(); // inosine "I"
          purineDouble();
        }
        break;
      case 'L':
        if (r1 === 'Y' && r2 === 'S' && (r3 === '' || r3 === 'P')) setIf('NZ', 1); // LYS/LYSP
        break;
      case 'P':
        if (r1 === 'H' && r2 === 'E') {
          if (pair('CG', 'CD1') || pair('CZ', 'CE1') || pair('CE2', 'CD2')) setOrder(2); // PHE
        }
        break;
      case 'T':
        if (r1 === 'Y' && r2 === 'R') {
          if (pair('CG', 'CD1') || pair('CZ', 'CE1') || pair('CE2', 'CD2')) setOrder(2); // TYR
        } else if (r1 === 'R' && r2 === 'P') {
          if (
            pair('CG', 'CD1') || pair('CZ3', 'CE3') || pair('CZ2', 'CH2') || pair('CE2', 'CD2')
          )
            setOrder(2); // TRP
        } else if (r1 === '') {
          phosphateMinus(); // thymine "T"
          if (pair('C2', 'O2') || pair('C4', 'O4') || pair('C5', 'C6')) setOrder(2);
          else phosphoDouble();
        }
        break;
      case 'U':
        if (r1 === '') {
          phosphateMinus(); // uracil "U"
          if (pair('C2', 'O2') || pair('C4', 'O4') || pair('C5', 'C6')) setOrder(2);
          else phosphoDouble();
        }
        break;
    }
  }
}
