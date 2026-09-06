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
/**
 * What `cmd.get_session` answers. The LOCAL engine returns the object (`SNAP`);
 * the REMOTE bridge lists `get_session` in `BLOB_RETURNS` and returns a blob
 * HANDLE instead — a case can swap this to exercise the fetch-the-real-bytes
 * path.
 */
let sessionReply: unknown;

function makeSession(): Session {
  return {
    config: { httpOrigin: 'http://127.0.0.1:0' },
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
      if (fn === 'cmd.get_session') return Promise.resolve(sessionReply);
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
/** The Blobs handed to `URL.createObjectURL`, in order — the downloaded bytes. */
let blobs: Blob[];
let clickSpy: { mockRestore(): void };
let promptSpy: { mockRestore(): void } | undefined;
let fetchSpy: { mockRestore(): void } | undefined;

beforeEach(() => {
  calls = [];
  tfCalls = [];
  sessionReply = SNAP;
  downloads = [];
  blobs = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // jsdom implements neither createObjectURL nor revokeObjectURL; the download
  // helper needs both. Define them (spyOn can't hook a missing method). Capture
  // each Blob so a case can assert on the downloaded bytes.
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (b: Blob) => {
    blobs.push(b);
    return 'blob:mock';
  };
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
  fetchSpy?.mockRestore();
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

  it('over the remote bridge, downloads the FETCHED blob bytes, not the handle JSON', async () => {
    // On the remote PyMOL bridge `cmd.get_session` is in `BLOB_RETURNS`
    // (codec.py) and resolves to a blob HANDLE, not the session — the real
    // `.pse` bytes live behind `handle.url`. JSON-stringifying the handle would
    // download a tiny stub, so the save must fetch and download the real bytes.
    const PSE_BYTES = new Uint8Array([0x50, 0x53, 0x45, 0x00, 0x01, 0x02, 0x03]);
    sessionReply = {
      __blob__: true,
      id: 'xyz',
      url: '/blob/xyz',
      mime: 'application/octet-stream',
      size: PSE_BYTES.length,
    };
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(PSE_BYTES, { status: 200 }) as unknown as Response,
      ) as unknown as { mockRestore(): void };
    promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('remote.pse');
    mount();
    click('files-menu-button');
    tfCalls = [];
    calls = [];

    click('files-menu-session-save');
    await flush();

    // The engine still produced the snapshot, and the bytes came from the blob
    // URL built off `session.config.httpOrigin`.
    expect(calls.map((c) => c.fn)).toContain('cmd.get_session');
    expect(globalThis.fetch).toHaveBeenCalledWith('http://127.0.0.1:0/blob/xyz');
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.download).toBe('remote.pse');
    // The download is the FETCHED bytes, not `JSON.stringify(handle)`: the blob
    // is exactly the fetched byte length and octet-stream typed, whereas the
    // stringified handle would be far larger (and JSON text).
    expect(blobs).toHaveLength(1);
    expect(blobs[0]!.size).toBe(PSE_BYTES.length);
    expect(blobs[0]!.type).toBe('application/octet-stream');
    expect(blobs[0]!.size).not.toBe(JSON.stringify(sessionReply).length);
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
