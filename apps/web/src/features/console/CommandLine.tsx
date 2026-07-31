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
 * Tab is PyMOL's own completion, one round trip, and the handler is a literal
 * translation of `modules/pymol/_gui.py:899-903`:
 *
 *     st = self.cmd._parser.complete(self.command_get())
 *     if st:
 *         self.command_set(st); self.command_set_cursor(len(st))
 *
 * `Parser.complete` (`modules/pymol/parser.py:524-596`) returns the completed
 * LINE or None, and *prints* the candidate list through `colorprinting.suggest`
 * (`parser.py:63-67`). Those printed lines are console output like any other:
 * `pcatch` puts them in PyMOL's line buffer and they arrive on the `feedback`
 * topic, which `FeedbackLog` already renders. So " parser: matching commands:"
 * showing up in the log is the FEATURE, not a leak — it is exactly what the Qt
 * and Tk consoles show.
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

/**
 * `cmd._parser.complete` — granted by `bridge/tenmol_bridge/policy/grants/
 * wp-11-console.py`. `@tenmol/client` exports the same constant as
 * `COMPLETE_FN`, but `packages/client/src/index.ts` does not re-export it yet,
 * so it is spelled out here.
 */
const COMPLETE_FN = 'cmd._parser.complete';

export function CommandLine() {
  const session = useSession();
  const history = useCommandHistory(session.stores.ui);
  const phase = useStore(session.stores.connection, (s) => s.phase);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * One completion in flight at a time. Tab autorepeats when held, and PyMOL's
   * completion takes the API lock and can glob the filesystem; queueing those
   * would apply a stale answer to a line the user has since edited.
   */
  const completing = useRef(false);

  const setLineAndCursorToEnd = (value: string) => {
    setText(value);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) el.setSelectionRange(value.length, value.length);
    });
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

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'Tab') {
      // Always swallow Tab, connected or not: PyMOL's handler returns 'break'
      // (`_gui.py:903`) so Tab never moves focus out of the command line.
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
    }
  };

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
