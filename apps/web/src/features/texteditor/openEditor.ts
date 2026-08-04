/**
 * Opening the text editor from somewhere else — `File ▸ Edit pymolrc`.
 *
 * WHY THIS IS A MODULE AND NOT A LINE IN A COMPONENT. The menu hook registry
 * (`shell/panelHooks.ts`) hands a hook nothing but the menu action's `args`: no
 * session, no React context. Registering from `TextEditorSlot` would be worse
 * still — that slot is an OVERLAY panel, mounted only while the editor is
 * already open, and four features have now shipped hooks that were dead for
 * exactly that reason. So the registration happens from `features/files`, whose
 * installer runs inside `FileDropTarget` and is mounted for the life of the app,
 * and this module is the two lines it calls.
 *
 * THE ARGUMENT IS A NAME, NOT A PATH. `edit_pymolrc` cannot know which file to
 * open without asking the bridge (`invocation.get_user_config()`), and the hook
 * has no session to ask with. So the window is opened under the sentinel
 * {@link PYMOLRC_ARG} and `TextEditorPanel` resolves it on mount — the same
 * order Qt uses, where `edit_pymolrc` reads `options.pymolrc` and only then
 * constructs the editor (`TextEditor.py:150-185`).
 *
 * TWO HOPS, both needed, exactly like `features/files/menuHooks.ts`:
 *   1. `openPanel('texteditor')` mounts the overlay slot that draws the window.
 *   2. `dialogsStore.open('texteditor', arg)` creates (or raises) the window.
 * The store is a module singleton and is keyed by `<kind>:<arg>`, so clicking
 * the leaf twice raises the one window rather than stacking a second.
 */

import { openPanel } from '../../shell/panelHooks';
import { dialogsStore } from '../dialogs/store';

/**
 * `spec.arg` meaning "the pymolrc this PyMOL actually loaded — ask the bridge".
 *
 * Deliberately not a path: the panel treats every OTHER non-empty `arg` as a
 * server path and reads it verbatim, and a sentinel that could also be a real
 * filename would make that ambiguous. `dialogKey` turns it into the window key
 * `texteditor:@pymolrc`.
 */
export const PYMOLRC_ARG = '@pymolrc';

/** Open (or raise) an editor on a server path. */
export function openTextEditor(path: string): string {
  openPanel('texteditor');
  return dialogsStore.open('texteditor', path);
}

/** `File ▸ Edit pymolrc` (`pymol_qt_gui.py:634-637`). */
export function openPymolrcEditor(): string {
  return openTextEditor(PYMOLRC_ARG);
}
