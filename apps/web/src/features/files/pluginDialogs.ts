/**
 * Legacy plugins' blocking file dialogs, hoisted into the browser.
 *
 * WHAT THIS REPLACES.  `modules/pmg_qt/mimic_tk.py:36-108` installs a Qt-backed
 * object as `tkFileDialog` and `tkinter.filedialog` (via a `sys.meta_path`
 * hook) so that every legacy plugin's `askopenfilename` opens a `QFileDialog`
 * and BLOCKS the calling thread until the user answers. Delete that shim and
 * every plugin's Open/Save either hangs on a Tk root that does not exist or
 * pops an invisible native dialog.
 *
 * WHAT REPLACES IT.  `bridge/tenmol_bridge/panels/files.py` installs
 * `BridgeFileDialog` in exactly the same three places, with the same seven
 * entry points and the same RETURN SHAPES — `str`, `list[str]`, an open file
 * object, `None` — because plugins are written against those (`if not
 * filename: return`, `for line in handle`). Instead of Qt it parks the request
 * on a broker and blocks; this module is the browser half that answers.
 *
 * WHY IT POLLS.  `packages/protocol/src/topics/dialog.ts` describes a push
 * `dialog` topic answered through `_bridge.answer_dialog`. Both halves of that
 * live in frozen files (`server.py` routes `_bridge.*` and owns
 * `_emit_topic`), so the rendezvous is inverted rather than forced: the client
 * asks `dialog_pending`, the blocked thread waits. Reported, not smuggled in.
 *
 * THE HARD RULE (plan §6 WP-18) is enforced on the BRIDGE side, not here: a
 * request made from PyMOL's engine thread is refused with an exception,
 * because blocking the draw pump would also block `dialog_answer` — a deadlock,
 * not a slow dialog.
 */

import type { PluginDialogRequest } from '@tenmol/protocol/topics/files';
import type { PickerRequest } from './PathPicker';

/** How often to ask the bridge whether a plugin is blocked. */
export const PLUGIN_DIALOG_POLL_MS = 700;

/**
 * A pending plugin dialog -> the path picker that answers it.
 *
 * `askdirectory` is `QFileDialog.getExistingDirectory` (`mimic_tk.py:86-89`) —
 * mode `dir`. `asksaveasfilename` is a save target, which the picker treats as
 * "type a name, warn before overwrite, apply `getSaveFileNameWithExt`". The
 * two open variants differ only in multi-select, which the picker already does
 * in `open` mode; `multiple` decides how the ANSWER is shaped, not the UI.
 */
export function pickerForPluginDialog(request: PluginDialogRequest): PickerRequest {
  const filters = request.options.filters.length > 0 ? request.options.filters : undefined;
  const title = request.options.title || defaultTitle(request.kind);
  const base: PickerRequest = {
    mode: request.kind === 'askdirectory' ? 'dir' : request.kind === 'asksaveasfilename' ? 'save' : 'open',
    title: `Plugin: ${title}`,
    filters,
    directory: request.options.initialdir || undefined,
    initialName: request.options.initialfile || undefined,
    accept: request.kind === 'asksaveasfilename' ? 'Save' : 'Choose',
  };
  return base;
}

/**
 * tkinter's own default titles (`Lib/tkinter/filedialog.py`), used when the
 * plugin passes none — `mimic_tk` hands Qt `options.get('title', '')`, which
 * gives an untitled dialog, and an untitled modal in a browser is a mystery.
 */
function defaultTitle(kind: PluginDialogRequest['kind']): string {
  switch (kind) {
    case 'asksaveasfilename':
      return 'Save As';
    case 'askdirectory':
      return 'Choose a directory';
    case 'askopenfilenames':
      return 'Open files';
    default:
      return 'Open';
  }
}

/**
 * The picker's result -> the value `dialog_answer` expects.
 *
 * `askopenfilenames` must answer with a LIST even when one path was chosen,
 * because `askopenfile(multiple=1)` does `[open(f, mode) for f in r]` and a
 * bare string would be iterated character by character
 * (`mimic_tk.py:62-63`). Cancel is `null`, which the shim turns back into
 * tkinter's `''` (or `[]` for the multiple form).
 */
export function answerForPluginDialog(
  request: PluginDialogRequest,
  paths: readonly string[] | null,
): string | string[] | null {
  if (paths === null || paths.length === 0) return null;
  if (request.options.multiple) return [...paths];
  return paths[0] ?? null;
}

/** One line for the console when a plugin parks a dialog. */
export function pluginDialogMessage(request: PluginDialogRequest): string {
  return (
    ` a plugin is waiting for a file: ${request.options.title || request.kind}` +
    ` (${request.kind}, dialog #${request.dialogId})`
  );
}
