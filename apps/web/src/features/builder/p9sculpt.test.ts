/**
 * Row 415 — the sculpting loop the bridge does not run.
 *
 * `sculpting 1` is not an instruction to sculpt, it is a flag PyMOL's idle
 * handler reads (`layer1/Control.cpp:397-403`, `layer5/PyMOL.cpp:2424`). The
 * bridge pump draws and never idles, so on this backend the flag on its own
 * moves nothing: the client is the loop. These are the rules that loop has to
 * obey, and each one is here because breaking it is a real failure mode.
 *
 * The engine half — that a tick really does move atoms, and stops moving them
 * once the object is deactivated — is `bridge/tests/test_p9_rest.py`.
 */

import { describe, expect, it, vi } from 'vitest';
import type { BuilderSculptTick } from '@tenmol/protocol/topics/builder';
import { createSculptTicker } from './sculptTicker';

/** A hand-driven clock: `run()` fires the timer that is due. */
function clock() {
  let queue: Array<{ fn: () => void; ms: number; id: number }> = [];
  let next = 1;
  return {
    schedule: (fn: () => void, ms: number) => {
      const id = next++;
      queue.push({ fn, ms, id });
      return id;
    },
    cancel: (handle: unknown) => {
      queue = queue.filter((entry) => entry.id !== handle);
    },
    get pending() {
      return queue.length;
    },
    run(): void {
      const due = queue;
      queue = [];
      for (const entry of due) entry.fn();
    },
  };
}

/** Drain the microtask queue: `then` -> `finally` -> reschedule is 3 turns. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

const reply = (over: Partial<BuilderSculptTick> = {}): BuilderSculptTick => ({
  active: true,
  strain: 12.5,
  cycles: 10,
  objects: 1,
  auto_center_unsupported: false,
  ...over,
});

describe('the sculpt ticker', () => {
  it('ticks repeatedly while the engine says sculpting is on', async () => {
    const c = clock();
    const tick = vi.fn().mockResolvedValue(reply());
    const ticker = createSculptTicker({ tick, schedule: c.schedule, cancel: c.cancel });

    ticker.start();
    expect(tick).not.toHaveBeenCalled(); // scheduled, not called synchronously
    c.run();
    await flush();
    expect(tick).toHaveBeenCalledTimes(1);

    c.run();
    await flush();
    expect(tick).toHaveBeenCalledTimes(2);
    expect(ticker.running).toBe(true);
  });

  it('never has two ticks in flight, however slow the engine is', async () => {
    const c = clock();
    let resolve!: (value: BuilderSculptTick) => void;
    const tick = vi.fn(
      () =>
        new Promise<BuilderSculptTick>((r) => {
          resolve = r;
        }),
    );
    const ticker = createSculptTicker({ tick, schedule: c.schedule, cancel: c.cancel });

    ticker.start();
    c.run();
    expect(tick).toHaveBeenCalledTimes(1);
    // Nothing is scheduled while a tick is outstanding, so a slow engine
    // cannot accumulate a backlog of frames the user has stopped asking for.
    expect(c.pending).toBe(0);

    resolve(reply());
    await flush();
    expect(c.pending).toBe(1);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('stops itself when the engine reports sculpting is off', async () => {
    const c = clock();
    const tick = vi.fn().mockResolvedValue(reply({ active: false, strain: 0 }));
    const ticker = createSculptTicker({ tick, schedule: c.schedule, cancel: c.cancel });

    ticker.start();
    c.run();
    await flush();
    // `set sculpting, 0` typed in the console: the reply is how we hear it.
    expect(ticker.running).toBe(false);
    expect(c.pending).toBe(0);
  });

  it('stops on an error rather than hammering a broken engine', async () => {
    const c = clock();
    const onError = vi.fn();
    const tick = vi.fn().mockRejectedValue(new Error('no such symbol'));
    const ticker = createSculptTicker({
      tick,
      onError,
      schedule: c.schedule,
      cancel: c.cancel,
    });

    ticker.start();
    c.run();
    await flush();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(ticker.running).toBe(false);
    expect(c.pending).toBe(0);
  });

  it('stop() cancels the pending frame, so closing the panel really stops it', async () => {
    const c = clock();
    const tick = vi.fn().mockResolvedValue(reply());
    const ticker = createSculptTicker({ tick, schedule: c.schedule, cancel: c.cancel });

    ticker.start();
    c.run();
    await flush();
    expect(c.pending).toBe(1);

    ticker.stop();
    expect(c.pending).toBe(0);
    c.run();
    await flush();
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('sync() follows the flag in the builder state, in both directions', async () => {
    const c = clock();
    const tick = vi.fn().mockResolvedValue(reply());
    const ticker = createSculptTicker({ tick, schedule: c.schedule, cancel: c.cancel });

    ticker.sync(0);
    expect(ticker.running).toBe(false);
    ticker.sync(1);
    expect(ticker.running).toBe(true);
    // Idempotent: a 4 Hz state poll re-reporting `sculpting: 1` must not start
    // a second loop.
    ticker.sync(1);
    c.run();
    await flush();
    expect(tick).toHaveBeenCalledTimes(1);

    ticker.sync(undefined);
    expect(ticker.running).toBe(false);
  });

  it('reports every reply, so the panel can show the strain converging', async () => {
    const c = clock();
    const seen: number[] = [];
    const tick = vi
      .fn()
      .mockResolvedValueOnce(reply({ strain: 40 }))
      .mockResolvedValueOnce(reply({ strain: 12 }));
    const ticker = createSculptTicker({
      tick,
      onTick: (result) => seen.push(result.strain),
      schedule: c.schedule,
      cancel: c.cancel,
    });

    ticker.start();
    c.run();
    await flush();
    c.run();
    await flush();
    expect(seen).toEqual([40, 12]);
  });
});
