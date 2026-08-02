/**
 * Inventory row 295, wave 9 — a blocked plugin's dialog appears with the File
 * dialogs panel CLOSED.
 *
 * Wave 6 installed the shim and proved it blocks and answers; the verifier left
 * the row partial for one reason: "the only poller lives in FilesPanel, an
 * overlay slot, so a plugin dialog raised with that panel closed shows nothing
 * and blocks until the user opens it".
 *
 * That host is now `PluginDialogHost`, rendered by `FileDropTarget` — the one
 * piece of this feature `ViewportPanel` mounts unconditionally. These tests
 * mount ONLY `FileDropTarget` (i.e. the panel is closed, as it is by default,
 * `features/registry.ts` region 'overlay') and drive a parked request all the
 * way to its answer.
 *
 * WAVE 11 UPDATE: the request now arrives on the pushed `dialog` topic instead
 * of a 700 ms `dialog_pending` poll, and the answer goes to
 * `_bridge.answer_dialog` instead of `cmd.tenmol_files.dialog_answer`. Every
 * assertion below is the same assertion; only the delivery changed. The new
 * behaviours (latency, `'closed'` events, the reconcile a reload needs) are in
 * `p11DialogPush.dom.test.tsx`.
 *
 * MUTATION-TESTED: replacing `FileDropTarget`'s `return <PluginDialogHost />`
 * with `return null` makes the first three of these fail (no picker, no
 * answer); adding a second `PluginDialogHost` to `FilesPanel` makes
 * `only one host claims a request` fail with two pickers for one dialog.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileDropTarget } from './FileDropTarget';
import { FilesPanel } from './FilesPanel';

const appendClient = vi.fn();
const run = vi.fn().mockResolvedValue(undefined);
const call = vi.fn();
const conndo = vi.fn();

/** The client's topic emitter, exactly as `PymolConnection.on` behaves. */
type Listener = (payload: never) => void;
const listeners = new Map<string, Set<Listener>>();
const on = vi.fn((event: string, listener: Listener) => {
  const set = listeners.get(event) ?? new Set<Listener>();
  listeners.set(event, set);
  set.add(listener);
  return () => set.delete(listener);
});
const sub = vi.fn().mockResolvedValue(undefined);
const emit = (event: string, payload: unknown) => {
  for (const listener of [...(listeners.get(event) ?? [])]) listener(payload as never);
};

const SESSION = {
  call,
  run,
  act: vi.fn().mockResolvedValue(undefined),
  conn: { do: conndo, on, sub },
  stores: { feedback: { appendClient } },
};
vi.mock('../../app', () => ({ useSession: () => SESSION }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * One `dialog` topic payload, copied from what the running bridge emits
 * (`session.py::plugin_dialog_payload`, verified over a real socket).
 */
const PUSH = {
  dialogId: 7,
  kind: 'open-file',
  entry: 'askopenfilename',
  event: 'opened',
  title: 'Pick a structure',
  message: "a plugin's Python thread is blocked in askopenfilename",
  options: {
    title: 'Pick a structure',
    initialdir: '/data',
    initialfile: '',
    filter: 'PDB (*.pdb);;All (*)',
    filters: ['PDB (*.pdb)', 'All (*)'],
    multiple: false,
  },
  filters: [
    ['PDB', '*.pdb'],
    ['All', '*'],
  ],
  directory: '/data',
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

/** Nothing parked when the tab connects; the topic delivers everything. */
function serve() {
  call.mockImplementation((fn: string) => {
    switch (fn) {
      case '_bridge.pending_dialogs':
        return Promise.resolve([]);
      case 'cmd.tenmol_files.browse':
        return Promise.resolve(LISTING);
      case 'cmd.tenmol_files.places':
        return Promise.resolve([]);
      case '_bridge.answer_dialog':
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

/** Deliver one topic event the way the socket would. */
const push = async (payload: unknown) => {
  await act(async () => {
    emit('dialog', payload);
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
  on.mockClear();
  sub.mockClear();
  listeners.clear();
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
  it('opens the picker from the always-mounted component', async () => {
    serve();
    act(() => root.render(<FileDropTarget />));
    await settle();
    // Nothing on screen until a plugin blocks.
    expect(text()).toBe('');
    expect(sub).toHaveBeenCalledWith('dialog');

    await push(PUSH);

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

  it('answers with the chosen path, in tkinter\'s shape', async () => {
    serve();
    act(() => root.render(<FileDropTarget />));
    await settle();
    await push(PUSH);

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
    expect(calls('_bridge.answer_dialog')[0]?.[1]).toEqual([
      { dialogId: 7, value: '/data/ala.pdb' },
    ]);
    // The picker is gone, and the host is free to claim the next request.
    expect(text()).not.toContain('Plugin: Pick a structure');
  });

  it('cancels to null, which the shim turns back into tkinter\'s empty string', async () => {
    serve();
    act(() => root.render(<FileDropTarget />));
    await settle();
    await push(PUSH);

    const cancel = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Cancel',
    );
    expect(cancel, 'no cancel button').toBeTruthy();
    act(() => cancel?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await settle();

    expect(calls('_bridge.answer_dialog')[0]?.[1]).toEqual([{ dialogId: 7, value: null }]);
  });

  it('only one host claims a request, even with the panel open too', async () => {
    serve();
    act(() =>
      root.render(
        <>
          <FileDropTarget />
          <FilesPanel />
        </>,
      ),
    );
    await settle();
    await push(PUSH);
    // A second copy of the same event (a re-announce, or a reconcile racing the
    // topic) must not open a second picker either.
    await push(PUSH);

    // `FilesPanel` does not listen: the request is claimed exactly once.
    const dialogs = [...container.querySelectorAll('.fdlg__title')].filter((n) =>
      (n.textContent ?? '').startsWith('Plugin:'),
    );
    expect(dialogs.length).toBe(1);
  });

  it('keeps listening after an answer, so a second dialog is not stranded', async () => {
    serve();
    act(() => root.render(<FileDropTarget />));
    await settle();
    await push(PUSH);

    const cancel = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Cancel',
    );
    act(() => cancel?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await settle();
    await push({ ...PUSH, dialogId: 8 });

    // The second request is on screen with no help from the panel; cancel it
    // too, so both answers are visible.
    expect(text()).toContain('Plugin: Pick a structure');
    const second = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Cancel',
    );
    act(() => second?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await settle();

    const ids = calls('_bridge.answer_dialog').map(
      (c) => ((c[1] as unknown[])[0] as { dialogId: number }).dialogId,
    );
    expect(ids).toEqual([7, 8]);
  });
});
