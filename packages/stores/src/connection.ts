/**
 * Transport state, told honestly.
 *
 * `@tenmol/client`'s `ConnectionState` has five values — idle, connecting, open,
 * reconnecting, closed — and they are not enough to be truthful to a user. Three
 * distinct situations all arrive as `closed`:
 *
 *   * the bridge is not running          -> retry forever, this is normal
 *   * the bridge rejected the token      -> `ws.close(code=4401)` (server.py),
 *                                           retrying is pointless and infinite
 *   * the origin/peer was rejected       -> `ws.close(code=4403)` (server.py)
 *
 * and one more is invisible to the transport entirely: the socket is open, but
 * the ENGINE behind it is degraded (`--no-pymol`) or headless (no offscreen GL).
 * The bridge reports that in its `hello` frame (`server.py: BridgeServer.hello`),
 * so it belongs here, next to the socket state, not buried in a viewport.
 *
 * Nothing in this file talks to a socket. The app wires `@tenmol/client` events
 * into these transitions (`apps/web/src/app/session.ts`).
 */

import { createStore, type Store } from './createStore';

/** The four WebSocket close codes the bridge uses deliberately. */
export const CLOSE_CODE = {
  /** Normal client-initiated close. */
  Normal: 1000,
  /** No close frame — the process went away. The usual "bridge not running". */
  Abnormal: 1006,
  /** `server.py`: bad or missing token. */
  Unauthorized: 4401,
  /** `server.py`: non-loopback peer, or Origin not in the allow-list. */
  Forbidden: 4403,
} as const;

/**
 * `idle | connecting | open | reconnecting | closed` mirror `@tenmol/client`.
 * `unauthorized` and `forbidden` are terminal: the client stops retrying,
 * because nothing about retrying changes the answer.
 */
export type ConnectionPhase =
  'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'unauthorized' | 'forbidden';

/** `pump.EngineState`, reported in the bridge's `hello` frame. */
export type EngineState = 'running' | 'headless' | 'degraded' | 'unknown';

export interface BridgeHello {
  pymolVersion: string;
  protocolVersion: number;
  /** `running` | `headless` | `degraded` — see `bridge/tenmol_bridge/engine.py`. */
  state?: string;
  width?: number;
  height?: number;
  gl?: { backend?: string; renderer?: string; version?: string; available?: boolean } | null;
  /** Symbols this build refuses because they are Incentive-only (plan §B7). */
  incentiveOnly?: unknown;
}

export interface ConnectionState {
  phase: ConnectionPhase;
  url: string;
  /** True once a token was supplied (never the token itself — it is not UI state). */
  hasToken: boolean;
  /** Reconnect attempt number; 0 while open. */
  attempt: number;
  /** Delay of the reconnect currently scheduled, ms. */
  retryInMs: number;
  /** Last WebSocket close code, or null if we have never been closed. */
  closeCode: number | null;
  closeReason: string;
  /** Human-readable last transport error. Never cleared by a retry, only by an open. */
  lastError: string | null;
  hello: BridgeHello | null;
  /** Epoch ms of the last successful open. */
  openedAt: number | null;
  /** Successful opens this session — 2+ means we have reconnected at least once. */
  opens: number;
  /** `cmd.get_progress()`, pushed on the `progress` topic. -1 when idle. */
  progress: number;
}

export interface ConnectionStore extends Store<ConnectionState> {
  setPhase(phase: ConnectionPhase, patch?: Partial<ConnectionState>): void;
  opened(): void;
  closed(code: number, reason: string): void;
  reconnecting(attempt: number, delayMs: number): void;
  failed(message: string): void;
  setHello(hello: BridgeHello): void;
  setProgress(value: number): void;
}

export function createConnectionStore(url: string, hasToken: boolean): ConnectionStore {
  const store = createStore<ConnectionState>({
    phase: 'idle',
    url,
    hasToken,
    attempt: 0,
    retryInMs: 0,
    closeCode: null,
    closeReason: '',
    lastError: null,
    hello: null,
    openedAt: null,
    opens: 0,
    progress: -1,
  });

  return {
    ...store,

    setPhase(phase, patch = {}) {
      store.set({ phase, ...patch });
    },

    opened() {
      store.set((state) => ({
        phase: 'open',
        attempt: 0,
        retryInMs: 0,
        lastError: null,
        closeCode: null,
        closeReason: '',
        openedAt: Date.now(),
        opens: state.opens + 1,
      }));
    },

    closed(code, reason) {
      const phase: ConnectionPhase =
        code === CLOSE_CODE.Unauthorized
          ? 'unauthorized'
          : code === CLOSE_CODE.Forbidden
            ? 'forbidden'
            : 'closed';
      store.set({
        phase,
        closeCode: code,
        closeReason: reason,
        hello: null,
        progress: -1,
        lastError: describeClose(code, reason),
      });
    },

    reconnecting(attempt, delayMs) {
      store.set({ phase: 'reconnecting', attempt, retryInMs: delayMs });
    },

    failed(message) {
      store.set({ lastError: message });
    },

    setHello(hello) {
      store.set({ hello });
    },

    setProgress(value) {
      store.set({ progress: value });
    },
  };
}

/** The engine state behind an open socket, or `'unknown'` before `hello`. */
export function engineState(state: ConnectionState): EngineState {
  const value = state.hello?.state;
  if (value === 'running' || value === 'headless' || value === 'degraded') return value;
  return 'unknown';
}

/** One short line for the status bar. Never lies, never says "connected" when it is not. */
export function describeConnection(state: ConnectionState): string {
  switch (state.phase) {
    case 'idle':
      return 'not connected';
    case 'connecting':
      return `connecting to ${state.url}`;
    case 'open': {
      const engine = engineState(state);
      return engine === 'running' || engine === 'unknown' ? 'connected' : `connected (${engine})`;
    }
    case 'reconnecting':
      return `reconnecting in ${Math.round(state.retryInMs)} ms (attempt ${state.attempt})`;
    case 'closed':
      return state.lastError ?? 'disconnected';
    case 'unauthorized':
      return state.hasToken ? 'rejected: bad session token' : 'rejected: session token required';
    case 'forbidden':
      return 'rejected: origin or peer not allowed';
  }
}

function describeClose(code: number, reason: string): string {
  const detail = reason ? `: ${reason}` : '';
  switch (code) {
    case CLOSE_CODE.Normal:
      return 'disconnected';
    case CLOSE_CODE.Abnormal:
      return 'bridge not reachable (no close frame)';
    case CLOSE_CODE.Unauthorized:
      return 'bridge rejected the session token (4401)';
    case CLOSE_CODE.Forbidden:
      return 'bridge rejected this origin or peer (4403)';
    default:
      return `socket closed (${code}${detail})`;
  }
}
