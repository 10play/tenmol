/**
 * Node-side tests for the Builder's data and transport halves.
 *
 * The interesting assertions here are the ones that read `modules/pmg_qt/
 * builder.py` and `bridge/tenmol_bridge/panels/builder.py` off disk: two
 * hand-maintained copies of a 60-button table WILL drift, and the only test
 * that catches it is one that compares them.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BUILDER_BOOTSTRAP, BUILDER_RPC } from '@tenmol/protocol/topics/builder';
import { createBuilderController, isMissingSymbol, pickHint } from './controller';
import {
  AMINO_ACIDS_ROW0,
  AMINO_ACIDS_ROW1,
  BOND_ORDERS,
  CHEM_ROW0_FRAGMENTS,
  DNA_BASES,
  ELEMENTS,
  FUNCTIONAL_GROUPS,
  RINGS,
  RNA_BASES,
  SECONDARY_STRUCTURE,
  diffTables,
} from './tables';
import type { BuilderState, BuilderTables } from '@tenmol/protocol/topics/builder';

const REPO = join(import.meta.dirname, '../../../../..');
const QT_BUILDER = join(REPO, 'modules/pmg_qt/builder.py');
const BRIDGE_BUILDER = join(REPO, 'bridge/tenmol_bridge/panels/builder.py');

const qtSource = readFileSync(QT_BUILDER, 'utf8');
const bridgeSource = readFileSync(BRIDGE_BUILDER, 'utf8');

/* ------------------------------------------------------------------ tables */

describe('the button tables mirror modules/pmg_qt/builder.py', () => {
  it('has the ten element buttons of Chemical row 0, tooltip typo included', () => {
    expect(ELEMENTS.map((e) => e.label)).toEqual([
      'H', 'C', 'N', 'O', 'P', 'S', 'F', 'Cl', 'Br', 'I',
    ]);
    // builder.py:1082 really says "Chlorrine".
    expect(qtSource).toContain('Chlorrine');
    expect(ELEMENTS.find((e) => e.label === 'Cl')?.tooltip).toBe('Chlorrine');
    // geometry/valence pairs, builder.py:1075-1084
    expect(ELEMENTS.map((e) => [e.symbol, e.geometry, e.valence])).toEqual([
      ['H', 1, 1], ['C', 4, 4], ['N', 4, 3], ['O', 4, 2], ['P', 4, 3],
      ['S', 2, 2], ['F', 1, 1], ['Cl', 1, 1], ['Br', 1, 1], ['I', 1, 1],
    ]);
  });

  it('every fragment button names a fragment the Qt source names', () => {
    const all = [...CHEM_ROW0_FRAGMENTS, ...FUNCTIONAL_GROUPS, ...RINGS];
    expect(all).toHaveLength(23);
    for (const button of all) {
      expect(qtSource, `${button.label} -> ${button.fragment}`).toContain(
        `"${button.fragment}"`,
      );
    }
    // The two amide buttons share `formamide` with different hydrogen/anchor.
    const amides = FUNCTIONAL_GROUPS.filter((f) => f.fragment === 'formamide');
    expect(amides.map((f) => [f.label, f.hydrogen, f.anchor])).toEqual([
      ['C=ON', 5, 0],
      ['NC=O', 3, 1],
    ]);
  });

  it('has 23 residue buttons split 12 / 11', () => {
    expect(AMINO_ACIDS_ROW0).toHaveLength(12);
    expect(AMINO_ACIDS_ROW1).toHaveLength(11);
    expect(new Set([...AMINO_ACIDS_ROW0, ...AMINO_ACIDS_ROW1]).size).toBe(23);
  });

  it('carries the three secondary-structure presets and their dihedrals', () => {
    expect(SECONDARY_STRUCTURE.map((s) => [s.ss, s.phi, s.psi])).toEqual([
      [1, -57.0, -47.0],
      [2, -139.0, 135.0],
      [3, -119.0, 113.0],
    ]);
  });

  it('has four DNA and four RNA bases, with U only in RNA', () => {
    expect(DNA_BASES.map((b) => b.label)).toEqual(['A', 'C', 'T', 'G']);
    expect(RNA_BASES.map((b) => b.label)).toEqual(['A', 'C', 'U', 'G']);
    expect(RNA_BASES.find((b) => b.label === 'U')?.fragment).toBe('utp');
  });

  it('maps the four bond-order glyphs onto editing.py order strings', () => {
    expect(BOND_ORDERS.map((b) => b.order)).toEqual(['1', '2', '3', '4']);
    expect(BOND_ORDERS.map((b) => b.text)).toEqual(['single', 'double', 'triple', 'aromatic']);
  });
});

describe('the client table and the bridge table agree', () => {
  const pythonList = (name: string): string[] => {
    const start = bridgeSource.indexOf(`${name}:`);
    expect(start, `${name} not found in the bridge module`).toBeGreaterThan(-1);
    const open = bridgeSource.indexOf('(', bridgeSource.indexOf('=', start));
    let depth = 0;
    let end = open;
    for (; end < bridgeSource.length; end += 1) {
      if (bridgeSource[end] === '(') depth += 1;
      if (bridgeSource[end] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    return [...bridgeSource.slice(open, end).matchAll(/"([^"]*)"/g)].map((m) => m[1] as string);
  };

  it('names the same fragments on both sides', () => {
    const bridgeStrings = new Set([
      ...pythonList('ELEMENTS'),
      ...pythonList('CHEM_ROW0_FRAGMENTS'),
      ...pythonList('FUNCTIONAL_GROUPS'),
      ...pythonList('RINGS'),
    ]);
    for (const button of [...CHEM_ROW0_FRAGMENTS, ...FUNCTIONAL_GROUPS, ...RINGS]) {
      expect(bridgeStrings.has(button.fragment), button.fragment).toBe(true);
    }
    for (const element of ELEMENTS) {
      expect(bridgeStrings.has(element.symbol), element.symbol).toBe(true);
      expect(bridgeStrings.has(element.tooltip), element.tooltip).toBe(true);
    }
  });

  it('uses the same bootstrap line as the bridge module', () => {
    // The line is executed as Python; a mismatch is an inert Builder.
    expect(bridgeSource).toContain("fromlist=['install']).install(cmd)");
    expect(BUILDER_BOOTSTRAP).toBe(
      "_ __import__('tenmol_bridge.panels.builder', fromlist=['install']).install(cmd)",
    );
  });

  it('names entry points the bridge actually installs', () => {
    for (const symbol of Object.values(BUILDER_RPC)) {
      const leaf = symbol.replace('cmd.', '');
      expect(bridgeSource, leaf).toContain(`"${leaf}"`);
    }
  });
});

describe('diffTables', () => {
  const remote: BuilderTables = {
    elements: ELEMENTS.map((e) => [e.label, e.tooltip, e.symbol, e.geometry, e.valence, e.text]),
    chemRow0Fragments: CHEM_ROW0_FRAGMENTS.map((f) => [
      f.label, f.tooltip, f.fragment, f.hydrogen, f.anchor, f.text,
    ]),
    functionalGroups: FUNCTIONAL_GROUPS.map((f) => [
      f.label, f.tooltip, f.fragment, f.hydrogen, f.anchor, f.text,
    ]),
    rings: RINGS.map((r) => [r.icon, r.tooltip, r.fragment, r.hydrogen, r.anchor, r.text]),
    aminoAcidsRow0: [...AMINO_ACIDS_ROW0],
    aminoAcidsRow1: [...AMINO_ACIDS_ROW1],
    secondaryStructure: SECONDARY_STRUCTURE.map((s) => [s.label, s.ss, s.phi, s.psi]),
    dnaBases: DNA_BASES.map((b) => [b.label, b.tooltip, b.fragment]),
    rnaBases: RNA_BASES.map((b) => [b.label, b.tooltip, b.fragment]),
    bondOrders: BOND_ORDERS.map((b) => [b.glyph, b.order, b.text]),
    settingCheckboxes: [],
    fragments: [],
    missingFragments: [],
  };

  it('is silent when the two copies match', () => {
    expect(diffTables(remote)).toEqual([]);
    expect(diffTables(null)).toEqual([]);
  });

  it('reports a changed fragment and a missing .pkl', () => {
    const drifted: BuilderTables = {
      ...remote,
      rings: remote.rings.map((row, i) => (i === 0 ? [...row.slice(0, 2), 'cyclopropanol', ...row.slice(3)] : row)) as BuilderTables['rings'],
      missingFragments: ['napthylene'],
    };
    const problems = diffTables(drifted);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('rings');
    expect(problems[1]).toContain('napthylene');
  });
});

/* -------------------------------------------------------------- controller */

const emptyState = (over: Partial<BuilderState> = {}): BuilderState => ({
  editor: { picked: [], slots: [], hasBond: false, nFrag: 0, active: false, hasActiveSele: false },
  mouse: { button_mode: 0, mode_name: 'three_button_editing', editing: true },
  wizard: null,
  settings: {
    clean_electro_mode: 1,
    sculpt_vdw_vis_mode: 0,
    suspend_undo: 0,
    valence: 1,
    auto_overlay: 1,
    editor_auto_measure: 0,
    secondary_structure: 2,
    auto_remove_hydrogens: 0,
  },
  clean_available: false,
  clean_reason: 'Incentive-only',
  undo_is_noop: true,
  objects: [],
  ...over,
});

describe('createBuilderController', () => {
  it('bootstraps exactly once and then only makes typed calls', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const call = vi.fn().mockResolvedValue(emptyState());
    const controller = createBuilderController({ call, run });

    await controller.open();
    await controller.refresh();
    await controller.act('fixH');

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(BUILDER_BOOTSTRAP);
    expect(call.mock.calls.map((c) => c[0])).toEqual([
      BUILDER_RPC.show,
      BUILDER_RPC.state,
      BUILDER_RPC.action,
    ]);
    expect(call.mock.calls[2]?.slice(1)).toEqual([['fixH'], {}]);
  });

  it('retries the bootstrap when the symbol vanished with the PyMOL instance', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const call = vi
      .fn()
      .mockRejectedValueOnce(new Error("cmd.builder_state: no such symbol (x)"))
      .mockResolvedValue(emptyState());
    const controller = createBuilderController({ call, run });

    const state = await controller.refresh();
    expect(state.undo_is_noop).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not retry on a real engine error', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const call = vi.fn().mockRejectedValue(new Error('CmdException: Invalid bond.'));
    const controller = createBuilderController({ call, run });
    await expect(controller.refresh()).rejects.toThrow('Invalid bond');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('re-arms the bootstrap when the do frame itself failed', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('socket closed')).mockResolvedValue(undefined);
    const call = vi.fn().mockResolvedValue(emptyState());
    const controller = createBuilderController({ call, run });
    await expect(controller.open()).rejects.toThrow('socket closed');
    await controller.open();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('passes pick arguments positionally, index2 null for atom picks', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const call = vi.fn().mockResolvedValue(emptyState());
    const controller = createBuilderController({ call, run });
    await controller.pick('1ubq', 42, null, 'multi');
    expect(call).toHaveBeenLastCalledWith(BUILDER_RPC.pick, ['1ubq', 42, null, 'multi']);
  });

  it('classifies bridge errors', () => {
    expect(isMissingSymbol(new Error('NotAllowed: no such symbol'))).toBe(true);
    expect(isMissingSymbol(new Error('Error: Invalid bond.'))).toBe(false);
  });
});

describe('pickHint mirrors collectPicked branching', () => {
  const withSlots = (slots: string[]) =>
    emptyState({
      editor: { picked: [], slots, hasBond: false, nFrag: 0, active: true, hasActiveSele: false },
    });

  it('says which wizard a button will arm when the pick set is wrong', () => {
    expect(pickHint(withSlots([]), 'grow')).toContain('AttachWizard');
    expect(pickHint(withSlots([]), 'replace')).toContain('ReplaceWizard');
    expect(pickHint(withSlots(['pk1', 'pk2']), 'attachAA')).toContain('AminoAcidWizard');
    expect(pickHint(withSlots(['pk1']), 'createBond')).toContain('bond wizard');
    expect(pickHint(withSlots(['pk1', 'pk2']), 'invert')).toContain('InvertWizard');
    expect(pickHint(withSlots([]), 'removeAtom')).toContain('RemoveWizard');
  });

  it('says what will happen when the pick set is right', () => {
    expect(pickHint(withSlots(['pk1']), 'grow')).toBe('grow onto pk1');
    expect(pickHint(withSlots(['pk1']), 'attachAA')).toBe('attach to pk1');
    expect(pickHint(withSlots(['pk1', 'pk2']), 'cycleBond')).toBe('pk1 - pk2');
    expect(pickHint(withSlots(['pk1', 'pk2', 'pk3']), 'invert')).toBe('invert around pk1');
    expect(pickHint(withSlots(['pk1']), 'removeResn')).toBe('remove byres(pk1)');
  });
});
