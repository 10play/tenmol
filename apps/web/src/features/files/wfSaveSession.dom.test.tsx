/**
 * Task I2 — the browser-only `File ▸ Save Session` / `Save Session As…` path.
 *
 * The app is browser-only: a "save" is a download, not a host-filesystem write.
 * Save Session must serialize the engine's session snapshot (`cmd.get_session`)
 * and download it — never the server round-trip the old path used
 * (`cmd.tenmol_files.session_file` + `save <path>, format=pse`, which writes to
 * disk and THROWS in the browser).
 *
 * This mounts the real `FilesPanel` the way `AppShell.OverlayLayer` renders it,
 * opens the File menu, clicks `Save Session` with `window.prompt` stubbed, and
 * asserts the engine saw `cmd.get_session`, the download filename kept its
 * `.pse` extension, and the save made ZERO `cmd.tenmol_files.*` calls.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionContext, type Session } from '../../app';
import { FilesPanel } from './FilesPanel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A stand-in session snapshot — the shape does not matter, only that it round-trips. */
const SNAP = { kind: 'tenmol-session', version: 1, objects: [], settings: {}, view: [] };

let calls: Array<{ fn: string; args: readonly unknown[] }>;
/** Every `cmd.tenmol_files.*` fn the panel called, in order. */
let tfCalls: string[];

function makeSession(): Session {
  return {
    act: () => Promise.resolve(undefined),
    run: () => Promise.resolve(),
    call: (fn: string, _args: readonly unknown[] = []) => {
      calls.push({ fn, args: _args });
      if (fn.startsWith('cmd.tenmol_files.')) {
        tfCalls.push(fn);
        if (fn === 'cmd.tenmol_files.hello') {
          return Promise.resolve({ installed: true, filters: { session: ['*.pse'] } });
        }
        return Promise.reject(new Error(`offline: ${fn}`));
      }
      if (fn === 'cmd.get_session') return Promise.resolve(SNAP);
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
/** The anchors the download helper clicked, in order. */
let downloads: HTMLAnchorElement[];
let clickSpy: { mockRestore(): void };
let promptSpy: { mockRestore(): void } | undefined;

beforeEach(() => {
  calls = [];
  tfCalls = [];
  downloads = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // jsdom implements neither createObjectURL nor revokeObjectURL; the download
  // helper needs both. Define them (spyOn can't hook a missing method).
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

async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe('I2 — Save Session downloads the get_session snapshot', () => {
  it('calls cmd.get_session and downloads a .pse, with no cmd.tenmol_files.*', async () => {
    promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('mysession.pse');
    mount();
    // Open the menu (bootstraps `hello`); forget it so the assertion is scoped
    // to the SAVE action alone.
    click('files-menu-button');
    tfCalls = [];
    calls = [];

    click('files-menu-session-save');
    await flush();

    // The engine produced the snapshot…
    expect(calls.map((c) => c.fn)).toContain('cmd.get_session');
    // …it was downloaded under the prompted name, extension kept…
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.download).toBe('mysession.pse');
    // …and the save never touched the bridge-only module.
    expect(tfCalls).toEqual([]);
  });

  it('Save Session As… appends .pse when the typed name has no extension', async () => {
    promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('untitled');
    mount();
    click('files-menu-button');
    tfCalls = [];

    click('files-menu-session-save-as');
    await flush();

    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.download).toBe('untitled.pse');
    expect(tfCalls).toEqual([]);
  });

  it('cancelling the prompt saves nothing', async () => {
    promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);
    mount();
    click('files-menu-button');
    calls = [];

    click('files-menu-session-save');
    await flush();

    expect(calls.map((c) => c.fn)).not.toContain('cmd.get_session');
    expect(downloads).toEqual([]);
  });
});
