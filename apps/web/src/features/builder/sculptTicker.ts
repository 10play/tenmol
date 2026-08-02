/**
 * The sculpting loop, client side.
 *
 * WHY THIS EXISTS. Sculpting in PyMOL is not a command you run, it is something
 * the process does while it is idle: `PyMOL_Idle` calls
 * `ExecutiveSculptIterateAll(G)` whenever `ControlIdling(G)` is true
 * (`layer5/PyMOL.cpp:2424`), and `ControlIdling` is true exactly when the
 * `sculpting` setting is on (`layer1/Control.cpp:397-403`). The SculptWizard
 * therefore does nothing but set that flag (`modules/pmg_qt/builder.py:145-150`)
 * and let the GL loop do the work.
 *
 * The bridge has no such loop. Its pump DRAWS — it does not iterate the engine
 * — so on this backend `sculpting 1` moves no atom at all until somebody calls
 * `cmd.sculpt_iterate`. This module is that somebody: while the flag is on it
 * calls `cmd.builder_sculpt_tick` on a timer, and the moved coordinates reach
 * the user through the streams that already exist (the pixel stream at once,
 * the content-addressed geometry diff on the next scan). No new topic, no
 * bridge-side timer running when nobody is watching.
 *
 * RE-ENTRANCY. One tick in flight at a time. A round trip to a busy engine can
 * take longer than the interval, and stacking ticks would queue work the user
 * has already stopped asking for — `stop()` must mean stopped, not "stopped
 * after the backlog drains".
 */

import type { BuilderSculptTick } from '@tenmol/protocol/topics/builder';

export interface SculptTickerOptions {
  /** One frame. Usually `controller.sculptTick`. */
  tick: (cycles?: number) => Promise<BuilderSculptTick>;
  /** Frames per second. PyMOL's idle rate is the draw rate; 20 is plenty. */
  hz?: number;
  /** Every reply, including the one that reports `active: false`. */
  onTick?: (result: BuilderSculptTick) => void;
  onError?: (error: unknown) => void;
  /** Injected for tests; `setTimeout`/`clearTimeout` otherwise. */
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

export interface SculptTicker {
  readonly running: boolean;
  start(): void;
  stop(): void;
  /** Start or stop to match the engine's `sculpting` flag. */
  sync(sculpting: number | boolean | undefined): void;
}

export function createSculptTicker(options: SculptTickerOptions): SculptTicker {
  const hz = options.hz ?? 20;
  const schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = options.cancel ?? ((handle) => clearTimeout(handle as never));

  let running = false;
  let handle: unknown = null;
  let inFlight = false;

  const loop = (): void => {
    handle = null;
    if (!running || inFlight) return;
    inFlight = true;
    options
      .tick()
      .then((result) => {
        options.onTick?.(result);
        // The engine is the authority on whether sculpting is still on: a
        // `set sculpting, 0` typed in the console must stop this loop, and the
        // reply is how we hear about it.
        if (!result.active) running = false;
      })
      .catch((error: unknown) => {
        options.onError?.(error);
        // A failed tick stops the loop rather than hammering a broken engine
        // 20 times a second.
        running = false;
      })
      .finally(() => {
        inFlight = false;
        if (running) handle = schedule(loop, Math.max(1, Math.round(1000 / hz)));
      });
  };

  return {
    get running() {
      return running;
    },
    start(): void {
      if (running) return;
      running = true;
      handle = schedule(loop, 0);
    },
    stop(): void {
      running = false;
      if (handle !== null) {
        cancel(handle);
        handle = null;
      }
    },
    sync(sculpting): void {
      const on = typeof sculpting === 'number' ? sculpting !== 0 : Boolean(sculpting);
      if (on) this.start();
      else this.stop();
    },
  };
}
