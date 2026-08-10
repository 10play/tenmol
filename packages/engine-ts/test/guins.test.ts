/**
 * Tests for the `gui` subsystem (packages/engine-ts/src/cmd/guins.ts).
 *
 * `gui.py` is entirely a desktop-window control interface; ported headless, each
 * verb is a documented no-op that models only the observable intent. These tests
 * boot the full engine through {@link LocalBackend} (loading SMALL_PDB so state
 * exists) and assert that every `gui.*` verb dispatches without throwing
 * `NotPorted`, returns the modelled shape, and — for the external-GUI show/hide
 * pair — that the visibility intent it reports is coherent.
 */

import { describe, expect, it } from 'vitest';
import { LocalBackend } from '@tenmol/engine-ts';
import { SMALL_PDB } from './fixture';

async function booted(): Promise<LocalBackend> {
  const backend = new LocalBackend();
  await backend.connect();
  await backend.call('read_pdbstr', [SMALL_PDB, 'm']);
  return backend;
}

describe('gui: app / window accessors (env-bound no-ops)', () => {
  it('get_pmgapp / get_qtwindow / createlegacypmgapp return null', async () => {
    const backend = await booted();
    // No legacy Tk app, no Qt window and no toolkit to build one in-engine, so
    // each accessor faithfully yields null (get_qtwindow's ImportError branch).
    expect(await backend.call('gui.get_pmgapp')).toBeNull();
    expect(await backend.call('gui.get_qtwindow')).toBeNull();
    expect(await backend.call('gui.createlegacypmgapp')).toBeNull();
  });
});

describe('gui: external gui control', () => {
  it('ext_show / ext_hide report the modelled visibility intent', async () => {
    const backend = await booted();
    // The window side effect is a no-op; the boolean models the shown/hidden
    // intent PyMOL posts to the external GUI's fifo.
    expect(await backend.call('gui.ext_hide')).toBe(false);
    expect(await backend.call('gui.ext_show')).toBe(true);
    // The intent is sticky across calls.
    expect(await backend.call('gui.ext_hide')).toBe(false);
  });
});

describe('gui: common actions (desktop dialogs)', () => {
  it('save_as / save_image are documented no-ops returning null', async () => {
    const backend = await booted();
    // These pop desktop file dialogs in PyMOL; raising a dialog is the web
    // client's job, so there is nothing to do in-engine.
    expect(await backend.call('gui.save_as')).toBeNull();
    expect(await backend.call('gui.save_image')).toBeNull();
  });
});

describe('gui: every ported verb is callable (no NotPorted)', () => {
  it('dispatches all seven gui.* verbs without throwing', async () => {
    const backend = await booted();
    const verbs = [
      'gui.get_pmgapp',
      'gui.get_qtwindow',
      'gui.createlegacypmgapp',
      'gui.ext_show',
      'gui.ext_hide',
      'gui.save_as',
      'gui.save_image',
    ];
    for (const verb of verbs) {
      // Resolving (rather than rejecting with NotPorted) is the assertion; null
      // is a defined, valid result here.
      await expect(backend.call(verb)).resolves.toBeDefined();
    }
  });
});
