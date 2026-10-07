import {
  MAX_ALERTS_PER_WEBHOOK,
  QUEUES,
  alertSloReceivedV1,
  auditEventsListQueryV1,
  auditEventsListRepliedV1,
  catalogByName,
  destinationFor,
  routingKeyFor,
  traceId,
} from '../../src';

/**
 * T-45's contracts, written first. What matters is what a webhook can carry
 * into the audit trail and what can never get there: an alert with no name, a
 * batch no monitoring system sends, a free-form field that could hold anything,
 * and a trace id that is not one.
 */

const ALERT = {
  alertName: 'GatewayAvailabilityBurnRate',
  status: 'firing',
  severity: 'critical',
  summary: 'El presupuesto de error de SLO-1 se consume 14 veces más rápido de lo permitido',
  runbookUrl: 'https://example.invalid/runbooks/gateway-availability-burn-rate',
  slo: 'SLO-1',
  startsAt: '2026-10-05T18:00:00.000Z',
  fingerprint: 'c0ffee1234567890',
} as const;

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';

describe('alert.slo.received.v1', () => {
  describe('what it is', () => {
    it('is a Gateway command that Notification & Audit handles', () => {
      expect(alertSloReceivedV1.category).toBe('command');
      expect(alertSloReceivedV1.producer).toBe('gateway');
      expect(alertSloReceivedV1.consumers).toEqual(['notification-audit-service']);
      expect(catalogByName.get('alert.slo.received.v1')).toBe(alertSloReceivedV1);
    });

    it('reaches audit.alert, a queue of its own, and no other queue', () => {
      expect(destinationFor(alertSloReceivedV1)).toEqual({
        exchange: 'bank.commands',
        routingKey: routingKeyFor('alert.slo.received.v1'),
      });

      const bound = QUEUES.filter((queue) =>
        queue.bindings.some(
          (binding) =>
            binding.exchange === 'bank.commands' &&
            (binding.pattern === 'alert.slo.received.v1' || binding.pattern === '#'),
        ),
      );

      expect(bound.map((queue) => queue.name)).toEqual(['audit.alert']);
      expect(bound[0]?.owner).toBe('notification-audit-service');
    });
  });

  describe('accepts', () => {
    it('one firing alert with everything an operator needs', () => {
      expect(alertSloReceivedV1.schema.safeParse({ source: 'grafana', alerts: [ALERT] }).success).toBe(
        true,
      );
    });

    it('a resolved one with only the required fields', () => {
      const { alertName, severity, startsAt } = ALERT;
      const minimal = { alertName, status: 'resolved', severity, startsAt };

      expect(alertSloReceivedV1.schema.safeParse({ source: 'grafana', alerts: [minimal] }).success).toBe(
        true,
      );
    });

    it(`a batch of exactly ${String(MAX_ALERTS_PER_WEBHOOK)}`, () => {
      const alerts = Array.from({ length: MAX_ALERTS_PER_WEBHOOK }, () => ALERT);

      expect(alertSloReceivedV1.schema.safeParse({ source: 'grafana', alerts }).success).toBe(true);
    });
  });

  describe('refuses', () => {
    const parse = (value: unknown) => alertSloReceivedV1.schema.safeParse(value).success;

    it('no alerts at all, and more than a notification can hold', () => {
      expect(parse({ source: 'grafana', alerts: [] })).toBe(false);
      expect(
        parse({
          source: 'grafana',
          alerts: Array.from({ length: MAX_ALERTS_PER_WEBHOOK + 1 }, () => ALERT),
        }),
      ).toBe(false);
    });

    it('a source nobody has agreed to', () => {
      expect(parse({ source: 'nagios', alerts: [ALERT] })).toBe(false);
      expect(parse({ alerts: [ALERT] })).toBe(false);
    });

    it.each([
      ['an alert with no name', { ...ALERT, alertName: '' }],
      ['an unknown status', { ...ALERT, status: 'pending' }],
      ['an unknown severity', { ...ALERT, severity: 'fatal' }],
      ['a start that is not a timestamp', { ...ALERT, startsAt: 'yesterday' }],
      ['a summary long enough to be a payload of its own', { ...ALERT, summary: 'x'.repeat(501) }],
      ['a name long enough to be a payload of its own', { ...ALERT, alertName: 'x'.repeat(201) }],
    ])('%s', (_label, alert) => {
      expect(parse({ source: 'grafana', alerts: [alert] })).toBe(false);
    });
  });
});

describe('traceId', () => {
  it('accepts a W3C trace-id', () => {
    expect(traceId.safeParse(TRACE).success).toBe(true);
  });

  it.each([
    ['the all-zero value the specification reserves', '0'.repeat(32)],
    ['uppercase hex', TRACE.toUpperCase()],
    ['a short one', TRACE.slice(0, 31)],
    ['a long one', `${TRACE}0`],
    ['something that is not hex', 'z'.repeat(32)],
    ['a traceparent header', `00-${TRACE}-00f067aa0ba902b7-01`],
  ])('refuses %s', (_label, value) => {
    expect(traceId.safeParse(value).success).toBe(false);
  });
});

describe('the audit queries after T-45', () => {
  const CORRELATION = '9b2f0c1e-3d4a-4b6c-8e7f-0a1b2c3d4e5f';

  it('take the four filters §4.1 names, all optional and all combinable', () => {
    expect(auditEventsListQueryV1.schema.safeParse({}).success).toBe(true);

    const everything = auditEventsListQueryV1.schema.safeParse({
      correlationId: CORRELATION,
      traceId: TRACE,
      service: 'payment-service',
      severity: 'ERROR',
      page: 2,
      limit: 25,
    });

    expect(everything.success).toBe(true);
  });

  it('refuse a filter that is not what it says it is', () => {
    for (const bad of [
      { correlationId: 'not-a-uuid' },
      { traceId: 'not-a-trace' },
      { service: 'the-other-bank' },
      { severity: 'FATAL' },
    ]) {
      expect(auditEventsListQueryV1.schema.safeParse(bad).success).toBe(false);
    }
  });

  it('answer with the trace id of an event, and without it for one recorded before', () => {
    const event = {
      eventId: CORRELATION,
      messageType: 'account.debited.v1',
      producer: 'account-service',
      occurredAt: '2026-10-05T18:00:00.000Z',
      correlationId: CORRELATION,
      processingStatus: 'PROCESSED',
      consumer: 'audit.account',
      payload: {},
    };

    const reply = (events: unknown[]) =>
      auditEventsListRepliedV1.schema.safeParse({ events, total: events.length, page: 1, limit: 10 })
        .success;

    expect(reply([event])).toBe(true);
    expect(reply([{ ...event, traceId: TRACE, causationId: CORRELATION }])).toBe(true);
    expect(reply([{ ...event, traceId: 'nope' }])).toBe(false);
  });
});
