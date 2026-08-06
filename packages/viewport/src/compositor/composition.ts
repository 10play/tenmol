/**
 * Who draws what — defect **D2**.
 *
 * Before this module the two renderers both drew everything. `PixelFrameHeader.
 * reps` was always absent, so a rep the user had moved to Mode G was still
 * rasterised by PyMOL *and* drawn again by three.js on top. On opaque cartoon
 * that is invisible, which is why it survived; on anything with alpha it is
 * plainly wrong (two 50 %-alpha copies composite to 75 %), and it means Mode G
 * bought nothing at all — the server did the full frame either way.
 *
 * The fix is one invariant, enforced here and mirrored on the bridge:
 *
 *     a rep is drawn by EXACTLY ONE renderer at any instant, and the pixel
 *     frame header is the authority on which.
 *
 * Two directions of information, and they are not symmetrical:
 *
 *   client -> bridge   `declaration()` — "these are the reps I am prepared to
 *                      draw myself". Advisory. The bridge may ignore it (it
 *                      can only stop drawing an object when EVERY rep that
 *                      object shows is declared, because `cmd.disable` is the
 *                      only render-time mask that does not destroy the very
 *                      geometry Mode G reads back).
 *   bridge -> client   `PixelFrameHeader.reps` — "these reps are IN this
 *                      bitmap". Authoritative. Whatever we declared, we draw a
 *                      rep only if the last frame says the server did not.
 *
 * Making the bridge's answer authoritative rather than assuming our own
 * declaration took effect is what makes the invariant hold across the whole
 * transition: while a `set_pixel_stream` is in flight, while the bridge is on
 * an older build that ignores the field, and while a `cmd.ray` still — which
 * is ALWAYS the full scene, whatever the stream is doing — is on the canvas.
 *
 * Pure: no DOM, no WebGL, no transport. `wiring.ts` is the imperative half.
 */

import { pixelFrameDrawsRep, type RepId, type RepRenderState } from '@tenmol/protocol';

/** The subset of a pixel frame this module reads. */
export interface CompositionFrame {
  /** `PixelFrameHeader.reps`. `undefined` means "the whole scene". */
  reps?: readonly RepId[] | undefined;
}

/** The decision this module produces: which reps the viewport draws, suppresses, and has declared. */
export interface CompositionState {
  /** Reps we asked the bridge to stop drawing. Sorted, de-duplicated. */
  declared: readonly RepId[];
  /** Reps we are actually drawing right now. Always a subset of `declared`. */
  drawing: readonly RepId[];
  /**
   * Reps we would like to draw but the bridge is still rasterising, so we must
   * not. Empty in the two clean states (all-P and all-G); non-empty exactly in
   * mixed mode, which is where the double draw used to happen.
   */
  suppressed: readonly RepId[];
  /**
   * False once the bridge has stopped rasterising (`reps: []`). The last frame
   * it sent is a correct background — PyMOL drew it — so it stays on the
   * canvas; this only says no more are coming.
   */
  rasterizing: boolean;
  /** True while we have seen no pixel frame at all. */
  awaitingFirstFrame: boolean;
}

const EMPTY: readonly RepId[] = [];

function sortedUnique(reps: Iterable<RepId>): RepId[] {
  return [...new Set(reps)].sort((a, b) => a - b);
}

/**
 * Reps this viewport is prepared to draw itself.
 *
 * Only `effective === 'geometry'` counts. A rep that FELL BACK — no accessor,
 * unsupported rep, extraction failed — is one three.js will not draw, and
 * declaring it would ask the bridge to stop drawing something nobody then
 * draws: a hole in the picture rather than a double draw. That asymmetry is
 * the whole reason this is computed from `effective` and not from `requested`.
 */
export function declaration(states: readonly RepRenderState[]): RepId[] {
  return sortedUnique(states.filter((s) => s.effective === 'geometry').map((s) => s.rep));
}

/**
 * Cross the client's intent with the server's last word.
 *
 * `frame === null` (nothing received yet) resolves to "the server draws
 * everything", so a viewport talking to a bridge that never sends a pixel
 * frame still shows Mode-G geometry as soon as the first frame arrives, and
 * shows nothing twice before it.
 */
export function compose(
  states: readonly RepRenderState[],
  frame: CompositionFrame | null,
): CompositionState {
  const declared = declaration(states);
  const awaitingFirstFrame = frame === null;
  const drawing: RepId[] = [];
  const suppressed: RepId[] = [];
  for (const rep of declared) {
    if (pixelFrameDrawsRep(frame, rep)) suppressed.push(rep);
    else drawing.push(rep);
  }
  return {
    declared,
    drawing,
    suppressed,
    rasterizing: frame === null || frame.reps === undefined || frame.reps.length > 0,
    awaitingFirstFrame,
  };
}

/** Did the set of reps we may draw change? Cheap enough to run per frame. */
export function compositionChanged(a: CompositionState, b: CompositionState): boolean {
  return (
    a.rasterizing !== b.rasterizing ||
    a.drawing.length !== b.drawing.length ||
    a.drawing.some((rep, index) => rep !== b.drawing[index])
  );
}

/** `declared` differs — the moment to tell the bridge. */
export function declarationChanged(a: readonly RepId[], b: readonly RepId[]): boolean {
  return a.length !== b.length || a.some((rep, index) => rep !== b[index]);
}

/** The initial state before any rep is declared or any pixel frame seen. */
export const EMPTY_COMPOSITION: CompositionState = {
  declared: EMPTY,
  drawing: EMPTY,
  suppressed: EMPTY,
  rasterizing: true,
  awaitingFirstFrame: true,
};
