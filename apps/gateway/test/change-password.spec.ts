import request from 'supertest';
import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import {
  customerChangePasswordV1,
  customerPasswordChangedV1,
  customerPasswordChangeRejectedV1,
} from '@bank/contracts';

import { CustomersController } from '../src/interfaces/customers.controller';
import { buildHarness } from './support/harness';
import type { Harness } from './support/harness';

const CUSTOMER = '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93';
const CURRENT = 'la-clave-de-ahora';
const NEXT = 'la-clave-siguiente';

describe('POST /api/customers/:customerId/password', () => {
  let harness: Harness;
  let app: INestApplication;

  beforeEach(async () => {
    harness = await buildHarness([CustomersController]);
    app = harness.app;
  });

  afterEach(async () => {
    await app.close();
  });

  function change(body: Record<string, unknown> = {}): request.Test {
    return request(app.getHttpServer())
      .post(`/api/customers/${CUSTOMER}/password`)
      .set(
        'Authorization',
        `Bearer ${harness.tokens.sign({ customerId: CUSTOMER, username: 'maria', role: 'CLIENTE' })}`,
      )
      .send({ currentCredential: CURRENT, newCredential: NEXT, ...body });
  }

  it('publishes the command with the subject and the verified identity', async () => {
    harness.replier.answerWith(customerPasswordChangedV1.name, {
      customerId: CUSTOMER,
      changedAt: '2026-08-30T14:32:08.100Z',
    });

    const response = await change();

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('CHANGED');
    expect(harness.publisher.lastType).toBe(customerChangePasswordV1.name);
    expect(harness.publisher.published[0]!.payload).toEqual({
      customerId: CUSTOMER,
      currentCredential: CURRENT,
      newCredential: NEXT,
    });
    expect(harness.publisher.published[0]!.identity).toEqual({
      customerId: CUSTOMER,
      role: 'CLIENTE',
    });
  });

  it('needs a session', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/customers/${CUSTOMER}/password`)
      .send({ currentCredential: CURRENT, newCredential: NEXT });

    expect(response.status).toBe(401);
    expect(harness.publisher.published).toHaveLength(0);
  });

  /**
   * Unlike the reset, the two refusals stay apart. Nobody reaches this route
   * without a session, so neither answer reveals whether an account exists —
   * and "your current password is wrong" is the useful thing to say.
   */
  it('reports a wrong current password as a conflict the person can fix', async () => {
    harness.replier.answerWith(customerPasswordChangeRejectedV1.name, {
      customerId: CUSTOMER,
      reason: 'INVALID_CREDENTIALS',
      occurredAt: '2026-08-30T14:32:08.100Z',
    });

    const response = await change();

    expect(response.body.type).toBe('BUSINESS_REJECTION');
    expect(response.body.failureCode).toBe('INVALID_CREDENTIALS');
  });

  it('reports an attempt on somebody else as forbidden', async () => {
    harness.replier.answerWith(customerPasswordChangeRejectedV1.name, {
      customerId: CUSTOMER,
      reason: 'FORBIDDEN_ACCOUNT_ACCESS',
      occurredAt: '2026-08-30T14:32:08.100Z',
    });

    const response = await change();

    expect(response.status).toBe(403);
    expect(response.body.failureCode).toBe('FORBIDDEN_ACCOUNT_ACCESS');
  });

  it('reports a timeout rather than a rejection when nobody answers', async () => {
    harness.replier.staySilent();

    const response = await change();

    expect(response.status).toBe(504);
    expect(response.body.type).toBe('REPLY_TIMEOUT');
  });

  describe('validation', () => {
    it('refuses a new password shorter than registration accepts', async () => {
      const response = await change({ newCredential: 'corta' });

      expect(response.status).toBe(400);
      expect(harness.publisher.published).toHaveLength(0);
    });

    /**
     * No minimum on the current one, deliberately. A length rule there would
     * tell the caller what a valid password looks like, and every wrong current
     * password must be answered identically.
     */
    it('accepts any non-empty current password and lets the service judge it', async () => {
      harness.replier.answerWith(customerPasswordChangeRejectedV1.name, {
        customerId: CUSTOMER,
        reason: 'INVALID_CREDENTIALS',
        occurredAt: '2026-08-30T14:32:08.100Z',
      });

      const response = await change({ currentCredential: 'x' });

      expect(response.status).not.toBe(400);
      expect(harness.publisher.published).toHaveLength(1);
    });
  });

  it('keeps neither credential out of a log or a response body', async () => {
    const logged: string[] = [];
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });

    harness.replier.answerWith(customerPasswordChangeRejectedV1.name, {
      customerId: CUSTOMER,
      reason: 'INVALID_CREDENTIALS',
      occurredAt: '2026-08-30T14:32:08.100Z',
    });
    const rejected = await change();

    harness.replier.staySilent();
    const timedOut = await change();

    spy.mockRestore();

    for (const secret of [CURRENT, NEXT]) {
      expect(logged.join('\n')).not.toContain(secret);
      expect(JSON.stringify(rejected.body)).not.toContain(secret);
      expect(JSON.stringify(timedOut.body)).not.toContain(secret);
    }
  });
});
