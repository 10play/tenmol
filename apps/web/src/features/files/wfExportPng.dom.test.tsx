/**
 * Task I4 — the browser-only `File ▸ Export Image As ▸ PNG…` path.
 *
 * The app is browser-only: the PNG dialog keeps its UI but, on save, runs only
 * the render SETUP lines (`draw 0, 0` / `set opaque_background, …`) — never the
 * final `png <path>`, whose browser disk-write is a no-op — then pulls the
 * pixels from the engine (`cmd.png`) and downloads them. No server `pick`,
 * `api.setInitialdir`, or `cmd.tenmol_files.*`.
 *
 * This mounts the real `FilesPanel`, opens the PNG dialog, presses Save with
 * `window.prompt` stubbed, and asserts `cmd.png` was called for the bytes, the
 * download filename ended `.png` with a `image/png` blob, and the export made
 * ZERO `cmd.tenmol_files.*` calls.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionContext, type Session } from '../../app';
import { FilesPanel } from './FilesPanel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A valid PNG signature so the download is a real image, not a placeholder. */
const PNG_BYTES = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13];

let calls: Array<{ fn: string; args: readonly unknown[]; kwargs: Record<string, unknown> }>;
let ran: string[];
let tfCalls: string[];

function makeSession(): Session {
  return {
    act: () => Promise.resolve(undefined),
    run: (line: string) => {
      ran.push(line);
      return Promise.resolve();
    },
    call: (
      fn: string,
      args: readonly unknown[] = [],
      kwargs: Record<string, unknown> = {},
    ) => {
      calls.push({ fn, args, kwargs });
      if (fn.startsWith('cmd.tenmol_files.')) {
        tfCalls.push(fn);
        if (fn === 'cmd.tenmol_files.hello') {
          return Promise.resolve({ installed: true, filters: {} });
        }
        return Promise.reject(new Error(`offline: ${fn}`));
      }
      if (fn === 'cmd.png') return Promise.resolve(PNG_BYTES);
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
let downloads: HTMLAnchorElement[];
let blobs: Blob[];
let clickSpy: { mockRestore(): void };
let promptSpy: { mockRestore(): void } | undefined;

beforeEach(() => {
  calls = [];
  ran = [];
  tfCalls = [];
  downloads = [];
  blobs = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // jsdom implements neither, so DEFINE them (see download.dom.test.ts).
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = (b: Blob) => {
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

/** Click a button by its exact text. */
function clickButton(text: string): void {
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent === text);
  if (!button) throw new Error(`no button ${JSON.stringify(text)}`);
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Open the PNG export dialog and wait for it to appear. */
async function openDialog(): Promise<void> {
  mount();
  click('files-menu-button');
  tfCalls = [];
  click('files-menu-png');
  await flush();
  const dialog = container.querySelector('[role="dialog"]');
  if (dialog?.getAttribute('aria-label') !== 'Save PNG image') {
    throw new Error('PNG dialog did not open');
  }
}

describe('I4 — Export Image ▸ PNG downloads cmd.png bytes', () => {
  it('Save calls cmd.png for bytes and downloads a .png, no cmd.tenmol_files.*', async () => {
    promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('image.png');
    await openDialog();

    clickButton('Save PNG image as …');
    await flush();

    // The pixels came from the engine's raster/ray, not a disk write.
    const png = calls.find((c) => c.fn === 'cmd.png');
    expect(png?.args).toEqual(['', 0, 0, -1]);
    // Default rendering (capture current display) => ray=0.
    expect(png?.kwargs).toEqual({ ray: 0 });
    // No server `png <path>` (which is a browser no-op) was run.
    expect(ran.some((line) => line.startsWith('png '))).toBe(false);
    // …the bytes were downloaded as a PNG under the prompted name…
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.download.endsWith('.png')).toBe(true);
    expect(downloads[0]!.download).toBe('image.png');
    expect(blobs[0]!.type).toBe('image/png');
    // …and nothing routed through the bridge-only module.
    expect(tfCalls).toEqual([]);
  });

  it('runs the ray setup line (not the png line) for the transparent-ray mode', async () => {
    promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('shot');
    await openDialog();

    // rendering index 3 = "ray trace with transparent background".
    const select = container.querySelector('select') as HTMLSelectElement;
    act(() => {
      select.value = '3';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    clickButton('Save PNG image as …');
    await flush();

    // The setup line ran; the `png <path>` line did not.
    expect(ran).toContain('set opaque_background, 0');
    expect(ran.some((line) => line.startsWith('png '))).toBe(false);
    // ray mode => ray=1.
    const png = calls.find((c) => c.fn === 'cmd.png');
    expect(png?.kwargs).toEqual({ ray: 1 });
    // The prompt name had no extension, so `.png` was appended.
    expect(downloads[0]!.download).toBe('shot.png');
    expect(tfCalls).toEqual([]);
  });

  it('cancelling the prompt saves nothing', async () => {
    promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);
    await openDialog();

    clickButton('Save PNG image as …');
    await flush();

    expect(calls.some((c) => c.fn === 'cmd.png')).toBe(false);
    expect(downloads).toHaveLength(0);
    expect(tfCalls).toEqual([]);
  });
});
