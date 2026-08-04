/**
 * Where Mode-P frames come from.
 *
 * TWO implementations, one interface:
 *
 *   `createStreamPixelSource` — the real thing. The bridge pushes
 *      `PixelFrameHeader` binary frames over the WebSocket at up to 60 Hz
 *      (measured 3.4 ms/frame at 1280x960 on 1AON: draw 0.5 + glReadPixels 1.0
 *      + jpeg q80 1.9, plan §1.3). Owned bridge-side by WP-04.
 *
 *   `createPngPullSource` — a pull-mode fallback built from primitives that
 *      exist TODAY: `cmd.png(path)` plus an HTTP GET of that path. One frame
 *      per round trip, no flow control, no motion codec. It exists so the
 *      viewport is drivable (and demonstrable end-to-end) before WP-04's
 *      producer lands, and as the honest degradation path if the pixel stream
 *      ever stops: a stale-but-correct image beats a black canvas.
 *
 * Both hand the presenter identical `PixelFramePayload`s; nothing downstream
 * knows which one is running.
 */

import { isPixelFrame, type BinaryFrame } from '@tenmol/protocol';

import type { PixelFramePayload, PixelSink, PixelSource, ViewportTransport } from '../types';

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/* ------------------------------------------------------------------ *
 * Push: the WebSocket pixel stream (WP-04)
 * ------------------------------------------------------------------ */

export interface StreamPixelSourceOptions {
  transport: ViewportTransport;
  /**
   * `{t:'call', fn:'_bridge.set_pixel_stream'}` — the negotiated stream
   * parameters (`topics/pixels.ts`: `PixelStreamRequest`). Set false when the
   * bridge has no such symbol yet; the source then only listens.
   */
  configure?: boolean;
  motionEncoding?: 'jpeg' | 'webp';
  settleEncoding?: 'png' | 'raw-rgba';
  quality?: number;
  /** Called when the bridge rejects the stream configuration. */
  onUnavailable?: (error: Error) => void;
}

export const PIXEL_STREAM_FN = '_bridge.set_pixel_stream';

export function createStreamPixelSource(options: StreamPixelSourceOptions): PixelSource {
  const { transport } = options;
  let unsubscribe: (() => void) | null = null;
  let sink: PixelSink | null = null;
  let paused = false;
  let configured = false;
  /** Set once the bridge has told us the symbol does not exist. */
  let unavailable = false;
  let size = { width: 0, height: 0, dpr: 1 };

  const configure = (extra: Record<string, unknown> = {}): void => {
    if (options.configure === false || unavailable) return;
    const request: Record<string, unknown> = {
      width: size.width,
      height: size.height,
      dpr: size.dpr,
      motionEncoding: options.motionEncoding ?? 'jpeg',
      settleEncoding: options.settleEncoding ?? 'png',
      quality: options.quality ?? 80,
      paused,
      ...extra,
    };
    void transport
      .call(PIXEL_STREAM_FN, [], request)
      .then((result: unknown) => {
        // `{available: false}` is the bridge saying it has NO GL CONTEXT and
        // will never produce a frame. It is answered as a value rather than an
        // error on purpose (see render/__init__.py), so it must be handled on
        // the success path.
        if ((result as { available?: unknown } | null)?.available === false) {
          if (!unavailable) {
            unavailable = true;
            const reason = String(
              (result as { message?: unknown }).message ?? 'the bridge has no pixel producer',
            );
            const error = new Error(reason);
            options.onUnavailable?.(error);
            sink?.error(error);
          }
          return;
        }
        configured = true;
      })
      .catch((cause: unknown) => {
        // The bridge in front of us has no pixel producer. Say so once, and
        // tell the sink as well: `withFallback` listens on exactly that signal
        // to switch to the pull source.
        if (!configured) {
          // Do not retry: a bridge without the symbol will not grow one, and
          // one rejected call per resize would fill the console.
          unavailable = true;
          const error = cause instanceof Error ? cause : new Error(String(cause));
          options.onUnavailable?.(error);
          sink?.error(error);
        }
      });
  };

  const onFrame = (frame: BinaryFrame): void => {
    if (sink === null || paused) return;
    if (!isPixelFrame(frame)) return;
    const h = frame.header;
    const payload: PixelFramePayload = {
      bytes: frame.payload,
      encoding: h.encoding,
      width: h.width,
      height: h.height,
      dpr: h.dpr,
      flipY: h.flipY,
      frameId: h.frameId,
      receivedAt: now(),
      ...(h.reps === undefined ? {} : { reps: h.reps }),
    };
    sink.frame(payload);
  };

  return {
    name: 'websocket-pixel-stream',
    /**
     * False once the bridge has told us it has no pixel producer — which on a
     * GL-free backend is `_bridge.set_pixel_stream` raising `NoOffscreenGL`.
     * The viewport re-reads this whenever the sink sees an error, because the
     * answer only arrives one round trip after `start()`, and because an app
     * may pass its own `onUnavailable` (the shipping one passes a no-op) and
     * that must not be the only way the compositor can find out.
     */
    get rasterizes(): boolean {
      return !unavailable;
    },
    start(next: PixelSink): void {
      sink = next;
      if (transport.onBinaryFrame) unsubscribe = transport.onBinaryFrame(onFrame);
      else
        options.onUnavailable?.(
          new Error('transport has no binary-frame hook; Mode P cannot receive pixels'),
        );
      configure();
    },
    stop(): void {
      unsubscribe?.();
      unsubscribe = null;
      sink = null;
    },
    resize(width: number, height: number, dpr: number): void {
      size = { width, height, dpr };
      configure();
    },
    setPaused(next: boolean): void {
      if (paused === next) return;
      paused = next;
      configure({ paused: next });
    },
  };
}

/* ------------------------------------------------------------------ *
 * Pull: cmd.png + HTTP GET
 * ------------------------------------------------------------------ */

export interface PngPullSourceOptions {
  transport: ViewportTransport;
  /**
   * Absolute filesystem path the bridge writes and the URL the browser reads.
   * Two slots are alternated so a fetch of frame N can never observe the
   * partially-written bytes of frame N+1.
   */
  paths: readonly [string, string];
  /** Build the HTTP URL for a written path. `seq` is a cache buster. */
  urlFor: (path: string, seq: number) => string;
  /** Max frames per second to request. Default 30. */
  maxFps?: number;
  /**
   * Keep grabbing while nothing is happening (a spinning object, a movie).
   * Default 2 Hz — enough to catch backend-side changes the client cannot see.
   */
  idleFps?: number;
  fetchImpl?: typeof fetch;
  onError?: (error: Error) => void;
}

export function createPngPullSource(options: PngPullSourceOptions): PixelSource {
  const { transport } = options;
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const minIntervalMs = 1000 / (options.maxFps ?? 30);
  const idleIntervalMs = 1000 / (options.idleFps ?? 2);

  let sink: PixelSink | null = null;
  let running = false;
  let paused = false;
  let inFlight = false;
  let dirty = true;
  let seq = 0;
  let slot = 0;
  let lastGrabAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let size = { width: 0, height: 0, dpr: 1 };

  const grab = async (): Promise<void> => {
    if (sink === null) return;
    const path = options.paths[slot % 2] as string;
    slot++;
    seq++;
    const mySeq = seq;
    // width/height 0 == "the current viewport", which is what the bridge
    // already reshaped to. Passing explicit sizes would go down the
    // SceneMakeSizedImage path and re-allocate the FBO every frame.
    await transport.call('png', [path], { width: 0, height: 0, dpi: -1, ray: 0, quiet: 1 });
    // The write is done by the time the call resolves in the common case, but
    // `cmd.png` can defer to the next draw; a miss is a 404/short read, so
    // retry briefly rather than dropping the frame.
    let bytes: Uint8Array | null = null;
    for (let attempt = 0; attempt < 4 && bytes === null; attempt++) {
      if (attempt > 0) await new Promise<void>((r) => setTimeout(r, 8 * attempt));
      const response = await doFetch(options.urlFor(path, mySeq), { cache: 'no-store' });
      if (!response.ok) continue;
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > 0) bytes = new Uint8Array(buffer);
    }
    if (bytes === null) throw new Error(`png pull: ${path} was not readable`);
    if (sink === null) return;
    sink.frame({
      bytes,
      encoding: 'png',
      width: size.width,
      height: size.height,
      dpr: size.dpr,
      // cmd.png writes a correctly-oriented PNG; only the raw FBO readback is
      // bottom-up.
      flipY: false,
      frameId: mySeq,
      receivedAt: now(),
    });
  };

  const schedule = (delayMs: number): void => {
    if (!running || paused) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(
      () => {
        timer = null;
        void tick();
      },
      Math.max(0, delayMs),
    );
  };

  const tick = async (): Promise<void> => {
    if (!running || paused || inFlight || sink === null) return;
    const elapsed = now() - lastGrabAt;
    if (!dirty && elapsed < idleIntervalMs) {
      schedule(idleIntervalMs - elapsed);
      return;
    }
    if (elapsed < minIntervalMs) {
      schedule(minIntervalMs - elapsed);
      return;
    }
    inFlight = true;
    dirty = false;
    lastGrabAt = now();
    try {
      await grab();
    } catch (cause) {
      options.onError?.(cause instanceof Error ? cause : new Error(String(cause)));
      sink?.error(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      inFlight = false;
      schedule(dirty ? 0 : idleIntervalMs);
    }
  };

  return {
    name: 'png-pull',
    start(next: PixelSink): void {
      sink = next;
      running = true;
      dirty = true;
      void tick();
    },
    stop(): void {
      running = false;
      sink = null;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
    resize(width: number, height: number, dpr: number): void {
      size = { width, height, dpr };
      dirty = true;
      schedule(0);
    },
    invalidate(): void {
      dirty = true;
      if (!inFlight) schedule(0);
    },
    setPaused(next: boolean): void {
      paused = next;
      if (!paused) {
        dirty = true;
        schedule(0);
      }
    },
  };
}

/**
 * Try `primary`, and switch to `fallback` the first time the primary reports
 * itself unusable or fails to produce a frame within `graceMs`.
 *
 * This is the Mode-P half of "automatic fallback": the viewport must never sit
 * on a black canvas because one producer is missing.
 */
export function withFallback(
  primary: PixelSource,
  fallback: PixelSource,
  graceMs = 1500,
): PixelSource {
  let active: PixelSource = primary;
  let sink: PixelSink | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let switched = false;
  let lastSize: { width: number; height: number; dpr: number } | null = null;

  const swap = (): void => {
    if (switched || sink === null) return;
    switched = true;
    primary.stop();
    active = fallback;
    if (lastSize) fallback.resize?.(lastSize.width, lastSize.height, lastSize.dpr);
    fallback.start(sink);
  };

  const wrapSink = (real: PixelSink): PixelSink => ({
    frame(frame): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      real.frame(frame);
    },
    error(error): void {
      real.error(error);
      swap();
    },
  });

  return {
    get name(): string {
      return `${active.name}${switched ? ' (fallback)' : ''}`;
    },
    start(next: PixelSink): void {
      sink = wrapSink(next);
      primary.start(sink);
      timer = setTimeout(swap, graceMs);
    },
    stop(): void {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      active.stop();
      sink = null;
    },
    resize(width, height, dpr): void {
      lastSize = { width, height, dpr };
      active.resize?.(width, height, dpr);
    },
    invalidate(): void {
      active.invalidate?.();
    },
    setPaused(paused): void {
      active.setPaused?.(paused);
    },
  };
}
