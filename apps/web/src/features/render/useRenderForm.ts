/**
 * The Draw/Ray form's derived state.
 *
 * `packages/engine/modules/pmg_qt/pymol_qt_gui.py:673` keeps FIVE mutually-dependent widgets in
 * sync — width px, height px, width units, height units, dpi — plus an
 * aspect-ratio lock, and it does it by writing back into the other widgets from
 * every editingFinished handler. The write-backs re-enter, so it needs an
 * `UpdateLock([ZeroDivisionError])` and a `@skipIfCircular` decorator to stop
 * the recursion, and the lock self-unchecks when a zero slips through.
 *
 * The inventory row says to replace that with one derived-state reducer, which
 * is what this is: ONE source of truth (pixel width, pixel height, dpi, lock)
 * and everything else computed. Nothing writes back, so nothing re-enters and
 * there is no lock to leak.
 *
 * Units follow `input_units`: inch factor 1.0, cm factor 2.54.
 */

export type Units = 'inch' | 'cm';

/** cm per inch — the Qt form's literal 2.54 factor. */
const CM_PER_INCH = 2.54;

/** The Draw/Ray form's single source of truth: pixel size, dpi, units, aspect lock, transparency. */
export interface RenderState {
  width: number;
  height: number;
  dpi: number;
  units: Units;
  /** Preserve aspect ratio when one dimension changes. */
  lock: boolean;
  transparent: boolean;
}

/** The form's default state: 1024x768 at 300 dpi, inches, aspect locked. */
export const INITIAL: RenderState = {
  width: 1024,
  height: 768,
  dpi: 300,
  units: 'inch',
  lock: true,
  transparent: false,
};

/** An edit to the render form — a widget change or a viewport-size sync. */
export type RenderAction =
  | { type: 'width'; px: number }
  | { type: 'height'; px: number }
  | { type: 'widthUnits'; value: number }
  | { type: 'heightUnits'; value: number }
  | { type: 'dpi'; value: number }
  | { type: 'units'; value: Units }
  | { type: 'lock'; value: boolean }
  | { type: 'transparent'; value: boolean }
  | { type: 'viewport'; width: number; height: number };

const clampPx = (n: number): number => (Number.isFinite(n) ? Math.max(1, Math.round(n)) : 1);
const clampDpi = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.round(n) : 1);

/** Pixels for a physical size. Guards the ZeroDivisionError the Qt form catches. */
export function unitsToPx(value: number, dpi: number, units: Units): number {
  const inches = units === 'cm' ? value / CM_PER_INCH : value;
  return clampPx(inches * dpi);
}

/** Physical size of a pixel count, in `units`. */
export function pxToUnits(px: number, dpi: number, units: Units): number {
  if (dpi <= 0) return 0;
  const inches = px / dpi;
  return units === 'cm' ? inches * CM_PER_INCH : inches;
}

/** Everything the form displays, derived. Never stored. */
export function derive(state: RenderState) {
  return {
    widthUnits: pxToUnits(state.width, state.dpi, state.units),
    heightUnits: pxToUnits(state.height, state.dpi, state.units),
    aspect: state.height > 0 ? state.width / state.height : 0,
  };
}

/** Apply one `RenderAction`, deriving locked dimensions so nothing writes back. */
export function reducer(state: RenderState, action: RenderAction): RenderState {
  switch (action.type) {
    case 'width': {
      const width = clampPx(action.px);
      if (!state.lock || state.width <= 0) return { ...state, width };
      // Ratio from the PREVIOUS pair, so repeated edits do not drift.
      const ratio = state.height / state.width;
      return { ...state, width, height: clampPx(width * ratio) };
    }
    case 'height': {
      const height = clampPx(action.px);
      if (!state.lock || state.height <= 0) return { ...state, height };
      const ratio = state.width / state.height;
      return { ...state, height, width: clampPx(height * ratio) };
    }
    case 'widthUnits':
      return reducer(state, { type: 'width', px: unitsToPx(action.value, state.dpi, state.units) });
    case 'heightUnits':
      return reducer(state, {
        type: 'height',
        px: unitsToPx(action.value, state.dpi, state.units),
      });
    case 'dpi':
      // Changing dpi re-lets the same PIXELS mean a different physical size; it
      // must not resize the image. Qt's form does the same.
      return { ...state, dpi: clampDpi(action.value) };
    case 'units':
      return { ...state, units: action.value };
    case 'lock':
      return { ...state, lock: action.value };
    case 'transparent':
      return { ...state, transparent: action.value };
    case 'viewport':
      // `button_current`: adopt the viewport size verbatim, lock or no lock.
      return { ...state, width: clampPx(action.width), height: clampPx(action.height) };
    default:
      return state;
  }
}
