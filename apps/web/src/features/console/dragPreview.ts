/**
 * `CommandLineEdit`'s drag-enter live preview, as pure functions.
 *
 * `modules/pmg_qt/pymol_qt_gui.py:1085-1122` — a `QLineEdit` subclass whose
 * whole purpose is that a drag entering the widget shows you what you are about
 * to drop, *selected*, before you let go:
 *
 *     dragEnterEvent   no text in the mime data -> `_saved_pos = -1`, ignore.
 *                      Otherwise: accept, take `urls[0].toLocalFile()` if the
 *                      first URL is a local file else the plain text, save
 *                      `(cursorPosition, text)`, insert at the cursor and
 *                      select exactly the inserted run.
 *     dragMoveEvent    a deliberate `pass` — the preview must not follow the
 *                      pointer around, or the line would rewrite on every
 *                      mouse move.
 *     dragLeaveEvent   restore `_saved_text` and `_saved_pos` (only if a
 *                      preview was actually made).
 *     dropEvent        `acceptProposedAction()` — and NOTHING else, because the
 *                      text is already in the line from dragEnter.
 *
 * THE BROWSER DIFFERENCE, stated rather than hidden: HTML5 drag-and-drop
 * withholds `dataTransfer` contents until `drop` for anything but the type
 * list (a privacy rule, not a bug). Text dragged from inside the page IS
 * readable on dragenter in Chromium; text dragged from another application and
 * every `Files` entry is not. So {@link dragEnterPreview} returns `null` when
 * it cannot see the payload, the line is left alone, and `drop` inserts for
 * real — the preview degrades, the drop never does.
 */

export interface PreviewState {
  /** `_saved_pos`; -1 means "no preview is showing" (`:1089`). */
  savedPos: number;
  /** `_saved_text`. */
  savedText: string;
}

export const NO_PREVIEW: PreviewState = { savedPos: -1, savedText: '' };

export interface PreviewResult {
  text: string;
  /** `setSelection(pos, len(droppedtext))` (`:1116`). */
  selectionStart: number;
  selectionEnd: number;
  saved: PreviewState;
}

/**
 * The text a Qt drop would insert: the first URL's local path if it has one,
 * otherwise the plain text (`:1103-1107`).
 *
 * `text/uri-list` is the web's `urls`. A `file://` URL is `isLocalFile()`, and
 * its path is `toLocalFile()`. Anything else — `https://`, a bare string — is
 * dropped as text, exactly as Qt does.
 */
export function droppedText(items: {
  uriList?: string | null;
  plain?: string | null;
}): string | null {
  const uriList = items.uriList ?? '';
  const first = uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== '' && !line.startsWith('#'));
  if (first && first.startsWith('file://')) {
    try {
      return decodeURIComponent(new URL(first).pathname);
    } catch {
      return decodeURIComponent(first.slice('file://'.length));
    }
  }
  const plain = items.plain ?? '';
  if (plain !== '') return plain;
  if (first) return first;
  return null;
}

/** `dragEnterEvent` (`:1099-1116`). Returns `null` when there is nothing to show. */
export function dragEnterPreview(
  line: string,
  cursor: number,
  dropped: string | null,
): PreviewResult | null {
  if (dropped === null || dropped === '') return null;
  const pos = Math.max(0, Math.min(cursor, line.length));
  return {
    text: line.slice(0, pos) + dropped + line.slice(pos),
    selectionStart: pos,
    selectionEnd: pos + dropped.length,
    saved: { savedPos: pos, savedText: line },
  };
}

/** `dragLeaveEvent` (`:1118-1121`). Returns `null` when no preview was made. */
export function dragLeaveRestore(saved: PreviewState): { text: string; cursor: number } | null {
  if (saved.savedPos === -1) return null;
  return { text: saved.savedText, cursor: saved.savedPos };
}

/**
 * Does this drop carry FILES that need uploading, rather than text?
 *
 * Qt never faces this: `toLocalFile()` gives it a path the process can already
 * open. A browser hands over a `File` object whose path the page cannot see, so
 * the bytes must reach the PyMOL host before there is any path to insert.
 *
 * Text WINS when both are present. A drag from a file manager often carries
 * both a `text/uri-list` and a `File`, and the URI is already a usable string —
 * uploading a copy of a file the server can likely see anyway would be wasteful
 * and would insert a different path than the user dragged.
 */
export function dropNeedsUpload(input: {
  fileCount: number;
  uriList: string;
  plain: string;
}): boolean {
  if (input.fileCount <= 0) return false;
  return input.uriList === '' && input.plain === '';
}
