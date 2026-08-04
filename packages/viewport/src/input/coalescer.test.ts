/**
 * The drag coalescer, against a fake clock and fake timers.
 *
 * Co-located with the unit it tests because `packages/viewport/test/` is owned
 * by another work package; the vitest workspace picks up
 * `{packages}/*\/{src,test}/**\/*.test.ts` either way.
 *
 * The scenario that matters is "rAF is dead": no `requestAnimationFrame` is
 * used here at all, and the timer can be made to never fire (a background tab
 * clamps timers to ~1 Hz), which is exactly how defect D3a was reproduced.
 */

import { strict as assert } from 'node:assert';
import { describe, test } from 'vitest';

import { createDragCoalescer, type DragSample, type FlushReason } from './coalescer';

interface Harness {
  clock: { t: number };
  sent: Array<DragSample & { reason: FlushReason; at: number }>;
  timers: Array<{ due: number; run: () => void }>;
  /** Advance the clock, firing due timers. */
  advance(ms: number): void;
  /** Advance WITHOUT firing timers: a throttled/occluded tab. */
  advanceFrozen(ms: number): void;
  coalescer: ReturnType<typeof createDragCoalescer>;
}

function harness(budgetMs = 16): Harness {
  const clock = { t: 1000 };
  const sent: Array<DragSample & { reason: FlushReason; at: number }> = [];
  const timers: Array<{ due: number; run: () => void }> = [];

  const coalescer = createDragCoalescer({
    budgetMs,
    now: () => clock.t,
    flush: (sample, reason) => sent.push({ ...sample, reason, at: clock.t }),
    setTimer: (callback, ms) => {
      const entry = { due: clock.t + ms, run: callback };
      timers.push(entry);
      return entry;
    },
    clearTimer: (handle) => {
      const index = timers.indexOf(handle as { due: number; run: () => void });
      if (index >= 0) timers.splice(index, 1);
    },
  });

  return {
    clock,
    sent,
    timers,
    advance(ms: number): void {
      const target = clock.t + ms;
      for (;;) {
        const next = timers.filter((entry) => entry.due <= target).sort((a, b) => a.due - b.due)[0];
        if (next === undefined) break;
        timers.splice(timers.indexOf(next), 1);
        clock.t = Math.max(clock.t, next.due);
        next.run();
      }
      clock.t = target;
    },
    advanceFrozen(ms: number): void {
      clock.t += ms;
    },
    coalescer,
  };
}

const sample = (x: number, when: number): DragSample => ({ x, y: 0, mod: 0, when });

describe('drag coalescer', () => {
  test('a burst inside one budget window becomes ONE drag, the last position', () => {
    const h = harness(16);
    h.coalescer.begin();
    h.coalescer.push(sample(1, 100));
    h.coalescer.push(sample(2, 100.001));
    h.coalescer.push(sample(3, 100.002));
    assert.equal(h.sent.length, 0, 'nothing sent inside the window yet');
    h.advance(16);
    assert.deepEqual(
      h.sent.map((s) => s.x),
      [3],
    );
    assert.equal(h.sent[0]?.reason, 'timer');
    assert.equal(h.coalescer.stats.coalesced, 2);
  });

  test('WITH TIMERS FROZEN (rAF and setTimeout both dead) a drag still tracks', () => {
    // This is defect D3a. The old implementation flushed from
    // requestAnimationFrame; with rAF stopped it sent ZERO drags for the whole
    // gesture and one jump at pointerup. Here the flush rides the events.
    const h = harness(16);
    h.coalescer.begin();
    for (let i = 1; i <= 60; i++) {
      h.advanceFrozen(8); // a 125 Hz pointer, no timer ever fires
      h.coalescer.push(sample(i, 100 + i * 0.008));
    }
    assert.ok(h.timers.length <= 1, 'at most one trailing timer is ever armed');
    // 60 samples at 8 ms = 480 ms; at one flush per 16 ms budget that is 30.
    assert.equal(h.sent.length, 30);
    assert.ok(
      h.sent.every((s) => s.reason === 'event'),
      'every flush came from a pointer event, not a timer',
    );
    // and they are in order, with no position ever overtaking another
    const xs = h.sent.map((s) => s.x);
    assert.deepEqual(
      [...xs].sort((a, b) => a - b),
      xs,
    );
    // the gap between drags never exceeds one budget + one sample interval
    assert.ok(h.coalescer.stats.maxGapMs <= 24, `maxGapMs=${h.coalescer.stats.maxGapMs}`);
  });

  test('the FINAL position is never lost, even mid-window', () => {
    const h = harness(16);
    h.coalescer.begin();
    h.advanceFrozen(20);
    h.coalescer.push(sample(1, 100)); // flushes on the event
    h.coalescer.push(sample(2, 100.001)); // inside the new window: pending
    assert.deepEqual(
      h.sent.map((s) => s.x),
      [1],
    );
    h.coalescer.end(); // what `pointerup` does, before the button message
    assert.deepEqual(
      h.sent.map((s) => s.x),
      [1, 2],
    );
    assert.equal(h.sent[1]?.reason, 'forced');
    assert.equal(h.timers.length, 0, 'end() disarms the trailing timer');
  });

  test('`when` is carried through untouched (the backend measures with it)', () => {
    const h = harness(16);
    h.coalescer.begin();
    const when = 1_764_000_000.123456;
    h.coalescer.push({ x: 7, y: 8, mod: 3, when });
    h.advance(16);
    assert.equal(h.sent[0]?.when, when);
    assert.equal(h.sent[0]?.mod, 3);
    assert.deepEqual([h.sent[0]?.x, h.sent[0]?.y], [7, 8]);
  });

  test('at most one flush per budget window', () => {
    const h = harness(16);
    h.coalescer.begin();
    for (let i = 0; i < 100; i++) {
      h.advanceFrozen(1); // a 1000 Hz gaming mouse
      h.coalescer.push(sample(i, 100 + i * 0.001));
    }
    assert.ok(h.sent.length <= 100 / 16 + 1, `sent ${h.sent.length} in 100 ms at a 16 ms budget`);
    assert.equal(h.coalescer.stats.samples, 100);
  });

  test('begin() opens a fresh window: the first move of a gesture is coalesced', () => {
    const h = harness(16);
    h.advanceFrozen(5000); // a long idle before the press
    h.coalescer.begin();
    h.coalescer.push(sample(1, 100));
    assert.equal(h.sent.length, 0, 'the press opens the window; the move joins it');
    h.advance(16);
    assert.equal(h.sent.length, 1);
  });

  test('destroy() drops the pending sample and disarms the timer', () => {
    const h = harness(16);
    h.coalescer.begin();
    h.coalescer.push(sample(1, 100));
    h.coalescer.destroy();
    h.advance(100);
    assert.equal(h.sent.length, 0);
    assert.equal(h.timers.length, 0);
  });
});
