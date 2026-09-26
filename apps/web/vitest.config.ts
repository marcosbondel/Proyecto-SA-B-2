import { defineConfig } from 'vitest/config';

/**
 * The integration layer that closes TD-010: real HTTP against a real Nitro
 * server process, never a component mount.
 *
 * `test/**\/*.test.mjs` (272 cases, `node --test`) is untouched by this file —
 * it is a separate `pnpm test:unit` script and stays that way so the existing
 * baseline cannot silently move.
 *
 * Everything here runs single-threaded and unisolated on purpose. The one
 * `nuxt build` this suite needs happens exactly once in
 * `test/integration/support/global-setup.ts`, before any spec file starts;
 * every spec file then points `@nuxt/test-utils` at an already-running server
 * instead of building its own. That sharing only works if every file runs in
 * the same worker and the same module registry — `fileParallelism: false`
 * plus `singleThread: true` keep it to one worker, and `isolate: false` keeps
 * that worker from wiping its module registry between files. None of this
 * suite touches Vue component state across files, so losing module isolation
 * costs nothing here.
 */
export default defineConfig({
  test: {
    include: ['test/integration/**/*.integration.spec.ts'],
    globalSetup: ['test/integration/support/global-setup.ts'],
    fileParallelism: false,
    isolate: false,
    pool: 'threads',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
  },
});
