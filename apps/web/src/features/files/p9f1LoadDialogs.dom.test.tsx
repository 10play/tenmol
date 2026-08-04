/**
 * Inventory rows 256 / 257 / 258 — the import dialogs' remaining half.
 *
 * The bridge halves are measured on the live engine in
 * `packages/bridge/tests/test_p8_a6.py` (the header parse, the Incentive walls, the
 * brix load) and `packages/bridge/tests/test_p9_f1.py` (the FASTA fallback, the brix
 * script). What NEITHER can see is the FORM: whether the combo boxes really
 * carry the columns the header produced, whether the weights combo has the
 * blank first entry `file_dialogs.py:161` inserts, and whether the two
 * Incentive-only dialogs disable their own OK button instead of letting a
 * user press it and collect an exception.
 *
 * Every fixture below is a MEASURED payload, copied from the assertions in
 * `test_p8_a6.py::TestMtzImportDialog` / `TestMaeImportDialog` against
 * `packages/engine/testing/data/4rwb.mtz` and `packages/engine/testing/data/1molecule.mae`.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MaeDialog, MtzDialog } from './LoadDialogs';
import { mapCommand } from './commands';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function selects(): HTMLSelectElement[] {
  return [...container.querySelectorAll('select')];
}

function optionsOf(index: number): string[] {
  const select = selects()[index];
  if (!select) throw new Error(`no select #${index}`);
  return [...select.options].map((o) => o.value);
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!found) throw new Error(`no button ${label}`);
  return found as HTMLButtonElement;
}

/* ------------------------------------------------------------------ *
 * Row 258 — the MTZ dialog's four combos
 * ------------------------------------------------------------------ */

/** `files.mtz_dialog_info(packages/engine/testing/data/4rwb.mtz)`, measured. */
const MTZ_INFO = {
  unavailable: 'load_mtz is Incentive-only in this build',
  amplitudes: ['cryst_1/data_1/FP', 'cryst_1/data_1/FC'],
  phases: ['cryst_1/data_1/PHIC'],
  weights: ['cryst_1/data_1/FOM', 'cryst_1/data_1/SIGFP'],
  resoMin: 19.387577056884766,
  resoMax: 2.000370979309082,
  guessAmplitudes: null,
  guessPhases: null,
  prefix: '4rwb',
  error: null,
};

describe('row 258 — load_mtz dialog', () => {
  it('fills three combos from three column types, and only weights has a blank', () => {
    act(() =>
      root.render(
        <MtzDialog filename="/d/4rwb.mtz" info={MTZ_INFO} onRun={vi.fn()} onClose={vi.fn()} />,
      ),
    );

    // amplitudes (F+G), phases (P), weights (W+Q). The blank first entry is
    // `form.input_weights.addItem("")` (`file_dialogs.py:161`) and it is what
    // makes "no weights" expressible — the other two combos must NOT have one.
    expect(optionsOf(0)).toEqual(MTZ_INFO.amplitudes);
    expect(optionsOf(1)).toEqual(MTZ_INFO.phases);
    expect(optionsOf(2)).toEqual(['', ...MTZ_INFO.weights]);
    expect(selects()[2]?.value).toBe('');
  });

  it('opens on the first column when guessCols found nothing — measured for 4rwb', () => {
    const run = vi.fn();
    act(() =>
      root.render(
        <MtzDialog filename="/d/4rwb.mtz" info={MTZ_INFO} onRun={run} onClose={vi.fn()} />,
      ),
    );
    expect(selects()[0]?.value).toBe('cryst_1/data_1/FP');
    expect(selects()[1]?.value).toBe('cryst_1/data_1/PHIC');

    // The prefix and both resolution spinboxes come from the header.
    const inputs = [...container.querySelectorAll('input')];
    expect((inputs[0] as HTMLInputElement).value).toBe('4rwb');
    expect(Number((inputs[1] as HTMLInputElement).value)).toBeCloseTo(19.38758, 4);
    expect(Number((inputs[2] as HTMLInputElement).value)).toBeCloseTo(2.00037, 4);
  });

  it('prefers the guess when the header has one', () => {
    act(() =>
      root.render(
        <MtzDialog
          filename="/d/x.mtz"
          info={{ ...MTZ_INFO, guessAmplitudes: 'cryst_1/data_1/FC' }}
          onRun={vi.fn()}
          onClose={vi.fn()}
        />,
      ),
    );
    expect(selects()[0]?.value).toBe('cryst_1/data_1/FC');
  });

  it('cannot be submitted in this build, and says why', () => {
    const run = vi.fn();
    act(() =>
      root.render(
        <MtzDialog filename="/d/4rwb.mtz" info={MTZ_INFO} onRun={run} onClose={vi.fn()} />,
      ),
    );
    expect(container.textContent).toContain('load_mtz is Incentive-only in this build');
    expect(button('Load').disabled).toBe(true);
    act(() => button('Load').click());
    expect(run).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * Row 256 — the Maestro dialog
 * ------------------------------------------------------------------ */

/** `files.mae_dialog_info(packages/engine/testing/data/1molecule.mae)`, measured. */
const MAE_INFO = {
  objectName: '1molecule',
  objectProps: '*',
  atomProps: '*',
  choices: [
    { label: 'automatic handling', multiplex: -2, discrete: -1 },
    { label: 'load as multiple objects', multiplex: 0, discrete: 0 },
    { label: 'as one multi-state object (discrete states)', multiplex: 0, discrete: 1 },
    { label: 'as one multi-state object', multiplex: 1, discrete: -1 },
  ],
  unavailable: "'mae' format not supported by this PyMOL build",
};

describe('row 256 — load_mae dialog', () => {
  it('previews the exact command and rewrites it as the entry changes', () => {
    act(() =>
      root.render(
        <MaeDialog filename="/d/1molecule.mae" info={MAE_INFO} onRun={vi.fn()} onClose={vi.fn()} />,
      ),
    );

    const preview = () => container.querySelector('.fdlg__preview-body')?.textContent ?? '';
    // (-2,-1) — "automatic handling" — emits NEITHER keyword (`:313-317`).
    expect(preview()).toBe(
      'load \\\n    /d/1molecule.mae, \\\n    mimic=1, \\\n    object_props=*, \\\n    atom_props=*',
    );

    const select = selects()[0] as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(
      MAE_INFO.choices.map((c) => c.label),
    );
    act(() => {
      select.value = '2';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // (0,1) — both keywords, discrete first.
    expect(preview()).toContain('discrete=1');
    expect(preview()).toContain('multiplex=0');
  });

  it('is disabled with the build reason, so the raise is never reached', () => {
    const run = vi.fn();
    act(() =>
      root.render(
        <MaeDialog filename="/d/1molecule.mae" info={MAE_INFO} onRun={run} onClose={vi.fn()} />,
      ),
    );
    expect(container.textContent).toContain("'mae' format not supported by this PyMOL build");
    expect(button('Load').disabled).toBe(true);
    act(() => button('Load').click());
    expect(run).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * Row 257 — the brix branch of the map dialog's generated script
 * ------------------------------------------------------------------ */

describe('row 257 — the o/brix script', () => {
  const BRIX = '/d/emd_1155.brix';

  it('is the ccp4 script with the other normalize setting', () => {
    const options = {
      filename: BRIX,
      normalize: true,
      objectName: 'p9f1brix',
      defaultName: 'emd_1155',
      selection: '',
      buffer: 2,
      carve: false,
      level: 1,
      volume: true,
      volumeName: '',
      isomesh: true,
      isomeshName: '',
      isosurface: true,
      isosurfaceName: '',
    };
    // THE SAME BYTES `packages/bridge/tests/test_p9_f1.py::brix_script` feeds to the
    // engine, which is what makes that test a test of this string rather than
    // of a hand-written one.
    expect(mapCommand({ ...options, normalizeSetting: 'normalize_o_maps' })).toBe(
      'set normalize_o_maps, 1\n' +
        `load ${BRIX}, \\\n    p9f1brix\n` +
        'volume p9f1brix_volume, p9f1brix, 1.0 blue .5 2.0 yellow 0\n' +
        'isomesh p9f1brix_isomesh, p9f1brix, 1.0\n' +
        'isosurface p9f1brix_isosurface, p9f1brix, 1.0',
    );
    // Only the first line differs between the two branches.
    const o = mapCommand({ ...options, normalizeSetting: 'normalize_o_maps' }).split('\n');
    const ccp4 = mapCommand({ ...options, normalizeSetting: 'normalize_ccp4_maps' }).split('\n');
    expect(o.slice(1)).toEqual(ccp4.slice(1));
    expect([o[0], ccp4[0]]).toEqual(['set normalize_o_maps, 1', 'set normalize_ccp4_maps, 1']);
  });

  it('appends the selection, buffer and carve suffix to every rep line', () => {
    const command = mapCommand({
      filename: BRIX,
      normalizeSetting: 'normalize_o_maps',
      normalize: false,
      objectName: '',
      defaultName: 'emd_1155',
      selection: 'p9f1sele',
      buffer: 2,
      carve: true,
      level: 1,
      volume: false,
      volumeName: '',
      isomesh: true,
      isomeshName: 'p9f1carve_isomesh',
      isosurface: false,
      isosurfaceName: '',
    });
    expect(command).toBe(
      'set normalize_o_maps, 0\n' +
        `load ${BRIX}\n` +
        'isomesh p9f1carve_isomesh, emd_1155, 1.0, p9f1sele, 2.0, carve=2.0',
    );
  });
});
