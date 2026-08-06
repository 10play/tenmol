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
 * `PyMOLGLWidget.wheelEvent` does (`packages/engine/modules/pmg_qt/pymol_gl_widget.py:194-200`),
 * because `ButModeTranslate` maps the wheel slots (12-15, 64-67) by direction
 * and `OrthoButton` suppresses wheel entirely while a real button is held
 * (`packages/engine/layer1/Ortho.cpp:2503-2510`).
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

/** Everything the input controller needs: target element, transport, geometry, and optional pick/pinch/camera hooks. */
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
  cameraDriver?: CameraDriver | undefined;
  /**
   * A left-button PRESS, for a backend that cannot run PyMOL's pick pass.
   *
   * Called in addition to the normal forwarding, never instead of it: on a GL
   * backend PyMOL's own pick is authoritative and this must not compete with
   * it. The viewport only acts on it when the compositor reports the server is
   * not rasterising.
   */
  onPick?: ((point: PymolPoint, ev: MouseEvent) => void) | undefined;
  /** Injectable clock/timers for tests. Default `performance.now`/`setTimeout`. */
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** Counters the input controller keeps: forwarded inputs, coalescing, drops, and drag timing. */
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
  /**
   * Input frames the socket did not take, plus the ones deliberately withheld
   * because the PRESS they belong to was one of them.
   *
   * Non-zero means the "lossless" half of the transport contract was broken by
   * the connection, and is the only way to tell that from "the user did not
   * move the mouse".
   */
  dropped: number;
  /** Gestures abandoned because their press never reached the engine. */
  brokenGestures: number;
}

/** Handle to a live input controller: teardown, cancel, and read-only stats. */
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

/** Wire pointer/wheel events on an element to PyMOL input messages (with drag coalescing). */
export function createInputController(options: InputControllerOptions): InputController {
  const { element, transport, geometry } = options;

  const counters = { buttons: 0, drags: 0, wheels: 0, dropped: 0, brokenGestures: 0 };
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

  /**
   * True when the PRESS of the gesture in progress was not delivered.
   *
   * LOSSLESSNESS, and why a half-gesture is worse than none. `sendInput`
   * returns false and DROPS when the socket is not open
   * (`packages/client/src/connection.ts:327-331`), and nothing looked at that
   * return. So a socket that closed under a press let the drags and the RELEASE
   * through on reconnect: `SceneDrag` would then measure against a stale
   * `LastX/LastY` from whatever the user did before, and `SceneRelease` would
   * report a button PyMOL never saw go down. The queue this row is about is
   * ordered and lossless *inside* the socket; this is the edge where it is not.
   */
  let brokenGesture = false;

  const send = (message: Parameters<ViewportTransport['input']>[0]): void => {
    // A new press always starts a fresh gesture, even if the last one broke.
    if (message.kind === 'button' && message.state === ButtonState.Down) brokenGesture = false;
    if (brokenGesture) {
      counters.dropped++;
      // The matching release ends the abandoned gesture; after it, the next
      // press is clean.
      if (message.kind === 'button' && message.state === ButtonState.Up) brokenGesture = false;
      return;
    }
    try {
      // `isConnected` covers the transport whose `input()` returns void — the
      // app's `createSessionTransport` — and the boolean covers `bindConnection`,
      // which forwards `sendInput`'s own answer.
      const open = transport.isConnected?.() !== false;
      const accepted = open && transport.input(message) !== false;
      if (!accepted) {
        counters.dropped++;
        if (message.kind === 'button' && message.state === ButtonState.Down) {
          brokenGesture = true;
          counters.brokenGestures++;
        }
        return;
      }
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
  /** The last DOM point a move reported, in CSS px within the element. */
  let lastDomPoint: { x: number; y: number } | null = null;

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
        /*
         * The ANCHOR SAMPLE still goes through, with a zero delta. A rubber
         * band tracks the ABSOLUTE cursor, so swallowing the first sample of a
         * gesture left the rectangle one sample behind for its whole life;
         * every other action ignores a zero delta anyway.
         */
        driver.drag({
          dx: previous === null ? 0 : drag.x - previous.x,
          // PyMOL y is already flipped relative to the DOM by `toPymolPoint`,
          // so flip back to get a DOM-sense dy for the driver's own convention.
          dy: previous === null ? 0 : previous.y - drag.y,
          button: activeButton ?? 0,
          mod: drag.mod,
          ...(lastDomPoint === null ? {} : { x: lastDomPoint.x, y: lastDomPoint.y }),
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

  /** DOM CSS pixels within the element, y DOWN — what the driver's box wants. */
  const domPoint = (ev: { clientX: number; clientY: number }): { x: number; y: number } => {
    const box = element.getBoundingClientRect();
    return { x: ev.clientX - box.left, y: ev.clientY - box.top };
  };

  const sendButton = (button: number, state: number, point: PymolPoint, ev: MouseEvent): void => {
    flushDrag();
    counters.buttons++;
    lastPoint = point;
    lastMod = modifierMask(ev);
    /*
     * A new press starts a new gesture. The anchor is the PRESS POSITION, not
     * "nothing": `SceneClick` stores `I->LastX/LastY` at the click and
     * `SceneDrag` measures from there (`packages/engine/layer1/SceneMouse.cpp:864-878`), so the
     * first move of a gesture carries real motion. Anchoring on the first MOVE
     * instead threw that sample away — measured in wave 4 as "11 turns from 12
     * samples". A release clears it, so the next gesture cannot inherit a delta
     * across the gap between them.
     */
    lastDragPoint = state === ButtonState.Down ? { x: point.x, y: point.y } : null;
    lastDomPoint = state === ButtonState.Down ? domPoint(ev) : null;
    if (state === ButtonState.Down && button === MouseButton.Left) {
      options.onPick?.(point, ev);
    }
    /*
     * GL-FREE: the driver needs the press and the release, not just the moves.
     * `ButModeTranslate` is resolved at the press (`SceneClick` stores
     * `I->Button`), and a rubber band exists only between the two — a driver
     * that saw drags alone could never commit one. Wheel-as-button frames are
     * excluded: the wheel has its own slots and `onWheel` drives it directly.
     */
    if (button === MouseButton.Left || button === MouseButton.Middle || button === MouseButton.Right) {
      const driver = options.cameraDriver;
      if (driver) {
        const dom = domPoint(ev);
        const sample = { x: dom.x, y: dom.y, button, mod: modifierMask(ev) };
        if (state === ButtonState.Down) driver.press(sample);
        else driver.release(sample);
      }
    }
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
    lastDomPoint = domPoint(ev);
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
    /*
     * The browser reports a trackpad pinch as a wheel event with ctrlKey set
     * (Chrome, Safari, Firefox all do this; it is the only pinch signal a
     * non-Safari browser gives us). PyMOL's own pinch handler manipulates the
     * view directly rather than going through ButMode, so we do too.
     *
     * BUT A REAL CTRL KEY MUST NOT BE STOLEN. `('w','ctrl','mvsz')` is a live
     * binding in the default mode, so a user holding Ctrl and turning a real
     * wheel expects to move the slab — and every one of those events also
     * arrives with `ctrlKey: true`, indistinguishable from a pinch on its own.
     * The only way to tell them apart is to watch the KEY: if Control is
     * physically down, this is Ctrl+wheel and belongs to ButMode.
     */
    if (ev.ctrlKey && !ctrlKeyDown && options.pinch) {
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
    /*
     * HORIZONTAL SCROLL IS IGNORED UNLESS SHIFT IS HELD.
     *
     * `keymapping.py:100-123` returns 0 for a horizontal wheel event unless
     * the Shift modifier is down — Shift+Wheel is how Qt PyMOL emulates
     * horizontal scrolling, and a bare sideways swipe does nothing.
     *
     * This used to fall back to `deltaX` whenever `deltaY` was 0, with no
     * modifier test. On a trackpad that made a two-finger sideways swipe zoom
     * or move the slab, where desktop PyMOL sits still — the kind of
     * divergence a user reports as "the view jumps when I scroll sideways".
     */
    const horizontal = Math.abs(ev.deltaY) < Math.abs(ev.deltaX);
    if (horizontal && !ev.shiftKey) return;
    const delta = horizontal ? ev.deltaX : ev.deltaY;
    if (delta === 0) return;
    /*
     * SIGN, and why it looks inverted against `get_wheel_button`. Qt's
     * `angleDelta().y()` is POSITIVE when the wheel turns away from the user
     * and maps to button 3; the DOM's `WheelEvent.deltaY` is positive when
     * content scrolls DOWN. Opposite conventions, so the same physical
     * gesture needs the opposite comparison here.
     */
    const button = delta < 0 ? MouseButton.ScrollForward : MouseButton.ScrollBackward;
    const point = pointOf(ev);
    counters.wheels++;
    /*
     * GL-FREE: forwarding a wheel frame to a backend that never draws does
     * nothing at all (the same `OrthoDefer` dead end as a drag), so the driver
     * resolves the wheel slots itself. It is NOT `move z` unconditionally: the
     * default mode binds the bare wheel to `Slab`, and only Ctrl+Shift+wheel to
     * `MovZ` (`controlling.py` three_button_viewing).
     */
    const driver = options.cameraDriver;
    if (driver) {
      driver.wheel(delta < 0 ? -1 : 1, modifierMask(ev));
      activity();
      return;
    }
    sendButton(button, ButtonState.Down, point, ev);
    sendButton(button, ButtonState.Up, point, ev);
  };

  /**
   * Is a physical Control key held right now?
   *
   * Tracked rather than inferred, because `ev.ctrlKey` on a wheel event is set
   * by BOTH a real Ctrl key and a trackpad pinch. Reset on blur: if the window
   * loses focus mid-chord the keyup never arrives, and a stuck `true` would
   * disable pinch-zoom until the next Ctrl press.
   */
  let ctrlKeyDown = false;

  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key === 'Control') ctrlKeyDown = true;
  };
  const onKeyUp = (ev: KeyboardEvent): void => {
    if (ev.key === 'Control') ctrlKeyDown = false;
  };
  const onBlur = (): void => {
    ctrlKeyDown = false;
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
   * (`abs(x - LastX) > 4` / `> 10`, `packages/engine/layer1/Scene.cpp:4113-4155`), so a
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
    get dropped(): number {
      return counters.dropped;
    },
    get brokenGestures(): number {
      return counters.brokenGestures;
    },
  };

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerUp);
  element.addEventListener('lostpointercapture', onLostCapture);
  element.addEventListener('wheel', onWheel, { passive: false });
  element.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', onBlur);

  return {
    destroy(): void {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerUp);
      element.removeEventListener('lostpointercapture', onLostCapture);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
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
