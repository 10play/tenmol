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
        try {
          await api.ensure();
        } catch (error) {
          say(` drop failed: ${String(error)}`, 'error');
          return;
        }
        for (const file of plan.files) {
          const uploaded = await api.upload(file.name, await fileToBase64(file));
          if (!uploaded.ok) {
            say(` upload failed: ${uploaded.error}`, 'error');
            continue;
          }
          await load(uploaded.path, file.name);
        }
      })();
    };

    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [session]);

  return null;
}
