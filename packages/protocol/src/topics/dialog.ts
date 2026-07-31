/**
 * Topic `dialog` — blocking Python dialogs, hoisted to the browser.  OWNER: WP-18.
 *
 * `modules/pymol/file_dialogs.py:88` uses `exec()`, and the tkinter shim
 * `modules/pmg_qt/mimic_tk.py:36-90` BLOCKS THE CALLING THREAD. So the bridge
 * emits this event, the browser answers, and a `Future` unblocks the caller.
 *
 * HARD RULE WITH A DEDICATED TEST (plan §6 WP-18): the request must be issued
 * from a worker thread, NEVER the engine thread — otherwise the 60 Hz pump
 * stops and the entire UI freezes.
 */

export const DIALOG_KINDS = [
  'ask-ok-cancel',
  'ask-yes-no',
  'ask-string',
  'open-file',
  'save-file',
  'message',
] as const;
export type DialogKind = (typeof DIALOG_KINDS)[number];

export interface DialogPayload {
  /** Correlates the answer back to the blocked `Future`. */
  dialogId: number;
  kind: DialogKind;
  title: string;
  message: string;
  /** For file dialogs: filter list as `[label, '*.pdb *.cif']` pairs. */
  filters?: readonly (readonly [string, string])[];
  /** For file dialogs: the server-side starting directory. */
  directory?: string;
  /** Prefilled value for `ask-string` / `save-file`. */
  initial?: string;
}

/** The client's answer, sent as `{t:'call', fn:'_bridge.answer_dialog'}`. */
export interface DialogAnswer {
  dialogId: number;
  /** null means cancelled. */
  value: string | boolean | null;
}
