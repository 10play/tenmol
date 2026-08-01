/**
 * The Seeker mouse grammar, checked against the C++ it is transcribed from.
 *
 * The load-bearing case is the drag DIRECTION FLIP (`SeekerDrag`,
 * `layer3/Seeker.cpp:539-620`): dragging out from the anchor selects, dragging
 * back UNSELECTS what the outbound leg selected rather than toggling it again,
 * and crossing the anchor undoes the whole far side before painting the near
 * one. A naive `[min(start,col), max(start,col)]` implementation looks right on
 * the way out and is wrong on the way back, which is why this file exists.
 */

import { describe, expect, it } from 'vitest';
import {
  Button,
  DOUBLE_CLICK_MS,
  click,
  move,
  wheel,
  type ClickInput,
  type SeqAction,
  type SeqDrag,
} from './grammar';

const BASE: ClickInput = {
  button: Button.Left,
  row: 0,
  col: 10,
  mods: { shift: false, ctrl: false },
  spacer: false,
  selected: false,
  state: 0,
  selectable: true,
  hasActiveSele: false,
  sinceLastClickMs: 10_000,
  drag: null,
};

function at(overrides: Partial<ClickInput>): ClickInput {
  return { ...BASE, ...overrides, mods: { ...BASE.mods, ...overrides.mods } };
}

/** Replay a whole drag and reduce it to "which columns end up selected". */
function replay(
  press: ClickInput,
  columns: readonly number[],
  mods = { shift: false, ctrl: false },
): Set<number> {
  const selected = new Set<number>();
  const apply = (actions: readonly SeqAction[]) => {
    for (const action of actions) {
      if (action.type === 'toggle') {
        if (action.include) selected.add(action.col);
        else selected.delete(action.col);
      } else if (action.type === 'range') {
        for (let col = action.first; col <= action.last; col++) {
          if (action.include) selected.add(col);
          else selected.delete(col);
        }
      }
    }
  };

  const first = click(press);
  apply(first.actions);
  let drag: SeqDrag | null = first.drag;
  for (const col of columns) {
    if (!drag) break;
    const outcome = move(drag, press.row, col, mods);
    apply(outcome.actions);
    drag = outcome.drag;
  }
  return selected;
}

describe('SeekerClick — left button', () => {
  it('toggles an unselected cell IN (`:394-401`)', () => {
    const { actions, drag } = click(at({ selected: false }));
    expect(actions).toEqual([
      { type: 'toggle', row: 0, col: 10, include: true, startOver: false },
    ]);
    expect(drag?.setting).toBe(true);
    expect(drag?.startCol).toBe(10);
  });

  it('toggles a selected cell OUT, and the drag then deselects', () => {
    const { actions, drag } = click(at({ selected: true }));
    expect(actions).toEqual([
      { type: 'toggle', row: 0, col: 10, include: false, startOver: false },
    ]);
    expect(drag?.setting).toBe(false);
  });

  it('never uses start_over: `int start_over = false` at `:396` is never set', () => {
    const { actions } = click(at({}));
    expect(actions.every((action) => !('startOver' in action) || !action.startOver)).toBe(true);
  });

  it('ignores a spacer column entirely (`:393`)', () => {
    expect(click(at({ spacer: true }))).toEqual({ actions: [], drag: null });
  });

  it('does not select a non-selectable row but still honours ctrl (`:427`, `:419`)', () => {
    const { actions, drag } = click(at({ selectable: false, mods: { shift: false, ctrl: true } }));
    expect(actions).toEqual([{ type: 'centerSelection' }]);
    expect(drag).toBeNull();
  });

  it('ctrl+left also centres on the active selection (`:419-421`)', () => {
    const { actions } = click(at({ mods: { shift: false, ctrl: true } }));
    expect(actions).toEqual([
      { type: 'toggle', row: 0, col: 10, include: true, startOver: false },
      { type: 'centerSelection' },
    ]);
  });

  it('a column carrying a state sets that object state (`:463-466`)', () => {
    const { actions } = click(at({ state: 3 }));
    expect(actions).toContainEqual({ type: 'setState', row: 0, col: 10, state: 3 });
  });
});

describe('SeekerClick — outside any cell', () => {
  it('clears the active selection on a double click (`:328-341`)', () => {
    const { actions } = click(
      at({ row: -1, col: -1, sinceLastClickMs: DOUBLE_CLICK_MS - 1 }),
    );
    expect(actions).toEqual([{ type: 'clear' }]);
  });

  it('does nothing on a slow second click', () => {
    const { actions } = click(
      at({ row: -1, col: -1, sinceLastClickMs: DOUBLE_CLICK_MS + 1 }),
    );
    expect(actions).toEqual([]);
  });

  it('right outside opens pick_sele for the active selection (`layer1/Seq.cpp:240`)', () => {
    const { actions } = click(
      at({ row: -1, col: -1, button: Button.Right, hasActiveSele: true }),
    );
    expect(actions).toEqual([{ type: 'menu', menu: 'pick_sele', row: -1, col: -1 }]);
  });
});

describe('SeekerClick — right and middle', () => {
  it('right on a SELECTED cell opens pick_sele (`:363-364`)', () => {
    const { actions } = click(at({ button: Button.Right, selected: true, hasActiveSele: true }));
    expect(actions).toEqual([{ type: 'menu', menu: 'pick_sele', row: 0, col: 10 }]);
  });

  it('right on an UNSELECTED cell opens seq_option (`:365-393`)', () => {
    const { actions } = click(at({ button: Button.Right, selected: false, hasActiveSele: true }));
    expect(actions).toEqual([{ type: 'menu', menu: 'seq_option', row: 0, col: 10 }]);
  });

  it('middle browses that column (`:397-412`)', () => {
    const { actions, drag } = click(at({ button: Button.Middle }));
    expect(actions).toEqual([
      { type: 'browse', row: 0, first: 10, last: 10, zoom: false, startOver: true },
    ]);
    expect(drag?.button).toBe(Button.Middle);
  });

  it('ctrl+middle zooms instead of centring (`:405`)', () => {
    const { actions } = click(at({ button: Button.Middle, mods: { shift: false, ctrl: true } }));
    expect(actions[0]).toMatchObject({ type: 'browse', zoom: true });
  });
});

describe('SeekerDrag — left', () => {
  it('extends the range outwards', () => {
    expect([...replay(at({ col: 10 }), [11, 12, 13])].sort((a, b) => a - b)).toEqual([
      10, 11, 12, 13,
    ]);
  });

  it('retracts what it selected when dragged back (`:601-612`)', () => {
    expect([...replay(at({ col: 10 }), [13, 11])].sort((a, b) => a - b)).toEqual([10, 11]);
  });

  it('drops the ANCHOR TOO when dragged back onto it (`:541-549`)', () => {
    // Counter-intuitive but exactly what the C does: reaching `start_col` again
    // runs `SeekerSelectionToggle(start_col, !setting)` and clears
    // `start_toggle`, so the anchor flips off with the rest of the span.
    expect([...replay(at({ col: 10 }), [14, 10])]).toEqual([]);
  });

  it('cannot cross the anchor in one drag: the column is CLAMPED (`:541`)', () => {
    // `col = I->dragInfo.start_col` rewrites the local before every later
    // block, so once `dir` is set a jump past the anchor collapses TO the
    // anchor. Crossing sides is reachable only through the shift+click
    // continuation (`:356-365`), which swaps the ends and negates `dir`.
    expect([...replay(at({ col: 10 }), [13, 7])]).toEqual([]);
  });

  it('extends leftwards from the anchor', () => {
    expect([...replay(at({ col: 10 }), [9, 8, 7])].sort((a, b) => a - b)).toEqual([7, 8, 9, 10]);
  });

  it('a deselecting drag removes the whole span', () => {
    const selected = replay(at({ col: 10, selected: true }), [11, 12]);
    expect([...selected]).toEqual([]);
  });

  it('is a no-op when the pointer has not changed column', () => {
    const { drag } = click(at({ col: 10 }));
    const outcome = move(drag!, 0, 10, { shift: false, ctrl: false });
    expect(outcome.actions).toEqual([]);
  });

  it('is pinned to the row the press started on (`layer1/Seq.cpp:158`)', () => {
    const { drag } = click(at({ col: 10 }));
    expect(move(drag!, 1, 12, { shift: false, ctrl: false }).actions).toEqual([]);
  });

  it('ctrl during the drag re-centres at every step (`:619-621`)', () => {
    const { drag } = click(at({ col: 10, mods: { shift: false, ctrl: true } }));
    const outcome = move(drag!, 0, 12, { shift: false, ctrl: true });
    expect(outcome.actions.at(-1)).toEqual({ type: 'centerSelection' });
  });

  it('shift+left on the same row continues the existing range (`:349-355`)', () => {
    const first = click(at({ col: 10 }));
    const second = click(
      at({ col: 14, mods: { shift: true, ctrl: false }, drag: first.drag }),
    );
    // A continuation extends; it does NOT start a new single-cell toggle.
    expect(second.actions.some((action) => action.type === 'range')).toBe(true);
    expect(second.drag?.startCol).toBe(10);
  });
});

describe('SeekerDrag — middle', () => {
  it('restarts the centre selection at every column without shift (`:633-637`)', () => {
    const { drag } = click(at({ button: Button.Middle, col: 10 }));
    const outcome = move(drag!, 0, 12, { shift: false, ctrl: false });
    expect(outcome.actions).toEqual([
      { type: 'browse', row: 0, first: 12, last: 12, zoom: false, startOver: true },
    ]);
  });

  it('accumulates with shift held (`:638-664`)', () => {
    const { drag } = click(at({ button: Button.Middle, col: 10 }));
    const outcome = move(drag!, 0, 13, { shift: true, ctrl: false });
    expect(outcome.actions).toEqual([
      { type: 'browse', row: 0, first: 10, last: 13, zoom: false, startOver: false },
    ]);
  });
});

describe('wheel', () => {
  it('scrolls exactly one column per notch (`layer1/Seq.cpp:218-223`)', () => {
    expect(wheel(120)).toEqual({ type: 'scroll', delta: 1 });
    expect(wheel(-3)).toEqual({ type: 'scroll', delta: -1 });
  });
});
