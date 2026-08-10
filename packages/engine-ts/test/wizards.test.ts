import { describe, it, expect } from 'vitest';
import { Executive } from '../src/exec/executive';
import { parsePdb } from '../src/model/pdb';
import { registerWizards } from '../src/cmd/wizards';
import type { CommandHandler } from '../src/cmd/registrar';

/* A trivial molecule; the wizard stack is independent of executive state, but
 * the harness mirrors the isolated shape the other subsystems use. */
const PDB = [
  'ATOM      1  C   ALA A   1       0.000   0.000   0.000  1.00  0.00           C',
  '',
].join('\n');

interface Harness {
  call: (name: string, args?: unknown[], kwargs?: Record<string, unknown>) => unknown;
}

function harness(): Harness {
  const ex = new Executive();
  ex.addMolecule(parsePdb(PDB, 'm'));
  const handlers = new Map<string, CommandHandler>();
  const ctx = {
    command: (n: string, f: CommandHandler) => void handlers.set(n, f),
    executive: ex,
    publish() {},
    emitView() {},
    str: (v: unknown, d = '') => (v == null ? d : String(v)),
  };
  registerWizards(ctx);
  return {
    call: (name, args = [], kwargs = {}) => {
      const h = handlers.get(name);
      if (!h) throw new Error(`no handler '${name}'`);
      return h(args, kwargs);
    },
  };
}

describe('wizards: activation and readout', () => {
  it('wizard(name) pushes and becomes the active wizard', () => {
    const h = harness();
    expect(h.call('get_wizard')).toBeNull();
    expect(h.call('wizard', ['measurement'])).toBe('measurement');
    expect(h.call('get_wizard')).toBe('measurement');
  });

  it('the active prompt is the wizard-kind default; None when empty', () => {
    const h = harness();
    expect(h.call('get_wizard_prompt')).toBeNull();
    h.call('wizard', ['measurement']);
    expect(h.call('get_wizard_prompt')).toEqual([
      'Pick atoms to measure distances, angles, and dihedrals.',
    ]);
    // Unknown kinds get a generic banner.
    h.call('wizard', ['frobnicate']);
    expect(h.call('get_wizard_prompt')).toEqual(['Wizard: frobnicate']);
  });

  it('refresh_wizard is a no-op returning null', () => {
    const h = harness();
    h.call('wizard', ['measurement']);
    expect(h.call('refresh_wizard')).toBeNull();
    // No state change.
    expect(h.call('get_wizard')).toBe('measurement');
  });
});

describe('wizards: stack discipline (LIFO)', () => {
  it('length tracks pushes; top follows push/pop order', () => {
    const h = harness();
    h.call('wizard', ['measurement']);
    h.call('wizard', ['pair_fit']);
    h.call('wizard', ['density']);
    let s = h.call('get_wizard_stack') as Array<{ name: string }>;
    expect(s.map((w) => w.name)).toEqual(['measurement', 'pair_fit', 'density']);
    expect(h.call('get_wizard')).toBe('density');

    // set_wizard(None) pops one -> previous wizard reactivates.
    h.call('set_wizard');
    expect(h.call('get_wizard')).toBe('pair_fit');
    s = h.call('get_wizard_stack') as Array<{ name: string }>;
    expect(s).toHaveLength(2);
  });

  it('set_wizard(None) clears; popping past empty leaves None', () => {
    const h = harness();
    h.call('wizard', ['measurement']);
    h.call('set_wizard');
    expect(h.call('get_wizard')).toBeNull();
    // Popping the empty stack is a no-op.
    h.call('set_wizard');
    expect(h.call('get_wizard')).toBeNull();
    expect(h.call('get_wizard_stack')).toEqual([]);
  });

  it('set_wizard pushes by default and replaces the top with replace=1', () => {
    const h = harness();
    h.call('set_wizard', ['measurement']);
    h.call('set_wizard', ['pair_fit']);
    expect((h.call('get_wizard_stack') as unknown[]).length).toBe(2);

    // replace via kwarg swaps the top in place (no growth).
    h.call('set_wizard', ['density'], { replace: 1 });
    const s = h.call('get_wizard_stack') as Array<{ name: string }>;
    expect(s.map((w) => w.name)).toEqual(['measurement', 'density']);
  });
});

describe('wizards: replace', () => {
  it('replace_wizard swaps the top only when the outgoing kind matches', () => {
    const h = harness();
    h.call('wizard', ['measurement']);
    expect(h.call('replace_wizard', ['measurement', 'pair_fit'])).toBe('pair_fit');
    expect(h.call('get_wizard')).toBe('pair_fit');
    // Stack length unchanged by a replace.
    expect((h.call('get_wizard_stack') as unknown[]).length).toBe(1);

    // Mismatched old-name is a no-op.
    expect(h.call('replace_wizard', ['measurement', 'density'])).toBe('pair_fit');
    expect(h.call('get_wizard')).toBe('pair_fit');
  });
});

describe('wizards: whole-stack set/get', () => {
  it('set_wizard_stack accepts names and records; get returns them bottom-to-top', () => {
    const h = harness();
    h.call('set_wizard_stack', [['measurement', { name: 'label', state: { picked: 2 } }]]);
    const s = h.call('get_wizard_stack') as Array<{ name: string; state: Record<string, unknown> }>;
    expect(s.map((w) => w.name)).toEqual(['measurement', 'label']);
    expect(s[1]?.state).toEqual({ picked: 2 });
    expect(h.call('get_wizard')).toBe('label');

    // Returned stack is a copy: mutating it does not corrupt internal state.
    s.pop();
    expect((h.call('get_wizard_stack') as unknown[]).length).toBe(2);

    // An empty stack clears the active wizard.
    h.call('set_wizard_stack', [[]]);
    expect(h.call('get_wizard')).toBeNull();
  });
});
