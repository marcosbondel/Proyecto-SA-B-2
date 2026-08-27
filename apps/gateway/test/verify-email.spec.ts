import request from 'supertest';
import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import {
  createEnvelope,
  customerEmailVerificationRejectedV1,
  customerEmailVerifiedV1,
  customerVerifyEmailV1,
  GATEWAY_REPLY_BINDINGS,
  EXCHANGES,
  matchesTopicPattern,
  queuesFor,
  catalog,
} from '@bank/contracts';
import { ReplyRegistry } from '@bank/messaging';

import { CustomersController } from '../src/interfaces/customers.controller';
import { buildHarness } from './support/harness';
import type { Harness } from './support/harness';

const TOKEN = 'a'.repeat(64);
const CUSTOMER = '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93';
const TRACE = '6f1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b93';

const VERIFIED = {
  customerId: CUSTOMER,
  emailVerifiedAt: '2026-08-19T14:32:08.100Z',
  status: 'ACTIVE' as const,
};

describe('GET /api/customers/verify-email', () => {
  let harness: Harness;
  let app: INestApplication;

  beforeEach(async () => {
    harness = await buildHarness([CustomersController]);
    app = harness.app;
  });

  afterEach(async () => {
    await app.close();
  });

  function open(token = TOKEN): request.Test {
    return request(app.getHttpServer()).get(`/api/customers/verify-email?token=${token}`);
  }

  describe('with a token that works', () => {
    beforeEach(() => {
      harness.replier.answerWith(customerEmailVerifiedV1.name, VERIFIED);
    });

    it('publishes the verification command', async () => {
      await open();

      expect(harness.publisher.lastType).toBe(customerVerifyEmailV1.name);
      expect(harness.publisher.published[0]!.payload).toEqual({ activationToken: TOKEN });
    });

    /**
     * A verdict, not an acknowledgement. Somebody clicked a link in their
     * inbox; "we are processing it, check back later" is not an answer you can
     * show them.
     */
    it('answers with the verdict in the same response', async () => {
      const response = await open();

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ACTIVE');
      expect(response.body.correlationId).toBeDefined();
    });

    it('is public: no token of any kind is needed to open the link', async () => {
      const response = await open();

      expect(response.status).not.toBe(401);
    });

    it('publishes with no identity, since the account is not usable yet', async () => {
      await open();

      expect(harness.publisher.published[0]!.identity).toBeNull();
    });
  });

  /**
   * The event distinguishes expired from invalid — it has to, so the audit
   * record can — but repeating that to whoever opened the link would confirm a
   * token was once issued for that address.
   */
  describe('with a token that does not', () => {
    it.each([
      ['ACTIVATION_TOKEN_INVALID' as const, 'invented or already used'],
      ['ACTIVATION_TOKEN_EXPIRED' as const, 'expired'],
    ])('refuses %s (%s)', async (reason, _description) => {
      harness.replier.answerWith(customerEmailVerificationRejectedV1.name, {
        reason,
        occurredAt: '2026-08-19T14:32:08.100Z',
      });

      const response = await open();

      expect(response.status).toBe(409);
      expect(response.body.type).toBe('BUSINESS_REJECTION');
    });

    it('answers invalid and expired identically', async () => {
      harness.replier.answerWith(customerEmailVerificationRejectedV1.name, {
        reason: 'ACTIVATION_TOKEN_INVALID',
        occurredAt: '2026-08-19T14:32:08.100Z',
      });
      const invalid = await open();

      harness.replier.answerWith(customerEmailVerificationRejectedV1.name, {
        reason: 'ACTIVATION_TOKEN_EXPIRED',
        occurredAt: '2026-08-19T14:32:08.100Z',
      });
      const expired = await open();

      const { correlationId: _a, ...invalidBody } = invalid.body as Record<string, unknown>;
      const { correlationId: _b, ...expiredBody } = expired.body as Record<string, unknown>;

      expect(invalid.status).toBe(expired.status);
      expect(invalidBody).toEqual(expiredBody);
    });
  });

  /**
   * Silence is not a rejection. Reporting `409` here would leave people whose
   * account *did* activate believing it did not, and they would ask for a new
   * link that the old one already made unnecessary.
   */
  describe('when nobody answers in time', () => {
    it('reports a timeout, not a rejection', async () => {
      harness.replier.staySilent();

      const response = await open();

      expect(response.status).toBe(504);
      expect(response.body.type).toBe('REPLY_TIMEOUT');
    });

    it('says the activation was not cancelled', async () => {
      harness.replier.staySilent();

      const response = await open().set('X-Correlation-Id', TRACE);

      expect(response.body.message).toMatch(/NO fue cancelada/);
      expect(response.body.correlationId).toBe(TRACE);
    });
  });

  describe('validation', () => {
    it.each([
      ['absent', ''],
      ['too short', 'abc'],
      ['too long', 'a'.repeat(513)],
    ])('refuses a token that is %s, publishing nothing', async (_case, token) => {
      const response = await request(app.getHttpServer()).get(
        `/api/customers/verify-email?token=${token}`,
      );

      expect(response.status).toBe(400);
      expect(harness.publisher.published).toHaveLength(0);
    });
  });

  describe('the token never reaches a log', () => {
    it('stays out of it on every outcome', async () => {
      const logged: string[] = [];
      const spy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation((...args: unknown[]) => {
          logged.push(args.map(String).join(' '));
        });

      harness.replier.answerWith(customerEmailVerifiedV1.name, VERIFIED);
      await open();

      harness.replier.answerWith(customerEmailVerificationRejectedV1.name, {
        reason: 'ACTIVATION_TOKEN_EXPIRED',
        occurredAt: '2026-08-19T14:32:08.100Z',
      });
      const rejected = await open();

      harness.replier.staySilent();
      const timedOut = await open();

      spy.mockRestore();

      expect(logged.join('\n')).not.toContain(TOKEN);
      expect(JSON.stringify(rejected.body)).not.toContain(TOKEN);
      expect(JSON.stringify(timedOut.body)).not.toContain(TOKEN);
    });
  });
});

/**
 * Overhearing an event to answer a caller must not quietly take it away from
 * anybody, and must not misbehave when more than one replica overhears it.
 */
describe('the two activation events, seen from the gateway', () => {
  const names = [customerEmailVerifiedV1.name, customerEmailVerificationRejectedV1.name];

  it.each(names)('is still routed to audit.customer: %s', (name) => {
    const contract = catalog.find((entry) => entry.name === name)!;

    expect(queuesFor(contract)).toContain('audit.customer');
  });

  it.each(names)('still names notification-audit-service as its consumer: %s', (name) => {
    const contract = catalog.find((entry) => entry.name === name)!;

    expect(contract.consumers).toEqual(['notification-audit-service']);
  });

  it.each(names)('reaches the gateway’s own queue too: %s', (name) => {
    const bound = GATEWAY_REPLY_BINDINGS.filter(
      (binding) => binding.exchange === EXCHANGES.events,
    ).some((binding) => matchesTopicPattern(name, binding.pattern));

    expect(bound).toBe(true);
  });

  /**
   * With two replicas the event reaches **both** exclusive queues. Only the one
   * holding the caller's connection settles it; the other discards it. This is
   * the one place in the feature where a duplicate delivery is the normal case
   * rather than a fault, so it is asserted rather than assumed.
   */
  it('is settled by the replica that asked, and discarded by the one that did not', () => {
    const asked = new ReplyRegistry({ timeoutMs: 50 });
    const idle = new ReplyRegistry({ timeoutMs: 50 });

    const waiting = asked.waitFor(TRACE);

    const event = createEnvelope(VERIFIED, {
      messageType: customerEmailVerifiedV1.name,
      producer: 'customer-service',
      identity: null,
      correlationId: TRACE,
    });

    expect(asked.settle(event)).toBe(true);
    expect(idle.settle(event)).toBe(false);

    return expect(waiting).resolves.toMatchObject({ correlationId: TRACE });
  });
});
