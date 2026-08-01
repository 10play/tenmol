/**
 * Window-level drag & drop, mounted wherever something is always on screen.
 *
 * Renders nothing. See `globalDrop.ts` for why this is not simply the handler
 * `FilesPanel` already had: that one is inside an OVERLAY slot, so it only
 * existed while the user had the File dialogs panel open.
 */

import { useEffect } from 'react';

import { useSession } from '../../app';
import { createFilesApi, fileToBase64 } from './filesApi';
import {
  dialogNeededFor,
  dialogRequiredMessage,
  planFromDataTransfer,
  windowAccelerator,
} from './globalDrop';
import type { FileClassification } from '@tenmol/protocol/topics/files';

export function FileDropTarget() {
  const session = useSession();

  useEffect(() => {
    const api = createFilesApi({
      call: (fn, args, kwargs) => session.call(fn, args ?? [], kwargs ?? {}),
      do: (line) => session.conn.do(line),
    });
    const say = (line: string, kind?: 'error' | 'warning') =>
      session.stores.feedback.appendClient(line, kind);

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
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [session]);

  return null;
}
