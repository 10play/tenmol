/**
 * @tenmol/client — typed event emitter (re-export).
 *
 * The emitter and the event map moved to `@tenmol/backend` so that BOTH the
 * WebSocket bridge and the in-browser TypeScript engine emit the identical
 * event surface. This module re-exports them so every existing
 * `@tenmol/client` / `@tenmol/client/events` import keeps working unchanged.
 *
 * `ClientEvents` is retained as an alias of `BackendEvents`.
 */

export {
  TypedEmitter,
  type BackendEventName,
  type BackendEvents,
  type BackendEvents as ClientEvents,
  type BackendEventName as ClientEventName,
  type ConnectionEvents,
  type Listener,
  type Unsubscribe,
} from '@tenmol/backend';
