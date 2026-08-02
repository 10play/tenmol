/**
 * @tenmol/client — WebSocket transport.
 *
 * One socket to the PyMOL bridge (default ws://127.0.0.1:8765/ws) carrying:
 *   * JSON text frames   — requests correlated by integer id, plus pushes
 *                          (event / feedback / hello);
 *   * binary frames      — geometry, decoded by @tenmol/protocol.
 *
 * Responsibilities: auto-reconnect with backoff, request/response correlation
 * through a promise map, re-subscription after a reconnect, and typed event
 * fan-out. Nothing PyMOL-specific lives here — that is cmd.ts.
 */

import {
  DEFAULT_WS_URL,
  decodeBinaryFrame,
  isErrMessage,
  isEventMessage,
  isFeedbackMessage,
  isGeometryFrame,
  isHelloMessage,
  isOkMessage,
  isPixelFrame,
  nowEpochSeconds,
  type ClientMessage,
  type HelloMessage,
  type InputButtonMessage,
  type InputDragMessage,
  type InputMessage,
  type InputReshapeMessage,
  type Json,
  type Topic,
  type WireError,
} from '@tenmol/protocol';

import { TypedEmitter, type ClientEvents, type Listener, type Unsubscribe } from './events';

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

/** A PyMOL-side failure: the server answered `{t:'err'}`. */
export class PymolError extends Error {
  override name = 'PymolError';
  /** Python exception class name, or a bridge rejection like 'NotAllowed'. */
  readonly type: string;
  readonly traceback: string;
  /** The `fn`/`cmd` that failed, for context in logs. */
  readonly request: string | undefined;

  constructor(error: WireError, request?: string) {
    super(error.message || error.type);
    this.type = error.type;
    this.traceback = error.traceback;
    this.request = request;
  }
}

/** The socket went away (or was never up) before a reply arrived. */
export class DisconnectedError extends Error {
  override name = 'DisconnectedError';
}

/** No reply within `requestTimeoutMs`. */
export class RequestTimeoutError extends Error {
  override name = 'RequestTimeoutError';
}

/* ------------------------------------------------------------------ *
 * Socket abstraction (browser WebSocket, `ws` in tests, mocks)
 * ------------------------------------------------------------------ */

export interface WebSocketLike {
  binaryType: string;
  readonly readyState: number;
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: { code?: number; reason?: string; wasClean?: boolean }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export type WebSocketCtor = new (url: string) => WebSocketLike;

export const SocketReadyState = {
  Connecting: 0,
  Open: 1,
  Closing: 2,
  Closed: 3,
} as const;

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface ReconnectOptions {
  /** First retry delay. */
  initialDelayMs?: number;
  /** Ceiling for the exponential backoff. */
  maxDelayMs?: number;
  /** Multiplier per attempt. */
  factor?: number;
  /** Random +/- fraction applied to each delay (0 disables jitter). */
  jitter?: number;
  /** 0 = unlimited. */
  maxAttempts?: number;
}

export interface PymolConnectionOptions {
  /** Defaults to ws://127.0.0.1:8765/ws. */
  url?: string;
  /** Reconnect after an unexpected close. Default true. */
  autoReconnect?: boolean;
  reconnect?: ReconnectOptions;
  /** Per-request timeout; 0 disables. Default 0 (PyMOL calls can be slow). */
  requestTimeoutMs?: number;
  /** Re-send `sub` for every live topic after a reconnect. Default true. */
  autoResubscribe?: boolean;
  /** Buffer requests issued while the socket is down, flush on open. Default true. */
  queueWhileDisconnected?: boolean;
  /** Cap on that buffer; further requests reject immediately. Default 256. */
  maxQueuedRequests?: number;
  /** Injectable for tests / Node (`ws`). Defaults to globalThis.WebSocket. */
  WebSocketImpl?: WebSocketCtor;
}

interface Pending {
  resolve: (value: Json) => void;
  reject: (reason: Error) => void;
  label: string;
  timer: ReturnType<typeof setTimeout> | undefined;
}

const DEFAULT_RECONNECT: Required<ReconnectOptions> = {
  initialDelayMs: 250,
  maxDelayMs: 10_000,
  factor: 2,
  jitter: 0.2,
  maxAttempts: 0,
};

/* ------------------------------------------------------------------ *
 * Connection
 * ------------------------------------------------------------------ */

export class PymolConnection {
  readonly url: string;

  private readonly emitter = new TypedEmitter<ClientEvents>();
  private readonly pending = new Map<number, Pending>();
  private readonly subscriptions = new Set<Topic>();
  private readonly outbox: ClientMessage[] = [];

  private readonly reconnectOpts: Required<ReconnectOptions>;
  private readonly autoReconnect: boolean;
  private readonly autoResubscribe: boolean;
  private readonly queueWhileDisconnected: boolean;
  private readonly maxQueuedRequests: number;
  private readonly requestTimeoutMs: number;
  private readonly WebSocketImpl: WebSocketCtor;

  private socket: WebSocketLike | null = null;
  private nextId = 1;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private state: ConnectionState = 'idle';
  private stopped = false;
  private openWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  private hello: HelloMessage | null = null;

  constructor(options: PymolConnectionOptions = {}) {
    this.url = options.url ?? DEFAULT_WS_URL;
    this.autoReconnect = options.autoReconnect ?? true;
    this.autoResubscribe = options.autoResubscribe ?? true;
    this.queueWhileDisconnected = options.queueWhileDisconnected ?? true;
    this.maxQueuedRequests = options.maxQueuedRequests ?? 256;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 0;
    this.reconnectOpts = { ...DEFAULT_RECONNECT, ...options.reconnect };

    const impl = options.WebSocketImpl ?? (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
    if (!impl) {
      throw new Error(
        'No WebSocket implementation: pass options.WebSocketImpl (e.g. the `ws` package under Node).',
      );
    }
    this.WebSocketImpl = impl;
  }

  /* ---------------- lifecycle ---------------- */

  get connectionState(): ConnectionState {
    return this.state;
  }

  get isOpen(): boolean {
    return this.state === 'open';
  }

  /** The server's `hello` frame for the current connection, if it arrived. */
  get serverInfo(): HelloMessage | null {
    return this.hello;
  }

  /** Number of requests awaiting a terminal ok/err. */
  get pendingCount(): number {
    return this.pending.size;
  }

  /** Open the socket. Resolves on the first successful open. */
  connect(): Promise<void> {
    this.stopped = false;
    if (this.state === 'open') return Promise.resolve();
    const waiter = this.waitForOpen();
    if (this.state !== 'connecting' && this.state !== 'reconnecting') {
      this.openSocket();
    }
    return waiter;
  }

  /** Resolves when the connection is open (now or later). */
  ready(): Promise<void> {
    if (this.state === 'open') return Promise.resolve();
    return this.connect();
  }

  /** Close for good: no reconnect, pending requests reject. */
  close(code = 1000, reason = 'client closed'): void {
    this.stopped = true;
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    const sock = this.socket;
    this.socket = null;
    if (sock) {
      sock.onopen = null;
      sock.onclose = null;
      sock.onerror = null;
      sock.onmessage = null;
      try {
        sock.close(code, reason);
      } catch {
        /* already dead */
      }
    }
    this.state = 'closed';
    this.failAll(new DisconnectedError('connection closed by client'));
  }

  /* ---------------- events ---------------- */

  on<K extends keyof ClientEvents & string>(
    event: K,
    listener: Listener<ClientEvents[K]>,
  ): Unsubscribe {
    return this.emitter.on(event, listener);
  }

  once<K extends keyof ClientEvents & string>(
    event: K,
    listener: Listener<ClientEvents[K]>,
  ): Unsubscribe {
    return this.emitter.once(event, listener);
  }

  off<K extends keyof ClientEvents & string>(event: K, listener: Listener<ClientEvents[K]>): void {
    this.emitter.off(event, listener);
  }

  /** Resolves the next time `event` fires. */
  nextEvent<K extends keyof ClientEvents & string>(event: K): Promise<ClientEvents[K]> {
    return this.emitter.next(event);
  }

  /* ---------------- requests ---------------- */

  /**
   * Call a PyMOL API symbol. `fn` is a dotted path resolved against `cmd` by
   * the bridge ('fragment', 'util.cbc', 'movie.produce').
   */
  call<T = Json>(
    fn: string,
    args: readonly unknown[] = [],
    kwargs: Readonly<Record<string, unknown>> = {},
  ): Promise<T> {
    const id = this.takeId();
    return this.request({ id, t: 'call', fn, args, kwargs }, id, fn) as Promise<T>;
  }

  /**
   * Run a raw PyMOL command line through `cmd.do`.
   *
   * `cmd.do` returns None and prints exceptions instead of raising
   * (packages/engine/modules/pymol/commanding.py:441-461), so the result is always null and
   * errors surface on the `feedback` stream, NOT as an `err` frame.
   */
  do(cmd: string): Promise<null> {
    const id = this.takeId();
    return this.request({ id, t: 'do', cmd }, id, `do:${cmd}`) as Promise<null>;
  }

  /** Subscribe to a topic (idempotent; remembered across reconnects). */
  async sub(topic: Topic): Promise<void> {
    this.subscriptions.add(topic);
    const id = this.takeId();
    await this.request({ id, t: 'sub', topic }, id, `sub:${topic}`);
  }

  /** Unsubscribe from a topic. */
  async unsub(topic: Topic): Promise<void> {
    this.subscriptions.delete(topic);
    const id = this.takeId();
    await this.request({ id, t: 'unsub', topic }, id, `unsub:${topic}`);
  }

  /** Topics this connection believes it is subscribed to. */
  get topics(): Topic[] {
    return [...this.subscriptions];
  }

  /* ---------------- input (fire and forget) ---------------- */

  /**
   * Input frames carry no id and get no reply. They are DROPPED when the
   * socket is not open: replaying stale mouse events after a reconnect would
   * make the camera jump.
   */
  sendInput(message: InputMessage): boolean {
    if (!this.isOpen || !this.socket) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  /** Mouse press/release. See MouseButton / ButtonState / Modifier in @tenmol/protocol. */
  button(
    button: number,
    state: number,
    x: number,
    y: number,
    mod = 0,
    when: number = nowEpochSeconds(),
  ): boolean {
    const message: InputButtonMessage = {
      t: 'input',
      kind: 'button',
      button,
      state,
      x,
      y,
      mod,
      when,
    };
    return this.sendInput(message);
  }

  /** Mouse motion with a button held. */
  drag(x: number, y: number, mod = 0, when: number = nowEpochSeconds()): boolean {
    const message: InputDragMessage = { t: 'input', kind: 'drag', x, y, mod, when };
    return this.sendInput(message);
  }

  /**
   * `{t:'ack'}` — Mode-P flow control (plan §1.3). The bridge keeps at most one
   * unacked frame in flight; without this the stream falls back to its 0.75 s
   * ack timeout and stutters. Fire and forget, dropped when closed.
   */
  ack(frameId: number, what: 'pixels' | 'geometry' = 'pixels'): boolean {
    if (!this.isOpen || !this.socket) return false;
    this.socket.send(JSON.stringify({ t: 'ack', what, frameId }));
    return true;
  }

  /** Viewport resize. */
  reshape(width: number, height: number, force = false): boolean {
    const message: InputReshapeMessage = {
      t: 'input',
      kind: 'reshape',
      width,
      height,
      force,
    };
    return this.sendInput(message);
  }

  /* ---------------- internals ---------------- */

  private takeId(): number {
    const id = this.nextId;
    // u32 space, wrapping well clear of 0 so ids stay truthy.
    this.nextId = this.nextId >= 0xffffffff ? 1 : this.nextId + 1;
    return id;
  }

  private request(message: ClientMessage, id: number, label: string): Promise<Json> {
    return new Promise<Json>((resolve, reject) => {
      const entry: Pending = { resolve, reject, label, timer: undefined };
      if (this.requestTimeoutMs > 0) {
        entry.timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new RequestTimeoutError(`${label} timed out after ${this.requestTimeoutMs}ms`));
        }, this.requestTimeoutMs);
      }
      this.pending.set(id, entry);

      if (this.isOpen && this.socket) {
        try {
          this.socket.send(JSON.stringify(message));
        } catch (cause) {
          this.settleReject(id, new DisconnectedError(`send failed: ${String(cause)}`));
        }
        return;
      }

      if (!this.queueWhileDisconnected) {
        this.settleReject(id, new DisconnectedError(`${label}: not connected`));
        return;
      }
      if (this.outbox.length >= this.maxQueuedRequests) {
        this.settleReject(
          id,
          new DisconnectedError(`${label}: outbox full (${this.maxQueuedRequests})`),
        );
        return;
      }
      this.outbox.push(message);
      if (this.state === 'idle' || this.state === 'closed') {
        if (!this.stopped) this.openSocket();
      }
    });
  }

  private settleReject(id: number, error: Error): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.reject(error);
  }

  private failAll(error: Error): void {
    const entries = [...this.pending.entries()];
    this.pending.clear();
    for (const [, entry] of entries) {
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      entry.reject(error);
    }
    const waiters = this.openWaiters;
    this.openWaiters = [];
    for (const w of waiters) w.reject(error);
  }

  private waitForOpen(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.openWaiters.push({ resolve, reject });
    });
  }

  private openSocket(): void {
    if (this.stopped) return;
    this.state = this.attempt === 0 ? 'connecting' : 'reconnecting';
    this.hello = null;

    let sock: WebSocketLike;
    try {
      sock = new this.WebSocketImpl(this.url);
    } catch (cause) {
      this.emitError(new Error(`WebSocket construction failed: ${String(cause)}`));
      this.scheduleReconnect();
      return;
    }
    this.socket = sock;
    try {
      sock.binaryType = 'arraybuffer';
    } catch {
      /* some mocks are read-only here */
    }

    sock.onopen = () => {
      if (this.socket !== sock) return;
      this.attempt = 0;
      this.state = 'open';
      this.emitter.emit('connection:open', { url: this.url, attempt: this.attempt });

      const queued = this.outbox.splice(0, this.outbox.length);

      // A `sub` issued while the socket was down is BOTH remembered in
      // `subscriptions` and queued in `outbox`. Re-subscribing it here as well
      // would put two identical sub frames on the wire for one caller (measured:
      // 8 frames for 4 topics on the first connect). The queued frame wins --
      // it carries the id the caller is awaiting.
      const queuedSubTopics = new Set<Topic>();
      for (const message of queued) {
        if (message.t === 'sub') queuedSubTopics.add(message.topic);
      }

      if (this.autoResubscribe) {
        for (const topic of this.subscriptions) {
          if (queuedSubTopics.has(topic)) continue;
          const id = this.takeId();
          // Fire and forget: a failed resubscribe surfaces on connection:error.
          this.request({ id, t: 'sub', topic }, id, `resub:${topic}`).catch((error: unknown) => {
            this.emitError(error instanceof Error ? error : new Error(String(error)));
          });
        }
      }

      for (const message of queued) {
        try {
          sock.send(JSON.stringify(message));
        } catch (cause) {
          this.emitError(new Error(`flush failed: ${String(cause)}`));
        }
      }

      const waiters = this.openWaiters;
      this.openWaiters = [];
      for (const w of waiters) w.resolve();
    };

    sock.onmessage = (ev) => {
      if (this.socket !== sock) return;
      this.handleData(ev.data);
    };

    sock.onerror = () => {
      if (this.socket !== sock) return;
      // Browsers give no detail on WebSocket errors, by design.
      this.emitError(new Error(`WebSocket error on ${this.url}`));
    };

    sock.onclose = (ev) => {
      if (this.socket !== sock) return;
      this.socket = null;
      const code = ev?.code ?? 1006;
      const reason = ev?.reason ?? '';
      const wasClean = ev?.wasClean ?? false;
      this.state = 'closed';
      this.hello = null;

      // Requests already on the wire cannot be replayed safely: PyMOL is
      // stateful and may have executed them. Reject, do not retry.
      const disconnect = new DisconnectedError(
        `connection closed (code ${code}${reason ? `, ${reason}` : ''})`,
      );
      const entries = [...this.pending.entries()];
      this.pending.clear();
      for (const [, entry] of entries) {
        if (entry.timer !== undefined) clearTimeout(entry.timer);
        entry.reject(disconnect);
      }

      this.emitter.emit('connection:close', { code, reason, wasClean });
      if (!this.stopped && this.autoReconnect) {
        this.scheduleReconnect();
      } else {
        const waiters = this.openWaiters;
        this.openWaiters = [];
        for (const w of waiters) w.reject(disconnect);
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped || !this.autoReconnect) return;
    const { initialDelayMs, maxDelayMs, factor, jitter, maxAttempts } = this.reconnectOpts;
    this.attempt += 1;
    if (maxAttempts > 0 && this.attempt > maxAttempts) {
      this.state = 'closed';
      this.failAll(new DisconnectedError(`giving up after ${maxAttempts} reconnect attempts`));
      return;
    }
    const base = Math.min(maxDelayMs, initialDelayMs * Math.pow(factor, this.attempt - 1));
    const delayMs = Math.max(
      0,
      Math.round(base * (1 + (jitter > 0 ? (Math.random() * 2 - 1) * jitter : 0))),
    );
    this.state = 'reconnecting';
    this.emitter.emit('connection:reconnecting', { attempt: this.attempt, delayMs });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.openSocket();
    }, delayMs);
  }

  private emitError(error: Error): void {
    this.emitter.emit('connection:error', { error });
  }

  private handleData(data: unknown): void {
    if (typeof data === 'string') {
      this.handleText(data);
      return;
    }
    if (data instanceof ArrayBuffer) {
      this.handleBinary(new Uint8Array(data));
      return;
    }
    if (ArrayBuffer.isView(data)) {
      // Node's `ws` delivers Buffer (a Uint8Array).
      const view = data as ArrayBufferView;
      this.handleBinary(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
      return;
    }
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      // Only reachable if binaryType could not be set; ordering is not
      // guaranteed on this path, which is why we ask for 'arraybuffer'.
      void data
        .arrayBuffer()
        .then((buf) => this.handleBinary(new Uint8Array(buf)))
        .catch((cause: unknown) => this.emitError(new Error(`blob read failed: ${String(cause)}`)));
      return;
    }
    this.emitError(new Error(`unsupported frame type: ${Object.prototype.toString.call(data)}`));
  }

  private handleBinary(bytes: Uint8Array): void {
    try {
      // decodeBinaryFrame, NOT decodeGeometryFrame: the latter throws on a
      // Mode-P pixel frame by design, which used to turn every streamed frame
      // into a connection error.
      const frame = decodeBinaryFrame(bytes);
      this.emitter.emit('binary:frame', frame);
      if (isPixelFrame(frame)) this.emitter.emit('pixels:frame', frame);
      else if (isGeometryFrame(frame)) this.emitter.emit('geometry:frame', frame);
    } catch (cause) {
      this.emitError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }

  private handleText(text: string): void {
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch (cause) {
      this.emitError(new Error(`invalid JSON frame: ${String(cause)}`));
      return;
    }

    if (isOkMessage(message)) {
      const entry = this.pending.get(message.id);
      if (!entry) {
        this.emitError(new Error(`ok for unknown request id ${message.id}`));
        return;
      }
      this.pending.delete(message.id);
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      entry.resolve(message.result);
      return;
    }

    if (isErrMessage(message)) {
      const entry = this.pending.get(message.id);
      if (!entry) {
        this.emitError(new Error(`err for unknown request id ${message.id}`));
        return;
      }
      this.pending.delete(message.id);
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      entry.reject(new PymolError(message.error, entry.label));
      return;
    }

    if (isEventMessage(message)) {
      // The union is distributive over `topic`, so this is type-safe per topic;
      // the cast collapses it to one call site.
      this.emitter.emit(message.topic as keyof ClientEvents & string, message.payload as never);
      return;
    }

    if (isFeedbackMessage(message)) {
      // Same payload shape as the `feedback` topic, so listeners only need one
      // subscription regardless of which framing the bridge used.
      this.emitter.emit('feedback', { lines: message.lines });
      return;
    }

    if (isHelloMessage(message)) {
      this.hello = message;
      this.emitter.emit('server:hello', message);
      return;
    }

    this.emitError(new Error(`unrecognised server frame: ${text.slice(0, 200)}`));
  }
}
