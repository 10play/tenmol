/**
 * The Seeker mouse grammar, as a pure reducer.
 *
 * `SeekerClick` (`packages/engine/layer3/Seeker.cpp:317-470`) and `SeekerDrag` (`:527-670`) are
 * a small state machine over `CSeeker::dragInfo`. Reproducing it inside React
 * event handlers would make it untestable and would hide the one genuinely
 * subtle part — the direction flip, where dragging back past the anchor
 * UNDOES what the outbound leg did rather than re-toggling it.
 *
 * So the machine lives here, takes no DOM and no transport, and emits
 * `SeqAction`s that `SequenceViewer.tsx` hands to `source.ts`. Each emitted
 * action names the C++ call it stands for.
 */

/** `cDoubleTime` (`packages/engine/layer3/Seeker.cpp:315`), in milliseconds. */
export const DOUBLE_CLICK_MS = 350;

/** `P_GLUT_LEFT/MIDDLE/RIGHT` (`packages/engine/layer0/os_gl_glut_pretend.h:11-26`). */
export const Button = { Left: 0, Middle: 1, Right: 2 } as const;
/** A GLUT mouse-button code: left, middle or right. */
export type ButtonValue = (typeof Button)[keyof typeof Button];

/** The modifier keys held during a click or drag. */
export interface Mods {
  shift: boolean;
  ctrl: boolean;
}

/** `CSeeker::dragInfo` (`packages/engine/layer3/Seeker.cpp:38-60`). */
export interface SeqDrag {
  button: ButtonValue;
  /** Row index; the row is PINNED for the whole drag (`packages/engine/layer1/Seq.cpp:158`). */
  row: number;
  startCol: number;
  lastCol: number;
  /** 0 until the first move, then +1 / -1. */
  dir: number;
  /** `dragInfo.setting` — is this drag selecting or deselecting? */
  setting: boolean;
  /** `dragInfo.start_toggle` — is the anchor column currently toggled? */
  startToggle: boolean;
  /** Modifier-independent record of where the box is drawn (`box_*`). */
  boxStartCol: number;
  boxStopCol: number;
}

/** A side-effecting outcome of the reducer, each mapping to one C++ call. */
export type SeqAction =
  /** `SeekerSelectionToggle` (`:169`). */
  | { type: 'toggle'; row: number; col: number; include: boolean; startOver: boolean }
  /** `SeekerSelectionToggleRange` (`:70`). */
  | {
      type: 'range';
      row: number;
      first: number;
      last: number;
      include: boolean;
      startOver: boolean;
    }
  /** `SeekerSelectionUpdateCenter` + `SeekerSelectionCenter` (`:248`, `:275`). */
  | { type: 'browse'; row: number; first: number; last: number; zoom: boolean; startOver: boolean }
  /** `SeekerSelectionCenter(G, 2)` — center on the ACTIVE selection (`:419`). */
  | { type: 'centerSelection' }
  /** `SettingSetSmart_i(..., cSetting_state, col->state)` (`:463`). */
  | { type: 'setState'; row: number; col: number; state: number }
  /** Left double-click outside a cell (`:328-341`). */
  | { type: 'clear' }
  /** `MenuActivate2Arg(..., "pick_sele"|"seq_option", ...)` (`:363-390`). */
  | { type: 'menu'; menu: 'pick_sele' | 'seq_option'; row: number; col: number }
  /** Wheel — horizontal scroll by ±1 (`packages/engine/layer1/Seq.cpp:218-223`). */
  | { type: 'scroll'; delta: number };

/** The full context a `click` decision reads: cell, mods, timing and live drag. */
export interface ClickInput {
  button: ButtonValue;
  /** -1 when the pointer is not over a row/cell. */
  row: number;
  col: number;
  mods: Mods;
  /** `col->spacer` — a gap column swallows every button (`:395`, `:420`). */
  spacer: boolean;
  /** `col->inverse` — already in the active selection. */
  selected: boolean;
  /** `col->state`, 0 when the column does not carry one. */
  state: number;
  /** `codes != 4 || DiscreteFlag` (`:427`). */
  selectable: boolean;
  /** True when an active selection exists — decides pick_sele vs seq_option. */
  hasActiveSele: boolean;
  /** `UtilGetSeconds(G) - I->LastClickTime`, in ms. */
  sinceLastClickMs: number;
  /** The live drag, if the previous press started one on the same row. */
  drag: SeqDrag | null;
}

/** What the reducer returns: actions to emit plus the next drag state. */
export interface Outcome {
  actions: SeqAction[];
  drag: SeqDrag | null;
}

const NOTHING: Outcome = { actions: [], drag: null };

/** `SeekerClick`. */
export function click(input: ClickInput): Outcome {
  if (input.row < 0 || input.col < 0) {
    // Outside any cell. Left within cDoubleTime clears; right opens pick_sele
    // for the active selection (`packages/engine/layer1/Seq.cpp:240-248`).
    if (input.button === Button.Left && input.sinceLastClickMs < DOUBLE_CLICK_MS) {
      return { actions: [{ type: 'clear' }], drag: null };
    }
    if (input.button === Button.Right && input.hasActiveSele) {
      return { actions: [{ type: 'menu', menu: 'pick_sele', row: -1, col: -1 }], drag: null };
    }
    return NOTHING;
  }

  // `continuation` (`:349-355`): shift + left on the row the last drag was on.
  const continuation =
    input.button === Button.Left &&
    input.mods.shift &&
    input.drag !== null &&
    input.drag.row === input.row;

  if (input.button === Button.Right) {
    // A selected cell with an active selection -> the selection's own menu;
    // otherwise the residue's menu, built on `_seeker` (`:363-390`).
    const menu = input.hasActiveSele && input.selected ? 'pick_sele' : 'seq_option';
    return { actions: [{ type: 'menu', menu, row: input.row, col: input.col }], drag: null };
  }

  if (input.spacer) return NOTHING;

  if (input.button === Button.Middle) {
    const actions: SeqAction[] = [
      {
        type: 'browse',
        row: input.row,
        first: input.col,
        last: input.col,
        zoom: input.mods.ctrl,
        startOver: true,
      },
    ];
    if (input.state) {
      actions.push({ type: 'setState', row: input.row, col: input.col, state: input.state });
    }
    return { actions, drag: freshDrag(Button.Middle, input, true) };
  }

  // Left.
  const actions: SeqAction[] = [];
  let drag: SeqDrag | null = input.drag;

  if (input.selectable) {
    if (continuation && drag) {
      // `:356-365` — the anchor is kept; if the pointer crossed to the other
      // side of it, swap the ends and flip the direction, then re-run the drag.
      let next = drag;
      if (
        (input.col < drag.startCol && drag.lastCol > drag.startCol) ||
        (input.col > drag.startCol && drag.lastCol < drag.startCol)
      ) {
        next = { ...drag, startCol: drag.lastCol, lastCol: drag.startCol, dir: -drag.dir };
      }
      const moved = move(next, input.row, input.col, input.mods);
      return { actions: moved.actions, drag: moved.drag };
    }

    // `:394-401` — a fresh press toggles the cell the other way from what it is.
    const include = !input.selected;
    actions.push({ type: 'toggle', row: input.row, col: input.col, include, startOver: false });
    drag = freshDrag(Button.Left, input, include);
  }

  // `:419-421` — ctrl additionally centers on the active selection. It runs
  // even when the column is not selectable.
  if (input.mods.ctrl) actions.push({ type: 'centerSelection' });

  if (input.state) {
    actions.push({ type: 'setState', row: input.row, col: input.col, state: input.state });
  }

  return { actions, drag };
}

/**
 * `SeekerDrag` (`packages/engine/layer3/Seeker.cpp:527-670`).
 *
 * `col` is already clamped to the pinned row by the caller, because the C pins
 * it too (`LastRow`, `packages/engine/layer1/Seq.cpp:158`).
 */
export function move(drag: SeqDrag, row: number, col: number, mods: Mods): Outcome {
  if (drag.row !== row || col < 0 || col === drag.lastCol) {
    return { actions: [], drag };
  }

  const actions: SeqAction[] = [];
  let state: SeqDrag = { ...drag, boxStopCol: col };
  let target = col;

  if (drag.button === Button.Middle) {
    // `:625-664`: without shift the centre selection RESTARTS at the column
    // under the pointer; with shift it accumulates.
    const startOver = !mods.shift;
    if (startOver) {
      actions.push({
        type: 'browse',
        row,
        first: col,
        last: col,
        zoom: mods.ctrl,
        startOver: true,
      });
      state = { ...state, boxStartCol: col, lastCol: col };
    } else {
      const lo = Math.min(state.lastCol, col);
      const hi = Math.max(state.lastCol, col);
      actions.push({ type: 'browse', row, first: lo, last: hi, zoom: mods.ctrl, startOver: false });
      state = { ...state, lastCol: col };
    }
    return { actions, drag: state };
  }

  // Left drag.
  // 1. `:539-570` — the anchor itself flips back and forth when the pointer
  //    crosses it, so a retraction UNDOES the anchor instead of re-toggling it.
  if (state.dir !== 0) {
    const crossedBack =
      (state.dir > 0 && target <= state.startCol) || (state.dir < 0 && target >= state.startCol);
    if (crossedBack) {
      target = state.startCol;
      if (state.startToggle) {
        actions.push({
          type: 'toggle',
          row,
          col: state.startCol,
          include: !state.setting,
          startOver: false,
        });
        state = { ...state, startToggle: false };
      }
    } else if (!state.startToggle) {
      actions.push({
        type: 'toggle',
        row,
        col: state.startCol,
        include: state.setting,
        startOver: false,
      });
      state = { ...state, startToggle: true };
    }
  }

  // 2. `:572-583` — the pointer jumped clean over the anchor: undo the whole
  //    old side first, then fall through and paint the new one.
  if (state.lastCol < state.startCol && target > state.startCol) {
    actions.push({
      type: 'range',
      row,
      first: state.lastCol,
      last: state.startCol - 1,
      include: !state.setting,
      startOver: false,
    });
    state = { ...state, lastCol: state.startCol };
  }
  if (state.lastCol > state.startCol && target < state.startCol) {
    actions.push({
      type: 'range',
      row,
      first: state.startCol + 1,
      last: state.lastCol,
      include: !state.setting,
      startOver: false,
    });
    state = { ...state, lastCol: state.startCol };
  }

  // 3. `:584-600` — leaving the anchor for the first time sets the direction.
  if (state.startCol === state.lastCol) {
    if (target > state.startCol) {
      if (!state.dir) state = { ...state, dir: 1 };
      state = { ...state, lastCol: state.startCol + 1 };
      actions.push({
        type: 'toggle',
        row,
        col: state.lastCol,
        include: state.setting,
        startOver: false,
      });
    } else if (target < state.startCol) {
      if (!state.dir) state = { ...state, dir: -1 };
      state = { ...state, lastCol: state.startCol - 1 };
      actions.push({
        type: 'toggle',
        row,
        col: state.lastCol,
        include: state.setting,
        startOver: false,
      });
    }
  }

  // 4. `:601-620` — extend (setting) or retract (!setting) the span.
  if (state.startCol < state.lastCol) {
    if (target > state.lastCol) {
      actions.push({
        type: 'range',
        row,
        first: state.lastCol + 1,
        last: target,
        include: state.setting,
        startOver: false,
      });
    } else {
      actions.push({
        type: 'range',
        row,
        first: target + 1,
        last: state.lastCol,
        include: !state.setting,
        startOver: false,
      });
    }
  } else if (target < state.lastCol) {
    actions.push({
      type: 'range',
      row,
      first: target,
      last: state.lastCol - 1,
      include: state.setting,
      startOver: false,
    });
  } else {
    actions.push({
      type: 'range',
      row,
      first: state.lastCol,
      last: target - 1,
      include: !state.setting,
      startOver: false,
    });
  }

  state = { ...state, lastCol: target };

  // `:619-621` — ctrl re-centres at every step of the drag.
  if (mods.ctrl) actions.push({ type: 'centerSelection' });

  return { actions: actions.filter(nonEmptyRange), drag: state };
}

/** Wheel — `packages/engine/layer1/Seq.cpp:218-223`, exactly one column per notch. */
export function wheel(deltaY: number): { type: 'scroll'; delta: number } {
  return { type: 'scroll', delta: deltaY > 0 ? 1 : -1 };
}

function freshDrag(button: ButtonValue, input: ClickInput, setting: boolean): SeqDrag {
  return {
    button,
    row: input.row,
    startCol: input.col,
    lastCol: input.col,
    dir: 0,
    setting,
    startToggle: true,
    boxStartCol: input.col,
    boxStopCol: input.col,
  };
}

/** `for(col = first; col <= last; ...)` never runs when `last < first`. */
function nonEmptyRange(action: SeqAction): boolean {
  return action.type !== 'range' || action.last >= action.first;
}
