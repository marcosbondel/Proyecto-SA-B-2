import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Role } from '@bank/contracts';
import {
  paymentSimulationQueryV1,
  paymentSimulationRepliedV1,
  paymentSimulationUpdateV1,
} from '@bank/contracts';

import { PaymentsController } from '../src/interfaces/payments.controller';
import { buildHarness } from './support/harness';
import type { Harness } from './support/harness';

const CUSTOMER_ID = '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93';

const IN_FORCE = {
  failureRatePercent: 30,
  timeoutRatePercent: 10,
  latencyMs: 250,
  source: 'RUNTIME' as const,
  updatedAt: '2026-10-05T12:00:00.000Z',
};

const BODY = { failureRatePercent: 30, timeoutRatePercent: 10, latencyMs: 250 };

/**
 * T-44's Gateway half: the administrator's endpoint for changing how the
 * simulated provider misbehaves.
 *
 * Three things are asserted and none of them is "it returns 200". That a
 * refused caller **published nothing** — a refusal that still put the command
 * on the broker would let a customer change a service they may not even read.
 * That the command which does leave is exactly what the contract describes,
 * with the actor's identity in the envelope. And that the Gateway reaches
 * Payment Service only through the broker, which `no-database-no-http.spec.ts`
 * proves for the whole application and the harness here makes visible: the only
 * thing that can answer is a reply on the replier.
 */
describe('the payment simulation routes', () => {
  let harness: Harness;
  let app: INestApplication;

  beforeEach(async () => {
    harness = await buildHarness([PaymentsController]);
    app = harness.app;
  });

  afterEach(async () => {
    await app.close();
  });

  const tokenFor = (role: Role): string =>
    harness.tokens.sign({ customerId: CUSTOMER_ID, username: 'admin', role });

  const put = (role: Role | null, body: unknown) => {
    const call = request(app.getHttpServer()).put('/api/payments/simulation');

    return (role === null ? call : call.set('Authorization', `Bearer ${tokenFor(role)}`)).send(
      body as object,
    );
  };

  describe('who may reach them', () => {
    it.each<Role>(['CLIENTE', 'CAJERO_RECEPTOR'])(
      'refuses %s on both routes without asking the broker anything',
      async (role) => {
        const read = await request(app.getHttpServer())
          .get('/api/payments/simulation')
          .set('Authorization', `Bearer ${tokenFor(role)}`);
        const write = await put(role, BODY);

        expect(read.status).toBe(403);
        expect(write.status).toBe(403);
        expect(write.body.type).toBe('FORBIDDEN');
        expect(harness.publisher.published).toHaveLength(0);
      },
    );

    it('refuses an anonymous caller with 401 and publishes nothing', async () => {
      const read = await request(app.getHttpServer()).get('/api/payments/simulation');
      const write = await put(null, BODY);

      expect(read.status).toBe(401);
      expect(write.status).toBe(401);
      expect(harness.publisher.published).toHaveLength(0);
    });

    it('admits ADMINISTRADOR', async () => {
      harness.replier.answerWith(paymentSimulationRepliedV1.name, IN_FORCE);

      const response = await put('ADMINISTRADOR', BODY);

      expect(response.status).toBe(200);
    });
  });

  describe('reading the simulation', () => {
    it('asks Payment Service over the broker and returns what is in force', async () => {
      harness.replier.answerWith(paymentSimulationRepliedV1.name, IN_FORCE);

      const response = await request(app.getHttpServer())
        .get('/api/payments/simulation')
        .set('Authorization', `Bearer ${tokenFor('ADMINISTRADOR')}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject(IN_FORCE);
      expect(response.body.correlationId).toEqual(expect.any(String));
      expect(harness.publisher.lastType).toBe(paymentSimulationQueryV1.name);
      expect(harness.publisher.published[0]?.payload).toEqual({});
    });

    it('is not mistaken for a payment id, which would be a 400', async () => {
      harness.replier.answerWith(paymentSimulationRepliedV1.name, IN_FORCE);

      const response = await request(app.getHttpServer())
        .get('/api/payments/simulation')
        .set('Authorization', `Bearer ${tokenFor('ADMINISTRADOR')}`);

      expect(response.status).not.toBe(400);
    });

    it('answers 504 when nobody replies, and says nothing was changed', async () => {
      harness.replier.staySilent();

      const response = await request(app.getHttpServer())
        .get('/api/payments/simulation')
        .set('Authorization', `Bearer ${tokenFor('ADMINISTRADOR')}`);

      expect(response.status).toBe(504);
      expect(response.body.message).toMatch(/no se modificó ningún dato/);
    });
  });

  describe('changing the simulation', () => {
    it('publishes exactly the command the contract describes, under the administrator’s identity', async () => {
      harness.replier.answerWith(paymentSimulationRepliedV1.name, IN_FORCE);

      await put('ADMINISTRADOR', BODY);

      const [published] = harness.publisher.published;

      expect(harness.publisher.published).toHaveLength(1);
      expect(published?.messageType).toBe(paymentSimulationUpdateV1.name);
      expect(published?.payload).toEqual(BODY);
      expect(paymentSimulationUpdateV1.schema.safeParse(published?.payload).success).toBe(true);
      expect(published?.identity).toMatchObject({ customerId: CUSTOMER_ID, role: 'ADMINISTRADOR' });
    });

    it('answers with the simulation now in force, which is its confirmation', async () => {
      harness.replier.answerWith(paymentSimulationRepliedV1.name, IN_FORCE);

      const response = await put('ADMINISTRADOR', BODY);

      expect(response.body).toMatchObject(IN_FORCE);
    });

    it('publishes a reset as a reset and nothing else', async () => {
      harness.replier.answerWith(paymentSimulationRepliedV1.name, {
        ...IN_FORCE,
        failureRatePercent: 0,
        timeoutRatePercent: 0,
        latencyMs: 0,
        source: 'DEFAULTS',
        updatedAt: null,
      });

      const response = await put('ADMINISTRADOR', { reset: true });

      expect(response.status).toBe(200);
      expect(response.body.source).toBe('DEFAULTS');
      expect(harness.publisher.published[0]?.payload).toEqual({ reset: true });
    });

    it('accepts the extremes: no failures at all, and every attempt failing', async () => {
      harness.replier.answerWith(paymentSimulationRepliedV1.name, IN_FORCE);

      for (const body of [
        { failureRatePercent: 0, timeoutRatePercent: 0, latencyMs: 0 },
        { failureRatePercent: 100, timeoutRatePercent: 0, latencyMs: 30_000 },
        { failureRatePercent: 60, timeoutRatePercent: 40, latencyMs: 0 },
      ]) {
        expect((await put('ADMINISTRADOR', body)).status).toBe(200);
      }
    });

    it('answers 504 with the command wording, because the change may have landed', async () => {
      harness.replier.staySilent();

      const response = await put('ADMINISTRADOR', BODY);

      expect(response.status).toBe(504);
      expect(response.body.type).toBe('REPLY_TIMEOUT');
      expect(response.body.message).toMatch(/NO fue cancelada/);
    });

    it('refuses to forward a reply that does not match the contract', async () => {
      harness.replier.answerWith(paymentSimulationRepliedV1.name, { ...IN_FORCE, source: 'MANUAL' });

      expect((await put('ADMINISTRADOR', BODY)).status).toBe(500);
    });
  });

  describe('what it refuses before anything is published', () => {
    const refused: readonly (readonly [string, unknown, string])[] = [
      ['a failure rate over 100', { ...BODY, failureRatePercent: 101 }, 'failureRatePercent'],
      ['a negative failure rate', { ...BODY, failureRatePercent: -5 }, 'failureRatePercent'],
      ['a timeout rate over 100', { ...BODY, timeoutRatePercent: 150 }, 'timeoutRatePercent'],
      ['a negative latency', { ...BODY, latencyMs: -1 }, 'latencyMs'],
      ['a latency past thirty seconds', { ...BODY, latencyMs: 30_001 }, 'latencyMs'],
      ['a fractional latency', { ...BODY, latencyMs: 10.5 }, 'latencyMs'],
      ['a rate as text', { ...BODY, failureRatePercent: '30' }, 'failureRatePercent'],
      [
        'rates that add up to more than every attempt',
        { ...BODY, failureRatePercent: 70, timeoutRatePercent: 40 },
        'timeoutRatePercent',
      ],
      ['a missing failure rate', { timeoutRatePercent: 10, latencyMs: 250 }, 'failureRatePercent'],
      ['a missing timeout rate', { failureRatePercent: 10, latencyMs: 250 }, 'timeoutRatePercent'],
      ['a missing latency', { failureRatePercent: 10, timeoutRatePercent: 10 }, 'latencyMs'],
      ['an empty body', {}, 'failureRatePercent'],
      ['a reset mixed with parameters', { ...BODY, reset: true }, 'reset'],
      ['a reset that is false', { reset: false }, 'reset'],
      ['a reset that is not a boolean', { reset: 'yes' }, 'reset'],
      ['a field nobody defined', { ...BODY, jitterMs: 5 }, 'jitterMs'],
    ];

    it.each(refused)('%s', async (_label, body, field) => {
      const response = await put('ADMINISTRADOR', body);

      expect(response.status).toBe(400);
      expect(response.body.type).toBe('VALIDATION_ERROR');
      expect(response.body.field).toBe(field);
      expect(harness.publisher.published).toHaveLength(0);
    });
  });
});
