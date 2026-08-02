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
import { menuHooks, openPanel } from '../../shell/panelHooks';

interface QuickButton {
  label: string;
  /** A PyMOL command line, or null for "not implemented here". */
  cmd: string | null;
  title: string;
  /** Which work package will make a null button real. */
  todo?: string;
  /** Handled in TypeScript rather than by a bare command line. */
  action?: 'getView' | 'builder' | 'properties' | 'render';
}

const ROWS: QuickButton[][] = [
  [
    { label: 'Reset', cmd: 'reset', title: 'cmd.reset' },
    { label: 'Zoom', cmd: 'zoom animate=1.0', title: 'cmd.zoom(animate=1.0)' },
    { label: 'Orient', cmd: 'orient animate=1.0', title: 'cmd.orient(animate=1.0)' },
    {
      label: 'Draw/Ray',
      cmd: null,
      action: 'render',
      title: 'the render dialog (WidgetMenu wrapping render_dialog, :222)',
      todo: 'WP-19',
    },
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
    { label: 'Builder', cmd: null, action: 'builder', title: 'the builder dock' },
    { label: 'Properties', cmd: null, action: 'properties', title: 'the properties dialog' },
    { label: 'Rebuild', cmd: 'rebuild', title: 'cmd.rebuild' },
  ],
];

/**
 * `int(cmd.get_progress() * 100)` — Qt's number, including its truncation
 * (`pymol_qt_gui.py:931`). It is what decides visibility AND what the bar
 * displays, so the two can never disagree.
 */
export function progressPercent(progress: number): number {
  if (!Number.isFinite(progress)) return -1;
  return Math.trunc(progress * 100);
}

/** A button that will really do its job when pressed. */
export function live(button: QuickButton): boolean {
  if (button.action === 'render') return menuHooks()['render_dialog'] !== undefined;
  return button.cmd !== null || button.action !== undefined;
}

export function QuickButtons() {
  const session = useSession();
  const progress = useStore(session.stores.connection, (s) => s.progress);

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

  /**
   * The three buttons that open a PANEL rather than run a command.
   *
   * Qt's are `self.builderWindow()`, `self.propertiesWindow()` and a
   * `WidgetMenu` wrapping `render_dialog` (`pymol_qt_gui.py:222-271`) — bound
   * methods of the one window that owns every widget. Here each surface is a
   * separate registry slot that is NOT MOUNTED until the shell opens it, so
   * `openPanel` mounts it and runs the intent on the mount edge
   * (`shell/panelHooks.ts`).
   */
  const openBuilder = async () => {
    const { OPEN_EVENT } = await import('../builder/BuilderPanel');
    openPanel('builder', () => window.dispatchEvent(new Event(OPEN_EVENT)));
  };

  const openProperties = async () => {
    const { dialogsStore } = await import('../dialogs/store');
    openPanel('properties', () => dialogsStore.open('properties'));
  };

  /**
   * `features/render` (WP-19) has built the two-page Draw/Ray form but exposes
   * no way to open it from outside itself: `RenderDialog` keeps `expanded` in
   * local state and takes no props, and unlike `features/builder` it publishes
   * no open event. So this looks for a registered hook and, when there is none,
   * says exactly what is missing instead of pretending to open something.
   */
  const openRender = () => {
    const hook = menuHooks()['render_dialog'];
    if (hook) {
      void hook([]);
      return;
    }
    session.stores.feedback.appendClient(
      ' Draw/Ray: the render form is built (features/render) but has no open seam — ' +
        "it needs one line, registerMenuHook('render_dialog', …) or an open event like " +
        "features/builder's `tenmol:open-builder`. Use the Ray / Draw tab on the viewport.",
      'warning',
    );
  };

  return (
    <div className="quickbuttons">
      {ROWS.map((row, i) => (
        <div className="quickbuttons__row" key={i}>
          {row.map((button) => (
            <button
              type="button"
              // Still VISIBLY unbuilt when it is unbuilt: Draw/Ray keeps its
              // `todo` marker until someone registers `render_dialog`.
              className={`quickbutton${live(button) ? '' : ' quickbutton--todo'}`}
              key={button.label}
              title={live(button) ? button.title : `TODO (${button.todo}): ${button.title}`}
              onClick={() => {
                if (button.action === 'getView') void getView();
                else if (button.action === 'builder') void openBuilder();
                else if (button.action === 'properties') void openProperties();
                else if (button.action === 'render') openRender();
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

      {/*
       * SHOWN ONLY WHILE A JOB IS RUNNING, as Qt does
       * (`update_progress`, `pymol_qt_gui.py:931-939`: `progress =
       * int(cmd.get_progress() * 100)`, then `setVisible(progress >= 0)` on
       * the bar and the Abort button). It used to render always, with a
       * disabled Abort — a permanently visible empty bar that says a job is
       * running when none is. MEASURED against a real ray
       * (`bridge/tests/test_p8_a1.py`): idle is exactly -1.0, and an async
       * `ray 900,700` of a protein surface reports 0.35 after 0.16 s and
       * returns to -1.0 when it ends, so the row appears and disappears.
       */}
      {progressPercent(progress) >= 0 && (
        <div className="quickbuttons__progress" title="cmd.get_progress(), 10 Hz status thread">
          <div
            className="progressbar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPercent(progress)}
          >
            <div
              className="progressbar__fill"
              style={{ width: `${Math.min(100, progressPercent(progress))}%` }}
            />
          </div>
          <button
            type="button"
            className="quickbutton quickbutton--abort"
            title="cmd.interrupt (modules/pymol/locking.py:88 — asynchronous, takes no lock)"
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
      )}
    </div>
  );
}
