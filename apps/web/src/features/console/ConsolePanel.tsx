/**
 * The External GUI: output pane + command line + quick buttons.
 *
 * `modules/pmg_qt/pymol_qt_gui.py:118-284` — a dock widget holding a
 * `QPlainTextEdit`, a `QLabel("PyMOL>")` + `CommandLineEdit`, and a 3×4 grid of
 * quick buttons with a progress row.
 */

import { useSession, useStore } from '../../app';
import { CommandLine } from './CommandLine';
import { FeedbackLog } from './FeedbackLog';
import { QuickButtons } from './QuickButtons';
import './console.css';

export function ConsolePanel() {
  const session = useSession();
  const ui = session.stores.ui;
  const follow = useStore(ui, (s) => s.followOutput);
  const fontSize = useStore(ui, (s) => s.consoleFontSize);
  const lineCount = useStore(session.stores.feedback, (s) => s.lines.length);

  return (
    <>
      <div className="extgui__console">
        <div className="console__bar">
          <span className="console__bar-title">Output</span>
          <span className="console__bar-count">{lineCount} lines</span>
          <span className="console__bar-spacer" />
          <button
            type="button"
            className={`console__bar-btn${follow ? ' is-on' : ''}`}
            title="follow new output when already scrolled to the bottom"
            onClick={() => ui.set({ followOutput: !follow })}
          >
            follow
          </button>
          <button
            type="button"
            className="console__bar-btn"
            title="font size"
            onClick={() => ui.set({ consoleFontSize: Math.max(9, fontSize - 0.5) })}
          >
            A-
          </button>
          <button
            type="button"
            className="console__bar-btn"
            title="font size"
            onClick={() => ui.set({ consoleFontSize: Math.min(20, fontSize + 0.5) })}
          >
            A+
          </button>
          <button
            type="button"
            className="console__bar-btn"
            title="clear the client scrollback (PyMOL keeps none of its own)"
            onClick={() => session.stores.feedback.clear()}
          >
            clear
          </button>
        </div>
        <FeedbackLog />
        <CommandLine />
      </div>
      <QuickButtons />
    </>
  );
}
