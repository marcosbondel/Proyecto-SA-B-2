import request from 'supertest';
import type { INestApplication } from '@nestjs/common';

import { CustomersController } from '../src/interfaces/customers.controller';
import { buildHarness } from './support/harness';
import type { Harness } from './support/harness';

/**
 * Registration is `@Public()`, but "public" means anyone may register a
 * `CLIENTE` — not that anyone may mint themselves an `ADMINISTRADOR`. Creating
 * staff is "assign a role", which decision D-06 grants to `ADMINISTRADOR`
 * alone. The gateway is the only component holding the session, so the check
 * lives here: a public registration whose identity is `null` reaches Customer
 * Service unable to tell an anonymous caller from an administrator.
 *
 * The load-bearing assertion in every refusal below is the same one the whole
 * command suite turns on: nothing was published.
 */
const BASE = {
  fullName: 'Ana López',
  identityDocument: '1234567890101',
  email: 'ana@example.com',
  dateOfBirth: '1995-04-12',
  address: 'Zona 1, Guatemala',
  credential: 'una-contrasena-larga',
};

const ADMIN = '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93';

describe('registration and the requested role', () => {
  let harness: Harness;
  let app: INestApplication;

  beforeEach(async () => {
    harness = await buildHarness([CustomersController]);
    app = harness.app;
  });

  afterEach(async () => {
    await app.close();
  });

  function register(): request.Test {
    return request(app.getHttpServer()).post('/api/customers');
  }

  it('accepts an anonymous CLIENTE registration', async () => {
    const response = await register().field({ ...BASE, role: 'CLIENTE' });

    expect(response.status).toBe(202);
    expect(harness.publisher.published).toHaveLength(1);
  });

  it.each([['ADMINISTRADOR'], ['CAJERO_RECEPTOR']])(
    'refuses an anonymous %s registration and publishes nothing',
    async (role) => {
      const response = await register().field({ ...BASE, role });

      expect(response.status).toBe(401);
      expect(harness.publisher.published).toHaveLength(0);
    },
  );

  it('refuses a CLIENTE trying to create an ADMINISTRADOR (403), publishing nothing', async () => {
    const token = harness.tokens.sign({ customerId: ADMIN, username: 'ana', role: 'CLIENTE' });

    const response = await register()
      .set('Authorization', `Bearer ${token}`)
      .field({ ...BASE, role: 'ADMINISTRADOR' });

    expect(response.status).toBe(403);
    expect(harness.publisher.published).toHaveLength(0);
  });

  it('lets an ADMINISTRADOR create an ADMINISTRADOR', async () => {
    const token = harness.tokens.sign({ customerId: ADMIN, username: 'root', role: 'ADMINISTRADOR' });

    const response = await register()
      .set('Authorization', `Bearer ${token}`)
      .field({ ...BASE, role: 'ADMINISTRADOR' });

    expect(response.status).toBe(202);
    expect(harness.publisher.published).toHaveLength(1);
  });

  it('lets an ADMINISTRADOR create a CAJERO_RECEPTOR', async () => {
    const token = harness.tokens.sign({ customerId: ADMIN, username: 'root', role: 'ADMINISTRADOR' });

    const response = await register()
      .set('Authorization', `Bearer ${token}`)
      .field({ ...BASE, role: 'CAJERO_RECEPTOR' });

    expect(response.status).toBe(202);
    expect(harness.publisher.published).toHaveLength(1);
  });
});
