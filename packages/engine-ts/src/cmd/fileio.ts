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
import type { RegistrarCtx } from './registrar';

/* ------------------------------- helpers ------------------------------- */

/** Residues treated as solvent (mirrors the selector's `SOLVENT_RESN`). */
const SOLVENT_RESN = new Set(['HOH', 'WAT', 'H2O', 'TIP', 'SOL']);

/** PyMOL `cAtomFlag_polymer` heuristic: a standard (non-het, non-solvent) atom. */
function isPolymer(a: AtomInfo): boolean {
  return !a.hetatm && !SOLVENT_RESN.has(a.resn.toUpperCase());
}

/** 3-letter -> 1-letter map for the 20 standard amino acids. */
const RESN_TO_AA: Readonly<Record<string, string>> = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C',
  GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I',
  LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P',
  SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V',
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
    mol.bonds.push(a1 < a2 ? [a1, a2] : [a2, a1]);
  }
  return mol;
}

/* ------------------------------- registrar ---------------------------- */

export function registerFileio(ctx: RegistrarCtx): void {
  const ex = ctx.executive;

  /** Matched atoms grouped by object (object order), each group index-sorted. */
  function grouped(sel: string): Array<{ objName: string; mol: ObjectMolecule; atoms: Array<{ index: number; atom: AtomInfo }> }> {
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
      const seq = byKey.get(key)!.map((r) => RESN_TO_AA[r.toUpperCase()] ?? 'X').join('');
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

  ctx.command('get_str', (args, kwargs) => {
    const format = ctx.str(pick(args, kwargs, 0, 'format'), '').toLowerCase();
    const sel = ctx.str(pick(args, kwargs, 1, 'selection'), 'all') || 'all';
    const state = asInt(pick(args, kwargs, 2, 'state'), 0);
    if (format === 'pdb') return getPdbstr(sel, state);
    if (format === 'fasta') return getFastastr(sel);
    throw new Error(`get_str: unsupported format '${format}'`);
  });

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
}
