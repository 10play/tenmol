/**
 * Where Mode-G geometry frames come from.
 *
 * The accessor itself HAS landed: `_cmd.web_get_rep_geometry`
 * (`layer4/CmdWebGeometry.cpp`, spike 06) returns PyMOL's own CPU-side buffers
 * per object/rep/state, validated against `cmd.get_vrml(2)` to 1.2e-5 A. What
 * does not exist yet is the BRIDGE side: nothing in `bridge/tenmol_bridge`
 * calls it, encodes it with `packages/protocol/python/tenmol_wire.py` and puts
 * it on the wire as a binary frame.
 *
 * So this file has exactly two implementations and no third:
 *
 *   `createStreamGeometrySource` — subscribes to the transport's binary frames
 *      and forwards every geometry frame. This is the real path the moment the
 *      bridge producer lands. It also asks for a pull, so the request side is
 *      already wired.
 *
 *   `createStaticGeometrySource` — fetches pre-encoded frames from URLs. Used
 *      by the dev harness and by tests to drive the renderer with REAL accessor
 *      output. It is not a mock: the bytes are produced by the C++ accessor and
 *      the protocol package's own Python encoder.
 *
 * There is deliberately no "synthesise a sphere so something shows up" source.
 * When the bridge cannot serve a rep, the viewport says `awaiting accessor` and
 * falls back to Mode P.
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

/** `{t:'call'}` symbol the bridge is expected to expose for a Mode-G pull. */
export const GEOMETRY_PULL_FN = '_bridge.pull_geometry';

export interface StreamGeometrySourceOptions {
  transport: ViewportTransport;
  /** Set false to listen only (no pull requests). */
  request?: boolean;
  onUnavailable?: (error: Error) => void;
}

export function createStreamGeometrySource(options: StreamGeometrySourceOptions): GeometrySource {
  const { transport } = options;
  let unsubscribe: (() => void) | null = null;
  let sink: GeometrySink | null = null;
  let announced = false;

  const onFrame = (frame: BinaryFrame): void => {
    if (sink === null || !isGeometryFrame(frame)) return;
    sink.frame(frame);
  };

  return {
    name: 'websocket-geometry-stream',
    start(next: GeometrySink): void {
      sink = next;
      if (transport.onBinaryFrame) unsubscribe = transport.onBinaryFrame(onFrame);
    },
    stop(): void {
      unsubscribe?.();
      unsubscribe = null;
      sink = null;
    },
    request(object: string, rep: RepId, state: number): void {
      if (options.request === false) return;
      void transport
        .call(GEOMETRY_PULL_FN, [object, repName(rep), state])
        .catch((cause: unknown) => {
          const error = cause instanceof Error ? cause : new Error(String(cause));
          if (!announced) {
            announced = true;
            options.onUnavailable?.(error);
          }
          sink?.unavailable({ object, rep, state }, 'no-accessor');
        });
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
