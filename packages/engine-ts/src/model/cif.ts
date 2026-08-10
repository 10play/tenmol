/**
 * An mmCIF/CIF reader — the `cif` branch of `cmd.load`.
 *
 * Ports the coordinate-loading slice of PyMOL's `ObjectMoleculeReadCifStr`
 * (`packages/engine/layer2/ObjectMolecule`): the `_atom_site` `loop_` becomes the
 * atom table + per-`pdbx_PDB_model_num` coordinate states, `_cell`/`_symmetry`
 * become the crystal cell, and — since `_atom_site` carries no connectivity — the
 * same distance-based bonding pass PDB-without-CONECT uses fills in the bonds.
 *
 * Only the `_atom_site` category (plus the scalar `_cell`/`_symmetry` records) is
 * read; every other CIF category is ignored, exactly as PyMOL ignores them for a
 * plain coordinate load. Coordinates are stored as Float32 so the retained
 * precision matches PyMOL's C `float` CoordSet.
 */

import type { AtomInfo } from './atom';
import { defaultVisRep } from './atom';
import { canonicalElement } from './element';
import { connectByDistance } from './bonding';
import { ObjectMolecule } from './molecule';

/** CIF "missing" placeholders — `.` (inapplicable) and `?` (unknown). */
function isMissing(v: string | undefined): boolean {
  return v === undefined || v === '.' || v === '?' || v === '';
}

/** A value with the two CIF null tokens collapsed to `''`. */
function clean(v: string | undefined): string {
  return isMissing(v) ? '' : v!;
}

/**
 * Tokenise one CIF line into whitespace-delimited values, honouring single- and
 * double-quoted strings. A quote only closes when followed by whitespace or the
 * end of line (the STAR rule), so an apostrophe inside `5'-end` survives. CIF's
 * multi-line `;`-delimited text blocks never occur inside `_atom_site` rows, so
 * they are not handled here.
 */
function tokenize(line: string): string[] {
  const out: string[] = [];
  const n = line.length;
  let i = 0;
  while (i < n) {
    const ch = line[i]!;
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      const start = i;
      while (
        i < n &&
        !(line[i] === quote && (i + 1 >= n || line[i + 1] === ' ' || line[i + 1] === '\t'))
      ) {
        i++;
      }
      out.push(line.slice(start, i));
      i++; // skip the closing quote
      continue;
    }
    const start = i;
    while (i < n && line[i] !== ' ' && line[i] !== '\t') i++;
    out.push(line.slice(start, i));
  }
  return out;
}

/** True once a line ends the run of data rows following a `loop_` header. */
function endsLoopData(trimmed: string): boolean {
  return (
    trimmed === '' ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('_') ||
    trimmed === 'loop_' ||
    trimmed.startsWith('data_') ||
    trimmed.startsWith('save_') ||
    trimmed.startsWith(';')
  );
}

/**
 * Parse mmCIF/CIF text into an {@link ObjectMolecule}. `name` is the object name
 * the executive files it under.
 *
 * The atom table is taken from the FIRST `pdbx_PDB_model_num`; further model
 * numbers contribute only extra coordinate states that share that ordering —
 * mirroring the MODEL/ENDMDL handling in {@link parsePdb} (PyMOL `discrete=0`).
 */
export function parseCif(text: string, name: string): ObjectMolecule {
  const mol = new ObjectMolecule(name);
  const lines = text.split(/\r?\n/);

  // --- Scalar records: `_cell.*` / `_symmetry.*` (single tag/value lines). ---
  const scalars = new Map<string, string>();
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('_cell.') || t.startsWith('_symmetry.')) {
      const toks = tokenize(t);
      if (toks.length >= 2) scalars.set(toks[0]!, toks[1]!);
    }
  }

  // --- Locate the `_atom_site` loop and read its column order. ---
  // `colIndex[tag]` maps the part after `_atom_site.` to its position in a row.
  const colIndex = new Map<string, number>();
  let dataStart = -1; // first data-row line index of the atom_site loop
  let ncol = 0;
  for (let li = 0; li < lines.length; li++) {
    if (lines[li]!.trim() !== 'loop_') continue;
    // Collect the header tags that immediately follow `loop_`.
    const tags: string[] = [];
    let j = li + 1;
    for (; j < lines.length; j++) {
      const t = lines[j]!.trim();
      if (t.startsWith('_')) {
        tags.push(t);
      } else {
        break;
      }
    }
    if (!tags.some((tag) => tag.startsWith('_atom_site.'))) continue;
    // This is the atom_site loop: build the column map, remember where rows begin.
    for (let c = 0; c < tags.length; c++) {
      const tag = tags[c]!;
      if (tag.startsWith('_atom_site.')) colIndex.set(tag.slice('_atom_site.'.length), c);
    }
    ncol = tags.length;
    dataStart = j;
    break;
  }

  // --- Read the atom_site data rows into atoms + per-model coordinate states. ---
  // Models keep insertion order; the first model seen owns the atom table.
  const modelOrder: string[] = [];
  const modelCoords = new Map<string, number[]>();
  let firstModel: string | undefined;

  /** A row value by tag, or `undefined` when the tag/column is absent/missing. */
  const cell = (row: string[], tag: string): string | undefined => {
    const c = colIndex.get(tag);
    if (c === undefined) return undefined;
    const v = row[c];
    return isMissing(v) ? undefined : v;
  };
  /** First present value across a fallback list of tags (auth_* before label_*). */
  const pick = (row: string[], ...tags: string[]): string | undefined => {
    for (const tag of tags) {
      const v = cell(row, tag);
      if (v !== undefined) return v;
    }
    return undefined;
  };

  if (dataStart >= 0) {
    for (let li = dataStart; li < lines.length; li++) {
      const raw = lines[li]!;
      if (endsLoopData(raw.trim())) break;
      const row = tokenize(raw);
      // Tolerant: a short row (wrong column count) is skipped, not fatal.
      if (row.length < ncol) continue;

      const x = parseFloat(clean(cell(row, 'Cartn_x')));
      const y = parseFloat(clean(cell(row, 'Cartn_y')));
      const z = parseFloat(clean(cell(row, 'Cartn_z')));
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;

      const model = clean(cell(row, 'pdbx_PDB_model_num')) || '1';
      if (firstModel === undefined) firstModel = model;
      let coords = modelCoords.get(model);
      if (coords === undefined) {
        coords = [];
        modelCoords.set(model, coords);
        modelOrder.push(model);
      }
      coords.push(x, y, z);

      // The atom table is populated from the first model only.
      if (model !== firstModel) continue;

      const seqStr = clean(pick(row, 'auth_seq_id', 'label_seq_id'));
      const insCode = clean(cell(row, 'pdbx_PDB_ins_code'));
      const atom: AtomInfo = {
        id: mol.atoms.length + 1,
        name: clean(pick(row, 'auth_atom_id', 'label_atom_id')),
        resn: clean(pick(row, 'auth_comp_id', 'label_comp_id')),
        resi: seqStr + insCode,
        resv: parseInt(seqStr, 10) || 0,
        chain: clean(pick(row, 'auth_asym_id', 'label_asym_id')),
        segi: clean(pick(row, 'label_asym_id', 'label_entity_id')),
        alt: clean(cell(row, 'label_alt_id')),
        elem: canonicalElement(clean(cell(row, 'type_symbol'))),
        hetatm: clean(cell(row, 'group_PDB')) === 'HETATM',
        b: parseFloat(clean(cell(row, 'B_iso_or_equiv'))) || 0,
        q: parseFloat(clean(cell(row, 'occupancy'))) || 0,
        color: 0, // assigned by CPK colouring; overwritten by `color`
        ss: '', // assigned by `dss`
        visRep: defaultVisRep(),
      };
      mol.atoms.push(atom);
    }
  }

  // --- Materialise each model's coordinates as a Float32 state. ---
  for (const model of modelOrder) {
    mol.states.push(Float32Array.from(modelCoords.get(model)!));
  }
  if (mol.states.length === 0 && mol.natom > 0) {
    mol.states.push(new Float32Array(mol.natom * 3));
  }

  // --- Crystal cell + space group (optional). ---
  const a = parseFloat(scalars.get('_cell.length_a') ?? '');
  const b = parseFloat(scalars.get('_cell.length_b') ?? '');
  const c = parseFloat(scalars.get('_cell.length_c') ?? '');
  const alpha = parseFloat(scalars.get('_cell.angle_alpha') ?? '');
  const beta = parseFloat(scalars.get('_cell.angle_beta') ?? '');
  const gamma = parseFloat(scalars.get('_cell.angle_gamma') ?? '');
  if ([a, b, c, alpha, beta, gamma].every((v) => Number.isFinite(v))) {
    mol.cell = { a, b, c, alpha, beta, gamma };
    const sg = clean(scalars.get('_symmetry.space_group_name_H-M'));
    mol.spacegroup = sg || 'P 1';
  }

  // --- Distance-based connectivity (mmCIF `_atom_site` carries no bonds). ---
  connectByDistance(mol);

  return mol;
}
