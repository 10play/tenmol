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

/** IUPAC dihedral (degrees) of points p1-p2-p3-p4. */
function dihedral(p1: Vec3, p2: Vec3, p3: Vec3, p4: Vec3): number {
  const b1 = sub(p2, p1);
  const b2 = sub(p3, p2);
  const b3 = sub(p4, p3);
  const n1 = cross(b1, b2);
  const n2 = cross(b2, b3);
  const m1 = cross(n1, norm(b2));
  const x = dot(n1, n2);
  const y = dot(m1, n2);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/* --------------------------- protected flag ------------------------------ */

/** An atom carrying the editor's per-atom `protected` flag (PyMOL `flag 6`). */
type Protectable = AtomInfo & { protected?: boolean };

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
  ctx.command('edit', (args, kwargs): Json => {
    const s1 = sel(pick(args, kwargs, 0, 'selection1'));
    ex.select('pk1', s1);
    const s2raw = pick(args, kwargs, 1, 'selection2');
    const s2 = s2raw == null ? '' : ctx.str(s2raw, '');
    if (s2 && s2.toLowerCase() !== 'none') ex.select('pk2', s2);
    else ex.delete('pk2');
    ctx.publish();
    return null;
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
  // torsion(angle) — rotate the fragment on the pk2 side of the currently picked
  // bond (pk1–pk2) about that bond axis by `angle` degrees (editing.py:1135).
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

    // Adjacency, then the pk2-side fragment: reachable from i2 without crossing
    // the i1–i2 bond or ever entering i1.
    const adj: number[][] = Array.from({ length: mol.natom }, () => []);
    for (const [a, b] of mol.bonds) {
      adj[a]!.push(b);
      adj[b]!.push(a);
    }
    const frag = new Set<number>([i2]);
    const stack = [i2];
    while (stack.length > 0) {
      const x = stack.pop()!;
      for (const y of adj[x] ?? []) {
        if (y === i1) continue; // never cross onto the pk1 side
        if (!frag.has(y)) {
          frag.add(y);
          stack.push(y);
        }
      }
    }
    frag.delete(i2); // on the rotation axis — unaffected

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (const set of mol.states) {
      if (!set) continue;
      const ox = set[i1 * 3]!, oy = set[i1 * 3 + 1]!, oz = set[i1 * 3 + 2]!;
      let ux = set[i2 * 3]! - ox, uy = set[i2 * 3 + 1]! - oy, uz = set[i2 * 3 + 2]! - oz;
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
  // group(name, members='', action='auto') — create/extend a group object
  // (creating.py). We register a first-class group gadget so get_names lists it
  // and get_type reports 'object:group'; membership is not modelled deeply.
  ctx.command('group', (args, kwargs): Json => {
    const name = ctx.str(pick(args, kwargs, 0, 'name'), '');
    if (name === '') return 0;
    ex.registerGadget(name, 'object:group');
    ctx.publish();
    return name;
  });
  ctx.command('ungroup', (args, kwargs): Json => {
    const members = ctx.str(pick(args, kwargs, 0, 'members'), '');
    if (members !== '' && ex.gadget(members)?.kind === 'object:group') ex.delete(members);
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
  // translate_atom(selection, v0, v1, v2, state=0) — shift the matched atoms'
  // coordinates by (v0,v1,v2). state<=0 shifts every state. Returns the count.
  ctx.command('translate_atom', (args, kwargs): Json => {
    const selection = sel(pick(args, kwargs, 0, 'selection'));
    const vec: Vec3 = [
      num(pick(args, kwargs, 1, 'v0'), 0),
      num(pick(args, kwargs, 2, 'v1'), 0),
      num(pick(args, kwargs, 3, 'v2'), 0),
    ];
    const state = num(pick(args, kwargs, 4, 'state'), 0);
    let count = 0;
    for (const [objName, idxs] of byObject(selection)) {
      const mol = ex.molecule(objName);
      if (!mol) continue;
      const states = state > 0 ? [mol.states[state - 1]] : mol.states;
      for (const set of states) {
        if (!set) continue;
        for (const i of idxs) {
          set[i * 3] = (set[i * 3] ?? 0) + vec[0];
          set[i * 3 + 1] = (set[i * 3 + 1] ?? 0) + vec[1];
          set[i * 3 + 2] = (set[i * 3 + 2] ?? 0) + vec[2];
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
    const objName = ctx.str(pick(args, kwargs, 0, 'object'), '') || 'pseudo01';
    const pos = parseTriple(pick(args, kwargs, 1, 'pos')) ?? [0, 0, 0];

    let mol = ex.molecule(objName);
    const fresh = !mol;
    if (!mol) {
      mol = new ObjectMolecule(objName);
      mol.states.push(new Float32Array(0));
    }
    if (mol.states.length === 0) mol.states.push(new Float32Array(0));

    const atom: AtomInfo = {
      id: mol.atoms.length + 1,
      name: ctx.str(kwargs.name, '') || 'PS1',
      resn: ctx.str(kwargs.resn, '') || 'PSDO',
      resi: ctx.str(kwargs.resi, '') || '1',
      resv: num(kwargs.resi, 1),
      chain: ctx.str(kwargs.chain, ''),
      segi: ctx.str(kwargs.segi, '') || 'PSDO',
      alt: '',
      elem: ctx.str(kwargs.elem, '') || 'PS',
      hetatm: true,
      b: num(kwargs.b, 0),
      q: num(kwargs.q, 0),
      color: num(kwargs.color, 0),
      ss: '',
      visRep: defaultVisRep(),
    };
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

    // Rotate about the axis from atom3 toward atom2 (so a positive delta raises
    // the dihedral), pivoting on atom3 (which lies on the axis and stays put).
    const axis = norm(sub(p2, p3));
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
