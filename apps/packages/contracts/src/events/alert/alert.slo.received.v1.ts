import { z } from 'zod';

import { isoTimestamp } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * One SLO alert, as the Gateway keeps it from what Grafana sent.
 *
 * Only what an operator needs to act on survives: the name, whether it fired or
 * resolved, how serious it is, the sentence that explains it and the runbook
 * that says what to do. Grafana's own payload carries every label of every
 * series and a dashboard URL with query parameters; none of that is copied, so
 * the audit trail stores what the alert *said* and not whatever the rule's
 * author happened to put in a label.
 */
export const sloAlert = z.object({
  alertName: z.string().min(1).max(200),
  status: z.enum(['firing', 'resolved']),
  severity: z.enum(['critical', 'warning', 'info']),
  /** The alert's `summary` annotation. */
  summary: z.string().max(500).optional(),
  /** The alert's `runbook_url` annotation: T-50 writes one runbook per alert. */
  runbookUrl: z.string().max(500).optional(),
  /** The `slo` label, when the rule names the objective it protects. */
  slo: z.string().max(100).optional(),
  startsAt: isoTimestamp,
  /** Grafana's fingerprint of the alert instance, to tell two apart in the trail. */
  fingerprint: z.string().max(100).optional(),
});

export type SloAlert = z.infer<typeof sloAlert>;

/** Grafana batches alerts of one notification; more than this is not a notification. */
export const MAX_ALERTS_PER_WEBHOOK = 50;

/**
 * An alert from the monitoring stack reached the Gateway's webhook (Fase 3,
 * §4.1 — Notification & Audit Service: "generar una notificación al recibir
 * una alerta de SLO"; T-45).
 *
 * **A command, not an event.** The Gateway publishes intentions, never facts
 * (see the comment on the audit queues in `topology.ts`): this says "record
 * this alert and tell the operators", and Notification & Audit is the one
 * service that does. It answers nothing — the webhook replies `202` as soon as
 * the broker has the message, because Grafana is not a person waiting for a
 * verdict and must not hold a connection while a database writes.
 *
 * `source` is closed to `grafana` today. The field exists so a second alerting
 * system would be a new value and not a new contract.
 */
export const alertSloReceivedV1 = defineContract({
  name: 'alert.slo.received.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['notification-audit-service'],
  schema: z.object({
    source: z.literal('grafana'),
    alerts: z.array(sloAlert).min(1).max(MAX_ALERTS_PER_WEBHOOK),
  }),
});

export type AlertSloReceivedV1 = z.infer<typeof alertSloReceivedV1.schema>;
