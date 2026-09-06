/**
 * N1 — the Export Molecule dialog must not offer multi-file options it can only
 * refuse.
 *
 * `exportMolecule` (`FilesPanel.tsx`) gracefully REFUSES when
 * `request.multisave || request.pattern` is set, because a browser download
 * can't turn one blob into several files. But offering the controls at all and
 * then refusing is a dead end. So on the `'local'` (in-browser) backend the
 * dialog hides the multisave checkbox ("Write HEADER for every object") and the
 * whole "Multiple files" tab / pattern radios; single-file export is untouched.
 * On `'remote'` the bridge can write many files, so the controls stay.
 *
 * This renders `ExportMoleculeDialog` directly (as `p8SaveObject.dom.test.tsx`
 * renders `SaveObjectDialog`) and toggles only the `backend` prop.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SaveMoleculeInfo } from '@tenmol/protocol/topics/files';
import type { BackendKind } from '../../app/config';
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

function render(backend?: BackendKind, onSave = vi.fn()) {
  // Omit the prop entirely when unspecified (exactOptionalPropertyTypes) to
  // exercise the component's own default.
  const props = backend ? { backend } : {};
  act(() =>
    root.render(<ExportMoleculeDialog info={INFO} {...props} onSave={onSave} onClose={vi.fn()} />),
  );
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

describe("ExportMoleculeDialog backend 'local' hides multi-file controls", () => {
  it('has no "Multiple files" tab and no pattern radios', () => {
    render('local');
    expect(tab('Multiple files')).toBeUndefined();
    // Even the tab existing is gone, so its radios cannot be reached.
    expect(container.querySelector('input[type="radio"]')).toBeNull();
  });

  it('hides the multisave checkbox in the PDB tab', () => {
    render('local');
    act(() => tab('PDB')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.textContent).not.toContain('Write HEADER for every object');
    // The other PDB checkboxes are still there.
    expect(container.textContent).toContain('Retain atom ids');
  });

  it('still exports a single file (multisave/pattern both empty)', () => {
    const onSave = vi.fn();
    render('local', onSave);
    clickButton('Save…');
    expect(onSave).toHaveBeenCalledTimes(1);
    const request = onSave.mock.calls[0]![0] as MoleculeSaveRequest;
    expect(request.multisave).toBe(false);
    expect(request.pattern).toBe('');
    expect(request.selection).toBe('enabled');
  });

  it('defaults to hiding them when backend is unspecified', () => {
    render(undefined);
    expect(tab('Multiple files')).toBeUndefined();
  });
});

describe("ExportMoleculeDialog backend 'remote' keeps multi-file controls", () => {
  it('shows the "Multiple files" tab with the pattern radios', () => {
    render('remote');
    const multi = tab('Multiple files');
    expect(multi).toBeDefined();
    act(() => multi?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const radios = [...container.querySelectorAll('input[type="radio"]')];
    expect(radios).toHaveLength(3);
    expect(container.textContent).toContain('one file per object');
  });

  it('shows the multisave checkbox in the PDB tab', () => {
    render('remote');
    act(() => tab('PDB')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.textContent).toContain('Write HEADER for every object');
  });
});
