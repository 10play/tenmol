/**
 * @tenmol/client
 *
 * Browser-side transport for the PyMOL bridge: one WebSocket, request/response
 * correlation, topic events, binary geometry frames, and a Proxy-based `cmd`.
 *
 *     import { connect } from '@tenmol/client';
 *
 *     const { conn, cmd } = await connect();          // ws://127.0.0.1:8765/ws
 *     conn.on('feedback', ({ lines }) => console.log(lines.join('\n')));
 *     await conn.sub('view');
 *     await cmd.fragment('ala');
 *     const view = await cmd.get_view();
 *
 * Everything is re-exported so consumers never import from deep paths.
 */

export {
  PymolConnection,
  PymolError,
  DisconnectedError,
  RequestTimeoutError,
  SocketReadyState,
  type ConnectionState,
  type PymolConnectionOptions,
  type ReconnectOptions,
  type WebSocketCtor,
  type WebSocketLike,
} from './connection';

export {
  TypedEmitter,
  type ClientEventName,
  type ClientEvents,
  type ConnectionEvents,
  type Listener,
  type Unsubscribe,
} from './events';

export {
  createCmd,
  isKwargs,
  splitArgs,
  type Cmd,
  type CmdCallable,
  type CmdInternals,
  type CmdNamespace,
  type KnownNamespaces,
  type TypedPymolCmd,
} from './cmd';

// Re-export the protocol so apps need a single dependency for wire types.
export * from '@tenmol/protocol';

// The Backend abstraction, re-exported so consumers get the interface and both
// error/emitter types from a single dependency.
export type { Backend, BackendConnectionState, CmdBackend } from '@tenmol/backend';

import { PymolConnection, type PymolConnectionOptions } from './connection';
import { createCmd, type Cmd } from './cmd';
import type { Backend } from '@tenmol/backend';

export interface PymolClient {
  conn: PymolConnection;
  cmd: Cmd;
}

/** Create a connection + `cmd` facade without opening the socket yet. */
export function createClient(options: PymolConnectionOptions = {}): PymolClient {
  const conn = new PymolConnection(options);
  return { conn, cmd: createCmd(conn) };
}

/**
 * The REMOTE backend: a `PymolConnection` typed as a {@link Backend}.
 *
 * This is the WebSocket-to-real-PyMOL half of the abstract switch. The app
 * chooses between this and `@tenmol/engine-ts`'s `createLocalBackend()` purely
 * by the `Backend` interface — see `apps/web/src/app/session.ts`.
 */
export function createRemoteBackend(options: PymolConnectionOptions = {}): Backend {
  return new PymolConnection(options);
}

/** Create a client and wait for the socket to open. */
export async function connect(options: PymolConnectionOptions = {}): Promise<PymolClient> {
  const client = createClient(options);
  await client.conn.connect();
  return client;
}
