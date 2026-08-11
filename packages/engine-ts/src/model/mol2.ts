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
 * A MOL2 file may hold MANY `@<TRIPOS>MOLECULE` blocks. `parseMol2` returns a
 * single object, so it parses only the FIRST molecule and stops at the second
 * `@<TRIPOS>MOLECULE` marker; a `loadall`-style caller would iterate the blocks
 * instead. Malformed rows are skipped rather than aborting the load.
 */
export function parseMol2(text: string, name: string): ObjectMolecule {
  const mol = new ObjectMolecule(name);
  const lines = text.split(/\r?\n/);

  const coords: number[] = [];
  // File `atom_id` -> 0-based table index, so the BOND block can resolve ids.
  const idToIndex = new Map<number, number>();
  const addBond = makeBondAdder(mol);

  let section = '';
  let moleculeBlocks = 0;

  for (const line of lines) {
    const marker = RECORD.exec(line);
    if (marker) {
      const rec = (marker[1] ?? '').toUpperCase();
      if (rec === 'MOLECULE') {
        moleculeBlocks++;
        if (moleculeBlocks === 2) break; // Multi-molecule: keep only the first.
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
      const fileId = parseInt(t[0] ?? '', 10);
      const x = parseFloat(t[2] ?? '');
      const y = parseFloat(t[3] ?? '');
      const z = parseFloat(t[4] ?? '');
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;

      // subst_id / subst_name are present only when the optional trailing fields
      // are (some PyMOL exports drop them, leaving just a charge column).
      const hasSubst = t.length >= 8;
      const substId = hasSubst ? parseInt(t[6] ?? '', 10) : NaN;
      const substName = hasSubst ? (t[7] ?? '') : '';

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
      if (Number.isFinite(fileId)) idToIndex.set(fileId, mol.atoms.length);
      mol.atoms.push(atom);
      coords.push(x, y, z);
      continue;
    }

    if (section === 'BOND') {
      // bond_id origin_atom_id target_atom_id bond_type (type in {1,2,3,ar,am,...}).
      const t = line.trim().split(/\s+/);
      if (t.length < 3) continue;
      const a = idToIndex.get(parseInt(t[1] ?? '', 10));
      const b = idToIndex.get(parseInt(t[2] ?? '', 10));
      if (a === undefined || b === undefined) continue;
      addBond(a, b);
      continue;
    }
    // Other sections (SUBSTRUCTURE, COMMENT, CRYSIN, …) are not needed here.
  }

  mol.states.push(Float32Array.from(coords));
  return mol;
}
