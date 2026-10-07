import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { validateMessage } from '@bank/contracts';

import {
  TEST_ALERT_WEBHOOK_TOKEN,
  bearerFor,
  buildBrokerHarness,
  closeBrokerHarness,
} from './support/broker-harness';
import type { BrokerHarness } from './support/broker-harness';
import { ServiceDouble } from './support/service-double';

/**
 * T-45's two Gateway doors, against a **real** RabbitMQ: the SLO webhook, which
 * has no session and is guarded by a shared secret, and the audit listing with
 * its four filters.
 *
 * `alert-webhook.spec.ts` and `queries-reply.spec.ts` prove what the Gateway
 * *decides* with a recording publisher. What only a real broker can show is
 * what reached the wire: that `identity: null` — an alert has nobody behind it —
 * survives serialization as `null` and not as a missing field a consumer would
 * read as "unknown", that the exchange and routing key are the catalogue's, and
 * that a call the Gateway refuses leaves **nothing** on the broker rather than
 * nothing in a test double.
 *
 * Every case finds its message by a `correlationId` it chose itself: the broker
 * is shared with whatever else is connected, so a freshly minted id is the only
 * exact way to tell this suite's traffic from the ambient kind.
 */
const RABBITMQ_URL = process.env.RABBITMQ_URL;
const describeBroker = RABBITMQ_URL ? describe : describe.skip;

jest.setTimeout(70_000);

const GRAFANA_ALERT = {
  status: 'firing',
  labels: {
    alertname: 'GatewayAvailabilityBurnRate',
    severity: 'critical',
    slo: 'SLO-1',
    instance: 'gateway-7d9f8b-abcde',
  },
  annotations: {
    summary: 'El presupuesto de error de SLO-1 se consume 14 veces más rápido',
    runbook_url: 'https://example.invalid/runbooks/gateway-availability-burn-rate',
  },
  startsAt: '2026-10-05T18:00:00.000Z',
  fingerprint: 'c0ffee1234567890',
  generatorURL: 'https://grafana.example.invalid/alerting/grafana/abc/view',
};

describeBroker('the SLO webhook and the audit filters, on the real broker (T-45)', () => {
  let harness: BrokerHarness;
  let double: ServiceDouble;

  beforeAll(async () => {
    if (!RABBITMQ_URL) {
      console.warn('Skipping alert-webhook.integration.spec.ts: RABBITMQ_URL is not set.');
      return;
    }

    harness = await buildBrokerHarness({ replyTimeoutMs: 300 });
    double = await ServiceDouble.connect(RABBITMQ_URL);
    await double.spyOnEverythingPublished();
  });

  afterAll(async () => {
    if (!RABBITMQ_URL) {
      return;
    }
    await double.close();
    await closeBrokerHarness(harness);
  });

  const webhook = (correlationId: string, body: unknown, authorization?: string) => {
    const call = request(harness.app.getHttpServer())
      .post('/api/alerts/slo')
      .set('X-Correlation-Id', correlationId);

    return (
      authorization === undefined ? call : call.set('Authorization', authorization)
    ).send(body as object);
  };

  /** A window generous enough to catch a publish that happened despite the refusal. */
  async function neverPublished(correlationId: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(double.captured.some((m) => m.envelope?.correlationId === correlationId)).toBe(false);
  }

  describe('the webhook', () => {
    it('puts one command on bank.commands under the catalogue’s routing key', async () => {
      const correlationId = randomUUID();

      const response = await webhook(
        correlationId,
        { status: 'firing', alerts: [GRAFANA_ALERT] },
        `Bearer ${TEST_ALERT_WEBHOOK_TOKEN}`,
      );

      expect(response.status).toBe(202);

      const captured = await double.waitForEnvelope((e) => e.correlationId === correlationId, 5_000);

      expect(captured.exchange).toBe('bank.commands');
      expect(captured.routingKey).toBe('alert.slo.received.v1');
      expect(captured.envelope?.messageType).toBe('alert.slo.received.v1');
      expect(captured.envelope?.producer).toBe('gateway');
      expect(validateMessage(captured.envelope).ok).toBe(true);
    });

    it('sends identity as null, not as a missing field: an alert has nobody behind it', async () => {
      const correlationId = randomUUID();

      await webhook(
        correlationId,
        { status: 'firing', alerts: [GRAFANA_ALERT] },
        `Bearer ${TEST_ALERT_WEBHOOK_TOKEN}`,
      );

      const captured = await double.waitForEnvelope((e) => e.correlationId === correlationId, 5_000);

      expect(captured.envelope).toHaveProperty('identity', null);
    });

    it('sends what the alert said and none of the noise Grafana attached', async () => {
      const correlationId = randomUUID();

      await webhook(
        correlationId,
        { status: 'firing', alerts: [GRAFANA_ALERT] },
        `Bearer ${TEST_ALERT_WEBHOOK_TOKEN}`,
      );

      const captured = await double.waitForEnvelope((e) => e.correlationId === correlationId, 5_000);
      const wire = JSON.stringify(captured.envelope?.payload);

      expect(captured.envelope?.payload).toMatchObject({
        source: 'grafana',
        alerts: [
          {
            alertName: 'GatewayAvailabilityBurnRate',
            status: 'firing',
            severity: 'critical',
            slo: 'SLO-1',
            fingerprint: 'c0ffee1234567890',
          },
        ],
      });
      expect(wire).not.toContain('gateway-7d9f8b-abcde');
      expect(wire).not.toContain('generatorURL');
    });

    it('keeps a batch of three alerts as one message of three', async () => {
      const correlationId = randomUUID();
      const alert = (name: string, status: string) => ({
        ...GRAFANA_ALERT,
        status,
        labels: { ...GRAFANA_ALERT.labels, alertname: name },
      });

      await webhook(
        correlationId,
        {
          status: 'firing',
          alerts: [alert('A', 'firing'), alert('B', 'resolved'), alert('C', 'firing')],
        },
        `Bearer ${TEST_ALERT_WEBHOOK_TOKEN}`,
      );

      const captured = await double.waitForEnvelope((e) => e.correlationId === correlationId, 5_000);
      const alerts = (captured.envelope?.payload as { alerts: { alertName: string }[] }).alerts;

      expect(alerts.map((a) => a.alertName)).toEqual(['A', 'B', 'C']);
      expect(
        double.captured.filter((m) => m.envelope?.correlationId === correlationId),
      ).toHaveLength(1);
    });

    it.each([
      ['no credentials', undefined],
      ['the wrong secret', 'Bearer not-the-secret-not-the-secret-not-the-secret'],
      ['a session JWT, which is not the secret', undefined],
    ])('leaves the broker untouched for %s (401)', async (label, authorization) => {
      const correlationId = randomUUID();
      const credentials = label.startsWith('a session JWT')
        ? bearerFor(harness, 'ADMINISTRADOR')
        : authorization;

      const response = await webhook(
        correlationId,
        { status: 'firing', alerts: [GRAFANA_ALERT] },
        credentials,
      );

      expect(response.status).toBe(401);
      await neverPublished(correlationId);
    });

    it('leaves the broker untouched for an authenticated body with no alerts (400)', async () => {
      const correlationId = randomUUID();

      const response = await webhook(correlationId, { alerts: [] }, `Bearer ${TEST_ALERT_WEBHOOK_TOKEN}`);

      expect(response.status).toBe(400);
      await neverPublished(correlationId);
    });
  });

  describe('the audit listing with its four filters', () => {
    const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';

    it('publishes exactly the filters it was asked for, and no others', async () => {
      const correlationId = randomUUID();
      const filterCorrelation = randomUUID();

      await request(harness.app.getHttpServer())
        .get(
          `/api/audit/recent?severity=ERROR&correlationId=${filterCorrelation}&traceId=${TRACE}&service=payment-service`,
        )
        .set('Authorization', bearerFor(harness, 'ADMINISTRADOR'))
        .set('X-Correlation-Id', correlationId);

      const captured = await double.waitForEnvelope((e) => e.correlationId === correlationId, 5_000);

      expect(captured.exchange).toBe('bank.commands');
      expect(captured.envelope?.messageType).toBe('audit.events.list.query.v1');
      expect(captured.envelope?.payload).toEqual({
        page: 1,
        limit: 10,
        severity: 'ERROR',
        correlationId: filterCorrelation,
        traceId: TRACE,
        service: 'payment-service',
      });
      expect(validateMessage(captured.envelope).ok).toBe(true);
    });

    it('leaves the broker untouched on a trace id that is not one (400)', async () => {
      const correlationId = randomUUID();

      const response = await request(harness.app.getHttpServer())
        .get('/api/audit/recent?traceId=not-a-trace')
        .set('Authorization', bearerFor(harness, 'ADMINISTRADOR'))
        .set('X-Correlation-Id', correlationId);

      expect(response.status).toBe(400);
      await neverPublished(correlationId);
    });

    it('leaves the broker untouched on a service that does not exist (400)', async () => {
      const correlationId = randomUUID();

      const response = await request(harness.app.getHttpServer())
        .get('/api/audit/recent?service=the-other-bank')
        .set('Authorization', bearerFor(harness, 'ADMINISTRADOR'))
        .set('X-Correlation-Id', correlationId);

      expect(response.status).toBe(400);
      await neverPublished(correlationId);
    });
  });
});
