/**
 * The quick-button grid of the External GUI — `modules/pmg_qt/pymol_qt_gui.py`
 * `:222-271`. Four rows, spacing 2, every button carrying `quickbutton=true`.
 * The movie transport row is omitted: it is the same set of actions as the
 * Control block, which the internal-GUI column renders where PyMOL draws it
 * (`layer1/Control.cpp`), and that block belongs to WP-20.
 *
 * Below the grid sits the progress row (`:273-284`): a progress bar plus a red
 * Abort button wired to `cmd.interrupt` (`:282`), shown only while
 * `cmd.get_progress() >= 0` (`:931-939`). `cmd.interrupt` is
 * `modules/pymol/locking.py:88` — "asynch, no locking", which is exactly why it
 * can be delivered while the engine thread is inside a long C++ call.
 *
 * Buttons go through `session.run()`, i.e. `{t:'do'}`, so each one appears in
 * the console as the command line it is. That is what PyMOL's own log file
 * records for a GUI action (`PLog`, `layer4/PopUp.cpp:471-475`).
 */

import { errorText, useSession, useStore } from '../../app';

interface QuickButton {
  label: string;
  /** A PyMOL command line, or null for "not implemented here". */
  cmd: string | null;
  title: string;
  /** Which work package will make a null button real. */
  todo?: string;
}

const ROWS: QuickButton[][] = [
  [
    { label: 'Reset', cmd: 'reset', title: 'cmd.reset' },
    { label: 'Zoom', cmd: 'zoom animate=1.0', title: 'cmd.zoom(animate=1.0)' },
    { label: 'Orient', cmd: 'orient animate=1.0', title: 'cmd.orient(animate=1.0)' },
    { label: 'Draw/Ray', cmd: null, title: 'the render dialog', todo: 'WP-19' },
  ],
  [
    { label: 'Unpick', cmd: 'unpick', title: 'cmd.unpick' },
    { label: 'Deselect', cmd: 'deselect', title: 'cmd.deselect' },
    { label: 'Rock', cmd: 'rock', title: 'cmd.rock' },
    { label: 'Get View', cmd: 'get_view 2, quiet=0', title: 'cmd.get_view(2, quiet=0)' },
  ],
  [
    { label: 'Builder', cmd: null, title: 'the builder dock', todo: 'WP-17' },
    { label: 'Properties', cmd: null, title: 'the properties dialog', todo: 'WP-22' },
    { label: 'Rebuild', cmd: 'rebuild', title: 'cmd.rebuild' },
    { label: 'MClear', cmd: 'mclear', title: 'cmd.mclear' },
  ],
];

export function QuickButtons() {
  const session = useSession();
  const progress = useStore(session.stores.connection, (s) => s.progress);
  const busy = progress >= 0;

  return (
    <div className="quickbuttons">
      {ROWS.map((row, i) => (
        <div className="quickbuttons__row" key={i}>
          {row.map((button) => (
            <button
              type="button"
              className={`quickbutton${button.cmd ? '' : ' quickbutton--todo'}`}
              key={button.label}
              title={button.cmd ? button.title : `TODO (${button.todo}): ${button.title}`}
              onClick={() => {
                if (button.cmd) void session.run(button.cmd);
                else
                  session.stores.feedback.appendClient(
                    ` ${button.label}: not implemented in this wave — ${button.title} is ${button.todo}`,
                    'warning',
                  );
              }}
            >
              {button.label}
            </button>
          ))}
        </div>
      ))}

      <div className="quickbuttons__progress" title="cmd.get_progress(), 10 Hz status thread">
        <div className="progressbar" aria-hidden="true">
          <div
            className="progressbar__fill"
            style={{ width: busy ? `${Math.round(Math.min(1, progress) * 100)}%` : '0%' }}
          />
        </div>
        <button
          type="button"
          className="quickbutton quickbutton--abort"
          title="cmd.interrupt (modules/pymol/locking.py:88 — asynchronous, takes no lock)"
          disabled={!busy}
          onClick={() => {
            session.stores.feedback.appendClient('interrupt');
            void session.call('interrupt').catch((error: unknown) => {
              session.stores.feedback.appendClient(` ${errorText(error)}`, 'error');
            });
          }}
        >
          Abort
        </button>
      </div>
    </div>
  );
}
