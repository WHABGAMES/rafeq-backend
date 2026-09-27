/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  env: {
    node: true,
    jest: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  ignorePatterns: ['dist/', 'coverage/', 'node_modules/'],
  rules: {
    // Existing code predates linting. The first rollout reports its baseline
    // without turning unrelated legacy style debt into a release outage.
    // New and changed code is still reviewed against this report, while TypeScript
    // remains a hard CI gate.
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/ban-ts-comment': 'warn',
    'no-control-regex': 'warn',
    'no-empty': 'warn',
    'no-fallthrough': 'warn',
    'no-misleading-character-class': 'warn',
    'no-useless-escape': 'warn',
    'prefer-const': 'warn',
  },
};
