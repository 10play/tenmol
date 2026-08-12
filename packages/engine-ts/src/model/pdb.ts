/**
 * A PDB reader — the `pdb` branch of `cmd.load`.
 *
 * Ports the field layout of `packages/engine/layer2/PDBStrToMol` /
 * `ObjectMoleculeReadPDBStr`: fixed-column ATOM/HETATM parsing into the atom
 * table, MODEL/ENDMDL into states, CONECT into explicit bonds, and a
 * distance-based connectivity pass for standard residues (PyMOL's
 * `ObjectMoleculeConnect`, `connect_cutoff` default 0.35 Å).
 *
 * Coordinates are written into a Float32Array so the stored precision matches
 * PyMOL's C `float` CoordSet exactly.
 */

import type { AtomInfo } from './atom';
import { defaultVisRep } from './atom';
import { canonicalElement, isKnownElement } from './element';
import { connectByDistance } from './bonding';
import { ObjectMolecule } from './molecule';

function col(line: string, start: number, end: number): string {
  // PDB columns are 1-based inclusive; slice with 0-based [start-1, end).
  return line.slice(start - 1, end);
}

function inferElement(rawName: string, elemCol: string): string {
  const e = elemCol.trim();
  if (e !== '') return canonicalElement(e);
  // No element column: infer from the atom-NAME field, which per the PDB spec is
  // columns 13-16 with the element symbol right-justified in 13-14 (`rawName` is
  // the untrimmed field, so that alignment is intact). PyMOL's guess:
  //   * column 13 blank or a digit  -> single-char element in column 14
  //     (the common C/N/O/H/S case, incl. 4-char H names like "1HB2"/"HB21");
  //   * column 13 a letter          -> a right-justified 2-char element field
  //     (metals: "CA"=Ca, "FE"=Fe, "MG"=Mg), accepted ONLY if it names a real
  //     element, else the leading letter.
  // Taking 2 chars unconditionally (the old behaviour) mis-maps every protein
  // atom whose first two name letters spell another element — the alpha-carbon
  // " CA " -> Ca(lcium), " NE " -> Ne(on), " CB " -> Cb — corrupting both the
  // VDW radius and the CPK element COLOUR for any PDB with no element column.
  const letters = rawName.trim().replace(/[^A-Za-z]/g, '');
  if (letters === '') return '';
  const col13 = rawName.charAt(0);
  if (col13 !== ' ' && !/[0-9]/.test(col13)) {
    const two = rawName.slice(0, 2).replace(/[^A-Za-z]/g, '');
    if (two.length === 2 && isKnownElement(two)) return canonicalElement(two);
  }
  return canonicalElement(letters.charAt(0));
}

export interface ParsedPdb {
  molecule: ObjectMolecule;
}

/**
 * Parse PDB text into an {@link ObjectMolecule}. `name` is the object name the
 * executive will file it under.
 *
 * Alt-loc, insertion codes and multiple MODELs are handled; anything the covered
 * slice does not need (ANISOU, SEQRES, secondary-structure records) is ignored,
 * exactly as PyMOL ignores them for coordinate loading.
 */
export function parsePdb(text: string, name: string): ObjectMolecule {
  const mol = new ObjectMolecule(name);
  const lines = text.split(/\r?\n/);

  // States: coordinates per MODEL. Atom table is taken from the FIRST model;
  // later models must share the same atom ordering (PyMOL's discrete=0 default).
  const stateCoords: number[][] = [];
  let current: number[] = [];
  let inModel = false;
  let seenAtomsThisModel = 0;
  const serialToIndex = new Map<number, number>();
  /** serial -> ANISOU U matrix [U11,U22,U33,U12,U13,U23] in Å² (record is ×1e-4). */
  const anisou = new Map<number, [number, number, number, number, number, number]>();
  let firstModelDone = false;

  const flushState = (): void => {
    if (current.length > 0) {
      stateCoords.push(current);
      current = [];
    }
  };

  for (const line of lines) {
    const rec = col(line, 1, 6);
    if (rec === 'CRYST1') {
      // CRYST1: a(7-15) b(16-24) c(25-33) alpha(34-40) beta(41-47) gamma(48-54)
      // sGroup(56-66) z(67-70). Store the cell only when the lengths parse; a
      // malformed/blank CRYST1 must leave the molecule unit-cell-free.
      const a = parseFloat(col(line, 7, 15));
      const b = parseFloat(col(line, 16, 24));
      const c = parseFloat(col(line, 25, 33));
      const alpha = parseFloat(col(line, 34, 40));
      const beta = parseFloat(col(line, 41, 47));
      const gamma = parseFloat(col(line, 48, 54));
      if ([a, b, c, alpha, beta, gamma].every((v) => Number.isFinite(v))) {
        mol.cell = { a, b, c, alpha, beta, gamma };
        const sg = col(line, 56, 66).trim();
        mol.spacegroup = sg || 'P 1';
      }
      continue;
    }
    if (rec === 'ANISOU') {
      // U11(29-35) U22(36-42) U33(43-49) U12(50-56) U13(57-63) U23(64-70),
      // integers in 1e-4 Å². Keyed by serial to attach to the matching atom.
      const serial = parseInt(col(line, 7, 11).trim(), 10);
      const u = (
        [
          [29, 35],
          [36, 42],
          [43, 49],
          [50, 56],
          [57, 63],
          [64, 70],
        ] as const
      ).map(([a, b]) => (parseInt(col(line, a, b).trim(), 10) || 0) * 1e-4);
      if (Number.isFinite(serial)) {
        anisou.set(serial, [u[0]!, u[1]!, u[2]!, u[3]!, u[4]!, u[5]!]);
      }
      continue;
    }
    if (rec === 'MODEL ') {
      if (inModel) flushState();
      inModel = true;
      seenAtomsThisModel = 0;
      if (stateCoords.length > 0) firstModelDone = true;
      continue;
    }
    if (rec === 'ENDMDL') {
      flushState();
      inModel = false;
      firstModelDone = true;
      continue;
    }
    if (rec === 'ATOM  ' || rec === 'HETATM') {
      const x = parseFloat(col(line, 31, 38));
      const y = parseFloat(col(line, 39, 46));
      const z = parseFloat(col(line, 47, 54));
      current.push(x, y, z);
      seenAtomsThisModel++;

      // Build the atom table only from the first model.
      if (!firstModelDone) {
        const serial = parseInt(col(line, 7, 11).trim(), 10);
        const rawName = col(line, 13, 16);
        const elem = inferElement(rawName, col(line, 77, 78));
        const resiText = col(line, 23, 26).trim() + col(line, 27, 27).trim();
        const atom: AtomInfo = {
          id: mol.atoms.length + 1,
          name: rawName.trim(),
          resn: col(line, 18, 20).trim(),
          resi: resiText,
          resv: parseInt(col(line, 23, 26).trim(), 10) || 0,
          chain: col(line, 22, 22).trim(),
          segi: col(line, 73, 76).trim(),
          alt: col(line, 17, 17).trim(),
          elem,
          hetatm: rec === 'HETATM',
          b: parseFloat(col(line, 61, 66)) || 0,
          q: parseFloat(col(line, 55, 60)) || 0,
          color: 0, // assigned below by CPK; overwritten by `color`
          ss: '', // assigned by `dss`
          visRep: defaultVisRep(),
        };
        if (Number.isFinite(serial)) serialToIndex.set(serial, mol.atoms.length);
        mol.atoms.push(atom);
      }
    }
  }
  // Trailing model with no ENDMDL, or a plain single-model file.
  flushState();
  void seenAtomsThisModel;

  // Materialise each state as Float32 (PyMOL's storage precision).
  for (const coords of stateCoords) {
    mol.states.push(Float32Array.from(coords));
  }
  if (mol.states.length === 0 && mol.natom > 0) {
    mol.states.push(new Float32Array(mol.natom * 3));
  }

  // Explicit CONECT bonds.
  const bondSet = new Set<string>();
  const addBond = (a: number, b: number): void => {
    if (a === b) return;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (bondSet.has(key)) return;
    bondSet.add(key);
    mol.bonds.push(a < b ? [a, b] : [b, a]);
  };
  for (const line of lines) {
    if (col(line, 1, 6) !== 'CONECT') continue;
    const base = serialToIndex.get(parseInt(col(line, 7, 11).trim(), 10));
    if (base === undefined) continue;
    for (const s of [12, 17, 22, 27]) {
      const other = serialToIndex.get(parseInt(line.slice(s - 1, s + 4).trim(), 10));
      if (other !== undefined) addBond(base, other);
    }
  }

  // Attach ANISOU ADPs to their atoms (by serial), for the ellipsoids rep.
  if (anisou.size > 0) {
    for (const [serial, idx] of serialToIndex) {
      const u = anisou.get(serial);
      if (u && mol.atoms[idx]) mol.atoms[idx]!.u = u;
    }
  }

  // Distance-based connectivity for standard residues (no CONECT).
  connectByDistance(mol, addBond);

  return mol;
}
