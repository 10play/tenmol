/**
 * The input controller against a real DOM (jsdom).
 *
 * What is asserted here is the ORDER and the SHAPE of the message stream,
 * because that is what the backend's timing measurements consume: a `button`
 * DOWN, then drags, then a `button` UP, never interleaved, never reordered, and
 * every frame carrying an event-derived `when`.
 */

import { strict as assert } from 'node:assert';
import { beforeEach, describe, test } from 'vitest';

import type { InputMessage } from '@tenmol/protocol';
import { createInputController } from '../src/input/mouse';

function pointerEvent(type: string, init: Record<string, unknown>): Event {
  // jsdom has no PointerEvent constructor; MouseEvent + pointerId is enough
  // for the controller, which only reads clientX/Y, button, modifiers, id.
  const ev = new window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    ...(init as MouseEventInit),
  });
  Object.defineProperty(ev, 'pointerId', { value: init['pointerId'] ?? 1 });
  return ev;
}

describe('input controller', () => {
  let element: HTMLElement;
  let sent: InputMessage[];

  beforeEach(() => {
    element = document.createElement('div');
    document.body.appendChild(element);
    element.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
    (element as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture =
      () => {};
    (element as unknown as { releasePointerCapture: (id: number) => void }).releasePointerCapture =
      () => {};
    sent = [];
  });

  const controllerFor = (): ReturnType<typeof createInputController> =>
    createInputController({
      element,
      transport: {
        input: (message) => {
          // `void | boolean` since wave 10: the controller reads a `false` as
          // "the socket refused this frame" (`types.ts`), and `push` returns a
          // length, which would read as "delivered" only by accident.
          sent.push(message);
        },
        call: () => Promise.resolve(null),
      },
      geometry: () => ({ cssWidth: 400, cssHeight: 300, dpr: 1 }),
    });

  test('a press/drag/release becomes button-down, drag(s), button-up IN ORDER', async () => {
    const controller = controllerFor();
    element.dispatchEvent(pointerEvent('pointerdown', { clientX: 10, clientY: 20, button: 0 }));
    element.dispatchEvent(pointerEvent('pointermove', { clientX: 30, clientY: 40 }));
    element.dispatchEvent(pointerEvent('pointermove', { clientX: 50, clientY: 60 }));
    element.dispatchEvent(pointerEvent('pointerup', { clientX: 50, clientY: 60, button: 0 }));

    assert.deepEqual(
      sent.map((m) => m.kind),
      ['button', 'drag', 'button'],
    );
    const [down, drag, up] = sent as [
      Extract<InputMessage, { kind: 'button' }>,
      Extract<InputMessage, { kind: 'drag' }>,
      Extract<InputMessage, { kind: 'button' }>,
    ];
    assert.deepEqual([down.button, down.state], [0, 0]);
    assert.deepEqual([down.x, down.y], [10, 280]); // y flipped: 300 - 20
    // The intermediate move is coalesced away; the LAST position survives, and
    // it is flushed before the button-up (dropping a position is safe,
    // reordering is not).
    assert.deepEqual([drag.x, drag.y], [50, 240]);
    assert.deepEqual([up.button, up.state], [0, 1]);
    assert.deepEqual([up.x, up.y], [50, 240]);
    controller.destroy();
  });

  test('every message carries a `when` in epoch seconds', () => {
    const controller = controllerFor();
    element.dispatchEvent(pointerEvent('pointerdown', { clientX: 1, clientY: 1, button: 0 }));
    element.dispatchEvent(pointerEvent('pointerup', { clientX: 1, clientY: 1, button: 0 }));
    const nowSeconds = Date.now() / 1000;
    for (const message of sent) {
      assert.ok('when' in message);
      const when = (message as { when: number }).when;
      assert.ok(Math.abs(when - nowSeconds) < 5, `when=${when}`);
    }
    controller.destroy();
  });

  test('modifiers use the cOrtho bitmask, with meta folded onto ctrl', () => {
    const controller = controllerFor();
    element.dispatchEvent(
      pointerEvent('pointerdown', { clientX: 1, clientY: 1, button: 2, shiftKey: true }),
    );
    element.dispatchEvent(pointerEvent('pointerup', { clientX: 1, clientY: 1, button: 2 }));
    element.dispatchEvent(
      pointerEvent('pointerdown', { clientX: 1, clientY: 1, button: 1, metaKey: true }),
    );
    const mods = sent.map((m) => (m as { mod: number }).mod);
    assert.equal(mods[0], 1); // SHIFT
    assert.equal(mods[2], 2); // meta -> CTRL (keymapping.py:52)
    assert.equal((sent[0] as { button: number }).button, 2); // right
    assert.equal((sent[2] as { button: number }).button, 1); // middle
    controller.destroy();
  });

  test('a second button while one is held is ignored (PyMOL has one ActiveButton)', () => {
    const controller = controllerFor();
    element.dispatchEvent(pointerEvent('pointerdown', { clientX: 1, clientY: 1, button: 0 }));
    element.dispatchEvent(pointerEvent('pointerdown', { clientX: 1, clientY: 1, button: 2 }));
    assert.equal(sent.length, 1);
    controller.destroy();
  });

  test('wheel is a DOWN/UP pair on button 3 or 4, and is suppressed while dragging', () => {
    const controller = controllerFor();
    element.dispatchEvent(new window.WheelEvent('wheel', { deltaY: -120, bubbles: true }));
    assert.deepEqual(
      sent.map((m) => [(m as { button: number }).button, (m as { state: number }).state]),
      [
        [3, 0],
        [3, 1],
      ],
    );
    sent.length = 0;
    element.dispatchEvent(new window.WheelEvent('wheel', { deltaY: 120, bubbles: true }));
    assert.deepEqual(
      sent.map((m) => (m as { button: number }).button),
      [4, 4],
    );

    // OrthoButton ignores the wheel while a real button is held
    // (packages/engine/layer1/Ortho.cpp:2503-2510) -- do not even send it.
    sent.length = 0;
    element.dispatchEvent(pointerEvent('pointerdown', { clientX: 1, clientY: 1, button: 0 }));
    sent.length = 0;
    element.dispatchEvent(new window.WheelEvent('wheel', { deltaY: -120, bubbles: true }));
    assert.equal(sent.length, 0);
    controller.destroy();
  });

  test('cancel() releases a held button so the backend never sticks in a drag', () => {
    const controller = controllerFor();
    element.dispatchEvent(pointerEvent('pointerdown', { clientX: 1, clientY: 1, button: 0 }));
    sent.length = 0;
    controller.cancel();
    assert.equal(sent.length, 1);
    assert.equal((sent[0] as { state: number }).state, 1);
    controller.destroy();
  });

  test('destroy() removes every listener', () => {
    const controller = controllerFor();
    controller.destroy();
    element.dispatchEvent(pointerEvent('pointerdown', { clientX: 1, clientY: 1, button: 0 }));
    element.dispatchEvent(new window.WheelEvent('wheel', { deltaY: -120, bubbles: true }));
    assert.equal(sent.length, 0);
  });
});
