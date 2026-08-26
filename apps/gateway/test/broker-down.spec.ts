import request from 'supertest';
import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';

import { GatewayError } from '../src/application/errors/gateway-error';
import { AccountsController } from '../src/interfaces/accounts.controller';
import { AuthController } from '../src/interfaces/auth.controller';
import { CustomersController } from '../src/interfaces/customers.controller';
import { HealthController } from '../src/interfaces/health.controller';
import { TransfersController } from '../src/interfaces/transfers.controller';
import { buildHarness } from './support/harness';
import type { Harness } from './support/harness';

const ACTOR = '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93';
const TRACE = '6f1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b93';

/**
 * A broker outage is the failure most likely to happen during a demonstration
 * and the one where an unhelpful response costs the most: the caller has no way
 * to tell "nothing happened" from "something happened and we lost track".
 *
 * So the gateway does two things, and both are asserted here: it answers with a
 * status that means *nothing happened*, and it leaves a log line an operator can
 * join to the caller's own correlation identifier.
 */
describe('when the broker is unreachable', () => {
  let harness: Harness;
  let app: INestApplication;
  let auth: string;
  let logged: string[];
  let spy: jest.SpyInstance;

  beforeEach(async () => {
    harness = await buildHarness([
      HealthController,
      AuthController,
      CustomersController,
      AccountsController,
      TransfersController,
    ]);
    app = harness.app;
    auth = `Bearer ${harness.tokens.sign({ customerId: ACTOR, username: 'ana', role: 'CLIENTE' })}`;

    harness.publisher.failWith = GatewayError.brokerUnavailable();

    logged = [];
    spy = jest.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map((value) => String(value)).join(' '));
    });
  });

  afterEach(async () => {
    spy.mockRestore();
    await app.close();
  });

  const routes: readonly [string, () => request.Test][] = [
    ['sign in', () => request(app.getHttpServer()).post('/api/auth/login').send({
      email: 'ana@example.com',
      credential: 'una-contrasena-larga',
    })],
    ['register', () => request(app.getHttpServer()).post('/api/customers').field({
      fullName: 'Ana López',
      identityDocument: '1234567890101',
      email: 'ana@example.com',
      dateOfBirth: '1995-04-12',
      address: 'Zona 1',
      role: 'CLIENTE',
      credential: 'una-contrasena-larga',
    })],
    ['open an account', () => request(app.getHttpServer())
      .post('/api/accounts')
      .set('Authorization', auth)
      .send({ accountType: 'MONETARIA' })],
    ['request a transfer', () => request(app.getHttpServer())
      .post('/api/transfers')
      .set('Authorization', auth)
      .send({
        sourceAccount: '8b7e5d21-9c2e-4a71-b8f5-2d6e7c0a1b93',
        targetAccount: '1d4c9f60-9c2e-4a71-b8f5-2d6e7c0a1b93',
        amount: { amountMinor: 100, currency: 'GTQ' },
      })],
  ];

  it.each(routes)('answers %s with a controlled 503', async (_name, call) => {
    const response = await call();

    expect(response.status).toBe(503);
    expect(response.body.type).toBe('BROKER_UNAVAILABLE');
  });

  it.each(routes)('tells the caller of %s that nothing changed', async (_name, call) => {
    const response = await call();

    expect(response.body.message).toMatch(/No se realizó ningún cambio/);
  });

  /**
   * The log line is what makes criterion 3 verifiable. Without the correlation
   * identifier in it, an operator has a log full of outages and no way to tie
   * any of them to the person who reported one.
   */
  it('leaves a log line carrying the caller’s correlation identifier', async () => {
    await request(app.getHttpServer())
      .post('/api/accounts')
      .set('Authorization', auth)
      .set('X-Correlation-Id', TRACE)
      .send({ accountType: 'MONETARIA' });

    expect(logged.some((line) => line.includes(TRACE))).toBe(true);
    expect(logged.some((line) => line.includes('BROKER_UNAVAILABLE'))).toBe(true);
  });

  it('says nothing about the broker’s address in the response', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/accounts')
      .set('Authorization', auth)
      .send({ accountType: 'MONETARIA' });

    expect(JSON.stringify(response.body)).not.toMatch(/amqp|rabbit|5672/i);
  });

  /**
   * The probes must keep working while the broker is down — they are how an
   * operator finds out that it is.
   */
  it('still answers the liveness probe', async () => {
    harness.brokerUp.value = false;

    const response = await request(app.getHttpServer()).get('/health');

    expect(response.status).toBe(200);
  });

  /**
   * Validation runs before publication, so a malformed request fails the same
   * way whether the broker is up or down. Reporting `503` here would send the
   * caller off to retry a request that will never be accepted.
   */
  it('still reports a malformed request as validation, not as an outage', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/accounts')
      .set('Authorization', auth)
      .send({ accountType: 'PLAZO_FIJO' });

    expect(response.status).toBe(400);
    expect(response.body.type).toBe('VALIDATION_ERROR');
  });
});
