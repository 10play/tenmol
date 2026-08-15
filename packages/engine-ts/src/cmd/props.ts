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
 * Property values are string / number / boolean, stored verbatim (PyMOL does not
 * coerce them). The console hands everything in as strings; a caller passing a
 * real number or boolean keeps that type.
 */

import type { Json } from '@tenmol/protocol';
import type { ObjectMolecule } from '../model/molecule';
import type { RegistrarCtx } from './registrar';

/** A property value: the JSON scalars PyMOL admits for custom properties. */
type PropValue = string | number | boolean;

/** Keep a value verbatim when it is already a scalar; else stringify it. */
function coerceProp(raw: unknown, str: RegistrarCtx['str']): PropValue {
  if (typeof raw === 'number' || typeof raw === 'boolean' || typeof raw === 'string') return raw;
  return str(raw);
}

export function registerProps(ctx: RegistrarCtx): void {
  const ex = ctx.executive;
  const str = ctx.str;

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
    const value = coerceProp(args[1] ?? kwargs['value'], str);
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
    const value = coerceProp(args[1] ?? kwargs['value'], str);
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
