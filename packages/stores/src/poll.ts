/**
 * The state tick.
 *
 * Plan §1.5: "30 Hz focused / 4 Hz hidden". Three rules make that safe:
 *
 *  1. NEVER OVERLAP. One pass at a time. If a pass takes longer than the
 *     interval the next one starts when it finishes, not on a fixed timer, so a
 *     slow engine cannot grow an unbounded queue of polls behind it.
 *  2. HIDDEN IS CHEAP. `document.visibilityState === 'hidden'` drops to 4 Hz.
 *     (Browsers also clamp background timers to ~1 Hz on their own; this makes
 *     the intent explicit rather than depending on that.)
 *  3. DISABLED IS SILENT. While `isEnabled()` is false — the socket is down —
 *     the loop keeps its heartbeat but runs nothing, so reconnecting resumes
 *     instantly without a burst of stale requests.
 *
 * `kick()` runs a pass as soon as the current one finishes. The app calls it
 * after every mutating command, which is the other half of plan §1.5: the
 * command-echo invalidation channel. Polling alone would leave up to 33 ms of
 * lag on a button press; kicking makes a click feel synchronous.
 */

export interface PollerOptions {
  /** One pass. Rejections go to `onError`; they never stop the loop. */
  run: () => Promise<void>;
  /** Poll rate while the document is visible. Default 30. */
  focusedHz?: number;
  /** Poll rate while `document.visibilityState === 'hidden'`. Default 4. */
  hiddenHz?: number;
  /** While false, the loop idles without calling `run`. Default: always true. */
  isEnabled?: () => boolean;
  onError?: (error: unknown) => void;
}

export interface Poller {
  start(): void;
  stop(): void;
  /** Request an extra pass at the earliest opportunity. */
  kick(): void;
  readonly running: boolean;
  stats(): PollerStats;
}

export interface PollerStats {
  passes: number;
  errors: number;
  kicks: number;
  /** Duration of the last pass, ms. */
  lastMs: number;
  /** Slowest pass this session, ms. */
  maxMs: number;
  hz: number;
}

const DEFAULT_FOCUSED_HZ = 30;
const DEFAULT_HIDDEN_HZ = 4;

export function createPoller(options: PollerOptions): Poller {
  const focusedHz = options.focusedHz ?? DEFAULT_FOCUSED_HZ;
  const hiddenHz = options.hiddenHz ?? DEFAULT_HIDDEN_HZ;
  const isEnabled = options.isEnabled ?? (() => true);

  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let kicked = false;
  const stats: PollerStats = {
    passes: 0,
    errors: 0,
    kicks: 0,
    lastMs: 0,
    maxMs: 0,
    hz: focusedHz,
  };

  function currentHz(): number {
    // `document` is absent under vitest's node environment; the poller must
    // still be constructible there.
    const doc = (globalThis as { document?: { visibilityState?: string } }).document;
    return doc?.visibilityState === 'hidden' ? hiddenHz : focusedHz;
  }

  function schedule(delayMs: number): void {
    if (!running) return;
    timer = setTimeout(tick, delayMs);
  }

  async function tick(): Promise<void> {
    timer = undefined;
    if (!running) return;

    const hz = currentHz();
    stats.hz = hz;
    const interval = 1000 / Math.max(hz, 0.1);

    if (inFlight || !isEnabled()) {
      schedule(interval);
      return;
    }

    inFlight = true;
    kicked = false;
    const started = now();
    try {
      stats.passes += 1;
      await options.run();
    } catch (error) {
      stats.errors += 1;
      options.onError?.(error);
    } finally {
      inFlight = false;
      stats.lastMs = now() - started;
      if (stats.lastMs > stats.maxMs) stats.maxMs = stats.lastMs;
    }

    // A kick that arrived DURING the pass must not be swallowed: the state it
    // wanted to see may have changed after we read it.
    schedule(kicked ? 0 : Math.max(0, interval - stats.lastMs));
  }

  return {
    start() {
      if (running) return;
      running = true;
      schedule(0);
    },

    stop() {
      running = false;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },

    kick() {
      stats.kicks += 1;
      kicked = true;
      if (!running || inFlight) return;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      schedule(0);
    },

    get running() {
      return running;
    },

    stats() {
      return { ...stats };
    },
  };
}

function now(): number {
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  return perf ? perf.now() : Date.now();
}
