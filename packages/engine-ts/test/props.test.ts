/**
 * Tests for the `props` subsystem (packages/engine-ts/src/cmd/props.ts):
 * custom object properties (`set_property` / `get_property` /
 * `get_property_list`) and per-atom properties (`set_atom_property` /
 * `get_atom_property`).
 *
 * Isolated: a bare RegistrarCtx over an Executive with the shared ALA/GLY
 * fixture, so no other in-progress subsystem is pulled in. Expected values are
 * hand-derived from the fixture's 9 atoms (ALA chain A resi 1 = 5 atoms; GLY
 * chain B resi 2 = 4 atoms; 2 CA atoms).
 */

import { describe, expect, it } from 'vitest';

import { Executive } from '../src/exec/executive';
import { parsePdb } from '../src/model/pdb';
import { registerProps } from '../src/cmd/props';
import type { CommandHandler } from '../src/cmd/registrar';
import { SMALL_PDB } from './fixture';

interface Harness {
  ex: Executive;
  call(name: string, args?: unknown[], kwargs?: Record<string, unknown>): unknown;
  publishCount(): number;
}

function makeHarness(objName = 'm'): Harness {
  const ex = new Executive();
  ex.addMolecule(parsePdb(SMALL_PDB, objName));
  const handlers = new Map<string, CommandHandler>();
  let published = 0;
  const ctx = {
    command: (n: string, f: CommandHandler) => void handlers.set(n, f),
    executive: ex,
    publish: () => void (published += 1),
    emitView: () => {},
    str: (v: unknown, d = '') => (v === undefined || v === null ? d : String(v)),
  };
  registerProps(ctx);
  return {
    ex,
    call: (name, args = [], kwargs = {}) => {
      const h = handlers.get(name);
      if (!h) throw new Error(`no handler ${name}`);
      return h(args, kwargs);
    },
    publishCount: () => published,
  };
}

describe('props: object properties', () => {
  it('round-trips set_property -> get_property on an object', () => {
    const h = makeHarness();
    // '(all)' touches the single object -> 1 object updated.
    expect(h.call('set_property', ['author', 'ada', '(all)'])).toBe(1);
    expect(h.call('get_property', ['author', 'm'])).toBe('ada');
  });

  it('preserves number and boolean value types verbatim', () => {
    const h = makeHarness();
    h.call('set_property', ['resolution', 1.8, 'm']);
    h.call('set_property', ['refined', true, 'm']);
    expect(h.call('get_property', ['resolution', 'm'])).toBe(1.8);
    expect(h.call('get_property', ['refined', 'm'])).toBe(true);
  });

  it('overwrites an existing property in place (no duplicate list entry)', () => {
    const h = makeHarness();
    h.call('set_property', ['author', 'ada', 'm']);
    h.call('set_property', ['author', 'grace', 'm']);
    expect(h.call('get_property', ['author', 'm'])).toBe('grace');
    // Real PyMOL's get_property_list returns just the property NAMES.
    expect(h.call('get_property_list', ['m'])).toEqual(['author']);
  });

  it('returns null for an absent property and an unknown object', () => {
    const h = makeHarness();
    h.call('set_property', ['author', 'ada', 'm']);
    expect(h.call('get_property', ['missing', 'm'])).toBeNull();
    expect(h.call('get_property', ['author', 'nope'])).toBeNull();
  });

  it('get_property_list returns property names in insertion order', () => {
    const h = makeHarness();
    h.call('set_property', ['author', 'ada', 'm']);
    h.call('set_property', ['year', 1843, 'm']);
    // Real PyMOL's get_property_list returns just the property NAMES.
    expect(h.call('get_property_list', ['m'])).toEqual(['author', 'year']);
    // No properties on a fresh object -> empty list.
    const h2 = makeHarness('empty');
    expect(h2.call('get_property_list', ['empty'])).toEqual([]);
  });

  it('a selection sets the property only on objects it touches', () => {
    const h = makeHarness('a');
    h.ex.addMolecule(parsePdb(SMALL_PDB, 'b'));
    // chain A exists in both objects (identical fixture) -> both updated.
    expect(h.call('set_property', ['tag', 'x', 'chain A'])).toBe(2);
    expect(h.call('get_property', ['tag', 'a'])).toBe('x');
    expect(h.call('get_property', ['tag', 'b'])).toBe('x');
    // A single bare object name updates only that object.
    expect(h.call('set_property', ['only', 'a', 'a'])).toBe(1);
    expect(h.call('get_property', ['only', 'b'])).toBeNull();
  });

  it('publishes on a mutating set and not on a no-op selection', () => {
    const h = makeHarness();
    h.call('set_property', ['author', 'ada', 'm']);
    expect(h.publishCount()).toBe(1);
    // A selection matching no object -> nothing set, no publish.
    expect(h.call('set_property', ['author', 'ada', 'chain Z'])).toBe(0);
    expect(h.publishCount()).toBe(1);
  });
});

describe('props: atom properties', () => {
  it('sets a per-atom property on a sub-selection only', () => {
    const h = makeHarness();
    // 2 CA atoms in the fixture (one per residue).
    expect(h.call('set_atom_property', ['tag', 'ca', 'name CA'])).toBe(2);
    // Read back across all 9 atoms: only the two CA atoms carry the value.
    const all = h.call('get_atom_property', ['tag', 'all']) as unknown[];
    expect(all).toHaveLength(9);
    expect(all.filter((v) => v === 'ca')).toHaveLength(2);
    expect(all.filter((v) => v === null)).toHaveLength(7);
  });

  it('returns values in selection order for the matched atoms', () => {
    const h = makeHarness();
    // Chain A has 5 atoms; give each a value, then read them back in order.
    h.call('set_atom_property', ['grp', 'A', 'chain A']);
    h.call('set_atom_property', ['grp', 'B', 'chain B']);
    const chainA = h.call('get_atom_property', ['grp', 'chain A']) as unknown[];
    expect(chainA).toEqual(['A', 'A', 'A', 'A', 'A']);
    const chainB = h.call('get_atom_property', ['grp', 'chain B']) as unknown[];
    expect(chainB).toEqual(['B', 'B', 'B', 'B']);
  });

  it('does not leak atom properties into object properties', () => {
    const h = makeHarness();
    h.call('set_atom_property', ['tag', 'ca', 'name CA']);
    expect(h.call('get_property', ['tag', 'm'])).toBeNull();
    expect(h.call('get_property_list', ['m'])).toEqual([]);
  });

  it('all-null list for a property never set, and 0 for an empty selection', () => {
    const h = makeHarness();
    expect(h.call('set_atom_property', ['tag', 'v', 'chain Z'])).toBe(0);
    const vals = h.call('get_atom_property', ['tag', 'all']) as unknown[];
    expect(vals).toEqual([null, null, null, null, null, null, null, null, null]);
  });
});
