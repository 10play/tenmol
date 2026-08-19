/**
 * A TRIPOS MOL2 reader — the `mol2` branch of `cmd.load`.
 *
 * MOL2 is record-driven: sections open with a `@<TRIPOS>NAME` line and run until
 * the next such marker. This port mirrors `packages/engine/layer2/ObjectMoleculeMOL2ToMol`
 * for the records the covered slice needs — `MOLECULE` (name + counts), `ATOM`
 * (the atom table + coordinates) and `BOND` (explicit connectivity). Because MOL2
 * carries an explicit bond block, no distance-based inference is run: the
 * connectivity is taken verbatim (PyMOL's `ObjectMoleculeConnect` is skipped when
 * the file supplies bonds).
 *
 * Shape and field layout follow `model/pdb.ts` `parsePdb` and its close cousin
 * `parseMolBlock` (`cmd/fileio.ts`): every atom gets a fully-populated
 * {@link AtomInfo}, coordinates land in a single Float32Array state (matching
 * PyMOL's C `float` CoordSet precision), and bonds are 0-based index pairs.
 */

import type { AtomInfo } from './atom';
import { defaultVisRep } from './atom';
import { canonicalElement } from './element';
import { makeBondAdder } from './bonding';
import { ObjectMolecule } from './molecule';

/** A `@<TRIPOS>NAME` record marker; captures the section name. */
const RECORD = /^@<TRIPOS>(\S+)/;

/**
 * The element symbol carried by a SYBYL atom type: the part before the first
 * '.', so `C.ar` -> `C`, `N.am` -> `N`, `O.2` -> `O`, `H` -> `H`. Canonicalised
 * to PyMOL's title-case symbol so element selection / CPK colour match.
 */
function elementFromSybyl(atomType: string): string {
  const dot = atomType.indexOf('.');
  const sym = dot >= 0 ? atomType.slice(0, dot) : atomType;
  return canonicalElement(sym);
}

/**
 * Residue name from a SYBYL `subst_name`: strip a trailing run of digits
 * (`ALA1` -> `ALA`), but keep the token unchanged when that would leave it empty
 * (an all-digit substructure name is kept as-is), matching PyMOL's `resn` fill.
 */
function resnFromSubst(substName: string): string {
  return substName.replace(/\d+$/, '') || substName;
}

/**
 * Parse MOL2 text into an {@link ObjectMolecule}. `name` is the object name the
 * executive will file it under (the in-file molecule name is ignored, as PyMOL
 * uses the load-supplied object name).
 *
 * A MOL2 file may hold MANY `@<TRIPOS>MOLECULE` blocks. PyMOL reads EVERY block
 * into one object: with the default (`discrete<0`) `load`, a multi-block file
 * becomes a DISCRETE multi-state object — each block is a new coordinate state
 * and its atoms are merged into the shared atom table, so `count_atoms` reports
 * the grand total across all blocks and `count_states` the block count
 * (`ObjectMoleculeReadStr`'s `repeatFlag`/`restart` loop + `ObjectMoleculeMerge`).
 * A single-block file stays a plain one-state object.
 *
 * The engine's dense CoordSet model keeps one atom table plus a full-width
 * (`natom*3`) coordinate array per state, so each state here is filled with the
 * whole (real) coordinate table; the per-state atom *membership* PyMOL tracks for
 * discrete objects (which `state N` selection reads) is not modelled. Malformed
 * rows are skipped rather than aborting the load.
 */
export function parseMol2(text: string, name: string): ObjectMolecule {
  const mol = new ObjectMolecule(name);
  const lines = text.split(/\r?\n/);

  const coords: number[] = [];
  // Global index of the first atom in the CURRENT block. BOND rows reference an
  // atom by its 1-based POSITION within its own block (PyMOL reads the two ids
  // then does `index--`, treating them as ordinals into the block's atom array,
  // NOT as the file `atom_id` field), so a bond ordinal `k` resolves to the
  // global table index `blockAtomStart + k - 1`. Reset at each block boundary.
  let blockAtomStart = 0;
  const addBond = makeBondAdder(mol);

  let section = '';
  let moleculeBlocks = 0;

  for (const line of lines) {
    const marker = RECORD.exec(line);
    if (marker) {
      const rec = (marker[1] ?? '').toUpperCase();
      if (rec === 'MOLECULE') {
        moleculeBlocks++;
        blockAtomStart = mol.atoms.length; // Next block's atoms start here.
      }
      section = rec;
      continue;
    }

    if (section === 'MOLECULE') {
      // The MOLECULE header (name line, then the `num_atoms num_bonds …` counts
      // line) is intentionally not consumed: the object name comes from the
      // load-supplied `name`, and the actual totals come from the rows we parse.
      continue;
    }

    if (section === 'ATOM') {
      // atom_id atom_name x y z atom_type [subst_id subst_name charge]
      const t = line.trim().split(/\s+/);
      if (t.length < 6) continue; // Not a full atom row.
      const x = parseFloat(t[2] ?? '');
      const y = parseFloat(t[3] ?? '');
      const z = parseFloat(t[4] ?? '');
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;

      // subst_id / subst_name are present only when the optional trailing fields
      // are (some PyMOL exports drop them, leaving just a charge column).
      const hasSubst = t.length >= 8;
      const substId = hasSubst ? parseInt(t[6] ?? '', 10) : NaN;
      const substName = hasSubst ? (t[7] ?? '') : '';
      // Optional trailing charge column (USER_CHARGES / Gasteiger / …).
      const charge = t.length >= 9 ? parseFloat(t[8] ?? '') : NaN;

      const atom: AtomInfo = {
        id: mol.atoms.length + 1,
        name: (t[1] ?? '').trim(),
        resn: substName ? resnFromSubst(substName) : '',
        resi: Number.isFinite(substId) ? String(substId) : '',
        resv: Number.isFinite(substId) ? substId : 0,
        chain: '',
        segi: '',
        alt: '',
        elem: elementFromSybyl((t[5] ?? '').trim()),
        // MOL2 has no ATOM/HETATM distinction; treat every atom as heteroatom
        // (ligands/small molecules), which the standard-residue check would too.
        hetatm: true,
        b: 0,
        q: 1,
        color: 0, // assigned by CPK/`color`
        ss: '', // assigned by `dss`
        visRep: defaultVisRep(),
      };
      if (Number.isFinite(charge)) atom.partialCharge = charge;
      mol.atoms.push(atom);
      coords.push(x, y, z);
      continue;
    }

    if (section === 'BOND') {
      // bond_id origin_atom_id target_atom_id bond_type (type in {1,2,3,ar,am,...}).
      // origin/target are 1-based ORDINALS into the current block's atoms.
      const t = line.trim().split(/\s+/);
      if (t.length < 3) continue;
      const oa = parseInt(t[1] ?? '', 10);
      const ob = parseInt(t[2] ?? '', 10);
      if (!Number.isFinite(oa) || !Number.isFinite(ob)) continue;
      const a = blockAtomStart + oa - 1;
      const b = blockAtomStart + ob - 1;
      if (a < 0 || b < 0 || a >= mol.atoms.length || b >= mol.atoms.length) continue;
      addBond(a, b);
      continue;
    }
    // Other sections (SUBSTRUCTURE, COMMENT, CRYSIN, …) are not needed here.
  }

  // One coordinate state per MOLECULE block (PyMOL's per-block frame). The dense
  // model can't hold a distinct per-state atom subset, so every state carries the
  // full atom table's coordinates; the block count is what drives `count_states`.
  const nState = Math.max(1, moleculeBlocks);
  const allCoords = Float32Array.from(coords);
  for (let s = 0; s < nState; s++) {
    mol.states.push(s === 0 ? allCoords : allCoords.slice());
  }
  // A multi-block MOL2 loads discrete by default (ObjectMoleculeReadStr sets
  // DiscreteFlag when a multi-coordinate-set file is read non-multiplexed).
  if (moleculeBlocks > 1) mol.discrete = true;
  return mol;
}
