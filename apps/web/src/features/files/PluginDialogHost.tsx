/**
 * ROW 295 — where a blocked legacy plugin's file dialog actually appears.
 *
 * `panels/files.py::BridgeFileDialog` stands in for `pmg_qt/mimic_tk.py`'s
 * `_qtFileDialog`: a plugin calls `tkinter.filedialog.askopenfilename()`, the
 * shim parks the request on `DialogBroker` and BLOCKS that plugin's thread
 * until the browser posts an answer. This is the browser half — it polls
 * `dialog_pending`, opens the same `PathPicker` every other dialog in this
 * area uses, and posts the answer with `dialog_answer`.
 *
 * WHY IT IS ITS OWN COMPONENT.  It used to be an effect inside `FilesPanel`,
 * which is an OVERLAY slot (`features/registry.ts`, region `overlay`): React
 * only mounts it while the user has the File dialogs panel open. So a plugin
 * that asked for a file with that panel closed showed NOTHING and stayed
 * blocked — for `DialogBroker.DEFAULT_TIMEOUT`, 300 s, after which the shim
 * returns tkinter's `''` and the plugin quietly does nothing. Upstream has no
 * such window: `mimic_tk`'s `QFileDialog.getOpenFileName(None, ...)` is a
 * parentless application-modal dialog that appears whatever else is open.
 *
 * `FileDropTarget` renders this, because that is the one part of the files
 * feature the viewport slot mounts unconditionally — the same reason the drop
 * handler, the Ctrl+O/Ctrl+S accelerators and `install_tk_dialogs` live there.
 *
 * There must be exactly ONE of these: two pollers would both claim the same
 * request, both open a picker, and the second `dialog_answer` would come back
 * `{answered: false, error: 'no open dialog N'}`.
 *
 * WHY IT POLLS rather than riding a push topic: see `pluginDialogs.ts`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useSession } from '../../app';
import { createFilesApi } from './filesApi';
import { PathPicker, type PickerRequest, type PickerResult } from './PathPicker';
import {
  PLUGIN_DIALOG_POLL_MS,
  answerForPluginDialog,
  pickerForPluginDialog,
  pluginDialogMessage,
} from './pluginDialogs';
import type { PluginDialogRequest } from '@tenmol/protocol/topics/files';

interface Live {
  request: PluginDialogRequest;
  picker: PickerRequest;
}

export function PluginDialogHost() {
  const session = useSession();
  const api = useMemo(
    () =>
      createFilesApi({
        call: (fn, args, kwargs) => session.call(fn, args ?? [], kwargs ?? {}),
        do: (line) => session.conn.do(line),
      }),
    [session],
  );

  const say = useCallback(
    (line: string, kind?: 'error' | 'warning') => {
      session.stores.feedback.appendClient(line, kind);
    },
    [session],
  );

  const [live, setLive] = useState<Live | null>(null);
  /** Set while a picker is on screen, so the poll does not claim a second one. */
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (busy.current || cancelled) return;
      let requests: PluginDialogRequest[];
      try {
        requests = await api.dialogPending();
      } catch {
        return; // the service is not installed yet; the next tick retries
      }
      const request = requests[0];
      if (!request || cancelled || busy.current) return;
      busy.current = true;
      say(pluginDialogMessage(request));
      setLive({ request, picker: pickerForPluginDialog(request) });
    };

    const timer = window.setInterval(() => void tick(), PLUGIN_DIALOG_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [api, say]);

  const finish = useCallback(
    (request: PluginDialogRequest, result: PickerResult | null) => {
      setLive(null);
      void (async () => {
        try {
          await api.dialogAnswer(
            request.dialogId,
            answerForPluginDialog(request, result ? result.paths : null),
          );
        } catch (e) {
          say(` plugin dialog failed: ${String(e)}`, 'error');
          await api.dialogCancel(request.dialogId).catch(() => undefined);
        } finally {
          busy.current = false;
        }
      })();
    },
    [api, say],
  );

  if (!live) return null;
  return (
    <PathPicker
      api={api}
      request={live.picker}
      onCancel={() => finish(live.request, null)}
      onAccept={(result) => finish(live.request, result)}
    />
  );
}
