import { metrics, trace } from '@opentelemetry/api';
import type { Counter, Histogram, Tracer } from '@opentelemetry/api';

import type { InterbankTelemetry } from '../../application/interbank.ports';
import type { InterbankSendTelemetry } from '../../application/interbank-send.ports';
// Qué estados son un veredicto lo decide el dominio, aquí sólo se mide. La
// prueba de aislamiento de este servicio es la que insiste, y tiene razón: en
// cuanto un adaptador compara estas cadenas, el vocabulario se ha mudado a un
// sitio donde ya no se puede discutir sin levantar el servicio.
import { sentMetricResult } from '../../domain/interbank-send';

export const DEPOSITS_COUNTER = 'bank.interbank.deposits';
export const DURATION_HISTOGRAM = 'bank.interbank.deposit.duration';
export const CALLBACKS_COUNTER = 'bank.interbank.callbacks';
export const STATE_EVENT = 'bank.interbank.state_changed';

type LogFields = {
  readonly correlationId: string;
  readonly depositId?: string;
  readonly status?: string;
  readonly reason?: string;
  readonly durationMs?: number;
  readonly outcome?: string;
  /** De dónde venía y con qué, para una transición que el diagrama no tiene (T-56). */
  readonly from?: string;
  readonly event?: string;
  /** El paso del barrido que falló o el motivo de un fallo, siempre al log. */
  readonly step?: string;
  readonly error?: string;
};

/** Closed metric labels; entity identifiers live only in correlated logs. */
export class OtelInterbankTelemetry implements InterbankTelemetry {
  readonly #deposits: Counter;
  readonly #duration: Histogram;
  readonly #callbacks: Counter;
  readonly #tracer: Tracer;

  constructor(
    readonly log: {
      info(message: string, fields: LogFields): void;
      warn(message: string, fields: LogFields): void;
      error(message: string, fields: LogFields): void;
    },
  ) {
    const meter = metrics.getMeter('payment-service.interbank');
    this.#tracer = trace.getTracer('payment-service.interbank');
    this.#deposits = meter.createCounter(DEPOSITS_COUNTER, {
      unit: '{deposit}',
      description: 'Incoming interbank deposits by final result. Success rate is accepted / total.',
    });
    this.#duration = meter.createHistogram(DURATION_HISTOGRAM, {
      unit: 's',
      description: 'Time from receipt to a final interbank deposit decision.',
      advice: { explicitBucketBoundaries: [0.005, 0.025, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60] },
    });
    this.#callbacks = meter.createCounter(CALLBACKS_COUNTER, {
      unit: '{attempt}',
      description: 'Outbound partner callbacks by delivery result.',
    });
  }

  stateChanged(change: Parameters<InterbankTelemetry['stateChanged']>[0]): void {
    const attributes = {
      'bank.correlation_id': change.correlationId,
      'bank.interbank.stage': change.stage,
      ...(change.reason === null ? {} : { 'bank.interbank.reason': change.reason }),
    };
    const span = this.#tracer.startSpan('payment.interbank state');
    span.setAttributes(attributes);
    span.addEvent(STATE_EVENT, attributes);
    span.end();
    const fields: LogFields = {
      correlationId: change.correlationId,
      depositId: change.depositId,
      status: change.stage,
      ...(change.reason === null ? {} : { reason: change.reason }),
      ...(change.durationMs === null ? {} : { durationMs: change.durationMs }),
    };
    this.log.info('interbank deposit state changed', fields);

    if (change.stage === 'ACCEPTED' || change.stage === 'REJECTED') {
      const result = change.stage.toLowerCase();
      this.#deposits.add(1, { result });
      if (change.durationMs !== null) this.#duration.record(change.durationMs / 1000, { result });
    }
  }

  callbackAttempt(attempt: Parameters<InterbankTelemetry['callbackAttempt']>[0]): void {
    this.#callbacks.add(1, { result: attempt.result });
    const fields = {
      correlationId: attempt.correlationId,
      outcome: attempt.result,
      ...(attempt.detail === undefined ? {} : { error: attempt.detail }),
    };
    if (attempt.result === 'delivered') this.log.info('interbank callback delivered', fields);
    else this.log.warn('interbank callback failed; retry scheduled', fields);
  }

  sweepFailed(failure: Parameters<InterbankTelemetry['sweepFailed']>[0]): void {
    this.log.error('interbank sweep step failed; the rest of the pass continues', {
      correlationId: failure.correlationId,
      step: failure.step,
      error: failure.error,
    });
  }

  /**
   * Al log y **no a una métrica** (T-56).
   *
   * Una transición ilegal es rara y específica: lo que hace falta cuando ocurre
   * es saber cuál fue, no cuántas van. Un contador con `from` y `event` como
   * etiquetas serían dieciséis series para un suceso que idealmente no pasa
   * nunca, y el catálogo de telemetría justifica cada serie que existe.
   */
  illegalTransition(attempt: Parameters<InterbankTelemetry['illegalTransition']>[0]): void {
    this.log.warn('interbank receipt transition refused', {
      correlationId: attempt.correlationId,
      from: attempt.from,
      event: attempt.event,
    });
  }
}

/**
 * Los nombres que `docs/sre/telemetry-catalog.md` §2.10 **reservó** para el
 * depósito saliente (T-47).
 *
 * Reservados y no inventados: el catálogo los fijó cuando T-58 inventarió las
 * señales, precisamente para que este ticket no eligiera otros y dejara los
 * paneles de T-50 mirando series que no existen. Si alguno cambiara aquí,
 * `metric-cardinality.spec.ts` y el catálogo lo dirían.
 */
export const SENT_COUNTER = 'bank.interbank.sent';
export const CONFIRMATION_HISTOGRAM = 'bank.interbank.confirmation.duration';

/**
 * Lo que mide el depósito que este banco ENVÍA.
 *
 * Separada de `OtelInterbankTelemetry`, que mide el entrante, porque §4.1 pide
 * la tasa de éxito «enviados y recibidos» como dos cosas: un solo contador con
 * una etiqueta `direction` las habría sumado en todo panel que olvidara
 * desglosarla, y el panel que importa el día de la calificación es justo el que
 * las separa.
 *
 * Las etiquetas son un conjunto cerrado —`result`— y nada más. El
 * `interbankTransferId` y el `transactionId` van al span y al log: una serie por
 * depósito es la cardinalidad que §4.1 prohíbe y que el catálogo justifica
 * fila por fila.
 */
export class OtelInterbankSendTelemetry implements InterbankSendTelemetry {
  readonly #sent: Counter;
  readonly #confirmation: Histogram;
  readonly #tracer: Tracer;

  constructor(
    readonly log: {
      info(message: string, fields: LogFields): void;
    },
  ) {
    const meter = metrics.getMeter('payment-service');

    this.#sent = meter.createCounter(SENT_COUNTER, {
      unit: '{deposit}',
      description: 'Deposits sent to the partner bank, by final result.',
    });
    this.#confirmation = meter.createHistogram(CONFIRMATION_HISTOGRAM, {
      unit: 's',
      description: 'Time from requesting a deposit to the partner bank deciding it.',
      /*
       * Denso alrededor de los cinco segundos, que es el umbral de la alerta
       * `PartnerBankConfirmationSlow` (T-50), y largo hasta pasado el
       * vencimiento de treinta: un histograma sólo puede responder «cuántas
       * bajo cinco segundos» si hay un límite exactamente ahí.
       */
      advice: { explicitBucketBoundaries: [0.25, 0.5, 1, 2, 3, 5, 10, 20, 30, 60] },
    });
    this.#tracer = trace.getTracer('payment-service');
  }

  stateChanged(change: Parameters<InterbankSendTelemetry['stateChanged']>[0]): void {
    const attributes = {
      'bank.correlation_id': change.correlationId,
      'bank.interbank.stage': change.state,
      'bank.transfer.id': change.transactionId,
      ...(change.reason === null ? {} : { 'bank.interbank.reason': change.reason }),
    };
    const span = this.#tracer.startSpan('payment.interbank send');
    span.setAttributes(attributes);
    span.addEvent(STATE_EVENT, attributes);
    span.end();

    this.log.info('interbank send state changed', {
      correlationId: change.correlationId,
      depositId: change.interbankTransferId,
      status: change.state,
      ...(change.reason === null ? {} : { reason: change.reason }),
      ...(change.durationMs === null ? {} : { durationMs: change.durationMs }),
    });

    /*
     * Qué cuenta en `bank_interbank_sent_total`, y con qué etiqueta (B9).
     *
     * - **`timeout`** se cuenta **al entrar** en `TIMEOUT`. Desde TD-095
     *   `isSendDecided` lo excluye —ya no es un veredicto, es una pregunta
     *   abierta— y por eso la serie `result="timeout"` dejó de subir, y con ella
     *   «el número de timeouts» que el enunciado pide expresamente y la regla
     *   `sli:interbank_sent_timeouts:rate5m`. Se cuenta la *entrada*, que es el
     *   suceso: que el banco pareja no contestó a tiempo.
     * - **`accepted` / `rejected`** se cuentan al decidirse, salvo cuando vienen
     *   de `TIMEOUT`: ese depósito ya contó como `timeout` y contarlo otra vez
     *   duplicaría el denominador de la tasa de éxito. Que un timeout se
     *   resolviera a favor o en contra queda en el log, el historial y el
     *   evento `payment.interbank.sent.v1`.
     * - `PENDING`, `SENT` y `REVERSED` no cuentan: son el depósito en vuelo y la
     *   constancia de una devolución de uno que ya se contó.
     *
     * Sin histograma para el timeout: su duración es el plazo (180 s), no una
     * latencia de confirmación, y el p95 que miden los paneles es el de los
     * depósitos que el banco pareja *sí* contestó.
     */
    const result = sentMetricResult(change.state, change.from);

    if (result !== null) {
      this.#sent.add(1, { result });

      if (result !== 'timeout' && change.durationMs !== null) {
        this.#confirmation.record(change.durationMs / 1000, { result });
      }
    }
  }
}
