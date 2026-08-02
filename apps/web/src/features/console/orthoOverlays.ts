/**
 * The two things PyMOL draws in its ortho layer that are not TEXT: the busy box
 * and the rubber-band rectangle.  Pure functions only; the components are
 * `BusyOverlay.tsx` and `OrthoLoopRect.tsx`.
 *
 * ---------------------------------------------------------------------------
 * 1. THE BUSY BOX — `OrthoBusyDraw` (`packages/engine/layer1/Ortho.cpp:609-724`)
 *
 * A 240x60 black rectangle in the TOP-LEFT corner of the viewport holding a
 * message line and up to two progress bars, drawn straight into `GL_FRONT` so
 * it appears while a long C++ call has the engine.
 *
 * TWO BARS, ONE NUMBER.  `I->BusyStatus[0..1]` is the SLOW counter and
 * `[2..3]` the FAST one, and the box draws a bar for each.  The only thing
 * Python can see is `cmd.get_progress()`, and `CmdGetProgress`
 * (`packages/engine/layer4/Cmd.cpp:4334-4348`) folds slow into fast and divides — one
 * fraction, not two pairs.  So this overlay draws ONE bar, and that is a
 * measured limit of the API rather than a shortcut:
 * `packages/bridge/tests/test_wf_ortho.py::test_the_busy_MESSAGE_and_the_two_BARS_are_not_reachable_from_python`
 * shows `cmd.get_busy_status` and friends are not symbols at all.
 *
 * NO MESSAGE, EITHER.  `I->BusyMessage` is written by `OrthoBusyMessage`
 * (`:530`) from C callers and never leaves the C.  The caption below is
 * therefore the client's own, and says what it actually knows.
 *
 * ---------------------------------------------------------------------------
 * 2. THE MARQUEE — `OrthoDrawLoop` (`packages/engine/layer1/Ortho.cpp:1695-1745`)
 *
 * A 1 px `cColorFront` outline of `I->LoopRect`, which `SceneMouse` pushes
 * into Ortho on every drag (`OrthoSetLoopRect`, `packages/engine/layer1/SceneMouse.cpp:44-66`)
 * and clears on release.  The rect never reaches Python — measured in
 * `test_wf_ortho.py::test_the_marquee_rectangle_is_not_readable_from_python` —
 * so a web client cannot echo the backend's rectangle and has to draw its own
 * from pointer state.  The BACKEND half of the gesture needs nothing new: the
 * forwarded press/drag/release already produce the selection
 * (`packages/bridge/tests/test_box_selection.py`).
 *
 * That is why this lives in the console feature: `LoopRect` is Ortho's, drawn
 * by the same `OrthoDoDraw` pass as the console text (`:2024-2040`), and this
 * feature already owns the DOM layer portalled over the viewport.
 */

import {
  BUT_MODE_NOTHING,
  butModeTranslate,
} from '../../../../../packages/viewport/src/input/butmode';
import { MODE_NAME_DICT, type ModeName } from '../../../../../packages/viewport/src/input/modes';
import { isModeName, tableForMode } from '../../../../../packages/viewport/src/input/mouseConfig';

/* NOTE ON THOSE THREE RELATIVE PATHS: `apps/web/package.json` does not depend
 * on `@tenmol/viewport`, so `apps/web/node_modules/@tenmol/viewport` does not
 * exist and vitest (which never loads `apps/web/vite.config.ts`, where the
 * alias lives) cannot resolve the specifier.  The same workaround, with the
 * same explanation, is in `apps/web/src/features/mouse/tables.ts`; the fix is
 * to add the workspace dependency, which is another work package's file. */

/* ------------------------------------------------------------------ *
 * 1. The busy box
 * ------------------------------------------------------------------ */

/** `cBusyWidth` (`packages/engine/layer1/Ortho.cpp:192`). */
export const BUSY_WIDTH = 240;
/** `cBusyHeight` (`:193`). */
export const BUSY_HEIGHT = 60;
/** `cBusyMargin` (`:194`). */
export const BUSY_MARGIN = 10;
/** `cBusyBar` (`:195`) — the bar's height. */
export const BUSY_BAR = 10;
/** `cBusySpacing` (`:196`) — the line pitch inside the box. */
export const BUSY_SPACING = 15;
/** `cBusyUpdate` (`:198`) — the box redraws at most every 0.2 s. */
export const BUSY_UPDATE_S = 0.2;

/** The bar's full width: `cBusyWidth - 2 * cBusyMargin` (`:670`, `:675`). */
export const BUSY_BAR_WIDTH = BUSY_WIDTH - 2 * BUSY_MARGIN;

/**
 * Filled width in px, from `x = status[0] * (cBusyWidth - 2*margin) /
 * status[1]` (`:675-677`) with `status[0]/status[1]` replaced by the folded
 * fraction `cmd.get_progress()` hands out.
 *
 * Clamped, because the value crosses a socket: a `fraction` field that is
 * missing, NaN or > 1 must not produce a bar wider than the box.
 */
export function busyFillWidth(fraction: number): number {
  if (!Number.isFinite(fraction) || fraction <= 0) return 0;
  return Math.round(Math.min(1, fraction) * BUSY_BAR_WIDTH);
}

/**
 * Is the box drawn?  `OrthoBusyDraw` is gated by `show_progress` (`:619`), and
 * `get_progress()` is negative unless `PyMOL_GetBusy()` (`packages/engine/layer4/Cmd.cpp:4341`).
 *
 * The `show_progress` half is belt and braces: measured on a live bridge, the
 * setting silences the DATA as well as the drawing, because `OrthoBusySlow` /
 * `OrthoBusyFast` test it before calling `PyMOL_SetProgress` at all
 * (`packages/engine/layer1/Ortho.cpp:547`, `:577`) — 13 progress frames across two rays with
 * `show_progress, 0`, every one of them -1.0.
 */
export function busyVisible(progress: number, showProgress: boolean): boolean {
  return showProgress && Number.isFinite(progress) && progress >= 0;
}

/* ------------------------------------------------------------------ *
 * 2. The marquee
 * ------------------------------------------------------------------ */

/** A point in the viewport element's own CSS pixels. */
export interface Point {
  x: number;
  y: number;
}

/** A CSS-positionable rectangle. */
export interface LoopBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * `SceneLoopClick` + `SceneLoopDrag` + the normalisation `SceneLoopRelease`
 * does (`packages/engine/layer1/SceneMouse.cpp:44-92`): the press corner is
 * `left`/`top`, the live corner is `right`/`bottom`, and the pair is swapped
 * so the rect is well-ordered.  PyMOL's y axis points up and the DOM's points
 * down, so "swap when top < bottom" is min/max here — the same rectangle.
 */
export function loopBox(press: Point, current: Point): LoopBox {
  const left = Math.min(press.x, current.x);
  const top = Math.min(press.y, current.y);
  return {
    left,
    top,
    width: Math.abs(current.x - press.x),
    height: Math.abs(current.y - press.y),
  };
}

/** What a box drag does to the selection. */
export type LoopKind = 'add' | 'subtract' | 'set';

/**
 * The six action codes that start a rubber band, from the `switch` in
 * `SceneClick` that dispatches to `SceneLoopClick`
 * (`packages/engine/layer1/SceneMouse.cpp:803-809`).  Values are `packages/engine/layer1/ButMode.h:44-46`,
 * `:58-59`, `:91`.
 */
export const LOOP_ACTIONS: Readonly<Record<number, LoopKind>> = {
  19: 'add', // cButModeRectAdd  (`+lbx`, deprecated but still dispatched)
  20: 'subtract', // cButModeRectSub  (`-lbx`, deprecated)
  21: 'set', // cButModeRect     (`lbbx`, deprecated)
  32: 'add', // cButModeSeleAddBox (`+Box`)
  33: 'subtract', // cButModeSeleSubBox (`-Box`)
  52: 'set', // cButModeSeleSetBox (` Box`)
};

/**
 * Would this press start a rubber band?  `null` when it would not.
 *
 * `table` is the 80-slot ButMode array for the CURRENT `button_mode`; `button`
 * is a DOM `MouseEvent.button` (0/1/2), which is numerically the same as
 * GLUT's left/middle/right; `mod` is the `cOrtho` mask from `modifierMask`.
 *
 * This duplicates a decision the backend also makes, and it has to: PyMOL
 * resolves the slot in `SceneClick` and never tells anyone, so an overlay that
 * waited to be told would draw nothing.  The cost of being wrong is a
 * rectangle that should not be there (or a missing one) for one gesture — the
 * SELECTION is still made by `ExecutiveSelectRect` in the C either way.
 */
export function loopKindFor(
  table: readonly number[],
  button: number,
  mod: number,
): LoopKind | null {
  const code = butModeTranslate(table, button, mod);
  if (code === BUT_MODE_NOTHING) return null;
  return LOOP_ACTIONS[code] ?? null;
}

/**
 * `button_mode_name` (what `cmd.get_setting_text` answers, e.g.
 * `3-Button Viewing`) -> the 80-slot table.  The inverse of
 * `mode_name_dict` (`packages/engine/modules/pymol/controlling.py`), falling back to the
 * three-button viewing table so the first gesture after a page load — before
 * the name has come back — still behaves like a stock PyMOL.
 */
export const DEFAULT_MODE: ModeName = 'three_button_viewing';

export function modeFromDisplayName(displayName: string): ModeName {
  for (const [key, label] of Object.entries(MODE_NAME_DICT)) {
    if (label === displayName && isModeName(key)) return key;
  }
  // `default` and the ring keys have no display name; `cmd.mouse` writes the
  // raw key through in that case.
  return isModeName(displayName) ? displayName : DEFAULT_MODE;
}

export function tableForDisplayName(displayName: string): number[] {
  return tableForMode(modeFromDisplayName(displayName));
}

/* ------------------------------------------------------------------ *
 * 3. The splash
 * ------------------------------------------------------------------ */

/** Just enough of `ConsoleStore` to raise the flag. */
interface SplashTarget {
  set(patch: { splash: boolean }): void;
  setVisible(visible: boolean): void;
}

/**
 * What the console bar's `splash` button does.
 *
 * `OrthoInit` raises `I->SplashFlag` only when it is handed `showSplash`
 * (`packages/engine/layer1/Ortho.cpp:2729-2731`), and the bridge boots PyMOL with
 * `options.show_splash = 0` (`packages/bridge/tenmol_bridge/engine.py:132`) — measured
 * in `test_wf_ortho.py::test_the_bridge_boots_with_the_splash_off` — so a
 * browser never inherits one and the store's flag correctly starts false.
 *
 * `cmd.splash(0)` runs the real `OrthoSplash` (`packages/engine/layer4/Cmd.cpp:2865-2869`), so
 * the banner is PyMOL's own text arriving on the feedback channel rather than
 * a copy that will rot.  Raising the flag then reproduces what the flag DOES:
 * force the whole scrollback visible over the scene (`:1638`, pinned in
 * `console.test.ts`) until a click or Esc calls `OrthoRemoveSplash`.
 *
 * The overlay is forced visible too, because the flag is invisible while the
 * client has the in-viewport console switched off.
 */
export function showSplash(
  call: (fn: string, args?: readonly unknown[]) => Promise<unknown>,
  store: SplashTarget,
): void {
  void call('cmd.splash', [0]).catch(() => undefined);
  store.set({ splash: true });
  store.setVisible(true);
}
