/**
 * `Session` -> `ViewportTransport`.
 *
 * The viewport package knows nothing about `@tenmol/client`; it needs four
 * things and this file supplies them from the app's one session.
 *
 * The binary hook is the interesting one. `@tenmol/client`'s connection decodes
 * every binary frame with `decodeBinaryFrame` and emits `binary:frame` for BOTH
 * kinds in arrival order, so one listener feeds Mode P and Mode G alike.
 * `devFrames.ts`'s pull source stays as the fallback for a bridge with no
 * pixel producer.
 */

import type { Session } from '../../app';
import type { ViewportTransport } from '@tenmol/viewport';
import type { BinaryFrame, InputMessage } from '@tenmol/protocol';

/** Adapt an app `Session` to the `ViewportTransport` the viewport package needs. */
export function createSessionTransport(session: Session): ViewportTransport {
  const listeners = new Set<(frame: BinaryFrame) => void>();

  session.conn.on('binary:frame', (frame: BinaryFrame) => {
    for (const listener of listeners) listener(frame);
  });

  // The bridge only registers a Mode-P/Mode-G sink for a session that has
  // SUBSCRIBED (server.py routes `sub` -> `RenderService.add_client`), so this
  // is what turns the pixel stream on. Queued while the socket is down and
  // re-sent by the client after a reconnect.
  void session.conn.sub('pixels').catch(() => undefined);
  void session.conn.sub('geometry').catch(() => undefined);

  return {
    input(message: InputMessage): void {
      session.conn.sendInput(message);
    },
    call(fn, args = [], kwargs = {}): Promise<unknown> {
      return session.call(fn, args, kwargs);
    },
    ack(frameId: number): void {
      session.conn.ack(frameId, 'pixels');
    },
    isConnected(): boolean {
      return session.conn.isOpen;
    },
    onBinaryFrame(listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
