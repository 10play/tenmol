/**
 * Inventory row 293 — the `.psw` presentation preset gets a CALLER.
 *
 * The wave-7 verifier reproduced the bridge half in full and left the row
 * partial for one reason: "nothing in apps/web calls `open_with_plan` or
 * `presentation_preset` (grep finds only `filesApi.ts` and its unit test), so
 * both the fix and the preset are an RPC with no caller".
 *
 * This drives the route that reaches `cmd.load` for a session file. Since task
 * I1 made File ▾ ▸ Open… a browser-native contents load, the session pipeline
 * (`FilesPanel.runStep` → partial gate → `loadPlain`) is now entered through
 * Open Recent / a deep link (`requestFilesOpen` → `openPaths`), which still
 * classifies a server path — and asserts the whole macOS-handler sequence in
 * the order `pymol_qt_gui.py:1140-1160` runs it: plan, preset, THEN load.
 *
 * MUTATION-TESTED: deleting the `enterPresentation(...)` call from `loadPlain`
 * makes four of these five fail; making it ask the plan's `presentation` flag
 * instead of the classification makes `a .pzw ... is a show file too` fail,
 * which is the wave-7 divergence this row exists for.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FilesPanel } from './FilesPanel';
import { FILES_ACTION_EVENT, FILES_OPEN_PATHS } from './menuHooks';

const appendClient = vi.fn();
const run = vi.fn().mockResolvedValue(undefined);
const call = vi.fn();
const actFn = vi.fn().mockResolvedValue(undefined);
const conndo = vi.fn();
const SESSION = {
  call,
  run,
  act: actFn,
  conn: { do: conndo },
  stores: { feedback: { appendClient } },
};
vi.mock('../../app', () => ({ useSession: () => SESSION }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const HELLO = {
  installed: true as const,
  cwd: '/work',
  home: '/home/u',
  sep: '/',
  initialdir: '/work',
  filters: { load: ['All Files (*)'] },
};

const LISTING = (name: string) => ({
  path: '/work',
  parent: '/',
  cwd: '/work',
  home: '/home/u',
  entries: [
    {
      name,
      path: `/work/${name}`,
      isDir: false,
      size: 10,
      mtime: 0,
      ext: name.split('.').pop() ?? '',
    },
  ],
  error: null,
  truncated: false,
});

/** `classify_filename` for a PyMOL session/show file. */
const CLASSIFY = (name: string, format: string) => ({
  filename: `/work/${name}`,
  format,
  dialog: 'session',
  partial: 0,
  unavailable: null,
  refused: null,
  cmsTraj: null,
});

interface Options {
  /** What `classify_filename` calls it: `pse` or `psw`. */
  format: string;
  name: string;
  /** `open_with_plan.action`. */
  action?: 'load-here' | 'new-window';
  loadFails?: boolean;
}

function serve(options: Options) {
  const { format, name, action = 'load-here', loadFails = false } = options;
  call.mockImplementation((fn: string, args?: unknown[]) => {
    switch (fn) {
      case 'cmd.tenmol_files.hello':
        return Promise.resolve(HELLO);
      case 'cmd.tenmol_files.browse':
        return Promise.resolve(LISTING(name));
      case 'cmd.tenmol_files.places':
        return Promise.resolve([]);
      case 'cmd.tenmol_files.plan_open':
        return Promise.resolve({
          steps: ((args?.[0] as string[]) ?? []).map((p) => ({
            ...CLASSIFY(p.split('/').pop() ?? '', format),
            filename: p,
          })),
        });
      case 'cmd.tenmol_files.ask_partial_needed':
        return Promise.resolve({ needed: false, names: [], partial: 0 });
      case 'cmd.tenmol_files.open_with_plan':
        return Promise.resolve({
          filename: `/work/${name}`,
          reuseHelper: false,
          autoReinitialize: false,
          names: action === 'new-window' ? ['1rx1'] : [],
          action,
          reinitialize: false,
          // Pre-ANDed with "not new-window", exactly like the bridge: this is
          // the field the client must NOT use once it has decided to load here.
          presentation: action === 'load-here' && format === 'psw',
          presetSteps: [],
          classification: CLASSIFY(name, format),
        });
      case 'cmd.tenmol_files.presentation_preset':
        return Promise.resolve({
          previous: { presentation: 'off', internal_gui: 'on', internal_feedback: '5' },
          current: { presentation: 'on', internal_gui: 'off', internal_feedback: '0' },
          fullScreen: { attempted: false, ok: false, error: null },
        });
      case 'cmd.tenmol_files.presentation_restore':
        return Promise.resolve({
          presentation: 'off',
          internal_gui: 'on',
          internal_feedback: '5',
        });
      default:
        return Promise.resolve({ ok: true });
    }
  });
  actFn.mockImplementation(() =>
    loadFails ? Promise.reject(new Error('Unable to open file')) : Promise.resolve(undefined),
  );
}

let container: HTMLDivElement;
let root: Root;

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await act(async () => void (await Promise.resolve()));
};

const buttons = () => [...container.querySelectorAll('button')];
const names = () => call.mock.calls.map((c) => c[0] as string);
const said = () => appendClient.mock.calls.map((c) => String(c[0]));

/**
 * Open `/work/name` through Open Recent / a deep link — the route that still
 * classifies a server path in a browser-only build (`requestFilesOpen` →
 * `openPaths` → `plan_open` → partial gate → `loadPlain`). The File ▾ ▸ Open…
 * picker now loads browser file CONTENTS directly (task I1), so it no longer
 * reaches this session pipeline.
 */
async function openViaPicker(name: string) {
  act(() => root.render(<FilesPanel />));
  await settle();
  // The event `requestFilesOpen` dispatches once the overlay slot has mounted —
  // fired directly here because this harness renders `FilesPanel` without the
  // panelHooks Host that would otherwise drain the intent.
  act(() =>
    window.dispatchEvent(
      new CustomEvent(FILES_ACTION_EVENT, {
        detail: { action: FILES_OPEN_PATHS, paths: [`/work/${name}`] },
      }),
    ),
  );
  await settle();
}

beforeEach(() => {
  appendClient.mockClear();
  run.mockClear();
  conndo.mockClear();
  call.mockReset();
  actFn.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('opening a PyMOL Show file (row 293)', () => {
  it('asks for the plan, applies the preset, and only then loads', async () => {
    serve({ format: 'psw', name: 'show.psw' });
    await openViaPicker('show.psw');

    const order = names();
    expect(order).toContain('cmd.tenmol_files.open_with_plan');
    expect(order).toContain('cmd.tenmol_files.presentation_preset');
    expect(order.indexOf('cmd.tenmol_files.open_with_plan')).toBeLessThan(
      order.indexOf('cmd.tenmol_files.presentation_preset'),
    );
    // `full_screen` is NOT attempted: `cmd.full_screen` raises on every build.
    const preset = call.mock.calls.find(
      (c) => c[0] === 'cmd.tenmol_files.presentation_preset',
    );
    expect(preset?.[1]).toEqual([false]);
    // ...and the load came after the preset, like `:1152-1156` then
    // `load_dialog`.
    expect(actFn).toHaveBeenCalledTimes(1);
    expect((actFn.mock.calls[0]?.[0] as { args: string[] }).args).toEqual(['/work/show.psw']);

    expect(said().some((line) => line.includes('presentation mode on for show.psw'))).toBe(
      true,
    );
    expect(said().some((line) => line.includes('internal_feedback 0'))).toBe(true);
  });

  it('offers the way back out, which upstream does not', async () => {
    serve({ format: 'psw', name: 'show.psw' });
    await openViaPicker('show.psw');

    const leave = buttons().find(
      (b) => b.getAttribute('data-testid') === 'files-leave-presentation',
    );
    expect(leave, 'no way to leave presentation mode').toBeTruthy();
    expect(leave?.textContent).toContain('show.psw');
    act(() => leave?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await settle();

    // The PREVIOUS values go back, not defaults: this tab was in
    // internal_gui on / internal_feedback 5 before the show file arrived.
    const restore = call.mock.calls.find(
      (c) => c[0] === 'cmd.tenmol_files.presentation_restore',
    );
    expect(restore?.[1]).toEqual([
      { presentation: 'off', internal_gui: 'on', internal_feedback: '5' },
    ]);
    expect(
      buttons().some((b) => b.getAttribute('data-testid') === 'files-leave-presentation'),
    ).toBe(false);
  });

  it('a plain .pse is loaded with no preset at all', async () => {
    serve({ format: 'pse', name: 'work.pse' });
    await openViaPicker('work.pse');

    expect(names()).toContain('cmd.tenmol_files.open_with_plan');
    expect(names()).not.toContain('cmd.tenmol_files.presentation_preset');
    expect(actFn).toHaveBeenCalledTimes(1);
  });

  it('a .pzw with objects loaded is a show file too, and says what upstream would have done', async () => {
    // `open_with_plan` answers action=new-window (reuse_helper 0 + objects) and
    // therefore presentation=false. Obeying that flag would leave a PyMOL Show
    // file in normal mode — upstream's own bug, plus the extension bug: its
    // handler asks `endswith('.psw')`, so `.pzw` never got the preset at all.
    serve({ format: 'psw', name: 'talk.pzw', action: 'new-window' });
    await openViaPicker('talk.pzw');

    expect(names()).toContain('cmd.tenmol_files.presentation_preset');
    expect(said().some((line) => line.includes('SECOND process'))).toBe(true);
    expect(said().some((line) => line.includes('loading it in place instead'))).toBe(true);
    // It still loads: one bridge process, one client (row 294).
    expect(actFn).toHaveBeenCalledTimes(1);
  });

  it('a show file that fails to load does not strand the tab in presentation mode', async () => {
    serve({ format: 'psw', name: 'broken.psw', loadFails: true });
    await openViaPicker('broken.psw');

    expect(names()).toContain('cmd.tenmol_files.presentation_restore');
    expect(
      buttons().some((b) => b.getAttribute('data-testid') === 'files-leave-presentation'),
    ).toBe(false);
  });
});
