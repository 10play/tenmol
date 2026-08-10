/**
 * @tenmol/backend — the `Backend` interface.
 *
 * ONE seam. Everything above it (`@tenmol/client`'s `cmd` facade,
 * `@tenmol/stores`, `@tenmol/viewport`, every `apps/web` feature) talks to this
 * interface and nothing else; everything below it is a concrete engine:
 *
 *   * `RemoteBackend`  — `@tenmol/client`'s `PymolConnection`: a WebSocket to the
 *                        Python bridge driving the REAL PyMOL C++/Python engine.
 *   * `LocalBackend`   — `@tenmol/engine-ts`: a TypeScript port of the engine,
 *                        executing calls in the browser.
 *
 * The surface is exactly what the consumers use, enumerated from their call
 * sites — no more. `createCmd()` needs only {@link CmdBackend} (`call` + `do`),
 * which is why the whole `cmd` facade is backend-agnostic for free.
 *
 * The wire contract a backend reproduces (see the Python bridge's
 * `tenmol_bridge/dispatch.py`): a `call` resolves to the decoded result;
 * `do(line)` resolves to `null` and surfaces errors on the `feedback` event
 * rather than rejecting; state changes surface as topic events (`objects`,
 * `view`, `feedback`, …) plus binary geometry/pixel frames. Both backends emit
 * the identical {@link BackendEvents} payloads and the identical binary-frame
 * layout from `@tenmol/protocol`.
 */

import type { HelloMessage, InputMessage, Json, Topic } from '@tenmol/protocol';
import type { BackendEvents, Listener, Unsubscribe } from './events';

/** Lifecycle phases, shared by every backend. */
export type BackendConnectionState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed';

/**
 * The minimal surface the `cmd` facade binds to. `createCmd()` needs only these
 * two, so it is agnostic to which engine is underneath.
 */
export interface CmdBackend {
  /**
   * Call a PyMOL API symbol. `fn` is a dotted path resolved against `cmd`
   * ('fragment', 'util.cbc', 'movie.produce'). Rejects with a `PymolError` on
   * failure.
   */
  call<T = Json>(
    fn: string,
    args?: readonly unknown[],
    kwargs?: Readonly<Record<string, unknown>>,
  ): Promise<T>;
  /**
   * Run a raw PyMOL command line. Resolves to `null` and reports errors on the
   * `feedback` event stream, NOT as a rejection — matching `cmd.do`'s "prints
   * exceptions instead of raising" (`commanding.py`).
   */
  do(cmd: string): Promise<null>;
}

/**
 * The full backend surface. A `PymolConnection` already satisfies this
 * structurally (it is declared `implements Backend`); a `LocalBackend`
 * implements it against the TypeScript engine.
 */
export interface Backend extends CmdBackend {
  /* -------- identity / lifecycle -------- */
  readonly url: string;
  readonly connectionState: BackendConnectionState;
  readonly isOpen: boolean;
  /** The backend's `hello` frame for the current connection, if it arrived. */
  readonly serverInfo: HelloMessage | null;

  /** Open the backend. Resolves on the first successful open. */
  connect(): Promise<void>;
  /** Resolves when open (now or later). */
  ready(): Promise<void>;
  /** Close for good: pending calls reject. */
  close(code?: number, reason?: string): void;

  /* -------- events -------- */
  on<K extends keyof BackendEvents & string>(
    event: K,
    listener: Listener<BackendEvents[K]>,
  ): Unsubscribe;
  once<K extends keyof BackendEvents & string>(
    event: K,
    listener: Listener<BackendEvents[K]>,
  ): Unsubscribe;
  off<K extends keyof BackendEvents & string>(
    event: K,
    listener: Listener<BackendEvents[K]>,
  ): void;
  /** Resolves the next time `event` fires. */
  nextEvent<K extends keyof BackendEvents & string>(event: K): Promise<BackendEvents[K]>;

  /* -------- topics -------- */
  sub(topic: Topic): Promise<void>;
  unsub(topic: Topic): Promise<void>;
  readonly topics: Topic[];

  /* -------- input (fire and forget) -------- */
  sendInput(message: InputMessage): boolean;
  button(button: number, state: number, x: number, y: number, mod?: number, when?: number): boolean;
  drag(x: number, y: number, mod?: number, when?: number): boolean;
  ack(frameId: number, what?: 'pixels' | 'geometry'): boolean;
  reshape(width: number, height: number, force?: boolean): boolean;
}
