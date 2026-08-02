/**
 * Adapters from a bridge connection to {@link ViewportTransport}.
 *
 * `@tenmol/client`'s `PymolConnection` almost fits: `input()`, `button()`,
 * `drag()`, `reshape()` and `call()` are exactly what the viewport needs. The
 * one gap is binary frames — `connection.ts:602-607` routes EVERY binary frame
 * through `decodeGeometryFrame`, which throws `GeometryFrameError` on a Mode-P
 * pixel frame and emits it as a connection error. Until that is widened to
 * `decodeBinaryFrame` (reported upstream to WP-05/06), pass `onBinaryFrame`
 * yourself, or use {@link bindConnection} which routes what it can.
 */

import { decodeBinaryFrame, type BinaryFrame } from '@tenmol/protocol';

import type { ViewportTransport } from './types';

/** The subset of `PymolConnection` this adapter needs. */
export interface ConnectionLike {
  sendInput(message: Parameters<ViewportTransport['input']>[0]): boolean;
  call(fn: string, args?: readonly unknown[], kwargs?: Record<string, unknown>): Promise<unknown>;
  on(event: string, listener: (payload: never) => void): () => void;
  send?(message: unknown): boolean;
  readonly connectionState?: string;
}

export interface BindConnectionOptions {
  /**
   * Optional raw-binary tap. Supply this if you have access to the socket
   * before `@tenmol/client` decodes it; it is the only way to receive Mode-P
   * pixel frames while the client's own hook is geometry-only.
   */
  onRawBinary?: (listener: (bytes: ArrayBuffer | Uint8Array) => void) => () => void;
}

export function bindConnection(
  connection: ConnectionLike,
  options: BindConnectionOptions = {},
): ViewportTransport {
  const transport: ViewportTransport = {
    input(message): boolean {
      // The answer is forwarded, not swallowed: `sendInput` returns false and
      // DROPS the frame while the socket is not open (`connection.ts:327-331`),
      // and `input/mouse.ts` needs to know so it can abandon the gesture
      // instead of delivering its drags and its release without the press.
      return connection.sendInput(message);
    },
    call(fn, args = [], kwargs = {}): Promise<unknown> {
      return connection.call(fn, args, kwargs);
    },
    ack(frameId: number): void {
      connection.send?.({ t: 'ack', what: 'pixels', frameId });
    },
    isConnected(): boolean {
      return connection.connectionState === undefined || connection.connectionState === 'open';
    },
  };

  const listeners = new Set<(frame: BinaryFrame) => void>();
  const emit = (frame: BinaryFrame): void => {
    for (const listener of listeners) listener(frame);
  };

  // Geometry frames the client already decodes.
  const offGeometry = connection.on('geometry:frame', ((frame: BinaryFrame) => emit(frame)) as (
    payload: never,
  ) => void);

  // Pixel frames, if the caller can tap the raw socket.
  const offRaw = options.onRawBinary?.((bytes) => {
    try {
      emit(decodeBinaryFrame(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)));
    } catch {
      /* not a tenmol binary frame */
    }
  });

  transport.onBinaryFrame = (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        offGeometry();
        offRaw?.();
      }
    };
  };

  return transport;
}
