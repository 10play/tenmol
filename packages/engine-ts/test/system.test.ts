import { describe, it, expect } from 'vitest';
import { Executive } from '../src/exec/executive';
import { parsePdb } from '../src/model/pdb';
import { registerSystem } from '../src/cmd/system';
import type { CommandHandler } from '../src/cmd/registrar';

/* ------------------------------------------------------------------------ */
/* A single carbon atom in three MODELs -> a 3-state object. States are the   */
/* fallback frame ceiling when no movie is defined.                           */
/* ------------------------------------------------------------------------ */
const PDB3 = [
  'MODEL        1',
  'ATOM      1  C   ALA A   1       0.000   0.000   0.000  1.00  0.00           C',
  'ENDMDL',
  'MODEL        2',
  'ATOM      1  C   ALA A   1       1.000   0.000   0.000  1.00  0.00           C',
  'ENDMDL',
  'MODEL        3',
  'ATOM      1  C   ALA A   1       2.000   0.000   0.000  1.00  0.00           C',
  'ENDMDL',
  '',
].join('\n');

interface Harness {
  ex: Executive;
  call: (name: string, ...args: unknown[]) => unknown;
  publishCount: () => number;
  emitViewCount: () => number;
}

function harness(pdb = PDB3): Harness {
  const ex = new Executive();
  ex.addMolecule(parsePdb(pdb, 'm'));
  const handlers = new Map<string, CommandHandler>();
  let publishes = 0;
  let emits = 0;
  const ctx = {
    command: (n: string, f: CommandHandler) => void handlers.set(n, f),
    executive: ex,
    publish() {
      publishes++;
    },
    emitView() {
      emits++;
    },
    str: (v: unknown, d = '') => (v == null ? d : String(v)),
  };
  registerSystem(ctx);
  return {
    ex,
    call: (name, ...args) => {
      const h = handlers.get(name);
      if (!h) throw new Error(`no handler '${name}'`);
      return h(args, {});
    },
    publishCount: () => publishes,
    emitViewCount: () => emits,
  };
}

describe('system: reinitialize', () => {
  it('empties objects and selections and returns null', () => {
    const { ex, call } = harness();
    ex.select('sel1', 'all');
    expect(ex.getNames('all').length).toBeGreaterThan(0);
    expect(call('reinitialize')).toBeNull();
    expect(ex.getNames('all')).toEqual([]);
    expect(ex.moleculesInOrder()).toEqual([]);
  });

  it('resets the camera view to the default', () => {
    const { ex, call } = harness();
    ex.view.set([2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, -99, 0, 0, 0, 1, 2, -5]);
    call('reinitialize');
    expect(ex.view.get()).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -50, 0, 0, 0, 40, 100, -20]);
  });

  it('clears a previously-defined movie', () => {
    const { call } = harness();
    expect(call('mset', '1 x10')).toBe(10);
    call('reinitialize');
    // After reinit the movie is empty: mclear-independent proof via mappend total.
    expect(call('mappend', '1 1')).toBe(2);
  });
});

describe('system: virtual/no-op OS shims', () => {
  it('pwd returns root and ls returns empty without touching the fs', () => {
    const { call } = harness();
    expect(call('pwd')).toBe('/');
    expect(call('ls')).toEqual([]);
    expect(call('dir')).toEqual([]);
  });

  it('cd/mem/sync/splash/help/api are inert nulls', () => {
    const { call } = harness();
    for (const cmd of ['cd', 'mem', 'sync', 'splash', 'help', 'api']) {
      expect(call(cmd)).toBeNull();
    }
  });

  it('undo/redo/update are inert nulls', () => {
    const { call } = harness();
    expect(call('undo')).toBeNull();
    expect(call('redo')).toBeNull();
    expect(call('update')).toBeNull();
  });
});

describe('system: mset frame-spec parsing', () => {
  it('x-repeat: "1 x30" is thirty frames of state 1', () => {
    const { call } = harness();
    expect(call('mset', '1 x30')).toBe(30);
  });

  it('range: "1 -10" is states 1..10 (ten frames)', () => {
    const { call } = harness();
    expect(call('mset', '1 -10')).toBe(10);
  });

  it('descending range: "15 -1" is fifteen frames', () => {
    const { call } = harness();
    expect(call('mset', '15 -1')).toBe(15);
  });

  it('plain list: "1 3 5" is three frames', () => {
    const { call } = harness();
    expect(call('mset', '1 3 5')).toBe(3);
  });

  it('empty spec yields zero frames', () => {
    const { call } = harness();
    expect(call('mset', '')).toBe(0);
  });

  it('madd/mappend extend the current movie', () => {
    const { call } = harness();
    expect(call('mset', '1 x2')).toBe(2);
    expect(call('madd', '2 x3')).toBe(5);
    expect(call('mappend', '3')).toBe(6);
  });

  it('mclear empties the movie', () => {
    const { call } = harness();
    call('mset', '1 x5');
    expect(call('mclear')).toBeNull();
    expect(call('mappend', '1')).toBe(1);
  });
});

describe('system: frame navigation', () => {
  it('frame/forward/backward/rewind clamp to the movie length', () => {
    const { call } = harness();
    call('mset', '1 x5'); // 5 frames
    expect(call('frame', 3)).toBe(3);
    expect(call('forward')).toBe(4);
    expect(call('forward')).toBe(5);
    expect(call('forward')).toBe(5); // clamped at the top
    expect(call('backward')).toBe(4);
    expect(call('rewind')).toBe(1);
    expect(call('backward')).toBe(1); // clamped at the bottom
    expect(call('frame', 99)).toBe(5); // clamp high
    expect(call('frame', 0)).toBe(1); // clamp low
  });

  it('with no movie, the ceiling is the object state count', () => {
    const { call } = harness(); // 3-state object, no movie
    expect(call('frame', 99)).toBe(3);
    expect(call('frame', 2)).toBe(2);
  });

  it('rewind stops playback', () => {
    const { call } = harness();
    call('mplay');
    expect(call('rewind')).toBe(1);
    // toggling now starts (was reset to stopped by rewind)
    expect(call('mtoggle')).toBe(1);
  });
});

describe('system: movie play flag', () => {
  it('mplay/mstop/mtoggle report the resulting flag', () => {
    const { call } = harness();
    expect(call('mplay')).toBe(1);
    expect(call('mstop')).toBe(0);
    expect(call('mtoggle')).toBe(1);
    expect(call('mtoggle')).toBe(0);
  });
});

describe('system: side effects', () => {
  it('geometry-changing commands publish; camera-only navigation emits view', () => {
    const h = harness();
    h.call('mset', '1 x5'); // publish
    const pubAfterMset = h.publishCount();
    expect(pubAfterMset).toBeGreaterThan(0);
    h.call('frame', 2); // camera-only -> emitView, no extra publish
    expect(h.emitViewCount()).toBeGreaterThan(0);
    expect(h.publishCount()).toBe(pubAfterMset);
  });
});
