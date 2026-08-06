/**
 * Pausing the Mode-P stream — PER CLIENT (defect D3c).
 *
 * THE BUG. `paused` is a field of `StreamParams`
 * (`packages/bridge/tenmol_bridge/render/framestream.py:137`), which is PROCESS-WIDE:
 *
 *     if self.params.paused or not self._subs:      # framestream.py:777
 *         ...
 *         return
 *
 * `_bridge.set_pixel_stream(paused=True)` therefore stops the stream for EVERY
 * connected session. One user switching tabs blanks the viewport of everyone
 * else in the same PyMOL process, and nothing ever un-pauses them: the resume
 * is sent by the tab that paused, which may have been closed. Reproduced: two
 * clients, hide tab A, tab B's frame counter freezes.
 *
 * WHAT THIS FILE DOES (the client half, which is all the client can own):
 *
 *   1. Pauses LOCALLY and unconditionally. A paused viewport drops the frame
 *      before the presenter sees it, which means it never `ack`s it. That is
 *      not a cosmetic gate: the bridge's flow control is per-subscriber
 *      (`Subscriber.blocked`, `max_in_flight = 1`), so a client that stops
 *      acking self-throttles from 60 fps to one frame per `ack_timeout_s`
 *      (0.75 s) — for itself alone. Decode, blit and downstream bandwidth all
 *      go to ~0 for the hidden client, with ZERO effect on any other client.
 *      This is a real, measurable, correct-by-construction per-client pause.
 *
 *   2. Only tells the BRIDGE to pause when the bridge has told us it can pause
 *      one client (`params.perClientPause === true`, probed with the read-only
 *      `_bridge.render_stats`), or when this session is provably the only
 *      subscriber (`clients <= 1`, so global == per-client), or when the caller
 *      explicitly opts in. Otherwise the global flag is NEVER sent — a stale
 *      picture for other users is a far worse failure than the frames we could
 *      have saved.
 *
 *   3. On resume, asks for a frame immediately (`_bridge.request_frame`)
 *      instead of waiting for the next ack timeout or the next input, because
 *      what is on the canvas is by definition stale.
 *
 * The remaining backend saving — not rendering the frame at all when every
 * subscriber is paused — needs `Subscriber.paused` bridge-side. See the
 * module's README note and the hand-off in this task's report.
 */

import type { PixelSink, PixelSource, ViewportTransport } from '../types';
import {
  createVisibilityController,
  type VisibilityController,
  type VisibilityDocumentLike,
  type VisibilityWindowLike,
} from './visibility';

/* ------------------------------------------------------------------ *
 * Reasons
 * ------------------------------------------------------------------ */

/**
 * Why the stream is paused. Several can hold at once and the stream stays
 * paused until the last one clears — a hidden tab that ALSO has every rep in
 * Mode G must not be un-paused by becoming visible.
 */
export type PauseReason =
  /** `document.visibilityState !== 'visible'`. */
  | 'hidden'
  /** Every visible rep is drawn by Mode G; Mode P has nothing to contribute. */
  | 'mode-g'
  /** The application asked. */
  | 'manual'
  | (string & {});

/** Tracks the set of active pause reasons and the effective paused state. */
export interface PauseCoordinator {
  /** Add/remove a reason. Returns the effective paused state. */
  set(reason: PauseReason, active: boolean): boolean;
  readonly paused: boolean;
  readonly reasons: readonly PauseReason[];
}

/** Create a {@link PauseCoordinator} that notifies `onChange` on effective transitions. */
export function createPauseCoordinator(
  onChange: (paused: boolean, reasons: readonly PauseReason[]) => void,
): PauseCoordinator {
  const reasons = new Set<PauseReason>();
  let paused = false;

  return {
    set(reason: PauseReason, active: boolean): boolean {
      if (active) reasons.add(reason);
      else reasons.delete(reason);
      const next = reasons.size > 0;
      if (next !== paused) {
        paused = next;
        onChange(paused, [...reasons]);
      }
      return paused;
    },
    get paused(): boolean {
      return paused;
    },
    get reasons(): readonly PauseReason[] {
      return [...reasons];
    },
  };
}

/* ------------------------------------------------------------------ *
 * The per-client wrapper
 * ------------------------------------------------------------------ */

/** Counters exposed by a per-client pause wrapper, for the HUD and tests. */
export interface PerClientPauseStats {
  paused: boolean;
  /** Frames that arrived while paused and were dropped without acking. */
  suppressed: number;
  /** Frames delivered to the presenter. */
  delivered: number;
  pauses: number;
  resumes: number;
  /** True once the bridge has been observed to support per-client pause. */
  globalPauseAllowed: boolean;
  /** Times the global flag was actually sent to the bridge. */
  globalPauses: number;
  /** Subscriber count last seen from `_bridge.render_stats`, or -1. */
  clients: number;
}

/** Options controlling how {@link perClientPause} pauses locally vs. globally. */
export interface PerClientPauseOptions {
  /**
   * Used ONLY for the read-only capability probe and for `_bridge.request_frame`
   * on resume. Omit it and the pause stays purely local.
   */
  transport?: ViewportTransport;
  /**
   * `true`  — always forward `paused` to the bridge (single-client dev/kiosk).
   * `false` — never forward it.
   * `'auto'` (default) — forward only when the bridge reports
   *   `perClientPause`, or when we are the only subscriber.
   */
  globalPause?: boolean | 'auto';
  /** Ask for a fresh frame on resume. Default true. */
  requestFrameOnResume?: boolean;
  /** Diagnostics; never fatal. */
  onNote?: (message: string) => void;
}

/** A {@link PixelSource} whose `setPaused` gates frames for this client alone. */
export interface PerClientPauseSource extends PixelSource {
  setPaused(paused: boolean): void;
  readonly pauseStats: PerClientPauseStats;
}

const RENDER_STATS_FN = '_bridge.render_stats';
const REQUEST_FRAME_FN = '_bridge.request_frame';

/**
 * Wrap a {@link PixelSource} so that `setPaused` is a per-client operation.
 *
 * The wrapper owns the sink, so the gate is in front of the presenter: a
 * suppressed frame is never decoded, never blitted and — the part that matters
 * for flow control — never acked.
 */
export function perClientPause(
  source: PixelSource,
  options: PerClientPauseOptions = {},
): PerClientPauseSource {
  const stats: PerClientPauseStats = {
    paused: false,
    suppressed: 0,
    delivered: 0,
    pauses: 0,
    resumes: 0,
    globalPauseAllowed: options.globalPause === true,
    globalPauses: 0,
    clients: -1,
  };

  /** The caller pinned the answer; never ask the bridge. */
  const explicit = options.globalPause === true || options.globalPause === false;
  /**
   * Latched only when the route does not exist (an older bridge). A capability
   * that is absent stays absent; a subscriber COUNT does not, which is why the
   * probe below is repeated on every pause rather than cached.
   */
  let routeMissing = false;
  let probing: Promise<void> | null = null;

  const note = (message: string): void => options.onNote?.(message);

  /**
   * Read-only probe. `_bridge.render_stats` has no side effects at all — unlike
   * `set_pixel_stream({})`, which marks the redisplay gate and forces a frame.
   *
   * Run on EVERY pause, deliberately. Caching the first answer is a trap: a
   * viewport that pauses once while it is the only client would latch
   * "global pause is safe" and then keep blanking the second user who joined
   * five minutes later. One tiny read per pause is a fair price for never
   * doing that.
   */
  const probe = (): Promise<void> => {
    const transport = options.transport;
    if (explicit || routeMissing || transport === undefined) return Promise.resolve();
    if (probing !== null) return probing;
    probing = transport
      .call(RENDER_STATS_FN)
      .then((result: unknown) => {
        const modeP = (result as { modeP?: Record<string, unknown> } | null)?.modeP;
        if (modeP === undefined || modeP === null) {
          // A stats payload we do not understand is not permission.
          stats.globalPauseAllowed = false;
          return;
        }
        const clients = Number(modeP['clients']);
        if (Number.isFinite(clients)) stats.clients = clients;
        const params = modeP['params'] as Record<string, unknown> | undefined;
        const perClient = params?.['perClientPause'] === true;
        // `clients <= 1` means the global flag IS the per-client flag: there is
        // nobody else to blank. Re-probed on every pause, so a second client
        // connecting takes us back to local-only.
        stats.globalPauseAllowed = perClient || (Number.isFinite(clients) && clients <= 1);
        note(
          `per-client pause: bridge perClientPause=${String(perClient)} clients=${String(clients)} -> ` +
            (stats.globalPauseAllowed ? 'global pause allowed' : 'LOCAL ONLY'),
        );
      })
      .catch(() => {
        // No such route (older bridge). Local-only is the safe answer, and
        // asking again every pause would only repeat the same rejection.
        routeMissing = true;
        stats.globalPauseAllowed = false;
      })
      .finally(() => {
        probing = null;
      });
    return probing;
  };

  const applyGlobal = (paused: boolean): void => {
    if (options.globalPause === false) return;
    if (!stats.globalPauseAllowed) return;
    stats.globalPauses++;
    source.setPaused?.(paused);
  };

  const wrap = (real: PixelSink): PixelSink => ({
    frame(frame): void {
      if (stats.paused) {
        // Dropped BEFORE the presenter, so no ack is sent for it. That is the
        // per-client throttle: the bridge holds the next frame for this
        // subscriber until `ack_timeout_s`, and keeps serving everyone else at
        // full rate.
        stats.suppressed++;
        return;
      }
      stats.delivered++;
      real.frame(frame);
    },
    error(error): void {
      real.error(error);
    },
  });

  return {
    get name(): string {
      return `${source.name}${stats.paused ? ' (paused)' : ''}`;
    },
    start(next: PixelSink): void {
      source.start(wrap(next));
    },
    stop(): void {
      source.stop();
    },
    resize(width, height, dpr): void {
      source.resize?.(width, height, dpr);
    },
    invalidate(): void {
      if (stats.paused) return;
      source.invalidate?.();
    },
    setPaused(paused: boolean): void {
      if (paused === stats.paused) return;
      stats.paused = paused;
      if (paused) {
        stats.pauses++;
        // Local gate first: it is instantaneous and needs no round trip.
        // The bridge is only involved if it can pause US and not the others.
        if (options.globalPause === true) {
          applyGlobal(true);
          return;
        }
        void probe().then(() => {
          if (stats.paused) applyGlobal(true);
        });
        return;
      }
      stats.resumes++;
      if (stats.globalPauseAllowed || options.globalPause === true) applyGlobal(false);
      // What is on the canvas is stale by definition; ask for a fresh frame
      // rather than waiting for the next ack timeout or the next input.
      source.invalidate?.();
      if (options.requestFrameOnResume !== false && options.transport !== undefined) {
        void options.transport.call(REQUEST_FRAME_FN, [], { count: 1 }).catch(() => {
          /* older bridge; the next tick will produce one anyway */
        });
      }
    },
    get pauseStats(): PerClientPauseStats {
      return stats;
    },
  };
}

/* ------------------------------------------------------------------ *
 * The whole binding: visibility -> reasons -> per-client pause
 * ------------------------------------------------------------------ */

/** Options for {@link createStreamPauseController}: the source plus visibility wiring. */
export interface StreamPauseControllerOptions extends PerClientPauseOptions {
  /** The source to wrap. Use the returned `source`, not this one. */
  source: PixelSource;
  /** Set false to skip the Page Visibility wiring (tests). */
  visibility?: boolean;
  document?: VisibilityDocumentLike | null;
  window?: VisibilityWindowLike | null;
  /** Called on every effective change, for the HUD. */
  onChange?: (paused: boolean, reasons: readonly PauseReason[]) => void;
}

/** The wired-up controller: a pause-gated source plus reason and visibility state. */
export interface StreamPauseController {
  /** The source the viewport must use. */
  readonly source: PerClientPauseSource;
  /** Add/remove a pause reason (`'mode-g'`, `'manual'`, ...). */
  set(reason: PauseReason, active: boolean): boolean;
  readonly paused: boolean;
  readonly reasons: readonly PauseReason[];
  readonly hidden: boolean;
  readonly stats: PerClientPauseStats;
  destroy(): void;
}

/**
 * One call wires: mount-time visibility + every lifecycle event -> reason set
 * -> per-client (local) pause -> optional global pause when it is safe.
 */
export function createStreamPauseController(
  options: StreamPauseControllerOptions,
): StreamPauseController {
  const { source: inner, visibility, document: doc, window: win, onChange, ...rest } = options;
  const source = perClientPause(inner, rest);

  const coordinator = createPauseCoordinator((paused, reasons) => {
    source.setPaused(paused);
    onChange?.(paused, reasons);
  });

  let visibilityController: VisibilityController | null = null;
  if (visibility !== false) {
    visibilityController = createVisibilityController({
      // Fires synchronously with the MOUNT state, which is the whole point:
      // a tab that was already hidden pauses without waiting for a transition.
      onChange: (hidden) => {
        coordinator.set('hidden', hidden);
      },
      ...(doc === undefined ? {} : { document: doc }),
      ...(win === undefined ? {} : { window: win }),
    });
  }

  return {
    source,
    set: (reason, active) => coordinator.set(reason, active),
    get paused(): boolean {
      return coordinator.paused;
    },
    get reasons(): readonly PauseReason[] {
      return coordinator.reasons;
    },
    get hidden(): boolean {
      return visibilityController?.hidden ?? false;
    },
    get stats(): PerClientPauseStats {
      return source.pauseStats;
    },
    destroy(): void {
      visibilityController?.destroy();
    },
  };
}
