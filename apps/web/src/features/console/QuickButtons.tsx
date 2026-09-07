/**
 * The quick-button grid of the External GUI — `packages/engine/modules/pmg_qt/pymol_qt_gui.py`
 * `:222-271`. FOUR rows, spacing 2, every button carrying `quickbutton=true`
 * and `WA_LayoutUsesWidgetRect` (a macOS Qt workaround with no web analogue).
 *
 * Row 3 is the movie transport (`|<`, `<`, Stop, Play, `>`, `>|`, MClear). It
 * duplicates the in-viewport Control block (`packages/engine/layer1/Control.cpp:298-376`, which
 * is WP-20's) and that duplication is upstream's: the Qt window really does
 * show both. Omitting it here left four of this row's seven commands with no
 * button anywhere in the client, so it is back, wired to the same `cmd.*`
 * commands Qt uses.
 *
 * Below the grid sits the progress row (`:273-284`): a progress bar plus a red
 * Abort button wired to `cmd.interrupt` (`:282`), shown only while
 * `cmd.get_progress() >= 0` (`:931-939`). `cmd.interrupt` is
 * `packages/engine/modules/pymol/locking.py:88` — "asynch, no locking", which is exactly why it
 * can be delivered while the engine thread is inside a long C++ call.
 *
 * Buttons go through `session.run()`, i.e. `{t:'do'}`, so each one appears in
 * the console as the command line it is. That is what PyMOL's own log file
 * records for a GUI action (`PLog`, `packages/engine/layer4/PopUp.cpp:471-475`).
 */

import { useSyncExternalStore } from 'react';
import {
  Ban,
  Blocks,
  Camera,
  ChevronLeft,
  ChevronRight,
  Compass,
  Eraser,
  Eye,
  Maximize,
  Play,
  RefreshCw,
  Repeat,
  RotateCcw,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Square,
  Trash2,
  type LucideIcon,
} from 'lucide-react';

import { errorText, useSession, useStore } from '../../app';
import { menuHooks, openPanel, subscribeMenuHooks, type MenuHook } from '../../shell/panelHooks';
import { Button, ProgressBar } from '../../ui';

interface QuickButton {
  label: string;
  /** A PyMOL command line, or null for "not implemented here". */
  cmd: string | null;
  title: string;
  /** Which work package will make a null button real. */
  todo?: string;
  /** Handled in TypeScript rather than by a bare command line. */
  action?: 'getView' | 'builder' | 'properties' | 'render';
  /** Lucide icon shown in the shadcn theme (classic stays text-only). */
  icon?: LucideIcon;
  /** Media-style controls hide their glyph label under the icon. */
  iconOnly?: boolean;
}

const ROWS: QuickButton[][] = [
  [
    { label: 'Reset', cmd: 'reset', title: 'cmd.reset', icon: RotateCcw },
    { label: 'Zoom', cmd: 'zoom animate=1.0', title: 'cmd.zoom(animate=1.0)', icon: Maximize },
    { label: 'Orient', cmd: 'orient animate=1.0', title: 'cmd.orient(animate=1.0)', icon: Compass },
    {
      label: 'Draw/Ray',
      cmd: null,
      action: 'render',
      title: 'the render dialog (WidgetMenu wrapping render_dialog, :222)',
      todo: 'WP-19',
      icon: Camera,
    },
  ],
  [
    { label: 'Unpick', cmd: 'unpick', title: 'cmd.unpick', icon: Ban },
    { label: 'Deselect', cmd: 'deselect', title: 'cmd.deselect', icon: Eraser },
    { label: 'Rock', cmd: 'rock', title: 'cmd.rock', icon: Repeat },
    {
      label: 'Get View',
      cmd: null,
      action: 'getView',
      title: 'cmd.get_view(2, quiet=0) + get_view(3) to the clipboard',
      icon: Eye,
    },
  ],
  [
    { label: '|<', cmd: 'rewind', title: 'cmd.rewind', icon: SkipBack, iconOnly: true },
    { label: '<', cmd: 'backward', title: 'cmd.backward', icon: ChevronLeft, iconOnly: true },
    { label: 'Stop', cmd: 'mstop', title: 'cmd.mstop', icon: Square, iconOnly: true },
    { label: 'Play', cmd: 'mplay', title: 'cmd.mplay', icon: Play, iconOnly: true },
    { label: '>', cmd: 'forward', title: 'cmd.forward', icon: ChevronRight, iconOnly: true },
    { label: '>|', cmd: 'ending', title: 'cmd.ending', icon: SkipForward, iconOnly: true },
    { label: 'MClear', cmd: 'mclear', title: 'cmd.mclear', icon: Trash2, iconOnly: true },
  ],
  [
    { label: 'Builder', cmd: null, action: 'builder', title: 'the builder dock', icon: Blocks },
    {
      label: 'Properties',
      cmd: null,
      action: 'properties',
      title: 'the properties dialog',
      icon: SlidersHorizontal,
    },
    { label: 'Rebuild', cmd: 'rebuild', title: 'cmd.rebuild', icon: RefreshCw },
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

/**
 * A button that will really do its job when pressed.
 *
 * `hooks` is passed in rather than read from the module so the component can
 * SUBSCRIBE to it: `features/render` registers `render_dialog` from an effect,
 * i.e. after this component's first paint, and a plain `menuHooks()` read here
 * would leave Draw/Ray drawn as a TODO until something else forced a re-render.
 */
export function live(
  button: QuickButton,
  hooks: Readonly<Record<string, MenuHook>> = menuHooks(),
): boolean {
  if (button.action === 'render') return hooks['render_dialog'] !== undefined;
  return button.cmd !== null || button.action !== undefined;
}

/** The External-GUI quick-button grid, movie transport, and abort/progress row. */
export function QuickButtons() {
  const session = useSession();
  const progress = useStore(session.stores.connection, (s) => s.progress);
  // `menuHooks()` is identity-cached and invalidated on registration, which is
  // what makes it a legal `getSnapshot` (an `Object.fromEntries` per call is a
  // new identity every render and React loops for ever).
  const hooks = useSyncExternalStore(subscribeMenuHooks, menuHooks, menuHooks);

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
    // D4.builder-race: THE DISPATCH IS A MICROTASK, load-bearing rather than defensive (see
    // `features/files/menuHooks.ts::requestFilesAction`). `FeatureSlot` renders
    // `<MountMarker/>` *before* `<Panel/>`, so within the commit that mounts the
    // slot React runs the marker's effect — which drains this intent via
    // `panelMounted` — BEFORE `BuilderPanel`'s effect has added its `OPEN_EVENT`
    // listener. Dispatching synchronously hits nobody: the panel stays collapsed
    // and the first click appears dead (the two-click bug). Passive effects for a
    // commit flush in one synchronous loop, so a microtask queued inside the
    // intent runs once every effect in that commit — the listener included — has run.
    openPanel('builder', () => queueMicrotask(() => window.dispatchEvent(new Event(OPEN_EVENT))));
  };

  const openProperties = async () => {
    const { dialogsStore } = await import('../dialogs/store');
    openPanel('properties', () => dialogsStore.open('properties'));
  };

  /**
   * Qt's Draw/Ray is a `WidgetMenu` wrapping `render_dialog`
   * (`pymol_qt_gui.py:222,232`) — one click, and it lazily builds the form the
   * first time. Here `features/render` registers `render_dialog` from its own
   * always-mounted component, so this is the same one click.
   *
   * The fallback stays: it is what said, for two waves, exactly which line was
   * missing, and it is what a feature directory that has not landed yet should
   * still produce instead of a dead button.
   */
  const openRender = () => {
    const hook = hooks['render_dialog'];
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
            <Button
              variant="quick"
              icon={button.icon}
              iconOnly={button.iconOnly}
              // Still VISIBLY unbuilt when it is unbuilt: Draw/Ray keeps its
              // `todo` marker until someone registers `render_dialog`.
              className={live(button, hooks) ? undefined : 'quickbutton--todo'}
              key={button.label}
              title={live(button, hooks) ? button.title : `TODO (${button.todo}): ${button.title}`}
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
            </Button>
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
       * (`packages/bridge/tests/test_p8_a1.py`): idle is exactly -1.0, and an async
       * `ray 900,700` of a protein surface reports 0.35 after 0.16 s and
       * returns to -1.0 when it ends, so the row appears and disappears.
       */}
      {progressPercent(progress) >= 0 && (
        <div className="quickbuttons__progress" title="cmd.get_progress(), 10 Hz status thread">
          <ProgressBar value={progressPercent(progress)} />
          <Button
            variant="quick"
            icon={Ban}
            className="quickbutton--abort"
            title="cmd.interrupt (packages/engine/modules/pymol/locking.py:88 — asynchronous, takes no lock)"
            onClick={() => {
              session.stores.feedback.appendClient('interrupt');
              void session.call('interrupt').catch((error: unknown) => {
                session.stores.feedback.appendClient(` ${errorText(error)}`, 'error');
              });
            }}
          >
            Abort
          </Button>
        </div>
      )}
    </div>
  );
}
