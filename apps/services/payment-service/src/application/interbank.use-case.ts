import {
  accountInterbankCreditRequestedV1,
  accountInterbankEligibilityQueryV1,
  paymentInterbankAcceptedV1,
  paymentInterbankRejectedV1,
} from '@bank/contracts';
import type {
  AccountInterbankCreditRejectedV1,
  AccountInterbankCreditedV1,
  AccountInterbankEligibilityRepliedV1,
  MessageEnvelope,
  PaymentInterbankReceiveV1,
} from '@bank/contracts';

import { validateIncoming } from '../domain/interbank';
import {
  accountReferenceOf,
  answersAbout,
  applyInterbankReceipt,
  IllegalInterbankReceiptTransition,
} from '../domain/interbank-receipt';
import type { InterbankReceiptEvent, InterbankReceiptRejection } from '../domain/interbank-receipt';

import type {
  InterbankDeposit,
  InterbankMessenger,
  InterbankRepository,
  InterbankTelemetry,
  PartnerCallback,
} from './interbank.ports';

/**
 * El conjunto cerrado de motivos vive en el dominio desde T-56; aquí queda el
 * alias para no cambiar las firmas de medio archivo.
 */
type Reason = InterbankReceiptRejection;

/** «Un máximo de 24 horas» de reintentos del callback, que fija el contrato. */
const CALLBACK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** A persisted incoming deposit; every external effect is driven from a database row. */
export class InterbankUseCase {
  constructor(
    readonly deps: {
      repository: InterbankRepository;
      messenger: InterbankMessenger;
      callback: PartnerCallback;
      bankCode: string;
      partnerBankCode: string;
      maxAmountMinor: number;
      clock: { now(): Date };
      telemetry: InterbankTelemetry;
      trace: {
        continue<T>(
          traceparent: string | null,
          spanName: string,
          correlationId: string,
          work: () => Promise<T>,
        ): Promise<T>;
      };
    },
  ) {}

  async receive(envelope: MessageEnvelope<unknown>): Promise<void> {
    const payload = envelope.payload as PaymentInterbankReceiveV1;
    /*
     * Dos rechazos antes de molestar a Account, y el segundo es de T-56: una
     * referencia que no puede ser ni un UUID ni un número de cuenta no se le
     * pregunta a nadie — sería un viaje por el broker para que contestara lo
     * que ya se sabe. Lo que sí hace es entrar, registrarse y **contestarse**,
     * que es la diferencia entre interoperar y devolver un `400`.
     */
    const reason: Reason | null =
      validateIncoming(payload, this.deps) ??
      (accountReferenceOf(payload.accountId) === null ? 'ACCOUNT_NOT_FOUND' : null);
    const result = reason === null ? null : this.#result(envelope, payload.depositId, reason);
    const opened = await this.deps.repository.open({
      origin: envelope as MessageEnvelope<PaymentInterbankReceiveV1>,
      stage: reason === null ? 'ELIGIBILITY' : 'REJECTED',
      reason,
      result,
      now: this.deps.clock.now(),
    });
    if (opened.kind === 'DUPLICATE') {
      await this.deps.repository.replayCallback(opened.depositId, this.deps.clock.now());
    } else if (opened.kind === 'CONFLICT') {
      // The original row keeps its sole credit. This refusal and callback have
      // their own durable receipt, keyed by this delivery's message id.
      const inserted = await this.deps.repository.recordConflict(
        envelope as MessageEnvelope<PaymentInterbankReceiveV1>,
        this.#result(envelope, payload.depositId, 'IDEMPOTENCY_CONFLICT'),
        this.deps.clock.now(),
      );
      if (inserted)
        this.#state(
          payload.depositId,
          envelope.correlationId,
          'REJECTED',
          'IDEMPOTENCY_CONFLICT',
          0,
        );
    } else {
      this.#state(
        payload.depositId,
        envelope.correlationId,
        reason === null ? 'ELIGIBILITY' : 'REJECTED',
        reason,
        reason === null ? null : 0,
      );
    }
  }

  async eligibility(
    envelope: MessageEnvelope<unknown>,
    answer: AccountInterbankEligibilityRepliedV1,
  ): Promise<void> {
    const found = await this.deps.repository.find(answer.depositId);
    if (found?.stage !== 'ELIGIBILITY' || !answersAbout(found.accountRef, answer)) return;
    /*
     * Un depósito cuya elegibilidad se contesta **después de `expiresAt`** no
     * ordena el crédito: se rechaza con `EXPIRED`. Es el otro lado de B4 — el
     * vencimiento ya no puede alcanzar a un depósito en `CREDIT`, así que la
     * puerta que impide acreditar tarde tiene que estar antes de entrar.
     */
    const vencido = found.expiresAt !== null && found.expiresAt <= this.deps.clock.now();
    const paso = this.#transition(
      found.stage,
      {
        kind: 'ELIGIBILITY_ANSWERED',
        rejection: answer.eligible ? (vencido ? 'EXPIRED' : null) : answer.reason,
      },
      found.origin.correlationId,
    );
    if (paso === null) return;

    const changed = await this.deps.repository.advance({
      depositId: answer.depositId,
      from: 'ELIGIBILITY',
      to: paso.state,
      reason: paso.rejection,
      result: paso.decided ? this.#result(envelope, answer.depositId, paso.rejection) : null,
      now: this.deps.clock.now(),
    });
    if (changed)
      this.#state(
        answer.depositId,
        found.origin.correlationId,
        paso.state,
        paso.rejection,
        this.#duration(found),
      );
  }

  async credited(
    envelope: MessageEnvelope<unknown>,
    answer: AccountInterbankCreditedV1,
  ): Promise<void> {
    const found = await this.deps.repository.find(answer.depositId);
    if (found?.stage !== 'CREDIT' || !answersAbout(found.accountRef, answer)) return;
    const paso = this.#transition(
      found.stage,
      { kind: 'CREDITED' },
      found.origin.correlationId,
    );
    if (paso === null) return;

    const changed = await this.deps.repository.advance({
      depositId: answer.depositId,
      from: 'CREDIT',
      to: paso.state,
      reason: paso.rejection,
      result: this.#result(envelope, answer.depositId, paso.rejection),
      now: this.deps.clock.now(),
    });
    if (changed)
      this.#state(
        answer.depositId,
        found.origin.correlationId,
        paso.state,
        paso.rejection,
        this.#duration(found),
      );
  }

  async creditRejected(
    envelope: MessageEnvelope<unknown>,
    answer: AccountInterbankCreditRejectedV1,
  ): Promise<void> {
    const found = await this.deps.repository.find(answer.depositId);
    if (found?.stage !== 'CREDIT' || !answersAbout(found.accountRef, answer)) return;
    const paso = this.#transition(
      found.stage,
      { kind: 'CREDIT_REFUSED', rejection: answer.reason },
      found.origin.correlationId,
    );
    if (paso === null) return;

    const changed = await this.deps.repository.advance({
      depositId: answer.depositId,
      from: 'CREDIT',
      to: paso.state,
      reason: paso.rejection,
      result: this.#result(envelope, answer.depositId, paso.rejection),
      now: this.deps.clock.now(),
    });
    if (changed)
      this.#state(
        answer.depositId,
        found.origin.correlationId,
        paso.state,
        paso.rejection,
        this.#duration(found),
      );
  }

  /**
   * La vuelta del barrido: acciones pendientes, resultados, callbacks.
   *
   * **Cada paso, y cada depósito dentro de un paso, falla por su cuenta** (B3).
   * Antes un solo depósito que lanzaba —el `payload` inexistente de una fila del
   * contrato oficial— cortaba la vuelta entera con una excepción que el
   * llamador sólo registraba: los resultados y los callbacks de todos los demás
   * depósitos esperaban a que la fila mala se arreglara sola, que no ocurría
   * nunca. Ahora la fila mala se registra con su correlación y la vuelta sigue.
   *
   * Seguro porque cada paso es idempotente y está respaldado por una columna: lo
   * que no se hizo en esta vuelta se vuelve a encontrar en la siguiente.
   */
  async sweep(limit = 20): Promise<void> {
    const now = this.deps.clock.now();

    for (const deposit of await this.#step('claimActions', () =>
      this.deps.repository.claimActions(now, limit),
    )) {
      await this.#run(
        'sendAction',
        () =>
          this.deps.trace.continue(
            deposit.traceContext,
            'payment.interbank.action',
            deposit.correlationId,
            () => this.#sendAction(deposit),
          ),
        deposit.correlationId,
      );
    }

    await this.#run('publishResults', () =>
      this.deps.repository.publishResults((event) => this.deps.messenger.publishStored(event), limit),
    );
    await this.#run('publishConflictResults', () =>
      this.deps.repository.publishConflictResults(
        (event) => this.deps.messenger.publishStored(event),
        limit,
      ),
    );

    for (const deposit of await this.#step('claimCallbacks', () =>
      this.deps.repository.claimCallbacks(now, limit),
    )) {
      await this.#deliverCallback(
        deposit,
        'payment.interbank.callback',
        async () => await this.deps.repository.markCallbackDelivered(deposit.depositId, this.deps.clock.now()),
      );
    }

    for (const { messageId, deposit } of await this.#step('claimConflictCallbacks', () =>
      this.deps.repository.claimConflictCallbacks(now, limit),
    )) {
      await this.#deliverCallback(
        deposit,
        'payment.interbank.conflict.callback',
        async () =>
          await this.deps.repository.markConflictCallbackDelivered(messageId, this.deps.clock.now()),
      );
    }

    /*
     * Pasadas 24 horas desde la decisión, el contrato libera al receptor de
     * seguir insistiendo con el callback. Abandonarlo es una decisión que se
     * deja a la vista, en ERROR, porque significa que un emisor nunca se enteró.
     */
    const abandonados = await this.#step('abandonStaleCallbacks', () =>
      this.deps.repository.abandonStaleCallbacks(this.deps.clock.now(), CALLBACK_MAX_AGE_MS),
    );
    for (const deposit of abandonados) {
      this.deps.telemetry.sweepFailed({
        step: 'callbackAbandoned',
        correlationId: deposit.correlationId,
        error: `El callback de ${deposit.externalTransferId} no se entregó en 24 horas y se abandona.`,
      });
    }
  }

  /** Un paso del barrido que devuelve filas: si lanza, se registra y no hay filas. */
  async #step<T>(
    step: string,
    work: () => Promise<readonly T[]>,
    correlationId = 'sweep',
  ): Promise<readonly T[]> {
    try {
      return await work();
    } catch (error) {
      this.#failed(step, correlationId, error);

      return [];
    }
  }

  /** Un paso del barrido cuyo resultado no importa: si lanza, se registra. */
  async #run(
    step: string,
    work: () => Promise<unknown>,
    correlationId = 'sweep',
  ): Promise<void> {
    try {
      await work();
    } catch (error) {
      this.#failed(step, correlationId, error);
    }
  }

  #failed(step: string, correlationId: string, error: unknown): void {
    this.deps.telemetry.sweepFailed({
      step,
      correlationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  async #deliverCallback(
    deposit: InterbankDeposit,
    spanName: string,
    markDelivered: () => Promise<void>,
  ): Promise<void> {
    try {
      await this.deps.trace.continue(deposit.traceContext, spanName, deposit.correlationId, () =>
        this.deps.callback.deliver(deposit),
      );
      await markDelivered();
      this.deps.telemetry.callbackAttempt({
        correlationId: deposit.correlationId,
        result: 'delivered',
      });
    } catch (error) {
      this.deps.telemetry.callbackAttempt({
        correlationId: deposit.correlationId,
        result: 'failed',
        detail: error instanceof Error ? error.message : String(error),
      });
      // La fila ya tiene su próxima hora. Un barrido posterior lo reintenta.
    }
  }

  /**
   * La transición, decidida por el dominio y no aquí (T-56).
   *
   * Devuelve `null` cuando el diagrama no tiene esa transición. Que una
   * incoherencia **se vea** y no se escriba es la razón de que la función pura
   * lance: un mensaje fuera de orden —la confirmación de un crédito que nunca
   * se ordenó, una elegibilidad para un depósito ya decidido— no es un caso
   * que absorber. Se registra y se descarta, y no toca el estado.
   */
  #transition(
    from: InterbankDeposit['stage'],
    event: InterbankReceiptEvent,
    correlationId: string,
  ): ReturnType<typeof applyInterbankReceipt> | null {
    try {
      return applyInterbankReceipt(from, event);
    } catch (error) {
      if (error instanceof IllegalInterbankReceiptTransition) {
        this.deps.telemetry.illegalTransition({ correlationId, from, event: event.kind });
        return null;
      }
      throw error;
    }
  }

  #duration(deposit: InterbankDeposit): number {
    return Math.max(0, this.deps.clock.now().getTime() - deposit.createdAt.getTime());
  }

  #state(
    depositId: string,
    correlationId: string,
    stage: InterbankDeposit['stage'],
    reason: string | null,
    durationMs: number | null,
  ): void {
    this.deps.telemetry.stateChanged({ depositId, correlationId, stage, reason, durationMs });
  }

  #result(
    cause: MessageEnvelope<unknown>,
    depositId: string,
    reason: Reason | null,
  ): MessageEnvelope<unknown> {
    const decidedAt = this.deps.clock.now().toISOString();
    return reason === null
      ? this.deps.messenger.result(cause, paymentInterbankAcceptedV1.name, { depositId, decidedAt })
      : this.deps.messenger.result(cause, paymentInterbankRejectedV1.name, {
          depositId,
          reason,
          decidedAt,
        });
  }

  async #sendAction(deposit: InterbankDeposit): Promise<void> {
    /*
     * Todo sale de las columnas del depósito y no del sobre (B3). La cuenta se
     * nombra a Account por lo que ella entiende: el UUID del camino provisional
     * o el número `02-…` del contrato.
     */
    const reference = accountReferenceOf(deposit.accountRef);

    if (reference === null) {
      throw new Error(`La cuenta "${deposit.accountRef}" no puede ser de ninguna cuenta de este banco.`);
    }

    if (deposit.stage === 'ELIGIBILITY') {
      await this.deps.messenger.command(deposit.origin, accountInterbankEligibilityQueryV1.name, {
        depositId: deposit.depositId,
        ...reference,
      });
    } else if (deposit.stage === 'CREDIT') {
      await this.deps.messenger.command(deposit.origin, accountInterbankCreditRequestedV1.name, {
        depositId: deposit.depositId,
        ...reference,
        amount: deposit.amount,
      });
    }
  }
}
