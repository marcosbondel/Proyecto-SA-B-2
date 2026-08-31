import request from 'supertest';
import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import {
  customerPasswordResetCompletedV1,
  customerPasswordResetConfirmV1,
  customerPasswordResetRejectedV1,
  customerPasswordResetRequestedV1,
} from '@bank/contracts';

import { AuthController } from '../src/interfaces/auth.controller';
import { buildHarness } from './support/harness';
import type { Harness } from './support/harness';

const TOKEN = 'b'.repeat(64);
const CUSTOMER = '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93';
const NEW_PASSWORD = 'una-clave-nueva-larga';

describe('POST /api/auth/password-reset', () => {
  let harness: Harness;
  let app: INestApplication;

  beforeEach(async () => {
    harness = await buildHarness([AuthController]);
    app = harness.app;
  });

  afterEach(async () => {
    await app.close();
  });

  function ask(email = 'ana@example.com'): request.Test {
    return request(app.getHttpServer()).post('/api/auth/password-reset').send({ email });
  }

  it('publishes the request and accepts it', async () => {
    const response = await ask();

    expect(response.status).toBe(202);
    expect(harness.publisher.lastType).toBe(customerPasswordResetRequestedV1.name);
    expect(harness.publisher.published[0]!.payload).toEqual({ email: 'ana@example.com' });
  });

  it('is public: the premise is somebody who cannot sign in', async () => {
    const response = await ask();

    expect(response.status).not.toBe(401);
  });

  it('publishes with no identity, because nobody is authenticated', async () => {
    await ask();

    expect(harness.publisher.published[0]!.identity).toBeNull();
  });

  /**
   * The property this route exists to protect. Nothing in the response
   * distinguishes an address that banks here from one that does not — the
   * route never waits for an answer, so there is no answer to differ.
   */
  it('answers identically whatever address is typed', async () => {
    const known = await ask('ana@example.com');
    const unknown = await ask('nadie@example.com');

    const { correlationId: _a, ...knownBody } = known.body as Record<string, unknown>;
    const { correlationId: _b, ...unknownBody } = unknown.body as Record<string, unknown>;

    expect(known.status).toBe(unknown.status);
    expect(knownBody).toEqual(unknownBody);
  });

  it('waits for nothing, so a silent broker is still a 202', async () => {
    harness.replier.staySilent();

    const response = await ask();

    expect(response.status).toBe(202);
  });

  it('refuses something that is not an address, publishing nothing', async () => {
    const response = await ask('no-es-un-correo');

    expect(response.status).toBe(400);
    expect(harness.publisher.published).toHaveLength(0);
  });
});

describe('POST /api/auth/password-reset/confirm', () => {
  let harness: Harness;
  let app: INestApplication;

  beforeEach(async () => {
    harness = await buildHarness([AuthController]);
    app = harness.app;
  });

  afterEach(async () => {
    await app.close();
  });

  function spend(body: Record<string, unknown> = {}): request.Test {
    return request(app.getHttpServer())
      .post('/api/auth/password-reset/confirm')
      .send({ resetToken: TOKEN, credential: NEW_PASSWORD, ...body });
  }

  describe('with a link that works', () => {
    beforeEach(() => {
      harness.replier.answerWith(customerPasswordResetCompletedV1.name, {
        customerId: CUSTOMER,
        changedAt: '2026-08-30T14:32:08.100Z',
      });
    });

    it('publishes the confirmation command', async () => {
      await spend();

      expect(harness.publisher.lastType).toBe(customerPasswordResetConfirmV1.name);
      expect(harness.publisher.published[0]!.payload).toEqual({
        resetToken: TOKEN,
        credential: NEW_PASSWORD,
      });
    });

    /** A verdict in the same response: somebody is watching a spinner. */
    it('answers with the verdict in the same response', async () => {
      const response = await spend();

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('CHANGED');
      expect(response.body.correlationId).toBeDefined();
    });

    it('publishes with no identity, since the link is the credential', async () => {
      await spend();

      expect(harness.publisher.published[0]!.identity).toBeNull();
    });
  });

  describe('with a link that does not', () => {
    it.each([
      ['RESET_TOKEN_INVALID' as const, 'invented or already spent'],
      ['RESET_TOKEN_EXPIRED' as const, 'out of time'],
    ])('refuses %s (%s)', async (reason, _description) => {
      harness.replier.answerWith(customerPasswordResetRejectedV1.name, {
        reason,
        occurredAt: '2026-08-30T14:32:08.100Z',
      });

      const response = await spend();

      expect(response.status).toBe(409);
      expect(response.body.type).toBe('BUSINESS_REJECTION');
    });

    /**
     * Saying which it was would confirm that a link was once issued for that
     * address, which is the enumeration the whole flow avoids.
     */
    it('answers invalid and expired identically', async () => {
      harness.replier.answerWith(customerPasswordResetRejectedV1.name, {
        reason: 'RESET_TOKEN_INVALID',
        occurredAt: '2026-08-30T14:32:08.100Z',
      });
      const invalid = await spend();

      harness.replier.answerWith(customerPasswordResetRejectedV1.name, {
        reason: 'RESET_TOKEN_EXPIRED',
        occurredAt: '2026-08-30T14:32:08.100Z',
      });
      const expired = await spend();

      const { correlationId: _a, ...invalidBody } = invalid.body as Record<string, unknown>;
      const { correlationId: _b, ...expiredBody } = expired.body as Record<string, unknown>;

      expect(invalid.status).toBe(expired.status);
      expect(invalidBody).toEqual(expiredBody);
    });
  });

  /**
   * Silence is not a rejection: the password may well have been changed. Saying
   * `409` would send somebody back to ask for another link they do not need.
   */
  it('reports a timeout when nobody answers, not a rejection', async () => {
    harness.replier.staySilent();

    const response = await spend();

    expect(response.status).toBe(504);
    expect(response.body.type).toBe('REPLY_TIMEOUT');
  });

  describe('validation', () => {
    it.each([
      ['a token that is too short', { resetToken: 'abc' }],
      ['a token that is too long', { resetToken: 'b'.repeat(513) }],
      ['a password shorter than registration accepts', { credential: 'corta' }],
    ])('refuses %s, publishing nothing', async (_case, body) => {
      const response = await spend(body);

      expect(response.status).toBe(400);
      expect(harness.publisher.published).toHaveLength(0);
    });
  });

  describe('neither secret reaches a log', () => {
    it('stays out of it on every outcome', async () => {
      const logged: string[] = [];
      const spy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation((...args: unknown[]) => {
          logged.push(args.map(String).join(' '));
        });

      harness.replier.answerWith(customerPasswordResetCompletedV1.name, {
        customerId: CUSTOMER,
        changedAt: '2026-08-30T14:32:08.100Z',
      });
      const changed = await spend();

      harness.replier.answerWith(customerPasswordResetRejectedV1.name, {
        reason: 'RESET_TOKEN_EXPIRED',
        occurredAt: '2026-08-30T14:32:08.100Z',
      });
      const rejected = await spend();

      harness.replier.staySilent();
      const timedOut = await spend();

      spy.mockRestore();

      for (const secret of [TOKEN, NEW_PASSWORD]) {
        expect(logged.join('\n')).not.toContain(secret);
        expect(JSON.stringify(changed.body)).not.toContain(secret);
        expect(JSON.stringify(rejected.body)).not.toContain(secret);
        expect(JSON.stringify(timedOut.body)).not.toContain(secret);
      }
    });
  });
});
