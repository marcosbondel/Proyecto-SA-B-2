import { gatewayEslintConfig } from '@bank/tooling/eslint.base.mjs';

export default [
  ...gatewayEslintConfig(),
  {
    /**
     * The one CommonJS file in the package: the process
     * `server-span-correlation.integration.spec.ts` spawns. It must `require`
     * `node:http` and Express *after* `startTelemetry()` has run — that
     * ordering is exactly what it exists to exercise, and an `import` would be
     * hoisted above the call. Linted as what it is, a Node script.
     */
    name: 'gateway/fixture-commonjs',
    files: ['test/fixtures/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { require: 'readonly', process: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
];
