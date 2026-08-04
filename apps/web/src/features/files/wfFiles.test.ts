/**
 * Parity area 6, wave 6 — the client half of inventory rows 259/293/295/298.
 *
 * The bridge half is `packages/bridge/tests/test_wf_files.py`, which runs everything
 * asserted here against a live PyMOL over the real socket. These are the pure
 * decisions the browser makes on its own:
 *
 *  * 298 — a `.pwg` must be turned away BEFORE `cmd.load` sees it, on every
 *    route into the loader (the panel's Open queue and the window-level drop).
 *  * 295 — a blocked plugin's `tkFileDialog` request becomes a path picker and
 *    the picker's result becomes the value the shim returns, in the exact
 *    shapes `mimic_tk.py:50-89` produces.
 *  * 259 / 293 — the RPC argument order, because both calls are positional and
 *    a silent transposition (amplitudes/phases, min/max) would produce a wrong
 *    map rather than an error.
 */

import { describe, expect, it, vi } from 'vitest';
import type {
  FileClassification,
  PluginDialogRequest,
} from '@tenmol/protocol/topics/files';
import { dialogNeededFor, refusalFor } from './globalDrop';
import {
  answerForPluginDialog,
  pickerForPluginDialog,
  pluginDialogMessage,
} from './pluginDialogs';
import { createFilesApi } from './filesApi';

const CLASSIFICATION: FileClassification = {
  filename: '/tmp/x.pdb',
  prefix: 'x',
  ext: 'pdb',
  format: 'pdb',
  zipped: '',
  isUrl: false,
  objectName: 'x',
  dialog: 'plain',
  mapType: null,
  alnFormat: null,
  cmsTraj: null,
  unavailable: null,
  refused: null,
};

/* ------------------------------------------------------------------ 298 */

describe('.pwg is refused before it can reach cmd.load (row 298)', () => {
  const pwg: FileClassification = {
    ...CLASSIFICATION,
    filename: '/tmp/app.pwg',
    ext: 'pwg',
    format: 'pwg',
    refused: "'.pwg' is refused by the web client. …",
  };

  it('refuses on `refused`, which is not the same field as `unavailable`', () => {
    const message = refusalFor(pwg, 'app.pwg');
    expect(message).not.toBeNull();
    expect(message).toContain('app.pwg was not loaded');
    expect(message).toContain('refused by the web client');
  });

  it('still refuses `unavailable` formats, which the drop path never checked', () => {
    // A `.stl` classifies as `plain` and used to fall straight through to
    // `cmd.load`, which raises IncentiveOnlyException into the console.
    expect(
      refusalFor({ ...CLASSIFICATION, unavailable: 'stl is Incentive-only' }, 'a.stl'),
    ).toBe(' a.stl: stl is Incentive-only');
  });

  it('lets an ordinary structure through', () => {
    expect(refusalFor(CLASSIFICATION, 'x.pdb')).toBeNull();
  });

  it('is the only gate a .pwg hits: dialogNeededFor says `plain`', () => {
    // The dialog router would happily let it pass, which is precisely why the
    // refusal has to be a separate, earlier check.
    expect(dialogNeededFor(pwg)).toBeNull();
  });
});

/* ------------------------------------------------------------------ 295 */

function request(
  kind: PluginDialogRequest['kind'] = 'askopenfilename',
  options: Partial<PluginDialogRequest['options']> = {},
): PluginDialogRequest {
  return {
    dialogId: 7,
    kind,
    options: {
      title: '',
      initialdir: '',
      initialfile: '',
      filter: '',
      filters: [],
      multiple: false,
      ...options,
    },
    waitingFor: 0.5,
  };
}

describe('blocking plugin file dialogs (row 295)', () => {
  it('maps each tkFileDialog entry point to the right picker mode', () => {
    expect(pickerForPluginDialog(request('askopenfilename')).mode).toBe('open');
    expect(pickerForPluginDialog(request('askopenfilenames')).mode).toBe('open');
    expect(pickerForPluginDialog(request('asksaveasfilename')).mode).toBe('save');
    // `askdirectory` is QFileDialog.getExistingDirectory (`mimic_tk.py:86-89`).
    expect(pickerForPluginDialog(request('askdirectory')).mode).toBe('dir');
  });

  it('carries the plugin title, start directory and Qt filter list through', () => {
    const picker = pickerForPluginDialog(
      request('askopenfilename', {
        title: 'Choose a topology',
        initialdir: '/data',
        initialfile: 'out.pdb',
        filter: 'PDB (*.pdb *.ent);;All (*)',
        filters: ['PDB (*.pdb *.ent)', 'All (*)'],
      }),
    );
    expect(picker.title).toBe('Plugin: Choose a topology');
    expect(picker.directory).toBe('/data');
    expect(picker.initialName).toBe('out.pdb');
    expect(picker.filters).toEqual(['PDB (*.pdb *.ent)', 'All (*)']);
  });

  it('titles an untitled dialog rather than showing a blank modal', () => {
    // `mimic_tk` hands Qt `options.get('title','')`; a nameless modal in a
    // browser is a mystery, so tkinter's own defaults are used instead.
    expect(pickerForPluginDialog(request('asksaveasfilename')).title).toBe(
      'Plugin: Save As',
    );
    expect(pickerForPluginDialog(request('askdirectory')).title).toBe(
      'Plugin: Choose a directory',
    );
  });

  it('answers a single-selection dialog with a bare string', () => {
    expect(answerForPluginDialog(request(), ['/tmp/a.pdb'])).toBe('/tmp/a.pdb');
  });

  it('answers a multiple dialog with a LIST even for one file', () => {
    // `askopenfile(multiple=1)` does `[open(f, mode) for f in r]`
    // (`mimic_tk.py:62-63`): a bare string would be iterated character by
    // character and the plugin would try to open "/" as a file.
    const many = request('askopenfilenames', { multiple: true });
    expect(answerForPluginDialog(many, ['/tmp/a.pdb'])).toEqual(['/tmp/a.pdb']);
    expect(answerForPluginDialog(many, ['/a', '/b'])).toEqual(['/a', '/b']);
  });

  it('turns Cancel and an empty selection into null, which the shim maps to ""', () => {
    expect(answerForPluginDialog(request(), null)).toBeNull();
    expect(answerForPluginDialog(request(), [])).toBeNull();
  });

  it('names the plugin request in the console', () => {
    expect(pluginDialogMessage(request('askopenfilename', { title: 'Pick' }))).toContain(
      'dialog #7',
    );
  });

  it('sends the answer as a two-argument positional call', async () => {
    const call = vi.fn().mockResolvedValue({ answered: true, error: null });
    const api = createFilesApi({ call, do: vi.fn() });
    await api.dialogAnswer(3, ['/a', '/b']);
    expect(call).toHaveBeenCalledWith('cmd.tenmol_files.dialog_answer', [3, ['/a', '/b']], {});
    await api.dialogCancel(3);
    expect(call).toHaveBeenLastCalledWith('cmd.tenmol_files.dialog_cancel', [3], {});
  });
});

/* ------------------------------------------------------------ 259 / 293 */

describe('map generation and the Finder open-with preset (rows 259, 293)', () => {
  it('passes map_generate_run its eight positional arguments in order', async () => {
    // `cmd.map_generate(name, file, amplitudes, phases, weights, low, high)` is
    // all positional and all strings/floats: swapping amplitudes and phases
    // produces a wrong map, not an error, so the order is pinned.
    const call = vi.fn().mockResolvedValue({});
    const api = createFilesApi({ call, do: vi.fn() });
    await api.mapGenerateRun({
      filename: '/d/4rwb.mtz',
      amplitudes: 'cryst_1/data_1/FC',
      phases: 'cryst_1/data_1/PHIC',
      weights: 'None',
      minRes: 19.38758,
      maxRes: 2.00037,
      namePrefix: '',
      fofc: true,
    });
    expect(call).toHaveBeenCalledWith(
      'cmd.tenmol_files.map_generate_run',
      ['/d/4rwb.mtz', 'cryst_1/data_1/FC', 'cryst_1/data_1/PHIC', 'None', 19.38758, 2.00037, '', true],
      {},
    );
  });

  it('asks for the presentation preset with full_screen OFF by default', async () => {
    // `cmd.full_screen` ALWAYS raises — `CmdFullScreen`
    // (`packages/engine/layer4/Cmd.cpp:5352-5362`) returns an `ok` it never assigns — so the
    // client does not ask for it unless something deliberately opts in.
    const call = vi.fn().mockResolvedValue({});
    const api = createFilesApi({ call, do: vi.fn() });
    await api.presentationPreset();
    expect(call).toHaveBeenCalledWith('cmd.tenmol_files.presentation_preset', [false], {});
  });

  it('round-trips the previous settings back through presentation_restore', async () => {
    const call = vi.fn().mockResolvedValue({});
    const api = createFilesApi({ call, do: vi.fn() });
    const previous = { presentation: 'off', internal_gui: 'on', internal_feedback: '2' };
    await api.presentationRestore(previous);
    expect(call).toHaveBeenCalledWith(
      'cmd.tenmol_files.presentation_restore',
      [previous],
      {},
    );
  });

  it('routes open_with_plan through the same namespace', async () => {
    const call = vi.fn().mockResolvedValue({});
    const api = createFilesApi({ call, do: vi.fn() });
    await api.openWithPlan('/tmp/show.psw');
    expect(call).toHaveBeenCalledWith(
      'cmd.tenmol_files.open_with_plan',
      ['/tmp/show.psw'],
      {},
    );
  });
});
