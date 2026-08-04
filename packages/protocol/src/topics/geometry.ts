/**
 * Topic `geometry` — Mode G invalidation notices.  OWNER: WP-26.
 *
 * The geometry itself NEVER travels inside this JSON event; it arrives out of
 * band as a binary frame (`../geometry.ts`), keyed per object / per rep / per
 * state (plan §1.3 constraint 2).
 *
 * `level` is PyMOL's `cRepInv_t` ladder (`packages/engine/layer1/Rep.h:133-184`);
 * `cRepInvColor` (15) means colours only, `cRepInvRep` (35) / `cRepInvAll`
 * (100) mean rebuild everything. Use `isColorOnlyInvalidation()` from
 * `../geometry` to decide whether to re-pull the whole rep or just the colours.
 */

import type {
  GeometryKey,
  ModeGFallbackReason,
  RenderMode,
  RepId,
  RepInvalidationLevel,
} from '../geometry';

/** "rep R of object O in state S changed at level L; pull it again." */
export interface GeometryInvalidation extends GeometryKey {
  level: RepInvalidationLevel;
  /** Byte size the next pull is expected to produce, when the bridge knows it. */
  estimatedBytes?: number;
}

/** "this rep could not be served in Mode G; it is being drawn into the bitmap." */
export interface GeometryFallback extends GeometryKey {
  reason: ModeGFallbackReason;
  detail: string;
}

export interface GeometryPayload {
  invalidated: GeometryInvalidation[];
  /** Reps that fell back to Mode P since the last event. */
  fallbacks?: GeometryFallback[];
  /**
   * The bridge's view of the effective per-rep mode after applying the client's
   * policy. Absent when nothing changed.
   */
  modes?: readonly { rep: RepId; effective: RenderMode }[];
}
