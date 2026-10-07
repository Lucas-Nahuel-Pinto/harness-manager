import antfu from '@antfu/eslint-config';

export default antfu({
  typescript: {
    tsconfigPath: 'tsconfig.json',
  },

  lessOpinionated: true,

  ignores: ['node_modules', 'dist', '*.min.js', '**/*.md', '.github/**', '.superpowers/**', 'data/**'],

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
