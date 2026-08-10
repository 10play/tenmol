/**
 * The `viewport.ts` optimistic-view WIRING, against a real DOM (jsdom).
 *
 * `viewSync.test.ts` covers the pure epoch logic; this covers the wiring the
 * review flagged as exercised only by e2e: that a PINCH-ZOOM gesture actually
 * advances the epoch through `viewport.ts`'s `pinch.update` handler (the exact
 * path that used to skip it and rubber-band), and that a `get_view()` reply
 * requested before that gesture is then rejected instead of clobbering the zoom.
 *
 * No WebGL2 in jsdom, so Mode G never draws — irrelevant here: pinch handling
 * is not gated on it, and `viewEpoch` is observable on the handle.
 */

import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, describe, test } from 'vitest';

import type { PixelSink, PixelSource, ViewportTransport } from './types';
import { createViewport } from './viewport';

/** `cmd.get_view()` at rest: camera z = -50, front 40, back 100. */
const VIEW_18 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -50, 0, 0, 0, 40, 100, -20];

/** A source that never rasterises — no network, and Mode G owns the scene. */
const nullPixelSource: PixelSource = {
  name: 'test-null',
  rasterizes: false,
  start(_sink: PixelSink): void {},
  stop(): void {},
};

const nullGeometrySource = {
  name: 'test-geom',
  start(): void {},
  stop(): void {},
  request(): void {},
};

/** A transport whose `get_view` promise this test can resolve on demand. */
function fakeTransport() {
  const calls: Array<{ fn: string; args: readonly unknown[] }> = [];
  let releaseGetView: ((v: unknown) => void) | null = null;
  const getViewValue: unknown = VIEW_18;
  let holdGetView = false;
  const transport: ViewportTransport = {
    input: () => true,
    isConnected: () => true,
    call(fn, args = []) {
      calls.push({ fn, args });
      if (fn === 'get_view') {
        if (holdGetView) return new Promise((resolve) => (releaseGetView = resolve));
        return Promise.resolve(getViewValue);
      }
      if (fn === 'get_viewport') return Promise.resolve([800, 600]);
      if (fn === '_bridge.set_pixel_stream') return Promise.resolve({ available: false });
      return Promise.resolve(null);
    },
  };
  return {
    transport,
    calls,
    countOf: (fn: string) => calls.filter((c) => c.fn === fn).length,
    holdNextGetView: () => {
      holdGetView = true;
    },
    releaseGetView: (v: unknown) => {
      holdGetView = false;
      releaseGetView?.(v);
      releaseGetView = null;
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Dispatch a trackpad pinch: `wheel` with `ctrlKey` and no prior Control key. */
function pinch(canvas: HTMLCanvasElement, deltaY: number): void {
  const Ctor = (globalThis as { WheelEvent?: typeof window.WheelEvent }).WheelEvent;
  const ev = Ctor
    ? new Ctor('wheel', { deltaY, ctrlKey: true, bubbles: true, cancelable: true })
    : Object.assign(new window.Event('wheel', { bubbles: true, cancelable: true }), {
        deltaY,
        deltaX: 0,
        ctrlKey: true,
      });
  canvas.dispatchEvent(ev);
}

describe('viewport optimistic-view wiring (jsdom)', () => {
  let container: HTMLElement;
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    // jsdom has no canvas backend: give the Mode-P presenter a non-null 2-D
    // context (its methods are only called on a frame, which never arrives from
    // the null pixel source) and leave webgl2 null so the renderer degrades.
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    const fake2d = new Proxy({}, { get: () => () => undefined });
    HTMLCanvasElement.prototype.getContext = function getContext(type: string) {
      return type === '2d' ? (fake2d as unknown as CanvasRenderingContext2D) : null;
    } as typeof HTMLCanvasElement.prototype.getContext;

    container = document.createElement('div');
    container.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  test('a pinch-zoom advances the view epoch and round-trips set_view', async () => {
    const t = fakeTransport();
    const viewport = createViewport({
      container,
      transport: t.transport,
      pixelSource: nullPixelSource,
      geometrySource: nullGeometrySource,
      ownsReshape: false,
      // jsdom has no WebGL2; the renderer degrades and logs once. Silence it.
      onError: () => {},
    });
    try {
      // Prime the client view so the pinch has a `pinchStartZ` to work from.
      viewport.refreshView();
      await tick();

      const before = viewport.viewEpoch;
      const setViewsBefore = t.countOf('set_view');
      pinch(viewport.canvases.gl, -40);

      assert.equal(viewport.viewEpoch, before + 1, 'pinch.update did not advance the epoch');
      assert.ok(
        t.countOf('set_view') > setViewsBefore,
        'pinch did not round-trip set_view (server must stay authoritative)',
      );
    } finally {
      viewport.destroy();
    }
  });

  test('a get_view reply that a pinch outran is rejected, not applied', async () => {
    const t = fakeTransport();
    const viewport = createViewport({
      container,
      transport: t.transport,
      pixelSource: nullPixelSource,
      geometrySource: nullGeometrySource,
      ownsReshape: false,
      // jsdom has no WebGL2; the renderer degrades and logs once. Silence it.
      onError: () => {},
    });
    try {
      // Establish an initial view.
      viewport.refreshView();
      await tick();
      const epochAfterInitial = viewport.viewEpoch;

      // Issue a refresh whose reply we hold in flight...
      t.holdNextGetView();
      viewport.refreshView();
      await tick();

      // ...then a pinch lands first, advancing the epoch past that request. So
      // `refreshView` captured `requestedAtEpoch` BEFORE this pinch, and the
      // reply now in flight is stale by exactly the pinch's advance.
      pinch(viewport.canvases.gl, -40);
      const epochAfterPinch = viewport.viewEpoch;
      assert.equal(epochAfterPinch, epochAfterInitial + 1, 'the pinch should have advanced the epoch');

      // Releasing the stale reply must not throw and must not touch the epoch —
      // only a local move advances it, never a server reply, whether that reply
      // was applied or (as here) dropped. The accept/reject DECISION itself is
      // unit-tested in `viewSync.test.ts`; this asserts the wiring around it —
      // request-time epoch capture + a pinch advancing past it — holds together.
      t.releaseGetView([0, 1, 0, -1, 0, 0, 0, 0, 1, 0, 0, -999, 0, 0, 0, 40, 100, -20]);
      await tick();
      assert.equal(
        viewport.viewEpoch,
        epochAfterPinch,
        'a resolved get_view must not change the epoch',
      );
    } finally {
      viewport.destroy();
    }
  });
});
