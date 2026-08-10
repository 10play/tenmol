import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import type { StorybookConfig } from '@storybook/react-vite';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Storybook for the tenmol UI primitive layer.
 *
 * The components under test live in `apps/web/src/ui` (and the feature bundles
 * that compose them). They are consumed here as TypeScript SOURCE through the
 * `@web/*` alias — the same way Vite consumes the app — so a story always shows
 * exactly what the app renders, with no separate build step to drift.
 */
const config: StorybookConfig = {
  stories: ['../stories/**/*.mdx', '../stories/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  core: { disableTelemetry: true },
  viteFinal: (viteConfig) => {
    // Tailwind v4's on-demand engine; the `@source` globs in
    // `.storybook/storybook.css` point it at the web component source + the
    // stories so every modern utility class actually gets generated here.
    viteConfig.plugins = [...(viteConfig.plugins ?? []), tailwindcss()];
    // Allow a static build to be mounted under a sub-path (e.g. served through
    // the app's dev server at `/storybook/`): `STORYBOOK_BASE=/storybook/`.
    const base = process.env['STORYBOOK_BASE'];
    if (base) viteConfig.base = base;
    // Normalise whatever alias shape Storybook set (object or array) to the
    // array form so a string entry (prefix match, for `@web/*`) can sit beside
    // a regex entry (exact match, for `@tenmol/viewport`).
    const existing = viteConfig.resolve?.alias;
    const existingAliases = Array.isArray(existing)
      ? existing
      : Object.entries(existing ?? {}).map(([find, replacement]) => ({ find, replacement }));
    viteConfig.resolve = {
      ...viteConfig.resolve,
      alias: [
        // The web app's UI + features, consumed as source the way Vite does in
        // the app. String find = boundary match, so `@web/ui` resolves too.
        { find: '@web', replacement: resolve(here, '../../web/src') },
        // apps/web aliases `@tenmol/viewport` to source (it is not a dep there),
        // so we must too. Exact-match regex — a bare string alias would rewrite
        // the package's subpath imports onto `index.ts/<subpath>` and 404.
        {
          find: /^@tenmol\/viewport$/,
          replacement: resolve(here, '../../../packages/viewport/src/index.ts'),
        },
        // Every other `@tenmol/*` package resolves through its own exports map
        // (which points at src) via the workspace symlink — left un-aliased.
        ...existingAliases,
      ],
    };
    return viteConfig;
  },
};

export default config;
