import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const GATEWAY = resolve(__dirname, '..');

/**
 * Criterion 4 of the ticket, and the executable half of criterion 2.4: the
 * Gateway has no database and never speaks HTTP to an internal service.
 *
 * These are the two claims a reviewer would otherwise have to take on trust,
 * and the two that a single well-meaning commit could quietly break — someone
 * "just fetching the customer to validate it" is exactly how an entry point
 * grows a dependency it is not allowed to have.
 *
 * The search is over the source, the environment template and the declared
 * dependencies, because a violation can hide in any of the three.
 */

function sourceFiles(directory: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (path.endsWith('.ts')) {
      found.push(path);
    }
  }

  return found;
}

/**
 * Comments are stripped before searching.
 *
 * Not a convenience: the file that configures the environment *explains* that
 * the gateway declares no `DATABASE_URL`, and that sentence is worth keeping —
 * it is what stops somebody adding one back as an oversight. A search that
 * cannot tell prose from code would force the comment out to stay green, which
 * is the test damaging the thing it exists to protect.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

const SOURCES = sourceFiles(join(GATEWAY, 'src')).map((path) => ({
  path: path.slice(GATEWAY.length + 1),
  text: withoutComments(readFileSync(path, 'utf8')),
}));

describe('the gateway has no database', () => {
  const DATABASE_MARKERS = [
    /\bDATABASE_URL\b/,
    /postgres(ql)?:\/\//,
    /\bTypeOrmModule\b/,
    /@nestjs\/typeorm/,
    /\bPrismaClient\b/,
    /\bfrom 'pg'/,
    /\bknex\b/,
    /\bSequelize\b/,
  ];

  it.each(DATABASE_MARKERS)('has no source file matching %s', (marker) => {
    const offenders = SOURCES.filter((file) => marker.test(file.text)).map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  it('declares no database driver among its dependencies', () => {
    const manifest = readFileSync(join(GATEWAY, 'package.json'), 'utf8');
    const declared = JSON.parse(manifest) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    const names = [
      ...Object.keys(declared.dependencies),
      ...Object.keys(declared.devDependencies),
    ];

    for (const forbidden of ['pg', 'typeorm', '@nestjs/typeorm', 'prisma', '@prisma/client', 'mysql2', 'knex', 'sequelize', 'mongoose']) {
      expect(names).not.toContain(forbidden);
    }
  });

  /**
   * The absence of `DATABASE_URL` from the environment template is itself a
   * deliverable, and the comment that explains why is what stops somebody
   * adding it back as an oversight.
   */
  it('keeps the environment template free of one, and says why', () => {
    const template = readFileSync(join(GATEWAY, '.env.example'), 'utf8');

    expect(template).not.toMatch(/^DATABASE_URL=/m);
    expect(template).toMatch(/declares no DATABASE_URL/);
  });

  /**
   * The object store is not a database and its presence is correct: ADR-012
   * defines the bucket as a transfer buffer that holds no business state and
   * that nobody queries to decide anything.
   */
  it('does use object storage, which is a different thing', () => {
    const manifest = JSON.parse(readFileSync(join(GATEWAY, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };

    expect(Object.keys(manifest.dependencies)).toContain('@aws-sdk/client-s3');
  });
});

describe('the gateway never calls a service over HTTP', () => {
  const HTTP_CLIENTS = [
    /\bfrom 'axios'/,
    /\bfrom 'node-fetch'/,
    /\bfrom 'got'/,
    /\bfrom 'superagent'/,
    /@nestjs\/axios/,
    /\bHttpModule\b/,
    /\bHttpService\b/,
  ];

  it.each(HTTP_CLIENTS)('has no source file matching %s', (marker) => {
    const offenders = SOURCES.filter((file) => marker.test(file.text)).map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  it('declares no HTTP client among its dependencies', () => {
    const manifest = JSON.parse(readFileSync(join(GATEWAY, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    const names = [
      ...Object.keys(manifest.dependencies),
      ...Object.keys(manifest.devDependencies),
    ];

    for (const forbidden of ['axios', '@nestjs/axios', 'node-fetch', 'got', 'superagent', 'undici']) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('addresses no internal service by name over a URL', () => {
    const internal =
      /https?:\/\/[^"'`\s]*(customer|account|transaction|payment|notification)[a-z-]*service/i;

    const offenders = SOURCES.filter((file) => internal.test(file.text)).map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  /**
   * The one lint rule specific to this application: it is an entry point, never
   * a caller of service code. Asserting it here as well means the guarantee
   * survives someone running the tests without running the linter.
   */
  it('links against no service code', () => {
    const serviceImport = /from '[^']*(apps\/services|\.\.\/services)\//;

    const offenders = SOURCES.filter((file) => serviceImport.test(file.text)).map(
      (file) => file.path,
    );

    expect(offenders).toEqual([]);
  });
});

describe('the search itself is meaningful', () => {
  /** A search over an empty set proves nothing, so the set is checked. */
  it('actually read the gateway source', () => {
    expect(SOURCES.length).toBeGreaterThan(20);
    expect(SOURCES.some((file) => file.path.endsWith('main.ts'))).toBe(true);
  });
});
