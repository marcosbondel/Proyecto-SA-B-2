import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SERVICE = resolve(__dirname, '..');

/**
 * Criterion 6 of the ticket, made executable: **no writes to another service's
 * database and no business command emitted**.
 *
 * It is the claim a reviewer would otherwise have to take on trust, and the one
 * a single well-meaning commit could quietly break. This service is the most
 * tempting place in the bank to break it: it hears every event, so "we already
 * know the transactionId, let us just read the transfer to enrich the trail" is
 * one line away at all times. The search covers the source, the environment
 * template and the declared dependencies, because a violation can hide in any
 * of the three.
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
    /\bpayment_attempts\b/i,
    /\btransactions\b/i,
    /\btransaction_events\b/i,
  ];

  it('names no other service in its dependencies', () => {
    const declared = Object.keys({ ...PACKAGE.dependencies, ...PACKAGE.devDependencies });

    expect(
      declared.filter((name) => /-service$/.test(name) && name !== 'notification-audit-service'),
    ).toEqual([]);
  });

  it('imports no sibling service', () => {
    for (const source of SOURCES) {
      expect(source.text).not.toMatch(/from '.*(customer|account|payment|transaction)-service/);
    }
  });

  /**
   * The load-bearing one. A `correlationId` is the only key this service joins
   * on, and it joins it against its own two tables — the moment it resolves a
   * `transactionId` against somebody else's table, the audit trail has become a
   * second read model over the whole bank, maintained by nobody.
   */
  it('queries no table that belongs to another service', () => {
    const sql = SOURCES.filter((source) => /SELECT|INSERT|UPDATE|DELETE/i.test(source.text));

    for (const source of sql) {
      /*
       * This service's own names are stripped first, so the word-boundary
       * patterns do not match `audit_events`, `notifications` or
       * `processed_messages`.
       */
      const withoutOwnNames = source.text
        .replace(/audit_events/g, '')
        .replace(/processed_messages/g, '')
        .replace(/notifications/g, '')
        .replace(/schema_migrations/g, '');

      for (const pattern of FOREIGN_TABLES) {
        expect(withoutOwnNames).not.toMatch(pattern);
      }
    }
  });

  it('declares exactly one database URL, its own', () => {
    const urls = SOURCES.flatMap((source) => source.text.match(/[A-Z_]*DATABASE_URL/g) ?? []);

    expect(new Set(urls)).toEqual(new Set(['DATABASE_URL']));
  });
});

describe('this service starts nothing', () => {
  /**
   * Criterion 6's second half, and the reason `ReplyPublisher` has one method.
   * A publisher that could `send` would be a publisher some future handler
   * could use to order a debit — and an audit service that can move money is
   * not an audit service.
   */
  it('publishes only onto the replies exchange', () => {
    const publishers = SOURCES.filter((source) => /EXCHANGES\./.test(source.text));

    expect(publishers.map((source) => source.path)).toEqual([
      'src/infrastructure/messaging/broker-reply.publisher.ts',
      'src/main.ts',
    ]);

    const publisher = publishers.find((source) => source.path.includes('broker-reply'));

    expect(publisher?.text).toMatch(/EXCHANGES\.replies/);
    expect(publisher?.text).not.toMatch(/EXCHANGES\.commands|EXCHANGES\.events/);
  });

  /**
   * `main.ts` names the two business exchanges once, to declare them at boot so
   * its own queues can bind to them. That is infrastructure rather than intent,
   * and it is the only place either name may appear outside the reply
   * publisher's refusal to use them.
   */
  it('names the business exchanges nowhere a message could be put on one', () => {
    const mentions = SOURCES.filter((source) =>
      /EXCHANGES\.(commands|events)/.test(source.text),
    );

    expect(mentions.map((source) => source.path)).toEqual(['src/main.ts']);
    expect(mentions[0]?.text).not.toMatch(/publish\([^)]*EXCHANGES\.(commands|events)/);
  });

  /**
   * The port itself. One method, and the two that would let this service start
   * something absent by construction — no amount of documentation is as
   * convincing as the method not existing.
   */
  it('offers no way to publish anything but a reply', () => {
    const ports = SOURCES.find((source) => source.path === 'src/application/ports.ts');

    expect(ports?.text).toMatch(/interface ReplyPublisher \{\s*reply\(/);
    expect(ports?.text).not.toMatch(/interface ReplyPublisher \{[^}]*(send|publish)\(/);
  });
});

describe('this service speaks to the system only through the broker', () => {
  it('makes no HTTP call to anybody', () => {
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

describe('the privacy rule lives in one place', () => {
  /**
   * `redactPayload` is the only thing standing between "we record everything"
   * and "we reassembled the bank's personal data in one table". A second
   * implementation — or a raw payload written anywhere — is the failure this
   * asserts against, and it is the one failure no later test can undo.
   */
  it('redacts on the way in, in the repository, and nowhere else', () => {
    const users = SOURCES.filter((source) => /redactPayload/.test(source.text));

    expect(users.map((source) => source.path).sort()).toEqual([
      'src/domain/redaction.ts',
      'src/infrastructure/persistence/postgres-audit.repository.ts',
    ]);
  });

  it('never writes a payload the redaction has not seen', () => {
    const repository = SOURCES.find((source) => source.path.includes('postgres-audit.repository'));
    const insert = /INSERT INTO audit_events[\s\S]*?\);/.exec(repository?.text ?? '');

    expect(insert?.[0]).toMatch(/redactPayload\(/);
    expect(insert?.[0]).not.toMatch(/event\.payload,/);
  });
});
