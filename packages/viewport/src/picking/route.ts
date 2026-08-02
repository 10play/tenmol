/**
 * WHERE A CLIENT-SIDE PICK GOES.
 *
 * `createPickIndex()` answers "which atom is under this click"; this module
 * answers "and who wants to know". Until it existed, the answer was hard-coded:
 * `viewport.ts` turned every GL-free pick into `cmd.select('sele', obj`N)` and
 * nothing else could ever see one. That is wrong for the same reason PyMOL does
 * not do it either — `SceneClick` routes a click by the ButMode action, so in
 * EDITING mode the same pixel goes to `EditorInactivate`/`EditorSelect` and
 * fills `pk1..pk4` instead of rewriting `sele` (`packages/engine/layer1/SceneMouse.cpp:404-470`).
 * The Builder is the client half of that editor, and it had no way to be told.
 *
 * THE SHAPE IS `shell/panelHooks.ts`'s, deliberately: a feature registers from
 * its OWN directory and no shared file is edited by two work packages —
 *
 *     import { registerPickRoute } from '@tenmol/viewport/picking';
 *     const off = registerPickRoute((hit) => { ...; return true; });
 *
 * — except that this registry lives in `@tenmol/viewport` rather than in the
 * shell, because the viewport is framework-free and must not import the app.
 *
 * A route returns TRUE when it consumed the pick, and the viewport then does
 * NOT run its default selection. Routes are consulted most-recently-registered
 * first (a wizard armed after the panel opened wins), and a route that throws
 * is skipped rather than allowed to kill the click.
 */

import type { PickHit } from './pick';

/** Return true to consume the pick; false/undefined lets the next one try. */
export type PickRoute = (hit: PickHit) => boolean | void;

const routes: PickRoute[] = [];

/**
 * Add a route. Returns an unregister function, so a React feature can register
 * in an effect and clean up on unmount — a route left behind by an unmounted
 * panel would silently swallow every click.
 */
export function registerPickRoute(route: PickRoute): () => void {
  routes.push(route);
  return () => {
    const at = routes.lastIndexOf(route);
    if (at >= 0) routes.splice(at, 1);
  };
}

/**
 * Offer a hit to the routes. True means somebody took it.
 *
 * The error is swallowed on purpose and not rethrown into the viewport's
 * `onError`: a broken panel must cost the user one click, not the pick path.
 */
export function routeViewportPick(hit: PickHit): boolean {
  for (let i = routes.length - 1; i >= 0; i--) {
    const route = routes[i];
    if (route === undefined) continue;
    try {
      if (route(hit) === true) return true;
    } catch {
      // keep going: the next route may still want it
    }
  }
  return false;
}

/**
 * `obj`N` for a hit — PyMOL's own atom-identifier syntax.
 *
 * `index` is 0-based in the CGO pick payload and the selection syntax is
 * 1-based. Verified natively: index 10 resolves to "u`11".
 */
export function pickSelectionName(hit: PickHit): string {
  return `${hit.object}\`${hit.index + 1}`;
}

/**
 * THE WHOLE DECISION, in one testable place: offer the hit to the routes, and
 * fall back to the default selection when nobody took it.
 *
 * It lives here rather than inline in `viewport.ts` because the ORDER is the
 * behaviour — a route that fires *after* `cmd.select` would leave the editor
 * pick and a rewritten `sele` fighting over the same click — and `viewport.ts`
 * cannot be constructed in a test without a WebGL2 context.
 *
 * Returns what happened, so a caller can count it.
 */
export function dispatchViewportPick(
  hit: PickHit,
  select: (selection: string, hit: PickHit) => void,
): 'routed' | 'selected' {
  if (routeViewportPick(hit)) return 'routed';
  select(pickSelectionName(hit), hit);
  return 'selected';
}

/** How many routes are registered. Exported for tests and diagnostics. */
export function pickRouteCount(): number {
  return routes.length;
}

/** Exported for tests only: forget every route. */
export function resetPickRoutes(): void {
  routes.length = 0;
}
