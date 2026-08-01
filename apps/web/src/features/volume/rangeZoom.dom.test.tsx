/**
 * `ctrl+R-drag` range zoom and `Reset Data Range` — the EVENT MODEL.
 *
 * `rangeZoom.test.ts` pins the arithmetic and the band; this file drives the
 * real components with real DOM events, because everything interesting about
 * this feature is in *when* those functions are called:
 *
 *   * the zoom branch of `mouseMoveEvent` (`volume.py:495-499`) tests
 *     `buttons() == RightButton` and `modifiers() == ControlModifier` — an
 *     EXACT modifier match, not a mask test — and RETURNS, so `self.dragged`
 *     is never set and a point under the cursor is never moved;
 *   * `mouseReleaseEvent` (`volume.py:344-365`) runs the point branch AND the
 *     zoom branch, in that order, and then pushes colours unconditionally;
 *   * `reset()` (`volume.py:739-746`) restores `original_vmin/original_vmax`
 *     and calls `updateVolumeColors()` — i.e. `cmd.volume_color` — again.
 *
 * THREE jsdom FACTS this file works around, all of them measured here:
 *   1. there is no `PointerEvent`; React only reads the fields a `MouseEvent`
 *      already carries, plus `pointerId`, so one is constructed by hand;
 *   2. `Element.setPointerCapture` and `ResizeObserver` do not exist;
 *   3. `HTMLCanvasElement.getContext('2d')` returns null, so
 *      `<VolumeCanvas>`'s paint effect bails out and NOTHING is observable.
 *      A recording context is installed instead — which also turns the painted
 *      value boxes into the only honest read-out of `vmin`/`vmax`, since those
 *      live in state and are drawn, never rendered as DOM text.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VolumeRampPoint } from '@tenmol/protocol/topics/dialogs';
import fixture from './__fixtures__/engine-volume.json';
import { VolumeCanvas } from './VolumeCanvas';
import { VolumePanel } from './VolumePanel';
import { flatToPoints, type RampView } from './ramp';
import type { DialogWindowSpec } from '../dialogs/store';
import { recordingContext } from './rangeZoom.test';

/* ------------------------------------------------------------- module doubles */

/** `setRamp(session, name, flat)` IS `cmd.volume_color(name, flat)` (service.ts:59). */
const setRamp = vi.fn(async (_session: unknown, _name: string, _flat: readonly number[]) => {});
const getRamp = vi.fn(async () => fixture.ramp as number[]);
const fetchHistogram = vi.fn(async () => ({
  histogram: fixture.histogram as number[],
  source: 'get_volume_histogram' as const,
}));

vi.mock('./service', () => ({
  setRamp: (session: unknown, name: string, flat: readonly number[]) =>
    setRamp(session, name, flat),
  getRamp: () => getRamp(),
  fetchHistogram: () => fetchHistogram(),
  applyPreset: vi.fn(async () => {}),
  listVolumes: vi.fn(async () => []),
  registerRamp: vi.fn(async () => {}),
}));

// ONE stable object. `useSession()`'s result is a dependency of `reload`, which
// is a dependency of the effect that calls it — handing back a fresh object per
// render turns the panel into an infinite render loop (measured: the first
// version of this file timed out at 5 s).
const SESSION = { call: vi.fn() };
vi.mock('../../app', () => ({ useSession: () => SESSION }));

/* ------------------------------------------------------------------ harness */

const WIDTH = 600;
const HEIGHT = 200;
const ORIGINAL_VMIN = fixture.histogram[0]!; // -0.30942875146865845
const ORIGINAL_VMAX = fixture.histogram[1]!; //  4.999135971069336

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
/** The most recent frame `paint()` produced. */
let frame = recordingContext();

// Prototype patches are global. Vitest isolates per file, but restoring them is
// three lines and a shared-jsdom option away from being load-bearing.
const REAL_RECT = HTMLElement.prototype.getBoundingClientRect;
const REAL_CONTEXT = HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  frame = recordingContext();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  setRamp.mockClear();

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
  // jsdom has no layout: every rect is the zero rect, which would collapse the
  // plot to nothing. One fixed rect at the origin makes clientX == canvas X.
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
    frame = recordingContext();
    return frame.ctx;
  }) as unknown as HTMLCanvasElement['getContext'];
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  HTMLElement.prototype.getBoundingClientRect = REAL_RECT;
  HTMLCanvasElement.prototype.getContext = REAL_CONTEXT;
});

function canvas(): HTMLCanvasElement {
  const found = document.querySelector('canvas[data-volcanvas]');
  if (!found) throw new Error('no volume canvas mounted');
  return found as HTMLCanvasElement;
}

interface Pointer {
  x: number;
  y: number;
  /** `event.button` — 0 left, 1 middle, 2 right. -1 on move. */
  button?: number;
  /** `event.buttons` bitmask — 1 left, 2 right. */
  buttons?: number;
  ctrl?: boolean;
  shift?: boolean;
}

/** jsdom has no PointerEvent; React reads `button`/`buttons`/`clientX`/mods. */
function fire(type: 'pointerdown' | 'pointermove' | 'pointerup', p: Pointer) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: p.x,
    clientY: p.y,
    button: p.button ?? (type === 'pointermove' ? 0 : 2),
    buttons: p.buttons ?? (type === 'pointerup' ? 0 : 2),
    ctrlKey: p.ctrl ?? false,
    shiftKey: p.shift ?? false,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => {
    canvas().dispatchEvent(event);
  });
}

/** A whole ctrl+right-drag: press, one move, release. */
function ctrlRightDrag(fromX: number, toX: number, releaseX = toX, y = 60) {
  fire('pointerdown', { x: fromX, y, button: 2, buttons: 2, ctrl: true });
  fire('pointermove', { x: toX, y, button: -1, buttons: 2, ctrl: true });
  fire('pointerup', { x: releaseX, y, button: 2, buttons: 0, ctrl: true });
}

const BAND = 'rgba(0, 64, 128, 0.502)';
const bands = () => frame.fills.filter((f) => f.fill === BAND);

/* ------------------------------------------------------------------ canvas */

/** A controlled harness: exactly the wiring `<VolumePanel>` provides. */
function Harness(props: {
  onView: (patch: Partial<RampView>) => void;
  onPoints?: (points: VolumeRampPoint[], push: boolean) => void;
  onRelease?: () => void;
  onPrompt?: (r: { point: number; which: 'value' | 'alpha' }) => void;
  points?: VolumeRampPoint[];
  view?: Partial<RampView>;
}) {
  const view: RampView = {
    width: WIDTH,
    height: HEIGHT,
    vmin: ORIGINAL_VMIN,
    vmax: ORIGINAL_VMAX,
    amax: 1,
    ...props.view,
  };
  return (
    <VolumeCanvas
      view={view}
      points={props.points ?? []}
      path={[]}
      originalVmin={ORIGINAL_VMIN}
      originalVmax={ORIGINAL_VMAX}
      realTime
      colorIndex={0}
      onSize={() => {}}
      onPoints={props.onPoints ?? (() => {})}
      onView={props.onView}
      onColorIndex={() => {}}
      onRelease={props.onRelease ?? (() => {})}
      onPrompt={props.onPrompt ?? (() => {})}
      onValueBoxPrompt={() => {}}
      onColorPick={() => {}}
    />
  );
}

describe('<VolumeCanvas> ctrl+R-drag', () => {
  it('suppresses the context menu, or the right button can never drag', () => {
    // No Qt counterpart: Qt gets `mousePressEvent(RightButton)` for free. In a
    // browser the default action of a right press is the context menu, which
    // pops over the canvas and (on some platforms) swallows the pointerup.
    act(() => root.render(<Harness onView={vi.fn()} />));
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => {
      canvas().dispatchEvent(menu);
    });
    expect(menu.defaultPrevented).toBe(true);

    // The same for the middle button's autoscroll (`M-Click Remove Point`).
    const aux = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 });
    act(() => {
      canvas().dispatchEvent(aux);
    });
    expect(aux.defaultPrevented).toBe(true);

    const down = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 60,
      button: 2,
      buttons: 2,
      ctrlKey: true,
    });
    Object.defineProperty(down, 'pointerId', { value: 1 });
    act(() => {
      canvas().dispatchEvent(down);
    });
    expect(down.defaultPrevented).toBe(true);
  });

  it('zooms to the sorted data values under the two band edges', () => {
    const onView = vi.fn();
    const onRelease = vi.fn();
    act(() => root.render(<Harness onView={onView} onRelease={onRelease} />));

    ctrlRightDrag(100, 300);

    expect(onView).toHaveBeenCalledTimes(1);
    const patch = onView.mock.calls[0]![0] as Partial<RampView>;
    expect(patch.vmin).toBeCloseTo(0.301291083867571, 12);
    expect(patch.vmax).toBeCloseTo(2.180429038748277, 12);
    // volume.py:365 — the release always pushes, zoom or no zoom.
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it('paints the band while dragging and clears it on release', () => {
    act(() => root.render(<Harness onView={vi.fn()} />));

    fire('pointerdown', { x: 100, y: 60, button: 2, buttons: 2, ctrl: true });
    expect(bands()).toEqual([]);

    fire('pointermove', { x: 300, y: 60, button: -1, buttons: 2, ctrl: true });
    expect(bands()).toEqual([{ x: 100, y: 0, w: 200, h: 180, fill: BAND }]);

    fire('pointermove', { x: 420, y: 60, button: -1, buttons: 2, ctrl: true });
    expect(bands()).toEqual([{ x: 100, y: 0, w: 320, h: 180, fill: BAND }]);

    fire('pointerup', { x: 420, y: 60, button: 2, buttons: 0, ctrl: true });
    expect(bands()).toEqual([]);
  });

  it('gives the same window for a right-to-left drag', () => {
    const onView = vi.fn();
    act(() => root.render(<Harness onView={onView} />));
    ctrlRightDrag(300, 100);
    const patch = onView.mock.calls[0]![0] as Partial<RampView>;
    expect(patch.vmin).toBeCloseTo(0.301291083867571, 12);
    expect(patch.vmax).toBeCloseTo(2.180429038748277, 12);
  });

  it('ignores a zero-width band', () => {
    const onView = vi.fn();
    const onRelease = vi.fn();
    act(() => root.render(<Harness onView={onView} onRelease={onRelease} />));
    ctrlRightDrag(240, 240);
    expect(onView).not.toHaveBeenCalled();
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it('ignores a press-and-release with no drag at all', () => {
    const onView = vi.fn();
    act(() => root.render(<Harness onView={onView} />));
    fire('pointerdown', { x: 240, y: 60, button: 2, buttons: 2, ctrl: true });
    fire('pointerup', { x: 240, y: 60, button: 2, buttons: 0, ctrl: true });
    expect(onView).not.toHaveBeenCalled();
  });

  it('compares the ANCHOR against the LAST MOVE, not against the release point', () => {
    // `if self.init_pos.x() != self.zoom_pos.x()` (volume.py:359). A pointerup
    // is free to carry a coordinate no pointermove ever reported; reading it
    // instead of `zoom_pos` silently threw away a band the user had watched
    // being painted for 200 px.
    const onView = vi.fn();
    act(() => root.render(<Harness onView={onView} />));
    ctrlRightDrag(100, 300, /* released back on the anchor */ 100);
    expect(onView).toHaveBeenCalledTimes(1);
    expect((onView.mock.calls[0]![0] as Partial<RampView>).vmax).toBeCloseTo(2.180429038748277, 12);
  });

  it('needs the RIGHT button and ctrl EXACTLY — nothing else zooms', () => {
    for (const drag of [
      { buttons: 2, ctrl: false }, // R-drag alone moves points (volume.py:500)
      { buttons: 1, ctrl: true }, // ctrl+L-drag moves three points
      { buttons: 2, ctrl: true, shift: true }, // == Ctrl|Shift, not == Ctrl
      { buttons: 3, ctrl: true }, // both buttons: `buttons() in (L, R)` fails
    ]) {
      const onView = vi.fn();
      act(() => root.render(<Harness onView={onView} />));
      fire('pointerdown', { x: 100, y: 60, button: 2, ...drag });
      fire('pointermove', { x: 300, y: 60, button: -1, ...drag });
      fire('pointerup', { x: 300, y: 60, button: 2, buttons: 0, ctrl: drag.ctrl });
      expect(onView, JSON.stringify(drag)).not.toHaveBeenCalled();
      expect(bands(), JSON.stringify(drag)).toEqual([]);
    }
  });

  it('needs a press that landed in the plot rect — no anchor, no band', () => {
    const onView = vi.fn();
    act(() => root.render(<Harness onView={onView} />));
    // x=10 is left of LEFT_MARGIN - DOT_RADIUS, so `mousePressEvent`'s
    // contains() test fails and there is no `init_pos` to zoom from.
    ctrlRightDrag(10, 300, 300, 60);
    expect(onView).not.toHaveBeenCalled();
    expect(bands()).toEqual([]);
  });

  it('drops the anchor on release, so a drag begun elsewhere cannot zoom', () => {
    // Qt never clears `init_pos`, and does not have to: a QWidget holds an
    // implicit mouse grab, so no move event reaches it after the release
    // without a new press. The DOM delivers pointermove to whatever is under
    // the cursor, so a button pressed on another element and dragged across
    // this canvas would otherwise paint a band from the previous anchor.
    const onView = vi.fn();
    act(() => root.render(<Harness onView={onView} />));
    ctrlRightDrag(100, 300);
    expect(onView).toHaveBeenCalledTimes(1);

    fire('pointermove', { x: 420, y: 60, button: -1, buttons: 2, ctrl: true });
    expect(bands()).toEqual([]);
    fire('pointerup', { x: 420, y: 60, button: 2, buttons: 0, ctrl: true });
    expect(onView).toHaveBeenCalledTimes(1);
  });

  it('ALSO opens the value prompt when the drag started on a point', () => {
    // Faithful to upstream and surprising: `mouseReleaseEvent` runs the
    // `not self.dragged and self.point >= 0` branch (:345) *and* the zoom
    // branch (:358). The move handler returns before setting `dragged`, so a
    // ctrl+R-drag that began on a dot both edits its value and zooms.
    const points = flatToPoints(fixture.ramp as number[])!;
    const onView = vi.fn();
    const onPrompt = vi.fn();
    const onPoints = vi.fn();
    act(() =>
      root.render(
        <Harness onView={onView} onPrompt={onPrompt} onPoints={onPoints} points={points} />,
      ),
    );
    // The dot the fixture puts at value 1.0: x = 35 + 565*dataToX(1.0).
    const dotX = Math.round(35 + 565 * ((1.0 - ORIGINAL_VMIN) / (ORIGINAL_VMAX - ORIGINAL_VMIN)));
    const dotY = Math.round(HEIGHT - 20); // alpha 0 sits on the axis
    fire('pointerdown', { x: dotX, y: dotY, button: 2, buttons: 2, ctrl: true });
    fire('pointermove', { x: dotX + 150, y: dotY, button: -1, buttons: 2, ctrl: true });
    fire('pointerup', { x: dotX + 150, y: dotY, button: 2, buttons: 0, ctrl: true });

    expect(onPrompt).toHaveBeenCalledWith({ point: expect.any(Number), which: 'value' });
    expect(onView).toHaveBeenCalledTimes(1);
    // and the point itself was never moved: the zoom branch returns first
    expect(onPoints).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------- panel */

const SPEC: DialogWindowSpec = {
  key: 'volume:emap',
  kind: 'volume',
  arg: 'emap',
  title: 'emap - Volume Color Map Editor',
  x: 0,
  y: 0,
  width: 640,
  height: 260,
  z: 1,
  minimised: false,
};

/** The `%.3f` the value boxes are drawn with (`volume.py:178-196`). */
function valueBoxTexts(): string[] {
  return frame.texts.map((t) => t.text);
}

async function mountPanel() {
  await act(async () => {
    root.render(<VolumePanel spec={SPEC} />);
  });
  // the two awaited service calls resolve on the microtask queue
  await act(async () => {});
}

describe('<VolumePanel> Reset Data Range (volume.py:739-746)', () => {
  it('restores original_vmin/original_vmax and re-pushes cmd.volume_color', async () => {
    await mountPanel();
    expect(valueBoxTexts()).toContain(ORIGINAL_VMIN.toFixed(3)); // "-0.309"
    expect(valueBoxTexts()).toContain(ORIGINAL_VMAX.toFixed(3)); // "4.999"

    ctrlRightDrag(100, 300);
    expect(valueBoxTexts()).toContain('0.301');
    expect(valueBoxTexts()).toContain('2.180');

    const pushesBefore = setRamp.mock.calls.length;
    const reset = document.querySelector('[data-volume-reset]') as HTMLButtonElement;
    act(() => reset.click());

    expect(valueBoxTexts()).toContain(ORIGINAL_VMIN.toFixed(3));
    expect(valueBoxTexts()).toContain(ORIGINAL_VMAX.toFixed(3));
    // `reset()` ends with `self.updateVolumeColors()` — one more volume_color.
    expect(setRamp.mock.calls.length).toBe(pushesBefore + 1);
    const [, name, flat] = setRamp.mock.calls[setRamp.mock.calls.length - 1]!;
    expect(name).toBe('emap');
    // the ramp is re-sent UNCHANGED: zooming the axis never edits the stops
    expect(flat).toEqual(fixture.ramp);
  });

  it('leaves the ramp stops alone: only the axis window moves', async () => {
    await mountPanel();
    const before = document.querySelector('[data-volume-count]')?.getAttribute('data-volume-count');
    ctrlRightDrag(100, 300);
    expect(document.querySelector('[data-volume-count]')?.getAttribute('data-volume-count')).toBe(
      before,
    );
    // the release pushes unconditionally (volume.py:365), with the same stops
    const flat = setRamp.mock.calls[setRamp.mock.calls.length - 1]![2];
    expect(flat).toEqual(fixture.ramp);
  });

  it('compounds: a second drag is read against the window the first one left', async () => {
    // Added by the verifier. Without this the "zooms compound" claim rested on
    // a helper the test file computed itself: a mutation that made the release
    // read `originalVmin/originalVmax` instead of the live `view` passed all 31
    // of the original tests. It now fails here.
    await mountPanel();
    ctrlRightDrag(100, 300);
    expect(valueBoxTexts()).toContain('0.301');
    expect(valueBoxTexts()).toContain('2.180');

    ctrlRightDrag(100, 300);
    // 0.5174750963759708 .. 1.1826566733248933 — the SAME two pixels read
    // against 0.301291.. .. 2.180429.., not against the original range.
    expect(valueBoxTexts()).toContain('0.517');
    expect(valueBoxTexts()).toContain('1.183');
    expect(valueBoxTexts()).not.toContain('4.999');
  });
});

/* ------------------------------------------------------- verifier additions */

describe('<VolumeCanvas> ctrl+R-drag against an already-zoomed window', () => {
  /** The window a first 100 -> 300 drag leaves behind. */
  const ZOOMED = { vmin: 0.301291083867571, vmax: 2.180429038748277 };

  it('reads the band against the CURRENT window, not the original range', () => {
    const onView = vi.fn();
    act(() => root.render(<Harness onView={onView} view={ZOOMED} />));
    ctrlRightDrag(100, 300);
    const patch = onView.mock.calls[0]![0] as Partial<RampView>;
    expect(patch.vmin).toBeCloseTo(0.5174750963759708, 12);
    expect(patch.vmax).toBeCloseTo(1.1826566733248933, 12);
  });

  it('can never widen: a band dragged off both ends is the current window exactly', () => {
    // x=30 is LEFT_MARGIN - DOT_RADIUS, the leftmost press `mousePressEvent`
    // still accepts (volume.py:311-313); convertX clamps it to 0.0, and the
    // move at x=4000 clamps to 1.0 (volume.py:435-440).
    const onView = vi.fn();
    act(() => root.render(<Harness onView={onView} view={ZOOMED} />));
    ctrlRightDrag(30, 4000);
    const patch = onView.mock.calls[0]![0] as Partial<RampView>;
    expect(patch.vmin).toBe(ZOOMED.vmin);
    expect(patch.vmax).toBe(ZOOMED.vmax);
  });
});
