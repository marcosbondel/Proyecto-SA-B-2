import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SERVICE = resolve(__dirname, '..');

/**
 * Criterion 6 of the ticket, made executable: this service owns its data and
 * reaches nobody else's.
 *
 * It is the claim a reviewer would otherwise have to take on trust, and the one
 * a single well-meaning commit could quietly break — "just reading the account
 * table to check the balance" is exactly how a per-service database stops being
 * one. The search covers the source, the environment template and the declared
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
 * Comments are stripped before searching, so prose that *names* a forbidden
 * thing in order to explain why it is forbidden does not fail the test that
 * enforces it.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

const SOURCES = sourceFiles(join(SERVICE, 'src')).map((path) => ({
  path: path.slice(SERVICE.length + 1),
  text: withoutComments(readFileSync(path, 'utf8')),
}));

const PACKAGE = JSON.parse(readFileSync(join(SERVICE, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

describe('this service reads no other service', () => {
  const FOREIGN_TABLES = [/\baccounts\b/i, /\btransactions\b/i, /\bpayments\b/i, /\bnotifications\b/i];

  it('names no other service in its dependencies', () => {
    const declared = Object.keys({ ...PACKAGE.dependencies, ...PACKAGE.devDependencies });

    expect(
      declared.filter((name) => /-service$/.test(name) && name !== 'customer-service'),
    ).toEqual([]);
  });

  it('imports no sibling service', () => {
    for (const source of SOURCES) {
      expect(source.text).not.toMatch(/from '.*(account|transaction|payment|notification)-service/);
    }
  });

  it('queries no table that belongs to another service', () => {
    const sql = SOURCES.filter((source) => /SELECT|INSERT|UPDATE|DELETE/i.test(source.text));

    // The four tables this service owns are the only ones any statement names.
    for (const source of sql) {
      for (const pattern of FOREIGN_TABLES) {
        expect(source.text.replace(/customers/g, '')).not.toMatch(pattern);
      }
    }
  });

  it('declares exactly one database URL, its own', () => {
    const urls = SOURCES.flatMap((source) => source.text.match(/[A-Z_]*DATABASE_URL/g) ?? []);

    expect(new Set(urls)).toEqual(new Set(['DATABASE_URL']));
  });
});

describe('this service speaks to the system only through the broker', () => {
  it('makes no HTTP call to anybody', () => {
    // The Gateway is an entry point; this service is not a client of one.
    for (const source of SOURCES) {
      // `(?<![.#\w])` so a private method of this service called `#readPhoto`
      // — or any `.fetch(` on an SDK object — is not mistaken for the global.
      expect(source.text).not.toMatch(/(?<![.#\w])fetch\(|axios|node-fetch|HttpService/);
    }
  });

  it('exposes HTTP for health and readiness only', () => {
    const controllers = SOURCES.filter((source) => /@Controller/.test(source.text));

    expect(controllers.map((source) => source.path.replace(/\\/g, '/'))).toEqual(['src/interfaces/health.controller.ts']);

    for (const source of controllers) {
      const routes = source.text.match(/@(Get|Post|Patch|Put|Delete)\('([^']*)'\)/g) ?? [];

      expect(routes.sort()).toEqual(["@Get('health')", "@Get('ready')"]);
    }
  });
});

describe('the layers point inward', () => {
  it('keeps the domain free of frameworks, contracts and drivers', () => {
    // The lint rules enforce this too; asserting it here makes the reason
    // visible next to the rules it protects.
    for (const source of SOURCES.filter((file) => file.path.startsWith('src/domain/'))) {
      expect(source.text).not.toMatch(/from '(@nestjs|@bank|pg|@aws-sdk)/);
    }
  });

  it('keeps the transport out of the application layer', () => {
    for (const source of SOURCES.filter((file) => file.path.startsWith('src/application/'))) {
      expect(source.text).not.toMatch(/from '(@bank\/messaging|pg|@aws-sdk)/);
    }
  });
});
