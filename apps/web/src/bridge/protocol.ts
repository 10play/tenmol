/**
 * Single import point for wire types inside apps/web.
 *
 * The protocol itself lives in `@tenmol/protocol` (owned by another package):
 * one WebSocket at ws://127.0.0.1:8765/ws, JSON text frames for
 * call/do/input/sub/unsub and ok/err/event/feedback/hello, binary frames for
 * geometry, and the closed seven-topic set. v1 is minimal and closed -- nothing in
 * this app may declare a wire type of its own; add it there or not at all.
 */

export * from '@tenmol/protocol';

import { DEFAULT_WS_URL } from '@tenmol/protocol';

/** ws://127.0.0.1:8765/ws -- the only endpoint this client ever talks to. */
export const BRIDGE_URL: string = DEFAULT_WS_URL;
