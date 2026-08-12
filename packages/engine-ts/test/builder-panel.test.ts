/**
 * The Builder PANEL surface (`cmd.builder_*`) on the local TypeScript engine.
 *
 * These lock the shapes the web `<BuilderPanel/>` bootstrap/poll depend on
 * (`builder_show`/`builder_state`/`builder_tables`) — the calls that used to
 * reject with `NotPorted: cmd.builder_show` — plus the pick machine and a couple
 * of representative actions driven through the engine's chemistry verbs.
 */

import { describe, expect, it } from 'vitest';
import type { BuilderState, BuilderTables } from '@tenmol/protocol/topics/builder';
import { Engine as RealEngine } from '../src/engine';

/* --------------------------------- fixtures ------------------------------ */

/** Two carbons 1.5 Å apart with a CONECT bond — a minimal editable molecule. */
const ETHANE_CORE = [
  'ATOM      1  C1  UNK A   1       0.000   0.000   0.000  1.00  0.00           C',
  'ATOM      2  C2  UNK A   1       1.500   0.000   0.000  1.00  0.00           C',
  'CONECT    1    2',
  'CONECT    2    1',
  'END',
].join('\n');

function engineWith(pdb: string, name = 'm'): RealEngine {
  const e = new RealEngine();
  e.boot();
  e.call('read_pdbstr', [pdb, name]);
  return e;
}

const state = (e: RealEngine): BuilderState => e.call('builder_state', []) as unknown as BuilderState;

/* --------------------------------- show ---------------------------------- */

describe('builder_show', () => {
  it('no longer rejects, and returns the full state shape', () => {
    const e = engineWith(ETHANE_CORE);
    const s = e.call('builder_show', []) as unknown as BuilderState;
    // The exact keys the panel dereferences.
    expect(Object.keys(s).sort()).toEqual(
      ['clean_available', 'clean_reason', 'editor', 'mouse', 'objects', 'settings', 'undo_is_noop', 'wizard'].sort(),
    );
    expect(s.editor.picked).toEqual([]);
    expect(s.wizard).toBeNull();
    expect(s.clean_available).toBe(false);
    expect(s.objects).toEqual(['m']);
  });

  it('answers the controller path: a silent bootstrap `do`, then a cmd.-prefixed call', () => {
    const e = engineWith(ETHANE_CORE);
    // The Builder controller sends the Python install line as a `{t:'do'}`; the
    // engine treats it as an import bootstrap and stays silent (no feedback).
    e.do("_ __import__('tenmol_bridge.panels.builder', fromlist=['install']).install(cmd)");
    expect(e.drainFeedback()).toEqual([]);
    // The panel then opens via the fully-qualified `cmd.builder_show`.
    const s = e.call('cmd.builder_show', []) as unknown as BuilderState;
    expect(s.mouse.editing).toBe(true);
  });

  it('forces the showEvent settings and turns editing on', () => {
    const e = engineWith(ETHANE_CORE);
    const s = e.call('builder_show', []) as unknown as BuilderState;
    expect(s.settings.editor_auto_measure).toBe(0);
    expect(s.settings.auto_overlay).toBe(1);
    expect(s.settings.valence).toBe(1);
    expect(s.mouse.editing).toBe(true);
  });
});

/* -------------------------------- tables --------------------------------- */

describe('builder_tables', () => {
  it('ships the declarative tables with the fragment inventory', () => {
    const e = engineWith(ETHANE_CORE);
    const t = e.call('builder_tables', []) as unknown as BuilderTables;
    expect(t.elements[0]).toEqual(['H', 'Hydrogen', 'H', 1, 1, 'hydrogen']);
    expect(t.aminoAcidsRow0).toContain('Ala');
    expect(t.bondOrders.length).toBe(4);
    // formamide is listed once even though two rows reference it.
    expect(t.fragments.filter((f) => f === 'formamide').length).toBe(1);
    expect(t.missingFragments).toEqual([]);
  });
});

/* --------------------------------- pick ---------------------------------- */

describe('builder_pick', () => {
  it('fills pk1 then pk2 on successive multi picks', () => {
    const e = engineWith(ETHANE_CORE);
    e.call('builder_show', []);
    e.call('builder_pick', ['m', 1, null, 'multi']);
    let s = state(e);
    expect(s.editor.slots).toEqual(['pk1']);
    expect(s.editor.picked[0]!.name).toBe('C1');

    e.call('builder_pick', ['m', 2, null, 'multi']);
    s = state(e);
    expect(s.editor.slots).toEqual(['pk1', 'pk2']);
    expect(s.editor.active).toBe(true);
  });

  it('un-picks an already-picked atom on re-click', () => {
    const e = engineWith(ETHANE_CORE);
    e.call('builder_pick', ['m', 1, null, 'multi']);
    e.call('builder_pick', ['m', 2, null, 'multi']);
    const reply = e.call('builder_pick', ['m', 1, null, 'multi']) as unknown as BuilderState & {
      unpicked?: boolean;
    };
    expect(reply.unpicked).toBe(true);
    // pk1 removed; pk2's atom renumbers down into pk1.
    expect(reply.editor.slots).toEqual(['pk1']);
    expect(reply.editor.picked[0]!.name).toBe('C2');
  });

  it('marks a bond pick as hasBond', () => {
    const e = engineWith(ETHANE_CORE);
    const reply = e.call('builder_pick', ['m', 1, 2, 'bond']) as unknown as BuilderState & {
      bondFlag?: number;
    };
    expect(reply.bondFlag).toBe(1);
    expect(reply.editor.hasBond).toBe(true);
    expect(reply.editor.slots).toEqual(['pk1', 'pk2']);
  });
});

/* -------------------------------- actions -------------------------------- */

describe('builder_action', () => {
  it('deletes the C1–C2 bond when both atoms are picked', () => {
    const e = engineWith(ETHANE_CORE);
    type Mol = { bonds: Array<[number, number]>; atoms: Array<{ elem: string }> };
    const mol = () => (e as unknown as { executive: { molecule(n: string): Mol } }).executive.molecule('m');
    /** Is there a bond directly joining the two carbons? */
    const carbonsBonded = (): boolean => {
      const m = mol();
      const cs = m.atoms.map((a, i) => (a.elem === 'C' ? i : -1)).filter((i) => i >= 0);
      return m.bonds.some(([a, b]) => cs.includes(a) && cs.includes(b));
    };
    expect(carbonsBonded()).toBe(true);
    e.call('builder_pick', ['m', 1, null, 'multi']);
    e.call('builder_pick', ['m', 2, null, 'multi']);
    const reply = e.call('builder_action', ['deleteBond'], {}) as unknown as BuilderState & {
      kind?: string;
      error?: string | null;
    };
    expect(reply.kind).toBe('deleteBond');
    expect(reply.error).toBeNull();
    // The C–C bond is gone (h_fill then caps the freed valences with hydrogens).
    expect(carbonsBonded()).toBe(false);
    // The picks are cleared after the edit.
    expect(reply.editor.slots).toEqual([]);
  });

  it('reports the incentive-only reason for clean without throwing', () => {
    const e = engineWith(ETHANE_CORE);
    const reply = e.call('builder_action', ['clean'], {}) as unknown as { value?: unknown; error?: unknown };
    expect(reply.error).toBeNull();
    expect(String(reply.value)).toContain('IncentiveOnlyException');
  });

  it('is a no-op (not a crash) when the required pick is absent', () => {
    const e = engineWith(ETHANE_CORE);
    const reply = e.call('builder_action', ['createBond'], {}) as unknown as { error?: unknown };
    // Nothing picked → the Python panel would arm a wizard; here it just refreshes.
    expect(reply.error).toBeNull();
  });

  it('rejects an unknown action kind', () => {
    const e = engineWith(ETHANE_CORE);
    const reply = e.call('builder_action', ['nope'], {}) as unknown as { error?: string };
    expect(reply.error).toContain("unknown builder action 'nope'");
  });
});

/* -------------------------------- dismiss -------------------------------- */

describe('builder_dismiss', () => {
  it('drops the picks', () => {
    const e = engineWith(ETHANE_CORE);
    e.call('builder_pick', ['m', 1, null, 'multi']);
    expect(state(e).editor.slots).toEqual(['pk1']);
    const s = e.call('builder_dismiss', []) as unknown as BuilderState;
    expect(s.editor.slots).toEqual([]);
  });
});
