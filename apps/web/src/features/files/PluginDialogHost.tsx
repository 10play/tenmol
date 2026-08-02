/**
 * ROW 295 — where a blocked legacy plugin's file dialog actually appears.
 *
 * `panels/files.py::BridgeFileDialog` stands in for `pmg_qt/mimic_tk.py`'s
 * `_qtFileDialog`: a plugin calls `tkinter.filedialog.askopenfilename()`, the
 * shim parks the request on `DialogBroker` and BLOCKS that plugin's thread
 * until the browser posts an answer. This is the browser half — it listens on
 * the `dialog` topic, opens the same `PathPicker` every other dialog in this
 * area uses, and answers through `_bridge.answer_dialog`.
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
 * There must be exactly ONE of these: two hosts would both claim the same
 * request, both open a picker, and the second answer would come back
 * `{answered: false, error: 'no open dialog N'}`.
 *
 * IT IS PUSHED NOW, NOT POLLED.  Until wave 10 the bridge had no route for
 * `_bridge.answer_dialog` and published nothing on the `dialog` topic, so this
 * component asked `cmd.tenmol_files.dialog_pending` every 700 ms — a plugin's
 * modal dialog appeared 0-700 ms after the plugin blocked, and the answer
 * queued behind whatever the draw pump was doing. Both halves exist now
 * (`BridgeServer.DIALOG_ROUTES`, `_flush_dialogs`), so:
 *
 *   * `sub('dialog')` + `on('dialog')` replaces the poll. Measured in Chrome
 *     against a real plugin worker thread blocked in `askopenfilename`, three
 *     consecutive dialogs: the picker was on screen 401 / 78 / 98 ms after the
 *     engine started the thread, of which 397 / 75 / 94 ms was the bridge's
 *     10 Hz sweep (the payload's own `waitingFor` agreed: 0.397 s on the first)
 *     and 4 / 3 / 3 ms was this component. The poll it replaces ran every
 *     700 ms — a 0-700 ms window, ~350 ms mean, on top of the same sweep.
 *   * `_bridge.answer_dialog` is answered on the SOCKET thread, so a dialog
 *     raised while a long `cmd.*` call is running can still be answered —
 *     the deadlock the inverted protocol was invented to dodge.
 *   * `'closed'` events matter as much as `'opened'` ones. A parked dialog
 *     also disappears on its own 300 s timeout and when a second browser
 *     answers it; a UI that only heard about openings would leave a dead
 *     picker on screen, and the user's next choice would be answered
 *     `no open dialog N`.
 *
 * ONE READ IS NOT A POLL.  The topic only reports TRANSITIONS, and
 * `BridgeServer._dialog_seen` is process-wide rather than per-session: a
 * dialog that was already parked before this tab connected has already been
 * announced to nobody, and will never be announced again. `pnpm dev` reloads
 * the page constantly, so that is not a corner case. Hence `reconcile()` —
 * one `_bridge.pending_dialogs` on mount and on every reconnect, never on a
 * timer.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useSession } from '../../app';
import { createFilesApi } from './filesApi';
import { PathPicker, type PickerRequest, type PickerResult } from './PathPicker';
import {
  answerForPluginDialog,
  pickerForPluginDialog,
  pluginDialogMessage,
} from './pluginDialogs';
import type { DialogPayload } from '@tenmol/protocol/topics/dialog';
import type { PluginDialogKind, PluginDialogRequest } from '@tenmol/protocol/topics/files';

/**
 * NOT DECORATION — WITHOUT THIS LINE THE DIALOG CANNOT BE CLICKED.
 *
 * `files.css` was imported by `FilesPanel.tsx` alone, and `FilesPanel` is an
 * OVERLAY panel: its chunk, and therefore its stylesheet, is only fetched once
 * the user opens the File dialogs panel. This component is mounted for the life
 * of the app and renders the same `PathPicker` markup, so with that panel never
 * opened the picker rendered with `.fdlg__backdrop` UNSTYLED.
 *
 * Measured in Chrome at 1280x900, before this import: the backdrop computed to
 * `position: static; z-index: auto` instead of `position: fixed; inset: 0;
 * z-index: 80`, so the whole dialog laid out INSIDE the viewport panel as a
 * 1056x80 strip at y=24 — and `document.elementFromPoint` at the centre of the
 * title, of every listing row and of both buttons returned the WebGL `canvas`,
 * `div.viewport__hud-line` and `span.viewport__hud-rep-name`. Playwright called
 * the Choose button "visible, enabled and stable" and then timed out clicking
 * it: `<div class="viewport__hud-line"> ... intercepts pointer events`. jsdom
 * lays nothing out and loads no CSS, which is why five DOM tests were green
 * while the dialog was unusable in a browser.
 */
import './files.css';

interface Live {
  request: PluginDialogRequest;
  picker: PickerRequest;
}

/** `DialogKind` -> the tkinter entry point, for a payload with no `entry`. */
const ENTRY_FOR_KIND: Record<string, PluginDialogKind> = {
  'open-file': 'askopenfilename',
  'save-file': 'asksaveasfilename',
  'open-directory': 'askdirectory',
};

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * A pushed `dialog` payload -> the row shape `dialog_pending` returns.
 *
 * Both paths must produce the same thing, because `pickerForPluginDialog` and
 * `answerForPluginDialog` decide the picker MODE and the answer SHAPE from
 * `kind` and `options.multiple` — `askopenfilenames` must be answered with a
 * list even for one file (`mimic_tk.py:62-63`).
 *
 * `payload.options` is `BridgeFileDialog._payload`'s raw options, forwarded
 * verbatim by `session.py::plugin_dialog_payload`, which is why this is a
 * re-shaping and not a reconstruction. `payload.filters` (the `[label, glob]`
 * pairs the protocol declares) is deliberately NOT used here: the picker's
 * filter dropdown takes Qt filter strings, and `options.filters` is exactly
 * what `mimic_tk._getfilter` built.
 */
export function requestFromDialogPayload(payload: DialogPayload): PluginDialogRequest {
  const options = (payload.options ?? {}) as Record<string, unknown>;
  const entry = str(payload.entry) || ENTRY_FOR_KIND[payload.kind] || 'askopenfilename';
  return {
    dialogId: payload.dialogId,
    kind: entry as PluginDialogKind,
    options: {
      title: str(options.title) || payload.title || '',
      initialdir: str(options.initialdir) || str(payload.directory),
      initialfile: str(options.initialfile) || str(payload.initial),
      filter: str(options.filter),
      filters: Array.isArray(options.filters) ? options.filters.map(String) : [],
      multiple: Boolean(options.multiple),
    },
    waitingFor: typeof payload.waitingFor === 'number' ? payload.waitingFor : 0,
  };
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
  /** Mirrors `live` for the event handlers, which must not close over state. */
  const liveRef = useRef<Live | null>(null);
  /** Requests that arrived while another picker was on screen. */
  const waiting = useRef<PluginDialogRequest[]>([]);
  /** Every id ever offered, so a reconcile cannot re-open a live picker. */
  const claimed = useRef<Set<number>>(new Set());

  const show = useCallback((next: Live | null) => {
    liveRef.current = next;
    setLive(next);
  }, []);

  /** Put the next queued request on screen, if nothing is on screen. */
  const pump = useCallback(() => {
    if (liveRef.current) return;
    const next = waiting.current.shift();
    if (!next) return;
    say(pluginDialogMessage(next));
    show({ request: next, picker: pickerForPluginDialog(next) });
  }, [say, show]);

  const offer = useCallback(
    (request: PluginDialogRequest) => {
      if (claimed.current.has(request.dialogId)) return;
      claimed.current.add(request.dialogId);
      waiting.current.push(request);
      pump();
    },
    [pump],
  );

  /** The dialog stopped waiting without us: timeout, or another browser. */
  const retire = useCallback(
    (dialogId: number) => {
      waiting.current = waiting.current.filter((r) => r.dialogId !== dialogId);
      if (liveRef.current?.request.dialogId === dialogId) {
        show(null);
        say(` the plugin stopped waiting for dialog #${dialogId}`, 'warning');
      }
      pump();
    },
    [pump, say, show],
  );

  /**
   * The one read. `_bridge.pending_dialogs` is answered on the socket thread;
   * `dialog_pending` goes through the draw pump and is the fallback for the
   * ~1 s after startup in which the server has not yet cached the broker
   * (`BridgeServer._probe_dialog_broker` runs every 60 engine ticks).
   */
  const reconcile = useCallback(async () => {
    let rows: unknown;
    try {
      rows = await session.call<PluginDialogRequest[]>('_bridge.pending_dialogs');
    } catch {
      try {
        rows = await api.dialogPending();
      } catch {
        return; // no files panel yet; a later dialog arrives on the topic
      }
    }
    // A bridge too old to know the route can answer anything at all; a
    // reconcile is a convenience and must never throw into a React effect.
    if (!Array.isArray(rows)) return;
    for (const row of rows as PluginDialogRequest[]) {
      if (row && typeof row.dialogId === 'number') offer(row);
    }
  }, [api, offer, session]);

  useEffect(() => {
    const offDialog = session.conn.on('dialog', (payload) => {
      if (payload.event === 'closed') retire(payload.dialogId);
      else offer(requestFromDialogPayload(payload));
    });
    // Queued while the socket is down and flushed on open; the client re-sends
    // live subscriptions itself after a reconnect, so this happens once and is
    // never torn down — the component is mounted for the life of the app.
    void session.conn.sub('dialog').catch(() => undefined);
    // A reload cannot be told about a dialog that was already parked, so ask.
    const offOpen = session.conn.on('connection:open', () => void reconcile());
    void reconcile();
    return () => {
      offDialog();
      offOpen();
    };
  }, [offer, reconcile, retire, session]);

  const finish = useCallback(
    (request: PluginDialogRequest, result: PickerResult | null) => {
      show(null);
      pump();
      const value = answerForPluginDialog(request, result ? result.paths : null);
      void (async () => {
        try {
          // NOT `cmd.tenmol_files.dialog_answer`: that is queued behind the
          // draw pump, and the case that matters is a plugin dialog raised
          // while a long engine call is running.
          await session.call('_bridge.answer_dialog', [
            { dialogId: request.dialogId, value },
          ]);
        } catch {
          try {
            await api.dialogAnswer(request.dialogId, value);
          } catch (e) {
            say(` plugin dialog failed: ${String(e)}`, 'error');
            await api.dialogCancel(request.dialogId).catch(() => undefined);
          }
        }
      })();
    },
    [api, pump, say, session, show],
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
