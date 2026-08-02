/**
 * Row 61 — the editor opens THE FILE IT WAS ASKED FOR.
 *
 * `dialogs/store.ts` has carried an `arg` per window since it was written (it
 * keys them `texteditor:<arg>`) and `TextEditorPanel` ignored it, so every
 * editor opened EMPTY. That single omission is why waves 8-10 left
 * `File ▸ Edit pymolrc` unbound: binding it would have shown a window titled
 * `~/.pymolrc` that had never read ~/.pymolrc.
 *
 * Everything below is asserted against the bridge shapes MEASURED in
 * `bridge/tests/test_p11_menus.py` on this tree:
 *
 *   cmd.tenmol_files.pymolrc()          -> {'paths': [], 'home': '/Users/amirangel'}
 *   cmd.tenmol_files.read_text('~/.pymolrc')
 *       -> {'path': '/Users/amirangel/.pymolrc', 'ok': False, 'text': '',
 *           'error': "[Errno 2] No such file or directory: '/Users/…/.pymolrc'"}
 *
 * i.e. on this machine the rc file does not exist, and that is the NORMAL case
 * rather than a failure — Qt answers it with a "Create new pymolrc?" prompt
 * (`TextEditor.py:168-182`).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createConnectionStore,
  createFeedbackStore,
  createObjectsStore,
  createUiStore,
} from '@tenmol/stores';

import { SessionContext, type Session } from '../../app';
import { dialogsStore } from '../dialogs/store';
import { PYMOLRC_ARG, openPymolrcEditor, openTextEditor } from './openEditor';
import { panelsStore, resetPanelHooks } from '../../shell/panelHooks';
import { TextEditorSlot } from './TextEditorPanel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Reply {
  path?: string;
  text?: string;
  ok?: boolean;
  error?: string | null;
}

interface Stub {
  session: Session;
  calls: Array<{ fn: string; args: readonly unknown[] }>;
  lines: () => string[];
}

const HOME = '/Users/amirangel';

function makeSession(options: {
  /** server path -> what `read_text` answers. */
  files?: Record<string, Reply>;
  pymolrc?: { paths: string[]; home: string };
  /** Refuse the whole namespace, as an un-bootstrapped bridge does. */
  noFiles?: boolean;
  /** Bootstrapping installs it: the FIRST call fails, later ones work. */
  bootstrapInstalls?: boolean;
}): Stub {
  const calls: Array<{ fn: string; args: readonly unknown[] }> = [];
  const dos: string[] = [];
  let installed = !options.noFiles && !options.bootstrapInstalls;
  if (!options.noFiles && !options.bootstrapInstalls) installed = true;

  const stores = {
    connection: createConnectionStore('ws://test/ws', true),
    feedback: createFeedbackStore(),
    objects: createObjectsStore(),
    ui: createUiStore(null),
  };

  const session = {
    config: {} as Session['config'],
    conn: {
      sendInput: vi.fn(),
      isOpen: true,
      do: (line: string) => {
        dos.push(line);
        if (options.bootstrapInstalls && line.includes('panels.files')) installed = true;
        return Promise.resolve(undefined);
      },
    },
    stores,
    objectsSource: { poll: vi.fn(), invalidate: vi.fn() },
    poller: { stats: () => ({ hz: 30 }) },
    run: () => Promise.resolve(),
    act: () => Promise.resolve(undefined),
    call: (fn: string, args: readonly unknown[] = []) => {
      calls.push({ fn, args });
      if (!installed) {
        // `policy/base.py`, verbatim shape.
        return Promise.reject(new Error(`'cmd.tenmol_files' is not an addressable namespace`));
      }
      if (fn === 'cmd.tenmol_files.pymolrc') {
        return Promise.resolve(options.pymolrc ?? { paths: [], home: HOME });
      }
      if (fn === 'cmd.tenmol_files.read_text') {
        const path = String(args[0] ?? '');
        if (path === '') return Promise.resolve({ path: '', ok: false, text: '', error: 'no path' });
        const hit = options.files?.[path];
        if (hit) return Promise.resolve(hit);
        return Promise.resolve({
          path,
          ok: false,
          text: '',
          error: `[Errno 2] No such file or directory: '${path}'`,
        });
      }
      return Promise.reject(new Error(`offline: ${fn}`));
    },
    reconnect: vi.fn(),
    disconnect: vi.fn(),
    useToken: vi.fn(),
    probeHealth: vi.fn(),
  } as unknown as Session;

  return { session, calls, lines: () => dos };
}

let container: HTMLDivElement;
let root: Root;

function closeAllWindows(): void {
  for (const w of [...dialogsStore.get().windows]) dialogsStore.close(w.key);
}

beforeEach(() => {
  resetPanelHooks();
  closeAllWindows();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  closeAllWindows();
  resetPanelHooks();
});

async function mount(stub: Stub): Promise<void> {
  act(() =>
    root.render(
      <SessionContext.Provider value={stub.session}>
        <TextEditorSlot />
      </SessionContext.Provider>,
    ),
  );
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/**
 * `DialogWindow` PORTALS to `document.body` (`DialogWindow.tsx:127`), so the
 * editor is not inside the test's own container. Querying the container is how
 * the first draft of this file passed with an assertion that measured nothing.
 */
const q = <T extends HTMLElement>(selector: string): T | null =>
  document.body.querySelector<T>(selector);

const area = (): HTMLTextAreaElement => {
  const el = q<HTMLTextAreaElement>('[data-txted-area]');
  if (!el) throw new Error('no editor');
  return el;
};
const pathLabel = (): string => q('.txted__path')?.textContent?.trim() ?? '';
const status = (): string => q('.txted__status')?.textContent?.trim() ?? '';
const error = (): string => q('.txted__error')?.textContent?.trim() ?? '';

describe('row 61 — TextEditorPanel reads spec.arg', () => {
  it('opens a plain server path and shows its bytes, not an empty buffer', async () => {
    const body = 'from pymol import cmd\ncmd.bg_color("white")\n';
    const stub = makeSession({ files: { '/work/setup.py': { path: '/work/setup.py', ok: true, text: body } } });
    openTextEditor('/work/setup.py');
    await mount(stub);

    expect(area().value).toBe(body);
    expect(pathLabel()).toBe('/work/setup.py');
    // `_open` picks the syntax from the extension (`TextEditor.py:36-42`).
    const python = q<HTMLInputElement>('[data-txted-syntax="python"]');
    expect(python?.checked).toBe(true);
  });

  it('resolves @pymolrc through cmd.tenmol_files.pymolrc and loads THAT file', async () => {
    const rc = '/Users/amirangel/.pymolrc';
    const body = 'set ray_opaque_background, 0\n';
    const stub = makeSession({
      pymolrc: { paths: [rc], home: HOME },
      files: { [rc]: { path: rc, ok: true, text: body } },
    });
    openPymolrcEditor();
    await mount(stub);

    expect(stub.calls.map((c) => c.fn)).toContain('cmd.tenmol_files.pymolrc');
    expect(area().value).toBe(body);
    expect(pathLabel()).toBe(rc);
    // `read_text` was asked for the RESOLVED path, never for the sentinel.
    const reads = stub.calls.filter((c) => c.fn === 'cmd.tenmol_files.read_text');
    expect(reads.map((c) => c.args[0])).toContain(rc);
    expect(reads.map((c) => c.args[0])).not.toContain(PYMOLRC_ARG);
    // The "restart to apply" note fires, because the path really is a pymolrc.
    expect(q('.txted__note')?.textContent).toMatch(/read at startup/);
  });

  it('falls back to $HOME/.pymolrc when PyMOL loaded none — the measured case', async () => {
    // MEASURED on this tree: `{'paths': [], 'home': '/Users/amirangel'}`.
    const stub = makeSession({ pymolrc: { paths: [], home: HOME } });
    openPymolrcEditor();
    await mount(stub);

    expect(pathLabel()).toBe(`${HOME}/.pymolrc`);
    // ENOENT is not an error here: it is Qt's "Create new pymolrc?" case.
    expect(error()).toBe('');
    expect(area().value).toBe('');
    expect(status()).toBe(`${HOME}/.pymolrc does not exist yet — Save will create it`);
  });

  it('offers the choice Qt offers when more than one rc file is active', async () => {
    const a = '/etc/pymolrc';
    const b = `${HOME}/.pymolrc`;
    const stub = makeSession({
      pymolrc: { paths: [a, b], home: HOME },
      files: {
        [a]: { path: a, ok: true, text: '# site\n' },
        [b]: { path: b, ok: true, text: '# mine\n' },
      },
    });
    openPymolrcEditor();
    await mount(stub);

    expect(area().value).toBe('# site\n');
    const select = q<HTMLSelectElement>('[data-txted-pymolrc]');
    expect(select).not.toBeNull();
    expect([...(select as HTMLSelectElement).options].map((o) => o.value)).toEqual([a, b]);
    expect(status()).toBe(`${a} — 2 active pymolrc files`);

    // Switching loads the other one, `QInputDialog.getItem`'s job.
    await act(async () => {
      const el = select as HTMLSelectElement;
      el.value = b;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(area().value).toBe('# mine\n');
    expect(pathLabel()).toBe(b);
  });

  it('REFUSES rather than showing an empty buffer when the bridge serves no files', async () => {
    const stub = makeSession({ noFiles: true });
    openTextEditor('/work/setup.py');
    await mount(stub);

    // The browser picker cannot reach the PyMOL host, so an empty buffer
    // titled `/work/setup.py` would be a lie about what was read.
    expect(error()).toBe(
      'cannot open /work/setup.py: this bridge serves no files (cmd.tenmol_files is not installed)',
    );
    expect(pathLabel()).toBe('(unsaved)');
  });

  it('bootstraps cmd.tenmol_files itself — nothing else does it at startup', async () => {
    // `features/files` calls `api.ensure()` inside its handlers only
    // (`FileDropTarget.tsx:99,143,211`), so an editor opened before the user has
    // touched a file dialog used to probe a symbol PyMOL had never imported and
    // silently drop to the browser picker.
    const rc = `${HOME}/.pymolrc`;
    const stub = makeSession({
      bootstrapInstalls: true,
      pymolrc: { paths: [rc], home: HOME },
      files: { [rc]: { path: rc, ok: true, text: 'bg_color grey\n' } },
    });
    openPymolrcEditor();
    await mount(stub);

    expect(stub.lines()).toContain('import tenmol_bridge.panels.files as _tf; _tf.install()');
    expect(q('.txted__access')?.textContent).toBe('bridge fs');
    expect(area().value).toBe('bg_color grey\n');
  });

  it('keys the window per file, so the leaf raises rather than stacking', async () => {
    const first = openPymolrcEditor();
    const again = openPymolrcEditor();
    expect(first).toBe(again);
    expect(dialogsStore.get().windows.filter((w) => w.kind === 'texteditor')).toHaveLength(1);
    expect(dialogsStore.get().windows[0]?.arg).toBe(PYMOLRC_ARG);
    // …and it asked the shell to mount the slot that draws it.
    expect(panelsStore().get().open).toContain('texteditor');
  });
});
