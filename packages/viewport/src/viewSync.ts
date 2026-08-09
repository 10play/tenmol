/**
 * The view-sync decisions the GL-free path turns on, factored out of
 * `viewport.ts` so they can be tested without a WebGL2 context (the surrounding
 * `createViewport` needs one). `viewReplyIsFresh`/`serverRasterisesNothing` are
 * pure; `handOffSceneToModeG` mutates the render policy it is given.
 */

import type { RenderPolicyController } from './renderPolicy';

/**
 * Hand the whole scene to Mode G on a GL-free bridge: trust the accessor and
 * make geometry the default so every capable rep resolves to `effective:
 * 'geometry'` and starts pulling. Split out of `syncStreamAvailability` so its
 * effect is unit-testable against a real `createRenderPolicy` — the surrounding
 * `webgl && renderer.available` gate needs a live WebGL2 context, so only the
 * gate itself stays in `viewport.ts` (`shouldHandOffToModeG` covers its logic).
 *
 * Trusting the accessor is safe: a GL-free build that also lacked it could draw
 * nothing at all, and each rep still degrades honestly with `no-accessor` if a
 * pull later says so.
 */
export function handOffSceneToModeG(
  policy: Pick<RenderPolicyController, 'setCaps' | 'setDefault'>,
): void {
  policy.setCaps({ accessor: true });
  policy.setDefault('geometry');
}

/**
 * Whether to run the Mode-G hand-off: only when the CLIENT can draw (WebGL2) and
 * it has not already happened. Idempotent by design — the hand-off flips global
 * policy state and must fire exactly once per GL-free session.
 */
export function shouldHandOffToModeG(canRenderClientSide: boolean, alreadyDone: boolean): boolean {
  return canRenderClientSide && !alreadyDone;
}

/**
 * Accept a `get_view()` reply only if the client has NOT advanced the view since
 * the reply was requested.
 *
 * Optimistic rotation bumps an epoch on every local turn; a reply captured at an
 * older epoch reflects a server state the client has already moved past, so
 * applying it would snap the picture backwards mid-drag. Equality — not `>=` —
 * is deliberate: the epoch only ever moves forward, and a reply is either the
 * one we are still waiting on (equal) or stale (different).
 */
export function viewReplyIsFresh(requestedEpoch: number, currentEpoch: number): boolean {
  return requestedEpoch === currentEpoch;
}

/**
 * True when the bridge rasterises nothing — a `--no-gl` backend. Either the
 * active pixel source or the raw one declaring `rasterizes === false` is
 * enough; `undefined` means "a stream is still expected" and is NOT a negative
 * verdict.
 */
export function serverRasterisesNothing(
  activeRasterizes: boolean | undefined,
  rawRasterizes: boolean | undefined,
): boolean {
  return activeRasterizes === false || rawRasterizes === false;
}
