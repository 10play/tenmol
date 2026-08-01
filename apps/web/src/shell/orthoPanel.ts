/**
 * `OrthoLayoutPanel` and the control gutter, as arithmetic.
 *
 * Parity inventory rows 88 (internal GUI layout column) and 103 (control-bar
 * left gutter). Everything here is a transcription of C++ that the bridge
 * cannot execute, because the bridge holds `internal_gui` at 0 on purpose
 * (`bridge/tenmol_bridge/engine.py:126-131`) — PyMOL's own column would eat the
 * scene rectangle and every forwarded mouse coordinate would be wrong.
 *
 * WHAT WAS MEASURED (`bridge/tests/test_wf_shell.py`, 800x600 window,
 * `display_scale_factor` 1):
 *
 *     internal_gui 0                  -> scene 800x600
 *     internal_gui 1, width 220       -> scene 580x600
 *     internal_gui 1, width 5         -> scene 795x600
 *     internal_gui 1, width 300       -> scene 500x600
 *     internal_gui 1, width -20       -> scene 820x600   <- NOT CLAMPED
 *     internal_gui_mode 2             -> scene 800x600   (floats, reserves 0)
 *     internal_feedback 1 / 3 / 5     -> scene 800x582 / 558 / 534
 *     movie_panel 1 + a 30-frame movie-> scene 800x585
 *
 * The `-20` row is the reason `clampInternalGuiWidth` exists: `cmd.set` stores
 * whatever it is handed, and only the C++ DRAG handler clamps
 * (`layer1/Control.cpp:263-276`). A splitter that wrote an unclamped width back
 * would hand PyMOL a scene wider than the canvas.
 *
 * WHAT WAS MEASURED IN WAVE 7 (`bridge/tests/test_f7_layout.py`, same window).
 * The block heights below used to be transcription; they are now readings, off
 * two instruments `cmd` does not have — the framebuffer (`PixelReadback`) and
 * the input path (which block answers a click IS that block's rectangle):
 *
 *     column, drawn                 x 580..799, exactly 220 columns
 *     Control band                  y   0..19        20 px
 *     ButMode band, mouse_grid 0    y  20..59        40 px
 *     ButMode band, mouse_grid 1    y  20..143      124 px
 *     Wizard band, 2 rows, size 18  y  60..99        40 px = 18*2 + 4
 *     Wizard band, 2 rows, size 40  y  60..143       84 px = 40*2 + 4
 *     Wizard band, no wizard        0 px, block inactive
 *
 * AND THE RULE THAT IS NOT ARITHMETIC AT ALL. See `LAYOUT_SETTINGS`: writing
 * any of the seven layout settings does NOT relayout. PyMOL queues `viewport`
 * and waits for a windowing system the bridge does not have, so the change
 * lands on the next canvas resize and not before.
 *
 * UNITS. PyMOL stores these in DIP and multiplies by `_gScaleFactor` (setting
 * `display_scale_factor`, default 1) at use. A CSS pixel IS a DIP, and the
 * browser applies `devicePixelRatio` itself, so nothing here scales: the number
 * in the setting is the number of CSS pixels. That is also why the column width
 * round-trips through `internal_gui_width` unchanged.
 */

/**
 * The DIP constants. `layer1/Ortho.h:24-26`, `layer1/Control.cpp:36-46`,
 * `layer1/ButMode.cpp:72-78`, `layer1/Wizard.cpp:254-258`.
 */
export const ORTHO = {
  /** `cOrthoRightSceneMargin` and the `internal_gui_width` default. */
  internalGuiWidth: 220,
  /** `controlHeight` in `OrthoLayoutPanel` (`layer1/Ortho.cpp:2265`). */
  controlHeight: 20,
  /** `ButModeGetHeight` without / with `mouse_grid`. */
  butModeHeight: 40,
  butModeGridHeight: 124,
  /** `cControlMinWidth` — a RAW 5, deliberately not DIP-scaled. */
  controlMinWidth: 5,
  /** `cOrthoLineHeight`, `cOrthoBottomSceneMargin`. */
  lineHeight: 12,
  bottomSceneMargin: 18,
  /** `internal_gui_control_size` default (`layer1/SettingInfo.h`). */
  controlSize: 18,
  /** The `+ 4` in `LineHeight * NLine + 4`. */
  wizardPad: 4,
  /** `cControlLeftMargin` — the gutter the resize nub lives in. */
  controlLeftMargin: 8,
  /** `cControlBoxSize` — the nub is only that tall. */
  controlBoxSize: 17,
} as const;

/** `(now - LastClickTime) < 0.35` (`layer1/Control.cpp:452`). */
export const GUTTER_DOUBLE_CLICK_MS = 350;

/** `internal_gui_mode` (`layer1/Ortho.cpp:2396-2407`). */
export const INTERNAL_GUI_MODE = {
  /** Opaque: reserves `internal_gui_width` from the scene rectangle. */
  Default: 0,
  /** Drawn on the background: still reserves. Measured identical to 0. */
  Bg: 1,
  /** Transparent: `sceneRight = 0` AND `sceneBottom = 0` — it FLOATS. */
  Transparent: 2,
} as const;

/* ------------------------------------------------------------------ *
 * The block stack
 * ------------------------------------------------------------------ */

export interface OrthoPanelInput {
  /** Column height in CSS px — everything left over goes to Executive. */
  height: number;
  /** Setting `mouse_grid`. */
  mouseGrid: boolean;
  /** `wizard.get_panel()` row count; 0 when no wizard is active. */
  wizardLines: number;
  /** Setting `internal_gui_control_size`. */
  controlSize?: number;
}

/**
 * Block heights, in the order `OrthoLayoutPanel` stacks them BOTTOM-UP
 * (`layer1/Ortho.cpp:2261-2340`). The React column renders them top-down, so
 * the field order here is Executive, Wizard, ButMode, Control — the reverse of
 * the C++ margin computation and the same as the DOM.
 *
 * A REFERENCE MODEL, NOT A LAYOUT THE SHELL IMPOSES. Each block is rendered by
 * the feature that owns it and sizes itself: `features/objects` (Executive)
 * takes `flex: 1`, `features/wizards` gives every row `min-height:
 * internal_gui_control_size`, `features/mouse` sizes the ButMode grid from
 * `--butmode-line`, and `features/movie` sets no fixed height at all. So the
 * column is CSS flow, and only the WIDTH (`internal_gui_width`) and the ORDER
 * are parity-exact today. Reported; the totals are MEASURED against the real
 * engine in `bridge/tests/test_f7_layout.py` and tested here so the numbers
 * exist for whoever closes that gap, and so a future change to
 * `ButModeGetHeight` is caught.
 */
export interface OrthoPanelLayout {
  executive: number;
  wizard: number;
  butMode: number;
  control: number;
}

export function butModeHeight(mouseGrid: boolean): number {
  return mouseGrid ? ORTHO.butModeGridHeight : ORTHO.butModeHeight;
}

/** `LineHeight * NLine + 4`, and 0 with no wizard (`layer1/Wizard.cpp:253-259`). */
export function wizardHeight(lines: number, controlSize: number = ORTHO.controlSize): number {
  return lines > 0 ? controlSize * lines + ORTHO.wizardPad : 0;
}

export function layoutInternalGui(input: OrthoPanelInput): OrthoPanelLayout {
  const control = ORTHO.controlHeight;
  const butMode = butModeHeight(input.mouseGrid);
  const wizard = wizardHeight(input.wizardLines, input.controlSize ?? ORTHO.controlSize);
  // "the Executive Block ... extends all the way down to the top of the ButMode
  // block" when there is no wizard. Never negative: a column shorter than its
  // fixed blocks collapses Executive, it does not overlap them.
  const executive = Math.max(0, input.height - control - butMode - wizard);
  return { executive, wizard, butMode, control };
}

/* ------------------------------------------------------------------ *
 * The relayout rule (rows 88 and 209)
 * ------------------------------------------------------------------ */

/**
 * The settings whose ONLY side effect is `OrthoCommandIn(G, "viewport")`
 * (`layer1/Setting.cpp:2824-2833`), and what that is worth to a browser.
 *
 * `SettingGenerateSideEffects` runs after every write and is a ~500-line switch
 * over the setting index. These seven share one branch, and that branch queues
 * the `viewport` command — which with no arguments ends in `PyMOL_NeedReshape`
 * (`layer5/PyMOL.cpp:2511-2536`), a request to the WINDOWING SYSTEM to resize
 * the window. The bridge is not a windowing system, so nothing happens.
 *
 * MEASURED (`bridge/tests/test_f7_layout.py`), and both halves matter:
 *
 *     set mouse_grid, 1         -> not one pixel of the column moves, and a
 *                                  click at y=100 still misses the ButMode
 *                                  block. One reshape later, both change.
 *     set internal_feedback, 3  -> cmd.get_viewport() still answers 800x600.
 *                                  One reshape later, 800x558.
 *
 * The second is the dangerous one and it is not the shell's setting: a user who
 * types `set internal_feedback, 3` at the web prompt keeps a viewport that
 * agrees with the canvas until the next window resize, and then silently stops
 * agreeing by 42 px — every forwarded mouse coordinate with it. Whoever owns
 * the canvas (`features/viewport`) is the only code that can re-drive
 * `{t:'input',kind:'reshape'}`; this list is here so that fix has a name to
 * hang off, and so `internal_gui` (below) is not treated as a special case.
 *
 * NOT in the list, and measured to behave differently:
 * `internal_gui_control_size` relayouts INLINE (`WizardRefresh` ->
 * `OrthoReshapeWizard`, `Setting.cpp:2153-2156`) — its block rectangles move
 * with no reshape at all.
 */
export const LAYOUT_SETTINGS: readonly string[] = [
  'internal_gui_mode',
  'internal_gui_width',
  'internal_gui',
  'internal_feedback',
  'mouse_grid',
  'movie_panel_row_height',
  'movie_panel',
];

/** True when a write to `name` needs a client-driven reshape to take effect. */
export function needsReshape(name: string): boolean {
  return LAYOUT_SETTINGS.includes(name);
}

/**
 * The DOM order of the column, top to bottom, keyed by each panel's ROOT CLASS.
 *
 * `features/registry.ts` is frozen and declares no `butmode` slot, so
 * `features/shortcuts` PORTALS the ButMode block into `.internal-gui` with
 * `createPortal` — which APPENDS it, below the movie Control bar, upside down
 * relative to `OrthoLayoutPanel`. The shell stamps `style.order` on the
 * column's children instead (`internalGuiOrder`, applied by a
 * `MutationObserver` in `AppShell`), which is the one lever available to a
 * package that may not edit either the registry or `features/shortcuts`.
 *
 * A stylesheet rule would have done the same job, but nothing could then test
 * it: vitest stubs CSS imports and jsdom's `getComputedStyle` does not
 * implement `order` (both verified while writing `shell.dom.test.tsx`). An
 * inline style is the same mechanism and is observable.
 */
export const INTERNAL_GUI_ORDER: Readonly<Record<string, number>> = {
  /** Executive — the object panel. */
  objpanel: 10,
  /** Wizard. */
  wizards: 20,
  /** ButMode, portalled in by `features/shortcuts`. */
  'butmode-host': 30,
  /** Control — the movie/scene button bar. */
  mvpanel: 40,
  /** Not an Ortho block: `scene_buttons` is drawn over the scene in PyMOL. */
  scpanel: 50,
};

/**
 * The `order` for one column child, or null when nothing claims it.
 *
 * Unknown panels keep `order: 0` and therefore sort ABOVE everything listed —
 * deliberate: a block the shell has never heard of must be visible, not buried
 * under the movie bar where nobody would notice it had appeared.
 */
export function internalGuiOrder(classNames: Iterable<string>): number | null {
  for (const name of classNames) {
    const order = INTERNAL_GUI_ORDER[name];
    if (order !== undefined) return order;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * The gutter (row 103)
 * ------------------------------------------------------------------ */

/**
 * `cControlMinWidth`, applied the way `CControl::drag` applies it.
 *
 * MEASURED: `cmd.set('internal_gui_width', -20)` sticks, and the scene then
 * reports 820 px inside an 800 px window. The clamp is the client's.
 */
export function clampInternalGuiWidth(width: number, max = 600): number {
  if (!Number.isFinite(width)) return ORTHO.internalGuiWidth;
  return Math.min(max, Math.max(ORTHO.controlMinWidth, Math.round(width)));
}

/**
 * The gutter's state machine — `CControl::click` / `CControl::drag`.
 *
 * `SaveWidth` is the whole subtlety: a double click with no saved width
 * COLLAPSES and remembers; a double click with one RESTORES and forgets; and a
 * DRAG clears it (`I->SaveWidth = 0`, `layer1/Control.cpp:272`), so the next
 * double click collapses instead of restoring a width the user has since moved
 * away from.
 */
export interface GutterState {
  /** Current `internal_gui_width`. */
  width: number;
  /** `I->SaveWidth`: the width to restore, or 0 when there is nothing to. */
  savedWidth: number;
  /** `I->LastClickTime`, ms. */
  lastClickAt: number;
}

export const GUTTER_INITIAL: GutterState = {
  width: ORTHO.internalGuiWidth,
  savedWidth: 0,
  lastClickAt: Number.NEGATIVE_INFINITY,
};

/**
 * A click in the gutter. Returns the next state and whether it collapsed.
 *
 * THE TIMER ANCHOR IS NOT RESET BY A DOUBLE CLICK. `CControl::click` assigns
 * `I->LastClickTime` **only** in the `else` branch — the one that arms the drag
 * (`layer1/Control.cpp:466-467`) — and the collapse/restore branch sets
 * `I->SkipRelease = true`, which then also skips the second assignment in
 * `CControl::release` (`:377-380`). So the 0.35 s window is anchored on the last
 * ARMING gesture and every click inside it toggles.
 *
 * That is not the same as "each click restarts the timer", which is what this
 * function did before wave 6 verification. Concrete divergence, clicks 0.30 s
 * apart: PyMOL arms at t=0, collapses at t=0.30, and at t=0.60 (0.60 from the
 * anchor) ARMS AGAIN instead of restoring; the reset-every-click version
 * restored. Both agree on an ordinary double click and on a fast multi-click,
 * which is why the browser probe could not see it.
 *
 * KNOWN, DELIBERATE REMAINDER. PyMOL's anchor is the RELEASE of the arming
 * gesture (`CControl::release`), this one is the press. On a real pointer that
 * is the few tens of ms a button is held, so a gesture 340 ms after the press
 * counts here and might not in PyMOL. Reproducing it would mean threading
 * `SkipRelease` through `pointerup`; it is documented rather than done.
 */
export function gutterClick(
  state: GutterState,
  now: number,
): { state: GutterState; changed: boolean } {
  if (now - state.lastClickAt < GUTTER_DOUBLE_CLICK_MS) {
    if (state.savedWidth) {
      return {
        state: { width: state.savedWidth, savedWidth: 0, lastClickAt: state.lastClickAt },
        changed: true,
      };
    }
    return {
      state: {
        width: ORTHO.controlMinWidth,
        savedWidth: state.width,
        lastClickAt: state.lastClickAt,
      },
      changed: true,
    };
  }
  // A single click only arms the drag; the width does not move.
  return { state: { ...state, lastClickAt: now }, changed: false };
}

/** A drag to `width`. Clears `SaveWidth`, exactly as `CControl::drag` does. */
export function gutterDrag(state: GutterState, width: number, max = 600): GutterState {
  return { ...state, width: clampInternalGuiWidth(width, max), savedWidth: 0 };
}

/* ------------------------------------------------------------------ *
 * Adopting the backend's values (row 88)
 * ------------------------------------------------------------------ */

/** Settings the shell mirrors. */
export interface ShellSettings {
  internal_gui: number;
  internal_gui_width: number;
}

/**
 * Settings the BRIDGE forces to 0 at boot, so a first sample of 0 is the
 * bridge's opinion and not the user's.
 *
 * `engine.py` sets `options.internal_gui = 0` before `start()` AND
 * `cmd.set("internal_gui", 0)` after it. Adopting that blindly hides the whole
 * right-hand column permanently — the same failure `features/console`'s
 * `settingsAdopt.ts` documents for `internal_feedback`, where the console went
 * dark exactly one second after connecting.
 */
export const BRIDGE_ZEROED: readonly (keyof ShellSettings)[] = ['internal_gui'];

/**
 * Settings the BROWSER owns and only MIRRORS into PyMOL.
 *
 * Row 53's plan: "Dock geometry = client state". The column width lives in
 * `localStorage` across restarts, while PyMOL comes up at its own default (220)
 * every launch — so the first sample is recorded but NOT adopted, and the shell
 * pushes its own value instead. Every LATER change is adopted, which is what
 * makes `set internal_gui_width, 300` typed at the prompt move the splitter.
 */
export const CLIENT_OWNED: readonly (keyof ShellSettings)[] = ['internal_gui_width'];

export interface ShellAdoptResult {
  /** What to merge into the UI store. */
  patch: Partial<ShellSettings>;
  /** The remote snapshot to pass back as `previous` next time. */
  remote: Partial<ShellSettings>;
}

/**
 * Adopt only what CHANGED, and never a boot-zeroed setting's first zero.
 *
 * The change-only rule matters for `internal_gui_width` too, for a different
 * reason: the client WRITES that setting from the splitter, so a poll in flight
 * carries a stale value and adopting it unconditionally would snap the column
 * back mid-drag.
 */
export function adoptShellSettings(
  previous: Partial<ShellSettings>,
  values: ReadonlyArray<readonly [keyof ShellSettings, number | null]>,
): ShellAdoptResult {
  const patch: Partial<ShellSettings> = {};
  const remote: Partial<ShellSettings> = { ...previous };

  for (const [name, value] of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const before = previous[name];
    remote[name] = value;
    if (before === undefined) {
      // First sample: the bridge's own 0 is not an instruction, and a
      // client-owned setting's startup default is not either.
      if (BRIDGE_ZEROED.includes(name) && value === 0) continue;
      if (CLIENT_OWNED.includes(name)) continue;
    } else if (value === before) {
      continue;
    }
    patch[name] = value;
  }

  return { patch, remote };
}

/**
 * What the shell must WRITE BACK after adopting a patch, and why there is one.
 *
 * `internal_gui` is the one setting where adopting the user's intent is not the
 * end of the job. Typing `set internal_gui, 1` at the web prompt means "show me
 * the block column", and the React column is what shows it — but the write also
 * leaves PyMOL's own copy armed. MEASURED (`bridge/tests/test_f7_layout.py`):
 * the write changes nothing at all on its own, because it only queues
 * `viewport` (see `LAYOUT_SETTINGS`); the damage lands on the NEXT CANVAS
 * RESIZE, when `OrthoReshape` takes 220 px off the scene and the browser's
 * canvas keeps its own size. From that moment PyMOL draws its column over the
 * right-hand 220 px of the Mode-P image and every forwarded mouse coordinate is
 * 220 px out — with no event in between to blame it on.
 *
 * So the shell answers a non-zero `internal_gui` with an immediate 0. The UI
 * store still turns the column on, which is what the user asked for; only
 * PyMOL's duplicate is refused. A 0 needs no correction, and neither does the
 * absence of a change — the write must not repeat on every poll.
 */
export function shellSettingWriteBacks(
  patch: Partial<ShellSettings>,
): Partial<ShellSettings> {
  const out: Partial<ShellSettings> = {};
  if (patch.internal_gui !== undefined && patch.internal_gui !== 0) out.internal_gui = 0;
  return out;
}

/* ------------------------------------------------------------------ *
 * Row 53 leftovers that are arithmetic rather than DOM
 * ------------------------------------------------------------------ */

export interface InvocationOptions {
  win_x: number;
  win_y: number;
  internal_gui: number;
  external_gui: number;
}

/**
 * `QMainWindow.resize(win_x + (220 if internal_gui), win_y + (246 if
 * external_gui else 18))` (`modules/pmg_qt/pymol_qt_gui.py:93-95`).
 *
 * Kept as executable documentation, NOT as a sizing rule: MEASURED, the bridge
 * reports `win_x, win_y = 640, 480` — the invocation defaults — while the
 * surface PyMOL actually draws into is `BridgeConfig`'s (800x600 in the test
 * rig, the browser canvas in the product). A shell that sized itself from these
 * would be 160x120 short. The browser window is the user's; the canvas tells
 * the backend its size, not the other way round.
 */
export function qtInitialWindowSize(options: InvocationOptions): { width: number; height: number } {
  return {
    width: options.win_x + (options.internal_gui ? 220 : 0),
    height: options.win_y + (options.external_gui ? 246 : 18),
  };
}

/**
 * The window title Qt keeps in sync with setting 440, `session_file`
 * (`modules/pmg_qt/pymol_qt_gui.py:112-115`).
 *
 * Qt registers a callback that only ever fires on a CHANGE, so a fresh session
 * (where `session_file` is `''`) keeps the default window title rather than
 * showing `PyMOL ()`. This returns plain `PyMOL` for that case; MEASURED, a
 * `cmd.save(*.pse)` sets the setting to the absolute path and the title becomes
 * `PyMOL (<basename>)`.
 */
export function windowTitle(sessionFile: string | null | undefined): string {
  const path = (sessionFile ?? '').trim();
  if (path === '') return 'PyMOL';
  const base = path.split(/[\\/]/).pop() ?? path;
  return `PyMOL (${base})`;
}
