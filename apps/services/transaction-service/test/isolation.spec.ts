import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SERVICE = resolve(__dirname, '..');

/**
 * Criterion 8 of the ticket, made executable: **no synchronous query and no
 * access to Account Service's database**.
 *
 * It is the claim a reviewer would otherwise have to take on trust, and the one
 * a single well-meaning commit could quietly break — "just reading the accounts
 * table to check the balance before starting the Saga" is exactly how a
 * choreographed Saga becomes an orchestrator with a shared database. The search
 * covers the source, the environment template and the declared dependencies,
 * because a violation can hide in any of the three.
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
  const FOREIGN_TABLES = [
    /\baccounts\b/i,
    /\baccount_operations\b/i,
    /\bcustomers\b/i,
    /\bidentity_documents\b/i,
    /\bpayments\b/i,
    /\bnotifications\b/i,
    /\baudit_events\b/i,
  ];

  it('names no other service in its dependencies', () => {
    const declared = Object.keys({ ...PACKAGE.dependencies, ...PACKAGE.devDependencies });

    expect(
      declared.filter((name) => /-service$/.test(name) && name !== 'transaction-service'),
    ).toEqual([]);
  });

  it('imports no sibling service', () => {
    for (const source of SOURCES) {
      expect(source.text).not.toMatch(/from '.*(customer|account|payment|notification)-service/);
    }
  });

  /**
   * The load-bearing one, and the one criterion 8 is about. `source_account`
   * and `target_account` are opaque references and this service must never
   * resolve them — "just joining the accounts table to check the balance" is
   * how the single owner of the balance stops being the single owner.
   */
  it('queries no table that belongs to another service', () => {
    const sql = SOURCES.filter((source) => /SELECT|INSERT|UPDATE|DELETE/i.test(source.text));

    for (const source of sql) {
      for (const pattern of FOREIGN_TABLES) {
        /*
         * This service's own names are stripped first, so the word-boundary
         * patterns do not match `transaction_aliases` or the two account
         * columns that are references rather than joins.
         */
        const withoutOwnNames = source.text
          .replace(/transaction_aliases/g, '')
          .replace(/transaction_events/g, '')
          .replace(/transactions/g, '')
          .replace(/source_account/g, '')
          .replace(/target_account/g, '');

        expect(withoutOwnNames).not.toMatch(pattern);
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
    // A Saga in choreography reaches nobody synchronously. If this ever fails,
    // the pattern the assignment asks for has been replaced by orchestration
    // over HTTP, whatever the diagram still says.
    for (const source of SOURCES) {
      // `(?<![.#\w])` so a private method of this service — or any `.fetch(` on
      // an SDK object — is not mistaken for the global.
      expect(source.text).not.toMatch(/(?<![.#\w])fetch\(|axios|node-fetch|HttpService/);
    }
  });

  it('exposes HTTP for health and readiness only', () => {
    const controllers = SOURCES.filter((source) => /@Controller/.test(source.text));

    expect(controllers.map((source) => source.path)).toEqual([
      'src/interfaces/health.controller.ts',
    ]);

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

describe('the state machine lives in one place', () => {
  /**
   * A transition decided outside `domain/transaction.ts` is a transition
   * nobody's tests cover and the lock does not protect. The status strings are
   * the tell: if they start appearing in comparisons elsewhere, some other file
   * has begun deciding what follows what.
   */
  it('compares a status nowhere but the domain and the SQL that stores it', () => {
    const offenders = SOURCES.filter(
      (source) =>
        !source.path.startsWith('src/domain/') &&
        !source.path.includes('persistence') &&
        /(===|!==)\s*'(PENDING|DEBITING|PAYMENT_PENDING|COMPLETED|COMPENSATED)'/.test(source.text),
    );

    expect(offenders.map((source) => source.path)).toEqual([]);
  });
});
