/**
 * Wave 13 — the volume-canvas gestures whose parity rows were standing on a
 * fallback citation, plus the DOM half of the Help row.
 *
 * WHY THIS FILE EXISTS. Rows 435/437/438/442/443 all cited
 * `ramp.test.ts` or `p8volume.dom.test.tsx` with a `†`, meaning "some test
 * mentions a symbol this row names". Mutation testing showed exactly how thin
 * that was. Each of these edits to `VolumeCanvas.tsx` left the ENTIRE web suite
 * green:
 *
 *   * `props.onPoints(scaleAlphas(points, delta), true)` -> `props.realTime`
 *     — row 442's "**regardless** of the real-time checkbox" deleted.
 *   * `props.onPoints(moved.points, props.realTime)` -> `true`
 *     — row 443's entire reason to exist deleted: the checkbox stops gating.
 *   * `if (event.button === 1 || (event.button === 0 && shift))` -> `=== 1`
 *     — row 438's SHIFT+L-Click remove gone.
 *   * the SHIFT+R-Click branch answering `'value'` instead of `'alpha'`
 *     — row 437's opacity prompt gone.
 *
 * And in `ramp.ts`, disabling the sorted-insert search in `addPoint` (so every
 * new stop appends) also left everything green: the one existing test clicks
 * to the RIGHT of every stop, where appending and inserting agree.
 *
 * So this file drives the real `<VolumePanel>` through the real
 * `<VolumeCanvas>` and asserts on what reached `cmd.volume_color` — which is
 * the only thing the user's volume actually depends on.
 *
 * The harness is `p8volume.dom.test.tsx`'s, minus the 2D recorder: nothing here
 * needs painted pixels. jsdom has no `PointerEvent`, no `setPointerCapture`, no
 * `ResizeObserver` and no layout, so all four are stood up in `beforeEach`.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from './__fixtures__/engine-volume.json';
import { VolumePanel } from './VolumePanel';
import { alphaToY, dataToX, LEFT_MARGIN, BOTTOM_MARGIN, VOLUME_HELP } from './ramp';
import { resetVolumeBridge } from './menuBridge';
import type { Session } from '../../app';
import type { DialogWindowSpec } from '../dialogs/store';

/* ------------------------------------------------------------ the socket */

interface Recorded {
  fn: string;
  args: readonly unknown[];
}

const calls: Recorded[] = [];

const SESSION = {
  config: { httpOrigin: 'http://127.0.0.1:0' },
  call: async (fn: string, args: readonly unknown[] = []) => {
    calls.push({ fn, args });
    if (fn === 'volume_color') return args.length === 1 ? fixture.ramp : 0;
    if (fn === 'get_volume_histogram') return fixture.histogram;
    if (fn === 'get_volume_field') throw new Error('no blob store in this test');
    if (fn === 'menu.vol_color') return [];
    throw new Error(`unexpected bridge call ${fn}`);
  },
};

vi.mock('../../app', () => ({ useSession: () => SESSION }));

/** Every `cmd.volume_color(name, flat)` — i.e. every push to the engine. */
const pushes = () => calls.filter((c) => c.fn === 'volume_color' && c.args.length === 2);
const pushCount = () => pushes().length;

/** The flat `[v,r,g,b,a]*N` of the most recent push. */
function lastPush(): number[] {
  const all = pushes();
  if (all.length === 0) throw new Error('nothing was pushed');
  return all[all.length - 1]!.args[1] as number[];
}

/** The most recent push, as stops. */
function lastStops(): { value: number; r: number; g: number; b: number; alpha: number }[] {
  const flat = lastPush();
  const out = [];
  for (let i = 0; i + 4 < flat.length; i += 5) {
    out.push({
      value: flat[i]!,
      r: flat[i + 1]!,
      g: flat[i + 2]!,
      b: flat[i + 3]!,
      alpha: flat[i + 4]!,
    });
  }
  return out;
}

/* ---------------------------------------------------------------- harness */

const WIDTH = 600;
const HEIGHT = 200;

/**
 * The window the panel settles on after `reload()`: `normalizeHistogram` takes
 * vmin/vmax straight off `histogram[0]`/`[1]`, and `amax` is never touched by
 * the load path. Hard-wiring it here keeps the pixel maths below independent of
 * component state that the tests cannot read.
 */
const VIEW = {
  width: WIDTH,
  height: HEIGHT,
  vmin: fixture.histogram[0]!,
  vmax: fixture.histogram[1]!,
  amax: 1,
};

/** Where a stop with this data value and alpha lands, in canvas pixels. */
function stopAt(value: number, alpha: number): { x: number; y: number } {
  return {
    x: LEFT_MARGIN + dataToX(VIEW, value) * (WIDTH - LEFT_MARGIN),
    y: (HEIGHT - BOTTOM_MARGIN) * (1 - alphaToY(VIEW, alpha)),
  };
}

/**
 * Stop 1 of `__fixtures__/engine-volume.json`, in pixels. The ramp is
 * `[1.0 a0, 1.0 a0.2, 1.4 a0]`: stops 0 and 2 sit on the alpha-axis floor and
 * overlap the axis furniture, so stop 1 — the peak, alone in the middle of the
 * plot — is the one every gesture below grabs.
 */
const STOP1 = stopAt(1.0, 0.2);
/** Empty canvas BETWEEN stop 1 and stop 2 — the sorted-insert case. */
const BETWEEN = { x: 200, y: 100 };
/** Empty canvas well right of every stop. */
const EMPTY_RIGHT = { x: 420, y: 60 };

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const REAL_RECT = HTMLElement.prototype.getBoundingClientRect;
const REAL_CONTEXT = HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  calls.length = 0;
  resetVolumeBridge(SESSION as unknown as Session);
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
  // `paint()` runs on every render; a null context would short-circuit it, but
  // the value boxes it publishes into `boxesRef` are what the wheel handler
  // consults, so the stub has to be a real (if inert) 2D context.
  HTMLCanvasElement.prototype.getContext = (() =>
    inertContext()) as unknown as HTMLCanvasElement['getContext'];
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  HTMLElement.prototype.getBoundingClientRect = REAL_RECT;
  HTMLCanvasElement.prototype.getContext = REAL_CONTEXT;
});

function inertContext(): CanvasRenderingContext2D {
  const noop = () => {};
  return {
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
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    setLineDash: noop,
    stroke: noop,
    fill: noop,
    fillRect: noop,
    fillText: noop,
    measureText: (text: string) => ({
      width: text.length * 7,
      fontBoundingBoxAscent: 8,
      fontBoundingBoxDescent: 3,
    }),
  } as unknown as CanvasRenderingContext2D;
}

const SPEC: DialogWindowSpec = {
  key: 'volume:p13vol',
  kind: 'volume',
  arg: 'p13vol',
  title: 'p13vol - Volume Color Map Editor',
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

/** A press and release with no movement in between — Qt's "click". */
function click(p: Pointer) {
  fire('pointerdown', p);
  fire('pointerup', p);
}

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
}

const stopCount = () =>
  Number(document.querySelector('[data-volume-count]')!.getAttribute('data-volume-count'));

const modal = () => document.querySelector('[data-numberprompt]');
const modalTitle = () => modal()?.getAttribute('aria-label') ?? null;
const modalHint = () => modal()?.querySelector('.dlgmodal__hint')?.textContent ?? null;
const picker = () => document.querySelector('[data-volume-color]');

function clickButton(selector: string) {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`no ${selector}`);
  act(() => {
    (el as HTMLElement).click();
  });
}

/* ============================================================== row 435 */

describe('row 435 — add point / add 3-point isosurface', () => {
  it('inserts a new stop in SORTED position, not at the end of the list', async () => {
    await mountPanel();
    expect(stopCount()).toBe(3);

    // x=200 is data ~1.24, i.e. between stop 1 (1.0) and stop 2 (1.4).
    click(BETWEEN);

    expect(stopCount()).toBe(4);
    const values = lastStops().map((s) => s.value);
    expect(values).toHaveLength(4);
    // The list PyMOL receives must be monotonic: `volume_color` interpolates
    // between consecutive entries, so an out-of-order stop renders a ramp that
    // runs backwards through the data range.
    expect(values).toEqual([...values].sort((a, b) => a - b));
    // and specifically: it went in at index 2, between 1.0 and 1.4.
    expect(values[2]).toBeCloseTo(1.241, 2);
    expect(values[3]).toBeCloseTo(1.4, 5);
  });

  it('takes the next colour from the six-colour cycle, click after click', async () => {
    await mountPanel();

    click(EMPTY_RIGHT);
    // `DEFAULT_COLORS[0]` — yellow (volume.py:17-24).
    expect(lastStops().at(-1)).toMatchObject({ r: 1, g: 1, b: 0 });

    click({ x: 460, y: 60 });
    // `DEFAULT_COLORS[1]` — red. The cycle index survives the re-render.
    expect(lastStops().at(-1)).toMatchObject({ r: 1, g: 0, b: 0 });
  });

  it('ctrl inserts three stops, the outer two at zero alpha', async () => {
    await mountPanel();

    click({ ...EMPTY_RIGHT, ctrl: true });

    expect(stopCount()).toBe(6);
    const added = lastStops().slice(3);
    expect(added).toHaveLength(3);
    expect(added[0]!.alpha).toBe(0);
    expect(added[2]!.alpha).toBe(0);
    expect(added[1]!.alpha).toBeGreaterThan(0);
    expect(added[0]!.value).toBeLessThan(added[1]!.value);
    expect(added[1]!.value).toBeLessThan(added[2]!.value);
  });

  it('pushes on the PRESS, before the button comes back up', async () => {
    await mountPanel();
    const before = pushCount();

    fire('pointerdown', EMPTY_RIGHT);
    expect(pushCount()).toBe(before + 1);
    expect(lastStops()).toHaveLength(4);

    fire('pointerup', EMPTY_RIGHT);
  });

  it('suppresses the colour picker on release (`dragged = True`, volume.py:319)', async () => {
    await mountPanel();

    click(EMPTY_RIGHT);
    expect(picker()).toBeNull();

    // Not vacuous: a left-click that lands ON a stop DOES open the picker.
    click(STOP1);
    expect(picker()).not.toBeNull();
  });
});

/* ============================================================== row 437 */

describe('row 437 — numeric value / opacity entry on a stop', () => {
  it('right-click opens `Data value`, clamped to the two neighbouring stops', async () => {
    await mountPanel();

    click({ ...STOP1, button: 2 });

    expect(modalTitle()).toBe('Data value');
    // pointPrompt: min = previous stop's value (1.0), max = next stop's (1.4).
    expect(modalHint()).toBe('1.00000 … 1.40000');
  });

  it('ctrl+right-click opens the same `Data value` prompt (volume.py:325-331)', async () => {
    await mountPanel();

    click({ ...STOP1, button: 2, ctrl: true });

    expect(modalTitle()).toBe('Data value');
  });

  it('shift+right-click opens `Alpha value (opacity)`, clamped to 0..1', async () => {
    await mountPanel();

    click({ ...STOP1, button: 2, shift: true });

    expect(modalTitle()).toBe('Alpha value (opacity)');
    expect(modalHint()).toBe('0.00000 … 1.00000');
  });

  it('accepting the alpha prompt pushes the edited stop; cancelling pushes nothing', async () => {
    await mountPanel();

    click({ ...STOP1, button: 2, shift: true });
    const beforeCancel = pushCount();
    // Cancel is the SECOND button in the row; `data-accept` is OK.
    const cancel = [...modal()!.querySelectorAll('button')].find(
      (b) => b.textContent === 'Cancel',
    )!;
    act(() => cancel.click());
    expect(modal()).toBeNull();
    expect(pushCount()).toBe(beforeCancel);
    expect(lastStops()[1]!.alpha).toBeCloseTo(0.2, 6);

    click({ ...STOP1, button: 2, shift: true });
    const input = modal()!.querySelector('input')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, '0.75');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const beforeOk = pushCount();
    act(() => (modal()!.querySelector('[data-accept]') as HTMLElement).click());
    expect(pushCount()).toBe(beforeOk + 1);
    expect(lastStops()[1]!.alpha).toBeCloseTo(0.75, 6);
    // The value axis is untouched: this prompt edits alpha only.
    expect(lastStops()[1]!.value).toBeCloseTo(1.0, 6);
  });
});

/* ============================================================== row 438 */

describe('row 438 — stop removal, one or three', () => {
  it('middle-click removes the stop under the cursor (M-Click)', async () => {
    await mountPanel();

    click({ ...STOP1, button: 1 });

    expect(stopCount()).toBe(2);
    expect(lastStops()).toHaveLength(2);
    expect(lastStops().every((s) => s.alpha === 0)).toBe(true);
  });

  it('shift+left-click removes it too, and does NOT open the colour picker', async () => {
    await mountPanel();

    click({ ...STOP1, button: 0, shift: true });

    expect(stopCount()).toBe(2);
    expect(picker()).toBeNull();
  });

  it('ctrl+middle-click removes the stop and both neighbours', async () => {
    await mountPanel();

    click({ ...STOP1, button: 1, ctrl: true });

    expect(stopCount()).toBe(0);
    expect(lastPush()).toEqual([]);
  });

  it('ctrl+shift+left-click removes three as well', async () => {
    await mountPanel();

    click({ ...STOP1, button: 0, ctrl: true, shift: true });

    expect(stopCount()).toBe(0);
  });

  it('pushes the SHORTER list on release, never the stop it just deleted', async () => {
    await mountPanel();

    click({ ...STOP1, button: 1 });

    // `mouseReleaseEvent` ends with an unconditional `updateVolumeColors()`
    // AFTER the branch that already pushed. Reading a stale ref there re-sends
    // the deleted stop; every push from this gesture must be the short list.
    const removals = pushes().slice(-2);
    expect(removals).toHaveLength(2);
    for (const p of removals) expect((p.args[1] as number[]).length).toBe(10);
  });
});

/* ============================================================== row 442 */

describe('row 442 — wheel over the plot scales every alpha', () => {
  it('scales by (1 - delta) and pushes', async () => {
    await mountPanel();
    const before = pushCount();

    wheel(EMPTY_RIGHT.x, EMPTY_RIGHT.y, 100); // delta = +0.1

    expect(pushCount()).toBe(before + 1);
    expect(lastStops()[1]!.alpha).toBeCloseTo(0.2 * 0.9, 6);
  });

  it('pushes even with the real-time checkbox OFF — the row says "regardless"', async () => {
    await mountPanel();
    setRealTime(false);
    const before = pushCount();

    wheel(EMPTY_RIGHT.x, EMPTY_RIGHT.y, 100);

    expect(pushCount()).toBe(before + 1);
    expect(lastStops()[1]!.alpha).toBeCloseTo(0.18, 6);
  });
});

/* ============================================================== row 443 */

function setRealTime(on: boolean) {
  const box = document.querySelector('[data-volume-realtime]') as HTMLInputElement;
  if (!box) throw new Error('no real-time checkbox');
  if (box.checked !== on) act(() => box.click());
  expect((document.querySelector('[data-volume-realtime]') as HTMLInputElement).checked).toBe(on);
}

describe('row 443 — the real-time checkbox gates DRAGS and nothing else', () => {
  it('is checked by default (volume.py:856-862)', async () => {
    await mountPanel();
    expect((document.querySelector('[data-volume-realtime]') as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it('ON: every pointermove of a drag pushes', async () => {
    await mountPanel();

    fire('pointerdown', STOP1);
    const before = pushCount();
    fire('pointermove', { x: STOP1.x + 6, y: STOP1.y - 10, buttons: 1 });
    fire('pointermove', { x: STOP1.x + 12, y: STOP1.y - 20, buttons: 1 });
    expect(pushCount()).toBe(before + 2);

    fire('pointerup', { x: STOP1.x + 12, y: STOP1.y - 20 });
  });

  it('OFF: the drag pushes NOTHING, and the release pushes exactly once', async () => {
    await mountPanel();
    setRealTime(false);

    fire('pointerdown', STOP1);
    const before = pushCount();
    fire('pointermove', { x: STOP1.x + 6, y: STOP1.y - 10, buttons: 1 });
    fire('pointermove', { x: STOP1.x + 12, y: STOP1.y - 20, buttons: 1 });
    expect(pushCount()).toBe(before);

    fire('pointerup', { x: STOP1.x + 12, y: STOP1.y - 20 });
    // `self.updateVolumeColors()` at the end of mouseReleaseEvent is
    // unconditional (volume.py:365) — the engine still ends up in sync.
    expect(pushCount()).toBe(before + 1);
    expect(lastStops()[1]!.alpha).toBeGreaterThan(0.2);
  });

  it('OFF: add and remove still push, exactly as upstream does', async () => {
    await mountPanel();
    setRealTime(false);

    const beforeAdd = pushCount();
    fire('pointerdown', EMPTY_RIGHT);
    expect(pushCount()).toBe(beforeAdd + 1);
    fire('pointerup', EMPTY_RIGHT);
    expect(stopCount()).toBe(4);

    const beforeRemove = pushCount();
    fire('pointerdown', { ...STOP1, button: 1 });
    fire('pointerup', { ...STOP1, button: 1 });
    expect(pushCount()).toBeGreaterThan(beforeRemove);
    expect(stopCount()).toBe(3);
  });
});

/* ============================================================== row 445 */

describe('row 445 — the Help button shows the VOLUME_HELP block', () => {
  it('opens the reusable read-only text dialog with the whole block in it', async () => {
    await mountPanel();
    expect(document.querySelector('[data-textdialog]')).toBeNull();

    clickButton('[data-volume-help]');

    const dialog = document.querySelector('[data-textdialog]');
    expect(dialog).not.toBeNull();
    const pre = dialog!.querySelector('pre')!;
    expect(pre.textContent).toBe(VOLUME_HELP);
    // The specific claims of the row, read off the rendered DOM rather than the
    // constant: the two gesture sections, the legend and the command pointer.
    expect(pre.textContent).toContain('Canvas Mouse Actions (no Point under Cursor)');
    expect(pre.textContent).toContain('Mouse Actions with Point under Cursor');
    expect(pre.textContent).toContain('L = Left mouse button');
    expect(pre.textContent).toContain('M = Middle mouse button');
    expect(pre.textContent).toContain('R = Right mouse button');
    expect(pre.textContent).toContain('"volume_color"');
  });

  it('is 500 px wide, the same reusable dialog "Get colors as script" uses', async () => {
    await mountPanel();

    clickButton('[data-volume-help]');
    const help = document.querySelector('[data-textdialog] .dlgmodal__box') as HTMLElement;
    expect(help.style.width).toBe('500px');

    clickButton('[data-textdialog] .dlgwin__btn');
    clickButton('[data-volume-script]');
    const script = document.querySelector('[data-textdialog] .dlgmodal__box') as HTMLElement;
    expect(script.style.width).toBe('500px');
    expect(script.parentElement!.getAttribute('aria-label')).toBe('Volume color ramp');
  });

  it('does not push anything: Help is a read-only dialog', async () => {
    await mountPanel();
    const before = pushCount();
    clickButton('[data-volume-help]');
    expect(pushCount()).toBe(before);
  });
});
