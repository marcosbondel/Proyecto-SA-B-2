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
  applyInterbankReceipt,
  couldBeOurAccount,
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
     * referencia de cuenta que no puede ser un UUID de este banco no se le
     * pregunta a nadie — sería un viaje por el broker para que contestara lo
     * que ya se sabe. Lo que sí hace es entrar, registrarse y **contestarse**,
     * que es la diferencia entre interoperar y devolver un `400`.
     */
    const reason: Reason | null =
      validateIncoming(payload, this.deps) ??
      (couldBeOurAccount(payload.accountId) ? null : 'ACCOUNT_NOT_FOUND');
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
    if (found?.stage !== 'ELIGIBILITY' || found.origin.payload.accountId !== answer.accountId)
      return;
    const paso = this.#transition(
      found.stage,
      { kind: 'ELIGIBILITY_ANSWERED', rejection: answer.eligible ? null : answer.reason },
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
    if (found?.stage !== 'CREDIT' || found.origin.payload.accountId !== answer.accountId) return;
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
    if (found?.stage !== 'CREDIT' || found.origin.payload.accountId !== answer.accountId) return;
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

  /** Called by a lease guarded sweeper; commands and callbacks can be retried safely. */
  async sweep(limit = 20): Promise<void> {
    const now = this.deps.clock.now();
    for (const deposit of await this.deps.repository.claimActions(now, limit)) {
      await this.deps.trace.continue(
        deposit.traceContext,
        'payment.interbank.action',
        deposit.origin.correlationId,
        () => this.#sendAction(deposit),
      );
    }
    await this.deps.repository.publishResults(
      (event) => this.deps.messenger.publishStored(event),
      limit,
    );
    await this.deps.repository.publishConflictResults(
      (event) => this.deps.messenger.publishStored(event),
      limit,
    );
    for (const deposit of await this.deps.repository.claimCallbacks(now, limit)) {
      try {
        await this.deps.trace.continue(
          deposit.traceContext,
          'payment.interbank.callback',
          deposit.origin.correlationId,
          () => this.deps.callback.deliver(deposit),
        );
        await this.deps.repository.markCallbackDelivered(deposit.depositId, this.deps.clock.now());
        this.deps.telemetry.callbackAttempt({
          correlationId: deposit.origin.correlationId,
          result: 'delivered',
        });
      } catch {
        this.deps.telemetry.callbackAttempt({
          correlationId: deposit.origin.correlationId,
          result: 'failed',
        });
        // The row already has its next due time. A later sweep retries it.
      }
    }
    for (const { messageId, deposit } of await this.deps.repository.claimConflictCallbacks(
      now,
      limit,
    )) {
      try {
        await this.deps.trace.continue(
          deposit.traceContext,
          'payment.interbank.conflict.callback',
          deposit.origin.correlationId,
          () => this.deps.callback.deliver(deposit),
        );
        await this.deps.repository.markConflictCallbackDelivered(messageId, this.deps.clock.now());
        this.deps.telemetry.callbackAttempt({
          correlationId: deposit.origin.correlationId,
          result: 'delivered',
        });
      } catch {
        this.deps.telemetry.callbackAttempt({
          correlationId: deposit.origin.correlationId,
          result: 'failed',
        });
        // The database schedules another delivery.
      }
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
    const payload = deposit.origin.payload;
    if (deposit.stage === 'ELIGIBILITY') {
      await this.deps.messenger.command(deposit.origin, accountInterbankEligibilityQueryV1.name, {
        depositId: deposit.depositId,
        accountId: payload.accountId,
      });
    } else if (deposit.stage === 'CREDIT') {
      await this.deps.messenger.command(deposit.origin, accountInterbankCreditRequestedV1.name, {
        depositId: deposit.depositId,
        accountId: payload.accountId,
        amount: payload.amount,
      });
    }
  }
}
