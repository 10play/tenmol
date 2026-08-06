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

import { PymolConnection, type PymolConnectionOptions } from './connection';
import { createCmd, type Cmd } from './cmd';

/** A connection paired with its `cmd` facade. */
export interface PymolClient {
  conn: PymolConnection;
  cmd: Cmd;
}

/** Create a connection + `cmd` facade without opening the socket yet. */
export function createClient(options: PymolConnectionOptions = {}): PymolClient {
  const conn = new PymolConnection(options);
  return { conn, cmd: createCmd(conn) };
}

/** Create a client and wait for the socket to open. */
export async function connect(options: PymolConnectionOptions = {}): Promise<PymolClient> {
  const client = createClient(options);
  await client.conn.connect();
  return client;
}
