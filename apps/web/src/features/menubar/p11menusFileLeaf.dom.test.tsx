/**
 * Row 61 — the census, made to prove the last leaf is LIVE and not just enabled.
 *
 * `p10menusFileTree.dom.test.tsx` counts the File tree (32 leaves) and the
 * leaves that refuse (3, after this wave). That is a census of APPEARANCE:
 * a leaf whose hook is registered to a function that throws, or that opens a
 * window nobody draws, passes it. `Edit pymolrc` was the last row-61 gap and it
 * is exactly the kind of leaf that can be enabled and dead — the hook has to
 * reach `features/texteditor`, mount an overlay slot the shell owns, create a
 * window in a module store, and only then read a file over the bridge.
 *
 * So this file clicks it, with the same wiring the shell uses, and asserts the
 * BYTES the bridge served are on screen.
 *
 * WHY `installFileMenuHooks()` DIRECTLY AND NOT `<FileDropTarget/>`: that
 * component is the production installer and `p10menusFileTree` already mounts it
 * to prove so. Here the subject is the leaf, and pulling in the drop target's
 * plugin-dialog host would make this test fail for reasons that have nothing to
 * do with row 61.
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
import { panelsStore, resetPanelHooks } from '../../shell/panelHooks';
import { BOUND_FILE_HOOKS, installFileMenuHooks } from '../files/menuHooks';
import { dialogsStore } from '../dialogs/store';
import { PYMOLRC_ARG } from '../texteditor/openEditor';
import { TextEditorSlot } from '../texteditor/TextEditorPanel';
import { MenuBar } from './MenuBar';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOME = '/Users/amirangel';
const RC = `${HOME}/.pymolrc`;
const RC_BODY = 'set ray_trace_mode, 1\nbg_color white\n';

interface Stub {
  session: Session;
  calls: Array<{ fn: string; args: readonly unknown[] }>;
}

function makeSession(options: { rcPaths?: string[]; rcText?: string | null } = {}): Stub {
  const calls: Array<{ fn: string; args: readonly unknown[] }> = [];
  const session = {
    config: {} as Session['config'],
    conn: { sendInput: vi.fn(), isOpen: true, do: () => Promise.resolve(undefined) },
    stores: {
      connection: createConnectionStore('ws://test/ws', true),
      feedback: createFeedbackStore(),
      objects: createObjectsStore(),
      ui: createUiStore(null),
    },
    objectsSource: { poll: vi.fn(), invalidate: vi.fn() },
    poller: { stats: () => ({ hz: 30 }) },
    run: () => Promise.resolve(),
    act: () => Promise.resolve(undefined),
    call: (fn: string, args: readonly unknown[] = []) => {
      calls.push({ fn, args });
      if (fn === 'cmd.tenmol_files.pymolrc') {
        return Promise.resolve({ paths: options.rcPaths ?? [RC], home: HOME });
      }
      if (fn === 'cmd.tenmol_files.read_text') {
        const path = String(args[0] ?? '');
        if (path === '') return Promise.resolve({ path: '', ok: false, text: '', error: 'no path' });
        const text = options.rcText;
        if (text === null) {
          return Promise.resolve({
            path,
            ok: false,
            text: '',
            error: `[Errno 2] No such file or directory: '${path}'`,
          });
        }
        return Promise.resolve({ path, ok: true, text: text ?? RC_BODY });
      }
      // Everything else refused: the tree under test is the CHECKED-IN one.
      return Promise.reject(new Error(`offline: ${fn}`));
    },
    reconnect: vi.fn(),
    disconnect: vi.fn(),
    useToken: vi.fn(),
    probeHealth: vi.fn(),
  } as unknown as Session;
  return { session, calls };
}

/** `FileDropTarget`'s one effect, without the rest of `FileDropTarget`. */
function HookInstaller() {
  useEffect(() => installFileMenuHooks(), []);
  return null;
}

/** `AppShell.OverlayLayer`, reduced to the slot this leaf needs. */
function Host() {
  const open = useSyncExternalStore(
    (listener) => panelsStore().subscribe(listener),
    () => panelsStore().get().open,
  );
  return (
    <>
      <MenuBar />
      <HookInstaller />
      {open.includes('texteditor') && <TextEditorSlot />}
    </>
  );
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

async function settle(times = 6): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Mount, open File, and return the leaf rows in tree order (paths joined). */
async function openFile(stub: Stub): Promise<Map<string, HTMLElement>> {
  act(() =>
    root.render(
      <SessionContext.Provider value={stub.session}>
        <Host />
      </SessionContext.Provider>,
    ),
  );
  await settle(4);
  const button = [...container.querySelectorAll<HTMLButtonElement>('.menubar__item')].find(
    (el) => el.textContent?.trim() === 'File',
  );
  if (!button) throw new Error('no File menu');
  act(() => button.click());

  const out = new Map<string, HTMLElement>();
  const walk = (scope: ParentNode, prefix: readonly string[]): void => {
    for (const el of scope.querySelectorAll<HTMLElement>(':scope > .menu__row')) {
      const label = el.querySelector(':scope > .menu__label')?.textContent?.trim() ?? '';
      const path = [...prefix, label];
      if (el.getAttribute('aria-haspopup') === 'menu') {
        act(() => el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
        const sub = el.querySelector<HTMLElement>(':scope > .menu');
        if (!sub) throw new Error(`submenu ${label} did not open`);
        walk(sub, path);
        continue;
      }
      out.set(path.join(' > '), el);
    }
  };
  const list = container.querySelector<HTMLElement>('.menubar__item-wrap .menu');
  if (!list) throw new Error('the File menu did not open');
  walk(list, []);
  return out;
}

const q = <T extends HTMLElement>(selector: string): T | null =>
  document.body.querySelector<T>(selector);

describe('row 61 — Edit pymolrc is live, not merely enabled', () => {
  it('is enabled and no longer names an owner who has not built it', async () => {
    const leaves = await openFile(makeSession());
    const leaf = leaves.get('Edit pymolrc');
    expect(leaf).toBeDefined();
    expect((leaf as HTMLButtonElement).disabled).toBe(false);
    expect(leaf?.getAttribute('title')).toBe('hook edit_pymolrc');
    expect(BOUND_FILE_HOOKS).toContain('edit_pymolrc');
  });

  it('opens an editor holding the pymolrc the bridge served', async () => {
    const stub = makeSession();
    const leaves = await openFile(stub);
    act(() => (leaves.get('Edit pymolrc') as HTMLButtonElement).click());
    await settle(8);

    // 1. the slot the shell owns was asked to mount…
    expect(panelsStore().get().open).toContain('texteditor');
    // 2. …one window, keyed by the sentinel…
    const windows = dialogsStore.get().windows.filter((w) => w.kind === 'texteditor');
    expect(windows).toHaveLength(1);
    expect(windows[0]?.arg).toBe(PYMOLRC_ARG);
    // 3. …the bridge was asked WHICH pymolrc, then for its bytes…
    expect(stub.calls.map((c) => c.fn)).toContain('cmd.tenmol_files.pymolrc');
    expect(
      stub.calls.filter((c) => c.fn === 'cmd.tenmol_files.read_text').map((c) => c.args[0]),
    ).toContain(RC);
    // 4. …and the bytes are on screen, at that path.
    expect(q<HTMLTextAreaElement>('[data-txted-area]')?.value).toBe(RC_BODY);
    expect(q('.txted__path')?.textContent?.trim()).toBe(RC);
    // 5. the window titles itself the way `TextEditor.py:43-45` does.
    expect(q('.dlgwin__title')?.textContent).toContain(`.pymolrc (${HOME})`);
  });

  it('opens an empty buffer AIMED at the path when there is no rc file yet', async () => {
    // The measured state of this machine: `pymolrc()` -> `{'paths': []}`.
    const stub = makeSession({ rcPaths: [], rcText: null });
    const leaves = await openFile(stub);
    act(() => (leaves.get('Edit pymolrc') as HTMLButtonElement).click());
    await settle(8);

    expect(q<HTMLTextAreaElement>('[data-txted-area]')?.value).toBe('');
    expect(q('.txted__path')?.textContent?.trim()).toBe(RC);
    expect(q('.txted__status')?.textContent?.trim()).toBe(
      `${RC} does not exist yet — Save will create it`,
    );
    // Not an error: Qt's own answer to this is a "Create new pymolrc?" prompt.
    expect(q('.txted__error')).toBeNull();
  });

  it('the census is now 32 leaves and 3 refusals, and Edit pymolrc is in neither', async () => {
    const leaves = await openFile(makeSession());
    expect(leaves.size).toBe(32);
    const refused = [...leaves]
      .filter(([, el]) => (el as HTMLButtonElement).disabled || el.className.includes('is-disabled'))
      .map(([label]) => label);
    expect(refused).toEqual([
      'New PyMOL Window > Default',
      'New PyMOL Window > Ignore .pymolrc and plugins (-k)',
      'Open Recent... > no recent files',
    ]);
  });
});
