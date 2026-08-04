/**
 * Where the client learns that PyMOL's geometry changed. Defect **D1**.
 *
 * WHY A POLL AND NOT AN EVENT
 * ---------------------------
 * The bridge already emits the diff on the `geometry` TOPIC
 * (`RenderService._on_tick` -> `{invalidated:[...]}`), and that is the right
 * channel. The viewport package cannot reach it: `ViewportTransport`
 * (`../types.ts`, not owned here) has `input`, `call`, `onBinaryFrame` and
 * `ack` — there is no `onTopic`. Rather than reach around the contract, this
 * module accepts an OPTIONAL `onTopic` and uses it when it exists, and polls
 * `_bridge.render_stats` when it does not.
 *
 * The poll is honest about its cost, so here is the cost. Server side the whole
 * thing is a read of a table computed on the engine tick — no PyMOL call, no
 * lock on the engine, and the tick that computes it is
 * `_cmd.web_get_versions`, measured at 1.0 µs when nothing changed. Client side
 * it is one `{t:'call'}` per interval carrying `epoch`; when `epoch` has not
 * moved nothing else is even looked at.
 *
 * It also has one property an event stream does not: it is STATELESS PER
 * CLIENT. Each viewport diffs the table against its own memory, so two tabs
 * cannot desynchronise and neither pays for the other's changes — which is the
 * D4 fan-out defect, avoided here by construction rather than by fixing it.
 */

import { parseVersionTable, type VersionTable } from './cache';

/** The existing `_bridge.*` route that carries `modeG.versions`. */
export const RENDER_STATS_FN = '_bridge.render_stats';

/** Default poll period. The bridge recomputes the table at 4 Hz. */
export const DEFAULT_POLL_MS = 250;

export interface InvalidationPollerOptions {
  /** Anything with `call(fn, args, kwargs)`. */
  transport: {
    call(fn: string, args?: readonly unknown[], kwargs?: Record<string, unknown>): Promise<unknown>;
    isConnected?(): boolean;
    /** Optional push channel; see the file header. */
    onTopic?(topic: string, listener: (payload: unknown) => void): () => void;
  };
  /** Called with every table whose `epoch` differs from the last one. */
  onTable(table: VersionTable): void;
  intervalMs?: number;
  onError?: (error: Error) => void;
}

export interface InvalidationPollerStats {
  /** Round trips issued. */
  polls: number;
  /** Polls whose `epoch` had moved. Idle scenes must keep this at 0. */
  epochChanges: number;
  /** Polls skipped because one was still in flight. */
  skipped: number;
  errors: number;
  lastEpoch: number;
  /** False when the bridge is running the old inexact fingerprint. */
  exact: boolean;
  /** True when a `geometry` topic subscription is doing the work instead. */
  push: boolean;
}

export interface InvalidationPoller {
  readonly stats: InvalidationPollerStats;
  start(): void;
  stop(): void;
  /** One immediate poll, outside the timer. Resolves when it has landed. */
  poll(): Promise<void>;
  readonly running: boolean;
}

export function createInvalidationPoller(options: InvalidationPollerOptions): InvalidationPoller {
  const { transport, onTable } = options;
  const intervalMs = Math.max(16, options.intervalMs ?? DEFAULT_POLL_MS);

  let timer: ReturnType<typeof setInterval> | null = null;
  let unsubscribeTopic: (() => void) | null = null;
  let inFlight = false;
  let lastEpoch = -1;

  const stats: InvalidationPollerStats = {
    polls: 0,
    epochChanges: 0,
    skipped: 0,
    errors: 0,
    lastEpoch: -1,
    exact: false,
    push: false,
  };

  const consume = (result: unknown): void => {
    const table = parseVersionTable(result);
    if (table === null) {
      // An old bridge, or a payload this build does not recognise. Reporting
      // it as inexact is the whole answer: acting on a table we could not read
      // is how live geometry gets dropped.
      stats.exact = false;
      return;
    }
    stats.exact = table.exact;
    if (table.epoch === lastEpoch) return;
    lastEpoch = table.epoch;
    stats.lastEpoch = table.epoch;
    stats.epochChanges++;
    onTable(table);
  };

  const poll = async (): Promise<void> => {
    if (inFlight) {
      stats.skipped++;
      return;
    }
    if (transport.isConnected?.() === false) return;
    inFlight = true;
    stats.polls++;
    try {
      consume(await transport.call(RENDER_STATS_FN, [], {}));
    } catch (cause) {
      stats.errors++;
      options.onError?.(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      inFlight = false;
    }
  };

  return {
    stats,
    get running(): boolean {
      return timer !== null || unsubscribeTopic !== null;
    },

    start(): void {
      if (timer !== null || unsubscribeTopic !== null) return;
      if (typeof transport.onTopic === 'function') {
        // A bridge event only tells us SOMETHING changed; the table is still
        // the authority, so the event triggers a poll rather than being
        // parsed. That keeps exactly one code path for the diff.
        stats.push = true;
        unsubscribeTopic = transport.onTopic('geometry', () => {
          void poll();
        });
      }
      timer = setInterval(() => {
        void poll();
      }, intervalMs);
      void poll();
    },

    stop(): void {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      unsubscribeTopic?.();
      unsubscribeTopic = null;
      stats.push = false;
    },

    poll,
  };
}
