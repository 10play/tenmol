/**
 * Topic `seqview` — the sequence viewer.  OWNER: WP-21.
 *
 * v1 RENDERS THE SEQUENCE VIEWER THROUGH MODE P (plan §6 WP-21, §7): PyMOL
 * draws it into the framebuffer and the client positions a hit-testing overlay,
 * because the Seeker model (`layer3/Seeker.cpp`) has NO Python readout without
 * C++ Task 5. A DOM sequence viewer is a Mode-G follow-on.
 *
 * So the v1 payload is geometry-of-the-overlay, not sequence text.
 */

/** One clickable band in the Mode-P-rendered sequence strip. */
export interface SeqviewHitRegion {
  /** Viewport pixels, top-left origin (the client already flipped). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Selection expression this band resolves to. */
  selection: string;
}

export interface SeqviewPayload {
  /** True when `cmd.set('seq_view', 1)`. */
  visible: boolean;
  /** Height in viewport pixels the sequence strip occupies. */
  height: number;
  /** Hit regions, or [] when the bridge cannot derive them. */
  regions: SeqviewHitRegion[];
}
