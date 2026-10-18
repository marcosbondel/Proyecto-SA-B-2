import base from '@bank/tooling/eslint.base.mjs';

export default [
  ...base,
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: Object.fromEntries(
        [
          'URL',
          'fetch',
          'AbortSignal',
          'setTimeout',
          'clearTimeout',
          'setInterval',
          'clearInterval',
          'process',
          'Buffer',
        ].map((name) => [name, 'readonly']),
      ),
    },
  },
];
