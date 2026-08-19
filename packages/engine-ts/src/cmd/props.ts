/**
 * The `props` command subsystem — PyMOL's custom object/atom *properties*.
 *
 * PyMOL lets scripts hang arbitrary key/value data off objects and off
 * individual atoms (`cmd.set_property` / `cmd.get_property` /
 * `cmd.get_property_list`, and the per-atom `p.<name>` namespace reached through
 * `iterate`; see `layer2/AtomInfo.h`'s `Property` list and
 * `modules/pymol/properties`). This slice keeps two module-local stores:
 *
 *   - object-level: a WeakMap keyed by the {@link ObjectMolecule} instance, so a
 *     deleted object's properties are collectable and never leak across a
 *     `delete`+reload that reuses a name.
 *   - atom-level: stored directly on the {@link AtomInfo} record (its
 *     `properties` map), so the same store is reachable from `iterate`/`alter`
 *     through the `p` object and travels with the atom.
 *
 * Property values are string / number / boolean. PyMOL *does* coerce them: the
 * Python layer (`properties._typecast`) casts explicit `proptype`s, and for the
 * default `proptype=-1` (auto) the C layer (`PropertySetromString`) sniffs a
 * bare string into int → float → bool(true/yes/false/no) → string. This module
 * mirrors that pipeline so `get_property` reads back the same typed value real
 * PyMOL stores.
 */

import type { Json } from '@tenmol/protocol';
import type { ObjectMolecule } from '../model/molecule';
import type { RegistrarCtx } from './registrar';
import { getColorIndex } from '../exec/color';

/** A property value: the JSON scalars PyMOL admits for custom properties. */
type PropValue = string | number | boolean;

/** `proptype` codes, matching `pymol.properties` (PROPERTY_*). */
const PROP_AUTO = -1;
const PROP_BOOL = 1;
const PROP_INT = 2;
const PROP_FLOAT = 3;
const PROP_COLOR = 5;
const PROP_STRING = 6;

/** PyMOL's `cmd.boolean_dict` truthiness map (case-insensitive keys). */
const BOOLEAN_DICT: Record<string, boolean> = {
  '1': true, '0': false,
  on: true, off: false,
  yes: true, no: false,
  true: true, false: false,
};

/**
 * Sniff a bare string into int → float → bool → string, mirroring the C
 * `PropertySetromString`: `sscanf("%i %c")` (whole-string integer), then
 * `sscanf("%lf %c")` (whole-string float), then case-insensitive
 * true/yes/false/no, else the string verbatim.
 */
function autoFromString(value: string): PropValue {
  const t = value.trim();
  if (/^[+-]?\d+$/.test(t)) {
    const n = parseInt(t, 10);
    if (Number.isSafeInteger(n)) return n;
  }
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) {
    const f = Number(t);
    if (Number.isFinite(f)) return f;
  }
  const lc = t.toLowerCase();
  if (lc === 'true' || lc === 'yes') return true;
  if (lc === 'false' || lc === 'no') return false;
  return value;
}

/**
 * Coerce a raw `set_property`/`set_atom_property` value per `proptype`, matching
 * `properties._typecast` + the C auto-sniff. `resolveColor` maps a color
 * name/index string to its integer index for `proptype=5`.
 */
function typecastProp(
  raw: unknown,
  proptype: number,
  str: RegistrarCtx['str'],
  resolveColor: (v: unknown) => number,
): PropValue {
  switch (proptype) {
    case PROP_FLOAT: {
      const f = typeof raw === 'boolean' ? (raw ? 1 : 0) : Number(str(raw));
      return Number.isFinite(f) ? f : 0;
    }
    case PROP_INT: {
      const n = typeof raw === 'boolean' ? (raw ? 1 : 0) : parseInt(str(raw), 10);
      return Number.isFinite(n) ? n : 0;
    }
    case PROP_BOOL: {
      if (typeof raw === 'boolean') return raw;
      if (typeof raw === 'number') return raw !== 0;
      const lc = str(raw).toLowerCase();
      if (lc === 'false') return false;
      const mapped = BOOLEAN_DICT[lc];
      return mapped === undefined ? true : mapped;
    }
    case PROP_STRING:
      return str(raw);
    case PROP_COLOR:
      return resolveColor(raw);
    case PROP_AUTO:
    default:
      // Auto: a non-string real number/bool keeps its type; a string is sniffed.
      if (typeof raw === 'number' || typeof raw === 'boolean') return raw;
      return autoFromString(str(raw));
  }
}

export function registerProps(ctx: RegistrarCtx): void {
  const ex = ctx.executive;
  const str = ctx.str;

  /** Read `proptype` from args/kwargs (default -1 = auto). */
  const propType = (args: unknown[], kwargs: Record<string, unknown>, idx: number): number => {
    const raw = args[idx] ?? kwargs['proptype'];
    if (raw === undefined || raw === null || raw === '') return PROP_AUTO;
    const n = typeof raw === 'number' ? raw : parseInt(str(raw), 10);
    return Number.isFinite(n) ? n : PROP_AUTO;
  };

  /** Resolve a color name/index to its integer index (numeric strings pass through). */
  const resolveColor = (v: unknown): number => {
    if (typeof v === 'number') return v;
    const s = str(v).trim();
    if (/^[+-]?\d+$/.test(s)) return parseInt(s, 10);
    return getColorIndex(s);
  };

  /** object -> (property name -> value). */
  const objectProps = new WeakMap<ObjectMolecule, Map<string, PropValue>>();

  /** The property map for `mol`, created on first write. */
  const objMap = (mol: ObjectMolecule): Map<string, PropValue> => {
    let m = objectProps.get(mol);
    if (!m) objectProps.set(mol, (m = new Map()));
    return m;
  };

  /**
   * The objects a selection/object argument touches, in creation order.
   * A bare object name is taken directly (PyMOL's common `set_property` call);
   * the "everything" spellings hit every loaded object; otherwise the atom
   * selector decides which objects contribute an atom.
   */
  const objectsFor = (sel: string): ObjectMolecule[] => {
    if (!sel || sel === 'all' || sel === '*' || sel === '(all)') {
      return ex.moleculesInOrder();
    }
    const direct = ex.molecule(sel);
    if (direct) return [direct];
    const names = new Set<string>();
    for (const ua of ex.atomsMatching(sel)) names.add(ua.objName);
    return ex.moleculesInOrder().filter((m) => names.has(m.name));
  };

  /* --------------------------- object properties -------------------------- */

  // cmd.set_property(name, value, selection='(all)') — set an OBJECT-level
  // property on every object the selection touches. Returns the object count.
  ctx.command('set_property', (args, kwargs): Json => {
    const name = str(args[0] ?? kwargs['name']);
    if (!name) return 0;
    const value = typecastProp(args[1] ?? kwargs['value'], propType(args, kwargs, 4), str, resolveColor);
    const sel = str(args[2] ?? kwargs['selection'] ?? kwargs['object'] ?? '(all)', '(all)');
    const objs = objectsFor(sel);
    for (const mol of objs) objMap(mol).set(name, value);
    if (objs.length > 0) ctx.publish();
    return objs.length;
  });

  // cmd.get_property(name, object) — read one object property, or null.
  ctx.command('get_property', (args, kwargs): Json => {
    const name = str(args[0] ?? kwargs['name']);
    const objName = str(args[1] ?? kwargs['object'] ?? kwargs['name_of_object'] ?? '');
    const mol = ex.molecule(objName);
    if (!mol) return null;
    const m = objectProps.get(mol);
    const v = m?.get(name);
    return v === undefined ? null : v;
  });

  // cmd.get_property_list(object, state) — the property NAMES of a single
  // object's properties (the first object the argument touches), in the order
  // they were first set. Empty list when the object has none. Real PyMOL's
  // C layer returns the list of names (propname=None means "return all").
  ctx.command('get_property_list', (args, kwargs): Json => {
    const sel = str(args[0] ?? kwargs['object'] ?? kwargs['selection'] ?? '(all)', '(all)');
    const objs = objectsFor(sel);
    const mol = objs[0];
    if (!mol) return [];
    const m = objectProps.get(mol);
    if (!m) return [];
    return [...m.keys()];
  });

  /* ---------------------------- atom properties --------------------------- */

  // cmd.set_atom_property(name, value, selection='(all)') — set a per-ATOM
  // property on every matched atom. Returns the atom count.
  ctx.command('set_atom_property', (args, kwargs): Json => {
    const name = str(args[0] ?? kwargs['name']);
    if (!name) return 0;
    const value = typecastProp(args[1] ?? kwargs['value'], propType(args, kwargs, 4), str, resolveColor);
    const sel = str(args[2] ?? kwargs['selection'] ?? '(all)', '(all)');
    const matched = ex.atomsMatching(sel);
    for (const ua of matched) {
      const a = ua.atom;
      (a.properties ??= {})[name] = value;
    }
    if (matched.length > 0) ctx.publish();
    return matched.length;
  });

  // cmd.get_atom_property(name, selection='(all)') — the value of `name` for
  // each matched atom, in selection order (null where the atom lacks it). This
  // is the read-back path for the per-atom `p.<name>` namespace.
  ctx.command('get_atom_property', (args, kwargs): Json => {
    const name = str(args[0] ?? kwargs['name']);
    const sel = str(args[1] ?? kwargs['selection'] ?? '(all)', '(all)');
    const out: Array<PropValue | null> = [];
    for (const ua of ex.atomsMatching(sel)) {
      const v = ua.atom.properties?.[name];
      out.push(v === undefined ? null : v);
    }
    return out;
  });
}
