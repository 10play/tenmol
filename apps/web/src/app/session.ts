/**
 * The session: one socket, one set of stores, one poll loop.
 *
 * This is the only place in `apps/web` that touches `@tenmol/client`. Features
 * get `useSession()` and call `run` / `act` / `call`; they never see the
 * transport.
 *
 * IT IS A MODULE SINGLETON, ON PURPOSE. The product is "one PyMOL process, one
 * browser client" — a second connection would be a second consumer of a
 * destructive feedback drain, which plan §1.2 measured splitting the stream
 * (`consumerA saw: [468]`, `consumerB saw: []`). Making it a singleton also
 * makes React 19 StrictMode's double-mount a non-event: the socket is created on
 * first import and never torn down by a component unmounting.
 */

import { createRemoteBackend, type Backend } from '@tenmol/client';
import { createLocalBackend } from '@tenmol/engine-ts';
import {
  createConnectionStore,
  createFeedbackStore,
  createObjectsSource,
  createObjectsStore,
  createPoller,
  createUiStore,
  CLOSE_CODE,
  type ObjectsSource,
  type PanelAction,
  type PanelRow,
  type Poller,
  type ConnectionStore,
  type FeedbackStore,
  type ObjectsStore,
  type UiStore,
} from '@tenmol/stores';
import type { ObjectRow, Topic } from '@tenmol/protocol';

import { resolveBridgeConfig, withToken, type BridgeConfig } from './config';

/** Topics the shell itself consumes. Features subscribe to their own. */
const SHELL_TOPICS: Topic[] = ['feedback', 'progress', 'objects'];

export interface SessionStores {
  connection: ConnectionStore;
  feedback: FeedbackStore;
  objects: ObjectsStore;
  ui: UiStore;
}

export interface Session {
  config: BridgeConfig;
  /** The active engine, behind the abstract `Backend` interface. */
  conn: Backend;
  stores: SessionStores;
  objectsSource: ObjectsSource;
  poller: Poller;

  /** A user-typed command line: `{t:'do'}`, echoed by PyMOL itself. */
  run(commandLine: string): Promise<void>;
  /** A UI-issued action: `{t:'call'}` plus a dim client-side echo. */
  act(action: PanelAction): Promise<void>;
  /** Raw typed call. Errors are reported in the console and re-thrown. */
  call<T = unknown>(
    fn: string,
    args?: readonly unknown[],
    kwargs?: Readonly<Record<string, unknown>>,
  ): Promise<T>;

  reconnect(): void;
  disconnect(): void;
  /** Store a new session token and reconnect with it. */
  useToken(token: string | null): void;
  /** `GET /healthz` — works without a token, so it can explain a 4401. */
  probeHealth(): Promise<Record<string, unknown>>;
}

let singleton: Session | null = null;

export function getSession(): Session {
  if (!singleton) singleton = createSession(resolveBridgeConfig());
  return singleton;
}

function createSession(initialConfig: BridgeConfig): Session {
  let config = initialConfig;

  const stores: SessionStores = {
    connection: createConnectionStore(config.displayUrl, config.token !== null),
    feedback: createFeedbackStore(),
    objects: createObjectsStore(),
    ui: createUiStore(),
  };

  // THE ABSTRACT SWITCH. `config.backend` (subdomain / env / `?backend=`) picks
  // the engine; from here down nothing in this file — or in the stores, viewport
  // or features — knows or cares which one it got. That is the whole point.
  const conn: Backend =
    config.backend === 'local'
      ? createLocalBackend({ url: config.displayUrl })
      : createRemoteBackend({
          url: config.url,
          autoReconnect: true,
          // PyMOL calls can legitimately take minutes (`ray`, `mpng`), so there
          // is no request timeout. A dead socket rejects everything pending.
          requestTimeoutMs: 0,
          reconnect: { initialDelayMs: 300, maxDelayMs: 5000, factor: 1.8, jitter: 0.2 },
        });

  const objectsSource = createObjectsSource({
    call: (fn, args, kwargs) => conn.call(fn, args ?? [], kwargs ?? {}),
    store: stores.objects,
  });

  const poller = createPoller({
    // Plan §1.5: 30 Hz focused, 4 Hz hidden.
    focusedHz: 30,
    hiddenHz: 4,
    isEnabled: () => conn.isOpen,
    run: () => objectsSource.poll(),
    onError: (error) => stores.objects.setError(errorText(error)),
  });

  /* ---------------- transport -> stores ---------------- */

  conn.on('connection:open', () => {
    // The bridge replays its whole feedback ring on `{t:'sub',topic:'feedback'}`
    // — including on the resubscribe `@tenmol/client` performs automatically
    // after a reconnect. Open the dedupe window BEFORE that lands.
    stores.feedback.beginReplayWindow();
    stores.connection.opened();
    objectsSource.invalidate();
    poller.kick();
  });

  conn.on('connection:close', ({ code, reason }) => {
    stores.connection.closed(code ?? CLOSE_CODE.Abnormal, reason ?? '');
    if (code === CLOSE_CODE.Unauthorized || code === CLOSE_CODE.Forbidden) {
      // Retrying cannot change the answer: stop, and say why. `close()` sets the
      // client's `stopped` flag, and this listener runs before the client
      // schedules its own reconnect, so no retry is ever attempted.
      conn.close(1000, 'rejected by bridge');
      stores.feedback.appendClient(
        code === CLOSE_CODE.Unauthorized
          ? '-- bridge rejected the session token (4401). Enter a token to reconnect. --'
          : '-- bridge rejected this origin or peer (4403). --',
        'error',
      );
    }
  });

  conn.on('connection:reconnecting', ({ attempt, delayMs }) => {
    stores.connection.reconnecting(attempt, delayMs);
  });

  conn.on('connection:error', ({ error }) => {
    stores.connection.failed(error.message);
  });

  conn.on('server:hello', (hello) => {
    stores.connection.setHello(hello);
    const engine = (hello as { state?: string }).state ?? 'running';
    stores.feedback.appendClient(
      `-- connected to PyMOL ${hello.pymolVersion} (protocol v${hello.protocolVersion}, engine ${engine}) --`,
    );
    if (engine !== 'running') {
      stores.feedback.appendClient(
        engine === 'degraded'
          ? '-- the bridge is running WITHOUT PyMOL (--no-pymol): every call will fail --'
          : '-- the bridge has no offscreen GL: picking, Mode P and the deferred draw queue are unavailable --',
        'warning',
      );
    }
  });

  conn.on('feedback', ({ lines }) => {
    stores.feedback.appendServer(lines);
  });

  conn.on('progress', (payload) => {
    // FIELD-NAME DISAGREEMENT, read defensively rather than silently showing 0%:
    // `ProgressPayload` (packages/protocol/src/topics/progress.ts) declares
    // `fraction`, while the running bridge emits `{"value": <float>}`
    // (`server.py: BridgeServer._on_status`). Reported upstream to WP-03.
    const record = payload as unknown as Record<string, unknown>;
    const value = record['fraction'] ?? record['value'];
    stores.connection.setProgress(typeof value === 'number' ? value : -1);
  });

  // WP-12's bridge endpoint is not landed yet, so this never fires today; when
  // it does, the store switches source and the poller idles (`poll()` returns
  // immediately once `source === 'topic'`).
  conn.on('objects', (payload) => {
    const rows = payload?.objects;
    if (Array.isArray(rows)) objectsSource.adoptTopic(rows.map(toPanelRow));
  });

  /* ---------------- open ---------------- */

  stores.connection.setPhase('connecting');
  void conn.connect().catch(() => undefined);
  for (const topic of SHELL_TOPICS) {
    // Queued while the socket is down and flushed on open; the client also
    // re-sends every live subscription itself after a reconnect, so this must
    // happen exactly once (the verified double-subscribe fix in WP-05).
    void conn.sub(topic).catch(() => undefined);
  }
  poller.start();

  /* ---------------- actions ---------------- */

  async function run(commandLine: string): Promise<void> {
    const line = commandLine.trim();
    if (line === '') return;
    if (!conn.isOpen) {
      // Offline: nothing will echo it back, so echo it here (and only here —
      // double echo was a real bug, plan §6 WP-11).
      stores.feedback.appendClient(`PyMOL>${line}`, 'prompt');
      stores.feedback.appendClient(' not connected to a bridge; command not executed', 'error');
      return;
    }
    try {
      await conn.do(line);
    } catch (error) {
      stores.feedback.appendClient(` ${errorText(error)}`, 'error');
    } finally {
      // `cmd.do` can do anything at all -> the bridge classifies it as
      // `resync` (policy/base.py INVALIDATES). Drop every cache and re-poll now.
      objectsSource.invalidate();
      poller.kick();
    }
  }

  async function act(action: PanelAction): Promise<void> {
    if (stores.ui.get().echoActions) {
      // PyMOL's own panel logs the equivalent command line to the log file
      // (`ExecutiveSpecSetVisibility`, packages/engine/layer3/Executive.cpp:15413-15487). Here
      // it goes to the console, dimmed and marked client-origin, so a button
      // press is never mistaken for PyMOL output.
      stores.feedback.appendClient(action.echo);
    }
    try {
      await conn.call(action.fn, action.args, action.kwargs ?? {});
    } catch (error) {
      stores.feedback.appendClient(` ${errorText(error)}`, 'error');
    } finally {
      if (action.invalidatesNames) objectsSource.invalidate();
      poller.kick();
    }
  }

  /**
   * A raw typed call. It REJECTS and does not write to the console.
   *
   * It used to log every failure, and that was wrong: a feature polling a
   * not-yet-implemented symbol (measured: the viewport's
   * `_bridge.set_pixel_stream`, once per reconnect attempt, ` NotAllowed:
   * '_bridge' is not an addressable namespace`) filled the user's PyMOL console
   * with another feature's plumbing. Only a USER-INITIATED action writes to the
   * console — `run()` and `act()` do; a caller that wants more can
   * `session.stores.feedback.appendClient(...)` itself.
   */
  function call<T>(
    fn: string,
    args: readonly unknown[] = [],
    kwargs: Readonly<Record<string, unknown>> = {},
  ): Promise<T> {
    return conn.call<T>(fn, args, kwargs);
  }

  const session: Session = {
    get config() {
      return config;
    },
    conn,
    stores,
    objectsSource,
    poller,
    run,
    act,
    call,

    reconnect(): void {
      stores.connection.setPhase('connecting');
      void conn.connect().catch(() => undefined);
    },

    disconnect(): void {
      conn.close(1000, 'closed by user');
      stores.connection.setPhase('closed', { lastError: 'disconnected by you' });
    },

    useToken(token: string | null): void {
      config = withToken(config, token);
      // `PymolConnection.url` is readonly and fixed at construction, so a token
      // change means a new socket. Reloading is the honest way to get one
      // without leaving the old connection's listeners attached to a stale
      // store; the token is already persisted by `withToken`.
      window.location.reload();
    },

    async probeHealth(): Promise<Record<string, unknown>> {
      const response = await fetch(`${config.httpOrigin}/healthz`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`/healthz -> HTTP ${response.status}`);
      return (await response.json()) as Record<string, unknown>;
    },
  };

  if (import.meta.env.DEV) {
    // Development handle. A headless-browser test (and a human in devtools)
    // needs to force a socket drop without killing the bridge, and to read the
    // stores without a React tree: `__tenmol.conn.close(); __tenmol.reconnect()`
    // is how the feedback replay-dedupe path is exercised end to end.
    (globalThis as unknown as { __tenmol?: Session }).__tenmol = session;
  }

  return session;
}

/** `ObjectsPayload.objects` (WP-12) -> the panel's row shape. */
function toPanelRow(row: ObjectRow): PanelRow {
  return {
    ...row,
    isGroup: row.type === 'object:group',
    cloaked: false,
    isAll: row.name === 'all',
    atoms: null,
    nestInferred: false,
  };
}

export function errorText(error: unknown): string {
  if (error instanceof Error) {
    // `PymolError` carries the Python class name; showing it is the difference
    // between "something failed" and "NotAllowed: no such symbol".
    const type = (error as { type?: string }).type;
    return type && type !== error.name ? `${type}: ${error.message}` : error.message;
  }
  return String(error);
}
