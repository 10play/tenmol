/**
 * `LocalBackend` — the in-browser TypeScript engine, behind the {@link Backend}
 * interface.
 *
 * This is the second half of the abstract switch: the app talks to `Backend`
 * and never knows whether it reached real PyMOL over a WebSocket
 * (`@tenmol/client`'s `RemoteBackend`) or this in-process engine. Every method
 * has the same signature and the same observable behaviour as its
 * `PymolConnection` counterpart; the difference is only that there is no socket
 * and no Python.
 */

import type {
  TypedEmitter,
  Backend,
  BackendConnectionState,
  BackendEvents,
  Listener,
  Unsubscribe,
} from '@tenmol/backend';
import type { HelloMessage, InputMessage, Json, Topic } from '@tenmol/protocol';
import { Engine } from './engine';

export interface LocalBackendOptions {
  /** Cosmetic; surfaced as `backend.url`. */
  url?: string;
}

const LOCAL_URL = 'local://engine-ts';

export class LocalBackend implements Backend {
  readonly url: string;
  private readonly engine = new Engine();
  private readonly subscriptions = new Set<Topic>();
  private state: BackendConnectionState = 'idle';
  private hello: HelloMessage | null = null;

  constructor(options: LocalBackendOptions = {}) {
    this.url = options.url ?? LOCAL_URL;
  }

  /* ----------------------------- lifecycle ---------------------------- */

  get connectionState(): BackendConnectionState {
    return this.state;
  }
  get isOpen(): boolean {
    return this.state === 'open';
  }
  get serverInfo(): HelloMessage | null {
    return this.hello;
  }

  connect(): Promise<void> {
    if (this.state === 'open') return Promise.resolve();
    this.state = 'connecting';
    this.hello = this.engine.boot();
    this.state = 'open';
    // Fire in the same order a socket would: open, then hello.
    this.emitter().emit('connection:open', { url: this.url, attempt: 0 });
    this.emitter().emit('server:hello', this.hello);
    return Promise.resolve();
  }

  ready(): Promise<void> {
    return this.isOpen ? Promise.resolve() : this.connect();
  }

  close(code = 1000, reason = 'client closed'): void {
    this.state = 'closed';
    this.emitter().emit('connection:close', { code, reason, wasClean: true });
  }

  /* ------------------------------- events ----------------------------- */

  private emitter(): TypedEmitter<BackendEvents> {
    return this.engine.emitter;
  }

  on<K extends keyof BackendEvents & string>(
    event: K,
    listener: Listener<BackendEvents[K]>,
  ): Unsubscribe {
    return this.emitter().on(event, listener);
  }
  once<K extends keyof BackendEvents & string>(
    event: K,
    listener: Listener<BackendEvents[K]>,
  ): Unsubscribe {
    return this.emitter().once(event, listener);
  }
  off<K extends keyof BackendEvents & string>(event: K, listener: Listener<BackendEvents[K]>): void {
    this.emitter().off(event, listener);
  }
  nextEvent<K extends keyof BackendEvents & string>(event: K): Promise<BackendEvents[K]> {
    return this.emitter().next(event);
  }

  /* ------------------------------ requests ---------------------------- */

  call<T = Json>(
    fn: string,
    args: readonly unknown[] = [],
    kwargs: Readonly<Record<string, unknown>> = {},
  ): Promise<T> {
    try {
      return Promise.resolve(this.engine.call(fn, args, kwargs) as T);
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  do(cmd: string): Promise<null> {
    this.engine.do(cmd);
    return Promise.resolve(null);
  }

  /* ------------------------------- topics ----------------------------- */
  // The local engine pushes every topic unconditionally; `sub`/`unsub` are
  // bookkeeping so `backend.topics` reports what the app asked for, matching the
  // remote backend's contract.

  sub(topic: Topic): Promise<void> {
    this.subscriptions.add(topic);
    return Promise.resolve();
  }
  unsub(topic: Topic): Promise<void> {
    this.subscriptions.delete(topic);
    return Promise.resolve();
  }
  get topics(): Topic[] {
    return [...this.subscriptions];
  }

  /* -------------------------------- input ----------------------------- */

  sendInput(message: InputMessage): boolean {
    if (!this.isOpen) return false;
    this.engine.input(message as unknown as { kind: string });
    return true;
  }
  button(button: number, state: number, x: number, y: number, mod = 0): boolean {
    return this.sendInput({ t: 'input', kind: 'button', button, state, x, y, mod } as InputMessage);
  }
  drag(x: number, y: number, mod = 0): boolean {
    return this.sendInput({ t: 'input', kind: 'drag', x, y, mod } as InputMessage);
  }
  ack(): boolean {
    // No flow control needed: frames are delivered in-process, never dropped.
    return this.isOpen;
  }
  reshape(width: number, height: number): boolean {
    return this.sendInput({ t: 'input', kind: 'reshape', width, height } as InputMessage);
  }
}

/**
 * The LOCAL backend: a `LocalBackend` typed as a {@link Backend}. The mirror of
 * `@tenmol/client`'s `createRemoteBackend()`; the app picks between them by the
 * subdomain it is served on (see `apps/web/src/app/session.ts`).
 */
export function createLocalBackend(options: LocalBackendOptions = {}): Backend {
  return new LocalBackend(options);
}
