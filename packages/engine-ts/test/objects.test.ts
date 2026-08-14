import { describe, it, expect } from 'vitest';
import { Executive } from '../src/exec/executive';
import { parsePdb } from '../src/model/pdb';
import { registerObjects } from '../src/cmd/objects';
import type { CommandHandler } from '../src/cmd/registrar';

/* ------------------------------------------------------------------------ */
/* PDB fixture: two chains. Chain A = N-CA (bonded, resi 1); chain B = one    */
/* isolated O atom far away (no bond to chain A).                            */
/* ------------------------------------------------------------------------ */

interface AtomSpec {
  serial: number;
  name: string;
  resn: string;
  chain: string;
  resi: number;
  x: number;
  y: number;
  z: number;
  b: number;
  elem: string;
  het?: boolean;
}

function atomLine(a: AtomSpec): string {
  const rec = a.het ? 'HETATM' : 'ATOM  '; // 1-6
  let line = rec;
  line += String(a.serial).padStart(5); // 7-11
  line += ' '; // 12
  const nm = a.name.length >= 4 ? a.name.slice(0, 4) : (' ' + a.name).padEnd(4);
  line += nm; // 13-16
  line += ' '; // 17 alt
  line += a.resn.padEnd(3); // 18-20
  line += ' '; // 21
  line += a.chain.padEnd(1); // 22
  line += String(a.resi).padStart(4); // 23-26
  line += ' '.repeat(4); // 27-30
  line += a.x.toFixed(3).padStart(8); // 31-38
  line += a.y.toFixed(3).padStart(8); // 39-46
  line += a.z.toFixed(3).padStart(8); // 47-54
  line += (1).toFixed(2).padStart(6); // 55-60 occ
  line += a.b.toFixed(2).padStart(6); // 61-66 b
  line += ' '.repeat(10); // 67-76
  line += a.elem.padStart(2); // 77-78
  return line;
}

const PDB = [
  atomLine({ serial: 1, name: 'N', resn: 'ALA', chain: 'A', resi: 1, x: 0, y: 0, z: 0, b: 10, elem: 'N' }),
  atomLine({ serial: 2, name: 'CA', resn: 'ALA', chain: 'A', resi: 1, x: 1.46, y: 0, z: 0, b: 20, elem: 'C' }),
  atomLine({ serial: 3, name: 'O', resn: 'HOH', chain: 'B', resi: 1, x: 10, y: 0, z: 0, b: 5, elem: 'O', het: true }),
].join('\n');

/* ------------------------------------------------------------------------ */
/* Harness                                                                   */
/* ------------------------------------------------------------------------ */

function setup() {
  const ex = new Executive();
  ex.addMolecule(parsePdb(PDB, 'm'));
  const handlers = new Map<string, CommandHandler>();
  const ctx = {
    command: (n: string, f: CommandHandler) => handlers.set(n, f),
    executive: ex,
    publish() {},
    emitView() {},
    str: (v: unknown, d = '') => (v == null ? d : String(v)),
  };
  registerObjects(ctx);
  const call = (name: string, args: unknown[] = [], kwargs: Record<string, unknown> = {}) =>
    handlers.get(name)!(args, kwargs);
  return { ex, handlers, call };
}

/* ------------------------------------------------------------------------ */

describe('objects: fixture sanity', () => {
  it('parses 3 atoms and the N-CA bond only', () => {
    const { ex } = setup();
    const m = ex.molecule('m')!;
    expect(m.natom).toBe(3);
    // N(0)-CA(1) bond; the far O is unbonded.
    expect(m.bonds).toEqual([[0, 1]]);
    expect(ex.countAtoms('chain A')).toBe(2);
    expect(ex.countAtoms('chain B')).toBe(1);
  });
});

describe('objects: create', () => {
  it('copies a selection into a new object with remapped bonds', () => {
    const { ex, call } = setup();
    const n = call('create', ['subA', 'chain A']);
    expect(n).toBe(2);
    expect(ex.getNames('objects')).toEqual(['m', 'subA']);
    const sub = ex.molecule('subA')!;
    expect(sub.natom).toBe(2);
    expect(sub.atoms.map((a) => a.name)).toEqual(['N', 'CA']);
    // ids re-numbered from 1 in the new object.
    expect(sub.atoms.map((a) => a.id)).toEqual([1, 2]);
    // bond [0,1] survives, remapped into the new index space.
    expect(sub.bonds).toEqual([[0, 1]]);
    // coordinates copied exactly (float32).
    expect(sub.coord(0, 1)).toEqual([0, 0, 0]);
    expect(sub.coord(1, 1)[0]).toBeCloseTo(1.46, 5);
  });

  it('drops a bond when only one endpoint is selected', () => {
    const { ex, call } = setup();
    call('create', ['caonly', 'name CA']);
    const sub = ex.molecule('caonly')!;
    expect(sub.natom).toBe(1);
    expect(sub.bonds).toEqual([]);
  });

  it('deep-copies: mutating the copy does not touch the source', () => {
    const { ex, call } = setup();
    call('create', ['subA', 'chain A']);
    const sub = ex.molecule('subA')!;
    const src = ex.molecule('m')!;
    sub.atoms[0]!.b = 999;
    sub.atoms[0]!.name = 'ZZ';
    sub.states[0]![0] = 42;
    expect(src.atoms[0]!.b).toBe(10);
    expect(src.atoms[0]!.name).toBe('N');
    expect(src.coord(0, 1)).toEqual([0, 0, 0]);
  });

  it('auto-names when the name is blank', () => {
    const { ex, call } = setup();
    call('create', ['', 'all']);
    expect(ex.getNames('objects')).toContain('obj');
  });
});

describe('objects: copy', () => {
  it('duplicates a whole object independently', () => {
    const { ex, call } = setup();
    const n = call('copy', ['m2', 'm']);
    expect(n).toBe(3);
    expect(ex.getNames('objects')).toEqual(['m', 'm2']);
    const m2 = ex.molecule('m2')!;
    expect(m2.natom).toBe(3);
    expect(m2.bonds).toEqual([[0, 1]]);
    m2.atoms[2]!.b = -1;
    expect(ex.molecule('m')!.atoms[2]!.b).toBe(5);
  });
});

describe('objects: set_name / rename', () => {
  it('renames an object, preserving order, atoms and enabled', () => {
    const { ex, call } = setup();
    call('create', ['x', 'chain B']);
    ex.molecule('x')!.enabled = false;
    const r = call('set_name', ['x', 'y']);
    expect(r).toBe(1);
    expect(ex.getNames('objects')).toEqual(['m', 'y']);
    expect(ex.molecule('x')).toBeUndefined();
    expect(ex.molecule('y')!.natom).toBe(1);
    expect(ex.molecule('y')!.enabled).toBe(false);
  });

  it('remaps named-selection keys to the new object name', () => {
    const { ex, call } = setup();
    ex.select('sel', 'chain A'); // keys reference object 'm'
    call('rename', ['m', 'mol']);
    // after rename the selection still resolves against the renamed object.
    expect(ex.countAtoms('sel')).toBe(2);
  });

  it('refuses to rename onto an existing name', () => {
    const { ex, call } = setup();
    call('create', ['dup', 'all']);
    expect(call('set_name', ['m', 'dup'])).toBe(0);
    expect(ex.molecule('m')).toBeDefined();
  });
});

describe('objects: enable / disable', () => {
  it('toggles the enabled flag and filters enabledOnly get_names', () => {
    const { ex, call } = setup();
    call('create', ['a', 'chain A']);
    call('disable', ['a']);
    expect(ex.molecule('a')!.enabled).toBe(false);
    expect(ex.getNames('objects', true)).toEqual(['m']);
    call('enable', ['a']);
    expect(ex.molecule('a')!.enabled).toBe(true);
    expect(ex.getNames('objects', true)).toEqual(['m', 'a']);
  });

  it('disable all turns every object off', () => {
    const { ex, call } = setup();
    call('create', ['a', 'chain A']);
    call('disable', ['all']);
    expect(ex.getNames('objects', true)).toEqual([]);
  });
});

describe('objects: order', () => {
  function three() {
    const s = setup();
    s.call('create', ['a', 'chain A']);
    s.call('create', ['b', 'chain B']);
    return s; // order now: m, a, b
  }

  it('reorders named objects in place (location=current)', () => {
    const { ex, call } = three();
    call('order', ['b a']); // move so b before a, at position of first (a)
    expect(ex.getNames('objects')).toEqual(['m', 'b', 'a']);
  });

  it('sorts all objects with sorted=1', () => {
    const { ex, call } = three();
    call('order', ['*', 1]);
    expect(ex.getNames('objects')).toEqual(['a', 'b', 'm']);
  });

  it('moves named objects to the top', () => {
    const { ex, call } = three();
    call('order', ['b', 0, 'top']);
    expect(ex.getNames('objects')).toEqual(['b', 'm', 'a']);
  });

  it('moves named objects to the bottom', () => {
    const { ex, call } = three();
    call('order', ['m', 0, 'bottom']);
    expect(ex.getNames('objects')).toEqual(['a', 'b', 'm']);
  });
});

describe('objects: group / ungroup', () => {
  it('creates a group observable in get_names and skipped by moleculesInOrder', () => {
    const { ex, call } = setup();
    call('create', ['a', 'chain A']);
    call('group', ['g', 'a']);
    expect(ex.getNames('objects')).toContain('g');
    // group is not a real molecule.
    expect(ex.molecule('g')).toBeUndefined();
    expect(ex.moleculesInOrder().map((m) => m.name)).toEqual(['m', 'a']);
    call('ungroup', ['g']);
    expect(ex.getNames('objects')).not.toContain('g');
  });

  it('enabling a group toggles its members', () => {
    const { ex, call } = setup();
    call('create', ['a', 'chain A']);
    call('create', ['b', 'chain B']);
    call('group', ['g', 'a b']);
    call('disable', ['g']);
    expect(ex.molecule('a')!.enabled).toBe(false);
    expect(ex.molecule('b')!.enabled).toBe(false);
  });
});

describe('objects: split_chains', () => {
  it('creates one object per chain with the right atoms', () => {
    const { ex, call } = setup();
    const created = call('split_chains', ['m']) as string[];
    expect(created).toEqual(['m_A', 'm_B']);
    expect(ex.molecule('m_A')!.natom).toBe(2);
    expect(ex.molecule('m_A')!.bonds).toEqual([[0, 1]]);
    expect(ex.molecule('m_B')!.natom).toBe(1);
    // original object is retained.
    expect(ex.molecule('m')!.natom).toBe(3);
  });

  it('honours a custom prefix', () => {
    const { ex, call } = setup();
    const created = call('split_chains', ['chain A', 'frag']) as string[];
    expect(created).toEqual(['frag_A']);
    expect(ex.molecule('frag_A')!.natom).toBe(2);
  });
});

describe('objects: name helpers & misc', () => {
  it('get_unused_name returns a free name', () => {
    const { call } = setup();
    // Real PyMOL (ExecutiveGetUnusedName): alwaysnumber defaults to 1, so a
    // 2-digit number is always appended (verified against the oracle).
    expect(call('get_unused_name', ['m'])).toBe('m01'); // 'm' taken -> m01
    expect(call('get_unused_name', ['fresh'])).toBe('fresh01');
    expect(call('get_unused_name', [])).toBe('tmp01'); // default prefix 'tmp'
    expect(call('get_unused_name', ['fresh', 0])).toBe('fresh'); // alwaysnumber=0, free
  });

  it('get_legal_name sanitises problem characters', () => {
    const { call } = setup();
    expect(call('get_legal_name', ['a b*c'])).toBe('a_b_c');
    expect(call('get_legal_name', ['ok_name'])).toBe('ok_name');
  });

  it('flag resolves names/numbers and reports the atom count', () => {
    const { call } = setup();
    expect(call('flag', ['ignore', 'chain A'])).toBe(2);
    expect(call('flag', ['24', 'all'])).toBe(3);
    expect(() => call('flag', ['bogus', 'all'])).toThrow();
  });

  it('deselect is callable and returns null', () => {
    const { call } = setup();
    expect(call('deselect', [])).toBeNull();
  });
});
