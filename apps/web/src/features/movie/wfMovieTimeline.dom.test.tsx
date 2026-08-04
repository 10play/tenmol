/**
 * The wiring `wfMovieGrammar.test.ts` deliberately left out: real pointer and
 * wheel events on the real canvas, and the real gutter in the real DOM.
 *
 * `classifyGesture` being right and `panelGesture.mmove` being right does not
 * make the panel right — the component has to hand the ROW's object name to the
 * classifier and the classifier's `object` back to the command builder. Both of
 * those were wrong before wave 6 (the camera row's `''` was dropped by
 * `object ? { object } : {}`, which is the column form), so they are pinned
 * here as events in, `MovieAction`s out.
 *
 * Also pinned, because the payload carries them and only this component
 * consumes them:
 *
 *   `panel.rows[].label`   `camera` / the object name / `states`, RIGHT gutter
 *   `panel.labelIndent`    `CMovie::LabelIndent`, 64 px, 0 in presentation mode
 *   `panel.rowHeight`      `movie_panel_row_height` — the Ctrl+Shift wheel
 *                          writes this setting, so the DOM has to read it back
 *                          or the gesture is a no-op the user can see
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MoviePanel, MovieRow } from '@tenmol/protocol/topics/movie';

import { MovieTimeline } from './MovieTimeline';
import type { MovieAction } from './movieSource';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CANVAS_WIDTH = 600;

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

/** `frames` cells across `CANVAS_WIDTH` px — the x of 0-based frame `f`. */
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
  // jsdom has neither layout nor pointer capture; the component needs a width
  // to convert x into a frame and calls `setPointerCapture` on mousedown.
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => CANVAS_WIDTH,
  });
  HTMLCanvasElement.prototype.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: CANVAS_WIDTH,
      bottom: 40,
      width: CANVAS_WIDTH,
      height: 40,
    }) as DOMRect;
  (HTMLCanvasElement.prototype as unknown as { setPointerCapture: () => void }).setPointerCapture =
    () => {};
  // jsdom has no 2D context and logs a stack trace for every attempt; the
  // painting is covered by `timeline.test.ts` as pure functions, and `paint()`
  // already bails out on a null context.
  (HTMLCanvasElement.prototype as unknown as { getContext: () => null }).getContext = () => null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the label gutter is the C LabelIndent, on the right', () => {
  it('renders one label per row, from the payload, after the canvas', () => {
    render(makePanel());
    const labels = [...container.querySelectorAll('.mvtl__label')].map((n) => n.textContent);
    expect(labels).toEqual(['camera', 'm2']);

    // `tmpRect.right -= I->LabelIndent` — the gutter is to the RIGHT of the
    // strip, so in the DOM it must come after the canvas, not before it.
    const children = [...(container.querySelector('.mvtl')?.children ?? [])];
    expect(children.map((n) => n.className)).toEqual(['mvtl__strip', 'mvtl__labels']);

    const gutter = container.querySelector('.mvtl__labels') as HTMLElement;
    expect(gutter.style.width).toBe('64px');
  });

  it("says 'states' when the payload does, instead of inventing a camera track", () => {
    render(
      makePanel({ rows: [row('', 'states', [0, 0, 0])], nframes: 3, motions: 1, label: 'states' }),
    );
    expect([...container.querySelectorAll('.mvtl__label')].map((n) => n.textContent)).toEqual([
      'states',
    ]);
  });

  it('collapses to zero in presentation mode (`CMovie::reshape:1865`)', () => {
    render(makePanel({ presentation: true, rows: [row('', 'camera', [2, 1, 2, 1, 1, 2])] }));
    expect((container.querySelector('.mvtl__labels') as HTMLElement).style.width).toBe('0px');
  });
});

describe('row height is `movie_panel_row_height`, not a constant', () => {
  it('lays the strip out from the setting the Ctrl+Shift wheel writes', () => {
    render(makePanel({ rowHeight: 15 }));
    // 2 rows * (15 + 2 gap)
    expect(canvas().style.height).toBe('34px');
    expect((container.querySelector('.mvtl__label') as HTMLElement).style.height).toBe('15px');

    render(makePanel({ rowHeight: 40 }));
    expect(canvas().style.height).toBe('84px');
    expect((container.querySelector('.mvtl__label') as HTMLElement).style.height).toBe('40px');
  });

  it('clamps a zero row height, which the C setting reaches and the panel cannot', () => {
    render(makePanel({ rowHeight: 0 }));
    expect((container.querySelector('.mvtl__label') as HTMLElement).style.height).toBe('15px');
  });
});

describe('pointer events reach the engine as the C command strings', () => {
  it("a camera-row right-drag sends object='none', not the column default", () => {
    render(makePanel());
    pointer('pointerdown', { button: 2, clientX: xOf(2), clientY: 4 });
    pointer('pointermove', { button: 2, clientX: xOf(5), clientY: 4 });
    pointer('pointerup', { button: 2, clientX: xOf(5), clientY: 4 });

    expect(actions).toHaveLength(1);
    expect(actions[0]?.fn).toBe('cmd.mmove');
    expect(actions[0]?.kwargs).toEqual({ object: 'none' });
    expect(actions[0]?.echo).toBe("cmd.mmove(6,3,1,object='none')");
  });

  it('the same drag on the object row sends that row name', () => {
    render(makePanel());
    // Row 1 starts at y = rowHeight + gap = 17.
    pointer('pointerdown', { button: 2, clientX: xOf(2), clientY: 20 });
    pointer('pointermove', { button: 2, clientX: xOf(5), clientY: 20 });
    pointer('pointerup', { button: 2, clientX: xOf(5), clientY: 20 });

    expect(actions[0]?.kwargs).toEqual({ object: 'm2' });
    expect(actions[0]?.echo).toBe("cmd.mmove(6,3,1,object='m2')");
  });

  it("Ctrl+Shift makes it the column form, object=''", () => {
    render(makePanel());
    const mods = { ctrlKey: true, shiftKey: true };
    pointer('pointerdown', { button: 2, clientX: xOf(2), clientY: 20, ...mods });
    pointer('pointermove', { button: 2, clientX: xOf(5), clientY: 20, ...mods });
    pointer('pointerup', { button: 2, clientX: xOf(5), clientY: 20, ...mods });

    // `mod == cOrthoSHIFT` is an equality test, so Ctrl+Shift is a MOVE.
    expect(actions[0]?.fn).toBe('cmd.mmove');
    expect(actions[0]?.kwargs).toEqual({ object: '' });
  });

  it('a right-click that does not travel opens the motion menu for that row', () => {
    render(makePanel());
    pointer('pointerdown', { button: 2, clientX: xOf(2), clientY: 20 });
    pointer('pointerup', { button: 2, clientX: xOf(2), clientY: 20 });
    expect(actions).toEqual([]);
    expect(menus).toEqual([{ frame: 3, object: 'm2' }]);
  });

  it('ctrl+middle clears with the row argument, and mview clear uses `same` in a column', () => {
    render(makePanel());
    pointer('pointerdown', { button: 1, clientX: xOf(1), clientY: 4, ctrlKey: true });
    pointer('pointermove', { button: 1, clientX: xOf(4), clientY: 4, ctrlKey: true });
    pointer('pointerup', { button: 1, clientX: xOf(4), clientY: 4, ctrlKey: true });
    expect(actions[0]?.fn).toBe('cmd.mview');
    expect(actions[0]?.kwargs).toEqual({ first: 2, last: 5, object: 'none' });

    actions.length = 0;
    const mods = { ctrlKey: true, shiftKey: true };
    pointer('pointerdown', { button: 1, clientX: xOf(1), clientY: 4, ...mods });
    pointer('pointermove', { button: 1, clientX: xOf(4), clientY: 4, ...mods });
    pointer('pointerup', { button: 1, clientX: xOf(4), clientY: 4, ...mods });
    // `cMovieDragModeOblate` overrides the column argument to `same` (`:1665`).
    expect(actions[0]?.kwargs).toEqual({ first: 2, last: 5, object: 'same' });
  });

  it('the Ctrl+Shift wheel writes the setting; a plain wheel steps the frame', () => {
    render(makePanel({ rowHeight: 15 }));
    act(() => {
      canvas().dispatchEvent(
        new WheelEvent('wheel', { bubbles: true, deltaY: -1, ctrlKey: true, shiftKey: true }),
      );
    });
    expect(actions[0]?.fn).toBe('cmd.set');
    expect(actions[0]?.args).toEqual(['movie_panel_row_height', 16]);

    actions.length = 0;
    act(() => {
      canvas().dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 1 }));
    });
    expect(actions[0]?.fn).toBe('cmd.forward');
  });
});
