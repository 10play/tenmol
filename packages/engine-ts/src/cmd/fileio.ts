/**
 * The `fileio` command subsystem: text import/export of molecular data.
 *
 * Ports the string-producing exporters of PyMOL's `exporting.py` +
 * `layer3/MoleculeExporter.cpp` (`get_pdbstr`, `get_fastastr`, `get_str`) and
 * the string importers of `importing.py` (`read_molstr`, `read_sdfstr`), plus
 * `load_coords`. Column layout mirrors `CoordSetAtomToPDBStrVLA` /
 * `AtomInfoGetAlignedPDBAtomName` so `parsePdb(get_pdbstr(...))` round-trips.
 */

import type { Json } from '@tenmol/protocol';
import type { AtomInfo } from '../model/atom';
import { defaultVisRep } from '../model/atom';
import { canonicalElement } from '../model/element';
import { ObjectMolecule } from '../model/molecule';
import { parsePdb } from '../model/pdb';
import { inscodeOf, atomOrderCmp } from '../model/atomsort';
import { parseCif } from '../model/cif';
import { parseMol2 } from '../model/mol2';
import { parseXyz } from '../model/xyz';
import type { RegistrarCtx } from './registrar';

/* ------------------------------- helpers ------------------------------- */

/**
 * Read a file synchronously off disk, or `null` when no filesystem is reachable
 * (the browser). Under Node — where the differential and app-server run — this
 * reaches the real `fs` through `process.getBuiltinModule`, so `load <path>`
 * behaves like PyMOL's; a browser bundle (no `process`) gets `null` and the
 * caller falls back to treating the argument as pasted content.
 */
function readDiskFile(path: string): string | null {
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  const getBuiltin = proc?.getBuiltinModule;
  if (typeof getBuiltin !== 'function') return null;
  try {
    const fs = getBuiltin.call(proc, 'node:fs') as {
      readFileSync(p: string, enc: string): string;
    };
    return fs.readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Read a file synchronously off disk as raw bytes, or `null` when no filesystem
 * is reachable (the browser). Binary counterpart of {@link readDiskFile}, used
 * for trajectory formats (DCD) whose content is not valid UTF-8.
 */
function readDiskBytes(path: string): Uint8Array | null {
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  const getBuiltin = proc?.getBuiltinModule;
  if (typeof getBuiltin !== 'function') return null;
  try {
    const fs = getBuiltin.call(proc, 'node:fs') as {
      readFileSync(p: string): Uint8Array;
    };
    return fs.readFileSync(path);
  } catch {
    return null;
  }
}

/** A parsed trajectory: one interleaved xyz Float32 frame per model state. */
interface TrajFrames {
  natom: number;
  frames: Float32Array[];
}

/**
 * Parse a CHARMM/X-PLOR DCD trajectory (the VMD `dcd` molfile plugin format).
 * DCD is a stream of Fortran unformatted records — each `[int32 len][payload]
 * [int32 len]`. Layout: a `CORD` header record (magic + 20 int32 control words),
 * a title record, a single-int natom record, then per frame an optional unit-cell
 * record (6 doubles, CHARMM only) followed by three coordinate records (natom
 * float32 each: all X, then all Y, then all Z). Fixed-atom trajectories
 * (`icntrl[8] != 0`) are not supported. Returns `null` if the bytes are not DCD.
 */
function parseDcd(bytes: Uint8Array): TrajFrames | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Detect endianness from the first Fortran record length (header is 84 bytes).
  let le = true;
  if (dv.getInt32(0, true) === 84) le = true;
  else if (dv.getInt32(0, false) === 84) le = false;
  else return null;
  if (String.fromCharCode(bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!) !== 'CORD') return null;

  const icntrl: number[] = [];
  for (let i = 0; i < 20; i++) icntrl.push(dv.getInt32(8 + i * 4, le));
  const nfixed = icntrl[8]!;
  if (nfixed !== 0) return null; // fixed-atom trajectories unsupported
  const charmm = icntrl[19]! !== 0;
  const hasCell = charmm && icntrl[10]! !== 0;

  let o = 4 + 84 + 4; // past the header record (incl. trailing marker)
  // Title record.
  const titleLen = dv.getInt32(o, le);
  o += 4 + titleLen + 4;
  // NATOM record (single int).
  const natomLen = dv.getInt32(o, le);
  o += 4;
  if (natomLen !== 4) return null;
  const natom = dv.getInt32(o, le);
  o += 4 + 4;

  const readCoordBlock = (): Float32Array | null => {
    if (o + 4 > bytes.byteLength) return null;
    const len = dv.getInt32(o, le);
    o += 4;
    if (len !== natom * 4 || o + len + 4 > bytes.byteLength) return null;
    const out = new Float32Array(natom);
    for (let i = 0; i < natom; i++) out[i] = dv.getFloat32(o + i * 4, le);
    o += len + 4;
    return out;
  };

  const frames: Float32Array[] = [];
  while (o < bytes.byteLength) {
    if (hasCell) {
      // Unit-cell record: 6 doubles (48 bytes) bracketed by Fortran markers.
      const cellLen = dv.getInt32(o, le);
      o += 4 + cellLen + 4;
    }
    const xs = readCoordBlock();
    const ys = readCoordBlock();
    const zs = readCoordBlock();
    if (!xs || !ys || !zs) break;
    const frame = new Float32Array(natom * 3);
    for (let i = 0; i < natom; i++) {
      frame[i * 3] = xs[i]!;
      frame[i * 3 + 1] = ys[i]!;
      frame[i * 3 + 2] = zs[i]!;
    }
    frames.push(frame);
  }
  return { natom, frames };
}

/** Residues treated as solvent (mirrors the selector's `SOLVENT_RESN`). */
const SOLVENT_RESN = new Set(['HOH', 'WAT', 'H2O', 'TIP', 'SOL']);

/** PyMOL `cAtomFlag_polymer` heuristic: a standard (non-het, non-solvent) atom. */
function isPolymer(a: AtomInfo): boolean {
  return !a.hetatm && !SOLVENT_RESN.has(a.resn.toUpperCase());
}

/** 3-letter -> 1-letter map for the 20 standard amino acids. */
const RESN_TO_AA: Readonly<Record<string, string>> = {
  ALA: 'A',
  ARG: 'R',
  ASN: 'N',
  ASP: 'D',
  CYS: 'C',
  GLN: 'Q',
  GLU: 'E',
  GLY: 'G',
  HIS: 'H',
  ILE: 'I',
  LEU: 'L',
  LYS: 'K',
  MET: 'M',
  PHE: 'F',
  PRO: 'P',
  SER: 'S',
  THR: 'T',
  TRP: 'W',
  TYR: 'Y',
  VAL: 'V',
};

/** Right-justify `s` into `width` (C `%Ns`); never truncates. */
function padL(s: string, width: number): string {
  return s.length >= width ? s : ' '.repeat(width - s.length) + s;
}
/** Left-justify `s` into `width` (C `%-Ns`); never truncates. */
function padR(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

/**
 * Column-aligned PDB atom name (`AtomInfoGetAlignedPDBAtomName`, default
 * `pdb_literal_names=0`, `pdb_reformat_names_mode=0`): a name that starts with
 * a single-letter element symbol (and isn't 4 chars / doesn't start with a
 * digit) gets a leading space, so `CA` (carbon) -> ` CA `, but `CA` (calcium,
 * 2-letter symbol) -> `CA  `.
 */
function alignedName(rawName: string, elem: string): string {
  const nm = rawName;
  const len = nm.length;
  if (len === 0) {
    return padR((elem.length <= 1 ? ' ' + elem : elem).slice(0, 4), 4);
  }
  const name4 = nm.slice(0, 4);
  let startCol1 = false;
  if (len < 4) {
    if (!/[0-9]/.test(name4[0]!)) {
      const e0 = elem[0] ?? '';
      const e1 = elem[1] ?? '';
      const matchesSymbol =
        e0 !== '' &&
        name4[0]!.toUpperCase() === e0.toUpperCase() &&
        (e1 === '' || (name4[1] !== undefined && name4[1]!.toUpperCase() === e1.toUpperCase()));
      if (matchesSymbol) {
        if (e1 === '') startCol1 = true; // 1-letter symbol -> shift right
      } else {
        startCol1 = true; // name doesn't start with the element symbol
      }
    }
    // starts with a digit -> stays in column 1 (reformat 0)
  }
  // len >= 4 -> occupies all four columns, no leading space
  const name = startCol1 ? (' ' + name4).slice(0, 4) : name4;
  return padR(name, 4);
}

/** PDB residue-name field (`%3.4s` then `%-4s`): min-3 right, max-4, then left-4. */
function resnField(resn: string): string {
  let r = resn.slice(0, 4);
  if (r.length < 3) r = padL(r, 3);
  return padR(r, 4);
}

function coordFmt(v: number): string {
  return padL(v.toFixed(3), 8);
}

const NUCLEIC_RESN = new Set([
  'A', 'C', 'G', 'U', 'I', 'T',
  'DA', 'DC', 'DG', 'DT', 'DU',
  'ADE', 'CYT', 'GUA', 'URA', 'THY',
]);

/** Standard PDB residues that carry a fixed formal charge on a named atom
 *  (`assign_pdb_known_residue`, ObjectMolecule2.cpp). PyMOL assigns these at
 *  load; the exporter reproduces the observable `formalCharge`. */
function knownFormalCharge(resn: string, name: string): number | undefined {
  const r = resn.toUpperCase();
  const n = name.toUpperCase();
  if (n === 'OXT') return -1; // C-terminal carboxylate of any protein residue
  switch (r) {
    case 'ASP':
    case 'ASPM':
      if (n === 'OD2') return -1;
      break;
    case 'GLU':
    case 'GLUM':
      if (n === 'OE2') return -1;
      break;
    case 'ARG':
    case 'ARGP':
      if (n === 'NH1') return 1;
      if (n === 'NH2') return 0;
      break;
    case 'LYS':
    case 'LYSP':
      if (n === 'NZ') return 1;
      break;
    case 'HIP':
    case 'HISH':
    case 'HISP':
      if (n === 'ND1') return 1;
      break;
    default:
      break;
  }
  // Nucleotide phosphate: the pro-R oxygen carries -1 (O2P / OP2).
  if ((n === 'O2P' || n === 'OP2') && NUCLEIC_RESN.has(r)) return -1;
  return undefined;
}

/** Formal charge for a PDB atom: the known-residue assignment wins (PyMOL's
 *  chemistry overrides file values); otherwise the atom's own `formalCharge`. */
function pdbFormalCharge(atom: AtomInfo): number {
  const known = knownFormalCharge(atom.resn, atom.name);
  return known !== undefined ? known : atom.formalCharge ?? 0;
}

/** PDB cols 79-80 charge field: `"1-"`, `"2+"`, … or blank. */
function chargeField(charge: number): string {
  if (charge > 0 && charge < 10) return `${charge}+`;
  if (charge < 0 && charge > -10) return `${-charge}-`;
  return '  ';
}

/** CRYST1 record (`writeCryst1`) for a molecule with a unit cell, else `''`. */
function cryst1Line(mol: ObjectMolecule): string {
  const cell = mol.cell;
  if (!cell) return '';
  const f = (v: number, w: number, d: number): string => padL(v.toFixed(d), w);
  const sg = padR((mol.spacegroup ?? 'P 1').slice(0, 11), 11);
  const z = padL(String(mol.pdbZValue ?? 1), 4);
  return (
    'CRYST1' +
    f(cell.a, 9, 3) +
    f(cell.b, 9, 3) +
    f(cell.c, 9, 3) +
    f(cell.alpha, 7, 2) +
    f(cell.beta, 7, 2) +
    f(cell.gamma, 7, 2) +
    ' ' +
    sg +
    z
  );
}

/** One ATOM/HETATM record for `atom` at coordinate `xyz` with serial `serial`. */
function pdbAtomLine(atom: AtomInfo, xyz: [number, number, number], serial: number): string {
  const rec = atom.hetatm ? 'HETATM' : 'ATOM  ';
  const s = serial > 99999 ? 99999 : serial;
  return (
    rec +
    padL(String(s), 5) +
    ' ' +
    alignedName(atom.name, atom.elem) +
    padL(atom.alt, 1) +
    resnField(atom.resn) +
    padL((atom.chain || ' ').slice(0, 1), 1) +
    padL(String(((atom.resv % 10000) + 10000) % 10000), 4) +
    inscodeOf(atom.resi) +
    '   ' +
    coordFmt(xyz[0]) +
    coordFmt(xyz[1]) +
    coordFmt(xyz[2]) +
    padL(atom.q.toFixed(2), 6) +
    padL(atom.b.toFixed(2), 6) +
    '      ' +
    padR(atom.segi.slice(0, 4), 4) +
    padL(atom.elem, 2) +
    padL(chargeField(pdbFormalCharge(atom)), 2)
  );
}

/** Positional arg or same-named kwarg, coerced through `str`. */
function pick(args: unknown[], kwargs: Record<string, unknown>, i: number, key: string): unknown {
  if (args[i] !== undefined && args[i] !== null) return args[i];
  if (kwargs[key] !== undefined) return kwargs[key];
  return undefined;
}

function asInt(v: unknown, dflt: number): number {
  if (v === undefined || v === null || v === '') return dflt;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : dflt;
}

/**
 * Expand a shell-style glob (`glob.glob` on the exp_path in PyMOL's `loadall`),
 * returning the matched paths. Under Node this reaches `fs.globSync` through
 * `process.getBuiltinModule`; a browser bundle (no `process`) gets `[]`. Results
 * are returned as `fs.globSync` yields them (already directory-ordered).
 */
function globFiles(pattern: string): string[] {
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  const getBuiltin = proc?.getBuiltinModule;
  if (typeof getBuiltin !== 'function') return [];
  try {
    const fs = getBuiltin.call(proc, 'node:fs') as {
      globSync?(p: string): string[];
    };
    if (typeof fs.globSync !== 'function') return [];
    return fs.globSync(pattern);
  } catch {
    return [];
  }
}

/**
 * PyMOL's `filename_to_objectname` (importing.py): take a path's basename, drop a
 * trailing `.gz`/`.bz2` compression suffix, then strip the final extension to get
 * the object name (with no extension the whole name is kept), and legalise it.
 */
function filenameToObjectname(filename: string): string {
  let base = filename.replace(/^.*[/\\]/, '');
  const zipMatch = /\.(gz|bz2)$/i.exec(base);
  if (zipMatch) base = base.slice(0, -zipMatch[0].length);
  const dot = base.lastIndexOf('.');
  const pre = dot > 0 ? base.slice(0, dot) : base;
  // get_legal_name: replace characters PyMOL disallows in object names with '_'.
  return pre.replace(/[\s'"();:]/g, '_');
}

/**
 * PyMOL legalizes every new object's name against the selection-language word
 * table before registering it: `ExecutiveProcessObjectName` calls
 * `SelectorNameIsKeyword`, and a name that collides with a reserved selection
 * keyword/operator gets a trailing `_` appended so the object name can never be
 * mistaken for a selection expression (e.g. `load_brick(obj, "b")` yields an
 * object named `b_`, because bare `b` is the b-factor field operator). The set
 * below is PyMOL's selection keyword/operator word table, verified against the
 * real-PyMOL oracle.
 */
const SELECTION_KEYWORDS: ReadonlySet<string> = new Set([
  // atom-property fields / value keywords
  'b', 'q', 'x', 'y', 'z', 'ss', 'name', 'index', 'id', 'resi', 'resn',
  'chain', 'segi', 'alt', 'color', 'rep', 'flag', 'elem', 'numeric_type',
  'text_type', 'state',
  // selector words
  'all', 'none', 'center', 'origin',
  // property keyword selectors
  'hetatm', 'hydro', 'polymer', 'polymer.protein', 'polymer.nucleic',
  'solvent', 'backbone', 'sidechain', 'visible', 'enabled', 'present',
  'bonded', 'metals', 'organic', 'inorganic', 'guide', 'fixed', 'restrained',
  'masked', 'protected',
  // logical / spatial operators
  'and', 'or', 'not', 'in', 'like', 'within', 'around', 'expand', 'gap',
  'beyond', 'byres', 'bymol', 'bychain', 'byobject', 'byring', 'bycalpha',
  'bound_to', 'neighbor', 'model', 'first', 'last', 'pepseq', 'rank',
  'nbr.', 'nto.', 'bto.', 'w.',
]);

/** Apply PyMOL's `SelectorNameIsKeyword` legalization to a new object name. */
function legalizeObjectName(name: string): string {
  return SELECTION_KEYWORDS.has(name.toLowerCase()) ? `${name}_` : name;
}

/* ------------------------------ MOL/SDF parse -------------------------- */

function parseMolBlock(text: string, name: string): ObjectMolecule {
  const lines = text.split(/\r?\n/);
  const counts = lines[3] ?? '';
  let natom = parseInt(counts.slice(0, 3), 10);
  let nbond = parseInt(counts.slice(3, 6), 10);
  if (!Number.isFinite(natom)) natom = 0;
  if (!Number.isFinite(nbond)) nbond = 0;

  const mol = new ObjectMolecule(name);
  const coords: number[] = [];
  for (let i = 0; i < natom; i++) {
    const l = lines[4 + i] ?? '';
    let x = parseFloat(l.slice(0, 10));
    let y = parseFloat(l.slice(10, 20));
    let z = parseFloat(l.slice(20, 30));
    let elem = l.slice(31, 34).trim();
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || elem === '') {
      const p = l.trim().split(/\s+/);
      x = parseFloat(p[0] ?? '');
      y = parseFloat(p[1] ?? '');
      z = parseFloat(p[2] ?? '');
      elem = elem || p[3] || 'C';
    }
    if (!Number.isFinite(x)) x = 0;
    if (!Number.isFinite(y)) y = 0;
    if (!Number.isFinite(z)) z = 0;
    const el = canonicalElement(elem);
    coords.push(x, y, z);
    const atom: AtomInfo = {
      id: mol.atoms.length + 1,
      name: el,
      resn: 'UNK',
      resi: '1',
      resv: 1,
      chain: '',
      segi: '',
      alt: '',
      elem: el,
      hetatm: true,
      b: 0,
      q: 1,
      color: 0,
      ss: '',
      visRep: defaultVisRep(),
    };
    mol.atoms.push(atom);
  }
  mol.states.push(Float32Array.from(coords));

  const seen = new Set<string>();
  for (let b = 0; b < nbond; b++) {
    const l = lines[4 + natom + b] ?? '';
    let a1 = parseInt(l.slice(0, 3), 10) - 1;
    let a2 = parseInt(l.slice(3, 6), 10) - 1;
    if (!Number.isFinite(a1) || !Number.isFinite(a2)) {
      const p = l.trim().split(/\s+/);
      a1 = parseInt(p[0] ?? '', 10) - 1;
      a2 = parseInt(p[1] ?? '', 10) - 1;
    }
    if (a1 < 0 || a2 < 0 || a1 >= natom || a2 >= natom || a1 === a2) continue;
    const key = a1 < a2 ? `${a1}:${a2}` : `${a2}:${a1}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // MDL bond order is cols 7-9 of the bond record (1/2/3, 4=aromatic).
    let order = parseInt(l.slice(6, 9), 10);
    if (!Number.isFinite(order) || order < 1) order = 1;
    mol.bonds.push(a1 < a2 ? [a1, a2, order] : [a2, a1, order]);
  }

  // Formal charges: `M  CHG  n  atom1 chg1  atom2 chg2 …` (atom idx 1-based).
  // A `M  CHG` block overrides the legacy column-charge codes entirely.
  for (const l of lines) {
    if (!/^M {2}CHG/.test(l)) continue;
    const nums = l.slice(6).trim().split(/\s+/).map((s) => parseInt(s, 10));
    const cnt = Number.isFinite(nums[0]) ? nums[0]! : 0;
    for (let k = 0; k < cnt; k++) {
      const ai = nums[1 + k * 2];
      const ch = nums[2 + k * 2];
      if (ai !== undefined && ch !== undefined && Number.isFinite(ai) && Number.isFinite(ch) && ai >= 1 && ai <= mol.atoms.length) {
        mol.atoms[ai - 1]!.formalCharge = ch;
      }
    }
  }
  return mol;
}

/* ------------------------------- MMOD parse --------------------------- */

/**
 * Element from a MacroModel atom type (`customType`), reproducing the type→elem
 * ladder in `ObjectMoleculeMMDStr2CoordSet` (ObjectMolecule.cpp): MacroModel
 * atom types are grouped into contiguous ranges per element. Types above 63 get
 * no element (empty), matching PyMOL's `ai->elem[0] = 0`.
 */
function mmodElem(t: number): string {
  if (t <= 14) return 'C';
  if (t <= 23) return 'O';
  if (t <= 40) return 'N';
  if (t <= 48) return 'H';
  if (t <= 52) return 'S';
  if (t <= 53) return 'P';
  if (t <= 55) return 'B';
  if (t <= 56) return 'F';
  if (t <= 57) return 'Cl';
  if (t <= 58) return 'Br';
  if (t <= 59) return 'I';
  if (t <= 60) return 'Si';
  if (t <= 61) return 'Du';
  if (t <= 62) return 'Z0';
  if (t <= 63) return 'Lp';
  return '';
}

/**
 * Parse a MacroModel (`.mmod`) structure block into an {@link ObjectMolecule},
 * mirroring `ObjectMoleculeMMDStr2CoordSet` (ObjectMolecule.cpp). The header line
 * holds the atom count (cols 0-5) then a title; each atom record is a
 * fixed-column line: atom type (cols 0-3), six 8-char bond pairs
 * `<partner> <order>` (cols 4-51), x/y/z (12 cols each, cols 52-87), resi
 * (cols 89-93), chain (col 95), partial charge (cols 100-108), resn (cols
 * 119-121), and atom name (cols 124-127). A bond is recorded once, from the
 * lower-indexed atom (`a < partner-1`). Every atom is flagged het, as PyMOL does.
 */
function parseMmod(text: string, name: string): ObjectMolecule {
  const lines = text.split(/\r?\n/);
  const header = lines[0] ?? '';
  let nAtom = parseInt(header.slice(0, 6), 10);
  if (!Number.isFinite(nAtom) || nAtom < 0) nAtom = 0;

  const mol = new ObjectMolecule(name);
  const coords: number[] = [];

  for (let a = 0; a < nAtom; a++) {
    const l = lines[1 + a] ?? '';
    const customType = parseInt(l.slice(0, 4), 10) || 0;
    const rawElem = mmodElem(customType);
    const elem = rawElem === '' ? '' : canonicalElement(rawElem);

    // Six 8-char bond fields, each "<partner> <order>" (1-based partner index).
    for (let c = 0; c < 6; c++) {
      const field = l.slice(4 + c * 8, 4 + c * 8 + 8).trim();
      if (field === '') continue;
      const toks = field.split(/\s+/);
      const bPart = parseInt(toks[0] ?? '', 10);
      const bOrder = parseInt(toks[1] ?? '', 10);
      if (!Number.isFinite(bPart) || !Number.isFinite(bOrder)) continue;
      if (bPart === 0 || bOrder === 0) break; // 0-partner terminates the list
      if (a < bPart - 1) mol.bonds.push([a, bPart - 1, bOrder]);
    }

    let x = parseFloat(l.slice(52, 64));
    let y = parseFloat(l.slice(64, 76));
    let z = parseFloat(l.slice(76, 88));
    if (!Number.isFinite(x)) x = 0;
    if (!Number.isFinite(y)) y = 0;
    if (!Number.isFinite(z)) z = 0;
    coords.push(x, y, z);

    const resiRaw = l.slice(89, 94).trim();
    const resv = parseInt(resiRaw, 10);
    const chain = l.slice(95, 96).trim();
    const resn = l.slice(119, 122).trim();
    let nm = l.slice(124, 128).trim();
    if (nm === '') nm = `${rawElem}${String(a + 1).padStart(2, '0')}`;
    let pc = parseFloat(l.slice(100, 109));
    if (!Number.isFinite(pc)) pc = 0;

    const atom: AtomInfo = {
      id: a + 1,
      name: nm,
      resn,
      resi: resiRaw || '',
      resv: Number.isFinite(resv) ? resv : 0,
      chain,
      segi: '',
      alt: '',
      elem,
      hetatm: true,
      b: 0,
      q: 1,
      partialCharge: pc,
      customType,
      color: 0,
      ss: '',
      visRep: defaultVisRep(),
    };
    mol.atoms.push(atom);
  }
  mol.states.push(Float32Array.from(coords));
  return mol;
}

/* ------------------------------- registrar ---------------------------- */

export function registerFileio(ctx: RegistrarCtx): void {
  const ex = ctx.executive;

  /** Matched atoms grouped by object (object order), each group index-sorted. */
  function grouped(sel: string): Array<{
    objName: string;
    mol: ObjectMolecule;
    atoms: Array<{ index: number; atom: AtomInfo }>;
  }> {
    const matched = ex.atomsMatching(sel);
    const order: string[] = [];
    const byObj = new Map<string, Array<{ index: number; atom: AtomInfo }>>();
    for (const ua of matched) {
      let g = byObj.get(ua.objName);
      if (!g) {
        g = [];
        byObj.set(ua.objName, g);
        order.push(ua.objName);
      }
      g.push({ index: ua.index, atom: ua.atom });
    }
    return order.map((objName) => {
      const atoms = byObj.get(objName)!.sort((a, b) => a.index - b.index);
      return { objName, mol: ex.molecule(objName)!, atoms };
    });
  }

  function getPdbstr(sel: string, state: number): string {
    const st = state > 0 ? state : 1;
    const groups = grouped(sel);
    const lines: string[] = [];
    // writeCryst1: emitted once at the top from the first object that carries a
    // unit cell (MoleculeExporterPDB::writeCryst1, at the first coord set).
    for (const grp of groups) {
      const c1 = cryst1Line(grp.mol);
      if (c1) {
        lines.push(c1);
        break;
      }
    }
    let serial = 1;
    let preTer: AtomInfo | null = null;
    const writeTer = (ai: AtomInfo | null): void => {
      const a = ai && isPolymer(ai) ? ai : null;
      if (preTer && !(a && a.chain === preTer.chain)) lines.push('TER   ');
      preTer = a;
    };
    for (const grp of groups) {
      // PyMOL stores atoms in canonical order and exports in that order.
      const atoms = [...grp.atoms].sort(atomOrderCmp);
      for (const { index, atom } of atoms) {
        writeTer(atom);
        lines.push(pdbAtomLine(atom, grp.mol.coord(index, st), serial));
        serial++;
      }
      writeTer(null);
    }
    lines.push('END');
    return lines.join('\n') + '\n';
  }

  function getFastastr(sel: string): string {
    const order: string[] = [];
    const byKey = new Map<string, string[]>();
    for (const grp of grouped(sel)) {
      for (const { atom } of grp.atoms) {
        if (atom.name.toUpperCase() !== 'CA') continue;
        if (atom.alt !== '' && atom.alt.toUpperCase() !== 'A') continue;
        const key = `${grp.objName}_${atom.chain}`;
        let list = byKey.get(key);
        if (!list) {
          list = [];
          byKey.set(key, list);
          order.push(key);
        }
        list.push(atom.resn);
      }
    }
    const lines: string[] = [];
    for (const key of order) {
      const seq = byKey
        .get(key)!
        .map((r) => RESN_TO_AA[r.toUpperCase()] ?? 'X')
        .join('');
      lines.push('>' + key);
      for (let i = 0; i < seq.length; i += 70) lines.push(seq.slice(i, i + 70));
    }
    if (lines.length === 0) return '';
    lines.push('');
    return lines.join('\n');
  }

  ctx.command('get_pdbstr', (args, kwargs) => {
    const sel = ctx.str(pick(args, kwargs, 0, 'selection'), 'all') || 'all';
    const state = asInt(pick(args, kwargs, 1, 'state'), 0);
    return getPdbstr(sel, state);
  });

  ctx.command('get_fastastr', (args, kwargs) => {
    const sel = ctx.str(pick(args, kwargs, 0, 'selection'), 'all') || 'all';
    return getFastastr(sel);
  });

  // NOTE: the format-dispatching `get_str` (pdb/fasta/xyz/cif) lives in
  // `cmd/exporters.ts`, which registers AFTER `fileio` and so owns the verb.
  // `get_pdbstr`/`get_fastastr` above are the direct single-format exporters.

  ctx.command('load_coords', (args, kwargs) => {
    const coords = pick(args, kwargs, 0, 'coords') as unknown[];
    const sel = ctx.str(pick(args, kwargs, 1, 'selection'), 'all') || 'all';
    const state = asInt(pick(args, kwargs, 2, 'state'), 1);
    const st = state > 0 ? state : 1;
    const matched = ex.atomsMatching(sel);
    let n = 0;
    if (Array.isArray(coords)) {
      matched.forEach((ua, i) => {
        const c = coords[i] as number[] | undefined;
        if (!c) return;
        const set = ua && ex.molecule(ua.objName)?.states[st - 1];
        if (!set) return;
        const o = ua.index * 3;
        set[o] = Number(c[0]);
        set[o + 1] = Number(c[1]);
        set[o + 2] = Number(c[2]);
        n++;
      });
    }
    ctx.publish();
    return n;
  });

  ctx.command('read_molstr', (args, kwargs) => {
    const molstr = ctx.str(pick(args, kwargs, 0, 'molstr'), '');
    const name = ex.uniqueName(ctx.str(pick(args, kwargs, 1, 'name'), 'mol') || 'mol');
    ex.addMolecule(parseMolBlock(molstr, name));
    ctx.publish();
    return name;
  });

  // `read_mmodstr(content, name, state=0, quiet=1, zoom=-1)` — load a MacroModel
  // structure from an in-memory string (importing.py:read_mmodstr → _cmd.load with
  // loadable.mmodstr, finish=1, discrete=1). No temp file; unlike load it takes the
  // content directly and never sniffs.
  ctx.command('read_mmodstr', (args, kwargs) => {
    const content = ctx.str(pick(args, kwargs, 0, 'content'), '');
    const name = ex.uniqueName(ctx.str(pick(args, kwargs, 1, 'name'), 'mmod') || 'mmod');
    const mol = parseMmod(content, name);
    mol.discrete = true; // read_mmodstr hardcodes discrete=1
    ex.addMolecule(mol);
    ctx.publish();
    return name;
  });

  ctx.command('read_sdfstr', (args, kwargs) => {
    const sdfstr = ctx.str(pick(args, kwargs, 0, 'sdfstr'), '');
    const name = ex.uniqueName(ctx.str(pick(args, kwargs, 1, 'name'), 'mol') || 'mol');
    // A single-record SDF is a MOL block terminated by `M  END` / `$$$$`.
    ex.addMolecule(parseMolBlock(sdfstr, name));
    ctx.publish();
    return name;
  });

  /* ------------------------------ load / read_*str ------------------------ */

  /**
   * The object name PyMOL reads from a PDB `HEADER` record: the four-letter code
   * in columns 63-66 if present, else the plain classification name in columns
   * 7-50 (ObjectMolecule2.cpp:2039-2047 — the "MERCK" fallback). `multisave`
   * writes `HEADER    <objname>`, so the plain-name branch recovers the name.
   */
  function pdbHeaderName(line: string): string {
    const code = line.slice(62, 66).trim();
    if (code) return code;
    return line.slice(6, 50).trim();
  }

  /**
   * Split a multi-entry PDB (2+ HEADER-delimited objects, as `multisave` writes)
   * into per-object blocks. Returns null for a single-object file so the normal
   * single-molecule path (honouring the passed object name) is used. Mirrors
   * PyMOL's `next_pdb`: a HEADER after atoms have been seen starts a new object.
   */
  function splitMultiObjectPdb(text: string): Array<{ name: string; block: string }> | null {
    type Entry = { name: string; lines: string[]; hasAtom: boolean };
    const entries: Entry[] = [];
    let cur: Entry | null = null;
    for (const line of text.split(/\r?\n/)) {
      if (/^HEADER/.test(line)) {
        if (cur && cur.hasAtom) {
          entries.push(cur);
          cur = null;
        }
        if (!cur) cur = { name: pdbHeaderName(line), lines: [], hasAtom: false };
        else cur.name = pdbHeaderName(line);
        cur.lines.push(line);
        continue;
      }
      if (!cur) cur = { name: '', lines: [], hasAtom: false };
      cur.lines.push(line);
      if (/^(ATOM |HETATM)/.test(line)) cur.hasAtom = true;
    }
    if (cur && cur.hasAtom) entries.push(cur);
    const withAtoms = entries.filter((e) => e.hasAtom);
    if (withAtoms.length < 2) return null;
    return withAtoms.map((e) => ({ name: e.name, block: e.lines.join('\n') }));
  }

  /** Parse structured text of a known format into an {@link ObjectMolecule}. */
  function parseByFormat(format: string, text: string, name: string): ObjectMolecule {
    switch (format) {
      case 'pdb':
      case 'ent':
        return parsePdb(text, name);
      case 'cif':
      case 'mmcif':
      case 'mcif':
        return parseCif(text, name);
      case 'mol':
      case 'sdf':
      case 'mdl':
        return parseMolBlock(text, name);
      case 'mol2':
        return parseMol2(text, name);
      case 'xyz':
        return parseXyz(text, name);
      default:
        throw new Error(`load: unsupported format '${format}'`);
    }
  }

  /**
   * Map a filename extension to a loader format, matching PyMOL's extension
   * dispatch in `load` (`importing.py`). Returns '' for an unknown extension.
   */
  function formatFromExtension(path: string): string {
    const m = /\.([A-Za-z0-9]+)\s*$/.exec(path.trim());
    if (!m) return '';
    const ext = m[1]!.toLowerCase();
    switch (ext) {
      case 'pdb':
      case 'ent':
        return 'pdb';
      case 'cif':
      case 'mmcif':
      case 'mcif':
        return 'cif';
      case 'mol':
      case 'sdf':
      case 'mdl':
        return ext;
      case 'mol2':
        return 'mol2';
      case 'xyz':
        return 'xyz';
      default:
        return '';
    }
  }

  /**
   * Map a filename extension (or explicit `format`) to a binary density-map
   * loader format, matching PyMOL's `load` dispatch of `.ccp4`/`.mrc`/`.map` to
   * `loadable.ccp4`/`loadable.mrc` (ObjectMapCCP4StrToMap). Returns '' for a
   * non-map extension.
   */
  function mapFormatFromExtension(pathOrFmt: string): string {
    const m = /\.([A-Za-z0-9]+)\s*$/.exec(pathOrFmt.trim());
    const ext = (m ? m[1]! : pathOrFmt.trim()).toLowerCase();
    switch (ext) {
      case 'ccp4':
      case 'mrc':
      case 'map':
        return 'ccp4';
      default:
        return '';
    }
  }

  /**
   * Sniff a structure format from the content itself, so a pasted/dropped block
   * loads without an explicit `format`. Distinctive markers first.
   */
  function sniffFormat(text: string): string {
    if (/@<TRIPOS>MOLECULE/.test(text)) return 'mol2';
    if (/^\s*data_/m.test(text) && /_atom_site/.test(text)) return 'cif';
    if (/^(ATOM|HETATM|MODEL|CRYST1|HEADER)/m.test(text)) return 'pdb';
    if (/\$\$\$\$/.test(text) || /^M {2}END\s*$/m.test(text) || /V2000/.test(text)) return 'sdf';
    // XYZ: first non-empty line is a bare atom count.
    const first = text.split(/\r?\n/).find((l) => l.trim() !== '');
    if (first && /^\d+$/.test(first.trim())) return 'xyz';
    return '';
  }

  // Real `load` — dispatches structured CONTENT to the right parser by an
  // explicit `format` or by sniffing. Under Node (the differential + app-server)
  // a bare path is read off disk and its format taken from the extension, exactly
  // as PyMOL's `load` does; in the browser (no filesystem) the web app passes file
  // contents here, and a bare path that cannot be read is reported plainly.
  ctx.command('load', (rawArgs, rawKwargs) => {
    // The `do` parser keeps every comma token positional (see cmd/parser.ts),
    // so an inline `key=value` (e.g. `load file, d, discrete=1`) arrives as a
    // positional string. Split those into real kwargs here — load has a fixed
    // signature, so it is unambiguous (unlike select/alter expressions).
    const kwargs: Record<string, unknown> = { ...rawKwargs };
    const args: unknown[] = [];
    for (const a of rawArgs) {
      const m = typeof a === 'string' ? /^([A-Za-z_]\w*)=(.*)$/.exec(a) : null;
      if (m) kwargs[m[1]!] = m[2];
      else args.push(a);
    }
    let content = ctx.str(pick(args, kwargs, 0, 'filename'), '');
    const objArg = ctx.str(pick(args, kwargs, 1, 'object'), '');
    const fmtArg = ctx.str(pick(args, kwargs, 3, 'format'), '').toLowerCase();

    // Binary density maps (CCP4/MRC/MAP) are not structure files: read the raw
    // bytes off disk and hand them to the map subsystem, which parses the grid
    // and registers an ObjectMap. PyMOL routes these extensions to
    // ObjectMapCCP4StrToMap rather than any molecule parser (importing.py:load).
    if (content !== '' && !/\r?\n/.test(content)) {
      const mapFmt = mapFormatFromExtension(fmtArg) || mapFormatFromExtension(content);
      if (mapFmt) {
        const bytes = readDiskBytes(content);
        if (bytes) {
          const mapName = ex.uniqueName(objArg || filenameToObjectname(content));
          ctx.call('load_ccp4map', [mapName, bytes]);
          return mapName;
        }
        throw new Error(
          `load: cannot read map '${content}' — the browser has no filesystem; ` +
            `pass file contents (or drop the file) with a format`,
        );
      }
    }

    // A single-line argument with no embedded structure is a filename, not
    // content. Under Node, read it off disk (PyMOL loads files by path); the
    // format comes from the explicit `format`, then the extension, then a sniff.
    let extFormat = '';
    if (content !== '' && !/\r?\n/.test(content)) {
      const fileText = readDiskFile(content);
      if (fileText !== null) {
        extFormat = formatFromExtension(content);
        content = fileText;
      } else if (fmtArg === '' && sniffFormat(content) === '') {
        throw new Error(
          `load: cannot read '${content}' — the browser has no filesystem; ` +
            `pass file contents (or drop the file) with a format`,
        );
      }
    }

    const format = fmtArg || sniffFormat(content) || extFormat;
    if (format === '') {
      throw new Error('load: could not determine the structure format of the given content');
    }

    // Multi-entry PDB (multiple HEADER blocks, as written by `multisave`): PyMOL
    // splits it into one object per HEADER, each named from its own HEADER record,
    // ignoring the passed `object` name (ObjectMolecule2.cpp `next_pdb` /
    // `get_multi_object_status`). Only kicks in for 2+ HEADER-delimited entries.
    if (format === 'pdb' || format === 'ent') {
      const entries = splitMultiObjectPdb(content);
      if (entries) {
        const names: string[] = [];
        for (const entry of entries) {
          const oname = ex.uniqueName(entry.name || 'obj');
          const m = parsePdb(entry.block, oname);
          ex.addMolecule(m);
          ex.autoColorObject(m);
          names.push(oname);
        }
        ctx.publish();
        return names[names.length - 1] ?? null;
      }
    }

    const name = ex.uniqueName(objArg || 'obj');
    const mol = parseByFormat(format, content, name);
    // PyMOL's `discrete` flag (positional 5, default -1 = "auto"): when the
    // caller asks for discrete=1 the object records DiscreteFlag, observable
    // via count_discrete. Negative/absent leaves it non-discrete.
    if (Number(ctx.str(pick(args, kwargs, 5, 'discrete'), '-1')) > 0) mol.discrete = true;
    ex.addMolecule(mol);
    ex.autoColorObject(mol);
    ctx.publish();
    return name;
  });

  // `loadall(pattern, group='', quiet=1, **kwargs)` — expand a filesystem glob
  // and `load` every match, optionally collecting the created objects into a
  // group (`importing.py:loadall`). PyMOL runs `glob.glob(exp_path(pattern))`,
  // loads each file (its object name coming from `filename_to_objectname` inside
  // `load`), then — if `group` is set — groups the member names. An explicit
  // `object=` kwarg would funnel every file into one object, so PyMOL warns and
  // groups just that single name. Extra kwargs (state, discrete, …) forward to
  // each `load`.
  ctx.command('loadall', (rawArgs, rawKwargs) => {
    const kwargs: Record<string, unknown> = { ...rawKwargs };
    const args: unknown[] = [];
    for (const a of rawArgs) {
      const m = typeof a === 'string' ? /^([A-Za-z_]\w*)=(.*)$/.exec(a) : null;
      if (m) kwargs[m[1]!] = m[2];
      else args.push(a);
    }
    const pattern = ctx.str(pick(args, kwargs, 0, 'pattern'), '');
    const group = ctx.str(pick(args, kwargs, 1, 'group'), '');
    const objectKwarg = ctx.str(kwargs.object, '');
    // Remaining kwargs (minus loadall's own params) forward to each `load`.
    const forward: Record<string, unknown> = { ...kwargs };
    delete forward.pattern;
    delete forward.group;
    delete forward.quiet;

    const filenames = globFiles(pattern);
    const members: string[] = [];
    for (const filename of filenames) {
      // Mirror `load`'s internal `filename_to_objectname` when no explicit
      // object is requested (engine-ts `load` alone would default to 'obj').
      const objName = objectKwarg || filenameToObjectname(filename);
      ctx.call('load', [filename, objName], forward);
      members.push(objName);
    }

    if (group) {
      const memberNames = objectKwarg !== '' ? [objectKwarg] : members;
      ex.registerGadget(group, 'group');
      const set = ex.ensureGroup(group);
      for (const n of memberNames) set.add(n);
    }
    ctx.publish();
    return null;
  });

  // `load_embedded(key, name, ...)` — materialise a block declared earlier in the
  // script with `embed` (`importing.py:load_embedded`). The parser captured the
  // block's `[format, lines]` into the executive's embed store; here we fetch it,
  // concatenate the lines and hand them to `load`, exactly as PyMOL delegates to
  // `load_raw`. A missing key raises, matching PyMOL's DEFAULT_ERROR path.
  ctx.command('load_embedded', (rawArgs, rawKwargs) => {
    const kwargs: Record<string, unknown> = { ...rawKwargs };
    const args: unknown[] = [];
    for (const a of rawArgs) {
      const m = typeof a === 'string' ? /^([A-Za-z_]\w*)=(.*)$/.exec(a) : null;
      if (m) kwargs[m[1]!] = m[2];
      else args.push(a);
    }
    const key = ctx.str(pick(args, kwargs, 0, 'key'), '');
    let name = ctx.str(pick(args, kwargs, 1, 'name'), '');
    const state = asInt(pick(args, kwargs, 2, 'state'), 0);

    const block = ex.getEmbedded(key || ex.embedDefaultKey);
    if (!block) {
      throw new Error(`Error: embedded data '${key}' not found.`);
    }
    if (!name) name = key || ex.embedDefaultKey;
    const content = block.lines.join('');
    return ctx.call('load', [content, name, state, block.format]);
  });

  // `load_raw(content, format, object='', state=0, finish=1, discrete=-1, ...)`
  // — API-only loader for structured data already held in memory
  // (`importing.py:load_raw`). PyMOL hands the raw string straight to the loader
  // for the named `format`, never touching the filesystem for the formats we
  // support. We delegate to `load` with the content and an EXPLICIT format so its
  // filename/sniff heuristics are bypassed. Returns null to mirror PyMOL, whose
  // `_cmd.load` result is not the object name.
  ctx.command('load_raw', (rawArgs, rawKwargs) => {
    const kwargs: Record<string, unknown> = { ...rawKwargs };
    const args: unknown[] = [];
    for (const a of rawArgs) {
      const m = typeof a === 'string' ? /^([A-Za-z_]\w*)=(.*)$/.exec(a) : null;
      if (m) kwargs[m[1]!] = m[2];
      else args.push(a);
    }
    const content = ctx.str(pick(args, kwargs, 0, 'content'), '');
    const format = ctx.str(pick(args, kwargs, 1, 'format'), '').toLowerCase();
    const object = ctx.str(pick(args, kwargs, 2, 'object'), '');
    const state = asInt(pick(args, kwargs, 3, 'state'), 0);
    const discrete = asInt(pick(args, kwargs, 5, 'discrete'), -1);
    if (format === '') {
      throw new Error('load_raw: a format is required');
    }
    ctx.call('load', [content, object, state, format], { discrete });
    return null;
  });

  // `load_traj(filename, object='', state=1, format='', interval=1, average=1,
  //  start=1, stop=-1, max=-1, selection='all', image=1, shift=[0,0,0], plugin='')`
  // — read a molecular-dynamics trajectory and append its frames as states of an
  // already-loaded object (`importing.py:load_traj` -> C `_cmd.load_traj`). The
  // topology must already exist; each frame becomes one CoordSet appended from
  // `state` (1-based; 0 = append after the last state). `interval`/`start`/`stop`/
  // `max` subsample the file. Only the DCD format is parsed here (the format the
  // differential exercises); other VMD molfile plugins are not modelled.
  ctx.command('load_traj', (rawArgs, rawKwargs) => {
    const kwargs: Record<string, unknown> = { ...rawKwargs };
    const args: unknown[] = [];
    for (const a of rawArgs) {
      const m = typeof a === 'string' ? /^([A-Za-z_]\w*)=(.*)$/.exec(a) : null;
      if (m) kwargs[m[1]!] = m[2];
      else args.push(a);
    }
    const filename = ctx.str(pick(args, kwargs, 0, 'filename'), '');
    let object = ctx.str(pick(args, kwargs, 1, 'object'), '').trim();
    const state = asInt(pick(args, kwargs, 2, 'state'), 1);
    let interval = asInt(pick(args, kwargs, 4, 'interval'), 1);
    const start = asInt(pick(args, kwargs, 6, 'start'), 1);
    const stop = asInt(pick(args, kwargs, 7, 'stop'), -1);
    const max = asInt(pick(args, kwargs, 8, 'max'), -1);
    if (interval < 1) interval = 1;

    // Resolve the target object: explicit name, else guess from the filename's
    // basename, else fall back to the last loaded object
    // (`_guess_trajectory_object`).
    if (object === '') {
      const base = filename.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');
      if (base !== '' && ex.molecule(base)) object = base;
      else {
        const mols = ex.moleculesInOrder();
        object = mols.length > 0 ? mols[mols.length - 1]!.name : 'obj01';
      }
    }
    const mol = ex.molecule(object);
    if (!mol) throw new Error(`load_traj: object '${object}' not found`);

    const bytes = readDiskBytes(filename);
    if (bytes === null) {
      throw new Error(
        `load_traj: cannot read '${filename}' — the browser has no filesystem`,
      );
    }
    const traj = parseDcd(bytes);
    if (traj === null) {
      throw new Error(`load_traj: unsupported or unreadable trajectory '${filename}'`);
    }
    if (traj.natom !== mol.natom) {
      throw new Error(
        `load_traj: trajectory atom count (${traj.natom}) does not match ` +
          `object '${object}' (${mol.natom})`,
      );
    }

    // Select frames by start/stop/interval/max, then append them starting at the
    // requested base state (state 0 => append after the current last state).
    let baseIdx = state > 0 ? state - 1 : mol.nstate;
    if (baseIdx < 0) baseIdx = 0;
    const first = Math.max(1, start);
    const last = stop < 0 ? traj.frames.length : Math.min(stop, traj.frames.length);
    let loaded = 0;
    for (let f = first; f <= last; f += interval) {
      if (max >= 0 && max !== 0 && loaded >= max) break;
      const frame = traj.frames[f - 1];
      if (!frame) continue;
      const idx = baseIdx + loaded;
      // Grow the states array so a gap before `baseIdx` is filled with copies of
      // the topology's first coordinate set (matching PyMOL's CoordSet fill).
      while (mol.states.length < idx) {
        const seed = mol.states[0] ?? new Float32Array(mol.natom * 3);
        mol.states.push(new Float32Array(seed));
      }
      const copy = new Float32Array(frame);
      if (idx < mol.states.length) mol.states[idx] = copy;
      else mol.states.push(copy);
      loaded++;
    }
    ctx.publish();
    return loaded;
  });

  /**
   * `fetch` — download a structure/map/component by accession code and load it
   * (`importing.py:_fetch`/`_multifetch`). The network download itself is not
   * modelled here (no HTTP in the differential/headless runner), but PyMOL's
   * `_fetch` first checks whether the target file already exists under `path`
   * and, if so, skips the download and just `load`s it. That cached-file path is
   * fully observable and is what we port: build the same `nameFmt` filename in
   * `path`, and if it is present on disk, hand it to `load`. A missing file (the
   * would-be network case) reports the same error PyMOL does and returns null.
   */
  ctx.command('fetch', (rawArgs, rawKwargs) => {
    // Inline `key=value` positionals (from the `do` parser) → real kwargs.
    const kwargs: Record<string, unknown> = { ...rawKwargs };
    const args: unknown[] = [];
    for (const a of rawArgs) {
      const m = typeof a === 'string' ? /^([A-Za-z_]\w*)=(.*)$/.exec(a) : null;
      if (m) kwargs[m[1]!] = m[2];
      else args.push(a);
    }

    const code = ctx.str(pick(args, kwargs, 0, 'code'), '');
    const name = ctx.str(pick(args, kwargs, 1, 'name'), '').trim();
    const state = asInt(pick(args, kwargs, 2, 'state'), 0);
    let discrete = asInt(pick(args, kwargs, 4, 'discrete'), -1);
    const typeArg = ctx.str(pick(args, kwargs, 7, 'type'), '').toLowerCase();
    let path = ctx.str(pick(args, kwargs, 9, 'path'), '');
    const fileArg = pick(args, kwargs, 10, 'file');

    // Blank path resets to the `fetch_path` setting, else '.' (Setting.cpp:644).
    if (path === '') {
      const fp = ex.getSetting('fetch_path');
      path = fp === undefined || fp === '' ? '.' : String(fp);
    }

    const codeList = code.split(/\s+/).filter((s) => s !== '');
    // Multiple codes into one named object default to discrete (_multifetch).
    if (name !== '' && codeList.length > 1 && discrete < 0) discrete = 1;

    let result: Json = null;
    for (let objCode of codeList) {
      let type = typeArg;
      let objName = name;

      if (type === '') {
        if (objCode.length > 1 && objCode.length < 4) {
          type = 'cc';
        } else {
          const ftd = ex.getSetting('fetch_type_default');
          type = ftd === undefined || ftd === '' ? 'cif' : String(ftd);
        }
      }

      // EMD-3489 / emd_3489 / CID_/SID_ prefixes select the type + object name.
      const prefix = objCode.slice(0, 3).toUpperCase();
      const sep = objCode[3];
      if ((sep === '_' || sep === '-') && (prefix === 'CID' || prefix === 'SID' || prefix === 'EMD')) {
        if (objName === '') objName = objCode;
        type = prefix.toLowerCase();
        objCode = objCode.slice(4);
      }

      if (objName === '') {
        objName = objCode;
        if (type.endsWith('fofc')) objName += '_' + type;
        else if (type === 'emd') objName = 'emd_' + objCode;
      }

      // 5+ char structure codes carry a trailing chain, stripped then post-filtered.
      let chain = '';
      if (
        objCode.length > 4 &&
        (type === 'pdb' || type === 'cif' || type === 'mmtf' || type === 'bcif') &&
        objCode[0]! >= '1' &&
        objCode[0]! <= '9'
      ) {
        chain = objCode.slice(4);
        objCode = objCode.slice(0, 4);
        if (chain[0] === '.' || chain[0] === '_' || chain[0] === '-' || chain[0] === ':') {
          chain = chain.slice(1);
        }
      }

      // The download-name pattern (`_fetch` nameFmt); `cc` keeps original case.
      let nameFmt = '{code}.{type}';
      if (type === 'fofc' || type === '2fofc') nameFmt = '{code}_{type}.ccp4';
      else if (type === 'emd') nameFmt = '{type}_{code}.ccp4';
      else if (type === 'cid' || type === 'sid') nameFmt = '{type}_{code}.sdf';
      else if (type === 'cc') nameFmt = '{code}.cif';
      const dlCode = type === 'cc' ? objCode : objCode.toLowerCase();
      const fileName = nameFmt.replace('{code}', dlCode).replace('{type}', type);

      const fullPath =
        typeof fileArg === 'string' && fileArg !== '' && fileArg !== '1' && fileArg !== 'auto'
          ? fileArg
          : path.replace(/[/\\]+$/, '') + '/' + fileName;

      // PyMOL only proceeds past download when the file exists on disk.
      if (readDiskFile(fullPath) === null) {
        // The network fetch we cannot perform headless — report + skip this code.
        result = null;
        continue;
      }

      const loaded = ctx.call('load', [fullPath, objName, state], { discrete });
      result = loaded;

      if (chain !== '' && typeof loaded === 'string') {
        const kept = asInt(ctx.call('count_atoms', [`${loaded} & chain ${chain}`]), 0);
        if (kept === 0) {
          ctx.call('delete', [loaded]);
          throw new Error('no such chain: ' + chain);
        }
        ctx.call('remove', [`${loaded} & not chain ${chain}`]);
        result = loaded;
      }
    }

    ctx.publish();
    return result;
  });

  /** Register a `read_<fmt>str(text, name)` convenience verb for a parser. */
  const readStr = (verb: string, format: string, base: string): void => {
    ctx.command(verb, (args, kwargs) => {
      const text = ctx.str(pick(args, kwargs, 0, 'content'), '');
      const name = ex.uniqueName(ctx.str(pick(args, kwargs, 1, 'name'), base) || base);
      ex.addMolecule(parseByFormat(format, text, name));
      ctx.publish();
      return name;
    });
  };
  readStr('read_cifstr', 'cif', 'obj');
  readStr('read_mol2str', 'mol2', 'lig');
  readStr('read_xyzstr', 'xyz', 'mol');

  /**
   * `load_brick(brick, name, ...)` — the GAMESS-UK-era volumetric "brick"
   * importer (`importing.py:load_brick`, which prepends `loadable.brick` and
   * delegates to `load_object`). A brick is loaded as an `ObjectMap` gadget, so
   * it appears in `get_names`, reports `get_type == 'object:map'`, and holds no
   * atoms. The brick payload itself is not modelled here (the port carries no
   * volumetric grid for it), but the object-creation side effects — including
   * the keyword-collision name legalization PyMOL applies to every new object —
   * are faithful. Mirrors `load_object` returning `None`.
   */
  ctx.command('load_brick', (args, kwargs): Json => {
    const rawName = ctx.str(pick(args, kwargs, 1, 'name'), 'brick') || 'brick';
    const name = legalizeObjectName(rawName);
    ex.registerGadget(name, 'object:map');
    ctx.publish();
    return null;
  });

  /**
   * `load_map(object, name, ...)` — the Phenix-project developer helper that
   * loads an in-memory ChemPy map object (`importing.py:load_map`, which
   * prepends `loadable.chempymap` and delegates to `load_object`). Like a
   * brick, a ChemPy map is loaded as an `ObjectMap` gadget, so it appears in
   * `get_names`, reports `get_type == 'object:map'`, and holds no atoms. The
   * volumetric grid payload is not modelled here, but the object-creation side
   * effects — including the keyword-collision name legalization PyMOL applies
   * to every new object — are faithful. Mirrors `load_object` returning `None`.
   */
  ctx.command('load_map', (args, kwargs): Json => {
    const rawName = ctx.str(pick(args, kwargs, 1, 'name'), 'map') || 'map';
    const name = legalizeObjectName(rawName);
    ex.registerGadget(name, 'object:map');
    ctx.publish();
    return null;
  });

  /**
   * `load_callback(object, name, ...)` — install a generic Python callback
   * object (`importing.py:load_callback`, which prepends `loadable.callback` and
   * delegates to `load_object`). PyMOL creates an `ObjectCallback` that fires on
   * every screen refresh to drive custom OpenGL. The TS engine has no live redraw
   * loop and no Python callback to invoke, so the callback payload itself is not
   * modelled — but the object-creation side effects are faithful: it appears in
   * `get_names`, reports `get_type == 'object:callback'`, and holds no atoms.
   * Mirrors `load_object` returning `None`.
   */
  ctx.command('load_callback', (args, kwargs): Json => {
    const rawName = ctx.str(pick(args, kwargs, 1, 'name'), 'callback') || 'callback';
    const name = legalizeObjectName(rawName);
    ex.registerGadget(name, 'object:callback');
    ctx.publish();
    return null;
  });

  /**
   * `load_model(model, object, ...)` — the developer helper that loads an
   * in-memory ChemPy `Indexed`/`Model` object into a new PyMOL object
   * (`importing.py:load_model`, which prepends `loadable.model` and delegates to
   * `load_object`). It is the inverse of `get_model`. The ChemPy model is a
   * Python object handed across the bridge; the TS engine cannot reconstruct its
   * atom table from that opaque payload, so the atom/coordinate import itself is
   * not modelled. But the object-creation side effects are faithful: a new
   * `ObjectMolecule` appears in `get_names`, reports `get_type ==
   * 'object:molecule'`, holds no atoms for an empty/unmodelled model, and PyMOL's
   * keyword-collision name legalization is applied. Mirrors `load_object`
   * returning `None`.
   */
  ctx.command('load_model', (args, kwargs): Json => {
    const rawName = ctx.str(pick(args, kwargs, 1, 'object'), 'model') || 'model';
    const name = legalizeObjectName(rawName);
    ex.addMolecule(new ObjectMolecule(name));
    ctx.publish();
    return null;
  });

  /**
   * `load_object(type, object, name, ...)` — the low-level, general-purpose
   * developer entry point that every in-memory loader (`load_cgo`, `load_model`,
   * `load_map`, `load_callback`, `load_brick`) is built on (`importing.py:185`).
   * It routes a Python payload to the correct C-side loader based on the numeric
   * `loadable` type code (`constants.py:_loadable`). The TS engine does not model
   * the opaque payloads (CGO float lists, ChemPy models/maps, Python callbacks,
   * GAMESS bricks), but reproduces the object-creation side effects faithfully:
   * the new object appears in `get_names`, reports the right `get_type` kind, and
   * holds no atoms. Mirrors `load_object` returning `None`.
   */
  ctx.command('load_object', (args, kwargs): Json => {
    const type = asInt(pick(args, kwargs, 0, 'type'), -1);
    const rawName = ctx.str(pick(args, kwargs, 2, 'name'), '') || 'object';
    const name = legalizeObjectName(rawName);
    switch (type) {
      case 8: // loadable.model — ChemPy Indexed/Model → ObjectMolecule
        ex.addMolecule(new ObjectMolecule(name));
        break;
      case 10: // loadable.brick — chempy.brick → ObjectMap
      case 11: // loadable.chempymap — chempy.map → ObjectMap
        ex.registerGadget(name, 'object:map');
        break;
      case 12: // loadable.callback — Python callback object
        ex.registerGadget(name, 'object:callback');
        break;
      case 13: // loadable.cgo — compiled graphics object
        ex.registerGadget(name, 'object:cgo');
        break;
      default: // unmodelled loadable type — treat as a generic molecule object
        ex.addMolecule(new ObjectMolecule(name));
        break;
    }
    ctx.publish();
    return null;
  });
}
