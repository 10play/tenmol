// Flat ESLint config for the tenmol web client (ESLint 9).
//
// HARD RULE encoded here: the upstream PyMOL tree is never linted. Only apps/, packages/
// and the root tooling files are in scope. `pnpm lint` must never report on, or offer to
// fix, a file that came from pymol-open-source.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/** Everything that belongs to upstream PyMOL, to a build, or to codegen output. */
const IGNORES = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.turbo/**',
  '**/generated/**',
  '**/*.d.ts',
  // bootstrap work areas (venv, vendored C++ headers) - never source
  '**/.venv/**',
  '.deps/**',
  // upstream PyMOL tree - do not touch
  'build/**',
  '_custom_build/**',
  'contrib/**',
  'data/**',
  'docs/**',
  'examples/**',
  'include/**',
  'layer0/**',
  'layer1/**',
  'layer2/**',
  'layer3/**',
  'layer4/**',
  'layer5/**',
  'layerCTest/**',
  'layerGraphics/**',
  'modules/**',
  'ov/**',
  'test/**',
  'testing/**',
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
    // Root tooling and Node-side scripts.
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
);
