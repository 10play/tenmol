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
 *   animation frame and flush it before any button event.
 * * `when` is taken from the event, not from send time (`./coords.ts`).
 *
 * Wheel is two frames — DOWN then UP with the same coordinates — exactly as
 * `PyMOLGLWidget.wheelEvent` does (`modules/pmg_qt/pymol_gl_widget.py:194-200`),
 * because `ButModeTranslate` maps the wheel slots (12-15, 64-67) by direction
 * and `OrthoButton` suppresses wheel entirely while a real button is held
 * (`layer1/Ortho.cpp:2503-2510`).
 */

import { ButtonState, Modifier, MouseButton, modifierMask } from '@tenmol/protocol';

import type { ViewportTransport } from '../types';
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
}

export interface InputController {
  destroy(): void;
  /** Sends button-up for any held button. Used on blur / unmount. */
  cancel(): void;
  /** Counters for tests and the HUD. */
  readonly stats: { buttons: number; drags: number; wheels: number; coalesced: number };
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

  const stats = { buttons: 0, drags: 0, wheels: 0, coalesced: 0 };
  let lastInputAt = 0;

  /** The button currently held, or null. PyMOL tracks exactly one. */
  let activeButton: number | null = null;
  let activePointerId: number | null = null;
  /** Latest un-flushed drag. */
  let pendingDrag: { x: number; y: number; mod: number; when: number } | null = null;
  let rafHandle: number | null = null;

  const raf = (cb: () => void): number =>
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(() => cb())
      : (setTimeout(cb, 16) as unknown as number);
  const cancelRaf = (handle: number): void => {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
    else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
  };

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

  const flushDrag = (): void => {
    if (rafHandle !== null) {
      cancelRaf(rafHandle);
      rafHandle = null;
    }
    const drag = pendingDrag;
    if (drag === null) return;
    pendingDrag = null;
    stats.drags++;
    send({ t: 'input', kind: 'drag', x: drag.x, y: drag.y, mod: drag.mod, when: drag.when });
  };

  const scheduleDrag = (drag: { x: number; y: number; mod: number; when: number }): void => {
    if (pendingDrag !== null) stats.coalesced++;
    pendingDrag = drag;
    if (rafHandle !== null) return;
    rafHandle = raf(() => {
      rafHandle = null;
      flushDrag();
    });
  };

  const pointOf = (ev: { clientX: number; clientY: number }): PymolPoint =>
    toPymolPoint(ev, element.getBoundingClientRect(), geometry());

  const sendButton = (button: number, state: number, point: PymolPoint, ev: MouseEvent): void => {
    flushDrag();
    stats.buttons++;
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
    scheduleDrag({ x: point.x, y: point.y, mod: modifierMask(ev), when: whenOf(ev) });
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
    sendButton(button, ButtonState.Up, pointOf(ev), ev);
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
    stats.wheels++;
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

  function cancel(): void {
    flushDrag();
    if (activeButton === null) return;
    const button = activeButton;
    activeButton = null;
    activePointerId = null;
    stats.buttons++;
    send({
      t: 'input',
      kind: 'button',
      button,
      state: ButtonState.Up,
      x: 0,
      y: 0,
      mod: Modifier.None,
      when: Date.now() / 1000,
    });
  }

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
      if (rafHandle !== null) cancelRaf(rafHandle);
      pendingDrag = null;
    },
    cancel,
    stats,
    get lastInputAt(): number {
      return lastInputAt;
    },
  };
}
