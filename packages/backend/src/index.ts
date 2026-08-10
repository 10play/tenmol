/**
 * @tenmol/backend
 *
 * The single interface that decouples the tenmol web app from *which* engine is
 * running underneath it — the WebSocket bridge to real PyMOL, or the in-browser
 * TypeScript port. See {@link Backend}.
 *
 * Zero runtime dependencies beyond `@tenmol/protocol` (pure types + the tiny
 * emitter), so it imports cleanly in the browser, a worker, Node and vitest.
 */

export type {
  Backend,
  BackendConnectionState,
  CmdBackend,
} from './backend';

export {
  TypedEmitter,
  type BackendEventName,
  type BackendEvents,
  type ConnectionEvents,
  type Listener,
  type Unsubscribe,
} from './events';

export { PymolError, DisconnectedError, RequestTimeoutError } from './errors';
