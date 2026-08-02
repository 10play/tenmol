/**
 * Row 293 — the substitute for a macOS document handler, built and driven.
 *
 * The row's remaining gap is PACKAGING (an `.app` bundle with
 * `CFBundleDocumentTypes`, which this repo has no step for), and packaging is
 * not the interesting half: what a bundle needs is a way to hand a path to the
 * running client and get exactly what Finder's "Open With" gets. That is
 * `?open=<path>` (`deepLink.ts`), consumed by the always-mounted
 * `FileDropTarget` and pushed through `requestFilesOpen`, i.e. through
 * `load_dialog` — so the `.psw` presentation preset that wave 9 wired into
 * `loadPlain` fires for a double-click too, not only for the picker.
 *
 * MEASURED HERE, on a real `FilesPanel` mounted the way the shell mounts it:
 * the address bar is cleaned before anything is loaded, a `.psw` gets
 * `open_with_plan` + `presentation_preset` + `cmd.load` IN THAT ORDER
 * (`pymol_qt_gui.py:1152-1156`), a `.pse` stops at the partial question, a
 * `.pwg` is REFUSED rather than executed, and a tab opened with no parameter
 * never even mounts the files panel.
 *
 * MUTATION-TESTED, with the counts measured rather than guessed: dropping the
 * `requestFilesOpen(paths)` call from `FileDropTarget` fails 5 of these 8;
 * letting `takeOpenFromLocation` read the parameter without stripping it fails
 * exactly 1 — "…and cleans the address bar", on `'?open=/work/1rx1.pdb'`
 * instead of `''`.
 */

import { act, useEffect, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createConnectionStore,
  createFeedbackStore,
  createObjectsStore,
  createUiStore,
} from '@tenmol/stores';

import { SessionContext, type Session } from '../../app';
import {
  isPanelOpen,
  panelMounted,
  panelUnmounted,
  panelsStore,
  resetPanelHooks,
} from '../../shell/panelHooks';
import { openPathsFromQuery, queryWithoutOpen } from './deepLink';
import { FileDropTarget } from './FileDropTarget';
import { FilesPanel } from './FilesPanel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HELLO = {
  installed: true as const,
  cwd: '/work',
  home: '/home/u',
  sep: '/',
  initialdir: '/work',
  filters: { load: ['All Files (*)'] },
  geometryExports: [],
  pngRenderingModes: ['draw'],
  maeMultiplex: [],
  encoderSupport: {},
  encoders: {},
  unavailable: {},
  refused: {},
  loadFormats: ['pdb'],
  saveFormats: ['pdb'],
};

function classify(filename: string, over: Record<string, unknown> = {}) {
  return {
    filename,
    prefix: 'x',
    ext: filename.split('.').pop() ?? '',
    format: filename.split('.').pop() ?? '',
    zipped: '',
    isUrl: false,
    objectName: 'x',
    dialog: 'plain',
    mapType: null,
    alnFormat: null,
    cmsTraj: null,
    unavailable: null,
    refused: null,
    partial: 0,
    ...over,
  };
}

let REPLIES: Record<string, unknown>;
let calls: Array<{ fn: string; args: readonly unknown[] }>;
let acted: Array<{ fn: string; args: readonly unknown[] }>;
let said: string[];
/** `call` and `act` interleaved, so "in this order" can be asserted at all. */
let timeline: string[];

function makeSession(): Session {
  const feedback = createFeedbackStore();
  const appendClient = feedback.appendClient.bind(feedback);
  return {
    config: {} as Session['config'],
    conn: { sendInput: vi.fn(), isOpen: true, do: () => Promise.reject(new Error('offline')) },
    stores: {
      connection: createConnectionStore('ws://test/ws', true),
      feedback: {
        ...feedback,
        appendClient: (line: string, kind?: string) => {
          said.push(`${kind ?? 'info'}: ${line}`);
          return appendClient(line, kind as never);
        },
      },
      objects: createObjectsStore(),
      ui: createUiStore(null),
    },
    objectsSource: { poll: vi.fn(), invalidate: vi.fn() },
    poller: { stats: () => ({ hz: 30 }) },
    run: () => Promise.resolve(),
    act: (request: { fn: string; args?: readonly unknown[] }) => {
      timeline.push(request.fn);
      acted.push({ fn: request.fn, args: request.args ?? [] });
      return Promise.resolve(undefined);
    },
    call: (fn: string, args: readonly unknown[] = []) => {
      timeline.push(fn);
      calls.push({ fn, args });
      const method = fn.startsWith('cmd.tenmol_files.') ? fn.slice('cmd.tenmol_files.'.length) : fn;
      if (method in REPLIES) return Promise.resolve(REPLIES[method]);
      return Promise.reject(new Error(`offline: ${fn}`));
    },
    reconnect: vi.fn(),
    disconnect: vi.fn(),
    useToken: vi.fn(),
    probeHealth: vi.fn(),
  } as unknown as Session;
}

function MountMarker() {
  useEffect(() => {
    panelMounted('files');
    return () => panelUnmounted('files');
  }, []);
  return null;
}

function Host() {
  const open = useSyncExternalStore(
    (listener) => panelsStore().subscribe(listener),
    () => panelsStore().get().open,
  );
  return (
    <>
      <FileDropTarget />
      {open.includes('files') && (
        <>
          <MountMarker />
          <FilesPanel />
        </>
      )}
    </>
  );
}

let container: HTMLDivElement;
let root: Root;

async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Start the app at `search`, exactly as a `?open=` link would. */
async function start(search: string): Promise<void> {
  window.history.replaceState(null, '', `/${search}`);
  act(() =>
    root.render(
      <SessionContext.Provider value={makeSession()}>
        <Host />
      </SessionContext.Provider>,
    ),
  );
  await flush();
}

function fns(): string[] {
  return calls.map((c) => c.fn);
}

function dialogLabels(): string[] {
  return [...container.querySelectorAll('[role="dialog"]')].map(
    (el) => el.getAttribute('aria-label') ?? '',
  );
}

beforeEach(() => {
  calls = [];
  acted = [];
  said = [];
  timeline = [];
  REPLIES = {
    hello: HELLO,
    install_tk_dialogs: { installed: true, already: false },
    dialog_pending: [],
    note_open: {},
    initialdir: '/work',
  };
  resetPanelHooks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetPanelHooks();
  window.history.replaceState(null, '', '/');
});

/* ------------------------------------------------------------------ *
 * The pure half
 * ------------------------------------------------------------------ */

describe('row 293 — ?open= parsing', () => {
  it('reads every value, trims, and drops the empty ones', () => {
    expect(openPathsFromQuery('?open=/a.pdb&open=%20&open=/b%20c.pse')).toEqual([
      '/a.pdb',
      '/b c.pse',
    ]);
    expect(openPathsFromQuery('')).toEqual([]);
    expect(openPathsFromQuery('?token=abc')).toEqual([]);
  });

  it('strips only itself', () => {
    expect(queryWithoutOpen('?token=abc&open=/a.pdb')).toBe('?token=abc');
    expect(queryWithoutOpen('?open=/a.pdb')).toBe('');
    // Untouched when there is nothing to strip — not even re-encoded.
    expect(queryWithoutOpen('?token=abc')).toBe('?token=abc');
  });
});

/* ------------------------------------------------------------------ *
 * The whole route
 * ------------------------------------------------------------------ */

describe('row 293 — a path handed to the running client', () => {
  it('does nothing at all when there is no parameter', async () => {
    REPLIES.plan_open = { steps: [classify('/work/1rx1.pdb')], count: 1 };
    await start('');
    expect(isPanelOpen('files')).toBe(false);
    expect(fns()).not.toContain('cmd.tenmol_files.plan_open');
  });

  it('runs a plain file through load_dialog and cleans the address bar', async () => {
    REPLIES.plan_open = { steps: [classify('/work/1rx1.pdb')], count: 1 };
    await start('?open=/work/1rx1.pdb');

    expect(calls.find((c) => c.fn === 'cmd.tenmol_files.plan_open')?.args).toEqual([
      ['/work/1rx1.pdb'],
    ]);
    expect(acted).toEqual([{ fn: 'cmd.load', args: ['/work/1rx1.pdb'] }]);
    // Consumed: a reload must not load it again.
    expect(window.location.search).toBe('');
  });

  it('a .psw gets the presentation preset, in upstream order', async () => {
    REPLIES.plan_open = {
      steps: [classify('/work/demo.psw', { format: 'psw', dialog: 'session' })],
      count: 1,
    };
    REPLIES.ask_partial_needed = { needed: false, names: [], autoRenameDuplicates: false };
    REPLIES.open_with_plan = {
      filename: '/work/demo.psw',
      reuseHelper: false,
      autoReinitialize: false,
      names: [],
      action: 'load-here',
      reinitialize: false,
      presentation: true,
      presetSteps: [],
      classification: classify('/work/demo.psw', { format: 'psw', dialog: 'session' }),
    };
    REPLIES.presentation_preset = {
      previous: { presentation: 'off', internal_gui: 'on', internal_feedback: '5' },
      current: { presentation: 'on', internal_gui: 'off', internal_feedback: '0' },
      fullScreen: { attempted: false, ok: false, error: null },
    };

    await start('?open=/work/demo.psw');

    // plan, preset, THEN load (`pymol_qt_gui.py:1152-1156`).
    const order = timeline.filter(
      (fn) =>
        fn === 'cmd.tenmol_files.open_with_plan' ||
        fn === 'cmd.tenmol_files.presentation_preset' ||
        fn === 'cmd.load',
    );
    expect(order).toEqual([
      'cmd.tenmol_files.open_with_plan',
      'cmd.tenmol_files.presentation_preset',
      'cmd.load',
    ]);
    expect(acted).toEqual([{ fn: 'cmd.load', args: ['/work/demo.psw'] }]);
    // …and the tab now offers the way out that the desktop app has no
    // equivalent of.
    expect(
      [...container.querySelectorAll('button')].some(
        (b) => b.getAttribute('data-testid') === 'files-leave-presentation',
      ),
    ).toBe(true);
  });

  it('a .pse still asks the partial question', async () => {
    REPLIES.plan_open = {
      steps: [classify('/work/s.pse', { format: 'pse', dialog: 'session' })],
      count: 1,
    };
    REPLIES.ask_partial_needed = { needed: true, names: ['1rx1'], autoRenameDuplicates: false };

    await start('?open=/work/s.pse');

    expect(dialogLabels()).toContain('Load Session');
    expect(acted).toEqual([]);
  });

  it('a .pwg is refused, not executed', async () => {
    // `cmd.load` on a `.pwg` runs its directives with no confirmation, so the
    // deep link must inherit the drop handler's refusal — it does, because it
    // goes through `runStep` like everything else.
    REPLIES.plan_open = {
      steps: [
        classify('/work/evil.pwg', {
          format: 'pwg',
          refused: 'a .pwg is a script for the PyMOL web GUI: loading it runs its directives',
        }),
      ],
      count: 1,
    };

    await start('?open=/work/evil.pwg');

    expect(acted).toEqual([]);
    expect(said.join('\n')).toContain('.pwg');
  });

  it('opens every path of a repeated parameter, in order', async () => {
    REPLIES.plan_open = {
      steps: [classify('/work/a.pdb'), classify('/work/b.pdb')],
      count: 2,
    };
    await start('?open=/work/a.pdb&open=/work/b.pdb');

    expect(calls.find((c) => c.fn === 'cmd.tenmol_files.plan_open')?.args).toEqual([
      ['/work/a.pdb', '/work/b.pdb'],
    ]);
    expect(acted).toEqual([
      { fn: 'cmd.load', args: ['/work/a.pdb'] },
      { fn: 'cmd.load', args: ['/work/b.pdb'] },
    ]);
  });
});
