/**
 * Input forwarding: the coordinate transform and the message stream.
 *
 * The controller itself needs a DOM, so it lives in `input.dom.test.ts`; this
 * file is the pure half — and the pure half is where the two bugs that cost the
 * most time live: the Y flip and the truncation.
 */

import { strict as assert } from 'node:assert';
import { describe, test } from 'vitest';

import { toPymolPoint, whenOf } from '../src/input/coords';

const rect = { left: 100, top: 50 };

describe('input coordinates', () => {
  test('origin is bottom-left, and the flip happens before the dpr multiply', () => {
    // pymol_gl_widget.py:169-176 -- int(fb_scale * (height - y)), NOT
    // int(fb_scale * height - fb_scale * y) rounded independently.
    const geom = { cssWidth: 800, cssHeight: 600, dpr: 2 };
    const p = toPymolPoint({ clientX: 100 + 10, clientY: 50 + 20 }, rect, geom);
    assert.deepEqual(p, { x: 20, y: (600 - 20) * 2 });
  });

  test('top of the canvas maps to the TOP of PyMOL window space', () => {
    const geom = { cssWidth: 800, cssHeight: 600, dpr: 1 };
    assert.equal(toPymolPoint({ clientX: 100, clientY: 50 }, rect, geom).y, 600);
    assert.equal(toPymolPoint({ clientX: 100, clientY: 50 + 600 }, rect, geom).y, 0);
  });

  test('fractional dpr truncates exactly as int() does', () => {
    const geom = { cssWidth: 800, cssHeight: 601, dpr: 1.5 };
    // x: 1.5 * 7 = 10.5 -> 10 ; y: 1.5 * (601 - 3) = 897.0 -> 897
    const p = toPymolPoint({ clientX: 107, clientY: 53 }, rect, geom);
    assert.deepEqual(p, { x: 10, y: 897 });
    // and never rounds up, which would land on the neighbouring pixel row
    const q = toPymolPoint({ clientX: 100 + 7.99, clientY: 50 + 0.99 }, rect, geom);
    assert.equal(q.x, 11);
    assert.equal(q.y, Math.trunc(1.5 * (601 - 0.99)));
  });

  test('coordinates are relative to the canvas rect, not the page', () => {
    const geom = { cssWidth: 800, cssHeight: 600, dpr: 1 };
    const a = toPymolPoint({ clientX: 100, clientY: 50 }, { left: 100, top: 50 }, geom);
    const b = toPymolPoint({ clientX: 300, clientY: 250 }, { left: 300, top: 250 }, geom);
    assert.deepEqual(a, b);
  });

  test('when is derived from the event timestamp, in epoch SECONDS', () => {
    // A browser `timeStamp` is ms since performance.timeOrigin.
    const relative = Date.now() - performance.timeOrigin;
    const when = whenOf({ timeStamp: relative });
    const expected = (performance.timeOrigin + relative) / 1000;
    assert.ok(Math.abs(when - expected) < 1e-6, `${when} vs ${expected}`);
    // An ALREADY-ABSOLUTE timestamp (jsdom, synthetic events) is not shifted
    // 50 years into the future.
    assert.ok(Math.abs(whenOf({ timeStamp: Date.now() }) - Date.now() / 1000) < 2);
    // A synthetic event with no usable timestamp still gets a sane value.
    const fallback = whenOf({});
    assert.ok(Math.abs(fallback - Date.now() / 1000) < 2);
  });
});
