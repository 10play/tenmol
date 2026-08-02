import { useRef, useState } from 'react';
import { useBridge } from '../bridge/BridgeContext';
import { useCommandHistory } from './useCommandHistory';

/**
 * `PyMOL>` prompt + command entry.
 *
 * Widget parity: `CommandLineEdit` (packages/engine/modules/pmg_qt/pymol_qt_gui.py:1087) behind a
 * `QLabel("PyMOL>")` (:141-143). Key handling is
 * `lineeditKeyPressEventFilter` (:421-438):
 *
 *   Tab       -> completion (cmd._parser.complete)
 *   Up        -> history back
 *   Ctrl+Up   -> history prefix back-search
 *   Down      -> history forward
 *   Enter     -> submit (deliberately NOT returnPressed, :432-434)
 *
 * Submit path is `doPrompt` (:960-964): doTypedCommand -> pump -> clear -> flush
 * feedback. Over the wire a submit is `{ id, t:'do', cmd }`.
 *
 * TODO(completion): Tab needs a server-side RPC. Completion requires `cmd.kwhash`,
 * `cmd.auto_arg` AND the local filesystem (packages/engine/modules/pymol/parser.py:524-593), so it
 * cannot be done in the browser. It is `cmd._parser.complete(text)` -> a full
 * replacement string.
 *
 * TODO(dnd): drag-and-drop live preview (pymol_qt_gui.py:1087-1124) -- insert the
 * dropped text/URL at the cursor on dragenter, restore on dragleave.
 */
export function CommandLine() {
  const bridge = useBridge();
  const history = useCommandHistory();
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const setLineAndCursorToEnd = (value: string) => {
    setText(value);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) el.setSelectionRange(value.length, value.length);
    });
  };

  const submit = () => {
    const cmd = text;
    if (!cmd) return;
    history.push(cmd);
    // PyMOL itself echoes the line as "PyMOL>..." on the feedback topic
    // (OrthoAddOutput, packages/engine/layer1/Ortho.cpp) -- measured against the real bridge, a
    // `{t:'do'}` always comes back as {"t":"feedback","lines":["PyMOL>..."]}.
    // So only echo locally when the socket is down and nothing will come back.
    if (bridge.status !== 'open') bridge.appendFeedback([`PyMOL>${cmd}`]);
    void bridge.do(cmd).catch(() => undefined);
    setText('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      bridge.appendFeedback([' [stub] tab completion needs cmd._parser.complete over RPC']);
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
    }
  };

  return (
    <div className="cmdline">
      <label className="cmdline__label" htmlFor="command_line">
        PyMOL&gt;
      </label>
      <input
        id="command_line"
        ref={inputRef}
        className="cmdline__input"
        type="text"
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        title={COMMAND_LINE_TOOLTIP}
      />
    </div>
  );
}

/** Verbatim from packages/engine/modules/pmg_qt/pymol_qt_gui.py:145-157. */
const COMMAND_LINE_TOOLTIP = `Command Input Area

Get the list of commands by hitting <TAB>

Get the list of arguments for one command with a question mark:
PyMOL> color ?

Read the online help for a command with "help":
PyMOL> help color

Get autocompletion for many arguments by hitting <TAB>
PyMOL> color ye<TAB>    (will autocomplete "yellow")`;
