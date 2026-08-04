/**
 * Window drag & drop.
 *
 * The bug these guard is not a wrong answer, it is NO answer: the handler used
 * to live inside `FilesPanel`, an overlay slot mounted only while the user has
 * it open, so dropping a structure on the window did nothing and said nothing.
 */

import { describe, expect, it } from 'vitest';

import {
  dialogNeededFor,
  dialogRequiredMessage,
  planFromDataTransfer,
  windowAccelerator,
} from './globalDrop';

function transfer(data: Record<string, string>, files: File[] = []): DataTransfer {
  return {
    getData: (type: string) => data[type] ?? '',
    files: files as unknown as FileList,
  } as unknown as DataTransfer;
}

const PDB = new File(['ATOM\n'], '1tii.pdb', { type: 'chemical/x-pdb' });

describe('planFromDataTransfer', () => {
  it('takes a remote URL, which needs no filesystem at all', () => {
    const plan = planFromDataTransfer(
      transfer({ 'text/uri-list': 'https://files.rcsb.org/download/1RX1.pdb' }),
    );
    expect(plan).toEqual({ kind: 'url', url: 'https://files.rcsb.org/download/1RX1.pdb' });
  });

  it('takes only the FIRST uri when several are dropped', () => {
    const plan = planFromDataTransfer(
      transfer({ 'text/uri-list': 'https://a/1.pdb\r\nhttps://b/2.pdb' }),
    );
    expect(plan).toEqual({ kind: 'url', url: 'https://a/1.pdb' });
  });

  it('does NOT treat file:// as a URL', () => {
    /*
     * The browser will not reveal the path behind a file:// URI, and sending
     * it to the server would resolve it against the SERVER's filesystem — a
     * different machine's idea of that path. The File object is the real
     * payload, so it falls through to the upload branch.
     */
    const plan = planFromDataTransfer(
      transfer({ 'text/uri-list': 'file:///home/a/1tii.pdb' }, [PDB]),
    );
    expect(plan).toEqual({ kind: 'files', files: [PDB] });
  });

  it('prefers a URL over files when a drag carries both', () => {
    // Dragging from a browser address bar supplies both; the URL is the more
    // faithful thing to load.
    const plan = planFromDataTransfer(transfer({ 'text/uri-list': 'https://a/1.pdb' }, [PDB]));
    expect(plan).toEqual({ kind: 'url', url: 'https://a/1.pdb' });
  });

  it('is a no-op for an empty or absent transfer', () => {
    expect(planFromDataTransfer(null)).toEqual({ kind: 'none' });
    expect(planFromDataTransfer(transfer({}))).toEqual({ kind: 'none' });
    expect(planFromDataTransfer(transfer({ 'text/plain': 'just some words' }))).toEqual({
      kind: 'none',
    });
  });
});

describe('dialogNeededFor', () => {
  it('lets a plain structure load without asking anything', () => {
    for (const dialog of ['plain', 'script'] as const) {
      expect(dialogNeededFor({ dialog })).toBeNull();
    }
  });

  it('names the modal for each format that needs one', () => {
    expect(dialogNeededFor({ dialog: 'traj' })).toBe('trajectory');
    expect(dialogNeededFor({ dialog: 'map' })).toBe('map');
    expect(dialogNeededFor({ dialog: 'mtz' })).toBe('MTZ');
    expect(dialogNeededFor({ dialog: 'aln' })).toBe('alignment');
    expect(dialogNeededFor({ dialog: 'mae' })).toBe('Maestro');
    expect(dialogNeededFor({ dialog: 'session' })).toBe('session');
  });

  it('says which file and which dialog, not just "could not load"', () => {
    const message = dialogRequiredMessage('run.dcd', 'trajectory');
    expect(message).toContain('run.dcd');
    expect(message).toContain('trajectory');
    expect(message).toContain('File dialogs');
  });
});


describe('windowAccelerator', () => {
  const ev = (patch: Partial<Parameters<typeof windowAccelerator>[0]>) => ({
    key: 'o',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...patch,
  });

  it('matches Ctrl+O and Ctrl+S', () => {
    expect(windowAccelerator(ev({ ctrlKey: true, key: 'o' }))).toBe('open');
    expect(windowAccelerator(ev({ ctrlKey: true, key: 's' }))).toBe('save');
  });

  it('accepts Meta as well, which is the "MacPyMOL compatible" part', () => {
    expect(windowAccelerator(ev({ metaKey: true, key: 'o' }))).toBe('open');
    expect(windowAccelerator(ev({ metaKey: true, key: 'S' }))).toBe('save');
  });

  it('ignores the bare key, so typing "o" still types "o"', () => {
    expect(windowAccelerator(ev({ key: 'o' }))).toBeNull();
  });

  it('ALT disqualifies it', () => {
    /*
     * Ctrl+Alt+O is a different chord, and on some layouts it is how AltGr
     * characters arrive — treating it as Open would hijack typing.
     */
    expect(windowAccelerator(ev({ ctrlKey: true, altKey: true, key: 'o' }))).toBeNull();
  });

  it('ignores every other Ctrl chord', () => {
    for (const key of ['a', 'c', 'v', 'z', 'Enter']) {
      expect(windowAccelerator(ev({ ctrlKey: true, key }))).toBeNull();
    }
  });
});
