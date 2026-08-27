import { strict as assert } from 'node:assert';
import { readFile, readdir } from 'node:fs/promises';
import { test, describe } from 'node:test';

/**
 * The shell shipped once with a **one-byte stylesheet**.
 *
 * `@nuxt/ui` does not inject its own CSS: it expects an entry that imports
 * `tailwindcss` and `@nuxt/ui`, and the minimal starter this application grew
 * from had none. Every component still rendered — as unstyled HTML, in a serif
 * font, with native form controls.
 *
 * Nothing caught it. `pnpm build`, `lint`, `typecheck` and `test` were all
 * green, because a missing stylesheet is not a type error, not a lint error and
 * not a failing assertion. It is only visible to someone looking at the page.
 *
 * These tests are the cheapest thing that would have caught it.
 */

const CSS = new URL('../app/assets/css/main.css', import.meta.url);

/** CSS has one comment form, and it is the one that hides a false positive. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ');
}
const CONFIG = new URL('../nuxt.config.ts', import.meta.url);

describe('the stylesheet entry exists and is wired up', () => {
  test('imports Tailwind and Nuxt UI, in that order', async () => {
    const source = await readFile(CSS, 'utf8');

    const tailwind = source.indexOf('@import "tailwindcss"');
    const nuxtUi = source.indexOf('@import "@nuxt/ui"');

    assert.ok(tailwind >= 0, 'main.css no longer imports tailwindcss');
    assert.ok(nuxtUi >= 0, 'main.css no longer imports @nuxt/ui');
    assert.ok(tailwind < nuxtUi, '@nuxt/ui must be imported after tailwindcss');
  });

  test('nuxt.config registers it, or nothing compiles', async () => {
    const source = await readFile(CONFIG, 'utf8');

    assert.match(
      source,
      /css:\s*\[\s*['"]~\/assets\/css\/main\.css['"]/,
      'nuxt.config no longer registers main.css; the build will serve an empty stylesheet',
    );
  });

  test('stays light-only, because the design system defines one palette', async () => {
    const source = await readFile(CONFIG, 'utf8');

    assert.match(source, /preference:\s*['"]light['"]/);
  });
});

describe('every semantic colour resolves to a real palette', () => {
  /**
   * The obvious spelling, `var(--ui-color-primary-500)`, silently resolves to
   * nothing: the module never declares that variable. A dangling custom
   * property is not an error in CSS — the declaration is simply dropped — so
   * this is asserted rather than trusted.
   */
  test('no --ui-* variable points at something undeclared', async () => {
    // Comments are stripped first. The file *explains* that
    // `var(--ui-color-primary-500)` dangles, and that sentence is the reason
    // nobody will reintroduce it — a scan that cannot tell prose from CSS
    // would force the warning out in order to stay green.
    const source = stripComments(await readFile(CSS, 'utf8'));

    const declared = new Set([...source.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const referenced = [...source.matchAll(/var\((--ui-[a-z0-9-]+)\)/g)].map((m) => m[1]);

    const dangling = referenced.filter((name) => !declared.has(name));

    assert.deepEqual(dangling, [], `these resolve to nothing: ${dangling.join(', ')}`);
  });

  test('the six semantic aliases are all defined', async () => {
    const source = await readFile(CSS, 'utf8');

    for (const alias of ['primary', 'secondary', 'neutral', 'success', 'warning', 'error']) {
      assert.match(source, new RegExp(`--ui-${alias}:`), `--ui-${alias} is not defined`);
    }
  });

  test('carries the tones docs/DESIGN.md fixes', async () => {
    const source = await readFile(CSS, 'utf8');

    // Obsidian for action, and the three deepened semantic colours.
    assert.match(source, /--color-obsidian-500:\s*#17191f/i);
    assert.match(source, /--color-graphite-50:\s*#f6f6f7/i);
    assert.match(source, /--color-moss-500:\s*#1e7a3c/i);
    assert.match(source, /--color-amber-500:\s*#b4740a/i);
    assert.match(source, /--color-crimson-500:\s*#b01b1b/i);
  });

  /** The palette this document used to carry, and must not carry again. */
  test('carries no trace of the superseded blue revision', async () => {
    const source = await readFile(CSS, 'utf8');

    for (const gone of ['#2a53fd', '#002db5', '#6372c0', '#fbf8ff']) {
      assert.equal(
        source.toLowerCase().includes(gone),
        false,
        `${gone} belongs to the Bank USAC Core revision, replaced by bonking. Core`,
      );
    }
  });
});

describe('the built output actually contains styles', () => {
  /**
   * The end of the chain. Everything above can be right and this can still be
   * empty if the toolchain changes underneath it — which is exactly what
   * happened.
   */
  test('the emitted stylesheet is not a stub', async () => {
    const directory = new URL('../.output/public/_nuxt/', import.meta.url);

    let files;
    try {
      files = await readdir(directory);
    } catch {
      // No build present. Skipped rather than failed: `pnpm test` must work in
      // a fresh clone, and the assertions above already cover the source.
      return;
    }

    const stylesheets = files.filter((name) => name.endsWith('.css'));
    assert.ok(stylesheets.length > 0, 'the build emitted no stylesheet at all');

    const sizes = await Promise.all(
      stylesheets.map(async (name) => (await readFile(new URL(name, directory), 'utf8')).length),
    );

    // The real failure produced one byte. Anything under 50 KB means Tailwind
    // and Nuxt UI did not compile.
    assert.ok(
      Math.max(...sizes) > 50_000,
      `largest stylesheet is ${String(Math.max(...sizes))} bytes; Tailwind did not compile`,
    );
  });
});
