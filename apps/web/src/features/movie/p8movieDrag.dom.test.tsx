/**
 * Wave 8 — the pointer gestures the panel could describe but had never felt.
 *
 * `wfMovieTimeline.dom.test.tsx` drove a right-drag (`mmove`) and a
 * Ctrl+Middle drag (`mview clear`) through real events. Two of the four
 * `_cmd.mmodify` verbs had still never been produced by a pointer at all —
 * Shift+Right (`mcopy`) and Ctrl+Left (`minsert`/`mdelete`) — and the drag
 * ABANDON, `CMovie::DragDraw`, was not implemented anywhere:
 *
 *   `CMovie::drag:1580`   DragDraw = y within 50 px of the block
 *   `CMovie::drag:1588`   DragMenu dies on |dx| > 3 OR |dy| > 5
 *   `CMovie::release`     every emitting branch except the MENU is wrapped in
 *                         `if(I->DragDraw ...)`
 *
 * so pulling the pointer off the panel and letting go has to do NOTHING, and
 * the ghost boxes have to disappear while it is out there. Both are asserted
 * here as events in, `MovieAction`s out.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MoviePanel, MovieRow } from '@tenmol/protocol/topics/movie';

import { MovieTimeline } from './MovieTimeline';
import { classifyGesture, dragInRange, DRAG_ABANDON_PX } from './timeline';
import type { MovieAction } from './movieSource';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CANVAS_WIDTH = 600;
/** The stubbed layout: two 15 px rows with a 2 px gap, in a 40 px box. */
const BLOCK_BOTTOM = 40;

const row = (object: string, label: string, spec: number[]): MovieRow =>
  ({ object, label, spec, scenes: spec.map(() => null) }) as unknown as MovieRow;

function makePanel(over: Partial<MoviePanel> = {}): MoviePanel {
  return {
    nframes: 6,
    cells: [],
    rows: [row('', 'camera', [2, 1, 2, 1, 1, 2]), row('m2', 'm2', [2, 1, 2, 1, 1, 2])],
    visible: false,
    rowHeight: 15,
    height: 30,
    matrix: false,
    motions: 2,
    presentation: false,
    label: 'camera',
    labelIndent: 64,
    panelActive: false,
    panelHeight: 0,
    ...over,
  } as MoviePanel;
}

let container: HTMLDivElement;
let root: Root;
let actions: MovieAction[];
let menus: { frame: number; object: string }[];

const xOf = (frame: number, frames = 6) => (CANVAS_WIDTH * frame) / frames + 1;

function canvas(): HTMLCanvasElement {
  const element = container.querySelector('canvas');
  if (!element) throw new Error('no canvas');
  return element as HTMLCanvasElement;
}

function pointer(type: string, init: MouseEventInit): void {
  act(() => {
    canvas().dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
  });
}

/** press -> move -> release, the three events the component listens for. */
function drag(
  init: MouseEventInit,
  path: { x: number; y: number }[],
): void {
  const [first, ...rest] = path;
  if (!first) throw new Error('empty drag');
  pointer('pointerdown', { ...init, clientX: first.x, clientY: first.y });
  for (const point of rest) {
    pointer('pointermove', { ...init, clientX: point.x, clientY: point.y });
  }
  const last = path[path.length - 1] ?? first;
  pointer('pointerup', { ...init, clientX: last.x, clientY: last.y });
}

function render(panel: MoviePanel | null): void {
  act(() => {
    root.render(
      <MovieTimeline
        panel={panel}
        frame={1}
        run={async (action) => {
          actions.push(action);
        }}
        onSelectFrame={() => {}}
        onContextMenu={(frame, object) => menus.push({ frame, object })}
      />,
    );
  });
}

beforeEach(() => {
  actions = [];
  menus = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => CANVAS_WIDTH,
  });
  HTMLCanvasElement.prototype.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: CANVAS_WIDTH,
      bottom: BLOCK_BOTTOM,
      width: CANVAS_WIDTH,
      height: BLOCK_BOTTOM,
    }) as DOMRect;
  (HTMLCanvasElement.prototype as unknown as { setPointerCapture: () => void }).setPointerCapture =
    () => {};
  (HTMLCanvasElement.prototype as unknown as { getContext: () => null }).getContext = () => null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the two mmodify verbs no pointer had ever produced', () => {
  it('Shift+Right-drag emits cmd.mcopy with the row argument', () => {
    render(makePanel());
    drag({ button: 2, shiftKey: true }, [
      { x: xOf(1), y: 4 },
      { x: xOf(4), y: 4 },
    ]);

    expect(actions).toHaveLength(1);
    expect(actions[0]?.fn).toBe('cmd.mcopy');
    // `cmd.mcopy(target, source, count)`, 1-based, camera row.
    expect(actions[0]?.args).toEqual([5, 2, 1]);
    expect(actions[0]?.kwargs).toEqual({ object: 'none' });
    expect(actions[0]?.echo).toBe("cmd.mcopy(5,2,1,object='none')");
    expect(actions[0]?.invalidatesPanel).toBe(true);
  });

  it('Ctrl+Left forward is minsert and backward is mdelete', () => {
    render(makePanel());
    // Row 1 is the object row: y = rowHeight + gap = 17.
    drag({ button: 0, ctrlKey: true }, [
      { x: xOf(1), y: 20 },
      { x: xOf(4), y: 20 },
    ]);
    expect(actions[0]?.fn).toBe('cmd.minsert');
    expect(actions[0]?.args).toEqual([3, 2]);
    expect(actions[0]?.kwargs).toEqual({ object: 'm2' });
    expect(actions[0]?.echo).toBe("cmd.minsert(3,2,object='m2')");

    actions.length = 0;
    drag({ button: 0, ctrlKey: true }, [
      { x: xOf(4), y: 4 },
      { x: xOf(1), y: 4 },
    ]);
    expect(actions[0]?.fn).toBe('cmd.mdelete');
    expect(actions[0]?.args).toEqual([3, 2]);
    expect(actions[0]?.kwargs).toEqual({ object: 'none' });
  });

  it('a Ctrl+Left drag that never leaves its cell sends nothing', () => {
    // The C emits `cmd.mdelete(0, n)`, which is a no-op line in the log.
    render(makePanel());
    drag({ button: 0, ctrlKey: true }, [
      { x: xOf(2), y: 4 },
      { x: xOf(2) + 2, y: 4 },
    ]);
    expect(actions).toEqual([]);
  });
});

describe('the +/- 50 px drag abandon — CMovie::DragDraw', () => {
  it('is 50 px of slack on each side of the block', () => {
    expect(DRAG_ABANDON_PX).toBe(50);
    const block = { top: 0, bottom: 40 };
    expect(dragInRange(20, block)).toBe(true);
    expect(dragInRange(89, block)).toBe(true);
    expect(dragInRange(90, block)).toBe(false);
    expect(dragInRange(-49, block)).toBe(true);
    expect(dragInRange(-50, block)).toBe(false);
  });

  it('drops an mmove released more than 50 px below the panel', () => {
    render(makePanel());
    drag({ button: 2 }, [
      { x: xOf(2), y: 4 },
      { x: xOf(5), y: BLOCK_BOTTOM + 60 },
    ]);
    expect(actions).toEqual([]);
    expect(menus).toEqual([]);
  });

  it('drops an mcopy, a minsert and an mview clear the same way', () => {
    render(makePanel());
    const away = BLOCK_BOTTOM + 60;
    drag({ button: 2, shiftKey: true }, [
      { x: xOf(1), y: 4 },
      { x: xOf(4), y: away },
    ]);
    drag({ button: 0, ctrlKey: true }, [
      { x: xOf(1), y: 4 },
      { x: xOf(4), y: away },
    ]);
    drag({ button: 1, ctrlKey: true }, [
      { x: xOf(1), y: 4 },
      { x: xOf(4), y: away },
    ]);
    expect(actions).toEqual([]);
  });

  it('comes back to life when the pointer returns to the panel', () => {
    render(makePanel());
    drag({ button: 2 }, [
      { x: xOf(2), y: 4 },
      { x: xOf(5), y: BLOCK_BOTTOM + 60 },
      { x: xOf(5), y: 8 },
    ]);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.fn).toBe('cmd.mmove');
    expect(actions[0]?.echo).toBe("cmd.mmove(6,3,1,object='none')");
  });

  it('never gates the plain left-drag scrollbar, which is not a DragMode', () => {
    render(makePanel());
    drag({ button: 0 }, [
      { x: xOf(1), y: 4 },
      { x: xOf(4), y: BLOCK_BOTTOM + 60 },
    ]);
    // One `set_frame` per move plus the release, all of them seeks.
    expect(actions.every((action) => action.fn === 'cmd.set_frame')).toBe(true);
    expect(actions.length).toBeGreaterThan(0);
  });
});

describe('the context menu dies on 5 px of VERTICAL travel', () => {
  it('opens when the press barely moves', () => {
    render(makePanel());
    drag({ button: 2 }, [
      { x: xOf(2), y: 4 },
      { x: xOf(2) + 2, y: 8 },
    ]);
    expect(menus).toEqual([{ frame: 3, object: '' }]);
  });

  it('does not open once |dy| passes 5, even back on the same cell', () => {
    render(makePanel());
    drag({ button: 2 }, [
      { x: xOf(2), y: 4 },
      { x: xOf(2) + 2, y: 14 },
      { x: xOf(2) + 2, y: 4 },
    ]);
    expect(menus).toEqual([]);
    expect(actions).toEqual([]);
  });

  it('still opens after a 200 px excursion that ends on its own cell', () => {
    // `:1621` tests DragCurFrame == DragStartFrame && DragMenu, NOT DragDraw —
    // but DragMenu is already dead by then, so this is the pure-function case.
    expect(
      classifyGesture({
        button: 2,
        shift: false,
        ctrl: false,
        from: 2,
        to: 2,
        travel: 0,
        travelY: 0,
        inRange: false,
        frames: 6,
      }),
    ).toEqual({ kind: 'menu', frame: 2, object: '', column: false });
  });
});
