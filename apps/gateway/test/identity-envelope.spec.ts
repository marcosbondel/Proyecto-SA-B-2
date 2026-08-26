import request from 'supertest';
import type { INestApplication } from '@nestjs/common';

import { buildHarness } from './support/harness';
import type { Harness } from './support/harness';
import { ProtectedRoutesFixture } from './support/protected-routes.fixture';

const ACTOR = '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93';
const SOMEONE_ELSE = '8b7e5d21-9c2e-4a71-b8f5-2d6e7c0a1b93';

/**
 * Actor and subject are two different things, and they are easy to confuse
 * because for a `CLIENTE` operating on themselves they are the same value.
 *
 * - **Actor** — who is asking. Always the token. Travels in the envelope.
 * - **Subject** — who is being operated on. Comes from the body or the path.
 *
 * A cashier opening an account for a walk-in customer is the case that pulls
 * them apart, and the case that makes taking identity from the body tempting.
 */
describe('the identity that travels in the envelope', () => {
  let harness: Harness;
  let app: INestApplication;

  beforeEach(async () => {
    harness = await buildHarness([ProtectedRoutesFixture]);
    app = harness.app;
  });

  afterEach(async () => {
    await app.close();
  });

  function tokenFor(customerId: string, role: 'CLIENTE' | 'CAJERO_RECEPTOR'): string {
    return harness.tokens.sign({ customerId, username: 'ana.lopez', role });
  }

  it('is taken from the token, never from the request body', async () => {
    await request(app.getHttpServer())
      .post('/fixture/publishes')
      .set('Authorization', `Bearer ${tokenFor(ACTOR, 'CLIENTE')}`)
      .send({});

    expect(harness.publisher.published[0]!.identity).toEqual({
      customerId: ACTOR,
      role: 'CLIENTE',
    });
  });

  /**
   * The attack this closes: send a valid token of your own, and a body naming
   * somebody else, hoping the gateway trusts the body. Every service downstream
   * reads identity from the envelope and does not re-verify it (ADR-010), so
   * this is the single place where that trust is either earned or squandered.
   */
  it("ignores a body that tries to name a different actor", async () => {
    await request(app.getHttpServer())
      .post('/fixture/publishes')
      .set('Authorization', `Bearer ${tokenFor(ACTOR, 'CLIENTE')}`)
      .send({ customerId: SOMEONE_ELSE });

    const envelope = harness.publisher.published[0]!;

    expect(envelope.identity).toEqual({ customerId: ACTOR, role: 'CLIENTE' });
  });

  it('still carries the body value as the subject of the operation', async () => {
    await request(app.getHttpServer())
      .post('/fixture/publishes')
      .set('Authorization', `Bearer ${tokenFor(ACTOR, 'CAJERO_RECEPTOR')}`)
      .send({ customerId: SOMEONE_ELSE });

    const payload = harness.publisher.published[0]!.payload as { customerId: string };

    // A cashier acts on somebody else's behalf. Whether they may is Account
    // Service's decision — the gateway has no data with which to judge it.
    expect(payload.customerId).toBe(SOMEONE_ELSE);
    expect(harness.publisher.published[0]!.identity?.customerId).toBe(ACTOR);
  });

  it('falls back to the actor when the request names no subject', async () => {
    await request(app.getHttpServer())
      .post('/fixture/publishes')
      .set('Authorization', `Bearer ${tokenFor(ACTOR, 'CLIENTE')}`)
      .send({});

    const payload = harness.publisher.published[0]!.payload as { customerId: string };

    expect(payload.customerId).toBe(ACTOR);
  });

  it('names the gateway as the producer, since it originated the flow', async () => {
    await request(app.getHttpServer())
      .post('/fixture/publishes')
      .set('Authorization', `Bearer ${tokenFor(ACTOR, 'CLIENTE')}`)
      .send({});

    expect(harness.publisher.published[0]!.producer).toBe('gateway');
  });

  it('keeps the correlation identifier the caller brought', async () => {
    const mine = '1d4c9f60-9c2e-4a71-b8f5-2d6e7c0a1b93';

    await request(app.getHttpServer())
      .post('/fixture/publishes')
      .set('Authorization', `Bearer ${tokenFor(ACTOR, 'CLIENTE')}`)
      .set('X-Correlation-Id', mine)
      .send({});

    expect(harness.publisher.published[0]!.correlationId).toBe(mine);
  });
});
