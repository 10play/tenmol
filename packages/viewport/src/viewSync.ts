/**
 * The two view-sync decisions the GL-free path turns on, factored out of
 * `viewport.ts` so the race can be tested in isolation (the surrounding
 * `createViewport` needs a real WebGL2 context, so it is only reachable in e2e).
 * Both are pure.
 */

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
