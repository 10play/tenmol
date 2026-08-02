/**
 * The Builder's one import of `packages/viewport/src/picking`.
 *
 * WHY A RELATIVE PATH AND NOT `@tenmol/viewport/picking`, in full because it
 * looks like a mistake: `apps/web/package.json` does not list
 * `@tenmol/viewport` as a dependency, so pnpm never created
 * `apps/web/node_modules/@tenmol/viewport`; the app resolves the bare specifier
 * through a plain string alias in `apps/web/vite.config.ts` that points at
 * `packages/viewport/src/index.ts`, which turns `@tenmol/viewport/picking` into
 * `.../src/index.ts/picking`; and vitest does not load `vite.config.ts` at all,
 * so a test of any component importing it fails to COLLECT. Measured, this
 * wave: `Failed to resolve import "@tenmol/viewport/picking"`.
 *
 * `features/mouse/tables.ts` reached the same conclusion for
 * `.../src/input`, and the requested fix is the same one: add
 * `"@tenmol/viewport": "workspace:*"` to `apps/web/package.json` and delete the
 * alias, after which this file becomes
 * `export * from '@tenmol/viewport/picking';`. Both files belong to other work
 * packages, so it is reported rather than applied.
 */

export {
  registerPickRoute,
  routeViewportPick,
  pickRouteCount,
  resetPickRoutes,
  type PickHit,
  type PickRoute,
} from '../../../../../packages/viewport/src/picking';
