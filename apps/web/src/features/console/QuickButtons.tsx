/**
 * The quick-button grid of the External GUI — `modules/pmg_qt/pymol_qt_gui.py`
 * `:222-271`. FOUR rows, spacing 2, every button carrying `quickbutton=true`
 * and `WA_LayoutUsesWidgetRect` (a macOS Qt workaround with no web analogue).
 *
 * Row 3 is the movie transport (`|<`, `<`, Stop, Play, `>`, `>|`, MClear). It
 * duplicates the in-viewport Control block (`layer1/Control.cpp:298-376`, which
 * is WP-20's) and that duplication is upstream's: the Qt window really does
 * show both. Omitting it here left four of this row's seven commands with no
 * button anywhere in the client, so it is back, wired to the same `cmd.*`
 * commands Qt uses.
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
  /** Handled in TypeScript rather than by a bare command line. */
  action?: 'getView';
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
    {
      label: 'Get View',
      cmd: null,
      action: 'getView',
      title: 'cmd.get_view(2, quiet=0) + get_view(3) to the clipboard',
    },
  ],
  [
    { label: '|<', cmd: 'rewind', title: 'cmd.rewind' },
    { label: '<', cmd: 'backward', title: 'cmd.backward' },
    { label: 'Stop', cmd: 'mstop', title: 'cmd.mstop' },
    { label: 'Play', cmd: 'mplay', title: 'cmd.mplay' },
    { label: '>', cmd: 'forward', title: 'cmd.forward' },
    { label: '>|', cmd: 'ending', title: 'cmd.ending' },
    { label: 'MClear', cmd: 'mclear', title: 'cmd.mclear' },
  ],
  [
    { label: 'Builder', cmd: null, title: 'the builder dock', todo: 'WP-17' },
    { label: 'Properties', cmd: null, title: 'the properties dialog', todo: 'WP-22' },
    { label: 'Rebuild', cmd: 'rebuild', title: 'cmd.rebuild' },
  ],
];

export function QuickButtons() {
  const session = useSession();
  const progress = useStore(session.stores.connection, (s) => s.progress);
  const busy = progress >= 0;

  /**
   * `PyMOLQtGUI.get_view` (`pymol_qt_gui.py:83-86`): print the matrix at
   * verbosity 2, put the `get_view(3)` string on the clipboard, then print the
   * confirmation. `navigator.clipboard.writeText` needs a user gesture — this
   * IS one — and can still be refused, so the failure is reported instead of
   * being swallowed into a silent no-op.
   */
  const getView = async () => {
    await session.run('get_view 2, quiet=0');
    try {
      const text = await session.call<string>('cmd.get_view', [3]);
      await navigator.clipboard.writeText(String(text));
      session.stores.feedback.appendClient(' get_view: matrix copied to clipboard.');
    } catch (error) {
      session.stores.feedback.appendClient(
        ` get_view: could not reach the clipboard — ${errorText(error)}`,
        'warning',
      );
    }
  };

  return (
    <div className="quickbuttons">
      {ROWS.map((row, i) => (
        <div className="quickbuttons__row" key={i}>
          {row.map((button) => (
            <button
              type="button"
              className={`quickbutton${button.cmd || button.action ? '' : ' quickbutton--todo'}`}
              key={button.label}
              title={
                button.cmd || button.action
                  ? button.title
                  : `TODO (${button.todo}): ${button.title}`
              }
              onClick={() => {
                if (button.action === 'getView') void getView();
                else if (button.cmd) void session.run(button.cmd);
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
