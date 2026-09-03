/**
 * Task I1 — the browser-only `File ▸ Open…` path.
 *
 * The app is going browser-only: `Open…` must open the OS file picker, read the
 * chosen file's TEXT, and hand the CONTENTS to the in-browser engine through
 * `cmd.load` — never the server round-trip `cmd.tenmol_files.plan_open` /
 * `note_open` / `upload` the old path used, which reject with no bridge.
 *
 * This mounts the real `FilesPanel` the way `AppShell.OverlayLayer` renders it,
 * opens the File menu, and clicks `Open…` with the browser's `<input>.files`
 * mocked to carry one `.pdb` File. It asserts the engine saw the file CONTENTS
 * (not a path) and that the open action made ZERO `cmd.tenmol_files.*` calls.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionContext, type Session } from '../../app';
import { FilesPanel } from './FilesPanel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A measured 1-atom PDB — enough that the engine sniffs it as `pdb` by content. */
const PDB =
  'HEADER    TEST\n' +
  'ATOM      1  N   ALA A   1      11.104   6.134  -6.504  1.00  0.00           N\n' +
  'END\n';

let acted: Array<{ fn: string; args: readonly unknown[] }>;
/** Every `cmd.tenmol_files.*` fn the panel called, in order. */
let tfCalls: string[];
/** The feedback-store sink, so refusal messages can be asserted. */
let appendClient: ReturnType<typeof vi.fn>;

function makeSession(): Session {
  return {
    act: (action: { fn: string; args?: readonly unknown[] }) => {
      acted.push({ fn: action.fn, args: action.args ?? [] });
      return Promise.resolve(undefined);
    },
    run: () => Promise.resolve(),
    call: (fn: string, _args: readonly unknown[] = []) => {
      if (fn.startsWith('cmd.tenmol_files.')) {
        tfCalls.push(fn);
        // Only `hello` is answered — enough for the menu-open bootstrap; any
        // other `cmd.tenmol_files.*` reaching here would mean the open path
        // regressed to the server round-trip this task removes.
        if (fn === 'cmd.tenmol_files.hello') {
          return Promise.resolve({ installed: true, filters: { load: ['All Files (*)'] } });
        }
      }
      return Promise.reject(new Error(`offline: ${fn}`));
    },
    stores: {
      feedback: { appendClient },
      ui: { get: () => ({ echoActions: false }) },
    },
    conn: { isOpen: true, do: () => Promise.resolve(), on: () => () => {}, sub: () => Promise.resolve() },
    objectsSource: { invalidate: vi.fn(), poll: vi.fn() },
  } as unknown as Session;
}

let container: HTMLDivElement;
let root: Root;
let createSpy: { mockRestore(): void };
/** The `<input>` `fileOpen` created, captured so the test can drive its change. */
let lastInput: HTMLInputElement | null;

beforeEach(() => {
  acted = [];
  tfCalls = [];
  appendClient = vi.fn();
  lastInput = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // jsdom cannot open an OS file dialog, so `input.click()` is inert. Capture
  // the element `fileOpen` creates so the test can fire a synthetic `change`.
  const create = document.createElement.bind(document);
  createSpy = vi
    .spyOn(document, 'createElement')
    .mockImplementation((tag: string, options?: ElementCreationOptions) => {
      const el = create(tag, options);
      if (tag === 'input') lastInput = el as HTMLInputElement;
      return el;
    });
});

afterEach(() => {
  createSpy.mockRestore();
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

/**
 * A browser File whose `.text()` resolves to `content`.
 *
 * jsdom 25's `Blob`/`File` do not implement `text()`, so it is attached here —
 * the production code only ever needs that one method off the picked file.
 */
function fileWithText(content: string, name: string): File {
  const file = new File([content], name);
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(content) });
  return file;
}

describe('I1 — File ▸ Open… loads file contents through the engine', () => {
  it('reads the picked file and calls cmd.load with its CONTENTS, no cmd.tenmol_files.*', async () => {
    mount();
    // Open the menu (this bootstraps `hello`); then forget that so the
    // assertion below is scoped to the OPEN action alone.
    click('files-menu-button');
    tfCalls = [];

    click('files-menu-open');
    // `fileOpen` created and clicked the input synchronously.
    expect(lastInput).not.toBeNull();

    const file = fileWithText(PDB, '1abc.pdb');
    Object.defineProperty(lastInput, 'files', { value: [file], configurable: true });
    act(() => lastInput?.dispatchEvent(new Event('change')));
    await flush();

    // The engine saw the CONTENTS (with a sniffed format), not a server path.
    expect(acted).toEqual([
      { fn: 'cmd.load', args: [PDB, '1abc', 0, ''] },
    ]);
    // …and the open action never touched the bridge-only module.
    expect(tfCalls).toEqual([]);
  });

  it('refuses a .pwg before it ever reaches cmd.load', async () => {
    mount();
    click('files-menu-button');
    tfCalls = [];

    click('files-menu-open');
    const file = fileWithText('delete', 'evil.pwg');
    Object.defineProperty(lastInput, 'files', { value: [file], configurable: true });
    act(() => lastInput?.dispatchEvent(new Event('change')));
    await flush();

    expect(acted).toEqual([]);
    expect(tfCalls).toEqual([]);
  });

  // A dialog-needed binary format must NOT be UTF-8-decoded and `cmd.load`ed —
  // it needs loader options this content-only path cannot supply, and decoding
  // it would corrupt it. The pre-PR path surfaced this as a dialog-required
  // message; browser-only keeps that refusal.
  for (const name of ['reflections.mtz', 'scene.pse']) {
    it(`does not text-decode + load a dialog-needed ${name}`, async () => {
      mount();
      click('files-menu-button');
      tfCalls = [];

      click('files-menu-open');
      // If the guard regressed and `.text()` were read, this would throw — the
      // file deliberately has no readable text stub, proving it is never read.
      const file = new File(['\x00\x01binary'], name);
      Object.defineProperty(lastInput, 'files', { value: [file], configurable: true });
      act(() => lastInput?.dispatchEvent(new Event('change')));
      await flush();

      // Nothing loaded, and no silent server round-trip either.
      expect(acted).toEqual([]);
      expect(tfCalls).toEqual([]);
      // The user was told a dialog is required (via the feedback store).
      const messages = appendClient.mock.calls.map((c) => String(c[0]));
      expect(messages.some((m) => /needs the .* dialog/.test(m))).toBe(true);
    });
  }
});
