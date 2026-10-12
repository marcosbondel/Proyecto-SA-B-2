import { packageEslintConfig } from '@bank/tooling/eslint.base.mjs';

export default [
  ...packageEslintConfig(),
  {
    /**
     * The one CommonJS file in the package: the process the integration test
     * spawns. It must `require` `node:http` *after* `startTelemetry()` has run —
     * that ordering is exactly what it exists to exercise, and an `import` would
     * be hoisted above the call. So it is linted as what it is, a Node script,
     * rather than as an ES module that happens to break the rules.
     */
    name: 'observability/fixture-commonjs',
    files: ['test/fixtures/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { require: 'readonly', process: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
];
