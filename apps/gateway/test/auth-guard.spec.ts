import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { buildHarness, TEST_SECRET } from './support/harness';
import type { Harness } from './support/harness';
import { ProtectedRoutesFixture } from './support/protected-routes.fixture';

const CUSTOMER_ID = '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93';

describe('the authentication boundary', () => {
  let harness: Harness;
  let app: INestApplication;

  beforeEach(async () => {
    harness = await buildHarness([ProtectedRoutesFixture]);
    app = harness.app;
  });

  afterEach(async () => {
    await app.close();
  });

  function validToken(role = 'CLIENTE'): string {
    return harness.tokens.sign({ customerId: CUSTOMER_ID, username: 'ana.lopez', role: role as never });
  }

  describe('a request without a usable token', () => {
    /**
     * Every one of these is `401`, and every one publishes nothing. The second
     * half is the part worth asserting: a gateway that rejected the caller but
     * had already put the message on the broker would be worse than one that
     * let the request through, because the rejection would be a lie.
     */
    it.each([
      ['no Authorization header at all', undefined],
      ['a header that is not Bearer', 'Basic YWRtaW46YWRtaW4='],
      ['Bearer with nothing after it', 'Bearer '],
      ['a token that is not a JWT', 'Bearer not-a-token'],
    ])('is refused when it sends %s', async (_case, header) => {
      const call = request(app.getHttpServer()).get('/fixture/any-role');
      if (header !== undefined) {
        void call.set('Authorization', header);
      }

      const response = await call;

      expect(response.status).toBe(401);
      expect(response.body.type).toBe('UNAUTHENTICATED');
      expect(harness.publisher.published).toHaveLength(0);
    });

    it('is refused when the signature was made with another secret', async () => {
      const forged = new JwtService({ secret: 'a-different-secret-also-32-chars!!' }).sign({
        sub: CUSTOMER_ID,
        username: 'ana.lopez',
        role: 'ADMINISTRADOR',
      });

      const response = await request(app.getHttpServer())
        .get('/fixture/any-role')
        .set('Authorization', `Bearer ${forged}`);

      expect(response.status).toBe(401);
      expect(harness.publisher.published).toHaveLength(0);
    });

    it('is refused when the token expired a second ago', async () => {
      const expired = new JwtService({ secret: TEST_SECRET }).sign(
        { sub: CUSTOMER_ID, username: 'ana.lopez', role: 'CLIENTE' },
        { expiresIn: '-1s' },
      );

      const response = await request(app.getHttpServer())
        .get('/fixture/any-role')
        .set('Authorization', `Bearer ${expired}`);

      expect(response.status).toBe(401);
    });

    /**
     * A well-signed token carrying a role this system does not define means the
     * signing secret is shared with something that should not have it.
     */
    it('is refused when a valid signature carries an undefined role', async () => {
      const odd = new JwtService({ secret: TEST_SECRET }).sign({
        sub: CUSTOMER_ID,
        username: 'ana.lopez',
        role: 'SUPERUSUARIO',
      });

      const response = await request(app.getHttpServer())
        .get('/fixture/any-role')
        .set('Authorization', `Bearer ${odd}`);

      expect(response.status).toBe(401);
    });

    it('says nothing about which half of the guess was wrong', async () => {
      const forged = new JwtService({ secret: 'a-different-secret-also-32-chars!!' }).sign({
        sub: CUSTOMER_ID,
        username: 'ana.lopez',
        role: 'CLIENTE',
      });
      const expired = new JwtService({ secret: TEST_SECRET }).sign(
        { sub: CUSTOMER_ID, username: 'ana.lopez', role: 'CLIENTE' },
        { expiresIn: '-1s' },
      );

      const [a, b] = await Promise.all([
        request(app.getHttpServer()).get('/fixture/any-role').set('Authorization', `Bearer ${forged}`),
        request(app.getHttpServer()).get('/fixture/any-role').set('Authorization', `Bearer ${expired}`),
      ]);

      expect(a.body.message).toBe(b.body.message);
    });
  });

  describe('a request with a valid token', () => {
    it('reaches the route, carrying the role from the token', async () => {
      const response = await request(app.getHttpServer())
        .get('/fixture/any-role')
        .set('Authorization', `Bearer ${validToken('CAJERO_RECEPTOR')}`);

      expect(response.status).toBe(200);
      expect(response.body.role).toBe('CAJERO_RECEPTOR');
    });
  });

  describe('public routes', () => {
    it('are reachable with no token, which is what makes sign-in possible', async () => {
      const response = await request(app.getHttpServer()).get('/fixture/open');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ reached: true });
    });

    /**
     * Protection is declared, never inferred. Forgetting to mark a public route
     * breaks it loudly the first time anyone tries; forgetting to protect a
     * private one breaks nothing visible and everything that matters.
     */
    it('do not accidentally make protected ones public', async () => {
      const response = await request(app.getHttpServer()).get('/fixture/any-role');

      expect(response.status).toBe(401);
    });
  });
});
