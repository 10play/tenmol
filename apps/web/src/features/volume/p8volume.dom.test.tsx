/**
 * Wave 8 — the four volume rows whose gap clause was "not exercised".
 *
 * `rangeZoom.dom.test.tsx` drives the ctrl+R-drag with a recorder that captures
 * `fillRect` and `fillText`, which is everything a BAND is. The four rows here
 * need more than that:
 *
 *   * *"the red histogram polyline draws 0 px because no histogram can be
 *     fetched"* — it can. `bridge/tests/test_p8_a10.py` proves
 *     `cmd.get_volume_histogram` answers 68 inline floats over a real socket
 *     AND re-creates the old `BLOB_RETURNS` defect with a monkeypatch to show
 *     the assertion is not vacuous. This file takes those same bytes — read
 *     from the same `__fixtures__/engine-volume.json` that the bridge test
 *     compares the live engine against, bar for bar — and follows them through
 *     the REAL `service.ts`, the real `normalizeHistogram` and the real
 *     `paint()` to stroked pixels.
 *   * *"NOT exercised end to end because the histogram cannot cross the wire"* —
 *     same chain, with the peak-clipping branch measured on the way past.
 *   * *"the right-drag single-axis LATCH ... was not exercised in the browser"*
 *   * *"the vmax/amax boxes and the wheel-over-box were not clicked"*
 *   * *"the ctrl (triple) picker path and the live onChange preview push were
 *     not exercised in the browser"*
 *
 * NOTHING IS MOCKED BELOW `useSession`. `./service` is the real module, so the
 * tier selection, the `_guiupdate: 0` kwarg and the getter/setter overload of
 * `cmd.volume_color` are all under test; the double is the socket itself, and
 * it answers with the engine's own recorded payloads.
 *
 * jsdom facts, all of them measured here and all of them worked around the way
 * `rangeZoom.dom.test.tsx` documents: no `PointerEvent`, no
 * `setPointerCapture`, no `ResizeObserver`, no layout, and
 * `getContext('2d') === null`. The recording context below is a superset of
 * that file's — it records the PATH as well, because a polyline that is never
 * filled is invisible to a `fillRect` recorder.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from './__fixtures__/engine-volume.json';
import { VolumePanel } from './VolumePanel';
import { DOT_RADIUS } from './ramp';
import { resetVolumeBridge } from './menuBridge';
import type { Session } from '../../app';
import type { DialogWindowSpec } from '../dialogs/store';

/* ------------------------------------------------------------ the socket */

interface Recorded {
  fn: string;
  args: readonly unknown[];
  kwargs?: unknown;
}

const calls: Recorded[] = [];
/** Swappable so one test can make tier 1 fail without re-mocking the module. */
let histogramReply: unknown = fixture.histogram;
/** `menu.vol_color(None, 'p8vol')`, verbatim from the socket. */
const ENGINE_PRESET_ROWS: unknown = [
  [2, 'Coloring:', ''],
  [1, 'panel', "cmd.volume_panel('p8vol')"],
  [0, '', ''],
  [1, '2fofc', 'cmd.volume_color(\'p8vol\', "2fofc")'],
  [1, 'esp', 'cmd.volume_color(\'p8vol\', "esp")'],
  [1, 'fofc', 'cmd.volume_color(\'p8vol\', "fofc")'],
  [1, 'rainbow', 'cmd.volume_color(\'p8vol\', "rainbow")'],
  [1, 'rainbow2', 'cmd.volume_color(\'p8vol\', "rainbow2")'],
];
let presetRows: unknown = ENGINE_PRESET_ROWS;

const SESSION = {
  config: { httpOrigin: 'http://127.0.0.1:0' },
  call: async (fn: string, args: readonly unknown[] = [], kwargs?: unknown) => {
    calls.push({ fn, args, kwargs });
    if (fn === 'volume_color') {
      // The overload PyMOL really has: one argument is the getter, two is the
      // setter and returns an int status (`colorramping.py:120` / `:156`).
      return args.length === 1 ? fixture.ramp : 0;
    }
    if (fn === 'get_volume_histogram') {
      if (histogramReply instanceof Error) throw histogramReply;
      return histogramReply;
    }
    if (fn === 'get_volume_field') throw new Error('no blob store in this test');
    // `menu.vol_color(None, name)` -- the live named-ramp list, in the exact
    // shape the engine answers with (measured in bridge/tests/test_p8_a10.py).
    if (fn === 'menu.vol_color') {
      if (presetRows instanceof Error) throw presetRows;
      return presetRows;
    }
    throw new Error(`unexpected bridge call ${fn}`);
  },
};

vi.mock('../../app', () => ({ useSession: () => SESSION }));

/** Every `cmd.volume_color(name, flat)` — i.e. every push to the engine. */
const pushes = () => calls.filter((c) => c.fn === 'volume_color' && c.args.length === 2);

/**
 * The `volume_ramp_changed` plumbing (`menuBridge.ts`), which this file's
 * socket double deliberately does NOT answer.
 *
 * Keeping it out of the read-path assertions is the point: the row these tests
 * cover is about which histogram tier runs, and it must stay green on a bridge
 * with no `cmd.tenmol_volume` module at all. `p10volumeEvents.dom.test.tsx`
 * asserts the plumbing itself, including the degraded state this file produces.
 */
const BRIDGE_PLUMBING = new Set([
  'cmd.tenmol_volume.status',
  'cmd.tenmol_volume.watch',
  'cmd.tenmol_volume.unwatch',
  'cmd.tenmol_volume.ramps',
  'cmd.do',
]);
const readPath = () => calls.map((c) => c.fn).filter((fn) => !BRIDGE_PLUMBING.has(fn));

/* -------------------------------------------------------- the 2D recorder */

type Op =
  | { op: 'moveTo' | 'lineTo'; x: number; y: number }
  | { op: 'arc'; x: number; y: number; r: number }
  | { op: 'beginPath' }
  | { op: 'stroke'; style: string; dash: readonly number[] }
  | { op: 'fill'; style: string }
  | { op: 'fillRect'; x: number; y: number; w: number; h: number; style: string }
  | { op: 'fillText'; text: string; x: number; y: number };

interface Stroked {
  style: string;
  dash: readonly number[];
  points: [number, number][];
}

interface Circle {
  x: number;
  y: number;
  r: number;
  fill: string;
}

function recorder() {
  const ops: Op[] = [];
  const noop = () => {};
  let dash: readonly number[] = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textBaseline: 'alphabetic',
    canvas: { width: 0, height: 0 },
    clearRect: noop,
    save: noop,
    restore: noop,
    closePath: noop,
    rect: noop,
    clip: noop,
    setTransform: noop,
    strokeRect: noop,
    beginPath() {
      ops.push({ op: 'beginPath' });
    },
    moveTo(x: number, y: number) {
      ops.push({ op: 'moveTo', x, y });
    },
    lineTo(x: number, y: number) {
      ops.push({ op: 'lineTo', x, y });
    },
    arc(x: number, y: number, r: number) {
      ops.push({ op: 'arc', x, y, r });
    },
    setLineDash(next: readonly number[]) {
      dash = next;
    },
    stroke(this: { strokeStyle: string }) {
      ops.push({ op: 'stroke', style: this.strokeStyle, dash });
    },
    fill(this: { fillStyle: string }) {
      ops.push({ op: 'fill', style: this.fillStyle });
    },
    fillRect(this: { fillStyle: string }, x: number, y: number, w: number, h: number) {
      ops.push({ op: 'fillRect', x, y, w, h, style: this.fillStyle });
    },
    fillText(text: string, x: number, y: number) {
      ops.push({ op: 'fillText', text, x, y });
    },
    // The same QFontMetrics stand-ins rangeZoom.test.ts uses: 7 px average
    // width, 8 + 3 px height. Keeping them identical keeps the two files'
    // geometry comparable.
    measureText: (text: string) => ({
      width: text.length * 7,
      fontBoundingBoxAscent: 8,
      fontBoundingBoxDescent: 3,
    }),
  };

  /** `beginPath ... stroke` groups, in paint order. */
  const strokes = (): Stroked[] => {
    const out: Stroked[] = [];
    let points: [number, number][] = [];
    for (const op of ops) {
      if (op.op === 'beginPath') points = [];
      else if (op.op === 'moveTo' || op.op === 'lineTo') points.push([op.x, op.y]);
      else if (op.op === 'stroke') out.push({ style: op.style, dash: op.dash, points });
    }
    return out;
  };

  /** `beginPath; arc; fill` groups — `circle()` in `paint.ts`. */
  const circles = (): Circle[] => {
    const out: Circle[] = [];
    let last: { x: number; y: number; r: number } | null = null;
    for (const op of ops) {
      if (op.op === 'arc') last = op;
      else if (op.op === 'fill' && last) {
        out.push({ x: last.x, y: last.y, r: last.r, fill: op.style });
        last = null;
      }
    }
    return out;
  };

  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    ops,
    strokes,
    circles,
    texts: () => ops.flatMap((o) => (o.op === 'fillText' ? [o.text] : [])),
    /** The three painted value boxes, in paint order: vmin, vmax, amax. */
    boxes: () =>
      ops.flatMap((o) => (o.op === 'fillRect' && o.style === '#ffffff' ? [o] : [])) as Extract<
        Op,
        { op: 'fillRect' }
      >[],
  };
}

/* ---------------------------------------------------------------- harness */

const WIDTH = 600;
const HEIGHT = 200;

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let frame = recorder();

const REAL_RECT = HTMLElement.prototype.getBoundingClientRect;
const REAL_CONTEXT = HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  calls.length = 0;
  // `ensureVolumeBridge` remembers, per session, that a bridge refused the
  // install and stops asking after three tries. `SESSION` is a module
  // singleton shared by every test in this file, so without this reset the
  // fourth mount would issue no plumbing calls and the counts below would
  // depend on test order.
  resetVolumeBridge(SESSION as unknown as Session);
  histogramReply = fixture.histogram;
  presetRows = ENGINE_PRESET_ROWS;
  frame = recorder();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: WIDTH,
      bottom: HEIGHT,
      width: WIDTH,
      height: HEIGHT,
      toJSON: () => ({}),
    }) as DOMRect;
  HTMLCanvasElement.prototype.getContext = (() => {
    frame = recorder();
    return frame.ctx;
  }) as unknown as HTMLCanvasElement['getContext'];
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  HTMLElement.prototype.getBoundingClientRect = REAL_RECT;
  HTMLCanvasElement.prototype.getContext = REAL_CONTEXT;
});

const SPEC: DialogWindowSpec = {
  key: 'volume:p8vol',
  kind: 'volume',
  arg: 'p8vol',
  title: 'p8vol - Volume Color Map Editor',
  x: 0,
  y: 0,
  width: 640,
  height: 260,
  z: 1,
  minimised: false,
};

async function mountPanel() {
  await act(async () => {
    root.render(<VolumePanel spec={SPEC} />);
  });
  // getRamp -> fetchHistogram -> setState is three microtask hops.
  for (let i = 0; i < 4; i++) await act(async () => {});
}

function canvas(): HTMLCanvasElement {
  const found = document.querySelector('canvas[data-volcanvas]');
  if (!found) throw new Error('no volume canvas mounted');
  return found as HTMLCanvasElement;
}

interface Pointer {
  x: number;
  y: number;
  button?: number;
  buttons?: number;
  ctrl?: boolean;
  shift?: boolean;
}

function fire(type: 'pointerdown' | 'pointermove' | 'pointerup', p: Pointer) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: p.x,
    clientY: p.y,
    button: p.button ?? 0,
    buttons: p.buttons ?? 0,
    ctrlKey: p.ctrl ?? false,
    shiftKey: p.shift ?? false,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => {
    canvas().dispatchEvent(event);
  });
}

/** The non-passive `wheel` listener `VolumeCanvas` installs by hand. */
function wheel(x: number, y: number, deltaY: number) {
  const event = new MouseEvent('wheel', {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(event, 'deltaY', { value: deltaY });
  act(() => {
    canvas().dispatchEvent(event);
  });
  return event;
}

/** The tooltip div `<VolumeCanvas>` renders while a point is being dragged. */
const tooltip = () => document.querySelector('.volcanvas__tip')?.textContent ?? null;

/**
 * Type into a CONTROLLED input.
 *
 * Measured here, and it cost four failing tests before it was found: React
 * installs its own `value` setter on the element instance and remembers the
 * last value it saw, so `input.value = '3'` followed by a synthetic `input`
 * event is swallowed as a no-op change and `onChange` never fires. Calling the
 * PROTOTYPE setter updates the DOM without touching React's shadow copy, which
 * is what `react-dom/test-utils`' own `Simulate.change` does internally.
 */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/* ============================================================ rows 433/434 */

describe('the engine histogram reaches the canvas as a red polyline', () => {
  it('takes tier 1 and says so: 68 inline floats, no blob, no fallback', async () => {
    await mountPanel();

    // service.ts's tier 1 is `cmd.get_volume_histogram(name)` and nothing else.
    expect(readPath()).toEqual(['volume_color', 'menu.vol_color', 'get_volume_histogram']);
    expect(calls.find((c) => c.fn === 'get_volume_histogram')!.args).toEqual(['p8vol']);

    // ...and the volume-module calls are exactly these three: the subscription
    // probes once, bootstraps once and gives up, and the preset list falls off
    // tier 1 onto `menu.vol_color`. This double answers no `cmd.tenmol_volume`
    // call at all, so a panel that cannot subscribe says so rather than
    // pretending to track.
    expect(calls.map((c) => c.fn).filter((fn) => BRIDGE_PLUMBING.has(fn))).toEqual([
      'cmd.tenmol_volume.status',
      'cmd.do',
      'cmd.tenmol_volume.ramps',
    ]);
    expect(document.querySelector('[data-volume-watch]')?.getAttribute('data-volume-watch')).toBe(
      'off',
    );
    expect(document.querySelector('.volpanel__status')?.textContent).toBe(
      'histogram via get_volume_histogram',
    );
    expect(document.querySelector('.volpanel__error')).toBeNull();
  });

  it('strokes 557 red points, the first of them off the top of the plot', async () => {
    await mountPanel();

    const red = frame.strokes().filter((s) => s.style === 'red');
    expect(red).toHaveLength(1);
    const line = red[0]!.points;
    // 565 px of plot; `ipos >= path.length - 1` drops the last 8 columns, so
    // the curve stops at x = 591 and not at 599 (`paint.ts:220`).
    expect(line).toHaveLength(557);
    expect(line[0]![0]).toBe(35);
    expect(line[line.length - 1]![0]).toBe(591);

    // PEAK CLIPPING, and this is what it actually looks like. The first bar is
    // 2337 counts; q90 is 22, so `maxValue = min(q90*4, max) = 88` and the bar
    // normalises to 26.5568 — twenty-six times the top of the axis. The curve
    // is drawn at y = -244.68 and the `ctx.clip()` around `paintHistogram`
    // (`paint.ts:82-88`) is the only thing keeping it inside the widget.
    expect(line[0]![1]).toBeCloseTo(-244.68126118506888, 9);
    expect(Math.min(...line.map((p) => p[1]))).toBeCloseTo(-244.68126118506888, 9);
    expect(Math.max(...line.map((p) => p[1]))).toBe(179);
  });

  it('draws nothing red when the histogram is empty — the state the row described', async () => {
    // The row said "0 px". This is what 0 px looks like, so the assertion
    // above cannot pass by accident: tier 1 throws, tier 2 has no blob store,
    // tier 3 gives a range and NO bars.
    histogramReply = new Error(
      'NotSerializable: get_volume_histogram returned list, expected a numpy array',
    );
    await mountPanel();

    expect(frame.strokes().filter((s) => s.style === 'red')).toEqual([]);
    const status = document.querySelector('.volpanel__status')?.textContent ?? '';
    expect(status).toContain('histogram via ramp');
    expect(status).toContain('expected a numpy array');
    // ...and the panel is still usable: the axes span the ramp with a 10 % margin
    expect(frame.texts()).toContain('0.960'); // 1.0 - 0.4*0.1
  });
});

describe('the rest of the paint pass (volume.py:97-266)', () => {
  it('lays down grid, axes, ticks, boxes, histogram and dots in that order', async () => {
    await mountPanel();
    const strokes = frame.strokes();

    // paintGrid: two SOLID axis lines, then nine DASHED alpha gridlines.
    const solidFirst = strokes.slice(0, 2);
    expect(solidFirst.every((s) => s.dash.length === 0)).toBe(true);
    const dashed = strokes.filter((s) => s.dash.length === 2 && s.dash[0] === 3);
    expect(dashed).toHaveLength(9);
    // alpha k/10 through alphaToY, top-down: 0.9 is nearest the top.
    expect(dashed.map((s) => Math.round(s.points[0]![1] - 0.5))).toEqual([
      130, 100, 78, 61, 47, 35, 25, 16, 7,
    ]);

    // paintAxes: integer x ticks with collision avoidance, 0.1..0.9 y ticks
    // with theirs. 0.8 and 0.9 fail `y > 2*fh` and are dropped.
    const texts = frame.texts();
    expect(texts.slice(0, 5)).toEqual(['0', '1', '2', '3', '4']);
    expect(texts.slice(5, 12)).toEqual(['0.1', '0.2', '0.3', '0.4', '0.5', '0.6', '0.7']);
    expect(texts.slice(12)).toEqual(['-0.309', '4.999', '1.00']);

    // the red histogram is stroked AFTER the axes and BEFORE the dots
    const redAt = strokes.findIndex((s) => s.style === 'red');
    const grayAt = strokes.findIndex((s) => s.style === 'gray');
    expect(redAt).toBeGreaterThan(2);
    expect(grayAt).toBeGreaterThan(redAt);
  });

  it('draws one filled dot per ramp stop, in the stop colour', async () => {
    await mountPanel();
    const dots = frame.circles();
    // the captured 2fofc ramp has three stops, two of them at value 1.0
    expect(dots).toHaveLength(3);
    expect(dots.map((d) => [d.x - 0.5, d.y - 0.5])).toEqual([
      [174, 180],
      [174, 100],
      [217, 180],
    ]);
    expect(dots.map((d) => d.fill)).toEqual(['rgb(0, 0, 255)', 'rgb(0, 0, 255)', 'rgb(0, 0, 255)']);
    expect(dots.every((d) => d.r === DOT_RADIUS)).toBe(true);
  });

  it('redraws the hovered dot at DOT_RADIUS + 2', async () => {
    await mountPanel();
    expect(frame.circles()).toHaveLength(3);

    // a move with NO button down is the hover branch (`VolumeCanvas.tsx:306`)
    fire('pointermove', { x: 174, y: 100, buttons: 0 });
    const hovered = frame.circles();
    expect(hovered).toHaveLength(4);
    expect(hovered[3]).toEqual({ x: 174.5, y: 100.5, r: DOT_RADIUS + 2, fill: 'rgb(0, 0, 255)' });

    // and moving off it puts the count back
    fire('pointermove', { x: 400, y: 40, buttons: 0 });
    expect(frame.circles()).toHaveLength(3);
  });
});

/* ================================================================= row 439 */

describe('right-drag latches ONE axis from the first movement', () => {
  /**
   * `if self.constraint is None: self.constraint = 'x' if abs(dx) > abs(dy)
   * else 'y'` (`volume.py:578-584`). The decision is made once, on the first
   * move of the drag, and every later move obeys it however far the other axis
   * has since travelled — which is the half that a unit test of `movePoints`
   * cannot reach, because `movePoints` is TOLD the constraint.
   */
  it('latches x when the first move is mostly horizontal, and freezes alpha', async () => {
    await mountPanel();
    // the middle stop: value 1.0, alpha 0.2, painted at (174, 100)
    fire('pointerdown', { x: 174, y: 100, button: 2, buttons: 2 });
    fire('pointermove', { x: 190, y: 104, button: -1, buttons: 2 });

    expect(tooltip()).toBe('value: 1.147\nalpha: 0.200');

    // a big vertical move AFTER the latch must still not move alpha
    fire('pointermove', { x: 200, y: 20, button: -1, buttons: 2 });
    expect(tooltip()).toBe('value: 1.241\nalpha: 0.200');
    fire('pointerup', { x: 200, y: 20, button: 2, buttons: 0 });
  });

  it('latches y when the first move is mostly vertical, and freezes the value', async () => {
    await mountPanel();
    fire('pointerdown', { x: 174, y: 100, button: 2, buttons: 2 });
    fire('pointermove', { x: 178, y: 60, button: -1, buttons: 2 });

    expect(tooltip()).toBe('value: 1.000\nalpha: 0.405');

    // a big horizontal move AFTER the latch must still not move the value
    fire('pointermove', { x: 400, y: 60, button: -1, buttons: 2 });
    expect(tooltip()).toBe('value: 1.000\nalpha: 0.405');
    fire('pointerup', { x: 400, y: 60, button: 2, buttons: 0 });
  });

  it('a LEFT-drag has no latch: both axes move on the same gesture', async () => {
    await mountPanel();
    fire('pointerdown', { x: 174, y: 100, button: 0, buttons: 1 });
    fire('pointermove', { x: 190, y: 60, button: -1, buttons: 1 });
    expect(tooltip()).toBe('value: 1.147\nalpha: 0.405');
    fire('pointerup', { x: 190, y: 60, button: 0, buttons: 0 });
  });

  it('the latch is dropped with the drag, not carried into the next one', async () => {
    await mountPanel();
    fire('pointerdown', { x: 174, y: 100, button: 2, buttons: 2 });
    fire('pointermove', { x: 190, y: 104, button: -1, buttons: 2 });
    expect(tooltip()).toBe('value: 1.147\nalpha: 0.200');
    fire('pointerup', { x: 190, y: 104, button: 2, buttons: 0 });

    // the stop is now at 1.147; a fresh vertical right-drag on it must latch y
    fire('pointerdown', { x: 190, y: 100, button: 2, buttons: 2 });
    fire('pointermove', { x: 194, y: 60, button: -1, buttons: 2 });
    expect(tooltip()).toBe('value: 1.147\nalpha: 0.405');
    fire('pointerup', { x: 194, y: 60, button: 2, buttons: 0 });
  });
});

/* ================================================================= row 441 */

describe('the vmax and amax value boxes', () => {
  /** Click the centre of the i-th painted white box: 0 vmin, 1 vmax, 2 amax. */
  function clickBox(index: number) {
    const box = frame.boxes()[index]!;
    fire('pointerdown', {
      x: Math.round(box.x + box.w / 2),
      y: Math.round(box.y + box.h / 2),
      button: 0,
      buttons: 1,
    });
    return box;
  }

  it('paints three boxes and the middle one is vmax, right-justified', async () => {
    await mountPanel();
    const boxes = frame.boxes();
    expect(boxes).toHaveLength(3);
    // vmin at the left edge of the plot, vmax ending at its right edge, amax
    // left of the y axis and level with the top.
    expect([boxes[0]!.x, boxes[0]!.y]).toEqual([35, 181]);
    expect([boxes[1]!.x, boxes[1]!.y]).toEqual([560, 181]);
    expect([boxes[2]!.x, boxes[2]!.y]).toEqual([7, 0]);
    expect(boxes[1]!.x + boxes[1]!.w).toBe(599);
  });

  it('opens Maximum Data Value with vmin+1e-6 .. 1e8 and edits the VIEW only', async () => {
    await mountPanel();
    const pushesBefore = pushes().length;
    clickBox(1);

    const dialog = document.querySelector('[data-numberprompt]')!;
    expect(dialog.getAttribute('aria-label')).toBe('Maximum Data Value');
    expect(dialog.querySelector('.dlgmodal__hint')!.textContent).toBe('-0.309428 … 1.00000e+8');
    const input = dialog.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('4.999136');

    typeInto(input, '3');
    act(() => {
      (dialog.querySelector('[data-accept]') as HTMLButtonElement).click();
    });

    expect(frame.texts()).toContain('3.000');
    expect(frame.texts()).not.toContain('4.999');
    // volume.py:292-309 — the boxes are view state and NEVER push.
    expect(pushes()).toHaveLength(pushesBefore);
  });

  it('opens Maximum Alpha Value with 1e-6 .. 1.0 and rescales the alpha axis', async () => {
    await mountPanel();
    const pushesBefore = pushes().length;
    clickBox(2);

    const dialog = document.querySelector('[data-numberprompt]')!;
    expect(dialog.getAttribute('aria-label')).toBe('Maximum Alpha Value');
    expect(dialog.querySelector('.dlgmodal__hint')!.textContent).toBe('0.00000100000 … 1.00000');

    const input = dialog.querySelector('input') as HTMLInputElement;
    typeInto(input, '0.5');
    act(() => {
      (dialog.querySelector('[data-accept]') as HTMLButtonElement).click();
    });

    expect(frame.texts()).toContain('0.50');
    // amax is the DENOMINATOR of alphaToY, so halving it moves the dot for the
    // alpha-0.2 stop up the axis: log10(1+9*0.4) == 0.6628 of the plot.
    const dots = frame.circles();
    expect(Math.round(dots[1]!.y - 0.5)).toBe(61);
    expect(pushes()).toHaveLength(pushesBefore);
  });

  it('a wheel notch over a box nudges it, preventDefaults, and does not push', async () => {
    await mountPanel();
    const pushesBefore = pushes().length;

    const vmaxBox = frame.boxes()[1]!;
    const event = wheel(vmaxBox.x + 2, vmaxBox.y + 2, 100);
    // `passive: false` is the whole reason the listener is added by hand.
    expect(event.defaultPrevented).toBe(true);
    // vmax + (vmax - vmin) * (deltaY/1000)
    expect(frame.texts()).toContain('5.530');

    const amaxBox = frame.boxes()[2]!;
    wheel(amaxBox.x + 2, amaxBox.y + 2, -100);
    // amax is MULTIPLICATIVE: amax * (1 + delta)
    expect(frame.texts()).toContain('0.90');

    expect(pushes()).toHaveLength(pushesBefore);
  });

  it('a wheel notch over the PLOT scales every alpha and DOES push', async () => {
    // The discriminator for the test above: same gesture, 40 px to the right of
    // the vmax box, and the engine hears about it.
    await mountPanel();
    const pushesBefore = pushes().length;
    wheel(300, 90, 100);
    expect(pushes()).toHaveLength(pushesBefore + 1);
    const flat = pushes()[pushes().length - 1]!.args[1] as number[];
    // The middle stop's alpha, through upstream's own expression
    // `y -= y * delta` with delta = deltaY/1000 (`volume.py:551`). Written as
    // `y * (1 - delta)` it lands one ulp away — 0.18000000268220903 rather
    // than 0.180000002682209 — so the form is copied, not the arithmetic.
    const y = 0.20000000298023224;
    expect(flat[9]).toBe(y - y * (100 / 1000));
    expect(flat[9]).toBeCloseTo(0.18, 8);
  });
});

/* ================================================================= row 436 */

describe('the colour picker: triple apply and the live preview push', () => {
  /** A click with no movement on the middle stop. */
  function clickStop(mods: { ctrl?: boolean } = {}) {
    fire('pointerdown', { x: 174, y: 100, button: 0, buttons: 1, ...mods });
    fire('pointerup', { x: 174, y: 100, button: 0, buttons: 0, ...mods });
  }

  it('ctrl+left-click opens the picker in TRIPLE mode', async () => {
    await mountPanel();
    clickStop({ ctrl: true });
    expect(document.querySelector('.volpanel__picker')!.textContent).toContain('(+neighbours)');
    expect(document.querySelector('[data-volume-color]')).not.toBeNull();
  });

  it('plain left-click opens it in SINGLE mode — the discriminator', async () => {
    await mountPanel();
    clickStop();
    expect(document.querySelector('.volpanel__picker')!.textContent).not.toContain('(+neighbours)');
  });

  it('onChange live-previews into cmd.volume_color, all three stops at once', async () => {
    await mountPanel();
    clickStop({ ctrl: true });
    const before = pushes().length;

    const input = document.querySelector('[data-volume-color]') as HTMLInputElement;
    typeInto(input, '#ff0000');

    // `currentColorChanged` -> one push per change, not one on OK
    expect(pushes()).toHaveLength(before + 1);
    const flat = pushes()[pushes().length - 1]!.args[1] as number[];
    // [v,r,g,b,a] * 3 — every stop is now red, and nothing else moved
    expect([flat[1], flat[2], flat[3]]).toEqual([1, 0, 0]);
    expect([flat[6], flat[7], flat[8]]).toEqual([1, 0, 0]);
    expect([flat[11], flat[12], flat[13]]).toEqual([1, 0, 0]);
    expect([flat[0], flat[5], flat[10]]).toEqual([1, 1, 1.399999976158142]);
    expect([flat[4], flat[9], flat[14]]).toEqual([0, 0.20000000298023224, 0]);
    // and the SETTER kwarg is the real one
    expect(pushes()[pushes().length - 1]!.kwargs).toEqual({ _guiupdate: 0 });
  });

  it('single mode touches exactly one stop', async () => {
    await mountPanel();
    clickStop();
    const input = document.querySelector('[data-volume-color]') as HTMLInputElement;
    typeInto(input, '#00ff00');
    const flat = pushes()[pushes().length - 1]!.args[1] as number[];
    expect([flat[6], flat[7], flat[8]]).toEqual([0, 1, 0]);
    expect([flat[1], flat[2], flat[3]]).toEqual([0, 0, 1]);
    expect([flat[11], flat[12], flat[13]]).toEqual([0, 0, 1]);
  });

  it('with real-time OFF the preview is local, and OK is what pushes', async () => {
    await mountPanel();
    const check = document.querySelector('[data-volume-realtime]') as HTMLInputElement;
    act(() => {
      check.click();
    });
    expect(check.checked).toBe(false);

    clickStop({ ctrl: true });
    const before = pushes().length;
    const input = document.querySelector('[data-volume-color]') as HTMLInputElement;
    typeInto(input, '#ff0000');
    // no push...
    expect(pushes()).toHaveLength(before);
    // ...but the canvas already shows it, which is what "preview" means
    expect(frame.circles().map((d) => d.fill)).toEqual([
      'rgb(255, 0, 0)',
      'rgb(255, 0, 0)',
      'rgb(255, 0, 0)',
    ]);

    act(() => {
      (document.querySelector('[data-volume-color-ok]') as HTMLButtonElement).click();
    });
    expect(pushes()).toHaveLength(before + 1);
    expect(document.querySelector('.volpanel__picker')).toBeNull();
  });

  it('Cancel restores the original colour and re-pushes it (volume.py:392-402)', async () => {
    await mountPanel();
    clickStop({ ctrl: true });
    const input = document.querySelector('[data-volume-color]') as HTMLInputElement;
    typeInto(input, '#ff0000');
    act(() => {
      (document.querySelector('[data-volume-color-cancel]') as HTMLButtonElement).click();
    });

    const flat = pushes()[pushes().length - 1]!.args[1] as number[];
    expect(flat).toEqual(fixture.ramp);
    expect(document.querySelector('.volpanel__picker')).toBeNull();
  });
});

/* ================================================================= row 446 */

describe('the named-ramp dropdown is a LIVE read, not a client constant', () => {
  it('reads menu.vol_color and offers exactly its volume_color leaves', async () => {
    await mountPanel();
    const select = document.querySelector('[data-volume-preset]') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      '',
      '2fofc',
      'esp',
      'fofc',
      'rainbow',
      'rainbow2',
    ]);
    expect(
      document
        .querySelector('[data-volume-preset-source]')
        ?.getAttribute('data-volume-preset-source'),
    ).toBe('menu.vol_color');
    expect(calls.find((c) => c.fn === 'menu.vol_color')!.args).toEqual([null, 'p8vol']);
  });

  it('picks up a ramp registered since the panel opened', async () => {
    // `cmd.volume_ramp_new` writes into `pymol.colorramping.namedramps`, and
    // `menu.vol_color` reads that dict every call — measured against the live
    // engine, where a newly registered name appeared in the very next reply.
    // A hard-coded list cannot do this, which is the point of the row.
    await mountPanel();
    presetRows = [
      [2, 'Coloring:', ''],
      [1, 'panel', "cmd.volume_panel('p8vol')"],
      [0, '', ''],
      [1, '2fofc', 'cmd.volume_color(\'p8vol\', "2fofc")'],
      [1, 'myramp', 'cmd.volume_color(\'p8vol\', "myramp")'],
    ];
    await act(async () => {
      (document.querySelector('[data-volume-reload]') as HTMLButtonElement).click();
    });
    for (let i = 0; i < 4; i++) await act(async () => {});

    const select = document.querySelector('[data-volume-preset]') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', '2fofc', 'myramp']);
  });

  it('never offers the `panel` leaf: cmd.volume_panel raises ImportError here', async () => {
    // The row's other half. `colorramping.volume_panel` does
    // `from pmg_qt import volume`, whose first line is `from pymol.Qt import
    // QtGui`, and `pymol/Qt` raises `ImportError(__name__)` with no binding
    // installed — measured over the socket. The menu row is dropped rather
    // than shown-and-broken; wiring the COMMAND to open this panel belongs to
    // whoever dispatches menu leaves, not here.
    await mountPanel();
    const select = document.querySelector('[data-volume-preset]') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).not.toContain('panel');
    // ...and the separator and the title are not offered either
    expect(Array.from(select.options).map((o) => o.textContent)).not.toContain('Coloring:');
  });

  it('falls back to the built-in list and SAYS SO when the call is refused', async () => {
    presetRows = new Error("NotAllowed: 'menu' is not an addressable namespace");
    await mountPanel();
    const select = document.querySelector('[data-volume-preset]') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      '',
      '2fofc',
      'fofc',
      'esp',
      'rainbow',
      'rainbow2',
    ]);
    expect(
      document
        .querySelector('[data-volume-preset-source]')
        ?.getAttribute('data-volume-preset-source'),
    ).toBe('constant');
    // a refused preset list is not a broken panel: the histogram still loaded
    expect(document.querySelector('.volpanel__error')).toBeNull();
  });
});
