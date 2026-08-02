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
  /** `askdirectory` — a folder, not a file. `mimic_tk.py:104-108`. */
  'open-directory',
  'message',
] as const;
export type DialogKind = (typeof DIALOG_KINDS)[number];

/** The seven `tkFileDialog` entry points `mimic_tk.py:36-108` implements. */
export const TK_DIALOG_ENTRIES = [
  'askopenfilename',
  'askopenfilenames',
  'askopenfile',
  'askopenfiles',
  'asksaveasfilename',
  'asksaveasfile',
  'askdirectory',
] as const;
export type TkDialogEntry = (typeof TK_DIALOG_ENTRIES)[number];

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
  /**
   * `'opened'` when the request appeared, `'closed'` when it stopped waiting.
   *
   * The second one is not decoration. A parked dialog also disappears when the
   * blocked thread's own timeout fires (`DialogBroker.DEFAULT_TIMEOUT`, 300 s,
   * after which the shim returns tkinter's `''`), and when a SECOND browser on
   * the same bridge answers it. A UI that only ever hears about openings leaves
   * a dead picker on screen in both cases.
   */
  event?: 'opened' | 'closed';
  /**
   * The exact tkinter entry point, which `kind` cannot express: `askopenfile`
   * and `askopenfilename` are both `open-file`, but one wants a path back and
   * the other an open handle, and `askopenfilenames` wants a LIST.
   */
  entry?: TkDialogEntry | string;
  /** The shim's raw options (`title`, `initialdir`, `initialfile`, `filter`,
   * `filters`, `multiple`) exactly as `BridgeFileDialog._payload` built them. */
  options?: Readonly<Record<string, unknown>>;
  /** Seconds the calling Python thread has already been blocked. */
  waitingFor?: number;
}

/** The client's answer, sent as `{t:'call', fn:'_bridge.answer_dialog'}`.
 *
 * This route now EXISTS. It did not until wave 10, which is the whole reason
 * `panels/files.py` inverted the protocol and made the client poll
 * `cmd.tenmol_files.dialog_pending` every 700 ms instead. It is answered on the
 * socket thread rather than through the draw pump on purpose: the case that
 * matters is a plugin dialog raised while a long engine call is running, and
 * queueing the ANSWER behind that call is precisely the deadlock the poll was
 * invented to dodge.
 */
export interface DialogAnswer {
  dialogId: number;
  /** null means cancelled; a list for the `*names` / `*files` entry points. */
  value: string | readonly string[] | boolean | null;
}
