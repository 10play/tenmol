/**
 * ADVERSARIAL VERIFICATION of inventory row 295 — the wiring, not the shim.
 *
 * `bridge/tenmol_bridge/panels/files.py` grew a complete `tkFileDialog`
 * replacement and `bridge/tests/test_wf_files.py` proves it blocks and answers
 * correctly. What NOTHING proved, and what turned out to be false, is that a
 * plugin ever reaches it: `install_tk_dialogs` existed on `FilesApi` and had no
 * caller anywhere in `apps/web/src`, and `files.install()` does not install the
 * shim either. So `import tkinter.filedialog` inside PyMOL still resolved to
 * the real module.
 *
 * That is not a cosmetic gap. MEASURED by deleting the `sys.meta_path` finder
 * and re-running `test_wf_files.py::test_askopenfilename_blocks_...`: the real
 * `tkinter.filedialog.askopenfilename()` on a plugin worker thread inside this
 * process killed it —
 *
 *     *** Terminating app due to uncaught exception
 *         'NSInternalInconsistencyException', reason:
 *         'NSWindow should only be instantiated on the main thread!'
 *     libc++abi: terminating due to uncaught exception of type NSException
 *     Fatal Python error: Aborted
 *
 * pytest exited 134 (SIGABRT). Upstream avoids this by importing
 * `pmg_qt.mimic_tk` at GUI start (`mimic_tk.py:96-127`); the browser client has
 * to do the equivalent, and `FileDropTarget` is where it does it because it is
 * the only always-mounted piece of the files feature.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileDropTarget } from './FileDropTarget';

const appendClient = vi.fn();
const run = vi.fn().mockResolvedValue(undefined);
const call = vi.fn();
const conndo = vi.fn();
const SESSION = {
  call,
  run,
  // `on`/`sub`: `FileDropTarget` mounts `PluginDialogHost`, which subscribes to
  // the `dialog` topic instead of polling (row 295).
  conn: { do: conndo, on: () => () => {}, sub: () => Promise.resolve() },
  stores: { feedback: { appendClient } },
};
vi.mock('../../app', () => ({ useSession: () => SESSION }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

/** Let the mount effect's promise chain settle. */
const settle = async () => {
  for (let i = 0; i < 6; i += 1) await act(async () => void (await Promise.resolve()));
};

const names = () => call.mock.calls.map((c) => c[0] as string);

beforeEach(() => {
  vi.useFakeTimers();
  appendClient.mockClear();
  run.mockClear();
  conndo.mockClear();
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

describe('the plugin file-dialog shim is actually installed (row 295)', () => {
  it('installs it on mount, without waiting for the File dialogs panel', async () => {
    call.mockResolvedValue({ installed: true });

    act(() => root.render(<FileDropTarget />));
    await settle();

    // `hello` first (that is `api.ensure()`), then the shim. Without the second
    // call `tkinter.filedialog` stays the real module and a plugin dialog
    // aborts the process.
    expect(names()).toContain('cmd.tenmol_files.hello');
    expect(names()).toContain('cmd.tenmol_files.install_tk_dialogs');
    expect(names().indexOf('cmd.tenmol_files.hello')).toBeLessThan(
      names().indexOf('cmd.tenmol_files.install_tk_dialogs'),
    );
  });

  it('installs the service first when the bridge has never seen it', async () => {
    // `hello` fails with NotAllowed until `panels.files.install()` has run;
    // `bootstrap()` then `{t:'do'}`s the import and retries.  Keyed on the
    // SYMBOL rather than on call order: `PluginDialogHost` also calls
    // `_bridge.pending_dialogs` once on mount (row 295's reconcile), and which
    // of the two lands first is not this test's subject.
    let firstHello = true;
    call.mockImplementation((fn: string) => {
      if (fn === 'cmd.tenmol_files.hello' && firstHello) {
        firstHello = false;
        return Promise.reject(new Error('NotAllowed: no such symbol'));
      }
      return Promise.resolve({ installed: true });
    });

    act(() => root.render(<FileDropTarget />));
    await settle();

    expect(conndo).toHaveBeenCalledTimes(1);
    expect(names()).toContain('cmd.tenmol_files.install_tk_dialogs');
  });

  it('retries instead of giving up when the socket is not ready yet', async () => {
    call.mockRejectedValue(new Error('not connected'));

    act(() => root.render(<FileDropTarget />));
    await settle();
    const firstTry = names().length;
    expect(firstTry).toBeGreaterThan(0);
    expect(names()).not.toContain('cmd.tenmol_files.install_tk_dialogs');

    call.mockReset();
    call.mockResolvedValue({ installed: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    await settle();

    expect(names()).toContain('cmd.tenmol_files.install_tk_dialogs');
  });
});
