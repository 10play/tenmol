/**
 * The `exporters` command subsystem: serialization of the executive's objects
 * to text (and back).
 *
 * Ports the string-producing exporters of PyMOL's `exporting.py` +
 * `layer3/MoleculeExporter*.cpp` that the covered slice needs beyond the PDB /
 * FASTA writers already living in `fileio.ts`:
 *
 *   - `get_cifstr`  — a minimal mmCIF `_atom_site` loop (round-trippable).
 *   - `get_str`     — the format dispatcher (adds `cif` and `xyz`; keeps `pdb`
 *                     and `fasta` working since this registrar runs after
 *                     `fileio` and would otherwise shadow its `get_str`).
 *   - `get_bytes`   — the UTF-8 bytes of a `get_str` result.
 *   - `dump`        — the current object's coordinates as `x,y,z` lines
 *                     (PyMOL dumps the rendered geometry's vertices; for the
 *                     port we dump the atom coordinates).
 *   - `multisave` / `multifilesave` — a concatenation of per-object PDB blocks.
 *   - `get_session` / `set_session` — a lightweight JSON snapshot of objects +
 *                     settings + camera. NOT PyMOL's pickle format; it captures
 *                     enough to restore object names, coordinates and the view.
 *
 * The PDB writer here is a self-contained replica of the column layout in
 * `CoordSetAtomToPDBStrVLA` / `AtomInfoGetAlignedPDBAtomName`, so it does not
 * depend on `fileio`'s (disjoint-file rule).
 */

import type { Json } from '@tenmol/protocol';
import type { AtomInfo } from '../model/atom';
import { defaultVisRep } from '../model/atom';
import { ObjectMolecule } from '../model/molecule';
import type { RegistrarCtx } from './registrar';

/* ------------------------------- helpers ------------------------------- */

const SOLVENT_RESN = new Set(['HOH', 'WAT', 'H2O', 'TIP', 'SOL']);
const RESN_TO_AA: Readonly<Record<string, string>> = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C',
  GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I',
  LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P',
  SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V',
};

function isPolymer(a: AtomInfo): boolean {
  return !a.hetatm && !SOLVENT_RESN.has(a.resn.toUpperCase());
}

/**
 * Write text to a file synchronously, or throw when no filesystem is reachable
 * (the browser). Under Node — where the differential and app-server run — this
 * reaches the real `fs` through `process.getBuiltinModule`, mirroring the disk
 * access `load` uses on the read side (see `fileio.ts` `readDiskFile`). This is
 * what lets `save`/`multifilesave` actually produce files on disk.
 */
function writeDiskFile(path: string, contents: string, append = false): void {
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  const getBuiltin = proc?.getBuiltinModule;
  if (typeof getBuiltin !== 'function') {
    throw new Error('save: no filesystem available in this environment');
  }
  const fs = getBuiltin.call(proc, 'node:fs') as {
    writeFileSync(p: string, data: string): void;
    appendFileSync(p: string, data: string): void;
  };
  if (append) fs.appendFileSync(path, contents);
  else fs.writeFileSync(path, contents);
}

/**
 * Guess a molecular file format token from a filename extension, mirroring the
 * subset of `importing.py` `filename_to_format` that the string exporters here
 * support. Falls back to `'pdb'`.
 */
function formatFromFilename(filename: string): string {
  const m = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  const ext = m ? m[1]! : '';
  switch (ext) {
    case 'cif':
    case 'mmcif':
      return 'cif';
    case 'xyz':
      return 'xyz';
    case 'fasta':
      return 'fasta';
    case 'mol':
      return 'mol';
    case 'sdf':
      return 'sdf';
    case 'mol2':
      return 'mol2';
    case 'ent':
    case 'pdb':
    default:
      return 'pdb';
  }
}

/** Right-justify into `width` (never truncates). */
function padL(s: string, width: number): string {
  return s.length >= width ? s : ' '.repeat(width - s.length) + s;
}
/** Left-justify into `width` (never truncates). */
function padR(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

/** Column-aligned PDB atom name (`AtomInfoGetAlignedPDBAtomName`, defaults). */
function alignedName(rawName: string, elem: string): string {
  const nm = rawName;
  const len = nm.length;
  if (len === 0) {
    return padR((elem.length <= 1 ? ' ' + elem : elem).slice(0, 4), 4);
  }
  const name4 = nm.slice(0, 4);
  let startCol1 = false;
  const c0 = name4[0] ?? '';
  if (len < 4) {
    if (!/[0-9]/.test(c0)) {
      const e0 = elem[0] ?? '';
      const e1 = elem[1] ?? '';
      const c1 = name4[1];
      const matchesSymbol =
        e0 !== '' &&
        c0.toUpperCase() === e0.toUpperCase() &&
        (e1 === '' || (c1 !== undefined && c1.toUpperCase() === e1.toUpperCase()));
      if (matchesSymbol) {
        if (e1 === '') startCol1 = true; // 1-letter symbol -> shift right
      } else {
        startCol1 = true; // name doesn't start with the element symbol
      }
    }
  }
  const name = startCol1 ? (' ' + name4).slice(0, 4) : name4;
  return padR(name, 4);
}

function resnField(resn: string): string {
  let r = resn.slice(0, 4);
  if (r.length < 3) r = padL(r, 3);
  return padR(r, 4);
}

function inscodeOf(resi: string): string {
  const m = resi.match(/^-?\d+(.*)$/);
  const ins = (m?.[1] ?? '').trim();
  return ins ? ins[0]! : ' ';
}

function coordFmt(v: number): string {
  return padL(v.toFixed(3), 8);
}

/**
 * Canonical atom-ordering priority (`AtomInfoAssignParameters`, layer2/
 * AtomInfo.cpp) for the default `pdb_standard_order = on`. Lower sorts first:
 * backbone N(1) CA(2) C(3) O(4) then side-chain by Greek letter, with the
 * unconventional-name escape hatch (priority 1000) when the name doesn't start
 * with its element symbol. PyMOL stores atoms in this order at load, so the PDB
 * exporter reproduces it here rather than emitting file order.
 */
function atomPriority(name: string, elem: string): number {
  // Skip leading digits, keeping at least one trailing character.
  let i = 0;
  while (i < name.length - 1 && name[i]! >= '0' && name[i]! <= '9') i++;
  const n = name.slice(i);
  const c0 = (n[0] ?? '').toUpperCase();
  const c1 = (n[1] ?? '').toUpperCase();
  const e0 = (elem[0] ?? '').toUpperCase();
  if (c0 !== e0) return 1000; // unconventional atom name — no assignment

  // Greek-letter position -> priority, for N/C/O/S heavy atoms.
  const greek: Record<string, number> = {
    B: 6, G: 7, D: 8, E: 9, Z: 10, H: 11, I: 12, J: 13, K: 14, L: 15, M: 16, N: 17,
  };
  // Numeric-suffix handling shared by the digit case (matches the C loop that
  // reads digits after the first char, with `P` and `*`/`'` escapes, +300).
  const digitBranch = (): number => {
    let pri = 0;
    for (let k = 1; k < n.length; k++) {
      const ch = n[k]!;
      if (ch === 'P') { pri -= 200; break; }
      if (ch === '*' || ch === "'") { pri = -100 - pri; break; }
      if (ch < '0' || ch > '9') break;
      pri = pri * 10 + (ch.charCodeAt(0) - 48);
    }
    return pri + 300;
  };

  switch (c0) {
    case 'N':
    case 'C':
    case 'O':
    case 'S':
      if (c1 === '') {
        if (c0 === 'N') return 1;
        if (c0 === 'C') return 3;
        if (c0 === 'O') return 4;
        return 1000;
      }
      if (c1 === 'A') return c0 === 'C' ? 2 : 5;
      if (c1 in greek) return greek[c1]!;
      // case 'X' has no `break` in the C source: it falls through into the
      // digit branch, so `OXT` etc. are ultimately scored by digitBranch().
      if (c1 === 'X' || (c1 >= '0' && c1 <= '9')) return digitBranch();
      return 500;
    case 'P':
      return 20;
    case 'D':
    case 'H': {
      // Hydrogens/deuteriums sort last (1000+).
      if (c1 === '') return 1001;
      if (c1 === 'A' || c1 === 'B') return 1003;
      const hgreek: Record<string, number> = {
        G: 1004, D: 1005, E: 1006, Z: 1007, H: 1008, I: 1009, J: 1010, K: 1011,
        L: 1012, M: 1013, N: 1002,
      };
      if (c1 in hgreek) return hgreek[c1]!;
      if (c1 === 'X') return 1999;
      if (c1 >= '0' && c1 <= '9') {
        let pri = 1020;
        for (let k = 1; k < n.length; k++) {
          const ch = n[k]!;
          if (ch < '0' || ch > '9') break;
          pri = pri * 10 + (ch.charCodeAt(0) - 48);
        }
        return pri + 25;
      }
      return 1500;
    }
    default:
      return 1000;
  }
}

/** Case-insensitive word comparison returning sign, mirroring `WordCompare`. */
function wordCmp(a: string, b: string): number {
  const x = a.toUpperCase();
  const y = b.toUpperCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

/** `AtomInfoNameCompare`: strip a single leading digit, compare, tie-break on
 *  the full name (so `1HB` sorts near `HB`, and `ND2` < `OD1`). */
function nameCmp(a: string, b: string): number {
  const n1 = /^[0-9]/.test(a) ? a.slice(1) : a;
  const n2 = /^[0-9]/.test(b) ? b.slice(1) : b;
  const c = wordCmp(n1, n2);
  return c !== 0 ? c : wordCmp(a, b);
}

/**
 * `AtomInfoCompare` (defaults) restricted to a single object: segi, chain,
 * hetatm, resv, inscode, resn, priority, name, alt, then rank (load order) as
 * the stable tie-break. Reproduces PyMOL's stored/exported atom order.
 */
function atomOrderCmp(
  a: { atom: AtomInfo; index: number },
  b: { atom: AtomInfo; index: number },
): number {
  const x = a.atom;
  const y = b.atom;
  let c = wordCmp(x.segi, y.segi);
  if (c) return c;
  c = wordCmp(x.chain, y.chain);
  if (c) return c;
  if (x.hetatm !== y.hetatm) return x.hetatm ? 1 : -1;
  if (x.resv !== y.resv) return x.resv < y.resv ? -1 : 1;
  const ia = inscodeOf(x.resi);
  const ib = inscodeOf(y.resi);
  if (ia !== ib) return ia < ib ? -1 : 1;
  c = wordCmp(x.resn, y.resn);
  if (c) return c;
  const pa = atomPriority(x.name, x.elem);
  const pb = atomPriority(y.name, y.elem);
  if (pa !== pb) return pa < pb ? -1 : 1;
  c = nameCmp(x.name, y.name);
  if (c) return c;
  const aa = x.alt || '';
  const ab = y.alt || '';
  if (aa !== ab) return aa < ab ? -1 : 1;
  return a.index - b.index; // rank: original load order
}

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
  if ((n === 'O2P' || n === 'OP2') && isNucleicResn(r)) return -1;
  return undefined;
}

const NUCLEIC_RESN = new Set([
  'A', 'C', 'G', 'U', 'I', 'T',
  'DA', 'DC', 'DG', 'DT', 'DU',
  'ADE', 'CYT', 'GUA', 'URA', 'THY',
]);
function isNucleicResn(resn: string): boolean {
  return NUCLEIC_RESN.has(resn.toUpperCase());
}

/** Formal charge for a PDB atom: the known-residue assignment wins (PyMOL's
 *  chemistry overrides file values); otherwise the atom's own `formalCharge`. */
function pdbFormalCharge(atom: AtomInfo): number {
  const known = knownFormalCharge(atom.resn, atom.name);
  return known !== undefined ? known : atom.formalCharge ?? 0;
}

/** PDB cols 79-80 charge field: `"1-"`, `"2+"`, … or blank (`pdb_formal_charges`
 *  format from `CoordSetAtomToPDBStrVLA`). */
function chargeField(charge: number): string {
  if (charge > 0 && charge < 10) return `${charge}+`;
  if (charge < 0 && charge > -10) return `${-charge}-`;
  return '  ';
}

function pdbAtomLine(atom: AtomInfo, xyz: readonly [number, number, number], serial: number): string {
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

/** Positional arg or same-named kwarg. */
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

/* ---- Python str.format() subset (for multifilenamegen) --------------- */

/** One parsed replacement field or literal run of a format string. */
interface FmtSeg {
  /** Literal text preceding the field (with `{{`/`}}` already unescaped). */
  literal: string;
  /** Field name (`''` for a positional `{}`), or `null` for a trailing run. */
  field: string | null;
  /** Format spec after `:` (e.g. `03d`), or `''`. */
  spec: string;
}

/**
 * Port of `string.Formatter().parse(fmt)` — split a Python format string into
 * (literal, field_name, format_spec) segments. Only the grammar
 * `multifilenamegen` needs (named/empty fields, simple specs, `{{`/`}}`
 * escapes) is supported.
 */
function parsePyFormat(fmt: string): FmtSeg[] {
  const out: FmtSeg[] = [];
  let literal = '';
  let i = 0;
  while (i < fmt.length) {
    const c = fmt[i]!;
    if (c === '{') {
      if (fmt[i + 1] === '{') {
        literal += '{';
        i += 2;
        continue;
      }
      // Read up to the matching '}'.
      const end = fmt.indexOf('}', i + 1);
      if (end < 0) throw new Error("Single '{' encountered in format string");
      const body = fmt.slice(i + 1, end);
      const colon = body.indexOf(':');
      const field = colon < 0 ? body : body.slice(0, colon);
      const spec = colon < 0 ? '' : body.slice(colon + 1);
      out.push({ literal, field, spec });
      literal = '';
      i = end + 1;
      continue;
    }
    if (c === '}') {
      if (fmt[i + 1] === '}') {
        literal += '}';
        i += 2;
        continue;
      }
      throw new Error("Single '}' encountered in format string");
    }
    literal += c;
    i += 1;
  }
  if (literal.length > 0) out.push({ literal, field: null, spec: '' });
  return out;
}

/** Zero-pad an integer to a Python `0<width>d`/`0<width>` spec (sign-aware). */
function applyIntSpec(value: number, spec: string): string {
  const m = spec.match(/^0(\d+)d?$/);
  const neg = value < 0;
  let digits = String(Math.abs(Math.trunc(value)));
  if (m) {
    const width = parseInt(m[1]!, 10);
    const total = digits.length + (neg ? 1 : 0);
    if (total < width) digits = '0'.repeat(width - total) + digits;
  }
  return (neg ? '-' : '') + digits;
}

/** Render one value against a format spec, mirroring `format(value, spec)`. */
function formatValue(value: string | number, spec: string): string {
  if (typeof value === 'number') return applyIntSpec(value, spec);
  return String(value);
}

/** The settings this lightweight session captures (Executive has no enumerator). */
const SESSION_SETTING_KEYS: readonly string[] = [
  'sphere_scale', 'stick_radius', 'nb_spheres_size', 'line_width',
  'field_of_view', 'orthoscopic', 'button_mode', 'button_mode_name',
  'mouse_grid', 'mouse_selection_mode',
];

/* ------------------------------- registrar ---------------------------- */

export function registerExporters(ctx: RegistrarCtx): void {
  const ex = ctx.executive;

  /** Matched atoms grouped by object (object order), each group index-sorted. */
  function grouped(
    sel: string,
  ): Array<{ objName: string; mol: ObjectMolecule; atoms: Array<{ index: number; atom: AtomInfo }> }> {
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
    const out: Array<{ objName: string; mol: ObjectMolecule; atoms: Array<{ index: number; atom: AtomInfo }> }> = [];
    for (const objName of order) {
      const mol = ex.molecule(objName);
      if (!mol) continue;
      const atoms = byObj.get(objName)!.sort((a, b) => a.index - b.index);
      out.push({ objName, mol, atoms });
    }
    return out;
  }

  /* ----------------------------- mmCIF ------------------------------- */

  // Port of `CifDataValueFormatter` (packages/engine/layer3/CifDataValueFormatter.cpp):
  // format a CIF (STAR) data value — return simple values as-is, quote the rest,
  // and substitute the default token `d` for the empty string.

  /** True if `s` contains any char in 0x01..0x20 (all whitespace, no printables). */
  function cifHasWhitespace(s: string): boolean {
    for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) <= 0x20) return true;
    return false;
  }

  /** True if `s` contains `quote` immediately followed by whitespace. */
  function cifHasQuotespace(s: string, quote: string): boolean {
    for (let i = 0; i < s.length; i++) {
      if (s[i] === quote && i + 1 < s.length && s.charCodeAt(i + 1) <= 0x20) return true;
    }
    return false;
  }

  /** Whether `s` is a "simple data value" per the CIF spec (needs no quoting). */
  function cifIsSimple(s: string): boolean {
    if ('_#$\'"[];'.includes(s[0]!)) return false;
    if (cifHasWhitespace(s)) return false;
    if ((s[0] === '.' || s[0] === '?') && s.length === 1) return false;
    const lower = s.toLowerCase();
    if (lower.startsWith('data_') || lower.startsWith('save_')) return false;
    if (lower === 'loop_' || lower === 'stop_' || lower === 'global_') return false;
    return true;
  }

  function cifQuoted(s: string): string {
    let quote: string | null = null;
    if (!s.includes('\n')) {
      if (!cifHasQuotespace(s, "'")) quote = "'";
      else if (!cifHasQuotespace(s, '"')) quote = '"';
    }
    if (!quote) {
      if (s.includes('\n;')) return '<UNQUOTABLE>';
      quote = '\n;';
    }
    return quote + s + quote;
  }

  /** `CifDataValueFormatter::operator()` — empty ⇒ default `d`, else simple/quoted. */
  function cifrepr(s: string, d = '.'): string {
    if (s === '') return d;
    if (cifIsSimple(s)) return s;
    return cifQuoted(s);
  }

  // printf-style field helpers matching the C `VLAprintf` format specifiers.
  const ljust = (s: string, w: number): string => (s.length >= w ? s : s + ' '.repeat(w - s.length));
  const rjust = (s: string, w: number): string => (s.length >= w ? s : ' '.repeat(w - s.length) + s);

  function getCifstr(sel: string, state: number): string {
    const st = state > 0 ? state : 1;
    // `# generated by PyMOL <ver>` header (MoleculeExporterCIF::init), _PyMOL_VERSION.
    let out = '# generated by PyMOL 3.2.0a\n';
    // Multi-export defaults to by-object: one data block + id counter per object.
    for (const grp of grouped(sel)) {
      const name = grp.objName;
      // data header (beginMolecule); pseudoatoms carry no cell symmetry.
      out += `#\ndata_${name}\n_entry.id ${cifrepr(name)}\n`;
      // atom-site loop header
      out +=
        '#\nloop_\n' +
        '_atom_site.group_PDB\n' +
        '_atom_site.id\n' +
        '_atom_site.type_symbol\n' +
        '_atom_site.label_atom_id\n' +
        '_atom_site.label_alt_id\n' +
        '_atom_site.label_comp_id\n' +
        '_atom_site.label_asym_id\n' +
        '_atom_site.label_entity_id\n' +
        '_atom_site.label_seq_id\n' +
        '_atom_site.pdbx_PDB_ins_code\n' +
        '_atom_site.Cartn_x\n' +
        '_atom_site.Cartn_y\n' +
        '_atom_site.Cartn_z\n' +
        '_atom_site.occupancy\n' +
        '_atom_site.B_iso_or_equiv\n' +
        '_atom_site.pdbx_formal_charge\n' +
        '_atom_site.auth_asym_id\n' +
        '_atom_site.pdbx_PDB_model_num\n';
      let id = 0;
      for (const { index, atom } of grp.atoms) {
        const [x, y, z] = grp.mol.coord(index, st);
        id++;
        // MoleculeExporterCIF::writeAtom — label_asym_id is segi, auth_asym_id is
        // chain; empty inscode/entity/alt collapse to '?'/'.'/'.' via cifrepr.
        out +=
          [
            ljust(atom.hetatm ? 'HETATM' : 'ATOM', 6), // %-6s group_PDB
            ljust(String(id), 3), //                      %-3d id
            cifrepr(atom.elem), //                         %s   type_symbol
            ljust(cifrepr(atom.name), 3), //               %-3s label_atom_id
            cifrepr(atom.alt), //                          %s   label_alt_id
            ljust(cifrepr(atom.resn), 3), //               %-3s label_comp_id
            cifrepr(atom.segi), //                         %s   label_asym_id
            cifrepr(''), //                                %s   label_entity_id
            String(atom.resv), //                          %d   label_seq_id
            cifrepr('', '?'), //                           %s   pdbx_PDB_ins_code
            rjust(x.toFixed(3), 6), //                     %6.3f Cartn_x
            rjust(y.toFixed(3), 6), //                     %6.3f Cartn_y
            rjust(z.toFixed(3), 6), //                     %6.3f Cartn_z
            rjust(atom.q.toFixed(2), 4), //                %4.2f occupancy
            rjust(atom.b.toFixed(2), 6), //                %6.2f B_iso_or_equiv
            String(atom.formalCharge ?? 0), //             %d   pdbx_formal_charge
            cifrepr(atom.chain), //                        %s   auth_asym_id
            String(st), //                                 %d   pdbx_PDB_model_num
          ].join(' ') + '\n';
      }
    }
    return out;
  }

  /* ------------------------------- XYZ ------------------------------- */

  function getXyzstr(sel: string, state: number): string {
    const st = state > 0 ? state : 1;
    const rows: string[] = [];
    let count = 0;
    for (const grp of grouped(sel)) {
      for (const { index, atom } of grp.atoms) {
        const [x, y, z] = grp.mol.coord(index, st);
        rows.push(`${atom.elem || 'C'} ${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)}`);
        count++;
      }
    }
    return `${count}\n${sel}\n${rows.join('\n')}${rows.length ? '\n' : ''}`;
  }

  /* ------------------------------- PDB ------------------------------- */

  function getPdbstr(sel: string, state: number): string {
    const st = state > 0 ? state : 1;
    const groups = grouped(sel);
    const lines: string[] = [];
    // writeCryst1 is emitted once at the top from the first object that carries
    // a unit cell (MoleculeExporterPDB::writeCryst1, called at the first coord set).
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
      const seq = (byKey.get(key) ?? []).map((r) => RESN_TO_AA[r.toUpperCase()] ?? 'X').join('');
      lines.push('>' + key);
      for (let i = 0; i < seq.length; i += 70) lines.push(seq.slice(i, i + 70));
    }
    if (lines.length === 0) return '';
    lines.push('');
    return lines.join('\n');
  }

  /** Matched atoms (with coords) and their bonds, reindexed to selection order. */
  function selAtomsBonds(sel: string, st: number): {
    atoms: Array<{ atom: AtomInfo; x: number; y: number; z: number }>;
    bonds: Array<[number, number, number]>;
  } {
    const matched = ex.atomsMatching(sel);
    const posOf = new Map<string, number>();
    matched.forEach((ua, i) => posOf.set(`${ua.objName} ${ua.index}`, i));
    const atoms = matched.map((ua) => {
      const [x, y, z] = ex.molecule(ua.objName)!.coord(ua.index, st);
      return { atom: ua.atom, x, y, z };
    });
    const bonds: Array<[number, number, number]> = [];
    const seen = new Set<string>();
    for (const ua of matched) {
      if (seen.has(ua.objName)) continue;
      seen.add(ua.objName);
      const mol = ex.molecule(ua.objName);
      if (!mol) continue;
      for (const [a, b, order] of mol.bonds) {
        const ia = posOf.get(`${ua.objName} ${a}`);
        const ib = posOf.get(`${ua.objName} ${b}`);
        if (ia === undefined || ib === undefined) continue;
        bonds.push([ia, ib, order ?? 1]);
      }
    }
    return { atoms, bonds };
  }

  /** An MDL V2000 molfile (cols line-exact so read_molstr round-trips). */
  function getMolstr(sel: string, state: number): string {
    const st = state > 0 ? state : 1;
    const { atoms, bonds } = selAtomsBonds(sel, st);
    const n3 = (n: number): string => String(n).slice(0, 3).padStart(3);
    const f10 = (v: number): string => v.toFixed(4).padStart(10);
    const lines = ['', '  tenmol', '', `${n3(atoms.length)}${n3(bonds.length)}  0  0  0  0  0  0  0  0999 V2000`];
    for (const { atom, x, y, z } of atoms) {
      lines.push(`${f10(x)}${f10(y)}${f10(z)} ${padR(atom.elem, 3)} 0  0  0  0  0  0  0  0  0  0  0  0`);
    }
    for (const [i, j, order] of bonds) lines.push(`${n3(i + 1)}${n3(j + 1)}${n3(order)}  0  0  0  0`);
    lines.push('M  END');
    return lines.join('\n') + '\n';
  }

  /** A single-record SDF: the molfile plus the `$$$$` terminator. */
  function getSdfstr(sel: string, state: number): string {
    return getMolstr(sel, state) + '$$$$\n';
  }

  /** A Tripos MOL2 block (round-trips through read_mol2str). */
  function getMol2str(sel: string, state: number): string {
    const st = state > 0 ? state : 1;
    const { atoms, bonds } = selAtomsBonds(sel, st);
    const f = (v: number): string => v.toFixed(4);
    const lines = [
      '@<TRIPOS>MOLECULE', 'tenmol',
      ` ${atoms.length} ${bonds.length} 0 0 0`, 'SMALL', 'USER_CHARGES', '',
      '@<TRIPOS>ATOM',
    ];
    atoms.forEach(({ atom, x, y, z }, i) => {
      const nm = (atom.name || atom.elem).replace(/\s+/g, '') || atom.elem;
      lines.push(`${i + 1} ${nm} ${f(x)} ${f(y)} ${f(z)} ${atom.elem} 1 UNL1 ${(atom.partialCharge ?? 0).toFixed(4)}`);
    });
    lines.push('@<TRIPOS>BOND');
    bonds.forEach(([i, j, order], k) => lines.push(`${k + 1} ${i + 1} ${j + 1} ${order}`));
    return lines.join('\n') + '\n';
  }

  /** The shared body of `get_str` / `get_bytes`. */
  function getStr(format: string, sel: string, state: number): string {
    switch (format) {
      case 'cif':
      case 'mmcif':
        return getCifstr(sel, state);
      case 'xyz':
        return getXyzstr(sel, state);
      case 'pdb':
        return getPdbstr(sel, state);
      case 'fasta':
        return getFastastr(sel);
      case 'mol':
        return getMolstr(sel, state);
      case 'sdf':
        return getSdfstr(sel, state);
      case 'mol2':
        return getMol2str(sel, state);
      default:
        throw new Error(`get_str: unsupported format '${format}'`);
    }
  }

  /* ------------------------------- session --------------------------- */

  interface SessionObject {
    name: string;
    atoms: AtomInfo[];
    states: number[][];
    bonds: Array<[number, number]>;
  }
  interface Session {
    kind: 'tenmol-session';
    version: 1;
    /** PyMOL-shaped per-object spec list: [name, spec_type, enabled, ?, type_code].
     *  type_code 1 == molecule (exporting.py `_session_convert_legacy`). */
    names: Array<unknown[]>;
    objects: SessionObject[];
    settings: Record<string, number | string>;
    view: number[];
  }

  function getSession(): Session {
    const objects: SessionObject[] = [];
    for (const mol of ex.moleculesInOrder()) {
      objects.push({
        name: mol.name,
        atoms: mol.atoms.map((a) => ({ ...a })),
        states: mol.states.map((s) => Array.from(s)),
        bonds: mol.bonds.map((b) => [b[0], b[1]] as [number, number]),
      });
    }
    const settings: Record<string, number | string> = {};
    for (const k of SESSION_SETTING_KEYS) {
      const v = ex.getSetting(k);
      if (v !== undefined) settings[k] = v;
    }
    // PyMOL's session['names'] is a list of per-object spec lists; index 4 is the
    // object type code (1 = molecule). We emit one spec per molecule object.
    const names: Array<unknown[]> = ex
      .moleculesInOrder()
      .map((mol) => [mol.name, 0, mol.enabled ? 1 : 0, 0, 1]);
    return {
      kind: 'tenmol-session',
      version: 1,
      names,
      objects,
      settings,
      view: ex.view.get(),
    };
  }

  function setSession(raw: unknown): number {
    const session: Partial<Session> =
      typeof raw === 'string' ? (JSON.parse(raw) as Partial<Session>) : ((raw as Partial<Session>) ?? {});
    ex.delete('all');
    const objs = Array.isArray(session.objects) ? session.objects : [];
    for (const o of objs) {
      if (!o || typeof o.name !== 'string') continue;
      const mol = new ObjectMolecule(o.name);
      const atoms = Array.isArray(o.atoms) ? o.atoms : [];
      for (const a of atoms) {
        mol.atoms.push({
          id: a.id ?? mol.atoms.length + 1,
          name: a.name ?? '',
          resn: a.resn ?? '',
          resi: a.resi ?? '',
          resv: a.resv ?? 0,
          chain: a.chain ?? '',
          segi: a.segi ?? '',
          alt: a.alt ?? '',
          elem: a.elem ?? 'C',
          hetatm: Boolean(a.hetatm),
          b: a.b ?? 0,
          q: a.q ?? 0,
          color: a.color ?? 0,
          ss: a.ss ?? '',
          visRep: a.visRep ?? defaultVisRep(),
        });
      }
      const states = Array.isArray(o.states) ? o.states : [];
      for (const s of states) mol.states.push(Float32Array.from(s ?? []));
      if (mol.states.length === 0 && mol.natom > 0) mol.states.push(new Float32Array(mol.natom * 3));
      const bonds = Array.isArray(o.bonds) ? o.bonds : [];
      for (const b of bonds) {
        if (Array.isArray(b) && b.length >= 2) mol.bonds.push([Number(b[0]), Number(b[1])]);
      }
      ex.addMolecule(mol);
    }
    if (session.settings && typeof session.settings === 'object') {
      for (const [k, v] of Object.entries(session.settings)) {
        if (typeof v === 'number' || typeof v === 'string') ex.set(k, v);
      }
    }
    if (Array.isArray(session.view) && session.view.length === 18) {
      ex.view.set(session.view.map((n) => Number(n)));
    }
    ctx.publish();
    return objs.length;
  }

  /* ------------------------------- commands -------------------------- */

  ctx.command('get_cifstr', (args, kwargs) => {
    const sel = ctx.str(pick(args, kwargs, 0, 'selection'), 'all') || 'all';
    const state = asInt(pick(args, kwargs, 1, 'state'), 0);
    return getCifstr(sel, state);
  });

  ctx.command('get_str', (args, kwargs) => {
    const format = ctx.str(pick(args, kwargs, 0, 'format'), '').toLowerCase();
    const sel = ctx.str(pick(args, kwargs, 1, 'selection'), 'all') || 'all';
    const state = asInt(pick(args, kwargs, 2, 'state'), 0);
    return getStr(format, sel, state);
  });

  ctx.command('get_bytes', (args, kwargs) => {
    const format = ctx.str(pick(args, kwargs, 0, 'format'), '').toLowerCase();
    const sel = ctx.str(pick(args, kwargs, 1, 'selection'), 'all') || 'all';
    const state = asInt(pick(args, kwargs, 2, 'state'), 0);
    const text = getStr(format, sel, state);
    return Array.from(new TextEncoder().encode(text));
  });

  ctx.command('dump', (args, kwargs) => {
    // dump(filename, object, state, quiet) — the object's atom coordinates.
    const objName = ctx.str(pick(args, kwargs, 1, 'object'), '');
    const state = asInt(pick(args, kwargs, 2, 'state'), 0);
    const st = state > 0 ? state : 1;
    const mol = ex.molecule(objName) ?? ex.moleculesInOrder()[0];
    if (!mol) return '';
    const rows: string[] = [];
    for (let i = 0; i < mol.natom; i++) {
      const [x, y, z] = mol.coord(i, st);
      rows.push(`${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`);
    }
    return rows.join('\n') + (rows.length ? '\n' : '');
  });

  /** Concatenate a PDB block per object matched by `sel`. */
  function multiPdb(sel: string, state: number): string {
    const st = state > 0 ? state : 1;
    const blocks: string[] = [];
    for (const grp of grouped(sel)) {
      // One HEADER per object so a multi-entry PDB loads each as a separate
      // object (exporting.py multisave).
      const lines: string[] = [`HEADER    ${grp.mol.name}`];
      let serial = 1;
      let preTer: AtomInfo | null = null;
      const writeTer = (ai: AtomInfo | null): void => {
        const a = ai && isPolymer(ai) ? ai : null;
        if (preTer && !(a && a.chain === preTer.chain)) lines.push('TER   ');
        preTer = a;
      };
      for (const { index, atom } of grp.atoms) {
        writeTer(atom);
        lines.push(pdbAtomLine(atom, grp.mol.coord(index, st), serial));
        serial++;
      }
      writeTer(null);
      lines.push('END');
      blocks.push(lines.join('\n') + '\n');
    }
    return blocks.join('');
  }

  ctx.command('multisave', (args, kwargs) => {
    // multisave(filename, pattern='all', state=-1, append=0, format='', quiet=1)
    // — writes a multi-entry file to disk (one HEADER/CRYST block per object) so
    // reloading splits it back into separate objects (exporting.py:604-657). The
    // pattern is the atom selection; the write itself is the observable side
    // effect (PyMOL returns DEFAULT_SUCCESS, not the string).
    const filename = ctx.str(pick(args, kwargs, 0, 'filename'), '');
    const sel = ctx.str(pick(args, kwargs, 1, 'pattern'), 'all') || 'all';
    const state = asInt(pick(args, kwargs, 2, 'state'), 0);
    const append = asInt(pick(args, kwargs, 3, 'append'), 0) !== 0;
    const fmtArg = ctx.str(pick(args, kwargs, 4, 'format'), '').toLowerCase();

    // Zipped output is rejected; .pmo is explicitly unsupported (exporting.py:635-642).
    if (/\.(gz|bz2)$/i.test(filename)) {
      throw new Error(`${filename.replace(/.*\./, '')} not supported with multisave`);
    }
    const format = fmtArg || formatFromFilename(filename);
    if (format === 'pmo') throw new Error('pmo format not supported anymore');
    if (format !== 'pdb' && format !== 'cif') {
      throw new Error(`${format} format not supported with multisave`);
    }

    const contents = multiPdb(sel, state);
    writeDiskFile(filename, contents, append);
    return null;
  });

  /**
   * Expand a placeholder filename template into the concrete
   * `(filename, selection, state)` triples `multifilesave` would write, one per
   * object/state. Port of the generator in exporting.py:735-781 (same
   * `{name}`/`{state}`/`{title}`/`{num}`/`{}` grammar).
   */
  function multiFilenameGen(
    filename: string,
    selection: string,
    state: number,
  ): Array<[string, string, number]> {
    const segs = parsePyFormat(filename);
    const fmtKeys = segs.map((s) => s.field).filter((f): f is string => f !== null);
    const nindexed = fmtKeys.filter((f) => f === '').length;
    const multiobject = nindexed > 0 || fmtKeys.includes('name') || fmtKeys.includes('num');
    const multistate = nindexed > 1 || fmtKeys.includes('state') || fmtKeys.includes('title');
    if (!(multiobject || multistate)) {
      throw new Error('need one or more of {name}, {num}, {state}, {title}');
    }

    const odata: Array<[string, string, number]> = [];
    for (const oname of ex.getObjectList(selection)) {
      const osele = `(${selection}) & ?${oname}`;
      let first = state;
      let last = state;
      if (multistate) {
        if (state < 0) {
          first = last = asInt(ctx.call('get_object_state', [oname]), 1);
        }
        if (first === 0) {
          first = 1;
          last = asInt(ctx.call('count_states', ['%' + oname]), 1);
        }
      }
      for (let ostate = first; ostate <= last; ostate++) odata.push([oname, osele, ostate]);
    }

    // Zero-pad widths for {state} and {num} (exporting.py pads them by rewriting
    // the field spec before formatting).
    const swidth = odata.length ? String(Math.max(...odata.map((v) => v[2]))).length : 1;
    const nwidth = String(odata.length).length;

    const triples: Array<[string, string, number]> = [];
    odata.forEach(([oname, osele, ostate], idx) => {
      const num = idx + 1;
      const title = multistate ? ex.molecule(oname)?.titles[ostate - 1] ?? '' : '';
      const named: Record<string, string | number> = { name: oname, state: ostate, num, title };
      const positional: Array<string | number> = [oname, ostate];
      let auto = 0;
      let fname = '';
      for (const seg of segs) {
        fname += seg.literal;
        if (seg.field === null) continue;
        let value: string | number;
        if (seg.field === '') value = positional[auto++] ?? '';
        else if (/^\d+$/.test(seg.field)) value = positional[parseInt(seg.field, 10)] ?? '';
        else value = named[seg.field] ?? '';
        let spec = seg.spec;
        if (!spec && seg.field === 'state') spec = `0${swidth}`;
        if (!spec && seg.field === 'num') spec = `0${nwidth}`;
        fname += formatValue(value, spec);
      }
      triples.push([fname, osele, ostate]);
    });
    return triples;
  }

  ctx.command('multifilesave', (args, kwargs) => {
    // multifilesave(filename, selection='*', state=-1, format='', ...) — for a
    // selection spanning multiple objects/states, write one file per object/state
    // using the placeholder-templated filename (exporting.py:707-732). Each triple
    // is written via the same format string exporters that `save` uses.
    const filename = ctx.str(pick(args, kwargs, 0, 'filename'), '');
    const sel =
      ctx.str(pick(args, kwargs, 1, 'selection') ?? pick(args, kwargs, 1, 'pattern'), '*') || '*';
    const state = asInt(pick(args, kwargs, 2, 'state'), -1);
    const fmtArg = ctx.str(pick(args, kwargs, 3, 'format'), '').toLowerCase();
    for (const [fname, osele, ostate] of multiFilenameGen(filename, sel, state)) {
      const format = fmtArg || formatFromFilename(fname);
      writeDiskFile(fname, getStr(format, osele, ostate));
    }
    return null;
  });

  ctx.command('multifilenamegen', (args, kwargs) => {
    const filename = ctx.str(pick(args, kwargs, 0, 'filename'), '');
    const selection = ctx.str(pick(args, kwargs, 1, 'selection'), '');
    const state = asInt(pick(args, kwargs, 2, 'state'), -1);
    return multiFilenameGen(filename, selection, state) as unknown as Json;
  });

  ctx.command('save', (args, kwargs) => {
    // save(filename, selection='(all)', state=-1, format='', ...) — write the
    // executive to disk. PyMOL routes `.pse`/`.psw` to the pickled session
    // (`_cmd.get_session`); every other extension goes through the format string
    // exporters (exporting.py `save`). The write is the observable side effect,
    // and PyMOL returns DEFAULT_SUCCESS rather than the content.
    const filename = ctx.str(pick(args, kwargs, 0, 'filename'), '');
    const sel = ctx.str(pick(args, kwargs, 1, 'selection'), 'all') || 'all';
    const state = asInt(pick(args, kwargs, 2, 'state'), -1);
    const fmtArg = ctx.str(pick(args, kwargs, 3, 'format'), '').toLowerCase();
    const ext = (/\.([a-z0-9]+)\s*$/i.exec(filename.trim())?.[1] ?? '').toLowerCase();
    const format = fmtArg || ext;

    // Session formats capture the whole executive (objects + settings + camera),
    // not a selection. Our on-disk shape is the JSON snapshot `get_session`
    // produces — self-consistent for a save/load roundtrip within the port.
    if (format === 'pse' || format === 'psw') {
      writeDiskFile(filename, JSON.stringify(getSession()));
      return null;
    }

    // Multi-object structure files (multiple HEADER/data blocks) — reuse the
    // multisave writer so a reload splits them back into separate objects.
    if ((format === 'pdb' || format === 'ent') && ex.getObjectList(sel).length > 1) {
      writeDiskFile(filename, multiPdb(sel, state));
      return null;
    }

    const outFmt = format === 'ent' ? 'pdb' : format;
    writeDiskFile(filename, getStr(outFmt, sel, state));
    return null;
  });

  ctx.command('get_session', () => getSession() as unknown as Json);

  ctx.command('set_session', (args, kwargs) => {
    const raw = pick(args, kwargs, 0, 'session');
    return setSession(raw);
  });
}
