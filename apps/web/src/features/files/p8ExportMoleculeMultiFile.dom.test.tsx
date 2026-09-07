/**
 * N1 — the Export Molecule dialog must not offer multi-file options it can only
 * refuse.
 *
 * `exportMolecule` (`FilesPanel.tsx`) gracefully REFUSES when
 * `request.multisave || request.pattern` is set, because the bridge multi-file
 * impl was deleted and a browser download can't turn one blob into several.
 * Offering the controls at all and then refusing is a dead end, so they were
 * removed from BOTH backends: the multisave checkbox ("Write HEADER for every
 * object") and the whole "Multiple files" tab / pattern radios are gone, and the
 * dialog no longer takes a `backend` prop. Single-file export is untouched.
 *
 * CHANGE FROM THE PRIOR REVISION: this suite used to assert the controls were
 * PRESENT on `'remote'` (the bridge could write many files). Multi-file export
 * no longer exists on either backend, so those cases now assert the controls are
 * ABSENT, and the `backend`-toggling was dropped along with the prop.
 *
 * This renders `ExportMoleculeDialog` directly (as `p8SaveObject.dom.test.tsx`
 * renders `SaveObjectDialog`).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SaveMoleculeInfo } from '@tenmol/protocol/topics/files';
import { ExportMoleculeDialog, type MoleculeSaveRequest } from './SaveDialogs';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const INFO: SaveMoleculeInfo = {
  objects: ['mol', 'lig'],
  selections: ['sele'],
  states: 3,
  filters: ['PDB File (*.pdb)', 'FASTA File (*.fasta)'],
  settings: {
    no_pdb_conect_nodup: false,
    pdb_conect_all: false,
    no_ignore_pdb_segi: false,
    pdb_retain_ids: false,
    retain_order: false,
  },
};

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

function render(onSave = vi.fn()) {
  act(() => root.render(<ExportMoleculeDialog info={INFO} onSave={onSave} onClose={vi.fn()} />));
}

function tab(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>('.fdlg__tabs button')].find(
    (b) => b.textContent === label,
  );
}

function clickButton(text: string): void {
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent === text);
  if (!button) throw new Error(`no button ${JSON.stringify(text)}`);
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

describe('ExportMoleculeDialog hides the multi-file controls on every backend', () => {
  it('has no "Multiple files" tab and no pattern radios', () => {
    render();
    expect(tab('Multiple files')).toBeUndefined();
    // The tab is gone entirely, so its radios cannot be reached.
    expect(container.querySelector('input[type="radio"]')).toBeNull();
  });

  it('hides the multisave checkbox in the PDB tab', () => {
    render();
    act(() => tab('PDB')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.textContent).not.toContain('Write HEADER for every object');
    // The other PDB checkboxes are still there.
    expect(container.textContent).toContain('Retain atom ids');
  });

  it('still exports a single file (multisave/pattern both empty)', () => {
    const onSave = vi.fn();
    render(onSave);
    clickButton('Save…');
    expect(onSave).toHaveBeenCalledTimes(1);
    const request = onSave.mock.calls[0]![0] as MoleculeSaveRequest;
    expect(request.multisave).toBe(false);
    expect(request.pattern).toBe('');
    expect(request.selection).toBe('enabled');
  });
});
