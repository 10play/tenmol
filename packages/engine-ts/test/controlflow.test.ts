import { describe, it, expect } from 'vitest';
import { Executive } from '../src/exec/executive';
import { parsePdb } from '../src/model/pdb';
import { registerControlflow } from '../src/cmd/controlflow';
import type { CommandHandler } from '../src/cmd/registrar';

/* ------------------------------------------------------------------------ */
/* Two atoms in one object. Atom 1 (C) at the origin; atom 2 (O) at (1,2,3). */
/* ------------------------------------------------------------------------ */
const PDB = [
  'ATOM      1  C   ALA A   1       0.000   0.000   0.000  1.00  0.00           C',
  'ATOM      2  O   ALA A   1       1.000   2.000   3.000  1.00  0.00           O',
  '',
].join('\n');

interface Harness {
  ex: Executive;
  call: (name: string, ...args: unknown[]) => unknown;
  callKw: (name: string, args: unknown[], kwargs: Record<string, unknown>) => unknown;
  publishCount: () => number;
}

function harness(pdb = PDB): Harness {
  const ex = new Executive();
  ex.addMolecule(parsePdb(pdb, 'm'));
  const handlers = new Map<string, CommandHandler>();
  let publishes = 0;
  const ctx = {
    command: (n: string, f: CommandHandler) => void handlers.set(n, f),
    executive: ex,
    publish() {
      publishes++;
    },
    emitView() {},
    str: (v: unknown, d = '') => (v == null ? d : String(v)),
  };
  registerControlflow(ctx);
  const invoke = (name: string, args: unknown[], kwargs: Record<string, unknown>): unknown => {
    const h = handlers.get(name);
    if (!h) throw new Error(`no handler '${name}'`);
    return h(args, kwargs);
  };
  return {
    ex,
    call: (name, ...args) => invoke(name, args, {}),
    callKw: (name, args, kwargs) => invoke(name, args, kwargs),
    publishCount: () => publishes,
  };
}

/** Overwrite atom `i` (0-based) coords in state 1, simulating a transform. */
function setCoord(ex: Executive, i: number, xyz: [number, number, number]): void {
  const set = ex.molecule('m')!.states[0]!;
  set[i * 3] = xyz[0];
  set[i * 3 + 1] = xyz[1];
  set[i * 3 + 2] = xyz[2];
}

describe('controlflow: undo/redo of coordinate mutations', () => {
  it('push_undo then a mutation then undo restores the original coordinates', () => {
    const { ex, call } = harness();
    expect(ex.molecule('m')!.coord(0, 1)).toEqual([0, 0, 0]);

    expect(call('push_undo', 'all', 1)).toBeNull();
    // A transform moves atom 1.
    setCoord(ex, 0, [9, 9, 9]);
    expect(ex.molecule('m')!.coord(0, 1)).toEqual([9, 9, 9]);

    // undo -> back to the origin; returns the number of atoms restored (2).
    expect(call('undo')).toBe(2);
    expect(ex.molecule('m')!.coord(0, 1)).toEqual([0, 0, 0]);
    expect(ex.molecule('m')!.coord(1, 1)).toEqual([1, 2, 3]);
  });

  it('redo re-applies the undone mutation', () => {
    const { ex, call } = harness();
    call('push_undo', 'all', 1);
    setCoord(ex, 0, [9, 9, 9]);
    call('undo');
    expect(ex.molecule('m')!.coord(0, 1)).toEqual([0, 0, 0]);

    expect(call('redo')).toBe(2);
    expect(ex.molecule('m')!.coord(0, 1)).toEqual([9, 9, 9]);
  });

  it('undo/redo round-trips repeatedly', () => {
    const { ex, call } = harness();
    call('push_undo', 'all', 1);
    setCoord(ex, 1, [-5, -5, -5]);
    call('undo');
    expect(ex.molecule('m')!.coord(1, 1)).toEqual([1, 2, 3]);
    call('redo');
    expect(ex.molecule('m')!.coord(1, 1)).toEqual([-5, -5, -5]);
    call('undo');
    expect(ex.molecule('m')!.coord(1, 1)).toEqual([1, 2, 3]);
  });

  it('undo with an empty history is a safe no-op returning null', () => {
    const { call } = harness();
    expect(call('undo')).toBeNull();
    expect(call('redo')).toBeNull();
  });

  it('a new push_undo invalidates the redo branch', () => {
    const { ex, call } = harness();
    call('push_undo', 'all', 1);
    setCoord(ex, 0, [9, 9, 9]);
    call('undo'); // origin, redo branch now holds (9,9,9)
    call('push_undo', 'all', 1); // records origin, clears redo
    expect(call('redo')).toBeNull();
  });

  it('push_undo can snapshot a sub-selection only', () => {
    const { ex, call } = harness();
    call('push_undo', 'elem O', 1); // atom 2 only
    setCoord(ex, 0, [7, 7, 7]); // move atom 1 (NOT snapshotted)
    setCoord(ex, 1, [8, 8, 8]); // move atom 2 (snapshotted)
    expect(call('undo')).toBe(1); // only atom 2 restored
    expect(ex.molecule('m')!.coord(0, 1)).toEqual([7, 7, 7]); // untouched
    expect(ex.molecule('m')!.coord(1, 1)).toEqual([1, 2, 3]); // restored
  });
});

describe('controlflow: pop', () => {
  it('moves one atom out of a named selection into a new selection', () => {
    const { ex, call } = harness();
    expect(ex.select('src', 'all')).toBe(2);

    expect(call('pop', 'popped', 'src')).toBe(1);
    expect(ex.countAtoms('popped')).toBe(1);
    expect(ex.countAtoms('src')).toBe(1);
    // The popped atom is the FIRST atom (per-object index 1 -> the carbon).
    expect(ex.atomsMatching('popped')[0]!.atom.name).toBe('C');
    // ...and it is gone from src, which now holds only the oxygen.
    expect(ex.atomsMatching('src')[0]!.atom.name).toBe('O');
  });

  it('draining a selection to empty then popping again returns 0', () => {
    const { ex, call } = harness();
    ex.select('src', 'all');
    expect(call('pop', 'p', 'src')).toBe(1);
    expect(call('pop', 'p', 'src')).toBe(1);
    expect(ex.countAtoms('src')).toBe(0);
    expect(call('pop', 'p', 'src')).toBe(0); // nothing left
  });

  it('returns 0 when the source is empty and does not throw', () => {
    const { call } = harness();
    expect(call('pop', 'p', 'none')).toBe(0);
  });
});

describe('controlflow: sandboxed no-ops never touch the real system', () => {
  it('run/spawn/system return null without executing anything', () => {
    const { call } = harness();
    expect(call('run', '/etc/passwd')).toBeNull();
    expect(call('spawn', 'evil.py')).toBeNull();
    expect(call('system', 'rm -rf /')).toBeNull();
  });

  // `ending` moved to system.ts (it now jumps to the last movie frame rather
  // than being an inert no-op), so it is no longer registered by controlflow.
  it('sync/abort/accept/splash/update/rebuild_all/api are inert nulls', () => {
    const { call } = harness();
    for (const cmd of ['sync', 'abort', 'accept', 'splash', 'update', 'rebuild_all', 'api']) {
      expect(call(cmd)).toBeNull();
    }
  });

  it('sync tolerates timeout/poll arguments', () => {
    const { call } = harness();
    expect(call('sync', 1.0, 0.05)).toBeNull();
  });
});

describe('controlflow: input bindings', () => {
  it('set_key stores a binding retrievable via get_key_bindings', () => {
    const { call } = harness();
    expect(call('set_key', 'F1', 'ray')).toBeNull();
    expect(call('get_key_bindings')).toEqual({ F1: 'ray' });
  });

  it('button/mouse/config_mouse are all recorded', () => {
    const { call } = harness();
    call('set_key', 'F2', 'zoom');
    call('button', 'left', 'none', 'rota');
    call('mouse', 'three_button_viewing');
    call('config_mouse', 'two_button');
    expect(call('get_key_bindings')).toEqual({
      F2: 'zoom',
      'button:left:none': 'rota',
      mouse: 'three_button_viewing',
      config_mouse: 'two_button',
    });
  });

  it('reads named kwargs as well as positional args', () => {
    const { call, callKw } = harness();
    callKw('set_key', [], { key: 'F5', command: 'refresh' });
    expect(call('get_key_bindings')).toEqual({ F5: 'refresh' });
  });
});
