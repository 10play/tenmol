/**
 * Task I3 — the browser-only `File ▸ Export Molecule…` path (single file).
 *
 * The app is browser-only: Export Molecule keeps its dialog but seeds the
 * object/selection combos from the engine (`cmd.get_names`), not the bridge
 * (`cmd.tenmol_files.save_molecule_info`). On save it derives the format from
 * the chosen filter, gets the text straight from the engine (`cmd.get_str`), and
 * downloads it — never the server `save <path>` (which writes to disk and THROWS
 * in the browser) or `cmd.tenmol_files.save_check`.
 *
 * This mounts the real `FilesPanel`, opens Export Molecule, presses Save… with
 * `window.prompt` stubbed, and asserts the engine saw `cmd.get_str` with the
 * chosen format, the download filename kept the right extension, and the export
 * made ZERO `cmd.tenmol_files.*` calls.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionContext, type Session } from '../../app';
import { FilesPanel } from './FilesPanel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PDB_TEXT = 'HEADER    TEST\nATOM      1  N   ALA A   1       0.0   0.0   0.0\nEND\n';

let calls: Array<{ fn: string; args: readonly unknown[] }>;
let ran: string[];
let tfCalls: string[];

function makeSession(): Session {
  return {
    act: () => Promise.resolve(undefined),
    run: (line: string) => {
      ran.push(line);
      return Promise.resolve();
    },
    call: (fn: string, args: readonly unknown[] = []) => {
      calls.push({ fn, args });
      if (fn.startsWith('cmd.tenmol_files.')) {
        tfCalls.push(fn);
        if (fn === 'cmd.tenmol_files.hello') {
          return Promise.resolve({ installed: true, filters: {} });
        }
        return Promise.reject(new Error(`offline: ${fn}`));
      }
      if (fn === 'cmd.get_names') {
        // `['objects']` vs `['public_selections']` — the two combos the dialog seeds.
        return Promise.resolve(args[0] === 'objects' ? ['mol', 'lig'] : ['sele']);
      }
      if (fn === 'cmd.get_str') return Promise.resolve(PDB_TEXT);
      return Promise.reject(new Error(`offline: ${fn}`));
    },
    stores: {
      feedback: { appendClient: vi.fn() },
      ui: { get: () => ({ echoActions: false }) },
    },
    conn: { isOpen: true, do: () => Promise.resolve(), on: () => () => {}, sub: () => Promise.resolve() },
    objectsSource: { invalidate: vi.fn(), poll: vi.fn() },
  } as unknown as Session;
}

let container: HTMLDivElement;
let root: Root;
let downloads: HTMLAnchorElement[];
let clickSpy: { mockRestore(): void };
let promptSpy: { mockRestore(): void } | undefined;

beforeEach(() => {
  calls = [];
  ran = [];
  tfCalls = [];
  downloads = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = () => 'blob:mock';
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = () => {};
  clickSpy = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this);
    });
});

afterEach(() => {
  clickSpy.mockRestore();
  promptSpy?.mockRestore();
  delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
  delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
  act(() => root.unmount());
  container.remove();
});

function mount(): void {
  act(() =>
    root.render(
      <SessionContext.Provider value={makeSession()}>
        <FilesPanel />
      </SessionContext.Provider>,
    ),
  );
}

function click(testid: string): void {
  const el = container.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
  if (!el) throw new Error(`no element ${testid}`);
  act(() => el.click());
}

/** Click a button by its exact text (the dialog's Save…/Cancel live in a portal-free tree). */
function clickButton(text: string): void {
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent === text);
  if (!button) throw new Error(`no button ${JSON.stringify(text)}`);
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Open Export Molecule and wait for the engine-seeded dialog to appear. */
async function openDialog(): Promise<void> {
  mount();
  click('files-menu-button');
  tfCalls = [];
  click('files-menu-export-molecule');
  await flush();
  const dialog = container.querySelector('[role="dialog"]');
  if (dialog?.getAttribute('aria-label') !== 'Export Molecule') {
    throw new Error('Export Molecule dialog did not open');
  }
}

describe('I3 — Export Molecule downloads get_str output', () => {
  it('seeds the dialog from cmd.get_names, not the bridge', async () => {
    await openDialog();
    // The object/selection combos came from `cmd.get_names`…
    expect(calls.map((c) => c.fn)).toContain('cmd.get_names');
    // …and never `cmd.tenmol_files.save_molecule_info`.
    expect(tfCalls).toEqual([]);
    const datalist = container.querySelector('#fdlg-save-sele');
    const options = [...(datalist?.querySelectorAll('option') ?? [])].map((o) => o.getAttribute('value'));
    expect(options).toEqual(expect.arrayContaining(['mol', 'lig', 'sele']));
  });

  it('Save… calls cmd.get_str(pdb, …) and downloads a .pdb, no cmd.tenmol_files.*', async () => {
    promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('enabled.pdb');
    await openDialog();

    clickButton('Save…');
    await flush();

    // The five PDB settings were written back first (file_dialogs.py:558-562).
    expect(ran).toContain('set retain_order, 0');
    // The default filter is PDB, so get_str asked for pdb of the default
    // selection ('enabled') at the current state (-1).
    const getStr = calls.find((c) => c.fn === 'cmd.get_str');
    expect(getStr?.args).toEqual(['pdb', 'enabled', -1]);
    // …the text was downloaded under the prompted name…
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.download).toBe('enabled.pdb');
    // …and nothing routed through the bridge-only module.
    expect(tfCalls).toEqual([]);
  });

  it('picks the format from the chosen filter (FASTA)', async () => {
    promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('seq.fasta');
    await openDialog();

    const select = container.querySelector('.fdlg__select') as HTMLSelectElement;
    act(() => {
      select.value = 'FASTA File (*.fasta)';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    clickButton('Save…');
    await flush();

    const getStr = calls.find((c) => c.fn === 'cmd.get_str');
    expect(getStr?.args?.[0]).toBe('fasta');
    expect(downloads[0]!.download).toBe('seq.fasta');
    expect(tfCalls).toEqual([]);
  });
});
