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
 * `packages/bridge/tests/test_p11_menus.py` on this tree:
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
  /** Attach `cmd.tenmol_files` LATER, the way the app's own bootstrap does. */
  installNow: () => void;
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
  /** Delay every reply, the way a loaded pump does. */
  slowProbeMs?: number;
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
      const answer = (): Promise<unknown> => {
        if (!installed) {
          // `policy/base.py`, verbatim shape.
          return Promise.reject(new Error(`'cmd.tenmol_files' is not an addressable namespace`));
        }
        if (fn === 'cmd.tenmol_files.pymolrc') {
          return Promise.resolve(options.pymolrc ?? { paths: [], home: HOME });
        }
        if (fn === 'cmd.tenmol_files.write_text') {
          return Promise.resolve({ ok: true, error: null });
        }
        if (fn === 'cmd.tenmol_files.read_text') {
          const path = String(args[0] ?? '');
          if (path === '') {
            return Promise.resolve({ path: '', ok: false, text: '', error: 'no path' });
          }
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
      };
      if (!options.slowProbeMs) return answer();
      // A loaded pump: the reply is real, it is just not immediate.
      return new Promise((resolve, reject) => {
        setTimeout(() => void answer().then(resolve, reject), options.slowProbeMs);
      });
    },
    reconnect: vi.fn(),
    disconnect: vi.fn(),
    useToken: vi.fn(),
    probeHealth: vi.fn(),
  } as unknown as Session;

  return {
    session,
    calls,
    lines: () => dos,
    installNow: () => {
      installed = true;
    },
  };
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

/** Let queued microtasks and timers run inside `act`. */
async function flush(times = 6, ms = 0): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  }
}

/**
 * Wait for the probe to CONCLUDE.
 *
 * `access` starts at `'probing'` now, which is the whole point of the fix, so a
 * fixed number of microtask turns is no longer a settled state: a bridge that
 * refuses the namespace takes `PROBE_ATTEMPTS` bootstrap-and-ask rounds with a
 * growing pause between them before the panel is entitled to say "browser fs".
 */
async function settle(timeoutMs = 4000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await flush(1, 20);
    const state = q('.txted__access')?.getAttribute('data-txted-access') ?? '';
    if (state !== 'probing') return state;
    if (Date.now() > deadline) return state;
  }
}

async function mount(stub: Stub): Promise<void> {
  act(() =>
    root.render(
      <SessionContext.Provider value={stub.session}>
        <TextEditorSlot />
      </SessionContext.Provider>,
    ),
  );
  await flush();
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
    expect(await settle()).toBe('browser');

    // The browser picker cannot reach the PyMOL host, so an empty buffer
    // titled `/work/setup.py` would be a lie about what was read.
    expect(error()).toBe(
      'cannot open /work/setup.py: this bridge serves no files (cmd.tenmol_files is not installed)',
    );
    expect(pathLabel()).toBe('(unsaved)');
  });

  /**
   * THE SILENT DOWNGRADE, as a user meets it.
   *
   * `access` used to be initialised to `'browser'` and every action read that
   * value directly, so a Save issued before the probe answered took the
   * download path — the bytes went to ~/Downloads and the status line said so
   * in the past tense, with no error. On this machine that window is ~30 ms
   * (three round trips, measured); on a CI runner drawing through a software
   * rasteriser it is long enough that the e2e spec, reading 1.5 s after the
   * window opened, still saw "browser fs".
   *
   * The bridge here answers the probe only after a delay, which is exactly the
   * loaded host. The click must reach `write_text`, not `downloadFile`.
   */
  it('a Save clicked WHILE the probe is in flight still writes to the PyMOL host', async () => {
    // No `arg`: an editor opened from the Dialogs panel, which is how the e2e
    // spec opens it. Nothing else is in flight, so the only thing that can
    // decide where the bytes go is the probe.
    const stub = makeSession({
      // Long enough that no number of microtask turns can hide the race.
      slowProbeMs: 250,
    });
    openTextEditor('');
    act(() =>
      root.render(
        <SessionContext.Provider value={stub.session}>
          <TextEditorSlot />
        </SessionContext.Provider>,
      ),
    );
    await flush(2);

    // Still undecided — this is the window the defect lived in.
    expect(q('.txted__access')?.getAttribute('data-txted-access')).toBe('probing');

    const downloads: string[] = [];
    const anchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function patched(this: HTMLAnchorElement) {
      if (this.download) downloads.push(this.download);
    };
    const prompt = window.prompt;
    window.prompt = () => '/work/typed.pml';
    try {
      await act(async () => {
        q<HTMLButtonElement>('[data-txted-saveas]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await settle();
      // The write itself is on the same slow wire.
      for (let i = 0; i < 40 && status() === ''; i += 1) await flush(1, 20);
    } finally {
      HTMLAnchorElement.prototype.click = anchorClick;
      window.prompt = prompt;
    }

    expect(downloads).toEqual([]);
    const writes = stub.calls.filter((c) => c.fn === 'cmd.tenmol_files.write_text');
    expect(writes.map((c) => c.args[0])).toEqual(['/work/typed.pml']);
    expect(status()).toBe('wrote /work/typed.pml');
  });

  /**
   * THE LATCH — the half of the defect a longer probe does not reach.
   *
   * `probeServerFiles` is bounded on purpose, so on a host slow enough it WILL
   * run out of rounds. What made that a data-loss bug rather than a slow start
   * is that the answer was permanent: `access` was written once and every
   * later Open and Save read it, so a window that lost the race saved to
   * ~/Downloads for the rest of its life — while `cmd.tenmol_files` sat
   * installed on the bridge, put there a second later by the app itself
   * (`FileDropTarget`'s `armPluginDialogs`, five attempts a second apart).
   *
   * MEASURED, with the bridge made to behave like the CI runner's software
   * rasteriser: the editor's probe started asking at ~2.4 s and the app's own
   * `_tf.install()` did not land until 4.775 s. That gap is this test.
   */
  it('a Save re-asks and reaches the host when the namespace installed LATE', async () => {
    const stub = makeSession({ noFiles: true });
    openTextEditor('');
    await mount(stub);
    // The probe genuinely ran out of rounds — this is the state the user is in.
    expect(await settle()).toBe('browser');

    // …and now the bridge has it, exactly as the app's own bootstrap delivers it.
    stub.installNow();

    const downloads: string[] = [];
    const anchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function patched(this: HTMLAnchorElement) {
      if (this.download) downloads.push(this.download);
    };
    const prompt = window.prompt;
    window.prompt = () => '/work/late.pml';
    try {
      await act(async () => {
        q<HTMLButtonElement>('[data-txted-saveas]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      for (let i = 0; i < 40 && status() !== 'wrote /work/late.pml'; i += 1) await flush(1, 20);
    } finally {
      HTMLAnchorElement.prototype.click = anchorClick;
      window.prompt = prompt;
    }

    // The bytes went to the PyMOL host, not to ~/Downloads…
    expect(downloads).toEqual([]);
    expect(
      stub.calls.filter((c) => c.fn === 'cmd.tenmol_files.write_text').map((c) => c.args[0]),
    ).toEqual(['/work/late.pml']);
    expect(status()).toBe('wrote /work/late.pml');
    // …and the panel stopped claiming otherwise.
    expect(q('.txted__access')?.getAttribute('data-txted-access')).toBe('server');
  });

  it('still downloads when the bridge really has no file service', async () => {
    const stub = makeSession({ noFiles: true });
    openTextEditor('');
    await mount(stub);
    expect(await settle()).toBe('browser');

    const downloads: string[] = [];
    const anchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function patched(this: HTMLAnchorElement) {
      if (this.download) downloads.push(this.download);
    };
    // jsdom has no object URLs; `downloadFile` is exercised for real here, so
    // the two halves of that API have to exist.
    const objectUrl = URL as unknown as Record<string, unknown>;
    const hadCreate = objectUrl['createObjectURL'];
    const hadRevoke = objectUrl['revokeObjectURL'];
    objectUrl['createObjectURL'] = () => 'blob:test';
    objectUrl['revokeObjectURL'] = () => undefined;
    try {
      await act(async () => {
        q<HTMLButtonElement>('[data-txted-save]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      for (let i = 0; i < 40 && downloads.length === 0; i += 1) await flush(1, 20);
    } finally {
      HTMLAnchorElement.prototype.click = anchorClick;
      objectUrl['createObjectURL'] = hadCreate;
      objectUrl['revokeObjectURL'] = hadRevoke;
    }

    expect(downloads).toEqual(['untitled.pml']);
    expect(stub.calls.some((c) => c.fn === 'cmd.tenmol_files.write_text')).toBe(false);
    expect(q('.txted__access')?.getAttribute('data-txted-access')).toBe('browser');
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
    // A bootstrap round is `do` -> PAUSE -> ask, so this is not a microtask
    // away: the pause is deliberate and `settle` is what waits for it.
    expect(await settle()).toBe('server');
    for (let i = 0; i < 40 && area().value === ''; i += 1) await flush(1, 20);

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
