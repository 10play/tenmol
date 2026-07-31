/**
 * Vitest workspace (WP-00, frozen skeleton).
 *
 * Two projects, split by environment, because the split is not per-package:
 * `@tenmol/protocol` codec tests are node, `@tenmol/ui` component tests are
 * DOM, and `@tenmol/viewport` has both (a camera-math test needs no DOM, a
 * presenter test needs a canvas).
 *
 * A package opts a file into the DOM project by naming it `*.dom.test.ts(x)`
 * or by living in a `__dom__/` directory; everything else runs in node. This
 * keeps the workspace file frozen: no new entry is needed when a package is
 * added, so no work package ever has to edit this file.
 *
 * The upstream PyMOL tree is excluded explicitly -- `testing/` is PyMOL's own
 * Python test suite and must never be walked by vitest.
 *
 * Python tests are NOT here. They run under pytest in the bridge venv:
 *   pnpm test:bridge          (== scripts/dev-bridge.sh --exec python -m pytest bridge/tests)
 */
import { defineWorkspace } from 'vitest/config';

const EXCLUDE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.venv/**',
  '**/generated/**',
  // upstream PyMOL
  'build/**',
  '_custom_build/**',
  'contrib/**',
  'data/**',
  'examples/**',
  'layer*/**',
  'modules/**',
  'ov/**',
  'test/**',
  'testing/**',
];

const DOM = ['**/*.dom.test.{ts,tsx}', '**/__dom__/**/*.test.{ts,tsx}'];

export default defineWorkspace([
  {
    test: {
      name: 'node',
      environment: 'node',
      include: ['{packages,apps,tools}/*/{src,test,tests}/**/*.{test,spec}.{ts,tsx}'],
      exclude: [...EXCLUDE, ...DOM],
      passWithNoTests: true,
    },
  },
  {
    test: {
      name: 'dom',
      environment: 'jsdom',
      include: DOM.map((p) => `{packages,apps}/*/{src,test,tests}/${p}`),
      exclude: EXCLUDE,
      passWithNoTests: true,
    },
  },
]);
