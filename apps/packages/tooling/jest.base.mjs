/**
 * Shared Jest configuration for every TypeScript application and package.
 *
 * Consumers create a `jest.config.mjs` at their root:
 *
 *   import { jestBaseConfig } from '@bank/tooling/jest.base.mjs';
 *   export default jestBaseConfig;
 *
 * `<rootDir>` resolves to the consuming package, so the same object works
 * unchanged for the gateway, the five services and the shared packages.
 *
 * @type {import('jest').Config}
 */
export const jestBaseConfig = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  collectCoverageFrom: ['<rootDir>/src/**/*.ts'],
  coverageDirectory: '<rootDir>/coverage',
  clearMocks: true,
  passWithNoTests: false,
};

export default jestBaseConfig;
