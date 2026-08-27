import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Role } from '@bank/contracts';

import { buildHarness } from './support/harness';
import type { Harness } from './support/harness';
import { ProtectedRoutesFixture } from './support/protected-routes.fixture';

const CUSTOMER_ID = '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93';

describe('the authorization boundary', () => {
  let harness: Harness;
  let app: INestApplication;

  beforeEach(async () => {
    harness = await buildHarness([ProtectedRoutesFixture]);
    app = harness.app;
  });

  afterEach(async () => {
    await app.close();
  });

  function tokenFor(role: Role): string {
    return harness.tokens.sign({ customerId: CUSTOMER_ID, username: 'ana.lopez', role });
  }

  describe('a route restricted to one role', () => {
    it('admits that role', async () => {
      const response = await request(app.getHttpServer())
        .get('/fixture/admin-only')
        .set('Authorization', `Bearer ${tokenFor('ADMINISTRADOR')}`);

      expect(response.status).toBe(200);
    });

    it.each<Role>(['CLIENTE', 'CAJERO_RECEPTOR'])('refuses %s', async (role) => {
      const response = await request(app.getHttpServer())
        .get('/fixture/admin-only')
        .set('Authorization', `Bearer ${tokenFor(role)}`);

      expect(response.status).toBe(403);
      expect(response.body.type).toBe('FORBIDDEN');
      expect(harness.publisher.published).toHaveLength(0);
    });

    /**
     * `401` and `403` are different facts and the caller has to be able to act
     * on the difference: one means "sign in again", the other means "this is
     * not for you". Collapsing them would send a client into a sign-in loop it
     * can never escape.
     */
    it('answers differently from a request with no token at all', async () => {
      const [anonymous, wrongRole] = await Promise.all([
        request(app.getHttpServer()).get('/fixture/admin-only'),
        request(app.getHttpServer())
          .get('/fixture/admin-only')
          .set('Authorization', `Bearer ${tokenFor('CLIENTE')}`),
      ]);

      expect(anonymous.status).toBe(401);
      expect(wrongRole.status).toBe(403);
      expect(anonymous.body.type).not.toBe(wrongRole.body.type);
    });
  });

  /**
   * Decision D-06 restricts almost everything by *scope* — "own accounts",
   * "own only" — and scope is not knowable here: the gateway has no database
   * and does not know who owns what. So a protected route that names no roles
   * admits any authenticated actor, and the owning service refuses with a named
   * failure code. That is not a gap; it is the only division available when the
   * entry point holds no data.
   */
  describe('a protected route that names no roles', () => {
    it.each<Role>(['CLIENTE', 'CAJERO_RECEPTOR', 'ADMINISTRADOR'])(
      'admits %s, leaving scope to the owning service',
      async (role) => {
        const response = await request(app.getHttpServer())
          .get('/fixture/any-role')
          .set('Authorization', `Bearer ${tokenFor(role)}`);

        expect(response.status).toBe(200);
      },
    );
  });

  describe('public routes', () => {
    it('skip the role check entirely, having nobody to check', async () => {
      const response = await request(app.getHttpServer()).get('/fixture/open');

      expect(response.status).toBe(200);
    });
  });
});
