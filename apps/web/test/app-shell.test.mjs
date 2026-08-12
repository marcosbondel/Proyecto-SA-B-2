import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

// The minimal test every application in the workspace carries (SC-002). It runs
// on the Node test runner so the web app gains no second test framework: Jest
// cannot compile single-file components, and a Nuxt-native runner is deferred
// (see TD-010 in docs/TECH_DEBT.md).

test('nuxt.config.ts still declares the modules the architecture depends on', async () => {
  const source = await readFile(new URL('../nuxt.config.ts', import.meta.url), 'utf8');

  for (const module of ['@nuxt/eslint', '@nuxt/ui', '@artmizu/nuxt-prometheus']) {
    assert.ok(source.includes(module), `nuxt.config.ts no longer declares ${module}`);
  }
});

test('the root component Nuxt builds from exists and is not empty', async () => {
  const root = await readFile(new URL('../app/app.vue', import.meta.url), 'utf8');

  assert.ok(root.trim().length > 0, 'app/app.vue is empty');
});
