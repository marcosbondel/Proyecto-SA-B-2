import request from 'supertest';
import type { INestApplication } from '@nestjs/common';

import { HealthController } from '../src/interfaces/health.controller';
import { buildHarness } from './support/harness';
import type { Harness } from './support/harness';

describe('the technical endpoints', () => {
  let harness: Harness;
  let app: INestApplication;

  beforeEach(async () => {
    harness = await buildHarness([HealthController]);
    app = harness.app;
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /health', () => {
    it('answers without a token, because an orchestrator has none', async () => {
      const response = await request(app.getHttpServer()).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok', application: 'gateway' });
    });

    /**
     * Liveness must not fail for anything a restart would not fix. A gateway
     * that reported itself dead whenever RabbitMQ blinked would be restarted in
     * a loop while the actual fault sat elsewhere.
     */
    it('still answers while the broker is down', async () => {
      harness.brokerUp.value = false;

      const response = await request(app.getHttpServer()).get('/health');

      expect(response.status).toBe(200);
    });
  });

  describe('GET /ready', () => {
    it('reports ready when the broker is reachable', async () => {
      const response = await request(app.getHttpServer()).get('/ready');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'ready',
        application: 'gateway',
        broker: 'connected',
      });
    });

    /**
     * The status code is what an orchestrator reads. Answering `200` with a
     * "degraded" body would keep this instance in rotation, taking requests it
     * can only answer with an error.
     */
    it('refuses with 503 when the broker is unreachable', async () => {
      harness.brokerUp.value = false;

      const response = await request(app.getHttpServer()).get('/ready');

      expect(response.status).toBe(503);
      expect(response.body.type).toBe('BROKER_UNAVAILABLE');
    });
  });

  describe('correlation', () => {
    it('puts an identifier on every response, probes included', async () => {
      const response = await request(app.getHttpServer()).get('/health');

      expect(response.headers['x-correlation-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it("keeps the caller's identifier when they brought one", async () => {
      const mine = '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93';

      const response = await request(app.getHttpServer())
        .get('/health')
        .set('X-Correlation-Id', mine);

      expect(response.headers['x-correlation-id']).toBe(mine);
    });

    /**
     * A mistyped trace header must not cost somebody their banking request.
     * The correlation identifier is a diagnostic aid, not an instruction.
     */
    it('replaces a malformed identifier instead of rejecting the request', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .set('X-Correlation-Id', 'not-a-uuid');

      expect(response.status).toBe(200);
      expect(response.headers['x-correlation-id']).not.toBe('not-a-uuid');
    });

    it('carries the identifier into an error response too', async () => {
      harness.brokerUp.value = false;
      const mine = '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93';

      const response = await request(app.getHttpServer())
        .get('/ready')
        .set('X-Correlation-Id', mine);

      expect(response.status).toBe(503);
      expect(response.body.correlationId).toBe(mine);
      expect(response.headers['x-correlation-id']).toBe(mine);
    });
  });
});
