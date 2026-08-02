import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { createClient } from '@tenmol/client';
import type { ConnectionState, PymolClient } from '@tenmol/client';
import type { InputMessage, Topic } from './protocol';
import { BRIDGE_URL } from './protocol';

/**
 * The one place apps/web touches the transport.
 *
 * `@tenmol/client` owns the socket, request/response correlation, reconnect,
 * topic subscriptions and binary geometry frames. This provider only:
 *   - creates the client once and opens it,
 *   - mirrors connection state and the server `hello` into React state,
 *   - accumulates `{t:'feedback', lines}` into the scrollback the shell renders,
 *   - subscribes to the topics the shell itself needs.
 *
 * Failure is not an error condition here: the desktop app starts before (or without)
 * the bridge, so a closed socket is a normal, visible state -- the status strip shows
 * it and the client retries with backoff.
 */

export interface Bridge {
  status: ConnectionState;
  url: string;
  /** From the server `hello` frame; null until connected. */
  pymolVersion: string | null;

  /** `{ id, t:'call', fn, args, kwargs }` */
  call(fn: string, args?: unknown[], kwargs?: Record<string, unknown>): Promise<unknown>;
  /** `{ id, t:'do', cmd }` -- raw command line: the console AND every menu leaf. */
  do(cmd: string): Promise<unknown>;
  /** `{ t:'input', ... }` -- fire and forget, dropped while the socket is down. */
  input(msg: InputMessage): void;
  sub(topic: Topic): Promise<void>;
  unsub(topic: Topic): Promise<void>;

  /** Feedback scrollback, newest last. */
  feedback: string[];
  appendFeedback(lines: string[]): void;
  clearFeedback(): void;
}

const BridgeContext = createContext<Bridge | null>(null);

/** OrthoSaveLines (0xFF) -- the size of PyMOL's own scrollback ring, packages/engine/layer1/Ortho.cpp. */
const MAX_FEEDBACK_LINES = 255;

/**
 * Topics the shell itself renders. Others (`view`, `geometry`, `selection`) are
 * subscribed by the packages that consume them, not here.
 */
const SHELL_TOPICS: Topic[] = ['objects', 'frame', 'settings', 'feedback'];

export function BridgeProvider({ children }: { children: ReactNode }) {
  const clientRef = useRef<PymolClient | null>(null);
  if (clientRef.current === null) {
    clientRef.current = createClient({ url: BRIDGE_URL });
  }
  const client = clientRef.current;

  const [status, setStatus] = useState<ConnectionState>(client.conn.connectionState);
  const [pymolVersion, setPymolVersion] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string[]>([]);

  const appendFeedback = useCallback((lines: string[]) => {
    if (lines.length === 0) return;
    setFeedback((prev) => {
      const next = prev.concat(lines);
      return next.length > MAX_FEEDBACK_LINES ? next.slice(next.length - MAX_FEEDBACK_LINES) : next;
    });
  }, []);

  const clearFeedback = useCallback(() => setFeedback([]), []);

  useEffect(() => {
    const conn = client.conn;
    const sync = () => setStatus(conn.connectionState);
    const offs = [
      conn.on('connection:open', sync),
      conn.on('connection:close', ({ code, reason }) => {
        sync();
        appendFeedback([` bridge closed (${code}${reason ? ' ' + reason : ''})`]);
      }),
      conn.on('connection:error', ({ error }) => {
        sync();
        appendFeedback([` bridge error: ${error.message}`]);
      }),
      conn.on('connection:reconnecting', ({ attempt, delayMs }) => {
        sync();
        appendFeedback([` bridge reconnecting (attempt ${attempt}, ${delayMs} ms)`]);
      }),
      conn.on('server:hello', (hello) => {
        setPymolVersion(hello.pymolVersion);
        appendFeedback([
          ` connected to PyMOL ${hello.pymolVersion} (protocol v${hello.protocolVersion})`,
        ]);
      }),
      conn.on('feedback', ({ lines }) => appendFeedback(lines)),
    ];
    sync();
    void conn.connect().catch(() => undefined);
    sync();
    // Subscribe exactly once. Requests issued while the socket is down are queued and
    // flushed on open (queueWhileDisconnected), and the connection re-sends every live
    // subscription itself after a reconnect (autoResubscribe) -- so doing this from a
    // 'connection:open' handler would send each `sub` twice.
    for (const topic of SHELL_TOPICS) {
      void conn.sub(topic).catch(() => undefined);
    }
    return () => {
      for (const off of offs) off();
      conn.close();
    };
  }, [client, appendFeedback]);

  const bridge = useMemo<Bridge>(
    () => ({
      status,
      url: client.conn.url,
      pymolVersion,
      call: (fn, args = [], kwargs = {}) => client.conn.call(fn, args, kwargs),
      do: (cmd) => client.conn.do(cmd),
      input: (msg) => {
        client.conn.sendInput(msg);
      },
      sub: (topic) => client.conn.sub(topic),
      unsub: (topic) => client.conn.unsub(topic),
      feedback,
      appendFeedback,
      clearFeedback,
    }),
    [client, status, pymolVersion, feedback, appendFeedback, clearFeedback],
  );

  return <BridgeContext.Provider value={bridge}>{children}</BridgeContext.Provider>;
}

export function useBridge(): Bridge {
  const ctx = useContext(BridgeContext);
  if (!ctx) throw new Error('useBridge must be used inside <BridgeProvider>');
  return ctx;
}
