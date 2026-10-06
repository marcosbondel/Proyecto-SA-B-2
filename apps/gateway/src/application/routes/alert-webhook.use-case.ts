import { Inject, Injectable } from '@nestjs/common';
import { MAX_ALERTS_PER_WEBHOOK, alertSloReceivedV1 } from '@bank/contracts';
import type { AlertSloReceivedV1 } from '@bank/contracts';

import { GatewayError } from '../errors/gateway-error';
import { MESSAGE_PUBLISHER } from '../ports';
import type { MessagePublisherPort } from '../ports';
import { envelopeForRequest } from '../request-envelope';

/** What the webhook answers: how many alerts it took, and the correlation to find them by. */
export interface ReceivedAlerts {
  readonly accepted: number;
  readonly correlationId: string;
}

type SloAlert = AlertSloReceivedV1['alerts'][number];

const SEVERITIES = new Set<SloAlert['severity']>(['critical', 'warning', 'info']);

/**
 * An SLO alert from Grafana, on its way to Notification & Audit (Fase 3, §4.1;
 * T-45).
 *
 * The Gateway's whole job here is the one it has for every route: validate at
 * the edge, wrap, publish, say `202`. It does not decide whether an alert
 * matters, deduplicate Grafana's repetitions or compute a severity — it reads
 * what the alert *says* and passes it on, and Notification & Audit, the
 * service that owns the trail, decides what it is worth.
 *
 * **It maps Grafana's payload instead of forwarding it.** The webhook body
 * carries every label of every series and a link with query parameters; none of
 * it is the Gateway's to put on the broker, and the audit trail should store
 * what the alert said and not whatever a rule's author put in a label. Free text
 * is cut to the contract's length rather than refused: an alert about an outage
 * must never itself be refused because its summary was a sentence too long.
 *
 * **It tolerates what Grafana is lax about and refuses what it cannot use.** A
 * missing `severity` label becomes `warning` (visible, and not an alarm); a
 * missing name, an empty batch or a timestamp that is not one is a `400`,
 * because there is nothing to record.
 */
@Injectable()
export class AlertWebhookUseCase {
  readonly #publisher: MessagePublisherPort;

  constructor(@Inject(MESSAGE_PUBLISHER) publisher: MessagePublisherPort) {
    this.#publisher = publisher;
  }

  public async receive(body: unknown, correlationId: string): Promise<ReceivedAlerts> {
    const payload = {
      source: 'grafana' as const,
      alerts: alertsFromGrafana(body),
    };

    // The same check the other commands make: the contract is the authority,
    // and a rule it gains later must hold here before it dies at a consumer.
    const parsed = alertSloReceivedV1.schema.safeParse(payload);

    if (!parsed.success) {
      const issue = parsed.error.issues[0];

      throw GatewayError.validation(
        issue?.message ?? 'La alerta no cumple el contrato.',
        issue?.path.join('.'),
      );
    }

    await this.#publisher.publish(
      envelopeForRequest(parsed.data, alertSloReceivedV1.name, null, correlationId),
    );

    return { accepted: parsed.data.alerts.length, correlationId };
  }
}

/** Grafana's `alerts` array, as the contract's alerts. Pure, and exported to be tested alone. */
export function alertsFromGrafana(body: unknown): SloAlert[] {
  const alerts = isRecord(body) ? body['alerts'] : undefined;

  if (!Array.isArray(alerts) || alerts.length === 0) {
    throw GatewayError.validation('El webhook no trae alertas.', 'alerts');
  }

  if (alerts.length > MAX_ALERTS_PER_WEBHOOK) {
    throw GatewayError.validation(
      `El webhook trae más de ${String(MAX_ALERTS_PER_WEBHOOK)} alertas.`,
      'alerts',
    );
  }

  const batchStatus = isRecord(body) ? body['status'] : undefined;

  return alerts.map((raw: unknown, index) => {
    const field = `alerts.${String(index)}`;

    if (!isRecord(raw)) {
      throw GatewayError.validation('Una alerta no tiene la forma esperada.', field);
    }

    const labels = isRecord(raw['labels']) ? raw['labels'] : {};
    const annotations = isRecord(raw['annotations']) ? raw['annotations'] : {};

    const alertName = text(labels['alertname']);

    if (alertName === undefined) {
      throw GatewayError.validation('La alerta no trae `labels.alertname`.', `${field}.labels`);
    }

    const status = raw['status'] ?? batchStatus;

    if (status !== 'firing' && status !== 'resolved') {
      throw GatewayError.validation(
        'El estado de la alerta debe ser firing o resolved.',
        `${field}.status`,
      );
    }

    const startsAt = new Date(typeof raw['startsAt'] === 'string' ? raw['startsAt'] : '');

    if (Number.isNaN(startsAt.getTime())) {
      throw GatewayError.validation('`startsAt` no es una fecha válida.', `${field}.startsAt`);
    }

    const severity = text(labels['severity'])?.toLowerCase() as SloAlert['severity'] | undefined;
    const summary = text(annotations['summary']);
    const runbookUrl = text(annotations['runbook_url']);
    const slo = text(labels['slo']);
    const fingerprint = text(raw['fingerprint']);

    return {
      alertName: alertName.slice(0, 200),
      status,
      severity: severity !== undefined && SEVERITIES.has(severity) ? severity : 'warning',
      ...(summary === undefined ? {} : { summary: summary.slice(0, 500) }),
      ...(runbookUrl === undefined ? {} : { runbookUrl: runbookUrl.slice(0, 500) }),
      ...(slo === undefined ? {} : { slo: slo.slice(0, 100) }),
      startsAt: startsAt.toISOString(),
      ...(fingerprint === undefined ? {} : { fingerprint: fingerprint.slice(0, 100) }),
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A non-empty string, or `undefined`. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
