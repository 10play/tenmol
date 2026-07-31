/**
 * Drag coalescing that does NOT depend on `requestAnimationFrame`.
 *
 * WHY THIS EXISTS (defect D3a, reproduced): the first implementation held the
 * latest drag position and flushed it from a `requestAnimationFrame` callback.
 * rAF is not a clock — it is a *presentation* callback, and every browser stops
 * it outright when the page is not being presented:
 *
 *   * a background / occluded tab (Chrome, Safari, Firefox: 0 callbacks),
 *   * a page being captured but not composited, a minimised window,
 *   * `document.hidden` under an automation driver, which is exactly the state
 *     a remote-control or kiosk client sits in,
 *   * and, without stopping it, any long task on the main thread simply
 *     *starves* it — the flush inherits the jank instead of coalescing it.
 *
 * Pointer events keep being delivered in all of those states. So the positions
 * piled up in the "pending" slot and were sent as ONE drag at `pointerup`:
 * PyMOL saw a press, a single huge delta and a release, and the camera jumped
 * once at the end instead of tracking. Measured with rAF stopped: 0 drag
 * messages during a 1 s, 60-sample drag; 1 at release.
 *
 * The fix is to drive the flush from the event stream itself with a real clock:
 *
 *   * every sample opens (or joins) a budget window of `budgetMs`;
 *   * a sample that arrives when the window has already elapsed is flushed
 *     SYNCHRONOUSLY, inside the pointer handler — no timer, no rAF, so the
 *     tracking rate is bounded by the input rate, not by presentation;
 *   * a sample that arrives inside the window is coalesced, and a `setTimeout`
 *     covers the case where it turns out to be the last one. Background tabs
 *     clamp timers to ~1 Hz, but a *moving* pointer flushes on its own events,
 *     so the clamp only ever delays the final resting position — which
 *     `flush()` at `pointerup` sends anyway.
 *
 * INVARIANTS (the backend's timing logic depends on all four):
 *
 *   1. ORDER is never changed. One slot, last write wins, flushed in place.
 *   2. `when` is carried, never rewritten: `SceneDrag`/`SceneButton` measure
 *      the 0.35 s double-click, 0.25 s single-click and 4 px/10 px drag
 *      thresholds against the client-supplied event time
 *      (`layer1/Scene.cpp:4113-4155`).
 *   3. The FINAL position is never lost: `flush()` is called before every
 *      button message and at gesture end.
 *   4. At most one flush per `budgetMs`, so a 1000 Hz mouse cannot outrun the
 *      bridge. Dropping an intermediate position is safe (`SceneDrag` reads the
 *      current position against the press position); dropping the last one, or
 *      reordering, is not.
 */

export interface DragSample {
  x: number;
  y: number;
  mod: number;
  /** Epoch seconds from the ORIGINATING event (see `./coords.ts`). */
  when: number;
}

export type FlushReason = 'event' | 'timer' | 'forced';

export interface DragCoalescerOptions {
  /** Called with the surviving sample. Must send it immediately, in order. */
  flush: (sample: DragSample, reason: FlushReason) => void;
  /** Minimum spacing between flushes. Default 1000/60 ms. */
  budgetMs?: number;
  /** Monotonic clock in ms. Default `performance.now()`. */
  now?: () => number;
  /** Injectable timers (tests, and environments without a global). */
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface DragCoalescerStats {
  /** Samples pushed. */
  samples: number;
  /** Samples dropped because a newer one replaced them before the flush. */
  coalesced: number;
  /** Flushes total, and by trigger. */
  flushes: number;
  eventFlushes: number;
  timerFlushes: number;
  forcedFlushes: number;
  /** Longest observed gap between two flushes of one gesture, in ms. */
  maxGapMs: number;
}

export interface DragCoalescer {
  /** Start a gesture: opens a fresh budget window at `atMs` (default now). */
  begin(atMs?: number): void;
  /** Offer a position. May flush synchronously. */
  push(sample: DragSample): void;
  /** Send the pending sample right now, if any. Ordering barrier. */
  flush(): void;
  /** `flush()` + stop the timer. Call at `pointerup`/cancel. */
  end(): void;
  /** Drop everything without sending. Only for teardown. */
  destroy(): void;
  readonly pending: boolean;
  readonly stats: DragCoalescerStats;
}

/** 60 Hz. The bridge caps Mode P at 60 fps too (`StreamParams.max_fps`). */
export const DEFAULT_DRAG_BUDGET_MS = 1000 / 60;

function defaultNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export function createDragCoalescer(options: DragCoalescerOptions): DragCoalescer {
  const budgetMs = options.budgetMs ?? DEFAULT_DRAG_BUDGET_MS;
  const now = options.now ?? defaultNow;
  const setTimer =
    options.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer =
    options.clearTimer ??
    ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  const stats: DragCoalescerStats = {
    samples: 0,
    coalesced: 0,
    flushes: 0,
    eventFlushes: 0,
    timerFlushes: 0,
    forcedFlushes: 0,
    maxGapMs: 0,
  };

  let pending: DragSample | null = null;
  let timer: unknown = null;
  /** Start of the current budget window. `null` = no window open yet. */
  let windowAt: number | null = null;
  let lastFlushAt: number | null = null;

  const stopTimer = (): void => {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  };

  const emit = (reason: FlushReason): void => {
    stopTimer();
    const sample = pending;
    if (sample === null) return;
    pending = null;
    const at = now();
    if (lastFlushAt !== null) {
      const gap = at - lastFlushAt;
      if (gap > stats.maxGapMs) stats.maxGapMs = gap;
    }
    lastFlushAt = at;
    windowAt = at;
    stats.flushes++;
    if (reason === 'event') stats.eventFlushes++;
    else if (reason === 'timer') stats.timerFlushes++;
    else stats.forcedFlushes++;
    // The sample is handed over exactly as it was captured: same coordinates,
    // same modifier mask, same `when`.
    options.flush(sample, reason);
  };

  const arm = (delayMs: number): void => {
    if (timer !== null) return;
    timer = setTimer(
      () => {
        timer = null;
        emit('timer');
      },
      Math.max(0, delayMs),
    );
  };

  return {
    begin(atMs?: number): void {
      stopTimer();
      pending = null;
      windowAt = atMs ?? now();
      lastFlushAt = null;
      stats.maxGapMs = 0;
    },

    push(sample: DragSample): void {
      stats.samples++;
      if (pending !== null) stats.coalesced++;
      pending = sample;
      const at = now();
      if (windowAt === null) windowAt = at;
      const elapsed = at - windowAt;
      if (elapsed >= budgetMs) {
        // The budget has already been paid for. Send inside the event handler:
        // this is the path that keeps working when rAF is dead and when timers
        // are clamped to 1 Hz, because it needs neither.
        emit('event');
        return;
      }
      arm(budgetMs - elapsed);
    },

    flush(): void {
      emit('forced');
    },

    end(): void {
      emit('forced');
      stopTimer();
      windowAt = null;
    },

    destroy(): void {
      stopTimer();
      pending = null;
      windowAt = null;
      lastFlushAt = null;
    },

    get pending(): boolean {
      return pending !== null;
    },

    stats,
  };
}
