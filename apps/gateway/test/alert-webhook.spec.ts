import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { GatewayError } from '../src/application/errors/gateway-error';
import { alertSloReceivedV1 } from '@bank/contracts';
import request from 'supertest';

import { alertsFromGrafana } from '../src/application/routes/alert-webhook.use-case';
import { AlertsController } from '../src/interfaces/alerts.controller';
import { AlertTokenGuard } from '../src/interfaces/guards/alert-token.guard';
import { TEST_ALERT_TOKEN, buildHarness } from './support/harness';
import type { Harness } from './support/harness';

/**
 * T-45's webhook: "un webhook de alerta queda registrado y notificado", from the
 * Gateway's side of it.
 *
 * What is asserted is the shape of the door. That Grafana, which has no session,
 * gets in with the shared secret and with nothing else — and that a refused call
 * **publishes nothing**, because an unauthenticated write into the audit trail
 * and the operators' notifications is exactly what the secret exists to prevent.
 * That what leaves is what the alert *said*, mapped, and not Grafana's payload
 * forwarded. And that the route is a command that awaits nothing: Grafana is not
 * a person waiting for a verdict.
 */

/** A webhook as Grafana's unified alerting sends it, with the noise it sends. */
const GRAFANA = {
  receiver: 'bank-usac-audit',
  status: 'firing',
  orgId: 1,
  externalURL: 'https://grafana.example.invalid/',
  alerts: [
    {
      status: 'firing',
      labels: {
        alertname: 'GatewayAvailabilityBurnRate',
        severity: 'critical',
        slo: 'SLO-1',
        instance: 'gateway-7d9f8b-abcde',
        namespace: 'prod',
      },
      annotations: {
        summary: 'El presupuesto de error de SLO-1 se consume 14 veces más rápido',
        runbook_url: 'https://example.invalid/runbooks/gateway-availability-burn-rate',
        description: 'Una descripción larga que el Gateway no tiene por qué copiar.',
      },
      // Nanoseconds and an offset, the way Grafana writes it.
      startsAt: '2026-10-05T12:00:00.123456789-06:00',
      endsAt: '0001-01-01T00:00:00Z',
      generatorURL: 'https://grafana.example.invalid/alerting/grafana/abc/view?orgId=1',
      fingerprint: 'c0ffee1234567890',
      silenceURL: 'https://grafana.example.invalid/alerting/silence/new',
      dashboardURL: 'https://grafana.example.invalid/d/slo',
    },
  ],
};

describe('the SLO alert webhook', () => {
  let harness: Harness;
  let app: INestApplication;

  beforeEach(async () => {
    harness = await buildHarness([AlertsController]);
    app = harness.app;
  });

  afterEach(async () => {
    await app.close();
  });

  const post = (body: unknown, authorization: string | null = `Bearer ${TEST_ALERT_TOKEN}`) => {
    const call = request(app.getHttpServer()).post('/api/alerts/slo');

    return (authorization === null ? call : call.set('Authorization', authorization)).send(
      body as object,
    );
  };

  describe('who may call it', () => {
    it('admits the shared secret and answers 202 without awaiting anybody', async () => {
      const response = await post(GRAFANA);

      expect(response.status).toBe(202);
      expect(response.body).toEqual({ accepted: 1, correlationId: expect.any(String) });
      expect(harness.publisher.published).toHaveLength(1);
    });

    it.each([
      ['no credentials', null],
      ['the wrong secret', 'Bearer not-the-secret-not-the-secret-not-the-secret'],
      ['the right secret as another scheme', `Basic ${TEST_ALERT_TOKEN}`],
      ['the secret with no scheme', TEST_ALERT_TOKEN],
      ['an empty bearer', 'Bearer '],
      ['a prefix of the secret', `Bearer ${TEST_ALERT_TOKEN.slice(0, -1)}`],
      ['the secret with a character more', `Bearer ${TEST_ALERT_TOKEN}x`],
    ])('refuses %s with 401 and publishes nothing', async (_label, authorization) => {
      const response = await post(GRAFANA, authorization);

      expect(response.status).toBe(401);
      expect(response.body.type).toBe('UNAUTHENTICATED');
      expect(harness.publisher.published).toHaveLength(0);
    });

    it('does not take a session JWT for the secret, whatever the role', async () => {
      const token = harness.tokens.sign({
        customerId: '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93',
        username: 'admin',
        role: 'ADMINISTRADOR',
      });

      const response = await post(GRAFANA, `Bearer ${token}`);

      expect(response.status).toBe(401);
      expect(harness.publisher.published).toHaveLength(0);
    });

    it('is not an open door for the session either: the secret is the only way in', async () => {
      const response = await request(app.getHttpServer()).post('/api/alerts/slo').send(GRAFANA);

      expect(response.status).toBe(401);
    });

    describe('fails closed when no secret is configured', () => {
      const contextFor = (authorization: string | undefined) =>
        ({
          switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }),
        }) as unknown as ExecutionContext;

      it.each([null, ''])('refuses everybody, even one who presents %p', (token) => {
        const guard = new AlertTokenGuard(token);

        for (const presented of [undefined, 'Bearer ', 'Bearer anything', `Bearer ${String(token)}`]) {
          expect(() => guard.canActivate(contextFor(presented))).toThrow(GatewayError);
        }
      });

      it('admits the configured secret and nothing near it', () => {
        const guard = new AlertTokenGuard(TEST_ALERT_TOKEN);

        expect(guard.canActivate(contextFor(`Bearer ${TEST_ALERT_TOKEN}`))).toBe(true);
        expect(guard.canActivate(contextFor(`bearer ${TEST_ALERT_TOKEN}`))).toBe(true);
        expect(() => guard.canActivate(contextFor(`Bearer ${TEST_ALERT_TOKEN}x`))).toThrow();
      });
    });
  });

  describe('what it publishes', () => {
    it('is the alert mapped to the contract, as a command of the gateway with nobody behind it', async () => {
      await post(GRAFANA);

      const [envelope] = harness.publisher.published;

      expect(envelope?.messageType).toBe(alertSloReceivedV1.name);
      expect(envelope?.producer).toBe('gateway');
      expect(envelope?.identity).toBeNull();
      expect(alertSloReceivedV1.schema.safeParse(envelope?.payload).success).toBe(true);
      expect(envelope?.payload).toEqual({
        source: 'grafana',
        alerts: [
          {
            alertName: 'GatewayAvailabilityBurnRate',
            status: 'firing',
            severity: 'critical',
            summary: 'El presupuesto de error de SLO-1 se consume 14 veces más rápido',
            runbookUrl: 'https://example.invalid/runbooks/gateway-availability-burn-rate',
            slo: 'SLO-1',
            startsAt: '2026-10-05T18:00:00.123Z',
            fingerprint: 'c0ffee1234567890',
          },
        ],
      });
    });

    it('leaves out everything Grafana sent that is not what the alert said', async () => {
      await post(GRAFANA);

      const published = JSON.stringify(harness.publisher.published[0]?.payload);

      for (const noise of [
        'gateway-7d9f8b-abcde',
        'namespace',
        'generatorURL',
        'silenceURL',
        'dashboardURL',
        'externalURL',
        'Una descripción larga',
      ]) {
        expect(published).not.toContain(noise);
      }
    });

    it('carries the caller\'s correlation id, so the trail can be found by it', async () => {
      const correlationId = '7d41e8b2-9a3f-4c15-8ee0-1b2f9a4c7d10';

      const response = await request(app.getHttpServer())
        .post('/api/alerts/slo')
        .set('Authorization', `Bearer ${TEST_ALERT_TOKEN}`)
        .set('X-Correlation-Id', correlationId)
        .send(GRAFANA);

      expect(response.body.correlationId).toBe(correlationId);
      expect(harness.publisher.published[0]?.correlationId).toBe(correlationId);
    });

    it('takes a whole batch as one message', async () => {
      const second = {
        ...GRAFANA.alerts[0],
        status: 'resolved',
        labels: { ...GRAFANA.alerts[0]?.labels, alertname: 'PaymentFailureRate' },
      };

      const response = await post({ ...GRAFANA, alerts: [GRAFANA.alerts[0], second] });

      expect(response.body.accepted).toBe(2);
      expect(harness.publisher.published).toHaveLength(1);
    });

    it('answers 503 and loses nothing silently when the broker is down', async () => {
      harness.publisher.failWith = GatewayError.brokerUnavailable();

      const response = await post(GRAFANA);

      expect(response.status).toBe(503);
    });
  });

  describe('what it tolerates, and what it refuses', () => {
    const alert = (overrides: Record<string, unknown> = {}, labels: Record<string, unknown> = {}) => ({
      status: 'firing',
      labels: { alertname: 'X', ...labels },
      annotations: {},
      startsAt: '2026-10-05T18:00:00Z',
      ...overrides,
    });

    it.each([
      ['no severity label', {}],
      ['an unknown severity', { severity: 'page-everyone' }],
    ])('turns %s into a warning: visible, and not an alarm', (_label, labels) => {
      expect(alertsFromGrafana({ alerts: [alert({}, labels)] })[0]?.severity).toBe('warning');
    });

    it('reads the severity case-insensitively', () => {
      expect(alertsFromGrafana({ alerts: [alert({}, { severity: 'CRITICAL' })] })[0]?.severity).toBe(
        'critical',
      );
    });

    it('takes the status of the batch when the alert does not carry its own', () => {
      const { status: _ignored, ...bare } = alert();

      expect(alertsFromGrafana({ status: 'resolved', alerts: [bare] })[0]?.status).toBe('resolved');
    });

    it('cuts free text to the length the contract holds instead of refusing the alert', () => {
      const [mapped] = alertsFromGrafana({
        alerts: [
          {
            ...alert({}, { alertname: 'n'.repeat(500), slo: 's'.repeat(500) }),
            annotations: { summary: 'x'.repeat(2000), runbook_url: 'u'.repeat(2000) },
            fingerprint: 'f'.repeat(500),
          },
        ],
      });

      expect(mapped?.alertName).toHaveLength(200);
      expect(mapped?.summary).toHaveLength(500);
      expect(mapped?.runbookUrl).toHaveLength(500);
      expect(mapped?.slo).toHaveLength(100);
      expect(mapped?.fingerprint).toHaveLength(100);
      expect(alertSloReceivedV1.schema.safeParse({ source: 'grafana', alerts: [mapped] }).success).toBe(
        true,
      );
    });

    it.each([
      ['a body that is not an object', 'a string'],
      ['a body with no alerts', {}],
      ['an empty batch', { alerts: [] }],
      ['alerts that are not a list', { alerts: 'many' }],
      ['an alert that is not an object', { alerts: ['boom'] }],
      ['an alert with no name', { alerts: [alert({ labels: {} })] }],
      ['an alert with a blank name', { alerts: [alert({}, { alertname: '   ' })] }],
      ['an alert in a state Grafana does not have', { alerts: [alert({ status: 'pending' })] }],
      ['an alert with no state at all', { alerts: [{ ...alert(), status: undefined }] }],
      ['a start that is not a date', { alerts: [alert({ startsAt: 'yesterday' })] }],
      ['a start that is missing', { alerts: [alert({ startsAt: undefined })] }],
      ['more alerts than a notification can hold', { alerts: Array.from({ length: 51 }, () => alert()) }],
    ])('refuses %s with 400, and publishes nothing', async (_label, body) => {
      const response = await post(body);

      expect(response.status).toBe(400);
      expect(response.body.type).toBe('VALIDATION_ERROR');
      expect(harness.publisher.published).toHaveLength(0);
    });
  });
});
