import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/** Build artefacts and vendored code are never linted. */
export const sharedIgnores = {
  ignores: ['dist/**', 'coverage/**', 'node_modules/**', '**/*.d.ts'],
};

/**
 * Rule set shared by every TypeScript package in the monorepo.
 *
 * Nothing here may be relaxed to make a lint run pass (FR-012). The
 * architectural rules are layered on top by the factories at the bottom.
 */
export const typescriptBase = tseslint.config(
  sharedIgnores,
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      // TypeScript resolves identifiers itself; `no-undef` only produces
      // false positives on type-only names.
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);

// ---------------------------------------------------------------------------
// Executable architecture rules (FR-006, FR-007, SC-003)
//
// These are errors, not warnings. `no-restricted-imports` is set per directory,
// and flat-config rule settings override rather than merge — so every block
// below repeats the cross-service pattern instead of relying on inheritance.
// ---------------------------------------------------------------------------

/** No service may reach into another service, at any layer. */
const noCrossServiceImports = {
  group: ['**/*-service/**', '**/services/*/**'],
  message:
    'A service never imports another service (FR-007, constitution IV). Data owned elsewhere arrives as an event; share the message shape through @bank/contracts.',
};

const noOtherLayers = (layers, reason) => ({
  group: layers.map((layer) => `**/${layer}/**`),
  message: `${reason} (FR-006). Dependencies point inward, toward the domain.`,
});

const restricted = (...patterns) => ['error', { patterns: [noCrossServiceImports, ...patterns] }];

/**
 * The four Clean Architecture layers. Globs resolve against the directory of
 * the consuming `eslint.config.mjs`, which is each application's root.
 *
 * `src/main.ts` sits outside every layer on purpose: composing the layers is
 * the one place where wiring is allowed to see all of them.
 */
const layerRules = [
  {
    name: 'bank/layer-domain',
    files: ['src/domain/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': restricted(
        noOtherLayers(
          ['application', 'infrastructure', 'interfaces'],
          'The domain layer depends on no other layer',
        ),
        {
          group: [
            '@nestjs/*',
            '@nestjs/**',
            '@bank/*',
            '@bank/**',
            'rxjs',
            'amqplib',
            'amqp-connection-manager',
            'class-validator',
            'class-transformer',
          ],
          message:
            'The domain layer stays framework-free: entities, value objects, errors and invariants only. A framework import here is a design error, not a missing allowance.',
        },
      ),
    },
  },
  {
    name: 'bank/layer-application',
    files: ['src/application/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': restricted(
        noOtherLayers(
          ['infrastructure', 'interfaces'],
          'The application layer must not depend on adapters',
        ),
        {
          group: ['@bank/messaging', '@bank/messaging/**'],
          message:
            'Choosing a transport is infrastructure work. The application layer declares a port; infrastructure implements it with @bank/messaging.',
        },
      ),
    },
  },
  {
    name: 'bank/layer-infrastructure',
    files: ['src/infrastructure/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': restricted(
        noOtherLayers(['interfaces'], 'Infrastructure adapters must not depend on interfaces'),
      ),
    },
  },
  {
    name: 'bank/layer-interfaces',
    files: ['src/interfaces/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': restricted(
        noOtherLayers(
          ['infrastructure'],
          'Interface adapters talk to the application layer, not to infrastructure; wiring belongs in src/main.ts',
        ),
      ),
    },
  },
];

/** Applies to every file, including `src/main.ts` and the test directory. */
const crossServiceOnly = {
  name: 'bank/cross-service',
  files: ['**/*.ts'],
  rules: {
    '@typescript-eslint/no-restricted-imports': restricted(),
  },
};

/** Configuration for one of the five domain services under `apps/services/`. */
export function serviceEslintConfig() {
  return [...typescriptBase, crossServiceOnly, ...layerRules];
}

/**
 * Configuration for `apps/gateway`. Same layer rules as a service, plus the
 * gateway-specific ban: it is an entry point, never a caller of service code.
 */
export function gatewayEslintConfig() {
  return [
    ...typescriptBase,
    {
      name: 'bank/gateway-no-service-imports',
      files: ['**/*.ts'],
      rules: {
        '@typescript-eslint/no-restricted-imports': restricted({
          group: ['**/apps/services/**', '**/services/**'],
          message:
            'The gateway routes and validates shape; it never links against service code (constitution V). Publish onto the broker instead.',
        }),
      },
    },
    ...layerRules,
  ];
}

/**
 * Configuration for a shared package under `apps/packages/`. Shared code is
 * consumed by every service, so a single domain import here would couple all
 * of them at once.
 */
export function packageEslintConfig() {
  return [
    ...typescriptBase,
    {
      name: 'bank/package-no-domain-imports',
      files: ['**/*.ts'],
      rules: {
        '@typescript-eslint/no-restricted-imports': restricted({
          group: ['**/apps/services/**', '**/services/**', '**/domain/**'],
          message:
            'A shared package carries transport shapes and technical adapters only — never a service domain (FR-008, FR-010).',
        }),
      },
    },
  ];
}

export default typescriptBase;
