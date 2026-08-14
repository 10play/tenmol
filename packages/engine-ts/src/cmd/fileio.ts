/**
 * The `fileio` command subsystem: text import/export of molecular data.
 *
 * Ports the string-producing exporters of PyMOL's `exporting.py` +
 * `layer3/MoleculeExporter.cpp` (`get_pdbstr`, `get_fastastr`, `get_str`) and
 * the string importers of `importing.py` (`read_molstr`, `read_sdfstr`), plus
 * `load_coords`. Column layout mirrors `CoordSetAtomToPDBStrVLA` /
 * `AtomInfoGetAlignedPDBAtomName` so `parsePdb(get_pdbstr(...))` round-trips.
 */

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
    '  '
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
    const lines: string[] = [];
    let serial = 1;
    let preTer: AtomInfo | null = null;
    const writeTer = (ai: AtomInfo | null): void => {
      const a = ai && isPolymer(ai) ? ai : null;
      if (preTer && !(a && a.chain === preTer.chain)) lines.push('TER   ');
      preTer = a;
    };
    for (const grp of grouped(sel)) {
      for (const { index, atom } of grp.atoms) {
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
  ctx.command('load', (args, kwargs) => {
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
    ex.addMolecule(parseByFormat(format, content, name));
    ctx.publish();
    return name;
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
