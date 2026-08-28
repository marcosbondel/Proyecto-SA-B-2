import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { catalog, catalogByName } from '../../src/events';
import { messageTypeName, versionOf } from '../../src/schemas/primitives';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const DOMAIN_CATALOGUE = join(REPO_ROOT, 'docs', 'domain', 'message-catalog.md');

/**
 * The names T-02 fixed, read out of the document that fixed them.
 *
 * Reading the markdown rather than hard-coding a list is the point: if somebody
 * renames a message in the domain catalogue without contracting it, this test
 * fails instead of the two documents drifting apart in silence.
 */
function namesFromDomainCatalogue(): string[] {
  const markdown = readFileSync(DOMAIN_CATALOGUE, 'utf8');
  const names = new Set<string>();

  for (const line of markdown.split('\n')) {
    // Only the first cell of a table row names a message.
    const match = /^\|\s*`([a-z][a-z0-9.-]*)`/.exec(line);
    if (match?.[1] !== undefined && match[1].includes('.')) {
      names.add(match[1]);
    }
  }

  return [...names].sort();
}

describe('the catalogue as a whole', () => {
  it('contracts every message, and exactly the number the spec fixed', () => {
    expect(catalog).toHaveLength(57);
  });

  it('gives every message a version suffix, so it can be routed by version', () => {
    for (const contract of catalog) {
      expect(messageTypeName.safeParse(contract.name).success).toBe(true);
      expect(versionOf(contract.name)).toBe(1);
    }
  });

  it('has no duplicate names, which would let one contract shadow another', () => {
    expect(catalogByName.size).toBe(catalog.length);
  });

  it('gives every command exactly one handler', () => {
    for (const contract of catalog.filter((c) => c.category === 'command')) {
      expect(contract.consumers).toHaveLength(1);
    }
  });

  it('leaves no event without a consumer', () => {
    for (const contract of catalog.filter((c) => c.category === 'event')) {
      expect(contract.consumers.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('addresses every reply to exactly one asker', () => {
    for (const contract of catalog.filter((c) => c.category === 'reply')) {
      expect(contract.consumers).toHaveLength(1);
    }
  });
});

describe('coherence with the domain catalogue that T-02 closed', () => {
  const domainNames = namesFromDomainCatalogue();

  it('reads the 35 messages T-02 fixed', () => {
    expect(domainNames).toHaveLength(35);
  });

  it('contracts every one of them, with a version suffix', () => {
    const missing = domainNames.filter((name) => !catalogByName.has(`${name}.v1`));

    expect(missing).toEqual([]);
  });

  it('adds exactly the twenty messages recorded as an extension, and no others', () => {
    const known = new Set(domainNames.map((name) => `${name}.v1`));
    const added = catalog.map((c) => c.name).filter((name) => !known.has(name));

    expect(added.sort()).toEqual([
      'account.balance.replied.v1',
      // The five added by T-17. Three of them exist because the assignment's
      // screens need data the catalogue could not carry: a list of accounts,
      // the movements of one, and the refusal of an opening that until now
      // produced silence.
      'account.list.query.v1',
      'account.list.replied.v1',
      'account.open.rejected.v1',
      'account.operations.query.v1',
      'account.operations.replied.v1',
      'audit.query.replied.v1',
      'audit.query.requested.v1',
      'customer.authenticate.replied.v1',
      'customer.email.verification.rejected.v1',
      // Added by the audit remediation (US6): Customer Service's first read
      // path, so a staff member can see a customer before editing it and the
      // update form is not filled in blind.
      'customer.get.query.v1',
      'customer.get.replied.v1',
      // Added by T-16: the refusal that had no message, so a duplicated
      // document produced silence rather than a rejection.
      'customer.register.rejected.v1',
      /*
       * The two added by T-20. Nothing could ask this service for the
       * notifications it had sent: `audit.query.requested.v1` answers one
       * correlation, and the notifications console is the operational list
       * across all of them. Restricted to `ADMINISTRADOR` at the Gateway
       * because a notification row carries a simulated recipient.
       */
      'notification.list.query.v1',
      'notification.list.replied.v1',
      /*
       * The five added by T-19. `payment.attempt.failed.v1` exists because the
       * catalogue described a payment as a thing that succeeds or fails once,
       * at the end, so the retry ladder that is the whole point of the
       * resilience policy was observable only in Payment Service's own logs.
       * The four query messages exist because no route could ask this service
       * anything at all: a payment could be ordered and could answer the Saga,
       * but nobody outside could look one up.
       */
      'payment.attempt.failed.v1',
      'payment.list.query.v1',
      'payment.list.replied.v1',
      'payment.status.query.v1',
      'payment.status.replied.v1',
      'transaction.status.replied.v1',
      'transaction.status.requested.v1',
    ]);
  });
});
