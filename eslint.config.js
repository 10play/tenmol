// Flat ESLint config for the tenmol web client (ESLint 9).
//
// HARD RULE encoded here: the upstream PyMOL tree is never linted. Only apps/, packages/
// and the root tooling files are in scope. `pnpm lint` must never report on, or offer to
// fix, a file that came from pymol-open-source.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import jsdoc from 'eslint-plugin-jsdoc';
import globals from 'globals';

/** Everything that belongs to upstream PyMOL, to a build, or to codegen output. */
const IGNORES = [
  '**/node_modules/**',
  '**/dist/**',
  '**/storybook-static/**',
  // Local-only static Storybook served through the app dev server (gitignored).
  'apps/web/public/storybook/**',
  '**/.turbo/**',
  '**/generated/**',
  '**/*.d.ts',
  // bootstrap work areas (venv, vendored C++ headers) - never source
  '**/.venv/**',
  '.deps/**',
  // our own docs and scratch, which are prose and leaked render output
  'docs/**',
  'web/.scratch/**',
  // upstream PyMOL tree - do not touch
  'packages/engine/build/**',
  'packages/engine/_custom_build/**',
  'packages/engine/contrib/**',
  'packages/engine/data/**',
  'packages/engine/examples/**',
  'packages/engine/include/**',
  'packages/engine/layer0/**',
  'packages/engine/layer1/**',
  'packages/engine/layer2/**',
  'packages/engine/layer3/**',
  'packages/engine/layer4/**',
  'packages/engine/layer5/**',
  'packages/engine/layerCTest/**',
  'packages/engine/layerGraphics/**',
  'packages/engine/modules/**',
  'packages/engine/ov/**',
  'packages/engine/test/**',
  'packages/engine/testing/**',
];

export default tseslint.config(
  { ignores: IGNORES },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,

  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
    },
  },

  {
    // Documentation well-formedness for the public API surface. These are
    // CHECK-only rules: they validate JSDoc that already exists (param names
    // match, types are the preferred spelling, no stray asterisks), but they do
    // NOT require a doc block. Presence and coverage are the ratchet gate's job
    // (scripts/doc-coverage.mjs), so this never floods the ~2000-symbol backlog
    // with warnings under `--max-warnings 0`.
    files: ['packages/*/src/**/*.{ts,tsx}', 'apps/web/src/**/*.{ts,tsx}'],
    plugins: { jsdoc },
    settings: { jsdoc: { mode: 'typescript' } },
    rules: {
      // disableMissingParamChecks: this repo documents only the parameters that
      // need explaining, not every one in order. The rule still flags a @param
      // whose name matches no actual parameter (genuine doc/signature drift).
      'jsdoc/check-param-names': [
        'error',
        { disableMissingParamChecks: true, checkDestructured: false },
      ],
      'jsdoc/check-property-names': 'error',
      'jsdoc/check-types': 'error',
      'jsdoc/empty-tags': 'error',
    },
  },

  {
    // Root tooling and Node-side scripts.
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
);
