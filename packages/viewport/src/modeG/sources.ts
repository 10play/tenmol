/**
 * Where Mode-G geometry frames come from — and when they go away.
 *
 * `createStreamGeometrySource` is the real path: it listens for the bridge's
 * binary geometry frames, asks for the reps this viewport wants, and — the
 * wave-2 addition — runs the LIFECYCLE that defect D1 was missing. It owns
 * three things that used to belong to nobody:
 *
 *   * a per `object|rep|state` cache (`./cache.ts`) of what this viewport asked
 *     for, what the bridge resolved it to, and what version it holds;
 *   * an invalidation poller (`./invalidation.ts`) fed by the exact
 *     `_cmd.web_get_versions` counters;
 *   * the answer to a pull. `request()` used to fire and forget, so a
 *     `not-built` (the rep is hidden) or an `unsupported` was indistinguishable
 *     from a frame that simply had not arrived yet.
 *
 * A DROP travels down the ordinary frame path as a TOMBSTONE — an empty but
 * completely valid `cgo-draw-arrays` frame — which `renderer.apply()` turns
 * into a real dispose-and-delete. That is deliberate: `GeometrySink`
 * (`../types.ts`) and the frame handler in `../viewport.ts` are owned by other
 * work packages, and a removal that needs neither of them to change is a
 * removal that can ship today.
 *
 * `createStaticGeometrySource` fetches pre-encoded frames from URLs for the dev
 * harness and the tests. It is not a mock: the bytes come from the C++ accessor
 * and the protocol package's own Python encoder. There is deliberately no
 * "synthesise a sphere so something shows up" source.
 */

import {
  isGeometryFrame,
  repName,
  type BinaryFrame,
  type GeometryFrame,
  type RepId,
} from '@tenmol/protocol';
import { decodeGeometryFrame } from '@tenmol/protocol';

import type { GeometrySink, GeometrySource, ViewportTransport } from '../types';
import {
  CURRENT_STATE,
  EMPTY_STATUSES,
  FALLBACK_STATUSES,
  createGeometryCache,
  tombstoneFrame,
  type GeometryCache,
  type GeometryCacheEntry,
  type PullResult,
  type ResolvedKey,
  type VersionTable,
} from './cache';
import { DEFAULT_POLL_MS, createInvalidationPoller, type InvalidationPoller } from './invalidation';

/** `{t:'call'}` symbol the bridge exposes for a Mode-G pull. */
export const GEOMETRY_PULL_FN = '_bridge.pull_geometry';

export interface StreamGeometrySourceOptions {
  transport: ViewportTransport;
  /** Set false to listen only (no pull requests). */
  request?: boolean;
  /**
   * Set false to disable the invalidation lifecycle entirely — the wave-1
   * behaviour, kept only so a test can demonstrate the defect.
   */
  invalidate?: boolean;
  /** Version-table poll period in ms. Default 250 (the bridge recomputes at 4 Hz). */
  pollMs?: number;
  onUnavailable?: (error: Error) => void;
  /** Diagnostics: called whenever a key is dropped or re-pulled. */
  onLifecycle?: (action: 'refetch' | 'drop', key: ResolvedKey) => void;
}

export interface StreamGeometrySource extends GeometrySource {
  /** Always present on this source (`GeometrySource` types it optional). */
  request(object: string, rep: RepId, state?: number): void;
  /** The live cache, for the HUD and for tests. */
  readonly cache: GeometryCache;
  readonly poller: InvalidationPoller;
  /** Run one invalidation cycle now instead of waiting for the timer. */
  refresh(): Promise<void>;
}

export function createStreamGeometrySource(
  options: StreamGeometrySourceOptions,
): StreamGeometrySource {
  const { transport } = options;
  const lifecycle = options.invalidate !== false;

  let unsubscribe: (() => void) | null = null;
  let sink: GeometrySink | null = null;
  let announced = false;
  let started = false;
  let seq = 0;
  let table: VersionTable | null = null;

  const cache = createGeometryCache();

  const onFrame = (frame: BinaryFrame): void => {
    if (sink === null || !isGeometryFrame(frame)) return;
    // The `geometry` topic is a fan-out (defect D4): a frame here may belong to
    // another client. Recording it only for keys THIS viewport tracks keeps our
    // cache honest; `viewport.ts` separately refuses to draw a rep it is not
    // running in Mode G.
    cache.applied(frame.header, frame.payload.byteLength);
    sink.frame(frame);
  };

  /** Push a tombstone so the renderer disposes the buffers for `key`. */
  const drop = (key: ResolvedKey): void => {
    cache.dropped(key);
    options.onLifecycle?.('drop', key);
    seq++;
    sink?.frame(tombstoneFrame(key, seq));
  };

  const pull = (entry: GeometryCacheEntry): void => {
    if (options.request === false) return;
    const state = entry.requestedState;
    cache.issued(entry, table);
    const kwargs: Record<string, unknown> = {};
    // The `have` fast path: an unchanged rep answers `unchanged` with no
    // payload, so a conservative extra pull costs a round trip and no bytes.
    if (entry.hash !== null) kwargs['have'] = entry.hash;
    void transport
      .call(GEOMETRY_PULL_FN, [entry.object, repName(entry.rep), state], kwargs)
      .then((result: unknown) => {
        const answer = (
          typeof result === 'object' && result !== null ? (result as PullResult) : {}
        ) as PullResult;
        const drawn = entry.drawn;
        const previousState = entry.resolvedState;
        cache.answered(entry, answer);
        const status = String(answer.status ?? '');
        const resolved = entry.resolvedState ?? previousState;

        if (EMPTY_STATUSES.includes(status)) {
          // The rep is hidden, or has no geometry at all. Not an error — but
          // whatever is on screen for it must go. THIS is the `hide everything`
          // half of D1.
          if (drawn && resolved !== null) {
            drop({ object: entry.object, state: resolved, rep: entry.rep });
          }
          // `not-built` has no state to resolve to; forget ours so the next
          // table re-discovers it when the rep comes back.
          entry.resolvedState = status === 'not-built' ? null : entry.resolvedState;
          return;
        }
        if (FALLBACK_STATUSES.includes(status)) {
          if (drawn && resolved !== null) {
            drop({ object: entry.object, state: resolved, rep: entry.rep });
          }
          sink?.unavailable(
            { object: entry.object, rep: entry.rep, state },
            answer.fallbackReason ?? status,
          );
        }
      })
      .catch((cause: unknown) => {
        entry.pending = false;
        const error = cause instanceof Error ? cause : new Error(String(cause));
        if (!announced) {
          announced = true;
          options.onUnavailable?.(error);
        }
        sink?.unavailable({ object: entry.object, rep: entry.rep, state }, 'no-accessor');
      });
  };

  const apply = (next: VersionTable): void => {
    table = next;
    const plan = cache.plan(next);
    for (const key of plan.drop) drop(key);
    for (const entry of plan.refetch) {
      options.onLifecycle?.('refetch', {
        object: entry.object,
        rep: entry.rep,
        state: entry.resolvedState ?? entry.requestedState,
      });
      pull(entry);
    }
  };

  const poller = createInvalidationPoller({
    transport,
    intervalMs: options.pollMs ?? DEFAULT_POLL_MS,
    onTable: apply,
    onError: () => {
      /* a closed socket; the next tick asks again */
    },
  });

  return {
    name: 'websocket-geometry-stream',
    cache,
    poller,

    start(next: GeometrySink): void {
      sink = next;
      started = true;
      if (transport.onBinaryFrame) unsubscribe = transport.onBinaryFrame(onFrame);
      // The poller starts LAZILY, on the first `request()`. A viewport running
      // every rep in Mode P has nothing to invalidate, and it must not pay a
      // 4 Hz round trip to be told so.
    },

    stop(): void {
      started = false;
      poller.stop();
      unsubscribe?.();
      unsubscribe = null;
      sink = null;
      // Do NOT clear the cache: `stop()` is also what a source swap calls, and
      // the renderer still holds the buffers. `viewport.destroy()` disposes
      // the renderer, which is what actually frees them.
      table = null;
    },

    request(object: string, rep: RepId, state: number = CURRENT_STATE): void {
      if (options.request === false) return;
      const entry = cache.track(object, rep, state);
      if (entry.pending) return;
      pull(entry);
      if (lifecycle && started && !poller.running) poller.start();
    },

    async refresh(): Promise<void> {
      await poller.poll();
    },
  };
}

export interface StaticGeometrySourceOptions {
  /** Frame URLs, fetched once at start. */
  urls: readonly string[];
  fetchImpl?: typeof fetch;
}

export function createStaticGeometrySource(options: StaticGeometrySourceOptions): GeometrySource {
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  let stopped = false;

  return {
    name: 'static-geometry-frames',
    start(sink: GeometrySink): void {
      stopped = false;
      void (async (): Promise<void> => {
        for (const url of options.urls) {
          if (stopped) return;
          try {
            const response = await doFetch(url, { cache: 'no-store' });
            if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
            const buffer = await response.arrayBuffer();
            const frame: GeometryFrame = decodeGeometryFrame(buffer);
            if (!stopped) sink.frame(frame);
          } catch (cause) {
            sink.error(cause instanceof Error ? cause : new Error(String(cause)));
          }
        }
      })();
    },
    stop(): void {
      stopped = true;
    },
  };
}
