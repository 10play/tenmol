/**
 * The wiring half of row 149: real pointer and wheel events REACH the GL-free
 * driver.
 *
 * A driver that resolves the ButMode table perfectly is worth nothing if the
 * input controller never calls it. Two of the three entry points did not exist
 * before this wave: `press`/`release` (without which a rubber band can never be
 * started or committed) and `wheel` — the wheel was forwarded as a `{t:'input'}`
 * down/up pair to a backend that, being GL-free, drops it in `OrthoDefer`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { InputMessage } from '@tenmol/protocol';

import { createCameraDriver, type CameraDriver } from './camera';
import { createInputController, type InputController } from './mouse';

const VIEW = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -50, 0, 0, 0, 40, 100, -20];

describe('the input controller drives the GL-free driver', () => {
  let element: HTMLElement;
  let sent: InputMessage[];
  let calls: Array<{ fn: string; args: readonly unknown[] }>;
  let driver: CameraDriver;
  let controller: InputController;
  let hits: Array<{ object: string; index: number }>;

  beforeEach(() => {
    element = window.document.createElement('div');
    element.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 }) as DOMRect;
    window.document.body.appendChild(element);
    sent = [];
    calls = [];
    hits = [{ object: 'zz', index: 0 }];
    driver = createCameraDriver({
      call: (fn, args = []) => {
        calls.push({ fn, args });
        return Promise.resolve(null);
      },
      degPerPx: 1,
      movePerPx: 1,
      mode: () => 'three_button_viewing',
      view: () => VIEW,
      boxHits: () => hits,
      selectionMode: () => 0, // Atoms: no keyword, so the expression is readable
      activeSelection: () => 'sele',
    });
    controller = createInputController({
      element,
      transport: {
        input: (message) => sent.push(message),
        call: () => Promise.resolve(null),
      },
      cameraDriver: driver,
      geometry: () => ({ cssWidth: 400, cssHeight: 300, dpr: 1 }),
      // A zero budget against the REAL clock, so every move flushes in the
      // handler that produced it. A frozen `now` never expires the window and
      // the band would only move on the release.
      dragBudgetMs: 0,
    });
  });

  afterEach(() => {
    controller.destroy();
    element.remove();
  });

  function pointer(type: string, init: Record<string, unknown>): void {
    // jsdom has no `PointerEvent` constructor; the controller only reads
    // clientX/Y, button, the modifier flags and pointerId.
    const ev = new window.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      ...(init as MouseEventInit),
    });
    Object.defineProperty(ev, 'pointerId', { value: 1 });
    element.dispatchEvent(ev);
  }

  it('turns a real drag into the action the table names, not into raw input', () => {
    pointer('pointerdown', { button: 0, clientX: 100, clientY: 100 });
    pointer('pointermove', { clientX: 110, clientY: 100 });
    pointer('pointerup', { button: 0, clientX: 110, clientY: 100 });
    expect(calls).toEqual([{ fn: 'cmd.turn', args: ['y', 10] }]);
    // The raw stream still carries the button frames (the backend may want
    // them for its own state), but NOT a drag: the driver consumed it.
    expect(sent.filter((m) => m.kind === 'drag')).toEqual([]);
  });

  it('runs a whole rubber band from real events: press, drag, release, select', async () => {
    pointer('pointerdown', { button: 0, clientX: 50, clientY: 50, shiftKey: true });
    expect(driver.band).toEqual({ left: 50, top: 50, right: 50, bottom: 50 });
    pointer('pointermove', { clientX: 90, clientY: 80, shiftKey: true });
    expect(driver.band).toEqual({ left: 50, top: 50, right: 90, bottom: 80 });
    expect(calls).toEqual([]); // nothing is written mid-band
    pointer('pointerup', { button: 0, clientX: 90, clientY: 80, shiftKey: true });
    expect(driver.band).toBeNull();
    expect(calls[0]).toEqual({
      fn: 'cmd.select',
      args: ['sele', '(?sele or (zz`1))'],
    });
    expect(driver.counters.boxes).toBe(1);
  });

  it('sends the wheel to the driver instead of forwarding a dead input frame', () => {
    element.dispatchEvent(
      new window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120 }),
    );
    // Slab, because that is what `('w','none',...)` is bound to.
    expect(calls).toEqual([{ fn: 'cmd.clip', args: ['slab', 72] }]);
    expect(sent.filter((m) => m.kind === 'button')).toEqual([]);
  });

  it('does not consult the driver at all when the gate hands back undefined', () => {
    // The gate is how a normal GL backend keeps the faithful input path: the
    // viewport's getter returns `undefined` while the server rasterises.
    controller.destroy();
    const gated = createInputController({
      element,
      transport: {
        input: (message) => sent.push(message),
        call: () => Promise.resolve(null),
      },
      cameraDriver: undefined,
      geometry: () => ({ cssWidth: 400, cssHeight: 300, dpr: 1 }),
      dragBudgetMs: 0,
      now: () => 0,
    });
    sent.length = 0;
    pointer('pointerdown', { button: 0, clientX: 10, clientY: 10 });
    pointer('pointermove', { clientX: 20, clientY: 10 });
    pointer('pointerup', { button: 0, clientX: 20, clientY: 10 });
    expect(calls).toEqual([]);
    expect(sent.filter((m) => m.kind === 'drag')).toHaveLength(1);
    gated.destroy();
  });
});
