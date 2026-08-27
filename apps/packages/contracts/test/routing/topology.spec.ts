import { catalog } from '../../src/events';
import { EXCHANGES, destinationFor, routingKeyFor } from '../../src/routing/routing-keys';
import {
  MAX_RETRIES,
  QUEUES,
  RETRY_DELAYS_MS,
  allQueueDeclarations,
  deadLetterQueueName,
  matchesTopicPattern,
  queuesFor,
  retryQueueName,
  unroutedContracts,
} from '../../src/routing/topology';

describe('routing keys', () => {
  it('uses the message name verbatim, so there is no table to keep in step', () => {
    for (const contract of catalog) {
      expect(routingKeyFor(contract.name)).toBe(contract.name);
    }
  });

  it('sends each category to its own exchange', () => {
    expect(destinationFor(catalog.find((c) => c.category === 'command')!).exchange).toBe(
      EXCHANGES.commands,
    );
    expect(destinationFor(catalog.find((c) => c.category === 'event')!).exchange).toBe(
      EXCHANGES.events,
    );
    expect(destinationFor(catalog.find((c) => c.category === 'reply')!).exchange).toBe(
      EXCHANGES.replies,
    );
  });

  it('keeps a v1 consumer from ever seeing a v2 message', () => {
    expect(matchesTopicPattern('account.debited.v1', 'account.debited.v1')).toBe(true);
    expect(matchesTopicPattern('account.debited.v2', 'account.debited.v1')).toBe(false);
  });
});

describe('topic pattern matching', () => {
  it('treats * as exactly one word', () => {
    expect(matchesTopicPattern('customer.register.v1', 'customer.*.v1')).toBe(true);
    expect(matchesTopicPattern('customer.email.verified.v1', 'customer.*.v1')).toBe(false);
  });

  it('treats # as zero or more words', () => {
    expect(matchesTopicPattern('account.debit.requested.v1', 'account.#')).toBe(true);
    expect(matchesTopicPattern('payment.requested.v1', 'account.#')).toBe(false);
    expect(matchesTopicPattern('anything.at.all', '#')).toBe(true);
  });
});

describe('queues', () => {
  it('gives every logical consumer its own queue', () => {
    expect(QUEUES).toHaveLength(6);
  });

  it('shares no queue between two services, which criterion 2.5 penalises', () => {
    const byName = new Map<string, string>();

    for (const queue of QUEUES) {
      expect(byName.has(queue.name)).toBe(false);
      byName.set(queue.name, queue.owner);
    }
  });

  it('routes every command and event to at least one queue', () => {
    expect(unroutedContracts()).toEqual([]);
  });

  it('gives every command exactly one receiving queue', () => {
    for (const contract of catalog.filter((c) => c.category === 'command')) {
      expect(queuesFor(contract)).toHaveLength(1);
    }
  });

  it('sends the saga events to Transaction and to Audit, and to nobody else', () => {
    const debited = catalog.find((c) => c.name === 'account.debited.v1')!;

    expect([...queuesFor(debited)].sort()).toEqual(['audit.all', 'transaction.saga']);
  });

  /**
   * The `account.#` binding is what lets T-17 add two queries without touching
   * the topology, and narrowing it to `account.*.v1` would silently strand
   * every dotted name — `account.list.query.v1` has four words, not three.
   * Asserting the outcome rather than the pattern is what makes that a failing
   * test instead of a message nobody consumes.
   */
  it('delivers the queries T-17 added to the account queue, dotted names and all', () => {
    for (const name of ['account.list.query.v1', 'account.operations.query.v1']) {
      const contract = catalog.find((c) => c.name === name)!;

      expect([...queuesFor(contract)]).toEqual(['account.commands']);
    }
  });
});

describe('the retry ladder', () => {
  it('waits one second, then five, then thirty', () => {
    expect(RETRY_DELAYS_MS).toEqual([1_000, 5_000, 30_000]);
  });

  it('allows three retries, so four deliveries at most', () => {
    expect(MAX_RETRIES).toBe(3);
  });

  it('names a retry queue per rung', () => {
    expect(retryQueueName('audit.all', 1)).toBe('audit.all.retry.1s');
    expect(retryQueueName('audit.all', 3)).toBe('audit.all.retry.30s');
  });

  it('refuses a fourth rung rather than inventing one', () => {
    expect(() => retryQueueName('audit.all', 4)).toThrow(/3 rungs/);
  });

  it('returns a failed message to its own queue, never to the exchange', () => {
    const declarations = allQueueDeclarations();
    const retry = declarations.find((d) => d.name === 'audit.all.retry.5s');

    expect(retry?.arguments).toEqual({
      'x-message-ttl': 5_000,
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': 'audit.all',
    });
  });

  it('declares a work queue, three retry queues and a dead-letter queue for each consumer', () => {
    expect(allQueueDeclarations()).toHaveLength(QUEUES.length * 5);
  });

  it('gives every queue a terminal dead-letter queue', () => {
    const names = new Set(allQueueDeclarations().map((d) => d.name));

    for (const queue of QUEUES) {
      expect(names.has(deadLetterQueueName(queue.name))).toBe(true);
    }
  });
});
