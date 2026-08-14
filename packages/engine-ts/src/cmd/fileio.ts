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

/** Insertion code = the trailing non-numeric part of a `resi` string. */
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
  let i = 0;
  while (i < name.length - 1 && name[i]! >= '0' && name[i]! <= '9') i++;
  const n = name.slice(i);
  const c0 = (n[0] ?? '').toUpperCase();
  const c1 = (n[1] ?? '').toUpperCase();
  const e0 = (elem[0] ?? '').toUpperCase();
  if (c0 !== e0) return 1000; // unconventional atom name — no assignment

  const greek: Record<string, number> = {
    B: 6, G: 7, D: 8, E: 9, Z: 10, H: 11, I: 12, J: 13, K: 14, L: 15, M: 16, N: 17,
  };
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
      // 'X' has no `break` in the C source: it falls through into the digit
      // branch, so `OXT` etc. are ultimately scored by digitBranch().
      if (c1 === 'X' || (c1 >= '0' && c1 <= '9')) return digitBranch();
      return 500;
    case 'P':
      return 20;
    case 'D':
    case 'H': {
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

  ctx.command('read_sdfstr', (args, kwargs) => {
    const sdfstr = ctx.str(pick(args, kwargs, 0, 'sdfstr'), '');
    const name = ex.uniqueName(ctx.str(pick(args, kwargs, 1, 'name'), 'mol') || 'mol');
    // A single-record SDF is a MOL block terminated by `M  END` / `$$$$`.
    ex.addMolecule(parseMolBlock(sdfstr, name));
    ctx.publish();
    return name;
  });

  /* ------------------------------ load / read_*str ------------------------ */

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
    const name = ex.uniqueName(objArg || 'obj');
    const mol = parseByFormat(format, content, name);
    // PyMOL's `discrete` flag (positional 5, default -1 = "auto"): when the
    // caller asks for discrete=1 the object records DiscreteFlag, observable
    // via count_discrete. Negative/absent leaves it non-discrete.
    if (Number(ctx.str(pick(args, kwargs, 5, 'discrete'), '-1')) > 0) mol.discrete = true;
    ex.addMolecule(mol);
    ctx.publish();
    return name;
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
}
