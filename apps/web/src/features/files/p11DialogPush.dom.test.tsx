/**
 * Row 295, wave 11 — the client half: PUSH instead of a 700 ms poll.
 *
 * Wave 10 landed the server half (`_bridge.answer_dialog` routed,
 * `TOPIC_DIALOG` published on open AND on close) and left the row partial with
 * one sentence: "`PluginDialogHost.tsx` still POLLS
 * `cmd.tenmol_files.dialog_pending` every 700 ms and does not subscribe to the
 * topic, so the user-visible latency is unchanged until that one component
 * switches".
 *
 * These tests are about the four things that changed with it, none of which the
 * wave-9 suite could express:
 *
 *   1. there is NO timer any more (30 s of fake time buys zero extra calls);
 *   2. a `'closed'` event takes a dead picker off the screen — a dialog also
 *      stops waiting on its own 300 s timeout and when a second browser
 *      answers it, and the old poll could not tell either from "still open";
 *   3. one reconcile on mount and on reconnect, because the topic reports
 *      TRANSITIONS and `BridgeServer._dialog_seen` is process-wide: a dialog
 *      parked before this tab connected is announced to nobody, and `pnpm dev`
 *      reloads the page constantly;
 *   4. the answer goes to `_bridge.answer_dialog`, which is served on the
 *      socket thread instead of behind the draw pump.
 *
 * The payloads below are the real thing: `DIALOG_EVENT` is what
 * `session.py::plugin_dialog_payload` emitted for a real plugin worker thread
 * blocked in `askopenfilename`, captured over a socket against the running
 * bridge.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PluginDialogHost, requestFromDialogPayload } from './PluginDialogHost';
import type { DialogPayload } from '@tenmol/protocol/topics/dialog';

const appendClient = vi.fn();
const call = vi.fn();
const conndo = vi.fn();

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
  run: vi.fn(),
  act: vi.fn(),
  conn: { do: conndo, on, sub },
  stores: { feedback: { appendClient } },
};
vi.mock('../../app', () => ({ useSession: () => SESSION }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Captured from the running bridge, `askopenfilename` with two filetypes. */
const DIALOG_EVENT: DialogPayload = {
  dialogId: 3,
  kind: 'open-file',
  entry: 'askopenfilename',
  event: 'opened',
  title: 'Pick a structure',
  message: "a plugin's Python thread is blocked in askopenfilename",
  filters: [
    ['PDB', '*.pdb'],
    ['All files', '*'],
  ],
  directory: '/data',
  options: {
    title: 'Pick a structure',
    initialdir: '/data',
    initialfile: '',
    filter: 'PDB (*.pdb);;All files (*)',
    filters: ['PDB (*.pdb)', 'All files (*)'],
    multiple: false,
  },
  waitingFor: 0.104,
};

/** The row shape `dialog_pending` / `_bridge.pending_dialogs` return. */
const PENDING_ROW = {
  dialogId: 3,
  kind: 'askopenfilename',
  options: {
    title: 'Pick a structure',
    initialdir: '/data',
    initialfile: '',
    filter: 'PDB (*.pdb);;All files (*)',
    filters: ['PDB (*.pdb)', 'All files (*)'],
    multiple: false,
  },
  waitingFor: 12.5,
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

interface ServeOptions {
  pending?: unknown;
  pendingFails?: boolean;
  answerFails?: boolean;
}

function serve(options: ServeOptions = {}) {
  call.mockImplementation((fn: string) => {
    switch (fn) {
      case '_bridge.pending_dialogs':
        return options.pendingFails
          ? Promise.reject(new Error('BadMessage: no plugin dialog broker'))
          : Promise.resolve(options.pending ?? []);
      case 'cmd.tenmol_files.dialog_pending':
        return Promise.resolve(options.pending ?? []);
      case '_bridge.answer_dialog':
        return options.answerFails
          ? Promise.reject(new Error('BadMessage: no plugin dialog broker'))
          : Promise.resolve({ answered: true, error: null });
      case 'cmd.tenmol_files.dialog_answer':
        return Promise.resolve({ answered: true, error: null });
      case 'cmd.tenmol_files.browse':
        return Promise.resolve(LISTING);
      case 'cmd.tenmol_files.places':
        return Promise.resolve([]);
      default:
        return Promise.resolve({ ok: true });
    }
  });
}

let container: HTMLDivElement;
let root: Root;

const settle = async () => {
  for (let i = 0; i < 8; i += 1) await act(async () => void (await Promise.resolve()));
};

const push = async (payload: unknown) => {
  await act(async () => {
    emit('dialog', payload);
  });
  await settle();
};

const mount = async () => {
  act(() => root.render(<PluginDialogHost />));
  await settle();
};

const calls = (fn: string) => call.mock.calls.filter((c) => c[0] === fn);
const text = () => container.textContent ?? '';
const cancelButton = () =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === 'Cancel');

beforeEach(() => {
  vi.useFakeTimers();
  appendClient.mockClear();
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

describe('the plugin dialog rides the `dialog` topic (row 295)', () => {
  it('subscribes once and never sets a timer', async () => {
    serve();
    await mount();

    expect(sub).toHaveBeenCalledTimes(1);
    expect(sub).toHaveBeenCalledWith('dialog');
    expect(on.mock.calls.map((c) => c[0])).toEqual(['dialog', 'connection:open']);

    // Exactly one read: the reconcile. THIS is the assertion that the 700 ms
    // poll is gone -- 30 s of it would have been ~42 more calls.
    const reads = () =>
      calls('_bridge.pending_dialogs').length + calls('cmd.tenmol_files.dialog_pending').length;
    expect(reads()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await settle();
    expect(reads()).toBe(1);
  });

  it('opens the picker straight off a pushed event, with no tick in between', async () => {
    serve();
    await mount();
    expect(text()).toBe('');

    await push(DIALOG_EVENT);

    // No timers were advanced anywhere in this test: the picker is on screen
    // because of the event alone.
    expect(text()).toContain('Plugin: Pick a structure');
    expect(text()).toContain('ala.pdb');
    // The picker got the plugin's OWN filter strings (`options.filters`, the
    // Qt strings `mimic_tk._getfilter` built), not the split `[label, glob]`
    // pairs the topic also carries.
    expect(text()).toContain('PDB (*.pdb)');
    expect(appendClient).toHaveBeenCalledWith(
      ' a plugin is waiting for a file: Pick a structure (askopenfilename, dialog #3)',
      undefined,
    );
  });

  it('answers through `_bridge.answer_dialog`, off the draw pump', async () => {
    serve();
    await mount();
    await push(DIALOG_EVENT);

    act(() => cancelButton()?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await settle();

    expect(calls('_bridge.answer_dialog')).toHaveLength(1);
    expect(calls('_bridge.answer_dialog')[0]?.[1]).toEqual([{ dialogId: 3, value: null }]);
    // The pump route is NOT used: queueing the answer behind a long `cmd.*`
    // call is the deadlock the whole inverted protocol existed to dodge.
    expect(calls('cmd.tenmol_files.dialog_answer')).toHaveLength(0);
  });

  it('falls back to the pump route if the bridge has no `_bridge` dialog route', async () => {
    serve({ answerFails: true });
    await mount();
    await push(DIALOG_EVENT);

    act(() => cancelButton()?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await settle();

    expect(calls('cmd.tenmol_files.dialog_answer')[0]?.[1]).toEqual([3, null]);
    // The user's choice is not lost, and no error line is written for a
    // fallback that worked.
    expect(appendClient.mock.calls.filter((c) => c[1] === 'error')).toHaveLength(0);
  });

  it('takes a dead picker off the screen when the dialog stops waiting', async () => {
    serve();
    await mount();
    await push(DIALOG_EVENT);
    expect(text()).toContain('Plugin: Pick a structure');

    // `DialogBroker.DEFAULT_TIMEOUT` fired, or a second browser answered it.
    await push({ ...DIALOG_EVENT, event: 'closed' });

    expect(text()).not.toContain('Plugin: Pick a structure');
    expect(appendClient).toHaveBeenCalledWith(
      ' the plugin stopped waiting for dialog #3',
      'warning',
    );
    // Nothing was answered: there is nothing left to answer, and a late
    // answer would come back `{answered: false, error: 'no open dialog 3'}`.
    expect(calls('_bridge.answer_dialog')).toHaveLength(0);
  });

  it('ignores a `closed` event for a dialog that is not the live one', async () => {
    serve();
    await mount();
    await push(DIALOG_EVENT);

    await push({ ...DIALOG_EVENT, dialogId: 99, event: 'closed' });

    expect(text()).toContain('Plugin: Pick a structure');
    expect(appendClient).not.toHaveBeenCalledWith(
      ' the plugin stopped waiting for dialog #99',
      'warning',
    );
  });

  it('finds a dialog that was already parked when the tab loaded', async () => {
    // The reload case. The topic reports transitions and `_dialog_seen` is
    // process-wide, so this opening was announced before this tab existed and
    // will never be announced again.
    serve({ pending: [PENDING_ROW] });
    await mount();

    expect(calls('_bridge.pending_dialogs')).toHaveLength(1);
    expect(text()).toContain('Plugin: Pick a structure');

    // ...and the pushed event for the same dialog does not open a second one.
    await push(DIALOG_EVENT);
    expect(
      [...container.querySelectorAll('.fdlg__title')].filter((n) =>
        (n.textContent ?? '').startsWith('Plugin:'),
      ),
    ).toHaveLength(1);
  });

  it('reconciles again on every reconnect', async () => {
    serve();
    await mount();
    expect(text()).toBe('');

    serve({ pending: [PENDING_ROW] });
    await act(async () => {
      emit('connection:open', { url: 'ws://test/ws' });
    });
    await settle();

    expect(calls('_bridge.pending_dialogs')).toHaveLength(2);
    expect(text()).toContain('Plugin: Pick a structure');
  });

  it('reconciles through the panel when `_bridge.pending_dialogs` is refused', async () => {
    // The ~1 s after startup in which `BridgeServer._probe_dialog_broker` has
    // not cached the broker yet: the socket route raises, the pump route works.
    serve({ pending: [PENDING_ROW], pendingFails: true });
    await mount();

    expect(calls('_bridge.pending_dialogs')).toHaveLength(1);
    expect(calls('cmd.tenmol_files.dialog_pending')).toHaveLength(1);
    expect(text()).toContain('Plugin: Pick a structure');
  });

  it('queues a second dialog raised while the first is on screen', async () => {
    serve();
    await mount();
    await push(DIALOG_EVENT);
    await push({ ...DIALOG_EVENT, dialogId: 4, title: 'Second', options: { ...DIALOG_EVENT.options, title: 'Second' } });

    // One picker at a time (Qt's dialogs are application-modal too), and the
    // second one is not lost -- with no poll left, losing it would strand a
    // plugin thread for 300 s.
    expect(
      [...container.querySelectorAll('.fdlg__title')].filter((n) =>
        (n.textContent ?? '').startsWith('Plugin:'),
      ),
    ).toHaveLength(1);
    expect(text()).toContain('Plugin: Pick a structure');

    act(() => cancelButton()?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await settle();
    expect(text()).toContain('Plugin: Second');

    act(() => cancelButton()?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await settle();
    expect(calls('_bridge.answer_dialog').map((c) => (c[1] as { dialogId: number }[])[0])).toEqual(
      [
        { dialogId: 3, value: null },
        { dialogId: 4, value: null },
      ],
    );
  });
});

describe('the dialog is reachable, not merely present', () => {
  /**
   * THE ONE THING THIS ENVIRONMENT CANNOT CHECK, PINNED AS TEXT.
   *
   * `files.css` used to be imported by `FilesPanel.tsx` alone, and `FilesPanel`
   * is an OVERLAY panel: its chunk — and its stylesheet — only load once the
   * user opens the File dialogs panel. `PluginDialogHost` is mounted for the
   * life of the app and renders the same markup, so with that panel never
   * opened the picker rendered UNSTYLED. Measured in Chrome at 1280x900:
   * `.fdlg__backdrop` computed `position: static; z-index: auto` instead of
   * `position: fixed; inset: 0; z-index: 80`, the dialog laid out as a
   * 1056x80 strip inside the viewport panel, and `document.elementFromPoint`
   * at the centre of the title, of every listing row and of both buttons
   * returned the WebGL canvas or `div.viewport__hud-line` — Playwright timed
   * out clicking "Choose" with "intercepts pointer events". Every DOM test in
   * this file passed throughout: jsdom lays nothing out and loads no CSS.
   *
   * A source assertion is a poor substitute for a layout assertion, and it is
   * what this environment can actually enforce.
   */
  it('imports its own stylesheet, because nothing else always-mounted does', () => {
    // `import.meta.url` is an http URL under the jsdom environment, so resolve
    // from the runner's cwd instead (the repo root, or this app).
    const candidates = [
      'apps/web/src/features/files/PluginDialogHost.tsx',
      'src/features/files/PluginDialogHost.tsx',
    ].map((p) => resolve(process.cwd(), p));
    const found = candidates.find((p) => existsSync(p));
    expect(found, `PluginDialogHost.tsx not found from ${process.cwd()}`).toBeTruthy();
    expect(readFileSync(found as string, 'utf8')).toContain("import './files.css'");
  });
});

describe('requestFromDialogPayload', () => {
  it('re-shapes a pushed payload into the row shape the picker takes', () => {
    expect(requestFromDialogPayload(DIALOG_EVENT)).toEqual({
      dialogId: 3,
      kind: 'askopenfilename',
      options: {
        title: 'Pick a structure',
        initialdir: '/data',
        initialfile: '',
        filter: 'PDB (*.pdb);;All files (*)',
        filters: ['PDB (*.pdb)', 'All files (*)'],
        multiple: false,
      },
      waitingFor: 0.104,
    });
  });

  it('keeps `multiple`, which decides the ANSWER shape', () => {
    const many = requestFromDialogPayload({
      ...DIALOG_EVENT,
      entry: 'askopenfilenames',
      options: { ...DIALOG_EVENT.options, multiple: true },
    });
    // `askopenfile(multiple=1)` does `[open(f) for f in r]`; a bare string
    // would be iterated character by character (`mimic_tk.py:62-63`).
    expect(many.kind).toBe('askopenfilenames');
    expect(many.options.multiple).toBe(true);
  });

  it('derives the entry point from `kind` when the payload has none', () => {
    const payload = { ...DIALOG_EVENT, kind: 'open-directory' as const };
    delete (payload as { entry?: string }).entry;
    expect(requestFromDialogPayload(payload).kind).toBe('askdirectory');

    const save = { ...DIALOG_EVENT, kind: 'save-file' as const };
    delete (save as { entry?: string }).entry;
    expect(requestFromDialogPayload(save).kind).toBe('asksaveasfilename');
  });

  it('falls back to the payload\'s own title and directory', () => {
    const bare: DialogPayload = {
      dialogId: 9,
      kind: 'open-file',
      entry: 'askopenfilename',
      title: 'Open',
      message: '',
      directory: '/home/u',
      initial: 'out.pdb',
    };
    expect(requestFromDialogPayload(bare)).toEqual({
      dialogId: 9,
      kind: 'askopenfilename',
      options: {
        title: 'Open',
        initialdir: '/home/u',
        initialfile: 'out.pdb',
        filter: '',
        filters: [],
        multiple: false,
      },
      waitingFor: 0,
    });
  });
});
