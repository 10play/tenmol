/**
 * `PyMOL>` prompt + command entry — the External GUI one.
 *
 * Widget parity: `CommandLineEdit` (`packages/engine/modules/pmg_qt/pymol_qt_gui.py:1085`)
 * behind a `QLabel("PyMOL>")` (`:141-143`). Key handling is
 * `lineeditKeyPressEventFilter` (`:421-438`):
 *
 *   Tab       -> completion (`cmd._parser.complete`)
 *   Up        -> history back
 *   Ctrl+Up   -> history prefix back-search
 *   Down      -> history forward
 *   Enter     -> submit (deliberately NOT `returnPressed`, `:432-434`)
 *
 * Tab is PyMOL's own completion, one round trip, and the handler is a literal
 * translation of `packages/engine/modules/pymol/_gui.py:899-903`:
 *
 *     st = self.cmd._parser.complete(self.command_get())
 *     if st:
 *         self.command_set(st); self.command_set_cursor(len(st))
 *
 * `Parser.complete` (`packages/engine/modules/pymol/parser.py:524-596`) returns the completed
 * LINE or None, and *prints* the candidate list through `colorprinting.suggest`
 * (`parser.py:63-67`). Those printed lines are console output like any other:
 * `pcatch` puts them in PyMOL's line buffer and they arrive on the `feedback`
 * topic, which `FeedbackLog` renders. So " parser: matching commands:" showing
 * up in the log is the FEATURE, not a leak — it is exactly what the Qt and Tk
 * consoles show. Measured against this build, one round trip each:
 *
 *     'frag'            -> 'fragment '            commands (cmd.kwhash)
 *     'colo'            -> 'color'                + " parser: matching commands:"
 *     'color ye'        -> 'color yellow'         colour names (auto_arg)
 *     'set wrap_out'    -> 'set wrap_output, '    setting names
 *     'delete al'       -> 'delete ala '          object names
 *     'zoom al'         -> null                   + " parser: matching selection:"
 *     'load /etc/hos'   -> 'load /etc/hosts'      the SERVER's filesystem
 *     'colour'          -> null                   + " parser: no matching commands."
 *
 * Submit is `{t:'do'}`, which is where console parity lives: `cmd.do` emits both
 * the `PyMOL>` echo and the C-origin summary into the same line buffer (spike 02
 * §8 — `cmd.fragment('ala')` produces nothing, `cmd.do('fragment ala')`
 * produces ` Executive: object "ala" created.`). Because PyMOL echoes the line
 * itself, this component must NOT echo it locally while connected; doing both
 * printed every command twice (plan §6 WP-11, "fix already found, keep it").
 * The offline echo lives in `session.run()`.
 *
 * The unhandled Ctrl/Alt chords go to `cmd._ctrl` / `cmd._alt` / `cmd._ctsh`
 * exactly as the in-viewport prompt's do (`packages/engine/layer1/Ortho.cpp:760-820`), so a
 * user's `set_key` bindings still fire from the focused command line. Qt gets
 * that for free because OrthoKey sees the key anyway; a browser input does not.
 */

import { useLayoutEffect, useRef, useState } from 'react';
import { errorText, useSession, useStore } from '../../app';
// Cross-feature IMPORT, not a shared-file edit: the command line needs WP-18's
// upload to turn a browser File into a path PyMOL can see.
import { createFilesApi, fileToBase64 } from '../files/filesApi';
import { useCommandHistory } from './useCommandHistory';
import {
  NO_PREVIEW,
  dragEnterPreview,
  dragLeaveRestore,
  dropNeedsUpload,
  droppedText,
  protectedPlaceholder,
  type PreviewState,
} from './dragPreview';

/**
 * `cmd._parser.complete` — granted by `packages/bridge/tenmol_bridge/policy/grants/
 * wp-11-console.py`. `@tenmol/client` exports the same constant as
 * `COMPLETE_FN`, but `packages/client/src/index.ts` does not re-export it yet,
 * so it is spelled out here.
 */
const COMPLETE_FN = 'cmd._parser.complete';

/**
 * Ctrl chords the browser or the OS has already claimed. Forwarding these to
 * `cmd._ctrl` would take Ctrl-C away from a user copying console output — a
 * regression dressed up as parity. Everything else goes to PyMOL, which is
 * where `set_key`/`shortcut_dict` bindings live.
 */
const BROWSER_CHORDS = new Set(['C', 'X', 'V', 'A', 'R', 'W', 'T', 'N', 'P', 'F']);

/** The console command input: a PyMOL prompt with history navigation and completion. */
export function CommandLine() {
  const session = useSession();
  const history = useCommandHistory(session.stores.ui);
  const phase = useStore(session.stores.connection, (s) => s.phase);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const preview = useRef<PreviewState>(NO_PREVIEW);
  /**
   * One completion in flight at a time. Tab autorepeats when held, and PyMOL's
   * completion takes the API lock and can glob the filesystem; queueing those
   * would apply a stale answer to a line the user has since edited.
   */
  const completing = useRef(false);

  /**
   * A selection to apply once React has written a PARTICULAR value into the
   * DOM. The value is part of the record, and that is the whole trick.
   *
   * Measured failure without it: `setText(...)` schedules a render, but the
   * console re-renders anyway at 10 Hz from the feedback push, so an UNRELATED
   * commit can land first — still carrying the old value. A selection effect
   * that fires on that commit selects a range in the old string and is then
   * wiped when the real value is written (a controlled input's caret goes to
   * the end on `node.value = ...`). The drag preview measured `[21,21]` where
   * Qt selects `[5,21]` (`pymol_qt_gui.py:1116`), and only under load — with an
   * idle page the first commit was the right one and it looked correct.
   *
   * Gating on the value makes the effect idempotent and order-independent: it
   * does nothing until the commit it was waiting for.
   */
  const pendingSelection = useRef<{ value: string; range: [number, number] } | null>(null);
  useLayoutEffect(() => {
    const pending = pendingSelection.current;
    const el = inputRef.current;
    if (!pending || !el || el.value !== pending.value) return;
    pendingSelection.current = null;
    el.setSelectionRange(pending.range[0], pending.range[1]);
  });

  const setLineAndCursorToEnd = (value: string) => {
    setText(value);
    pendingSelection.current = { value, range: [value.length, value.length] };
  };

  const complete = (line: string) => {
    if (completing.current) return;
    completing.current = true;
    void session
      .call<string | null>(COMPLETE_FN, [line])
      .then((completed) => {
        // Apply only if the user has not typed since; `_gui.py` cannot race
        // this because its completion is synchronous and ours is a round trip.
        if (typeof completed !== 'string' || completed === '') return;
        if (inputRef.current !== null && inputRef.current.value !== line) return;
        setLineAndCursorToEnd(completed);
      })
      .catch(() => {
        // `session.call` has already put the error in the console.
      })
      .finally(() => {
        completing.current = false;
      });
  };

  const submit = () => {
    const line = text;
    if (!line.trim()) return;
    history.push(line);
    setText('');
    void session.run(line);
  };

  const offline = phase !== 'open';

  const chord = (fn: '_ctrl' | '_alt' | '_ctsh', key: string) => {
    if (offline) return;
    void session.call(`cmd.${fn}`, [key]).catch((error: unknown) => {
      session.stores.feedback.appendClient(` ${errorText(error)}`, 'error');
    });
  };

  /**
   * Upload dropped files and insert their SERVER paths at the cursor.
   *
   * Sequential, not parallel: the inserted text must come out in the order the
   * files were dropped, and `Promise.all` would race them into whatever order
   * the uploads finished in.
   */
  const uploadDropped = async (files: readonly File[]) => {
    const api = createFilesApi({
      call: (fn, args, kwargs) => session.call(fn, args ?? [], kwargs ?? {}),
      do: (line) => session.conn.do(line),
    });
    const paths: string[] = [];
    try {
      await api.ensure();
      for (const file of files) {
        const uploaded = await api.upload(file.name, await fileToBase64(file));
        if (uploaded.ok) paths.push(uploaded.path);
        else session.stores.feedback.appendClient(` upload failed: ${uploaded.error}`, 'error');
      }
    } catch (error) {
      session.stores.feedback.appendClient(` upload failed: ${errorText(error)}`, 'error');
      restorePreview();
      return;
    }
    // The placeholder is still standing in for these files while they upload;
    // whatever happens next, it must not be what the user is left holding.
    if (paths.length > 0) applyPreview(paths.join(' '), false);
    else restorePreview();
  };

  /** `dragLeaveEvent` (`:1118-1121`), also used when a drop resolves to nothing. */
  const restorePreview = (): void => {
    const restored = dragLeaveRestore(preview.current);
    preview.current = NO_PREVIEW;
    if (!restored) return;
    setText(restored.text);
    pendingSelection.current = { value: restored.text, range: [restored.cursor, restored.cursor] };
  };

  const applyPreview = (dropped: string | null, selectInserted: boolean) => {
    const base = dragLeaveRestore(preview.current) ?? {
      text: inputRef.current?.value ?? text,
      cursor: inputRef.current?.selectionStart ?? text.length,
    };
    preview.current = NO_PREVIEW;
    const result = dragEnterPreview(base.text, base.cursor, dropped);
    if (!result) {
      // Nothing to insert. `base` is what the preview replaced, so putting it
      // back is what stops a stand-in outliving the drag that created it — a
      // drop whose payload turns out to be empty must not leave `⟨file⟩` in
      // the line. Qt cannot reach this state: it only previews text it read.
      if ((inputRef.current?.value ?? text) !== base.text) {
        setText(base.text);
        pendingSelection.current = { value: base.text, range: [base.cursor, base.cursor] };
      }
      return false;
    }
    if (selectInserted) preview.current = result.saved;
    setText(result.text);
    // `setSelection(pos, len(droppedtext))` (`pymol_qt_gui.py:1116`) — the
    // preview is SELECTED, so a drag that leaves is visibly undone.
    pendingSelection.current = {
      value: result.text,
      range: selectInserted
        ? [result.selectionStart, result.selectionEnd]
        : [result.selectionEnd, result.selectionEnd],
    };
    return true;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'Tab') {
      // Always swallow Tab, connected or not: PyMOL's handler returns 'break'
      // (`_gui.py:903`) so Tab never moves focus out of the command line, and
      // `eventFilter` eats the KeyRelease too (`pymol_qt_gui.py:444-448`).
      e.preventDefault();
      if (offline) {
        session.stores.feedback.appendClient(
          ' tab completion needs the bridge: it is PyMOL that owns the keyword table,' +
            ' the name lists and the filesystem.',
          'warning',
        );
        return;
      }
      complete(text);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.ctrlKey ? history.backSearch(text) : history.back(text);
      if (next !== null) setLineAndCursorToEnd(next);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = history.forward();
      if (next !== null) setLineAndCursorToEnd(next);
      return;
    }
    if (e.key.length !== 1 || e.metaKey) return;
    const upper = e.key.toUpperCase();
    if (e.ctrlKey && e.shiftKey) {
      e.preventDefault();
      chord('_ctsh', upper);
    } else if (e.ctrlKey && !e.shiftKey && !BROWSER_CHORDS.has(upper)) {
      e.preventDefault();
      chord('_ctrl', upper);
    } else if (e.altKey && !e.ctrlKey) {
      e.preventDefault();
      chord('_alt', upper);
    }
  };

  return (
    <div className="cmdline modern:h-[34px] modern:gap-2 modern:px-3 modern:border-t modern:border-line modern:bg-[var(--sh-panel-frost)] modern:[backdrop-filter:var(--sh-blur)]">
      <label
        className={`cmdline__label${offline ? ' cmdline__label--offline' : ''} modern:font-semibold modern:text-pm-text-dim`}
        htmlFor="command_line"
        title={offline ? 'not connected — commands will not execute' : 'cmd.do'}
      >
        tenmol&gt;
      </label>
      <input
        id="command_line"
        ref={inputRef}
        className="cmdline__input modern:h-6 modern:px-2.5 modern:rounded-[6px] modern:border modern:border-line modern:font-mono modern:text-[var(--sh-console-text)] modern:bg-[var(--sh-console-bg)] modern:[caret-color:var(--pm-accent)]"
        type="text"
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onDragEnter={(e) => {
          // `dragEnterEvent` (`pymol_qt_gui.py:1099-1116`) inserts the payload
          // at the cursor and selects it, BEFORE the drop.
          //
          // BROWSER LIMIT, stated rather than hidden: the HTML5 drag data store
          // is in "protected mode" during dragenter/dragover, so `getData()`
          // returns '' for a real drag from another window and only `types` is
          // readable. When that happens there is nothing to preview and the
          // line is left untouched; `drop` then inserts for real. The preview
          // degrades; the drop never does.
          const types = [...(e.dataTransfer.types ?? [])];
          const real = droppedText({
            uriList: e.dataTransfer.getData('text/uri-list'),
            plain: e.dataTransfer.getData('text/plain'),
          });
          // `items` rather than `files`: the file LIST is empty until `drop`,
          // but the item kinds are readable now, which is how a drag from
          // Finder can be previewed at all.
          const fileCount = [...(e.dataTransfer.items ?? [])].filter(
            (item) => item.kind === 'file',
          ).length;
          const shown = real ?? protectedPlaceholder({ types, fileCount });
          if (shown === null) {
            preview.current = NO_PREVIEW;
            return;
          }
          e.preventDefault();
          applyPreview(shown, true);
        }}
        onDragOver={(e) => {
          // `dragMoveEvent` is a deliberate `pass` (`:1091-1092`) — the preview
          // must not chase the pointer — but the browser needs the default
          // prevented or `drop` never fires at all.
          e.preventDefault();
        }}
        onDragLeave={() => {
          // `dragLeaveEvent` (`:1118-1121`).
          restorePreview();
        }}
        onDrop={(e) => {
          e.preventDefault();
          /*
           * A real FILE carries no text at all — `dataTransfer.files` holds a
           * browser File object whose path the page cannot see. Qt has the
           * path already (`toLocalFile()`); here the bytes have to reach the
           * PyMOL host before there IS a path to insert. So the file is
           * uploaded and the SERVER path lands at the cursor, which is what
           * the inventory row asks for and what makes the inserted text
           * something PyMOL can actually load.
           */
          const files = Array.from(e.dataTransfer.files ?? []);
          if (
            dropNeedsUpload({
              fileCount: files.length,
              uriList: e.dataTransfer.getData('text/uri-list'),
              plain: e.dataTransfer.getData('text/plain'),
            })
          ) {
            void uploadDropped(files);
            return;
          }
          applyPreview(
            droppedText({
              uriList: e.dataTransfer.getData('text/uri-list'),
              plain: e.dataTransfer.getData('text/plain'),
            }),
            false,
          );
        }}
        title={COMMAND_LINE_TOOLTIP}
      />
    </div>
  );
}

/** Verbatim from `packages/engine/modules/pmg_qt/pymol_qt_gui.py:145-157`. */
const COMMAND_LINE_TOOLTIP = `Command Input Area

Get the list of commands by hitting <TAB>

Get the list of arguments for one command with a question mark:
PyMOL> color ?

Read the online help for a command with "help":
PyMOL> help color

Get autocompletion for many arguments by hitting <TAB>
PyMOL> color ye<TAB>    (will autocomplete "yellow")`;
