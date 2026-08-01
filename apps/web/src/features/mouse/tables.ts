/**
 * The one import of `packages/viewport/src/input` in `apps/web`.
 *
 * WHY A RELATIVE PATH AND NOT `@tenmol/viewport`. `apps/web/package.json` does
 * not list `@tenmol/viewport` as a dependency (it lists client, protocol and
 * stores), so pnpm never created `apps/web/node_modules/@tenmol/viewport`. The
 * application resolves the specifier through an ALIAS in
 * `apps/web/vite.config.ts` — and that alias is a plain string prefix mapping
 * onto `packages/viewport/src/index.ts`, so `@tenmol/viewport/input` cannot
 * resolve either. Neither file is owned by this work package, and vitest (which
 * does not load `vite.config.ts`) resolves neither specifier at all, so a unit
 * test of any component importing it fails to collect.
 *
 * A relative path works everywhere — vite dev, `vite build`, `tsc` and vitest —
 * and confines the workaround to one file instead of six.
 *
 * REQUESTED FIX (reported, not applied — the file belongs to another WP):
 * add `"@tenmol/viewport": "workspace:*"` to `apps/web/package.json`
 * dependencies and delete the alias; then this file becomes
 * `export * from '@tenmol/viewport/input';`.
 */

export * from '../../../../../packages/viewport/src/input';
