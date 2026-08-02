/**
 * Inventory row 295, wave 9 — a blocked plugin's dialog appears with the File
 * dialogs panel CLOSED.
 *
 * Wave 6 installed the shim and proved it blocks and answers; the verifier left
 * the row partial for one reason: "the only poller lives in FilesPanel, an
 * overlay slot, so a plugin dialog raised with that panel closed shows nothing
 * and blocks until the user opens it".
 *
 * That poller is now `PluginDialogHost`, rendered by `FileDropTarget` — the one
 * piece of this feature `ViewportPanel` mounts unconditionally. These tests
 * mount ONLY `FileDropTarget` (i.e. the panel is closed, as it is by default,
 * `features/registry.ts` region 'overlay') and drive a parked request all the
 * way to `dialog_answer`.
 *
 * MUTATION-TESTED: replacing `FileDropTarget`'s `return <PluginDialogHost />`
 * with `return null` makes the first three of these fail (no picker, no
 * answer); leaving the old poller in `FilesPanel` as well makes
 * `only one poller claims a request` fail with two `dialog_answer` calls for
 * one dialog.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileDropTarget } from './FileDropTarget';
import { FilesPanel } from './FilesPanel';
import { PLUGIN_DIALOG_POLL_MS } from './pluginDialogs';

const appendClient = vi.fn();
const run = vi.fn().mockResolvedValue(undefined);
const call = vi.fn();
const conndo = vi.fn();
const SESSION = {
  call,
  run,
  act: vi.fn().mockResolvedValue(undefined),
  conn: { do: conndo },
  stores: { feedback: { appendClient } },
};
vi.mock('../../app', () => ({ useSession: () => SESSION }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const REQUEST = {
  dialogId: 7,
  kind: 'askopenfilename' as const,
  options: {
    title: 'Pick a structure',
    initialdir: '/data',
    initialfile: '',
    filter: 'PDB (*.pdb);;All (*)',
    filters: ['PDB (*.pdb)', 'All (*)'],
    multiple: false,
  },
  waitingFor: 0.4,
};

const LISTING = {
  path: '/data',
  parent: '/',
  cwd: '/data',
  home: '/home/u',
  entries: [
    { name: 'ala.pdb', path: '/data/ala.pdb', isDir: false, size: 12, mtime: 0, ext: 'pdb' },
  ],
  error: null,
  truncated: false,
};

/** One pending request, then none — the shape `dialog_pending` really has. */
function serve(options: { pending?: unknown[][] } = {}) {
  const queue = options.pending ?? [[REQUEST], []];
  let index = 0;
  call.mockImplementation((fn: string) => {
    switch (fn) {
      case 'cmd.tenmol_files.dialog_pending': {
        const next = queue[Math.min(index, queue.length - 1)] ?? [];
        index += 1;
        return Promise.resolve(next);
      }
      case 'cmd.tenmol_files.browse':
        return Promise.resolve(LISTING);
      case 'cmd.tenmol_files.places':
        return Promise.resolve([]);
      case 'cmd.tenmol_files.dialog_answer':
        return Promise.resolve({ answered: true, error: null });
      case 'cmd.tenmol_files.recent':
        return Promise.resolve([]);
      default:
        return Promise.resolve({ installed: true, ok: true });
    }
  });
}

let container: HTMLDivElement;
let root: Root;

const settle = async () => {
  for (let i = 0; i < 8; i += 1) await act(async () => void (await Promise.resolve()));
};

const tick = async (ms = PLUGIN_DIALOG_POLL_MS + 10) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await settle();
};

const calls = (fn: string) => call.mock.calls.filter((c) => c[0] === fn);
const text = () => container.textContent ?? '';

beforeEach(() => {
  vi.useFakeTimers();
  appendClient.mockClear();
  run.mockClear();
  conndo.mockClear();
  call.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('a plugin dialog with the File dialogs panel closed (row 295)', () => {
  it('polls and opens the picker from the always-mounted component', async () => {
    serve();
    act(() => root.render(<FileDropTarget />));
    await settle();
    // Nothing on screen until a plugin blocks.
    expect(text()).toBe('');

    await tick();

    expect(calls('cmd.tenmol_files.dialog_pending').length).toBeGreaterThan(0);
    // `pickerForPluginDialog` prefixes the plugin's own title.
    expect(text()).toContain('Plugin: Pick a structure');
    // ...and it is the real path picker, listing the bridge's answer.
    expect(text()).toContain('ala.pdb');
    // The console says who is waiting (`pluginDialogMessage`).
    expect(appendClient).toHaveBeenCalledWith(
      ' a plugin is waiting for a file: Pick a structure (askopenfilename, dialog #7)',
      undefined,
    );
  });

  it('answers `dialog_answer` with the chosen path, in tkinter\'s shape', async () => {
    serve();
    act(() => root.render(<FileDropTarget />));
    await settle();
    await tick();

    const row = [...container.querySelectorAll('.fpick__row')].find((b) =>
      (b.textContent ?? '').startsWith('ala.pdb'),
    );
    expect(row, 'the listing row is missing').toBeTruthy();
    act(() => row?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const choose = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Choose',
    );
    expect(choose, 'no accept button').toBeTruthy();
    act(() => choose?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await settle();

    // A single path, NOT a list: `multiple` is false, and `askopenfile` would
    // iterate a bare string character by character if this were wrong.
    expect(calls('cmd.tenmol_files.dialog_answer')[0]?.[1]).toEqual([7, '/data/ala.pdb']);
    // The picker is gone, and the poll is free to claim the next request.
    expect(text()).not.toContain('Plugin: Pick a structure');
  });

  it('cancels to null, which the shim turns back into tkinter\'s empty string', async () => {
    serve();
    act(() => root.render(<FileDropTarget />));
    await settle();
    await tick();

    const cancel = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Cancel',
    );
    expect(cancel, 'no cancel button').toBeTruthy();
    act(() => cancel?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await settle();

    expect(calls('cmd.tenmol_files.dialog_answer')[0]?.[1]).toEqual([7, null]);
  });

  it('only one poller claims a request, even with the panel open too', async () => {
    serve({ pending: [[REQUEST], [REQUEST], []] });
    act(() =>
      root.render(
        <>
          <FileDropTarget />
          <FilesPanel />
        </>,
      ),
    );
    await settle();
    await tick();
    await tick();

    // `FilesPanel` no longer polls: every `dialog_pending` came from the host,
    // and the request is claimed once.
    const dialogs = [...container.querySelectorAll('.fdlg__title')].filter((n) =>
      (n.textContent ?? '').startsWith('Plugin:'),
    );
    expect(dialogs.length).toBe(1);
  });

  it('keeps polling after an answer, so a second dialog is not stranded', async () => {
    serve({ pending: [[REQUEST], [], [{ ...REQUEST, dialogId: 8 }], []] });
    act(() => root.render(<FileDropTarget />));
    await settle();
    await tick();

    const cancel = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Cancel',
    );
    act(() => cancel?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await settle();
    await tick();
    await tick();

    // The second request is on screen with no help from the panel; cancel it
    // too, so both answers are visible.
    expect(text()).toContain('Plugin: Pick a structure');
    const second = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Cancel',
    );
    act(() => second?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await settle();

    const ids = calls('cmd.tenmol_files.dialog_answer').map((c) => (c[1] as unknown[])[0]);
    expect(ids).toEqual([7, 8]);
  });
});
