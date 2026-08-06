/**
 * The sculpting STRAIN READOUT, client side.
 *
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT. Sculpting in PyMOL is not a
 * command you run, it is something the process does while it is idle:
 * `PyMOL_Idle` calls `ExecutiveSculptIterateAll(G)` whenever `ControlIdling(G)`
 * is true (`packages/engine/layer5/PyMOL.cpp:2424`), and `ControlIdling` is true exactly when
 * the `sculpting` setting is on (`packages/engine/layer1/Control.cpp:397-403`). The
 * SculptWizard therefore does nothing but set that flag
 * (`packages/engine/modules/pmg_qt/builder.py:145-150`) and let the loop do the work.
 *
 * WAVE 9 BELIEVED THE BRIDGE HAD NO SUCH LOOP AND WAS WRONG. `engine.py:236`
 * is `self.p.idle()` inside the pump tick, i.e. `PyMOL_Idle` at the pump rate,
 * so THE ENGINE ALREADY SCULPTS with no client attached. MEASURED on a
 * displaced alanine with no tick, no subscriber and no draw request:
 * **0.6843 A of drift in 2.0 s, and 0.0000 A in the second after
 * `set sculpting, 0`** (`packages/bridge/tests/test_p10_viewport.py`). Ticking with
 * cycles here as well ran a SECOND minimiser beside the engine's own, which is
 * why the default is now `cycles: 0` — a call that returns the total strain and
 * provably moves nothing (0-cycle `sculpt_iterate`: strain 169.2976, movement
 * 0.000000 A, same file).
 *
 * So the moved atoms reach the user the way every other engine-side change
 * does: the pixel stream at once, and the content-addressed geometry diff on
 * the 4 Hz invalidation scan — measured arriving as a changed content hash and
 * a 0.4094 A vertex delta with nothing on the client ticking at all. This
 * module exists only so the panel can SHOW that convergence.
 *
 * RE-ENTRANCY. One poll in flight at a time. A round trip to a busy engine can
 * take longer than the interval, and stacking them would queue work the user
 * has already stopped asking for — `stop()` must mean stopped, not "stopped
 * after the backlog drains".
 */

import type { BuilderSculptTick } from '@tenmol/protocol/topics/builder';

/** Configuration for the sculpt ticker: the poll call, cycles/rate, and callbacks. */
export interface SculptTickerOptions {
  /** One poll. Usually `controller.sculptTick`. */
  tick: (cycles?: number) => Promise<BuilderSculptTick>;
  /**
   * Iterations to run per poll. **0 by default, and that is the point**: the
   * engine's idle loop is already minimising, so anything above 0 here is a
   * second minimiser and the strain the panel shows stops being the strain the
   * engine is converging on. Raise it only for a backend whose pump does not
   * idle.
   */
  cycles?: number;
  /** Polls per second. A readout, not a loop: 5 is plenty. */
  hz?: number;
  /** Every reply, including the one that reports `active: false`. */
  onTick?: (result: BuilderSculptTick) => void;
  onError?: (error: unknown) => void;
  /** Injected for tests; `setTimeout`/`clearTimeout` otherwise. */
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

/** Handle to a sculpt ticker: whether it is running, and start/stop/sync controls. */
export interface SculptTicker {
  readonly running: boolean;
  start(): void;
  stop(): void;
  /** Start or stop to match the engine's `sculpting` flag. */
  sync(sculpting: number | boolean | undefined): void;
}

/** Build a ticker that polls the engine's sculpt strain readout while sculpting is active. */
export function createSculptTicker(options: SculptTickerOptions): SculptTicker {
  const hz = options.hz ?? 5;
  const cycles = options.cycles ?? 0;
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
      .tick(cycles)
      .then((result) => {
        options.onTick?.(result);
        // The engine is the authority on whether sculpting is still on: a
        // `set sculpting, 0` typed in the console must stop this loop, and the
        // reply is how we hear about it.
        if (!result.active) running = false;
      })
      .catch((error: unknown) => {
        options.onError?.(error);
        // A failed poll stops the loop rather than hammering a broken engine
        // five times a second.
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
