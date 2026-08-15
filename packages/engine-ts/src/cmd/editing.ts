/**
 * The `editing` command subsystem — structure-editing verbs.
 *
 * Ports the coordinate/topology-mutating half of PyMOL's `editing.py`:
 * `bond`, `unbond`, `remove`, `protect`/`deprotect`, `alter_state`,
 * `translate_atom`, `pseudoatom` and `set_dihedral`. Every verb mutates an
 * {@link ObjectMolecule} in place (atom table, per-state Float32 coordinates and
 * bond list) so `get_model`/`get_coords` observe the change, exactly as PyMOL's
 * editor does, and calls `ctx.publish()` afterwards.
 *
 * NOTE: like this port's `alter`/`iterate`, the `alter_state` expression is
 * **JavaScript** (x/y/z plus the atom fields in scope), not Python.
 */
import type { Json } from '@tenmol/protocol';
import type { AtomInfo } from '../model/atom';
import { defaultVisRep } from '../model/atom';
import { ObjectMolecule } from '../model/molecule';
import type { RegistrarCtx } from './registrar';

/* ------------------------------ arg helpers ------------------------------ */

/** Positional arg `i`, falling back to the named kwarg. */
function pick(args: unknown[], kwargs: Record<string, unknown>, i: number, name: string): unknown {
  const a = args[i];
  if (a !== undefined && a !== null && a !== '') return a;
  return kwargs[name];
}

/** Coerce to a finite number, or `dflt` when absent/unparseable. */
function num(v: unknown, dflt: number): number {
  if (v === undefined || v === null || v === '') return dflt;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : dflt;
}

/** Parse a `[x,y,z]` / `x,y,z` / array into a numeric triple. */
function parseTriple(v: unknown): [number, number, number] | null {
  if (Array.isArray(v)) {
    if (v.length !== 3) return null;
    return [Number(v[0]), Number(v[1]), Number(v[2])];
  }
  if (typeof v === 'string') {
    const nums = v
      .replace(/[[\]()]/g, '')
      .split(/[\s,]+/)
      .filter((s) => s !== '')
      .map(Number);
    if (nums.length === 3 && nums.every((n) => Number.isFinite(n))) {
      return [nums[0]!, nums[1]!, nums[2]!];
    }
  }
  return null;
}

/* ------------------------------ vec3 helpers ----------------------------- */

type Vec3 = [number, number, number];

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/**
 * Rotate `p` about the axis (unit `u`) through `pivot` by `deg` degrees
 * (right-hand rule), via Rodrigues' rotation formula.
 */
function rotateAbout(p: Vec3, pivot: Vec3, u: Vec3, deg: number): Vec3 {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const r = sub(p, pivot);
  const kc = cross(u, r);
  const kd = dot(u, r) * (1 - c);
  return [
    pivot[0] + r[0] * c + kc[0] * s + u[0] * kd,
    pivot[1] + r[1] * c + kc[1] * s + u[1] * kd,
    pivot[2] + r[2] * c + kc[2] * s + u[2] * kd,
  ];
}

/**
 * Signed dihedral (degrees) of p1-p2-p3-p4, using the SAME sign convention as
 * `cmd.get_dihedral` (PyMOL's `get_dihedral3f`, layer0/Vector.cpp). This matters
 * for `set_dihedral`: the target angle it is asked to reach is expressed in
 * get_dihedral's convention, so the current value must be measured the same way
 * or the result comes out negated. (The textbook IUPAC atan2 form has the
 * opposite sign to get_dihedral3f for this axis ordering.)
 */
function dihedral(p1: Vec3, p2: Vec3, p3: Vec3, p4: Vec3): number {
  const d21 = sub(p3, p2);
  const d01 = sub(p1, p2);
  const d32 = sub(p4, p3);
  const dd1 = cross(d21, d01);
  const dd3 = cross(d21, d32);
  const la = Math.hypot(dd1[0], dd1[1], dd1[2]);
  const lb = Math.hypot(dd3[0], dd3[1], dd3[2]);
  if (la < 1e-9 || lb < 1e-9) return 0;
  let c = dot(dd1, dd3) / (la * lb);
  c = Math.max(-1, Math.min(1, c));
  let result = Math.acos(c);
  const posD = cross(d21, dd1);
  if (dot(dd3, posD) < 0) result = -result;
  return (result * 180) / Math.PI;
}

/* --------------------------- protected flag ------------------------------ */

/** An atom carrying the editor's per-atom `protected` flag (PyMOL `flag 6`). */
type Protectable = AtomInfo & { protected?: boolean };

/* ------------------------------ flag command ----------------------------- */

/** An atom whose modeling-flags bitmask the `flag` command mutates. */
type Flaggable = AtomInfo & { flags?: number };

/** Reserved flag names → bit number (PyMOL `editing.py` `flag_dict`). */
const FLAG_DICT: Readonly<Record<string, number>> = {
  focus: 0, free: 1, restrain: 2, fix: 3, exclude: 4, study: 5,
  exfoliate: 24, ignore: 25, no_smooth: 26,
};

/** Flag actions → code (PyMOL `flag_action_dict`). */
const FLAG_ACTIONS: Readonly<Record<string, number>> = { reset: 0, set: 1, clear: 2 };

/**
 * Resolve a `flag` argument to a bit number: an integer literal, an exact flag
 * name, or a unique prefix of one (PyMOL's `Shortcut`). Returns undefined for an
 * unknown/ambiguous name.
 */
function resolveFlag(v: unknown): number | undefined {
  const s = String(v ?? '').trim();
  if (s === '') return undefined;
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    return n >= 0 && n < 32 ? n : undefined;
  }
  const key = s.toLowerCase();
  if (key in FLAG_DICT) return FLAG_DICT[key];
  const hits = Object.keys(FLAG_DICT).filter((k) => k.startsWith(key));
  return hits.length === 1 ? FLAG_DICT[hits[0]!] : undefined;
}

/* -------------------------- alter_state expr ----------------------------- */

/** Atom fields exposed as bare read-only variables in the `alter_state` body. */
const ATOM_FIELDS = [
  'name', 'resn', 'resi', 'resv', 'chain', 'segi', 'alt', 'elem',
  'b', 'q', 'color', 'ss', 'id',
] as const;

/**
 * Compile an `alter_state` expression into a function that, given the atom
 * fields plus x/y/z, evaluates the JS body and returns the (possibly reassigned)
 * `[x, y, z]`.
 */
function compileStateExpr(expr: string): (...a: unknown[]) => [number, number, number] {
  const params = [...ATOM_FIELDS, 'index', 'hetatm', 'model', 'x', 'y', 'z', 'stored'];
  const body = `${expr}\n;return [x, y, z];`;

  const fn = new Function(...params, body) as (...a: unknown[]) => [number, number, number];
  return fn;
}

/* -------------------------------- registrar ------------------------------ */

export function registerEditing(ctx: RegistrarCtx): void {
  const ex = ctx.executive;
  const sel = (v: unknown, dflt = 'all'): string => ctx.str(v, dflt) || dflt;

  /** Matched atoms grouped by object -> local indices (sorted, deduped). */
  const byObject = (selection: string): Map<string, number[]> => {
    const m = new Map<string, number[]>();
    for (const ua of ex.atomsMatching(selection)) {
      let arr = m.get(ua.objName);
      if (!arr) m.set(ua.objName, (arr = []));
      arr.push(ua.index);
    }
    for (const arr of m.values()) arr.sort((a, b) => a - b);
    return m;
  };

  /** Does an (undirected) bond i-j already exist? */
  const hasBond = (mol: ObjectMolecule, i: number, j: number): boolean =>
    mol.bonds.some(([a, b]) => (a === i && b === j) || (a === j && b === i));

  /* --------------------------------- bond -------------------------------- */
  // bond(atom1='(pk1)', atom2='(pk2)', order=1) — add bonds between the atoms of
  // two selections within the SAME object (bonds are intra-object). Returns the
  // number of bonds actually added (existing bonds are not duplicated).
  ctx.command('bond', (args, kwargs): Json => {
    const g1 = byObject(sel(pick(args, kwargs, 0, 'atom1'), 'pk1'));
    const g2 = byObject(sel(pick(args, kwargs, 1, 'atom2'), 'pk2'));
    let added = 0;
    for (const [objName, ai] of g1) {
      const bj = g2.get(objName);
      if (!bj) continue;
      const mol = ex.molecule(objName);
      if (!mol) continue;
      for (const i of ai) {
        for (const j of bj) {
          if (i === j || hasBond(mol, i, j)) continue;
          mol.bonds.push(i < j ? [i, j] : [j, i]);
          added++;
        }
      }
    }
    if (added > 0) ctx.publish();
    return added;
  });

  /* -------------------------------- unbond ------------------------------- */
  // unbond(atom1='(pk1)', atom2='(pk2)') — remove every bond that joins an atom
  // of selection 1 to an atom of selection 2 in the same object. Returns removed.
  ctx.command('unbond', (args, kwargs): Json => {
    const g1 = byObject(sel(pick(args, kwargs, 0, 'atom1'), 'pk1'));
    const g2 = byObject(sel(pick(args, kwargs, 1, 'atom2'), 'pk2'));
    let removed = 0;
    for (const [objName, ai] of g1) {
      const bj = g2.get(objName);
      if (!bj) continue;
      const mol = ex.molecule(objName);
      if (!mol) continue;
      const s1 = new Set(ai);
      const s2 = new Set(bj);
      const kept: Array<[number, number, number?]> = [];
      for (const bond of mol.bonds) {
        const [a, b] = bond;
        const match = (s1.has(a) && s2.has(b)) || (s1.has(b) && s2.has(a));
        if (match) removed++;
        else kept.push(bond);
      }
      if (removed > 0) {
        mol.bonds.length = 0;
        mol.bonds.push(...kept);
      }
    }
    if (removed > 0) ctx.publish();
    return removed;
  });

  /* -------------------------------- remove ------------------------------- */
  // remove(selection) — delete the matched atoms: drop their rows and per-state
  // coordinates, drop any bond touching them, and REINDEX the surviving bonds.
  // Returns the number of atoms removed.
  ctx.command('remove', (args, kwargs): Json => {
    const groups = byObject(sel(pick(args, kwargs, 0, 'selection')));
    let removed = 0;
    for (const [objName, idxs] of groups) {
      const mol = ex.molecule(objName);
      if (!mol || idxs.length === 0) continue;
      const drop = new Set(idxs);
      const n = mol.natom;

      // old index -> new index (surviving atoms keep their relative order).
      const remap = new Int32Array(n).fill(-1);
      let next = 0;
      for (let i = 0; i < n; i++) if (!drop.has(i)) remap[i] = next++;

      // Compact the atom table in place.
      const survivors = mol.atoms.filter((_, i) => !drop.has(i));
      mol.atoms.length = 0;
      mol.atoms.push(...survivors);

      // Compact every state's Float32 coordinate set.
      for (let s = 0; s < mol.states.length; s++) {
        const old = mol.states[s]!;
        const out = new Float32Array(next * 3);
        for (let i = 0; i < n; i++) {
          const ni = remap[i]!;
          if (ni < 0) continue;
          out[ni * 3] = old[i * 3]!;
          out[ni * 3 + 1] = old[i * 3 + 1]!;
          out[ni * 3 + 2] = old[i * 3 + 2]!;
        }
        mol.states[s] = out;
      }

      // Drop bonds touching a removed atom; reindex the rest.
      const bonds = mol.bonds
        .filter(([a, b]) => !drop.has(a) && !drop.has(b))
        .map(([a, b]) => [remap[a]!, remap[b]!] as [number, number]);
      mol.bonds.length = 0;
      mol.bonds.push(...bonds);

      removed += idxs.length;
    }
    if (removed > 0) ctx.publish();
    return removed;
  });

  /* ------------------------------- edit ---------------------------------- */
  // edit(selection1, selection2=None, ...) — pick atom(s)/a bond for editing by
  // defining the `pk1` (and, with a second selection, `pk2`) named selections
  // that the remove_picked/torsion family consume (editing.py:1080).
  //
  // When two bonded atoms in the same object are picked, PyMOL's editor enters
  // "bond mode" and subdivides the molecule into the drag helper selections
  // `pkbond`, `_pkbase1`/`_pkfrag1`, `_pkbase2`/`_pkfrag2` and `pkmol`
  // (Editor.cpp EditorActivate -> Selector.cpp SelectorSubdivide). `unpick`
  // clears the `pk*` selections but leaves the `_pk*` fragment selections.

  /** Reachable set from `start` over bonds, never crossing into `block`. */
  const walkFragment = (mol: ObjectMolecule, start: number, block: number): Set<number> => {
    const adj: number[][] = Array.from({ length: mol.natom }, () => []);
    for (const [a, b] of mol.bonds) {
      adj[a]!.push(b);
      adj[b]!.push(a);
    }
    const seen = new Set<number>([start]);
    const stack = [start];
    while (stack.length > 0) {
      const x = stack.pop()!;
      for (const y of adj[x] ?? []) {
        if (y === block || seen.has(y)) continue;
        seen.add(y);
        stack.push(y);
      }
    }
    return seen;
  };

  /** Delete the editor's `pk*`-prefixed helper selections (not the `_pk*` ones). */
  const clearPickSelections = (): void => {
    for (const n of ex.selectionNames()) if (n.startsWith('pk')) ex.delete(n);
  };
  /** Delete every editor selection, `pk*` and `_pk*` alike. */
  const clearEditorSelections = (): void => {
    for (const n of ex.selectionNames()) {
      if (n.startsWith('pk') || n.startsWith('_pk')) ex.delete(n);
    }
  };

  ctx.command('edit', (args, kwargs): Json => {
    // Rebuild from scratch so re-editing yields the selections in creation order.
    clearEditorSelections();
    const s1 = sel(pick(args, kwargs, 0, 'selection1'));
    ex.select('pk1', s1);
    const s2raw = pick(args, kwargs, 1, 'selection2');
    const s2 = s2raw == null ? '' : ctx.str(s2raw, '');
    if (s2 && s2.toLowerCase() !== 'none') ex.select('pk2', s2);
    // Optional third/fourth picks (cEditorSele3/4): `invert` holds pk2 and pk3
    // immobile, so `edit pk1, pk2, pk3` must define pk3 as its own atom pick
    // (these are NOT the bond-mode fragment selections built below).
    const s3raw = pick(args, kwargs, 2, 'selection3');
    const s3 = s3raw == null ? '' : ctx.str(s3raw, '');
    if (s3 && s3.toLowerCase() !== 'none') ex.select('pk3', s3);
    const s4raw = pick(args, kwargs, 3, 'selection4');
    const s4 = s4raw == null ? '' : ctx.str(s4raw, '');
    if (s4 && s4.toLowerCase() !== 'none') ex.select('pk4', s4);

    // Bond mode: exactly one atom each, same object, and actually bonded.
    const p1 = ex.atomsMatching('pk1');
    const p2 = ex.hasSelection('pk2') ? ex.atomsMatching('pk2') : [];
    if (p1.length === 1 && p2.length === 1 && p1[0]!.objName === p2[0]!.objName) {
      const a1 = p1[0]!;
      const a2 = p2[0]!;
      const mol = ex.molecule(a1.objName);
      if (mol && hasBond(mol, a1.index, a2.index)) {
        const byIndex = new Map<number, (typeof p1)[number]>();
        for (const ua of ex.atomsMatching(mol.name)) byIndex.set(ua.index, ua);
        const pick2 = (frag: Set<number>) => [...frag].map((i) => byIndex.get(i)!).filter(Boolean);
        const frag1 = walkFragment(mol, a1.index, a2.index);
        const frag2 = walkFragment(mol, a2.index, a1.index);
        ex.selectAtomList('pkbond', [a1, a2]);
        ex.selectAtomList('_pkbase1', [a1]);
        ex.selectAtomList('_pkfrag1', pick2(frag1));
        ex.selectAtomList('_pkbase2', [a2]);
        ex.selectAtomList('_pkfrag2', pick2(frag2));
        ex.selectAtomList('pkmol', pick2(new Set([...frag1, ...frag2])));
      }
    }
    ctx.publish();
    return null;
  });

  /* ------------------------------- unpick -------------------------------- */
  // unpick() — clear the `pk*` picking selections (editing.py:991 -> Editor.cpp
  // EditorInactivate). The `_pkbase*`/`_pkfrag*` fragment selections persist.
  ctx.command('unpick', (): Json => {
    clearPickSelections();
    ctx.publish();
    return null;
  });

  /* -------------------------- get_editor_scheme -------------------------- */
  // get_editor_scheme() — the molecular editor's current interaction scheme as
  // an integer code (editing.py:1125 -> Editor.cpp EditorGetScheme):
  //   EDITOR_SCHEME_OBJ  = 1  (no active pick)
  //   EDITOR_SCHEME_FRAG = 2  (editor active — an atom/bond is picked)
  //   EDITOR_SCHEME_DRAG = 3  (mid-drag; no headless analogue in this port)
  // The editor is "active" (FRAG) exactly when a non-empty `pk1` pick exists, as
  // `edit`/`unpick` create/clear it (Editor.cpp EditorActive == I->Active).
  ctx.command('get_editor_scheme', (): Json => {
    const active = ex.hasSelection('pk1') && ex.atomsMatching('pk1').length > 0;
    return active ? 2 : 1;
  });

  /* ------------------------------ uniquify ------------------------------- */
  // uniquify(identifier, selection, reference='', ...) — make the identifier
  // (chain/segi/…) of `selection` unique w.r.t. `reference` (default the
  // complement), reassigning colliding values to the next free code (editing.py).
  const UNIQ_BASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz';
  ctx.command('uniquify', (args, kwargs): Json => {
    const identifier = ctx.str(pick(args, kwargs, 0, 'identifier'), 'segi');
    const selection = sel(pick(args, kwargs, 1, 'selection'));
    const refArg = ctx.str(pick(args, kwargs, 2, 'reference'), '');
    const reference = refArg || `!(${selection})`;
    const field = identifier as 'chain' | 'segi' | 'resi' | 'name';
    const used = new Set<string>();
    for (const ua of ex.atomsMatching(reference)) used.add(String(ua.atom[field] ?? ''));
    const firstFree = (): string => {
      for (const ch of UNIQ_BASE) if (!used.has(ch)) return ch;
      return '';
    };
    const groups = new Map<string, Array<Record<string, unknown>>>();
    for (const m of ex.atomsMatching(selection)) {
      const v = String(m.atom[field] ?? '');
      let g = groups.get(v);
      if (!g) groups.set(v, (g = []));
      g.push(m.atom as unknown as Record<string, unknown>);
    }
    let changed = 0;
    for (const [v, atoms] of groups) {
      if (!used.has(v)) continue; // already unique
      const code = firstFree();
      if (code === '') continue;
      used.add(code);
      for (const a of atoms) {
        a[field] = code;
        changed++;
      }
    }
    if (changed > 0) ctx.publish();
    return changed;
  });

  /* ------------------------------- torsion ------------------------------- */
  // torsion(angle) — rotate the fragment on the pk1 side of the currently picked
  // bond (pk1–pk2) about that bond axis by `angle` degrees (editing.py:1135).
  //
  // Matches PyMOL's `EditorTorsion` (Editor.cpp:691): the rotated fragment is
  // `_pkfrag1`, i.e. the atoms on the FIRST picked atom's (pk1) side of the bond
  // ("The rotated fragment will correspond to the first atom specified when
  // picking the bond"). The rotation axis is normalize(V0 - V1) (pointing from
  // pk2 toward pk1) and the pivot is pk1's coordinate V0.
  ctx.command('torsion', (args, kwargs): Json => {
    const angle = (Number(pick(args, kwargs, 0, 'angle') ?? 0) || 0) * (Math.PI / 180);
    const p1u = ex.atomsMatching('pk1');
    const p2u = ex.atomsMatching('pk2');
    if (p1u.length === 0 || p2u.length === 0) return null;
    const a1 = p1u[0]!;
    const a2 = p2u[0]!;
    if (a1.objName !== a2.objName) return null;
    const mol = ex.molecule(a1.objName);
    if (!mol) return null;
    const i1 = a1.index;
    const i2 = a2.index;

    // Adjacency, then the pk1-side fragment: reachable from i1 without crossing
    // the i1–i2 bond or ever entering i2.
    const adj: number[][] = Array.from({ length: mol.natom }, () => []);
    for (const [a, b] of mol.bonds) {
      adj[a]!.push(b);
      adj[b]!.push(a);
    }
    const frag = new Set<number>([i1]);
    const stack = [i1];
    while (stack.length > 0) {
      const x = stack.pop()!;
      for (const y of adj[x] ?? []) {
        if (y === i2) continue; // never cross onto the pk2 side
        if (!frag.has(y)) {
          frag.add(y);
          stack.push(y);
        }
      }
    }
    frag.delete(i1); // on the rotation axis — unaffected

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (const set of mol.states) {
      if (!set) continue;
      // Pivot at pk1 (V0); axis points pk2 -> pk1 (normalize(V0 - V1)).
      const ox = set[i1 * 3]!, oy = set[i1 * 3 + 1]!, oz = set[i1 * 3 + 2]!;
      let ux = ox - set[i2 * 3]!, uy = oy - set[i2 * 3 + 1]!, uz = oz - set[i2 * 3 + 2]!;
      const len = Math.hypot(ux, uy, uz) || 1;
      ux /= len; uy /= len; uz /= len;
      for (const k of frag) {
        const px = set[k * 3]! - ox, py = set[k * 3 + 1]! - oy, pz = set[k * 3 + 2]! - oz;
        // Rodrigues rotation of (p-o) about unit axis u by `angle`.
        const dotp = ux * px + uy * py + uz * pz;
        const cx = uy * pz - uz * py, cy = uz * px - ux * pz, cz = ux * py - uy * px;
        set[k * 3] = ox + px * cos + cx * sin + ux * dotp * (1 - cos);
        set[k * 3 + 1] = oy + py * cos + cy * sin + uy * dotp * (1 - cos);
        set[k * 3 + 2] = oz + pz * cos + cz * sin + uz * dotp * (1 - cos);
      }
    }
    ctx.publish();
    return null;
  });

  /* ----------------------------- group / ungroup ------------------------- */
  // group(name, members='', action='auto') — create/update a group object
  // (creating.py). The group is registered as a first-class gadget so get_names
  // lists it and get_type reports 'object:group', and its membership is tracked
  // on the executive so the group name used as a selection spans all its
  // members' atoms (creating.py NOTES; matched by the selector's group expansion).
  ctx.command('group', (args, kwargs): Json => {
    let name = ctx.str(pick(args, kwargs, 0, 'name'), '');
    const members = ctx.str(pick(args, kwargs, 1, 'members'), '').trim();
    let action = ctx.str(pick(args, kwargs, 2, 'action'), 'auto') || 'auto';
    if (name === '') return 0;
    if (name === 'all') name = '*'; // creating.py remaps the reserved name
    const memberNames = members ? members.split(/\s+/).filter((s) => s.length > 0) : [];
    // auto: add when members are given, else toggle an existing group, else add.
    // 'toggle' only affects panel expansion (no observable atom state), so it is
    // a no-op here beyond ensuring the group exists.
    if (action === 'auto') {
      action = memberNames.length > 0 || !(ex.gadget(name)?.kind === 'object:group') ? 'add' : 'toggle';
    } else if (action === 'ungroup') {
      // Deprecated alias — the `ungroup` command is preferred (creating.py).
      action = 'remove';
    }
    switch (action) {
      case 'add': {
        ex.registerGadget(name, 'object:group');
        const set = ex.ensureGroup(name);
        for (const m of memberNames) set.add(m);
        break;
      }
      case 'remove': {
        const set = ex.groupDirectMembers(name);
        if (set) for (const m of memberNames) set.delete(m);
        break;
      }
      case 'empty': {
        ex.groupDirectMembers(name)?.clear();
        break;
      }
      case 'purge': {
        // Remove all members and delete the member objects.
        const set = ex.groupDirectMembers(name);
        if (set) {
          for (const m of [...set]) ex.delete(m);
          set.clear();
        }
        break;
      }
      case 'excise': {
        // Delete the member objects and the group itself.
        const set = ex.groupDirectMembers(name);
        if (set) for (const m of [...set]) ex.delete(m);
        ex.delete(name);
        break;
      }
      default:
        // open / close / toggle / raise — panel-display actions with no atom
        // state; ensure the group exists so it is observable.
        ex.registerGadget(name, 'object:group');
        ex.ensureGroup(name);
        break;
    }
    ctx.publish();
    return name;
  });
  ctx.command('ungroup', (args, kwargs): Json => {
    // ungroup(members) — return the named object(s) to the top level, i.e. drop
    // them from whichever group contains them (creating.py). Passing a group
    // name empties+removes that group.
    const members = ctx.str(pick(args, kwargs, 0, 'members'), '').trim();
    if (members === '') return null;
    for (const m of members.split(/\s+/).filter((s) => s.length > 0)) {
      if (ex.gadget(m)?.kind === 'object:group') {
        ex.delete(m); // dropping the group container also clears its membership
      } else {
        // Remove this object from any group that contains it.
        for (const g of ex.getNames('objects')) ex.groupDirectMembers(g)?.delete(m);
      }
    }
    ctx.publish();
    return null;
  });

  /* ------------------------------ set_name ------------------------------- */
  // set_name(old, new) — rename an object or measurement (editing.py). Returns 1
  // on success, 0 if the old name is unknown or the new name is taken.
  ctx.command('set_name', (args, kwargs): Json => {
    const oldName = ctx.str(pick(args, kwargs, 0, 'old_name'), '');
    const newName = ctx.str(pick(args, kwargs, 1, 'new_name'), '');
    const ok = oldName !== '' && newName !== '' && ex.rename(oldName, newName);
    if (ok) ctx.publish();
    return ok ? 1 : 0;
  });

  /* --------------------------- remove_picked ----------------------------- */
  // remove_picked(hydrogens=1, ...) — delete the atom currently picked for
  // editing, i.e. everything in `pk1` (editing.py:839). Reuses `remove`.
  ctx.command('remove_picked', (): Json => {
    if (!ex.hasSelection('pk1')) return 0;
    const n = ctx.call('remove', ['pk1']);
    return typeof n === 'number' ? n : 0;
  });

  /* --------------------------- protect / deprotect ----------------------- */
  // protect(selection='(all)') / deprotect(selection='(all)') — set/clear the
  // per-atom protected flag (movers like sculpt honour it). Returns the count.
  const setProtected = (selection: string, value: boolean): number => {
    const matched = ex.atomsMatching(selection);
    for (const ua of matched) (ua.atom as Protectable).protected = value;
    return matched.length;
  };
  ctx.command('protect', (args, kwargs): Json =>
    setProtected(sel(pick(args, kwargs, 0, 'selection')), true),
  );
  ctx.command('deprotect', (args, kwargs): Json =>
    setProtected(sel(pick(args, kwargs, 0, 'selection')), false),
  );

  /* -------------------------------- flag --------------------------------- */
  // flag(flag, selection, action='reset', quiet=1) — set/clear a numbered atom
  // flag over a selection (editing.py `flag`). `reset` (default) sets the flag
  // inside the selection and clears it everywhere else; `set`/`clear` leave
  // non-selected atoms untouched. The `flag N` selector reads the resulting
  // bitmask. Returns the number of atoms whose flag bit changed.
  ctx.command('flag', (args, kwargs): Json => {
    const flagNum = resolveFlag(pick(args, kwargs, 0, 'flag'));
    if (flagNum === undefined) return 0;
    const selection = sel(pick(args, kwargs, 1, 'selection'));
    const action = FLAG_ACTIONS[ctx.str(pick(args, kwargs, 2, 'action'), 'reset').toLowerCase()] ?? 0;
    const bit = 1 << flagNum;

    // Which (object, local-index) pairs the selection covers.
    const inSel = new Set<string>();
    for (const ua of ex.atomsMatching(selection)) inSel.add(`${ua.objName} ${ua.index}`);

    let changed = 0;
    for (const mol of ex.moleculesInOrder()) {
      for (let i = 0; i < mol.atoms.length; i++) {
        const a = mol.atoms[i] as Flaggable;
        const cur = a.flags ?? 0;
        const hit = inSel.has(`${mol.name} ${i}`);
        let next = cur;
        if (action === 0) next = hit ? cur | bit : cur & ~bit; // reset
        else if (action === 1) { if (hit) next = cur | bit; }   // set
        else if (hit) next = cur & ~bit;                        // clear
        if (next !== cur) {
          a.flags = next;
          changed++;
        }
      }
    }
    if (changed > 0) ctx.publish();
    return changed;
  });

  /* ------------------------------ alter_state ---------------------------- */
  // alter_state(state, selection, expression, ...) — run a JS expression per
  // atom with x/y/z (and the atom fields) in scope and write x/y/z back into the
  // given state's coordinates. state<=0 applies to every state. Returns count.
  ctx.command('alter_state', (args, kwargs): Json => {
    const state = num(pick(args, kwargs, 0, 'state'), 1);
    const selection = sel(pick(args, kwargs, 1, 'selection'));
    const expr = ctx.str(pick(args, kwargs, 2, 'expression'));
    const stored =
      (kwargs.space as { stored?: unknown } | undefined)?.stored ?? kwargs.stored ?? {};
    const fn = compileStateExpr(expr);
    let count = 0;
    for (const ua of ex.atomsMatching(selection)) {
      const mol = ex.molecule(ua.objName);
      if (!mol) continue;
      const a = ua.atom;
      const states = state > 0 ? [state - 1] : mol.states.map((_, k) => k);
      for (const s of states) {
        const set = mol.states[s];
        if (!set) continue;
        const o = ua.index * 3;
        const fields: unknown[] = ATOM_FIELDS.map((f) => a[f]);
        fields.push(ua.index + 1, a.hetatm, ua.objName, set[o], set[o + 1], set[o + 2], stored);
        const [x, y, z] = fn(...fields);
        set[o] = Number(x);
        set[o + 1] = Number(y);
        set[o + 2] = Number(z);
      }
      count++;
    }
    if (count > 0) ctx.publish();
    return count;
  });

  /* ----------------------------- translate_atom -------------------------- */
  // translate_atom(selection, v0, v1, v2, state=0, mode=0) — move the matched
  // atoms with (v0,v1,v2). Mirrors PyMOL's CoordSetMoveAtom: mode=0 (default)
  // SETS the coordinate to (v0,v1,v2) absolutely (copy3f); any non-zero mode
  // ADDS the vector (add3f) — the relative form the interactive drag uses. As
  // in PyMOL, the Python layer passes state-1 to the C core, so state=0 (the
  // default) targets the first state, not every state. Returns the count.
  ctx.command('translate_atom', (args, kwargs): Json => {
    const selection = sel(pick(args, kwargs, 0, 'selection'));
    const vec: Vec3 = [
      num(pick(args, kwargs, 1, 'v0'), 0),
      num(pick(args, kwargs, 2, 'v1'), 0),
      num(pick(args, kwargs, 3, 'v2'), 0),
    ];
    const state = num(pick(args, kwargs, 4, 'state'), 0);
    const mode = num(pick(args, kwargs, 5, 'mode'), 0);
    let count = 0;
    for (const [objName, idxs] of byObject(selection)) {
      const mol = ex.molecule(objName);
      if (!mol) continue;
      const states = state > 0 ? [mol.states[state - 1]] : [mol.states[0]];
      for (const set of states) {
        if (!set) continue;
        for (const i of idxs) {
          if (mode) {
            set[i * 3] = (set[i * 3] ?? 0) + vec[0];
            set[i * 3 + 1] = (set[i * 3 + 1] ?? 0) + vec[1];
            set[i * 3 + 2] = (set[i * 3 + 2] ?? 0) + vec[2];
          } else {
            set[i * 3] = vec[0];
            set[i * 3 + 1] = vec[1];
            set[i * 3 + 2] = vec[2];
          }
        }
      }
      count += idxs.length;
    }
    if (count > 0) ctx.publish();
    return count;
  });

  /* ------------------------------ pseudoatom ----------------------------- */
  // pseudoatom(object, pos=[0,0,0], ...) — create a new object (or append to an
  // existing one) holding one pseudo atom at `pos`. Returns the object name.
  ctx.command('pseudoatom', (args, kwargs): Json => {
    // The console parser keeps every `key=value` token positional (it cannot
    // infer kwargs without a signature). `pseudoatom` is almost entirely
    // keyword-driven, so fold any `key=value` positional token back into kwargs
    // here — the one place that knows the parameter names — so console lines like
    // `pseudoatom m, name=AA, pos=[0,0,0]` behave exactly as in real PyMOL.
    const PARAMS = new Set([
      'object', 'selection', 'name', 'resn', 'resi', 'chain', 'segi', 'elem',
      'vdw', 'hetatm', 'b', 'q', 'color', 'label', 'pos', 'state', 'mode', 'quiet',
    ]);
    const kw: Record<string, unknown> = { ...kwargs };
    const positional: unknown[] = [];
    for (const a of args) {
      if (typeof a === 'string') {
        const eq = a.indexOf('=');
        const key = eq > 0 ? a.slice(0, eq).trim() : '';
        if (eq > 0 && PARAMS.has(key)) {
          kw[key] = a.slice(eq + 1).trim();
          continue;
        }
      }
      positional.push(a);
    }

    const objName = ctx.str(pick(positional, kw, 0, 'object'), '') || 'pseudo01';
    const pos = parseTriple(pick(positional, kw, 1, 'pos')) ?? [0, 0, 0];

    let mol = ex.molecule(objName);
    const fresh = !mol;
    if (!mol) {
      mol = new ObjectMolecule(objName);
      mol.states.push(new Float32Array(0));
    }
    if (mol.states.length === 0) mol.states.push(new Float32Array(0));

    // Honor an explicit `state` (1-based). The Python wrapper passes `state-1`
    // to the C layer; a specific (>=0) state grows the object to that many
    // coordinate sets — `ObjectMoleculeAddPseudoatom` does
    // `NCSet = state + 1` (`ObjectMolecule2.cpp:411`). The default
    // (ALL_STATES=0) leaves the state count alone and adds to every existing
    // state. New states copy the last state's atom coordinates so all states
    // stay uniform in this non-discrete model.
    const stateArg = Math.trunc(num(kw.state, 0));
    if (stateArg >= 1) {
      const template = mol.states[mol.states.length - 1] ?? new Float32Array(0);
      while (mol.states.length < stateArg) mol.states.push(new Float32Array(template));
    }

    // PyMOL assigns a created atom `id = AtomCounter++` (0-based per object) on
    // merge (`ObjectMolecule.cpp:2494`), so the first pseudoatom in a fresh
    // object has id 0 — the value `cmd.get_model` reports.
    const atom: AtomInfo = {
      id: mol.atoms.length,
      name: ctx.str(kw.name, '') || 'PS1',
      resn: ctx.str(kw.resn, '') || 'PSD',
      resi: ctx.str(kw.resi, '') || '1',
      resv: num(kw.resi, 1),
      chain: ctx.str(kw.chain, '') || 'P',
      segi: ctx.str(kw.segi, '') || 'PSDO',
      alt: '',
      elem: ctx.str(kw.elem, '') || 'PS',
      hetatm: true,
      b: num(kw.b, 0),
      q: num(kw.q, 0),
      color: num(kw.color, 0),
      ss: '',
      visRep: defaultVisRep(),
    };
    // `vdw`: an explicit override is kept (chempy Atom.vdw), matching
    // `ObjectMoleculeAddPseudoatom` (`ObjectMolecule2.cpp:308`). Absent ⇒ the
    // element's default radius fills in at read time.
    if (kw.vdw !== undefined && kw.vdw !== '') {
      const v = num(kw.vdw, -1);
      if (v >= 0) atom.vdwRadius = v;
    }
    mol.atoms.push(atom);

    // Extend every state's coordinate set by the new atom's position.
    for (let s = 0; s < mol.states.length; s++) {
      const old = mol.states[s]!;
      const out = new Float32Array(old.length + 3);
      out.set(old, 0);
      out[old.length] = pos[0];
      out[old.length + 1] = pos[1];
      out[old.length + 2] = pos[2];
      mol.states[s] = out;
    }

    if (fresh) ex.addMolecule(mol);
    ctx.publish();
    return objName;
  });

  /* ------------------------------ reference ------------------------------ */
  // reference(action='validate', selection='(all)', state=0, quiet=1) — manage a
  // per-atom "reference" coordinate baseline (PyMOL `ExecutiveReference` ->
  // `OMOP_Reference*` in ObjectMolecule.cpp). Actions resolve through the
  // shortcut table (store=1, recall=2, validate=3, swap=4):
  //   store    copy the current coords into each atom's reference slot;
  //   recall   write a stored slot back onto the current coords;
  //   validate fill only *unspecified* slots from the current coords;
  //   swap     exchange the stored slot with the current coords.
  // `state` is 1-based; PyMOL passes `state-1` down, so 0 => -1 => all states.
  // Returns the number of atom/state slots touched (PyMOL's `op.i2`).
  const REF_ACTIONS: Readonly<Record<string, number>> = {
    store: 1, recall: 2, validate: 3, swap: 4,
  };
  const resolveRefAction = (v: unknown): number => {
    const s = String(v ?? '').trim().toLowerCase();
    if (s === '') return 3; // default 'validate'
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    if (s in REF_ACTIONS) return REF_ACTIONS[s]!;
    const hits = Object.keys(REF_ACTIONS).filter((k) => k.startsWith(s));
    return hits.length === 1 ? REF_ACTIONS[hits[0]!]! : 3;
  };
  ctx.command('reference', (args, kwargs): Json => {
    const action = resolveRefAction(pick(args, kwargs, 0, 'action'));
    const selection = sel(pick(args, kwargs, 1, 'selection'), '(all)');
    const cState = num(pick(args, kwargs, 2, 'state'), 0) - 1;
    let count = 0;
    let moved = false;
    for (const [objName, idxs] of byObject(selection)) {
      const mol = ex.molecule(objName);
      if (!mol) continue;
      for (let b = 0; b < mol.states.length; b++) {
        if (!(b === cState || cState < 0)) continue;
        const set = mol.states[b];
        if (!set) continue;
        let refs = mol.refPos[b];
        if (!refs) mol.refPos[b] = refs = new Map();
        for (const i of idxs) {
          const o = i * 3;
          const rp = refs.get(i);
          switch (action) {
            case 1: // store
              refs.set(i, [set[o] ?? 0, set[o + 1] ?? 0, set[o + 2] ?? 0]);
              break;
            case 2: // recall
              if (rp) {
                set[o] = rp[0]; set[o + 1] = rp[1]; set[o + 2] = rp[2];
                moved = true;
              }
              break;
            case 3: // validate
              if (!rp) refs.set(i, [set[o] ?? 0, set[o + 1] ?? 0, set[o + 2] ?? 0]);
              break;
            case 4: // swap
              if (rp) {
                const cur: Vec3 = [set[o] ?? 0, set[o + 1] ?? 0, set[o + 2] ?? 0];
                set[o] = rp[0]; set[o + 1] = rp[1]; set[o + 2] = rp[2];
                refs.set(i, cur);
                moved = true;
              }
              break;
          }
          count++;
        }
      }
    }
    if (moved) ctx.publish();
    return count;
  });

  /* ----------------------------- set_dihedral ---------------------------- */
  // set_dihedral(atom1, atom2, atom3, atom4, angle, state=0) — rotate the atom3
  // side of the atom2-atom3 bond about that axis so the dihedral equals `angle`.
  ctx.command('set_dihedral', (args, kwargs): Json => {
    const s1 = ex.atomsMatching(sel(pick(args, kwargs, 0, 'atom1')));
    const s2 = ex.atomsMatching(sel(pick(args, kwargs, 1, 'atom2')));
    const s3 = ex.atomsMatching(sel(pick(args, kwargs, 2, 'atom3')));
    const s4 = ex.atomsMatching(sel(pick(args, kwargs, 3, 'atom4')));
    const angle = num(pick(args, kwargs, 4, 'angle'), 0);
    const state = num(pick(args, kwargs, 5, 'state'), 0);
    if (!s1.length || !s2.length || !s3.length || !s4.length) return null;
    const a1 = s1[0]!, a2 = s2[0]!, a3 = s3[0]!, a4 = s4[0]!;
    const objName = a1.objName;
    // All four atoms must belong to the same object.
    if (a2.objName !== objName || a3.objName !== objName || a4.objName !== objName) return null;
    const mol = ex.molecule(objName);
    if (!mol) return null;
    const st = state > 0 ? state : 1;
    const set = mol.states[st - 1];
    if (!set) return null;

    const p1 = mol.coord(a1.index, st);
    const p2 = mol.coord(a2.index, st);
    const p3 = mol.coord(a3.index, st);
    const p4 = mol.coord(a4.index, st);

    const current = dihedral(p1, p2, p3, p4);
    const delta = angle - current;

    // Atoms on atom3's side of the atom2-atom3 bond move. Find them by walking
    // the bond graph from atom3 without crossing atom2.
    const adj: number[][] = Array.from({ length: mol.natom }, () => []);
    for (const [i, j] of mol.bonds) {
      adj[i]!.push(j);
      adj[j]!.push(i);
    }
    const side = new Set<number>([a3.index]);
    const stack = [a3.index];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const nb of adj[cur]!) {
        if (nb === a2.index || side.has(nb)) continue;
        side.add(nb);
        stack.push(nb);
      }
    }

    // Rotate about the atom2->atom3 axis (so a positive delta raises the
    // dihedral in get_dihedral's convention), pivoting on atom3 (which lies on
    // the axis and stays put).
    const axis = norm(sub(p3, p2));
    for (const i of side) {
      const o = i * 3;
      const q = rotateAbout([set[o]!, set[o + 1]!, set[o + 2]!], p3, axis, delta);
      set[o] = q[0];
      set[o + 1] = q[1];
      set[o + 2] = q[2];
    }
    ctx.publish();
    return null;
  });
}
