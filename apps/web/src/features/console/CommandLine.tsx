/**
 * `PyMOL>` prompt + command entry.
 *
 * Widget parity: `CommandLineEdit` (`modules/pmg_qt/pymol_qt_gui.py:1087`)
 * behind a `QLabel("PyMOL>")` (`:141-143`). Key handling is
 * `lineeditKeyPressEventFilter` (`:421-438`):
 *
 *   Tab       -> completion (`cmd._parser.complete`)
 *   Up        -> history back
 *   Ctrl+Up   -> history prefix back-search
 *   Down      -> history forward
 *   Enter     -> submit (deliberately NOT `returnPressed`, `:432-434`)
 *
 * Submit is `{t:'do'}`, which is where console parity lives: `cmd.do` emits both
 * the `PyMOL>` echo and the C-origin summary into the same line buffer (spike 02
 * §8 — `cmd.fragment('ala')` produces nothing, `cmd.do('fragment ala')`
 * produces ` Executive: object "ala" created.`). Because PyMOL echoes the line
 * itself, this component must NOT echo it locally while connected; doing both
 * printed every command twice (plan §6 WP-11, "fix already found, keep it").
 * The offline echo lives in `session.run()`.
 */

import { useRef, useState } from 'react';
import { useSession, useStore } from '../../app';
import { useCommandHistory } from './useCommandHistory';

export function CommandLine() {
  const session = useSession();
  const history = useCommandHistory(session.stores.ui);
  const phase = useStore(session.stores.connection, (s) => s.phase);
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
    const line = text;
    if (!line.trim()) return;
    history.push(line);
    setText('');
    void session.run(line);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      // TODO(completion, WP-11/WP-02): `cmd._parser.complete(text)` is the real
      // implementation (`modules/pymol/parser.py:524-604`) and it cannot run in
      // the browser — it needs `cmd.kwhash`, `cmd.auto_arg` and the local
      // filesystem. It is currently REFUSED by the bridge policy: measured,
      //   -> {"t":"call","fn":"_parser.complete","args":["frag"]}
      //   <- {"t":"err","error":{"kind":"NotAllowed","message":"'_parser' is
      //      not an addressable namespace"}}
      // A grant file (policy/grants/wp-11.py) adding `_parser` is all it needs.
      session.stores.feedback.appendClient(
        " tab completion is not wired yet: the bridge policy refuses 'cmd._parser.complete'" +
          ' (needs a policy grant — see features/console/CommandLine.tsx)',
        'warning',
      );
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

  const offline = phase !== 'open';

  return (
    <div className="cmdline">
      <label
        className={`cmdline__label${offline ? ' cmdline__label--offline' : ''}`}
        htmlFor="command_line"
        title={offline ? 'not connected — commands will not execute' : 'cmd.do'}
      >
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
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        title={COMMAND_LINE_TOOLTIP}
      />
    </div>
  );
}

/** Verbatim from `modules/pmg_qt/pymol_qt_gui.py:145-157`. */
const COMMAND_LINE_TOOLTIP = `Command Input Area

Get the list of commands by hitting <TAB>

Get the list of arguments for one command with a question mark:
PyMOL> color ?

Read the online help for a command with "help":
PyMOL> help color

Get autocompletion for many arguments by hitting <TAB>
PyMOL> color ye<TAB>    (will autocomplete "yellow")`;
