import request from 'supertest';
import type { INestApplication } from '@nestjs/common';

import { AccountsController } from '../src/interfaces/accounts.controller';
import { CustomersController } from '../src/interfaces/customers.controller';
import { TransfersController } from '../src/interfaces/transfers.controller';
import { buildHarness } from './support/harness';
import type { Harness } from './support/harness';

const ACTOR = '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93';
const SOURCE = '8b7e5d21-9c2e-4a71-b8f5-2d6e7c0a1b93';
const TARGET = '1d4c9f60-9c2e-4a71-b8f5-2d6e7c0a1b93';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const TRANSFER = {
  sourceAccount: SOURCE,
  targetAccount: TARGET,
  amount: { amountMinor: 125_000, currency: 'GTQ' },
};

describe('correlation and idempotency', () => {
  let harness: Harness;
  let app: INestApplication;
  let auth: string;

  beforeEach(async () => {
    harness = await buildHarness([CustomersController, AccountsController, TransfersController]);
    app = harness.app;
    auth = `Bearer ${harness.tokens.sign({ customerId: ACTOR, username: 'ana', role: 'CLIENTE' })}`;
  });

  afterEach(async () => {
    await app.close();
  });

  function transfer(): request.Test {
    return request(app.getHttpServer())
      .post('/api/transfers')
      .set('Authorization', auth)
      .send(TRANSFER);
  }

  describe('the correlation identifier', () => {
    it('is generated when the caller brings none, and returned', async () => {
      const response = await transfer();

      expect(response.body.correlationId).toMatch(UUID_V4);
      expect(harness.publisher.published[0]!.correlationId).toBe(response.body.correlationId);
    });

    /**
     * Keeping the caller's is what lets a client retrying a failed operation
     * read one coherent story out of the audit record afterwards, instead of
     * three unrelated ones.
     */
    it("is kept when the caller brings their own", async () => {
      const mine = '6f1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b93';

      const response = await transfer().set('X-Correlation-Id', mine);

      expect(response.body.correlationId).toBe(mine);
      expect(harness.publisher.published[0]!.correlationId).toBe(mine);
      expect(response.headers['x-correlation-id']).toBe(mine);
    });

    it('is different for two requests that brought none', async () => {
      await transfer();
      await transfer();

      const [first, second] = harness.publisher.published;

      expect(first!.correlationId).not.toBe(second!.correlationId);
    });
  });

  describe('the idempotency key', () => {
    /**
     * Both requests are published. Recognising that they mean the same thing
     * needs to know what the payload *means*, and that is the receiving
     * service's job (constitution V). A gateway that deduplicated here would be
     * making a business decision with no data to make it from.
     */
    it('travels on both of two identical requests, unchanged', async () => {
      const key = 'retry-of-ana-transfer-001';

      await transfer().set('Idempotency-Key', key);
      await transfer().set('Idempotency-Key', key);

      expect(harness.publisher.published).toHaveLength(2);
      expect(harness.publisher.published[0]!.idempotencyKey).toBe(key);
      expect(harness.publisher.published[1]!.idempotencyKey).toBe(key);
    });

    it('is not reinterpreted, even when it is not a UUID', async () => {
      await transfer().set('Idempotency-Key', 'un texto cualquiera del cliente');

      expect(harness.publisher.published[0]!.idempotencyKey).toBe(
        'un texto cualquiera del cliente',
      );
    });

    it('is minted when the caller brings none', async () => {
      await transfer();

      expect(harness.publisher.published[0]!.idempotencyKey).toMatch(UUID_V4);
    });

    /**
     * Bounded so a header cannot become a payload of its own. Over the bound
     * the request still succeeds with a generated key — the alternative would
     * be failing a legitimate banking request over a malformed hint.
     */
    it('is replaced rather than rejected when it is absurdly long', async () => {
      const response = await transfer().set('Idempotency-Key', 'x'.repeat(500));

      expect(response.status).toBe(202);
      expect(harness.publisher.published[0]!.idempotencyKey).toMatch(UUID_V4);
    });
  });

  describe('the two identifiers are not the same thing', () => {
    it('carries a distinct correlation and idempotency key on one request', async () => {
      const correlation = '6f1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b93';

      await transfer().set('X-Correlation-Id', correlation).set('Idempotency-Key', 'intent-1');

      const envelope = harness.publisher.published[0]!;

      // One says "this is the same conversation"; the other says "this is the
      // same intention". A retry keeps the second and may change the first.
      expect(envelope.correlationId).toBe(correlation);
      expect(envelope.idempotencyKey).toBe('intent-1');
    });
  });
});
