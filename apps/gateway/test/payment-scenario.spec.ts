import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { transferRequestedV1 } from '@bank/contracts';

import { TransfersController } from '../src/interfaces/transfers.controller';
import { buildHarness } from './support/harness';
import type { Harness } from './support/harness';

const ACTOR = '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93';

const TRANSFER = {
  sourceAccount: '8b7e5d21-9c2e-4a71-b8f5-2d6e7c0a1b93',
  targetAccount: '1d4c9f60-9c2e-4a71-b8f5-2d6e7c0a1b93',
  amount: { amountMinor: 125_000, currency: 'GTQ' },
};

/**
 * The demonstration scenario is the one field in the system the gateway is
 * explicitly forbidden from acting on. These tests are as much about what does
 * **not** happen as about what does.
 */
describe('paymentScenario', () => {
  let harness: Harness;
  let app: INestApplication;
  let auth: string;

  beforeEach(async () => {
    harness = await buildHarness([TransfersController]);
    app = harness.app;
    auth = `Bearer ${harness.tokens.sign({ customerId: ACTOR, username: 'ana', role: 'CLIENTE' })}`;
  });

  afterEach(async () => {
    await app.close();
  });

  function transfer(body: object): request.Test {
    return request(app.getHttpServer())
      .post('/api/transfers')
      .set('Authorization', auth)
      .send(body);
  }

  it.each(['APPROVE', 'REJECT', 'TRANSIENT_FAILURE', 'TIMEOUT'])(
    'carries %s to the broker untouched',
    async (scenario) => {
      const response = await transfer({ ...TRANSFER, paymentScenario: scenario });

      expect(response.status).toBe(202);
      expect(
        (harness.publisher.published[0]!.payload as { paymentScenario: string }).paymentScenario,
      ).toBe(scenario);
    },
  );

  /**
   * The gateway must behave identically whatever the value says. If `REJECT`
   * made it answer differently, it would be deciding the outcome of the Saga at
   * the entry point.
   */
  it('changes nothing about the gateway’s own behaviour', async () => {
    const approve = await transfer({ ...TRANSFER, paymentScenario: 'APPROVE' });
    const reject = await transfer({ ...TRANSFER, paymentScenario: 'REJECT' });

    expect(approve.status).toBe(reject.status);
    expect(Object.keys(approve.body).sort()).toEqual(Object.keys(reject.body).sort());
    expect(harness.publisher.published).toHaveLength(2);
  });

  it('refuses a value outside the four, and publishes nothing', async () => {
    const response = await transfer({ ...TRANSFER, paymentScenario: 'MAYBE' });

    expect(response.status).toBe(400);
    expect(response.body.field).toBe('paymentScenario');
    expect(harness.publisher.published).toHaveLength(0);
  });

  describe('when it is absent', () => {
    it('is the normal path, and the message omits the field entirely', async () => {
      const response = await transfer(TRANSFER);

      expect(response.status).toBe(202);
      expect(harness.publisher.published[0]!.payload).not.toHaveProperty('paymentScenario');
    });

    it('still satisfies the amended contract', async () => {
      await transfer(TRANSFER);

      expect(
        transferRequestedV1.schema.safeParse(harness.publisher.published[0]!.payload).success,
      ).toBe(true);
    });
  });
});
