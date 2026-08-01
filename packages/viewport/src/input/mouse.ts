/**
 * Mouse/pointer forwarding — 1:1, backend-authoritative (plan §1.4).
 *
 * Every pointer event becomes `{t:'input',kind:'button'|'drag'}` and nothing
 * else. The client NEVER decides what a click means, never runs a raycast to
 * pick, never synthesises a rotation: `PyMOL_Button`/`PyMOL_Drag` own all of
 * it, because the ButMode table (80 slots), `mouse_selection_mode`, the editor
 * (`RotF`/`TorF`/`MovA`/`DrgM` consume `LastPicked` on every move), the
 * rubber band and the 15x15 px pick tolerance all live in the C core.
 *
 * Ordering rules that are NOT optional:
 *
 * * A `button` DOWN, its `drag`s and its `button` UP must arrive in that order.
 *   `transport.input()` is a plain ordered send; the only thing we ever do to
 *   the stream is COALESCE consecutive drags (see below), never reorder it.
 * * Coalescing drags is safe and reordering is not: `SceneDrag` only ever reads
 *   the current position against the press position, so dropping an
 *   intermediate position loses nothing. We keep the LAST position of each
 *   budget window and flush it before any button event.
 * * The coalescer is driven by a CLOCK, not by `requestAnimationFrame`
 *   (`./coalescer.ts`): rAF stops dead in a hidden or occluded tab, and the
 *   old rAF-driven flush turned a whole drag into one jump at `pointerup`.
 * * `when` is taken from the event, not from send time (`./coords.ts`).
 *
 * Wheel is two frames — DOWN then UP with the same coordinates — exactly as
 * `PyMOLGLWidget.wheelEvent` does (`modules/pmg_qt/pymol_gl_widget.py:194-200`),
 * because `ButModeTranslate` maps the wheel slots (12-15, 64-67) by direction
 * and `OrthoButton` suppresses wheel entirely while a real button is held
 * (`layer1/Ortho.cpp:2503-2510`).
 */

import type { CameraDriver } from './camera';
import { ButtonState, Modifier, MouseButton, modifierMask } from '@tenmol/protocol';

import type { ViewportTransport } from '../types';
import { createDragCoalescer, type DragSample } from './coalescer';
import { toPymolPoint, whenOf, type PymolPoint, type SurfaceGeometry } from './coords';

export { Modifier, MouseButton, ButtonState, modifierMask };

/** Trackpad pinch. The browser delivers it as `wheel` with `ctrlKey` set. */
export interface PinchTarget {
  /** Gesture start: capture `get_view()[11]` ONCE (see `camera.pinchZoom`). */
  begin(): void;
  /** Absolute scale factor since `begin()`. */
  update(totalScaleFactor: number): void;
  end(): void;
}

export interface InputControllerOptions {
  /** The element that receives pointer events (the topmost canvas/overlay). */
  element: HTMLElement;
  transport: ViewportTransport;
  /** Current framebuffer geometry; read fresh on every event. */
  geometry: () => SurfaceGeometry;
  /** Called after every forwarded input, so Mode P can schedule a grab. */
  onActivity?: () => void;
  /** Optional hover reporting. NEVER a source of truth for picking. */
  onHover?: (point: PymolPoint, ev: PointerEvent) => void;
  pinch?: PinchTarget;
  onError?: (error: Error) => void;
  /**
   * Minimum spacing between forwarded drag messages, in ms. Default 1000/60.
   * This is a BUDGET, not a schedule: it is measured against a real clock, so
   * it holds whether or not the page is being presented.
   */
  dragBudgetMs?: number;
  /**
   * Drive the camera by RPC instead of forwarding drags as `{t:'input'}`.
   *
   * Set this ONLY for a backend with no GL context. Raw input there is
   * accepted and silently never applied — `OrthoDefer`'s queue is drained by
   * `ExecutiveDrawNow`, which needs a flag only `PyMOL_Draw` sets. Measured on
   * a `--no-gl` bridge: a 20-step drag left `get_view()` byte-identical, while
   * `cmd.turn` moved it immediately.
   *
   * Buttons, clicks and wheel-as-button still forward normally, so picking and
   * selection keep whatever behaviour the backend can give them.
   */
  cameraDriver?: CameraDriver;
  /** Injectable clock/timers for tests. Default `performance.now`/`setTimeout`. */
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface InputControllerStats {
  buttons: number;
  drags: number;
  wheels: number;
  /** Drag positions superseded before they could be sent. */
  coalesced: number;
  /** Drags flushed from inside a pointer handler (works with rAF stopped). */
  dragEventFlushes: number;
  /** Drags flushed by the trailing timer (the resting position). */
  dragTimerFlushes: number;
  /** Drags flushed by an ordering barrier: a button message, or gesture end. */
  dragForcedFlushes: number;
  /** Longest gap between two drags of the last gesture, in ms. */
  dragMaxGapMs: number;
}

export interface InputController {
  destroy(): void;
  /** Sends button-up for any held button. Used on blur / unmount. */
  cancel(): void;
  /** Counters for tests and the HUD. */
  readonly stats: InputControllerStats;
  /** `performance.now()` of the last forwarded input, or 0. */
  readonly lastInputAt: number;
}

/** `ev.button` (DOM) -> `P_GLUT_LEFT/MIDDLE/RIGHT` (`os_gl_glut_pretend.h:24-26`). */
function domButton(button: number): number | null {
  switch (button) {
    case 0:
      return MouseButton.Left;
    case 1:
      return MouseButton.Middle;
    case 2:
      return MouseButton.Right;
    default:
      return null; // back/forward: PyMOL has no slot for them
  }
}

const PINCH_IDLE_MS = 250;

export function createInputController(options: InputControllerOptions): InputController {
  const { element, transport, geometry } = options;

  const counters = { buttons: 0, drags: 0, wheels: 0 };
  let lastInputAt = 0;

  /** The button currently held, or null. PyMOL tracks exactly one. */
  let activeButton: number | null = null;
  let activePointerId: number | null = null;
  /**
   * The last position we forwarded, and the modifier mask that came with it.
   * `cancel()` releases THERE (see below); a synthetic release at the origin
   * would be read by `SceneButton` as a drag of the full window diagonal.
   */
  let lastPoint: PymolPoint | null = null;
  let lastMod: number = Modifier.None;

  const activity = (): void => {
    lastInputAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    options.onActivity?.();
  };

  const send = (message: Parameters<ViewportTransport['input']>[0]): void => {
    try {
      transport.input(message);
      activity();
    } catch (cause) {
      options.onError?.(cause instanceof Error ? cause : new Error(String(cause)));
    }
  };

  /**
   * The clock-driven coalescer. NOT rAF: see `./coalescer.ts` for why, and for
   * the four invariants (order, `when`, final position, one flush per budget).
   */
  let lastDragPoint: { x: number; y: number } | null = null;

  const coalescer = createDragCoalescer({
    flush: (drag: DragSample): void => {
      counters.drags++;
      const driver = options.cameraDriver;
      if (driver) {
        // GL-free: translate the sample into a camera RPC. Deltas are computed
        // here rather than in the driver because only this side knows the
        // previous sample, and a drag that starts mid-gesture must not jump.
        const previous = lastDragPoint;
        lastDragPoint = { x: drag.x, y: drag.y };
        if (previous === null) return;
        driver.drag({
          dx: drag.x - previous.x,
          // PyMOL y is already flipped relative to the DOM by `toPymolPoint`,
          // so flip back to get a DOM-sense dy for the driver's own convention.
          dy: previous.y - drag.y,
          button: activeButton ?? 0,
          mod: drag.mod,
        });
        return;
      }
      send({ t: 'input', kind: 'drag', x: drag.x, y: drag.y, mod: drag.mod, when: drag.when });
    },
    ...(options.dragBudgetMs === undefined ? {} : { budgetMs: options.dragBudgetMs }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.setTimer === undefined ? {} : { setTimer: options.setTimer }),
    ...(options.clearTimer === undefined ? {} : { clearTimer: options.clearTimer }),
  });

  /** Ordering barrier: nothing may overtake a drag that is already pending. */
  const flushDrag = (): void => coalescer.flush();

  const pointOf = (ev: { clientX: number; clientY: number }): PymolPoint =>
    toPymolPoint(ev, element.getBoundingClientRect(), geometry());

  const sendButton = (button: number, state: number, point: PymolPoint, ev: MouseEvent): void => {
    flushDrag();
    counters.buttons++;
    lastPoint = point;
    lastMod = modifierMask(ev);
    // A new press starts a new gesture: forget the previous drag anchor, or the
    // first sample of the next drag is a delta across the gap between them.
    lastDragPoint = null;
    send({
      t: 'input',
      kind: 'button',
      button,
      state,
      x: point.x,
      y: point.y,
      mod: modifierMask(ev),
      when: whenOf(ev),
    });
  };

  /* ------------------------------------------------------------ pointers */

  const onPointerDown = (ev: PointerEvent): void => {
    const button = domButton(ev.button);
    if (button === null) return;
    // A second button while one is held: PyMOL has one ActiveButton, so the
    // first one wins and we ignore the rest until release.
    if (activeButton !== null) return;
    ev.preventDefault();
    activeButton = button;
    activePointerId = ev.pointerId;
    // Open a budget window at the press, so the first move of a gesture is
    // coalesced with its neighbours instead of racing ahead of them.
    coalescer.begin();
    try {
      element.setPointerCapture(ev.pointerId);
    } catch {
      // Not fatal: without capture a drag that leaves the element is lost,
      // which is a degradation, not a correctness break (the backend still
      // gets a coherent down/up pair from the window-level listeners below).
    }
    sendButton(button, ButtonState.Down, pointOf(ev), ev);
  };

  const onPointerMove = (ev: PointerEvent): void => {
    if (activeButton === null) {
      if (options.onHover) options.onHover(pointOf(ev), ev);
      return;
    }
    if (activePointerId !== null && ev.pointerId !== activePointerId) return;
    const point = pointOf(ev);
    lastPoint = point;
    lastMod = modifierMask(ev);
    // A new press starts a new gesture: forget the previous drag anchor, or the
    // first sample of the next drag is a delta across the gap between them.
    lastDragPoint = null;
    coalescer.push({ x: point.x, y: point.y, mod: lastMod, when: whenOf(ev) });
  };

  const onPointerUp = (ev: PointerEvent): void => {
    if (activeButton === null) return;
    if (activePointerId !== null && ev.pointerId !== activePointerId) return;
    const button = activeButton;
    activeButton = null;
    activePointerId = null;
    try {
      element.releasePointerCapture(ev.pointerId);
    } catch {
      /* already released */
    }
    ev.preventDefault();
    // `sendButton` flushes the pending position first, so the release can never
    // overtake it; `end()` then closes the budget window.
    sendButton(button, ButtonState.Up, pointOf(ev), ev);
    coalescer.end();
  };

  /* --------------------------------------------------------------- wheel */

  let pinchScale = 1;
  let pinchActive = false;
  let pinchTimer: ReturnType<typeof setTimeout> | null = null;

  const endPinch = (): void => {
    pinchTimer = null;
    if (!pinchActive) return;
    pinchActive = false;
    pinchScale = 1;
    options.pinch?.end();
  };

  const onWheel = (ev: WheelEvent): void => {
    // The browser reports a trackpad pinch as a wheel event with ctrlKey set
    // (Chrome, Safari, Firefox all do this; it is the only pinch signal a
    // non-Safari browser gives us). PyMOL's own pinch handler manipulates the
    // view directly rather than going through ButMode, so we do too.
    if (ev.ctrlKey && options.pinch) {
      ev.preventDefault();
      if (!pinchActive) {
        pinchActive = true;
        pinchScale = 1;
        options.pinch.begin();
      }
      // deltaY is in the browser's wheel units; e^(-dy/100) is the de-facto
      // standard mapping and gives a smooth, symmetric zoom.
      pinchScale *= Math.exp(-ev.deltaY / 100);
      options.pinch.update(pinchScale);
      if (pinchTimer !== null) clearTimeout(pinchTimer);
      pinchTimer = setTimeout(endPinch, PINCH_IDLE_MS);
      activity();
      return;
    }

    ev.preventDefault();
    // `OrthoButton` ignores wheel while a real button is held; do not even send.
    if (activeButton !== null) return;
    const delta = ev.deltaY !== 0 ? ev.deltaY : ev.deltaX;
    if (delta === 0) return;
    const button = delta < 0 ? MouseButton.ScrollForward : MouseButton.ScrollBackward;
    const point = pointOf(ev);
    counters.wheels++;
    sendButton(button, ButtonState.Down, point, ev);
    sendButton(button, ButtonState.Up, point, ev);
  };

  const onContextMenu = (ev: Event): void => {
    // Right-drag is a first-class PyMOL binding (slot 2 = MovZ by default).
    ev.preventDefault();
  };

  const onLostCapture = (): void => {
    // The browser took the capture away mid-drag (e.g. an alert). Release the
    // backend's ActiveButton rather than leaving PyMOL in a dragging state.
    cancel();
  };

  /**
   * Release whatever is held, without a DOM event to read a position from
   * (`lostpointercapture`, blur, unmount).
   *
   * The release goes to the LAST position we forwarded, not to the origin.
   * `SceneButton` classifies the release by distance from the press
   * (`abs(x - LastX) > 4` / `> 10`, `layer1/Scene.cpp:4113-4155`), so a
   * synthetic up at (0, 0) turns whatever the user was doing into a drag of
   * the full window diagonal: a click on an atom becomes a violent rotation,
   * and `mouse_selection_mode` never sees the click at all. `when` IS `now`,
   * because the release genuinely happens now — it is the coordinates that
   * must not be invented.
   */
  function cancel(): void {
    coalescer.end();
    if (activeButton === null) return;
    const button = activeButton;
    activeButton = null;
    activePointerId = null;
    counters.buttons++;
    send({
      t: 'input',
      kind: 'button',
      button,
      state: ButtonState.Up,
      x: lastPoint?.x ?? 0,
      y: lastPoint?.y ?? 0,
      mod: lastMod,
      when: Date.now() / 1000,
    });
  }

  /**
   * Live view: the drag counters live in the coalescer, so they cannot drift
   * from what was actually sent. Getters are enumerable, so `{...stats}` (what
   * the HUD does) snapshots values, not accessors.
   */
  const stats: InputControllerStats = {
    get buttons(): number {
      return counters.buttons;
    },
    get drags(): number {
      return counters.drags;
    },
    get wheels(): number {
      return counters.wheels;
    },
    get coalesced(): number {
      return coalescer.stats.coalesced;
    },
    get dragEventFlushes(): number {
      return coalescer.stats.eventFlushes;
    },
    get dragTimerFlushes(): number {
      return coalescer.stats.timerFlushes;
    },
    get dragForcedFlushes(): number {
      return coalescer.stats.forcedFlushes;
    },
    get dragMaxGapMs(): number {
      return coalescer.stats.maxGapMs;
    },
  };

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerUp);
  element.addEventListener('lostpointercapture', onLostCapture);
  element.addEventListener('wheel', onWheel, { passive: false });
  element.addEventListener('contextmenu', onContextMenu);

  return {
    destroy(): void {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerUp);
      element.removeEventListener('lostpointercapture', onLostCapture);
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('contextmenu', onContextMenu);
      if (pinchTimer !== null) clearTimeout(pinchTimer);
      coalescer.destroy();
    },
    cancel,
    stats,
    get lastInputAt(): number {
      return lastInputAt;
    },
  };
}
