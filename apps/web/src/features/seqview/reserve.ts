/**
 * `seq_view_overlay = 0` — the strip takes space from the SCENE, it does not
 * float over it.
 *
 * WHAT WAS WRONG. `.seqview` is `position: absolute`, so it never occupied a
 * pixel of layout, and `seq_view_overlay` only swapped an opaque background for
 * a translucent one. MEASURED in Chromium at 1280x900 with one object: the
 * strip is 62 px tall, and the viewport canvas is `top 24, bottom 668,
 * height 644` in ALL FOUR combinations of `overlay` 0/1 by `seq_view_location`
 * 0/1 — identical to the pixel. The setting's whole point is the difference
 * between covering the picture and shrinking it, and there was none.
 *
 * WHAT UPSTREAM DOES. `OrthoReshape` treats the sequence viewer as a block that
 * consumes scene height (`packages/engine/layer1/Ortho.cpp:2419,2433`):
 *
 *     sceneBottom += seqHeight;     // seq_view_location 1 (bottom)
 *     sceneTop     = seqHeight;     // seq_view_location 0 (top)
 *
 * and `SeqGetHeight` (`packages/engine/layer1/Seq.cpp:190-199`) is `LineHeight * NRow + 4`,
 * plus `ScrollBarWidth` when the bar is up — 13*2 + 4 + 16 = 46 px for the
 * session measured above. THE NUMBER IS THE STRIP'S OWN HEIGHT, so this module
 * does not re-derive it from row counts and font metrics that would then have
 * to be kept in step with the CSS. It measures the rendered strip and publishes
 * that, which is the same quantity in the browser's units (62 px where the C
 * says 46, because the DOM strip has a head row and different metrics).
 *
 * WHY A CUSTOM PROPERTY RATHER THAN A PROP. The strip is a `viewport`-region
 * feature slot and the rectangle it must shrink belongs to `.shell__viewport`,
 * which is the shell's. Feature slots are mounted by id from a frozen registry
 * and are handed no channel to their container. A CSS variable on the shared
 * container is the seam that already exists: the shell's stylesheet decides
 * what to do with the reservation, the feature only states it. Nothing else in
 * the tree reads these two names.
 *
 * Set on `.shell__viewport` — the strip's own offset parent — rather than on
 * `:root`, so a second viewport (there is none today, but the shell's grid does
 * not forbid one) would not have its scene shrunk by another one's strip.
 */

/** The two custom properties `.shell__viewport` pads itself with. */
export const RESERVE_TOP = '--pm-seq-reserve-top';
/** CSS custom property `.shell__viewport` pads its bottom with for the seq strip. */
export const RESERVE_BOTTOM = '--pm-seq-reserve-bottom';

/** Where the sequence strip sits and how much scene space it claims. */
export interface Reservation {
  /** `seq_view_location`: 0 draws at the top, 1 at the bottom. */
  location: number;
  /** `seq_view_overlay`: true draws OVER the scene and reserves nothing. */
  overlay: boolean;
  /** The strip's rendered height in CSS pixels. */
  height: number;
}

/**
 * The two properties for a given state, as `[top, bottom]` strings.
 *
 * Pure, and separately tested, because the interesting cases are the ones that
 * reserve NOTHING and they are easy to get wrong in an effect: overlay on, a
 * strip that has not been measured yet (height 0), and a strip that is hidden
 * entirely (`seq_view` off, height 0). All three must clear the reservation
 * rather than leave the last value behind — a stale inset survives as a black
 * band the user cannot explain.
 */
export function reservationFor(state: Reservation): [string, string] {
  const height = state.overlay || !Number.isFinite(state.height) ? 0 : Math.max(0, state.height);
  if (height === 0) return ['0px', '0px'];
  return state.location === 1 ? ['0px', `${Math.round(height)}px`] : [`${Math.round(height)}px`, '0px'];
}

/**
 * Write the reservation onto `container`, or clear it.
 *
 * Returns a disposer that clears BOTH properties. The clear matters more than
 * the set: the strip unmounts whenever `seq_view` is turned off, and without it
 * the scene would keep a gap where a viewer used to be.
 */
export function applyReservation(
  container: HTMLElement | null,
  state: Reservation,
): () => void {
  if (container === null) return () => {};
  const [top, bottom] = reservationFor(state);
  container.style.setProperty(RESERVE_TOP, top);
  container.style.setProperty(RESERVE_BOTTOM, bottom);
  return () => {
    container.style.removeProperty(RESERVE_TOP);
    container.style.removeProperty(RESERVE_BOTTOM);
  };
}
