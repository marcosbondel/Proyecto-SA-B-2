import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { customerAuthenticateRepliedV1, customerAuthenticateV1 } from '@bank/contracts';

import { AuthController } from '../src/interfaces/auth.controller';
import { SessionTokenService } from '../src/infrastructure/auth/jwt.service';
import { buildHarness, TEST_SECRET } from './support/harness';
import type { Harness } from './support/harness';

const CREDENTIALS = { email: 'ana@example.com', credential: 'una-contrasena-larga' };

const APPROVED = {
  outcome: 'APPROVED' as const,
  claims: {
    customerId: '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93',
    username: 'ana.lopez',
    role: 'CLIENTE' as const,
  },
  activationPending: false,
};

describe('POST /api/auth/login', () => {
  let harness: Harness;
  let app: INestApplication;

  beforeEach(async () => {
    harness = await buildHarness([AuthController]);
    app = harness.app;
  });

  afterEach(async () => {
    await app.close();
  });

  function reply(payload: unknown): void {
    harness.replier.answerWith(customerAuthenticateRepliedV1.name, payload);
  }

  describe('when the credential is good and the account is active', () => {
    beforeEach(() => {
      reply(APPROVED);
    });

    it('asks Customer Service rather than deciding anything itself', async () => {
      await request(app.getHttpServer()).post('/api/auth/login').send(CREDENTIALS);

      expect(harness.publisher.published).toHaveLength(1);
      expect(harness.publisher.lastType).toBe(customerAuthenticateV1.name);
      expect(harness.publisher.published[0]!.payload).toEqual(CREDENTIALS);
    });

    it('returns a token carrying the three claims and an hour of life', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send(CREDENTIALS);

      expect(response.status).toBe(200);
      expect(response.body.expiresIn).toBe(3600);

      const verifier = new SessionTokenService({
        secret: TEST_SECRET,
        expiresInSeconds: 3600,
      });
      const identity = verifier.verify(response.body.token as string);

      expect(identity).toEqual({
        customerId: APPROVED.claims.customerId,
        username: APPROVED.claims.username,
        role: 'CLIENTE',
      });
    });

    it('publishes with no identity, because nobody is authenticated yet', async () => {
      await request(app.getHttpServer()).post('/api/auth/login').send(CREDENTIALS);

      expect(harness.publisher.published[0]!.identity).toBeNull();
    });

    it('returns the correlation identifier the caller can trace with', async () => {
      const mine = '8b7e5d21-9c2e-4a71-b8f5-2d6e7c0a1b93';

      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('X-Correlation-Id', mine)
        .send(CREDENTIALS);

      expect(response.body.correlationId).toBe(mine);
      expect(harness.publisher.published[0]!.correlationId).toBe(mine);
    });
  });

  /**
   * The three rejections must be one rejection.
   *
   * Customer Service already collapses "wrong password" and "no such address"
   * into `INVALID_CREDENTIALS`, so the route cannot be used to enumerate
   * accounts. The third case — a correct password on an unactivated account —
   * is collapsed here, and that is the part a test has to hold in place,
   * because the reply genuinely does distinguish it.
   */
  describe('when it fails', () => {
    const REJECTED = { outcome: 'REJECTED' as const, reason: 'INVALID_CREDENTIALS' as const };
    const PENDING = { ...APPROVED, activationPending: true };

    async function attempt(payload: unknown): Promise<request.Response> {
      reply(payload);
      return await request(app.getHttpServer()).post('/api/auth/login').send(CREDENTIALS);
    }

    it('answers a wrong credential and an unactivated account identically', async () => {
      const wrong = await attempt(REJECTED);
      const unactivated = await attempt(PENDING);

      expect(wrong.status).toBe(401);
      expect(unactivated.status).toBe(401);

      // Correlation differs per request by design; everything else must match.
      const { correlationId: _a, ...wrongBody } = wrong.body as Record<string, unknown>;
      const { correlationId: _b, ...unactivatedBody } = unactivated.body as Record<string, unknown>;

      expect(wrongBody).toEqual(unactivatedBody);
    });

    it('sets no header on one that it does not set on the other', async () => {
      const wrong = await attempt(REJECTED);
      const unactivated = await attempt(PENDING);

      expect(Object.keys(wrong.headers).sort()).toEqual(
        Object.keys(unactivated.headers).sort(),
      );
    });

    it('never issues a token for an account that has not verified its email', async () => {
      const response = await attempt(PENDING);

      expect(response.body).not.toHaveProperty('token');
    });

    it('reports the rejection as an authentication failure, not a business one', async () => {
      const response = await attempt(REJECTED);

      expect(response.body.type).toBe('UNAUTHENTICATED');
      expect(response.body).not.toHaveProperty('failureCode');
    });
  });

  describe('validation', () => {
    it('refuses a malformed address without asking anyone', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'not-an-address', credential: 'whatever' });

      expect(response.status).toBe(400);
      expect(response.body.type).toBe('VALIDATION_ERROR');
      expect(response.body.field).toBe('email');
      expect(harness.publisher.published).toHaveLength(0);
    });

    it('refuses a request carrying fields nobody declared', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ ...CREDENTIALS, role: 'ADMINISTRADOR' });

      expect(response.status).toBe(400);
      expect(harness.publisher.published).toHaveLength(0);
    });
  });

  describe('when nobody answers', () => {
    it('reports a timeout and says the operation was not cancelled', async () => {
      harness.replier.staySilent();

      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send(CREDENTIALS);

      expect(response.status).toBe(504);
      expect(response.body.type).toBe('REPLY_TIMEOUT');
      expect(response.body.message).toMatch(/NO fue cancelada/);
    });
  });

  describe('when Customer Service answers something undefined', () => {
    it('refuses to mint a session from a reply it cannot parse', async () => {
      reply({ outcome: 'MAYBE' });

      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send(CREDENTIALS);

      expect(response.status).toBe(500);
      expect(response.body.type).toBe('INTERNAL_ERROR');
      expect(response.body).not.toHaveProperty('token');
    });
  });
});
