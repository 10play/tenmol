/**
 * Topic `redisplay` — the scene-dirty gate.  OWNER: WP-03.
 *
 * `getRedisplay(reset=True)` is a DESTRUCTIVE drain: the bridge is its sole
 * consumer (plan §1.2). Mode P uses it to skip readback+encode on a clean tick;
 * Mode G uses it as a hint that a rep may need re-pulling (the authoritative
 * signal there is the `geometry` topic).
 */

import type { InvalidationClass } from '../envelope';

/** A `redisplay` topic event: scene-dirty flag, tick, and invalidation classes. */
export interface RedisplayPayload {
  /** True when the scene changed since the last drain. */
  dirty: boolean;
  /** Bridge-side tick counter, so a client can detect a gap. */
  tick: number;
  /**
   * Command-echo invalidation classes accumulated since the last event
   * (plan §1.5). Polling cannot see per-atom colour or per-atom reps; this is.
   */
  inval?: readonly InvalidationClass[];
}
