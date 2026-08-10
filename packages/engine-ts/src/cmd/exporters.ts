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
    '  '
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

  /** A CIF value token: empty fields become the CIF null `.`. */
  function cifValue(s: string): string {
    return s === '' ? '.' : s;
  }

  function getCifstr(sel: string, state: number): string {
    const st = state > 0 ? state : 1;
    const lines: string[] = [];
    lines.push('data_tenmol');
    lines.push('#');
    lines.push('loop_');
    lines.push('_atom_site.group_PDB');
    lines.push('_atom_site.id');
    lines.push('_atom_site.type_symbol');
    lines.push('_atom_site.label_atom_id');
    lines.push('_atom_site.label_comp_id');
    lines.push('_atom_site.label_asym_id');
    lines.push('_atom_site.label_seq_id');
    lines.push('_atom_site.Cartn_x');
    lines.push('_atom_site.Cartn_y');
    lines.push('_atom_site.Cartn_z');
    lines.push('_atom_site.occupancy');
    lines.push('_atom_site.B_iso_or_equiv');
    let id = 1;
    for (const grp of grouped(sel)) {
      for (const { index, atom } of grp.atoms) {
        const [x, y, z] = grp.mol.coord(index, st);
        lines.push(
          [
            atom.hetatm ? 'HETATM' : 'ATOM',
            String(id),
            cifValue(atom.elem),
            cifValue(atom.name),
            cifValue(atom.resn),
            cifValue(atom.chain),
            String(atom.resv),
            x.toFixed(3),
            y.toFixed(3),
            z.toFixed(3),
            atom.q.toFixed(2),
            atom.b.toFixed(2),
          ].join(' '),
        );
        id++;
      }
    }
    lines.push('#');
    return lines.join('\n') + '\n';
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
      const seq = (byKey.get(key) ?? []).map((r) => RESN_TO_AA[r.toUpperCase()] ?? 'X').join('');
      lines.push('>' + key);
      for (let i = 0; i < seq.length; i += 70) lines.push(seq.slice(i, i + 70));
    }
    if (lines.length === 0) return '';
    lines.push('');
    return lines.join('\n');
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
    names: string[];
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
    return {
      kind: 'tenmol-session',
      version: 1,
      names: ex.getNames('objects'),
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
      const lines: string[] = [];
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
    // multisave(filename, pattern='all', state=0, ...) — pattern is the selection.
    const sel = ctx.str(pick(args, kwargs, 1, 'pattern'), 'all') || 'all';
    const state = asInt(pick(args, kwargs, 2, 'state'), 0);
    return multiPdb(sel, state);
  });

  ctx.command('multifilesave', (args, kwargs) => {
    // multifilesave(filename, selection='all', state=0, ...).
    const sel =
      ctx.str(pick(args, kwargs, 1, 'selection') ?? pick(args, kwargs, 1, 'pattern'), 'all') || 'all';
    const state = asInt(pick(args, kwargs, 2, 'state'), 0);
    return multiPdb(sel, state);
  });

  ctx.command('get_session', () => getSession() as unknown as Json);

  ctx.command('set_session', (args, kwargs) => {
    const raw = pick(args, kwargs, 0, 'session');
    return setSession(raw);
  });
}
