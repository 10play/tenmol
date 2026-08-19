/**
 * Formal-charge perception for standard PDB residues — a faithful port of the
 * charge-assignment half of `assign_pdb_known_residue`
 * (`packages/engine/layer2/ObjectMolecule2.cpp:837`), as driven from the
 * distance-bond perception in `ObjectMoleculeConnect`
 * (`ObjectMolecule2.cpp:3798`).
 *
 * Real PyMOL assigns integer formal charges to well-known ionisable atoms of the
 * standard amino-acid and nucleotide residues while it perceives connectivity —
 * LYS `NZ` (+1), ARG `NH1` (+1, and `NH2` forced to 0), the deprotonated ASP
 * `OD2` / GLU `OE2` carboxylate oxygen (−1), the protonated-histidine `ND1`
 * (+1), the C-terminal `OXT` (−1) and the nucleotide phosphate `O2P`/`OP2` (−1).
 * A plain PDB carries no charge column, so without this pass the TS engine leaves
 * every `formalCharge` at 0 and `fc.`/`formal_charge` selections diverge from the
 * oracle.
 *
 * The C routine runs per intra-residue bond; the guard in the load caller is
 * `!ai1->hetatm || resn == MSE` (so waters/ligands are skipped) plus
 * `AtomInfoSameResidue`. Only the charge assignments are ported here — engine-ts
 * does not model tentative bond orders, which is the other half of the C switch.
 */
import type { ObjectMolecule } from './molecule';
import type { AtomInfo } from './atom';

/** Same-residue test mirroring `AtomInfoSameResidue` (identity of the residue). */
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

/**
 * Apply PyMOL's known-residue charge assignment over every intra-residue bond.
 * `name`/`resn` are the space-trimmed strings PyMOL selects on; residue-name
 * character access uses `''` for positions past the end, mirroring the C code's
 * comparison of `resn1[k]` against the `'\0'` terminator (`case 0`).
 */
export function assignPdbKnownResidueCharges(mol: ObjectMolecule): void {
  const atoms = mol.atoms;
  for (const bond of mol.bonds) {
    const ai1 = atoms[bond[0]!];
    const ai2 = atoms[bond[1]!];
    if (!ai1 || !ai2) continue;
    // Load-path guard (ObjectMolecule2.cpp:3798): skip hetatm residues except
    // selenomethionine, and only act within a single residue.
    if (ai1.hetatm && ai1.resn !== 'MSE') continue;
    if (!sameResidue(ai1, ai2)) continue;

    const name1 = ai1.name;
    const name2 = ai2.name;
    const resn = ai1.resn;
    const r1 = resn.charAt(1); // '' == C null terminator (case 0)
    const r2 = resn.charAt(2);
    const r3 = resn.charAt(3);

    // C-terminal carboxylate: OXT bonded to the backbone C is −1.
    if (name2 === 'C' && name1 === 'OXT') {
      ai1.formalCharge = -1;
      continue;
    }
    if (name1 === 'C' && name2 === 'OXT') {
      ai2.formalCharge = -1;
      continue;
    }

    // Set `name`'s owning atom to `charge` when it is one of the two endpoints.
    const setIf = (target: string, charge: number): void => {
      if (name1 === target) ai1.formalCharge = charge;
      else if (name2 === target) ai2.formalCharge = charge;
    };
    const phosphateMinus = (): void => {
      if (name1 === 'O2P' || name1 === 'OP2') ai1.formalCharge = -1;
      else if (name2 === 'O2P' || name2 === 'OP2') ai2.formalCharge = -1;
    };

    switch (resn.charAt(0)) {
      case 'A':
        switch (r1) {
          case 'R': // ARG, ARGP — guanidinium: NH1 = +1, NH2 forced to 0
            if (r2 === 'G' && (r3 === '' || r3 === 'P')) {
              setIf('NH1', 1);
              setIf('NH2', 0);
            }
            break;
          case '': // adenine ribonucleotide "A"
            phosphateMinus();
            break;
          // 'S' -> ASP/ASN handled below; ASN has no charge.
        }
        if (r1 === 'S' && r2 === 'P' && (r3 === '' || r3 === 'M')) setIf('OD2', -1); // ASP, ASPM
        break;
      case 'C':
        if (r1 === '') phosphateMinus(); // cytidine "C"
        break;
      case 'D': // deoxynucleotides DA/DC/DT/DG/DU
        if ((r1 === 'A' || r1 === 'C' || r1 === 'T' || r1 === 'G' || r1 === 'U') && r2 === '')
          phosphateMinus();
        break;
      case 'G':
        if (r1 === 'L' && r2 === 'U' && (r3 === '' || r3 === 'M')) setIf('OE2', -1); // GLU, GLUM
        else if (r1 === '') phosphateMinus(); // guanosine "G"
        break;
      case 'H':
        // HIP, and HISH/HISP (protonated histidine): ND1 = +1
        if (r1 === 'I' && (r2 === 'P' || (r2 === 'S' && (r3 === 'H' || r3 === 'P')))) setIf('ND1', 1);
        break;
      case 'I':
        if (r1 === '') phosphateMinus(); // inosine "I"
        break;
      case 'L':
        if (r1 === 'Y' && r2 === 'S' && (r3 === '' || r3 === 'P')) setIf('NZ', 1); // LYS, LYSP
        break;
      case 'T':
        if (r1 === '') phosphateMinus(); // thymidine "T"
        break;
      case 'U':
        if (r1 === '') phosphateMinus(); // uridine "U"
        break;
    }
  }
}
