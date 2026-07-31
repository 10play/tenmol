/**
 * The input controller with `requestAnimationFrame` DELETED (defect D3a).
 *
 * `packages/viewport/test/input.dom.test.ts` covers order and shape; this file
 * covers the one property that regressed: the drag stream must not depend on
 * the page being presented. Every rAF entry point is removed from the global
 * before the controller is built, so a single reference to it fails the suite.
 */

import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, describe, test } from 'vitest';

import type { InputMessage } from '@tenmol/protocol';

import { createInputController } from './mouse';

function pointerEvent(type: string, init: Record<string, unknown>): Event {
  const ev = new window.MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(ev, 'pointerId', { value: init['pointerId'] ?? 1 });
  return ev;
}

describe('input controller without requestAnimationFrame', () => {
  let element: HTMLElement;
  let sent: InputMessage[];
  let raf: unknown;
  let caf: unknown;
  let clock = 0;
  const timers: Array<{ due: number; run: () => void }> = [];

  beforeEach(() => {
    raf = globalThis.requestAnimationFrame;
    caf = globalThis.cancelAnimationFrame;
    // A hidden/occluded tab: rAF never fires. Deleting it entirely is stricter
    // and catches any future re-coupling at import time.
    delete (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;
    delete (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame;

    element = document.createElement('div');
    document.body.appendChild(element);
    element.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
    (element as unknown as { setPointerCapture(id: number): void }).setPointerCapture = () => {};
    (element as unknown as { releasePointerCapture(id: number): void }).releasePointerCapture =
      () => {};
    sent = [];
    clock = 10_000;
    timers.length = 0;
  });

  afterEach(() => {
    (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = raf;
    (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = caf;
    element.remove();
  });

  const controllerFor = (): ReturnType<typeof createInputController> =>
    createInputController({
      element,
      transport: {
        input: (message) => sent.push(message),
        call: () => Promise.resolve(null),
      },
      geometry: () => ({ cssWidth: 400, cssHeight: 300, dpr: 1 }),
      dragBudgetMs: 16,
      now: () => clock,
      // Timers that NEVER fire: a background tab clamps them, and the point is
      // that tracking must not depend on them either.
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

  test('a 480 ms drag arrives as ~30 drags, not as one jump at pointerup', () => {
    const controller = controllerFor();
    element.dispatchEvent(pointerEvent('pointerdown', { clientX: 0, clientY: 0, button: 0 }));
    for (let i = 1; i <= 60; i++) {
      clock += 8;
      element.dispatchEvent(pointerEvent('pointermove', { clientX: i, clientY: 0 }));
    }
    const dragsBeforeUp = sent.filter((m) => m.kind === 'drag').length;
    clock += 8;
    element.dispatchEvent(pointerEvent('pointerup', { clientX: 60, clientY: 0, button: 0 }));

    assert.equal(dragsBeforeUp, 30, `drags DURING the gesture: ${dragsBeforeUp}`);
    // Order: exactly one button at each end, drags strictly between them.
    assert.equal(sent[0]?.kind, 'button');
    assert.equal(sent[sent.length - 1]?.kind, 'button');
    assert.ok(sent.slice(1, -1).every((m) => m.kind === 'drag'));
    // Monotonic positions and monotonic `when`: nothing was reordered.
    const drags = sent.filter((m) => m.kind === 'drag') as Array<
      Extract<InputMessage, { kind: 'drag' }>
    >;
    for (let i = 1; i < drags.length; i++) {
      assert.ok((drags[i]?.x ?? 0) > (drags[i - 1]?.x ?? 0), 'positions out of order');
      assert.ok((drags[i]?.when ?? 0) >= (drags[i - 1]?.when ?? 0), '`when` out of order');
    }
    // The final position is the one under the cursor at release.
    const up = sent[sent.length - 1] as Extract<InputMessage, { kind: 'button' }>;
    assert.equal(up.x, 60);
    controller.destroy();
  });

  test('the resting position is flushed before the button-up, never after', () => {
    const controller = controllerFor();
    element.dispatchEvent(pointerEvent('pointerdown', { clientX: 0, clientY: 0, button: 0 }));
    clock += 20;
    element.dispatchEvent(pointerEvent('pointermove', { clientX: 5, clientY: 0 })); // flushed
    element.dispatchEvent(pointerEvent('pointermove', { clientX: 9, clientY: 0 })); // pending
    element.dispatchEvent(pointerEvent('pointerup', { clientX: 9, clientY: 0, button: 0 }));

    assert.deepEqual(
      sent.map((m) => m.kind),
      ['button', 'drag', 'drag', 'button'],
    );
    assert.equal((sent[2] as Extract<InputMessage, { kind: 'drag' }>).x, 9);
    assert.equal(controller.stats.dragForcedFlushes, 1);
    controller.destroy();
  });

  test('cancel() releases at the LAST position, never at the origin', () => {
    // `SceneButton` measures the release against the press to tell a click from
    // a drag (4 px / 10 px). A synthetic up at (0, 0) after a 3 px move would
    // be read as a 400 px drag and swallow the click entirely.
    const controller = controllerFor();
    element.dispatchEvent(pointerEvent('pointerdown', { clientX: 200, clientY: 150, button: 0 }));
    clock += 20;
    element.dispatchEvent(pointerEvent('pointermove', { clientX: 203, clientY: 150 }));
    controller.cancel(); // lostpointercapture / blur / unmount

    const up = sent[sent.length - 1] as Extract<InputMessage, { kind: 'button' }>;
    assert.equal(up.kind, 'button');
    assert.equal(up.state, 1);
    // 203 px from the left, and 300 - 150 = 150 px up from the bottom.
    assert.deepEqual([up.x, up.y], [203, 150]);
    const down = sent[0] as Extract<InputMessage, { kind: 'button' }>;
    assert.ok(Math.abs(up.x - down.x) <= 4, 'still inside the click threshold');
    controller.destroy();
  });

  test('a stalled pointer leaves at most one sample pending, and cancel() sends it', () => {
    const controller = controllerFor();
    element.dispatchEvent(pointerEvent('pointerdown', { clientX: 0, clientY: 0, button: 0 }));
    element.dispatchEvent(pointerEvent('pointermove', { clientX: 3, clientY: 0 }));
    controller.cancel(); // what `lostpointercapture` does
    const kinds = sent.map((m) => m.kind);
    assert.deepEqual(kinds, ['button', 'drag', 'button']);
    assert.equal((sent[2] as Extract<InputMessage, { kind: 'button' }>).state, 1);
    controller.destroy();
  });
});
