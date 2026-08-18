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

/** Two carbons 5 Å apart with NO bond — each saturates to CH4 under h_add. */
const TWO_C_UNBONDED = [
  'ATOM      1  C1  UNK A   1       0.000   0.000   0.000  1.00  0.00           C',
  'ATOM      2  C2  UNK A   1       5.000   0.000   0.000  1.00  0.00           C',
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

  it('makes atoms clickable (adds lines) when the object shows only cartoon', () => {
    const e = engineWith(ETHANE_CORE);
    const count = (s: string) => e.call('count_atoms', [s]) as number;
    // Show ONLY cartoon — no per-atom pick target for viewport clicks.
    e.call('hide', ['everything', 'm']);
    e.call('show', ['cartoon', 'm']);
    expect(count('rep lines')).toBe(0);
    e.call('builder_show', []);
    // builder_show added a clickable lines rep so picks can land.
    expect(count('rep lines')).toBe(count('m'));
  });

  it('leaves an already-clickable object (sticks) untouched', () => {
    const e = engineWith(ETHANE_CORE);
    const count = (s: string) => e.call('count_atoms', [s]) as number;
    e.call('hide', ['everything', 'm']);
    e.call('show', ['sticks', 'm']);
    e.call('builder_show', []);
    expect(count('rep lines')).toBe(0); // sticks are already pickable; no lines added
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

  it('createBond trims the excess hydrogens the new bond frees (h_fill)', () => {
    const e = engineWith(TWO_C_UNBONDED);
    const count = (s: string) => e.call('count_atoms', [s]) as number;
    // Saturate both isolated carbons to CH4 (4 H each = 8 H).
    e.call('h_add', ['all']);
    expect(count('elem H')).toBe(8);
    // Pick both carbons and bond them: h_fill then trims pk1 (C1) from 4 H to 3.
    e.call('builder_pick', ['m', 1, null, 'multi']);
    e.call('builder_pick', ['m', 2, null, 'multi']);
    const reply = e.call('builder_action', ['createBond'], {}) as unknown as { error?: unknown };
    expect(reply.error).toBeNull();
    // Without the h_fill the count would stay 8 (both carbons left over-valent).
    expect(count('elem H')).toBe(7);
  });

  it('removeAtom refills the hydrogens freed on the surviving neighbour (h_add)', () => {
    // Two bonded carbons, no hydrogens. Remove C1; C2 is freed and must be
    // re-hydrogenated (builder.py:1782-1801 h_add on the neighbour set).
    const e = engineWith(ETHANE_CORE);
    const count = (s: string) => e.call('count_atoms', [s]) as number;
    expect(count('elem H')).toBe(0);
    e.call('builder_pick', ['m', 1, null, 'single']); // pk1 = C1
    const reply = e.call('builder_action', ['removeAtom'], {}) as unknown as { error?: unknown };
    expect(reply.error).toBeNull();
    // C1 gone; C2 (now isolated) refilled to a full valence of hydrogens.
    expect(count('elem C')).toBe(1);
    expect(count('elem H')).toBe(4);
  });

  it('createBond bonds the heavy neighbours when two hydrogens are picked', () => {
    // Two methane-ish carbons (each 1 H), far apart. Picking one H on each and
    // pressing Create bond must join the CARBONS, not make an H–H bond
    // (builder.py:1186-1198). Fixture: C1-H1, C2-H2, carbons 5 Å apart.
    const pdb = [
      'ATOM      1  C1  UNK A   1       0.000   0.000   0.000  1.00  0.00           C',
      'ATOM      2  H1  UNK A   1       0.600   0.600   0.600  1.00  0.00           H',
      'ATOM      3  C2  UNK A   1       5.000   0.000   0.000  1.00  0.00           C',
      'ATOM      4  H2  UNK A   1       4.400   0.600   0.600  1.00  0.00           H',
      'CONECT    1    2',
      'CONECT    3    4',
      'END',
    ].join('\n');
    const e = engineWith(pdb);
    type Mol = { bonds: Array<[number, number]>; atoms: Array<{ elem: string }> };
    const mol = () =>
      (e as unknown as { executive: { molecule(n: string): Mol } }).executive.molecule('m');
    const bonded = (e1: string, e2: string): boolean => {
      const m = mol();
      return m.bonds.some(([a, b]) => {
        const ea = m.atoms[a]!.elem;
        const eb = m.atoms[b]!.elem;
        return (ea === e1 && eb === e2) || (ea === e2 && eb === e1);
      });
    };
    // Pick H1 (index 3) and H2 (index 4). NOTE: the loader applies PyMOL's
    // `pdb_standard_order` (default on), which reorders the atoms into standard
    // order — heavies first — so the on-disk order C1,H1,C2,H2 becomes
    // C1(1),C2(2),H1(3),H2(4). Verified against the real-PyMOL oracle:
    // `index 2` is a carbon, not H1. The two hydrogens are therefore at 3 and 4.
    e.call('builder_pick', ['m', 3, null, 'multi']);
    e.call('builder_pick', ['m', 4, null, 'multi']);
    const reply = e.call('builder_action', ['createBond'], {}) as unknown as { error?: unknown };
    expect(reply.error).toBeNull();
    expect(bonded('C', 'C')).toBe(true); // carbons joined
    expect(bonded('H', 'H')).toBe(false); // never an H–H bond
  });

  it('removeAtom deletes a lone picked hydrogen instead of re-adding it', () => {
    // C with one H; pick the H and remove it. The refill only seeds from HEAVY
    // picks (builder.py filters `and not hydro`), so removing the H must NOT
    // immediately h_add it back.
    const pdb = [
      'ATOM      1  C1  UNK A   1       0.000   0.000   0.000  1.00  0.00           C',
      'ATOM      2  H1  UNK A   1       1.000   0.000   0.000  1.00  0.00           H',
      'CONECT    1    2',
      'END',
    ].join('\n');
    const e = engineWith(pdb);
    const count = (s: string) => e.call('count_atoms', [s]) as number;
    expect(count('elem H')).toBe(1);
    e.call('builder_pick', ['m', 2, null, 'single']); // pk1 = the hydrogen
    const reply = e.call('builder_action', ['removeAtom'], {}) as unknown as { error?: unknown };
    expect(reply.error).toBeNull();
    expect(count('elem H')).toBe(0); // gone, not refilled
  });

  it('attachNA extends the PICKED object, not a stray "obj"', () => {
    const e = engineWith(ETHANE_CORE);
    const count = (s: string) => e.call('count_atoms', [s]) as number;
    const before = count('m');
    e.call('builder_pick', ['m', 1, null, 'single']); // pk1 on object m
    const reply = e.call('builder_action', ['attachNA'], {
      base: 'A',
      nucType: 'DNA',
    }) as unknown as { error?: unknown };
    expect(reply.error).toBeNull();
    // The base was added to m (the picked object), and no stray 'obj' appeared.
    expect(count('m')).toBeGreaterThan(before);
    expect(e.call('get_names', ['objects'])).not.toContain('obj');
  });

  it('reports the incentive-only reason for clean without throwing', () => {
    const e = engineWith(ETHANE_CORE);
    const reply = e.call('builder_action', ['clean'], {}) as unknown as { value?: unknown; error?: unknown };
    expect(reply.error).toBeNull();
    expect(String(reply.value)).toContain('IncentiveOnlyException');
  });

  it('arms the tool (as a wizard) when the required pick is absent', () => {
    const e = engineWith(ETHANE_CORE);
    const reply = e.call('builder_action', ['createBond'], {}) as unknown as BuilderState & {
      error?: unknown;
    };
    // Nothing picked → arm a BondWizard whose prompt the panel shows.
    expect(reply.error).toBeNull();
    expect(reply.wizard?.name).toBe('BondWizard');
    expect(reply.wizard?.prompt.join(' ')).toMatch(/pick/i);
  });

  it('rejects an unknown action kind', () => {
    const e = engineWith(ETHANE_CORE);
    const reply = e.call('builder_action', ['nope'], {}) as unknown as { error?: string };
    expect(reply.error).toContain("unknown builder action 'nope'");
  });
});

/* ----------------------------- arm-then-pick ----------------------------- */

describe('arm-then-pick (wizard-less click-to-place)', () => {
  it('arms Add H, then applies it on the next pick', () => {
    const e = engineWith(ETHANE_CORE);
    const count = (s: string) => e.call('count_atoms', [s]) as number;
    // Press Add H with nothing picked -> arms a HydrogenWizard.
    const armed = e.call('builder_action', ['addH'], {}) as unknown as BuilderState;
    expect(armed.wizard?.name).toBe('HydrogenWizard');
    expect(count('elem H')).toBe(0);
    // The next pick completes it: hydrogens appear and the tool disarms.
    const after = e.call('builder_pick', ['m', 1, null, 'multi']) as unknown as BuilderState;
    expect(after.wizard).toBeNull();
    expect(count('elem H')).toBeGreaterThan(0);
  });

  it('arms Create bond, then bonds the two atoms picked across two clicks', () => {
    const e = engineWith(TWO_C_UNBONDED);
    type Mol = { bonds: Array<[number, number]>; atoms: Array<{ elem: string }> };
    const mol = () =>
      (e as unknown as { executive: { molecule(n: string): Mol } }).executive.molecule('m');
    const carbonsBonded = (): boolean => {
      const m = mol();
      const cs = m.atoms.map((a, i) => (a.elem === 'C' ? i : -1)).filter((i) => i >= 0);
      return m.bonds.some(([a, b]) => cs.includes(a) && cs.includes(b));
    };
    expect(carbonsBonded()).toBe(false);
    e.call('builder_action', ['createBond'], {}); // arm BondWizard
    e.call('builder_pick', ['m', 1, null, 'multi']); // pk1 — still armed
    expect((state(e).wizard as unknown) !== null).toBe(true);
    const done = e.call('builder_pick', ['m', 2, null, 'multi']) as unknown as BuilderState; // pk2 — applies
    expect(done.wizard).toBeNull();
    expect(carbonsBonded()).toBe(true); // the C–C bond now exists
  });

  it('cancels an armed tool when the same button is pressed again', () => {
    const e = engineWith(ETHANE_CORE);
    const armed = e.call('builder_action', ['addH'], {}) as unknown as BuilderState;
    expect(armed.wizard?.name).toBe('HydrogenWizard');
    const cancelled = e.call('builder_action', ['addH'], {}) as unknown as BuilderState;
    expect(cancelled.wizard).toBeNull();
  });

  it('disarms on builder_dismiss', () => {
    const e = engineWith(ETHANE_CORE);
    e.call('builder_action', ['removeAtom'], {});
    expect(state(e).wizard).not.toBeNull();
    e.call('builder_dismiss', []);
    expect(state(e).wizard).toBeNull();
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
