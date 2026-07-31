/**
 * Topic `pixels` — Mode P descriptor channel.  OWNER: WP-04.
 *
 * The bitmap itself NEVER travels in this JSON event; it rides a binary frame
 * with a `PixelFrameHeader` (`../geometry.ts`). This topic carries the
 * negotiated stream parameters and the flow-control state, so the client can
 * react to a resolution/quality change without decoding a frame first.
 *
 * Budget (plan §1.3, measured on this machine, 1AON = 58,870 atoms):
 * draw 0.5 ms + glReadPixels 1.0 ms + JPEG q80 1.9 ms = 3.4 ms at 1280x960.
 */

import type { PixelEncoding, RepId } from '../geometry';

export interface PixelsPayload {
  /** Framebuffer size the bridge is currently rendering at (CSS px * dpr). */
  width: number;
  height: number;
  dpr: number;
  /** Codec used while the scene is in motion. */
  motionEncoding: PixelEncoding;
  /** Codec used once the scene settles (lossless). */
  settleEncoding: PixelEncoding;
  /** 1..100 for the lossy codec. */
  quality: number;
  /** True while the bridge is holding a frame waiting for an `ack`. */
  awaitingAck: boolean;
  /** Last frame id emitted. */
  frameId: number;
  /**
   * Reps the bridge is drawing server-side. Empty when Mode G has taken over
   * every visible rep and Mode P is idle.
   */
  reps: readonly RepId[];
}

/** Client -> bridge stream control, sent as `{t:'call', fn:'_bridge.set_pixel_stream'}`. */
export interface PixelStreamRequest {
  width?: number;
  height?: number;
  dpr?: number;
  motionEncoding?: PixelEncoding;
  settleEncoding?: PixelEncoding;
  quality?: number;
  /** Pause the stream entirely (tab hidden, or every rep is in Mode G). */
  paused?: boolean;
}
