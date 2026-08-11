/**
 * An XYZ reader — the `xyz` branch of `cmd.load`.
 *
 * Parses the standard/XMol XYZ format (`packages/engine/layer2/XYZStrToMol`
 * semantics): a per-frame atom count, a free-text comment line, then `natom`
 * whitespace-delimited atom lines whose first token is an element symbol (or an
 * atomic number) followed by x/y/z. The format carries no residue, chain or bond
 * information, so every atom is filed as a generic HETATM in residue `UNK`/`1`
 * and connectivity is inferred by distance (PyMOL's `ObjectMoleculeConnect`).
 *
 * A file may repeat the frame block to encode a trajectory; each extra frame
 * with a matching atom count becomes an additional coordinate state. The atom
 * table is built from the FIRST frame only, matching PyMOL's discrete=0 load.
 *
 * Coordinates are written into a Float32Array so the stored precision matches
 * PyMOL's C `float` CoordSet exactly.
 */

import type { AtomInfo } from './atom';
import { defaultVisRep } from './atom';
import { canonicalElement } from './element';
import { connectByDistance } from './bonding';
import { ObjectMolecule } from './molecule';

/**
 * Minimal atomic-number → symbol table. XYZ files sometimes carry the element as
 * an integer Z rather than a symbol; this covers H..Ca plus the common heavy
 * atoms the sample corpus needs (Fe, Zn, Se, Br, I). Anything outside the table
 * falls back to the raw token (see {@link tokenToElement}).
 */
const Z_TO_SYMBOL: Readonly<Record<number, string>> = {
  1: 'H',
  2: 'He',
  3: 'Li',
  4: 'Be',
  5: 'B',
  6: 'C',
  7: 'N',
  8: 'O',
  9: 'F',
  10: 'Ne',
  11: 'Na',
  12: 'Mg',
  13: 'Al',
  14: 'Si',
  15: 'P',
  16: 'S',
  17: 'Cl',
  18: 'Ar',
  19: 'K',
  20: 'Ca',
  26: 'Fe',
  30: 'Zn',
  34: 'Se',
  35: 'Br',
  53: 'I',
};

/**
 * Resolve an XYZ first-token to a canonical element symbol. An all-digit token
 * is treated as an atomic number and mapped through {@link Z_TO_SYMBOL}; a
 * symbolic token (or a Z with no table entry) is canonicalised as-is.
 */
function tokenToElement(token: string): string {
  if (/^\d+$/.test(token)) {
    const z = parseInt(token, 10);
    const sym = Z_TO_SYMBOL[z];
    if (sym !== undefined) return sym;
    // Unknown atomic number: keep the raw digits rather than guess.
    return token;
  }
  return canonicalElement(token);
}

/**
 * Parse XYZ text into an {@link ObjectMolecule}. `name` is the object name the
 * executive will file it under.
 *
 * Tolerant parsing: leading/trailing blank lines are skipped, extra columns
 * after x/y/z are ignored, and a truncated or count-mismatched trailing frame is
 * dropped rather than throwing (matching PyMOL's lenient XYZ loader).
 */
export function parseXyz(text: string, name: string): ObjectMolecule {
  const mol = new ObjectMolecule(name);
  const lines = text.split(/\r?\n/);

  // A tiny cursor over `lines` that lets us skip blank padding between frames.
  let cursor = 0;
  const nextLine = (): string | undefined => {
    while (cursor < lines.length) {
      const line = lines[cursor];
      cursor++;
      if (line !== undefined) return line;
    }
    return undefined;
  };
  const skipBlankAndPeekCount = (): number | undefined => {
    // Advance past blank lines to the next non-empty line and read it as a
    // frame atom-count; returns undefined at end-of-input.
    while (cursor < lines.length) {
      const line = lines[cursor];
      if (line === undefined) {
        cursor++;
        continue;
      }
      if (line.trim() === '') {
        cursor++;
        continue;
      }
      const n = parseInt(line.trim(), 10);
      cursor++;
      return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
  };

  const stateCoords: number[][] = [];
  let frameNatom = -1;

  // Read frames until the input is exhausted or a frame is malformed.
  for (;;) {
    const natom = skipBlankAndPeekCount();
    if (natom === undefined || !Number.isFinite(natom) || natom <= 0) break;

    // A later frame whose atom count differs is a different topology; XYZ
    // trajectories require a constant atom table, so stop here rather than
    // corrupt the states.
    if (frameNatom !== -1 && natom !== frameNatom) break;

    // Skip the comment line (may be blank; that is still a real line).
    nextLine();

    const coords: number[] = [];
    // First-frame atoms are staged here and only committed to `mol.atoms` once
    // the WHOLE frame parses — so a malformed row mid-frame drops the frame
    // AND its half-built atom table together (a partial atom table with a zeroed
    // state would otherwise result).
    const frameAtoms: AtomInfo[] = [];
    let ok = true;
    for (let i = 0; i < natom; i++) {
      const line = nextLine();
      if (line === undefined) {
        ok = false; // truncated frame — drop it.
        break;
      }
      const parts = line.trim().split(/\s+/);
      const token = parts[0] ?? '';
      const x = parseFloat(parts[1] ?? '');
      const y = parseFloat(parts[2] ?? '');
      const z = parseFloat(parts[3] ?? '');
      // A malformed row (missing/non-numeric coordinate) would poison the state
      // with NaN — drop the whole frame (staged atoms are discarded with it).
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        ok = false;
        break;
      }
      coords.push(x, y, z);

      // Build the atom table only from the first frame.
      if (frameNatom === -1) {
        const elem = tokenToElement(token);
        frameAtoms.push({
          id: mol.atoms.length + frameAtoms.length + 1,
          name: elem, // XYZ has no atom names; use the element symbol.
          resn: 'UNK',
          resi: '1',
          resv: 1,
          chain: '',
          segi: '',
          alt: '',
          elem,
          hetatm: true,
          b: 0,
          q: 1,
          color: 0, // assigned later by CPK/`color`
          ss: '',
          visRep: defaultVisRep(),
        });
      }
    }

    if (!ok) break;
    stateCoords.push(coords);
    if (frameNatom === -1) {
      for (const atom of frameAtoms) mol.atoms.push(atom);
      frameNatom = natom;
    }
  }

  // Materialise each frame as a Float32 state (PyMOL's storage precision).
  for (const coords of stateCoords) {
    mol.states.push(Float32Array.from(coords));
  }
  if (mol.states.length === 0 && mol.natom > 0) {
    mol.states.push(new Float32Array(mol.natom * 3));
  }

  // XYZ carries no bonds — infer them by interatomic distance over state 1.
  connectByDistance(mol);

  return mol;
}
