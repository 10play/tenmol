/**
 * Window-level drag & drop, mounted wherever something is always on screen.
 *
 * Renders only `PluginDialogHost` (nothing, until a legacy plugin blocks on a
 * file dialog). See `globalDrop.ts` for why this is not simply the handler
 * `FilesPanel` already had: that one is inside an OVERLAY slot, so it only
 * existed while the user had the File dialogs panel open.
 */

import { useEffect } from 'react';

import { useSession } from '../../app';
import { createFilesApi, fileToBase64 } from './filesApi';
import { PluginDialogHost } from './PluginDialogHost';
import {
  dialogNeededFor,
  dialogRequiredMessage,
  planFromDataTransfer,
  refusalFor,
  windowAccelerator,
} from './globalDrop';
import { takeOpenFromLocation } from './deepLink';
import { installFileMenuHooks, requestFilesOpen } from './menuHooks';
import type { FileClassification } from '@tenmol/protocol/topics/files';

/** Always-mounted window-level drag-and-drop and deep-link file open handler. */
export function FileDropTarget() {
  const session = useSession();

  /*
   * ROW 293 — THE DOCUMENT-HANDLER SEAM, AND IT IS MOUNTED FOR EVER.
   *
   * `?open=<path>` is `handle_file_open_active`'s argument arriving the only
   * way it can reach a browser tab (see `deepLink.ts` for the whole argument).
   * It runs the SAME `load_dialog` pipeline as `File ▸ Open Recent`, so a
   * `.psw` gets the presentation preset and a `.pse` gets the partial
   * question; nothing here decides anything about the file itself.
   *
   * Mount-only, and it consumes the parameter before doing anything with it —
   * StrictMode invokes this twice and a reload would otherwise re-open the
   * file. Here rather than in `FilesPanel` for the usual reason: that is an
   * overlay slot, so it does not exist when the app starts.
   */
  useEffect(() => {
    const paths = takeOpenFromLocation();
    if (paths.length > 0) requestFilesOpen(paths);
  }, []);

  /*
   * ROW 242 — BIND THE FILE MENU'S LEAVES, AND DO IT HERE.
   *
   * Every `File ▸ …` entry is a `hook` action naming a `_gui.py` seam
   * (`generated/menudata.ts`), and until something calls `registerMenuHook`
   * for it the leaf renders disabled with "not built yet — WP-18 owns it".
   * WP-18 is this feature. The registration must outlive the File dialogs
   * panel, which is an overlay slot mounted only while it is open — so it
   * lives in the one part of this feature that is always mounted, exactly like
   * the drop handler and the Ctrl+O/Ctrl+S accelerators below.
   */
  useEffect(() => installFileMenuHooks(), []);

  useEffect(() => {
    const api = createFilesApi({
      call: (fn, args, kwargs) => session.call(fn, args ?? [], kwargs ?? {}),
      do: (line) => session.conn.do(line),
    });
    const say = (line: string, kind?: 'error' | 'warning') =>
      session.stores.feedback.appendClient(line, kind);

    /*
     * ROW 295 — INSTALL THE PLUGIN FILE-DIALOG SHIM, AND DO IT HERE.
     *
     * `panels/files.py::BridgeFileDialog` only reaches a plugin once
     * `install_tk_dialogs` has run: `files.install()` deliberately does NOT
     * install it (that would put `tkFileDialog` in `sys.modules` for every
     * bridge process, which `packages/bridge/tests/test_wf_plugins.py` asserts against).
     * Nothing was calling it, so `import tkinter.filedialog` inside PyMOL still
     * resolved to the REAL module — and that is not a cosmetic difference:
     * MEASURED on macOS, a plugin worker thread calling the real
     * `askopenfilename()` inside this process aborts it outright
     * ("NSInternalInconsistencyException ... NSWindow should only be
     *  instantiated on the main thread", `Fatal Python error: Aborted`,
     * exit 134). Upstream has the same requirement and meets it by importing
     * `pmg_qt.mimic_tk` at GUI start (`mimic_tk.py:96-127`).
     *
     * It lives in this component because this is the only part of the files
     * feature that is ALWAYS mounted: `FilesPanel` is an overlay slot
     * (`registry.ts` region 'overlay'), so anything hung off it exists only
     * while the user has the File dialogs panel open — the same bug the drop
     * handler had. Retried a few times because the socket may not be up on the
     * first tick; it stops on the first success.
     */
    let installTimer: number | undefined;
    let disposed = false;
    let attempts = 0;
    const armPluginDialogs = async (): Promise<void> => {
      if (disposed) return;
      attempts += 1;
      try {
        await api.ensure();
        await api.installTkDialogs();
      } catch {
        if (disposed || attempts >= 5) return;
        installTimer = window.setTimeout(() => void armPluginDialogs(), 1000);
      }
    };
    void armPluginDialogs();

    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer) return;
      // Without preventDefault the browser NAVIGATES to the dropped file and
      // the whole app is replaced by a PDB in a text viewer.
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    };

    const load = async (path: string, label: string) => {
      try {
        const info = await session.call<FileClassification>(
          'cmd.tenmol_files.classify',
          [path],
        );
        // Refusals FIRST: a `.pwg` classifies as `plain` and would otherwise
        // go straight to `cmd.load`, which executes it. See `refusalFor`.
        const refusal = refusalFor(info, label);
        if (refusal !== null) {
          say(refusal, 'warning');
          return;
        }
        const dialog = dialogNeededFor(info);
        if (dialog !== null) {
          say(dialogRequiredMessage(label, dialog), 'warning');
          return;
        }
        await session.run(`load ${path}`);
      } catch (error) {
        say(` drop failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
      }
    };

    /** Upload each browser File, then load it — shared by drop and Ctrl+O. */
    const uploadAndLoad = async (files: readonly File[]): Promise<void> => {
      try {
        await api.ensure();
      } catch (error) {
        say(` file service unavailable: ${String(error)}`, 'error');
        return;
      }
      for (const file of files) {
        const uploaded = await api.upload(file.name, await fileToBase64(file));
        if (!uploaded.ok) {
          say(` upload failed: ${uploaded.error}`, 'error');
          continue;
        }
        await load(uploaded.path, file.name);
      }
    };

    const onDrop = (event: DragEvent) => {
      const plan = planFromDataTransfer(event.dataTransfer);
      if (plan.kind === 'none') return;
      event.preventDefault();

      void (async () => {
        if (plan.kind === 'url') {
          // No upload and no filesystem: `cmd.load` reaches a URL through
          // `internal.file_read`, which fetches and gunzips by magic bytes.
          await load(plan.url, plan.url);
          return;
        }
        await uploadAndLoad(plan.files);
      })();
    };

    /*
     * THE WINDOW ACCELERATORS LIVE HERE FOR THE SAME REASON THE DROP DOES.
     *
     * Ctrl+O and Ctrl+S are `pymol_qt_gui.py:387-388`'s "extra Qt shortcuts
     * (MacPyMOL compatible)" — window-level QShortcuts, not PyMOL `set_key`
     * bindings, so they must never reach the viewport key handler. They used
     * to be registered by `FilesPanel`, an OVERLAY slot, so they only worked
     * while the File dialogs panel happened to be open. Same bug as the drop
     * handler had, same fix.
     *
     * REDUCED SCOPE, stated rather than hidden: Ctrl+O here opens the
     * BROWSER's file picker and runs the upload-then-load path above, not the
     * panel's server-side path browser with its modal queue. That queue lives
     * in `FilesPanel` and cannot be driven from outside it. A user who wants
     * the server browser opens the panel; a user who hits Ctrl+O gets a file
     * open, which is what the accelerator promises.
     */
    const onKey = (event: KeyboardEvent) => {
      const accelerator = windowAccelerator(event);
      if (accelerator === null) return;
      event.preventDefault();
      event.stopPropagation();

      if (accelerator === 'open') {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.onchange = () => {
          const files = Array.from(input.files ?? []);
          if (files.length > 0) void uploadAndLoad(files);
        };
        input.click();
        return;
      }

      void (async () => {
        try {
          await api.ensure();
          const file = await api.sessionFile();
          if (!file.hasPath) {
            say(
              ' Ctrl+S: this session has no file yet — use File dialogs ▸ Save Session As…',
              'warning',
            );
            return;
          }
          await session.run(`save ${file.path}`);
          say(` saved ${file.path}`);
        } catch (error) {
          say(` save failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
        }
      })();
    };

    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    window.addEventListener('keydown', onKey, true);
    return () => {
      disposed = true;
      if (installTimer !== undefined) window.clearTimeout(installTimer);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [session]);

  /*
   * ROW 295 — the plugin file-dialog picker is rendered HERE, for the same
   * reason `install_tk_dialogs` is called here: a blocked plugin thread must
   * get its dialog whether or not the File dialogs panel happens to be open.
   * The poller used to live in `FilesPanel` (an overlay slot), so it did not.
   */
  return <PluginDialogHost />;
}
