import { packageEslintConfig } from '@bank/tooling/eslint.base.mjs';

export default [
  ...packageEslintConfig(),
  {
    // The generator scripts are Node programs, not library code: they run once
    // to produce `schema/`, `docs/events/catalog.md` and the worked examples.
    // They are not type-checked with the package because they consume `dist/`.
    name: 'bank/contracts-scripts',
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' },
    },
  },
];
