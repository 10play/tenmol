/**
 * Parity row 165 — the deferred/ordered input queue, CLIENT SIDE.
 *
 * The row asks for two things and offers a third: the transport must be
 * "strictly ordered and lossless — a single WebSocket for input, never parallel
 * channels", and OPTIONALLY a client timestamp so the bridge can supply
 * `SceneClick`'s `when`. Waves 8 and 9 measured the ordering over the real
 * socket (`bridge/tests/test_p8_a34.py`: 64 of 64 ascending on one socket,
 * reordered across two) and reported the optional half unreachable — `Cmd_Button`
 * parses exactly "Oiiiii" (`layer4/Cmd.cpp:3631`) and `PyMOL_Button` has no
 * timestamp parameter (`layer5/PyMOL.h:265`), so PyMOL stamps arrival itself.
 *
 * What was never asserted is the half that lives here: that this side emits ONE
 * ordered stream through ONE sink and loses nothing — and it turns out it did
 * lose something. `sendInput` returns false and DROPS while the socket is not
 * open (`packages/client/src/connection.ts:327-331`) and nobody read that
 * return, so a connection that blinked under a press delivered the drags and
 * the RELEASE of a gesture whose press PyMOL never saw. That is now an
 * abandoned gesture with a counter, and it is the last test below.
 */

import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, describe, test } from 'vitest';

import type { InputMessage } from '@tenmol/protocol';
import { ButtonState, MouseButton } from '@tenmol/protocol';

import { createInputController } from './mouse';

function pointerEvent(type: string, init: Record<string, unknown>): Event {
  const ev = new window.MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(ev, 'pointerId', { value: init['pointerId'] ?? 1 });
  return ev;
}

describe('the input queue is one ordered, lossless channel', () => {
  let element: HTMLElement;
  let sent: InputMessage[];
  let clock = 0;
  let accept: (message: InputMessage) => boolean;
  let connected: boolean;
  const timers: Array<{ due: number; run: () => void }> = [];

  beforeEach(() => {
    element = document.createElement('div');
    document.body.appendChild(element);
    element.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
    (element as unknown as { setPointerCapture(id: number): void }).setPointerCapture = () => {};
    (element as unknown as { releasePointerCapture(id: number): void }).releasePointerCapture =
      () => {};
    sent = [];
    clock = 10_000;
    timers.length = 0;
    connected = true;
    accept = () => true;
  });

  afterEach(() => {
    element.remove();
  });

  const controllerFor = (): ReturnType<typeof createInputController> =>
    createInputController({
      element,
      transport: {
        input: (message) => {
          if (!accept(message)) return false;
          sent.push(message);
          return true;
        },
        call: () => Promise.resolve(null),
        isConnected: () => connected,
      },
      geometry: () => ({ cssWidth: 400, cssHeight: 300, dpr: 1 }),
      dragBudgetMs: 16,
      now: () => clock,
      setTimer: (callback, ms) => {
        const entry = { due: clock + ms, run: callback };
        timers.push(entry);
        return entry;
      },
      clearTimer: (handle) => {
        const index = timers.indexOf(handle as { due: number; run: () => void });
        if (index >= 0) timers.splice(index, 1);
      },
    });

  test('64 press/release pairs cross in submission order, none lost', () => {
    const controller = controllerFor();
    for (let i = 0; i < 64; i++) {
      clock += 20;
      element.dispatchEvent(pointerEvent('pointerdown', { clientX: i, clientY: 0, button: 0 }));
      element.dispatchEvent(pointerEvent('pointerup', { clientX: i, clientY: 0, button: 0 }));
    }
    // The bridge-side counterpart of this is test_p8_a34.py, which measured the
    // same 64 frames arriving complete and ascending on ONE socket and
    // REORDERED across two. This is the half that produces them.
    assert.equal(sent.length, 128, `expected 128 frames, got ${sent.length}`);
    const xs = sent.map((m) => (m as { x: number }).x);
    assert.deepEqual(
      xs,
      Array.from({ length: 64 }, (_, i) => [i, i]).flat(),
      'input frames were reordered or lost',
    );
    const states = sent.map((m) => (m as { state: number }).state);
    for (let i = 0; i < states.length; i += 2) {
      assert.equal(states[i], ButtonState.Down);
      assert.equal(states[i + 1], ButtonState.Up);
    }
    assert.equal(controller.stats.dropped, 0);
    controller.destroy();
  });

  test('nothing overtakes a pending drag position, and wheel is suppressed mid-gesture', () => {
    const controller = controllerFor();
    element.dispatchEvent(pointerEvent('pointerdown', { clientX: 0, clientY: 0, button: 0 }));
    clock += 20;
    element.dispatchEvent(pointerEvent('pointermove', { clientX: 5, clientY: 0 })); // flushed
    element.dispatchEvent(pointerEvent('pointermove', { clientX: 9, clientY: 0 })); // pending
    // `OrthoButton` ignores the wheel entirely while a real button is held
    // (`layer1/Ortho.cpp:2503-2510`), so this must produce NO frame at all —
    // and it must not disturb the pending position either.
    element.dispatchEvent(pointerEvent('wheel', { clientX: 9, clientY: 0, deltaY: -120 }));
    element.dispatchEvent(pointerEvent('pointerup', { clientX: 9, clientY: 0, button: 0 }));

    const shape = sent.map((m) =>
      m.kind === 'drag' ? `drag${(m as { x: number }).x}` : `button${(m as { x: number }).x}`,
    );
    assert.deepEqual(shape, [
      'button0', // press
      'drag5', // first budget window
      'drag9', // flushed by the release barrier, BEFORE it
      'button9', // release
    ]);
    controller.destroy();
  });

  test('`when` is the ORIGINATING event time and is never rewritten', () => {
    const controller = controllerFor();
    element.dispatchEvent(pointerEvent('pointerdown', { clientX: 0, clientY: 0, button: 0 }));
    clock += 20;
    element.dispatchEvent(pointerEvent('pointermove', { clientX: 5, clientY: 0 }));
    element.dispatchEvent(pointerEvent('pointerup', { clientX: 5, clientY: 0, button: 0 }));

    const whens = sent.map((m) => (m as { when: number }).when);
    // Every frame carries one, it is in epoch SECONDS (the unit `UtilGetSeconds`
    // produces), and the sequence never goes backwards.
    for (const when of whens) {
      assert.equal(typeof when, 'number');
      assert.ok(when > 1_000_000_000, `not epoch seconds: ${when}`);
    }
    for (let i = 1; i < whens.length; i++) {
      assert.ok((whens[i] ?? 0) >= (whens[i - 1] ?? 0), '`when` went backwards');
    }
    controller.destroy();
  });

  test('a gesture whose PRESS the socket refused is abandoned, not half-sent', () => {
    const controller = controllerFor();
    // The socket goes down exactly under the press — the one case where the
    // client used to deliver a drag and a release with no press behind them.
    connected = false;
    element.dispatchEvent(pointerEvent('pointerdown', { clientX: 0, clientY: 0, button: 0 }));
    connected = true;
    clock += 20;
    element.dispatchEvent(pointerEvent('pointermove', { clientX: 40, clientY: 0 }));
    element.dispatchEvent(pointerEvent('pointerup', { clientX: 40, clientY: 0, button: 0 }));

    assert.equal(sent.length, 0, 'a half gesture reached the engine');
    assert.equal(controller.stats.brokenGestures, 1);
    // press + drag + release = 3 frames accounted for, none silently vanished.
    assert.equal(controller.stats.dropped, 3);

    // ... and the NEXT gesture is clean.
    clock += 20;
    element.dispatchEvent(pointerEvent('pointerdown', { clientX: 7, clientY: 0, button: 0 }));
    element.dispatchEvent(pointerEvent('pointerup', { clientX: 7, clientY: 0, button: 0 }));
    assert.deepEqual(
      sent.map((m) => [m.kind, (m as { state: number }).state]),
      [
        ['button', ButtonState.Down],
        ['button', ButtonState.Up],
      ],
    );
    assert.equal(controller.stats.brokenGestures, 1);
    controller.destroy();
  });

  test('a transport that answers false is believed even while isConnected lies', () => {
    const controller = controllerFor();
    accept = (message) =>
      !(message.kind === 'button' && (message as { state: number }).state === ButtonState.Down);
    element.dispatchEvent(pointerEvent('pointerdown', { clientX: 0, clientY: 0, button: 0 }));
    clock += 20;
    element.dispatchEvent(pointerEvent('pointermove', { clientX: 40, clientY: 0 }));
    element.dispatchEvent(pointerEvent('pointerup', { clientX: 40, clientY: 0, button: 0 }));
    assert.equal(sent.length, 0);
    assert.equal(controller.stats.brokenGestures, 1);
    controller.destroy();
  });

  test('a lost RELEASE does not poison the next gesture', () => {
    const controller = controllerFor();
    element.dispatchEvent(pointerEvent('pointerdown', { clientX: 0, clientY: 0, button: 0 }));
    connected = false;
    element.dispatchEvent(pointerEvent('pointerup', { clientX: 0, clientY: 0, button: 0 }));
    connected = true;
    element.dispatchEvent(pointerEvent('pointerdown', { clientX: 3, clientY: 0, button: 0 }));
    element.dispatchEvent(pointerEvent('pointerup', { clientX: 3, clientY: 0, button: 0 }));

    assert.deepEqual(
      sent.map((m) => [(m as { x: number }).x, (m as { state: number }).state]),
      [
        [0, ButtonState.Down],
        [3, ButtonState.Down],
        [3, ButtonState.Up],
      ],
    );
    assert.equal(controller.stats.dropped, 1);
    assert.equal(controller.stats.brokenGestures, 0);
    controller.destroy();
  });

  test('every frame is a button or a drag — there is no second channel', () => {
    const controller = controllerFor();
    element.dispatchEvent(pointerEvent('pointerdown', { clientX: 0, clientY: 0, button: 0 }));
    clock += 20;
    element.dispatchEvent(pointerEvent('pointermove', { clientX: 5, clientY: 0 }));
    element.dispatchEvent(pointerEvent('pointerup', { clientX: 5, clientY: 0, button: 0 }));
    // With no button held the wheel IS forwarded: two button frames with the
    // same coordinates, exactly as `PyMOLGLWidget.wheelEvent` sends them.
    element.dispatchEvent(pointerEvent('wheel', { clientX: 5, clientY: 0, deltaY: 120 }));

    assert.ok(sent.every((m) => m.t === 'input'));
    assert.ok(sent.every((m) => ['button', 'drag'].includes(m.kind)));
    const wheels = sent.filter(
      (m) => m.kind === 'button' && (m as { button: number }).button >= MouseButton.ScrollForward,
    );
    assert.equal(wheels.length, 2);
    assert.equal((wheels[0] as { state: number }).state, ButtonState.Down);
    assert.equal((wheels[1] as { state: number }).state, ButtonState.Up);
    controller.destroy();
  });
});
