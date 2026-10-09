import antfu from '@antfu/eslint-config';

export default antfu({
  typescript: {
    tsconfigPath: 'tsconfig.json',
    // relay/worker.ts is excluded from the root tsconfig (Cloudflare types clash with DOM) and
    // type-checked by `types:relay` (relay/tsconfig.json). The project service is a singleton, so
    // its fallback project must resolve CF globals for that one file — relay/tsconfig.json does.
    parserOptions: {
      projectService: {
        allowDefaultProject: ['./*.js', 'relay/worker.ts'],
        defaultProject: 'relay/tsconfig.json',
      },
    },
  },

  lessOpinionated: true,

  ignores: ['node_modules', 'dist', 'dist-online', '*.min.js', '**/*.md', '.github/**', '.superpowers/**', 'data/**', 'tests/fixtures/**'],

  rules: {
    'no-console': 'off',

    'ts/explicit-function-return-type': 'off',
    'ts/explicit-module-boundary-types': 'off',
    'ts/no-explicit-any': 'warn',
    'ts/strict-boolean-expressions': 'off',

    'node/prefer-global/buffer': 'off',
    'node/prefer-global/process': 'off',

    'style/semi': ['error', 'always'],
    'style/quotes': ['error', 'single'],
    'style/comma-dangle': ['error', 'always-multiline'],
    'style/max-statements-per-line': 'off',

    'unused-imports/no-unused-vars': [
      'warn',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      },
    ],
  },
});
