/**
 * `withFallback` on a GL-free bridge.
 *
 * The regression these lock in: a `--no-gl` primary reports `rasterizes: false`,
 * but the fallback (`cmd.png`) needs the same missing context, so switching to
 * it is pointless AND its header-less frames reset the compositor to
 * `rasterizing: true`, re-suppressing Mode G. `withFallback` must therefore
 * surface the primary's negative verdict and NOT swap once the primary has
 * declared the bridge incapable of rasterising. A merely stalled primary must
 * still fall back, exactly as before.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PixelSink, PixelSource } from '../types';
import { withFallback } from './sources';

/** A controllable fake source: capture the sink, fail on cue, report `rasterizes`. */
function fakeSource(name: string, rasterizes?: boolean) {
  const state = { started: false, stopped: false, sink: null as PixelSink | null };
  const source: PixelSource = {
    name,
    // Only declare `rasterizes` when the fake has an opinion — `undefined` means
    // "a stream is expected", the historical default, and exactOptionalProperty
    // types forbids assigning an explicit `undefined` to the optional field.
    ...(rasterizes === undefined ? {} : { rasterizes }),
    start(sink: PixelSink): void {
      state.started = true;
      state.sink = sink;
    },
    stop(): void {
      state.stopped = true;
    },
  };
  return { source, state };
}

const noopSink: PixelSink = { frame: () => {}, error: () => {} };

describe('withFallback', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports the PRIMARY verdict when the primary is GL-free, switched or not', () => {
    const primary = fakeSource('stream', false);
    const fallback = fakeSource('pull', true);
    const composite = withFallback(primary.source, fallback.source, 1500);
    // Even before anything starts, a GL-free primary means "nothing rasterises".
    expect(composite.rasterizes).toBe(false);
  });

  it('does NOT swap to the fallback once the primary declares itself GL-free', () => {
    const primary = fakeSource('stream', false);
    const fallback = fakeSource('pull', true);
    const composite = withFallback(primary.source, fallback.source, 1500);
    composite.start(noopSink);

    // The primary errors (its `set_pixel_stream` answered "no GL"); the grace
    // timer then fires. Neither must start the doomed fallback.
    primary.state.sink?.error(new Error('this bridge has no GL context'));
    vi.advanceTimersByTime(3000);

    expect(fallback.state.started).toBe(false);
    expect(composite.rasterizes).toBe(false);
  });

  it('still falls back when the primary merely STALLS (rasterizes not false)', () => {
    const primary = fakeSource('stream', undefined); // a stream is expected
    const fallback = fakeSource('pull', true);
    const composite = withFallback(primary.source, fallback.source, 1500);
    composite.start(noopSink);

    // No frame within the grace window: a stalled stream, not a GL-free one.
    vi.advanceTimersByTime(1600);

    expect(fallback.state.started).toBe(true);
    expect(primary.state.stopped).toBe(true);
    // The active source (pull) rasterises, so the composite does too.
    expect(composite.rasterizes).toBe(true);
  });

  it('a frame before the grace timer cancels the fallback swap', () => {
    const primary = fakeSource('stream', undefined);
    const fallback = fakeSource('pull', true);
    const composite = withFallback(primary.source, fallback.source, 1500);
    composite.start(noopSink);

    // A real frame arrives: the stream works, do not fall back.
    primary.state.sink?.frame({} as never);
    vi.advanceTimersByTime(3000);

    expect(fallback.state.started).toBe(false);
  });
});
