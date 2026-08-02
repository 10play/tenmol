/**
 * Row 415, the consequence of the wave-9 audit: the client must NOT be a
 * second minimiser.
 *
 * The engine's own idle loop sculpts — 0.6843 A of drift in 2.0 s with no
 * client tick, no pixel subscriber and no draw request
 * (`packages/bridge/tests/test_p10_viewport.py`) — so a client that also passes
 * `sculpting_cycles` on a timer doubles the iteration rate and the strain it
 * prints is not the strain the engine is converging on. `sculptTicker.ts` is
 * therefore a READOUT: 0 cycles, which `cmd.sculpt_iterate` answers with the
 * total strain and provably zero movement (measured: strain 169.2976, movement
 * 0.000000 A).
 *
 * `p9sculpt.test.ts` still owns the loop's lifecycle rules; this file owns the
 * two numbers that stop it from sculpting.
 */

import { describe, expect, it, vi } from 'vitest';
import type { BuilderSculptTick } from '@tenmol/protocol/topics/builder';
import { createSculptTicker } from './sculptTicker';

function clock() {
  let queue: Array<{ fn: () => void; ms: number; id: number }> = [];
  let next = 1;
  const delays: number[] = [];
  return {
    delays,
    schedule: (fn: () => void, ms: number) => {
      const id = next++;
      delays.push(ms);
      queue.push({ fn, ms, id });
      return id;
    },
    cancel: (handle: unknown) => {
      queue = queue.filter((entry) => entry.id !== handle);
    },
    run(): void {
      const due = queue;
      queue = [];
      for (const entry of due) entry.fn();
    },
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

const reply = (over: Partial<BuilderSculptTick> = {}): BuilderSculptTick => ({
  active: true,
  strain: 12.5,
  cycles: 0,
  objects: 1,
  auto_center_unsupported: false,
  ...over,
});

describe('the sculpt poll does not iterate', () => {
  it('asks for ZERO cycles, so it cannot move an atom', async () => {
    const c = clock();
    const tick = vi.fn().mockResolvedValue(reply());
    const ticker = createSculptTicker({ tick, schedule: c.schedule, cancel: c.cancel });

    ticker.start();
    c.run();
    await flush();
    c.run();
    await flush();

    expect(tick).toHaveBeenCalledTimes(2);
    // Every call, not just the first: an `undefined` here would fall back to
    // `sculpting_cycles` on the bridge, which is the double-minimiser.
    for (const call of tick.mock.calls) expect(call[0]).toBe(0);
  });

  it('polls at 5 Hz, not 20', async () => {
    const c = clock();
    const tick = vi.fn().mockResolvedValue(reply());
    const ticker = createSculptTicker({ tick, schedule: c.schedule, cancel: c.cancel });

    ticker.start();
    c.run();
    await flush();
    // [0] is the immediate first poll; [1] is the interval.
    expect(c.delays).toEqual([0, 200]);
  });

  it('still lets a non-idling backend ask for real iterations', async () => {
    const c = clock();
    const tick = vi.fn().mockResolvedValue(reply({ cycles: 10 }));
    const ticker = createSculptTicker({
      tick,
      cycles: 10,
      hz: 20,
      schedule: c.schedule,
      cancel: c.cancel,
    });

    ticker.start();
    c.run();
    await flush();
    expect(tick).toHaveBeenCalledWith(10);
    expect(c.delays).toEqual([0, 50]);
  });
});
