/**
 * Row 160 — framebuffer scale / `display_scale_factor` propagation.
 *
 * The row: "on DPR/screen change, `fb_scale = devicePixelRatio` and
 * `cmd.set('display_scale_factor', int(fb_scale))`, which drives
 * `_gScaleFactor` and `DIP2PIXEL()`, sizing every internal-GUI hit rectangle,
 * and triggers `OrthoCommandIn(G,'viewport')`"
 * (`packages/engine/modules/pmg_qt/pymol_gl_widget.py:216-225`, C
 * `packages/engine/layer1/Setting.cpp:2946-2958`). Backend contract:
 * "`cmd.set('display_scale_factor', int)` — must be a positive integer or C
 * forces 1".
 *
 * WHY THIS FILE EXISTS. The row's only citation was
 * `packages/viewport/test/input.test.ts`, which is the coordinate transform and
 * never mentions `display_scale_factor`. Measured while auditing the citation:
 * replacing `const scale = Math.max(1, Math.round(size.dpr))` in
 * `packages/viewport/src/resize.ts` with `const scale = 0` — a value
 * `Setting.cpp:2951` clamps back to 1, i.e. a silent loss of every hi-dpi hit
 * rectangle — left the whole 1,906-test web suite green. Nothing anywhere
 * checked the propagation this row is about.
 *
 * Three properties are asserted, and each one is a real failure mode:
 *
 *  1. THE ORDER. `display_scale_factor` runs `OrthoCommandIn(G, "viewport")`,
 *     which re-lays-out against `G->Option->winX/winY`; sending it BEFORE the
 *     reshape lays out against the old size (`resize.ts:112`).
 *  2. THE ROUNDING. The setting is an INT (`SettingInfo.h`), so a 1.5 dpr must
 *     arrive as 2, and it is floored at 1 — the C forces 1 for anything <= 0,
 *     so a 0 would be accepted, ignored, and never retried.
 *  3. THE RE-SEND. It is skipped when the integer has not changed (the common
 *     case: a window drag at constant dpr) and forced on `sync(true)`, which is
 *     what a socket reconnect does.
 */

import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, describe, test } from 'vitest';

import type { InputMessage } from '@tenmol/protocol';

import { createResizeNegotiator } from '../resize';

interface Call {
  fn: string;
  args: readonly unknown[];
}

let host: HTMLElement;
let inputs: InputMessage[];
let calls: Call[];
/** One ordered tape, so the reshape/set ORDER is observable at all. */
let tape: string[];
let originalDpr: number | undefined;

function setDpr(value: number): void {
  Object.defineProperty(globalThis, 'devicePixelRatio', {
    configurable: true,
    value,
  });
}

function negotiator(options: { maxDpr?: number } = {}): ReturnType<typeof createResizeNegotiator> {
  return createResizeNegotiator({
    host,
    transport: {
      input: (message: InputMessage) => {
        inputs.push(message);
        tape.push(`input:${message.kind}`);
      },
      call: (fn: string, args: readonly unknown[] = []) => {
        calls.push({ fn, args });
        tape.push(`call:${fn}`);
        return Promise.resolve(null);
      },
    } as unknown as Parameters<typeof createResizeNegotiator>[0]['transport'],
    debounceMs: 0,
    ...options,
  });
}

beforeEach(() => {
  originalDpr = (globalThis as { devicePixelRatio?: number }).devicePixelRatio;
  inputs = [];
  calls = [];
  tape = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  host.getBoundingClientRect = () => ({ width: 800, height: 600 }) as DOMRect;
  setDpr(1);
});

afterEach(() => {
  if (originalDpr === undefined) {
    delete (globalThis as { devicePixelRatio?: number }).devicePixelRatio;
  } else {
    setDpr(originalDpr);
  }
  host.remove();
});

describe('display_scale_factor propagation (row 160)', () => {
  test('the reshape carries DEVICE pixels and the scale follows it, never precedes it', () => {
    setDpr(2);
    const resizer = negotiator();
    resizer.sync(true);

    // `_cmd._reshape` wants device pixels: 800x600 CSS at dpr 2 is 1600x1200.
    const reshape = inputs.find((m) => m.kind === 'reshape') as Extract<
      InputMessage,
      { kind: 'reshape' }
    >;
    assert.ok(reshape, 'no reshape frame');
    assert.deepEqual([reshape.width, reshape.height], [1600, 1200]);

    // ORDER: reshape first, then the setting that re-lays-out against it.
    assert.deepEqual(tape.slice(0, 2), ['input:reshape', 'call:set']);
    assert.deepEqual(calls[0], { fn: 'set', args: ['display_scale_factor', 2] });

    resizer.destroy();
  });

  test('the scale is a POSITIVE INTEGER, because the C forces 1 otherwise', () => {
    // `SettingSet_i` / `_gScaleFactor` (`Setting.cpp:2946-2958`): a value that
    // is not >= 1 is replaced by 1, so a fractional or zero scale is not an
    // approximation, it is a silent reset to no scaling at all.
    for (const [dpr, expected] of [
      [1, 1],
      [1.25, 1],
      [1.5, 2],
      [2, 2],
      [3, 3],
    ] as const) {
      inputs = [];
      calls = [];
      setDpr(dpr);
      const resizer = negotiator({ maxDpr: 4 });
      resizer.sync(true);
      const scale = calls[0]?.args[1];
      assert.equal(scale, expected, `dpr ${dpr}`);
      assert.ok(Number.isInteger(scale), `dpr ${dpr} produced ${String(scale)}`);
      assert.ok((scale as number) >= 1, `dpr ${dpr} produced ${String(scale)}`);
      resizer.destroy();
    }
  });

  test('the clamp applies to the scale as well as to the framebuffer', () => {
    // maxDpr exists so a 4x screen does not ask for a 16x framebuffer; the
    // setting has to agree with the size that was actually sent, or the
    // internal-GUI rectangles are scaled for a framebuffer nobody allocated.
    setDpr(4);
    const resizer = negotiator({ maxDpr: 2 });
    resizer.sync(true);
    const reshape = inputs[0] as Extract<InputMessage, { kind: 'reshape' }>;
    assert.deepEqual([reshape.width, reshape.height], [1600, 1200]);
    assert.deepEqual(calls[0], { fn: 'set', args: ['display_scale_factor', 2] });
    resizer.destroy();
  });

  test('an unchanged scale is not re-sent, but a forced sync re-sends it', () => {
    setDpr(2);
    const resizer = negotiator();
    resizer.sync(true);
    assert.equal(calls.length, 1);

    // A window drag: the size changes, the dpr does not. One reshape, no
    // second `set` — `OrthoCommandIn(G,'viewport')` is not free.
    host.getBoundingClientRect = () => ({ width: 640, height: 480 }) as DOMRect;
    resizer.sync(false);
    assert.equal(inputs.length, 2, 'the size change must still reshape');
    assert.equal(calls.length, 1, 'display_scale_factor was re-sent for nothing');

    // A reconnect: force everything back onto a fresh engine.
    resizer.sync(true);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1], { fn: 'set', args: ['display_scale_factor', 2] });
    resizer.destroy();
  });

  test('a dpr change re-sends the scale even when the CSS box did not move', () => {
    // Dragging the window to a second screen: same layout, different backing
    // store. Without this the hit rectangles keep the old screen's scaling.
    setDpr(1);
    const resizer = negotiator();
    resizer.sync(true);
    assert.deepEqual(calls[0], { fn: 'set', args: ['display_scale_factor', 1] });

    setDpr(2);
    resizer.sync(false);
    assert.equal(calls.length, 2, 'the scale did not follow the dpr');
    assert.deepEqual(calls[1], { fn: 'set', args: ['display_scale_factor', 2] });
    // and the framebuffer doubled with it
    const last = inputs[inputs.length - 1] as Extract<InputMessage, { kind: 'reshape' }>;
    assert.deepEqual([last.width, last.height], [1600, 1200]);
    resizer.destroy();
  });
});
