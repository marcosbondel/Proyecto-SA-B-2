import {
  accountCreditRejectedV1,
  accountCreditedV1,
  accountDebitCompensatedV1,
  accountDebitRejectedV1,
  accountDebitedV1,
  customerKycCheckedV1,
  paymentAttemptFailedV1,
  paymentFailedV1,
  paymentSucceededV1,
  transactionListQueryV1,
  transactionStatsQueryV1,
  transactionStatusRequestedV1,
  transferRequestedV1,
} from '@bank/contracts';
import type { MessageEnvelope } from '@bank/contracts';

import type { AdvanceSagaUseCase } from '../application/advance-saga.use-case';
import type { GetTransactionStatusUseCase } from '../application/get-transaction-status.use-case';
import type { GetTransactionStatsUseCase } from '../application/get-transaction-stats.use-case';
import type { ListTransactionsUseCase } from '../application/list-transactions.use-case';
import type { RecordPaymentAttemptUseCase } from '../application/record-payment-attempt.use-case';
import type { RequestTransferUseCase } from '../application/request-transfer.use-case';
import type { SagaEvent } from '../domain/transaction';
import type { InboundMessageHandler } from './inbound-message.handler';
import type { StructuredLogger } from './logging';

/**
 * The twelve messages this service answers, each parsed before it is believed.
 *
 * Parsing at the edge is not ceremony. The broker hands over whatever was
 * published, and a payload that does not match its contract is a message this
 * service cannot act on — failing here names the contract and the field, while
 * failing three layers down names a property of `undefined`.
 *
 * **Eight of the twelve are the same handler.** Every Saga event does exactly one
 * thing: name itself in the domain's vocabulary and hand the transaction id to
 * the state machine. Writing them as eight classes would be eight places to
 * forget the deduplication or the lock, so there is one class and eight
 * descriptions, and the part that actually differs between them — which
 * transitions are legal — lives in `domain/transaction.ts` where it is tested
 * without a database.
 */

/** How a Saga message names itself in the domain's own words. */
interface SagaBinding<TPayload> {
  readonly messageType: string;
  readonly parse: (payload: unknown) => TPayload;
  readonly read: (payload: TPayload) => {
    readonly transactionId: string;
    readonly event: SagaEvent;
  };
}

/**
 * One inbound Saga event, applied.
 *
 * Nothing here throws for a business outcome. A duplicate, an unknown
 * transaction and an illegal transition are all normal in a distributed system
 * with retries; throwing would send each of them down the retry ladder to
 * produce the identical answer three more times and then land in the
 * dead-letter queue, where somebody would investigate correct behaviour.
 *
 * A **broken** message is different and does throw: `parse` rejects a payload
 * that does not satisfy its contract, and that genuinely is a fault worth
 * retrying and then quarantining.
 */
export class SagaEventHandler<TPayload> implements InboundMessageHandler {
  public readonly messageType: string;
  readonly #binding: SagaBinding<TPayload>;
  readonly #useCase: AdvanceSagaUseCase;
  readonly #logger: StructuredLogger;

  constructor(
    binding: SagaBinding<TPayload>,
    useCase: AdvanceSagaUseCase,
    logger: StructuredLogger,
  ) {
    this.messageType = binding.messageType;
    this.#binding = binding;
    this.#useCase = useCase;
    this.#logger = logger;
  }

  public async handle(envelope: MessageEnvelope<unknown>): Promise<void> {
    const payload = this.#binding.parse(envelope.payload);
    const { transactionId, event } = this.#binding.read(payload);

    const outcome = await this.#useCase.execute({
      transactionId,
      event,
      messageId: envelope.messageId,
      messageType: envelope.messageType,
      payload,
    });

    const fields = {
      correlationId: envelope.correlationId,
      messageType: envelope.messageType,
      transactionId,
    };

    switch (outcome.kind) {
      case 'APPLIED':
        this.#logger.info('saga advanced', {
          ...fields,
          status: outcome.transition.status,
          outcome: outcome.transition.command ?? 'no further command',
          ...(outcome.transition.failureReason === null
            ? {}
            : { reason: outcome.transition.failureReason }),
        });

        return;

      case 'DUPLICATE':
        // T-5. Worth a line: a burst of these is the retry ladder working, and
        // a steady trickle is a producer publishing twice.
        this.#logger.info('event already applied', { ...fields, outcome: 'duplicate' });

        return;

      case 'UNKNOWN_TRANSACTION':
        this.#logger.warn('event for an unknown transaction', {
          ...fields,
          outcome: 'ignored',
        });

        return;

      case 'ILLEGAL':
        /**
         * T-6, and the reason this is a warning rather than an error: the state
         * was not corrupted, it was defended. What deserves attention is the
         * pattern, not the instance.
         */
        this.#logger.warn('illegal transition discarded', {
          ...fields,
          status: outcome.from,
          outcome: 'discarded',
          reason: 'ILLEGAL_TRANSITION',
        });

        return;
    }
  }
}

/**
 * The eight Saga events, in the order the choreography produces them.
 *
 * Reading this list top to bottom is reading `docs/domain/use-cases.md` §6,
 * as amended by T-31: the KYC gate, then debit, then payment, then credit,
 * with the three rejections and the compensation that close the flows that
 * do not complete.
 *
 * They are built into handlers here rather than returned as descriptions
 * because each one closes over a different payload type, and a list of
 * differently-typed descriptions is a list TypeScript can only hold by
 * forgetting what is in it.
 */
export function sagaHandlers(
  useCase: AdvanceSagaUseCase,
  logger: StructuredLogger,
): readonly InboundMessageHandler[] {
  const handler = <TPayload>(binding: SagaBinding<TPayload>): InboundMessageHandler =>
    new SagaEventHandler(binding, useCase, logger);

  return [
    handler({
      messageType: customerKycCheckedV1.name,
      parse: (payload) => customerKycCheckedV1.schema.parse(payload),
      read: (payload) => ({
        transactionId: payload.transactionId,
        event: payload.allowed
          ? { kind: 'KYC_APPROVED' }
          : { kind: 'KYC_REJECTED', reason: 'KYC_NOT_VERIFIED' },
      }),
    }),
    handler({
      messageType: accountDebitedV1.name,
      parse: (payload) => accountDebitedV1.schema.parse(payload),
      read: (payload) => ({
        transactionId: payload.transactionId,
        event: { kind: 'DEBITED' },
      }),
    }),
    handler({
      messageType: accountDebitRejectedV1.name,
      parse: (payload) => accountDebitRejectedV1.schema.parse(payload),
      read: (payload) => ({
        transactionId: payload.transactionId,
        event: { kind: 'DEBIT_REJECTED', reason: payload.reason },
      }),
    }),
    handler({
      messageType: paymentSucceededV1.name,
      parse: (payload) => paymentSucceededV1.schema.parse(payload),
      read: (payload) => ({
        transactionId: payload.transactionId,
        event: { kind: 'PAYMENT_SUCCEEDED' },
      }),
    }),
    handler({
      messageType: paymentFailedV1.name,
      parse: (payload) => paymentFailedV1.schema.parse(payload),
      read: (payload) => ({
        transactionId: payload.transactionId,
        event: { kind: 'PAYMENT_FAILED', reason: payload.failureReason },
      }),
    }),
    handler({
      messageType: accountCreditedV1.name,
      parse: (payload) => accountCreditedV1.schema.parse(payload),
      read: (payload) => ({
        transactionId: payload.transactionId,
        event: { kind: 'CREDITED' },
      }),
    }),
    handler({
      messageType: accountCreditRejectedV1.name,
      parse: (payload) => accountCreditRejectedV1.schema.parse(payload),
      read: (payload) => ({
        transactionId: payload.transactionId,
        event: { kind: 'CREDIT_REJECTED', reason: payload.reason },
      }),
    }),
    handler({
      messageType: accountDebitCompensatedV1.name,
      parse: (payload) => accountDebitCompensatedV1.schema.parse(payload),
      read: (payload) => ({
        transactionId: payload.transactionId,
        event: { kind: 'DEBIT_COMPENSATED' },
      }),
    }),
  ];
}

/**
 * `payment.attempt.failed.v1` — one rung of the retry ladder, recorded.
 *
 * Not a `SagaEventHandler` for the same reason `RequestTransferHandler` below
 * is not one: there is no transition here, so there is nothing for
 * `domain/transaction.ts` to decide and no `Transition` to log. `PAYMENT_PENDING`
 * stays `PAYMENT_PENDING` — only `payment.succeeded.v1` and `payment.failed.v1`
 * ever close the payment step, exactly as `routing/topology.ts` documents on
 * this binding.
 */
export class PaymentAttemptFailedHandler implements InboundMessageHandler {
  public readonly messageType = paymentAttemptFailedV1.name;
  readonly #useCase: RecordPaymentAttemptUseCase;
  readonly #logger: StructuredLogger;

  constructor(useCase: RecordPaymentAttemptUseCase, logger: StructuredLogger) {
    this.#useCase = useCase;
    this.#logger = logger;
  }

  public async handle(envelope: MessageEnvelope<unknown>): Promise<void> {
    const payload = paymentAttemptFailedV1.schema.parse(envelope.payload);

    const outcome = await this.#useCase.execute(payload, {
      messageId: envelope.messageId,
      messageType: envelope.messageType,
      correlationId: envelope.correlationId,
    });

    const fields = {
      correlationId: envelope.correlationId,
      messageType: envelope.messageType,
      transactionId: payload.transactionId,
    };

    switch (outcome.kind) {
      case 'RECORDED':
        this.#logger.info('payment attempt recorded', {
          ...fields,
          outcome: `attempt ${String(payload.attempt)}, ${payload.willRetry ? 'retrying' : 'exhausted'}`,
        });

        return;

      case 'DUPLICATE':
        this.#logger.info('payment attempt already recorded', { ...fields, outcome: 'duplicate' });

        return;

      case 'UNKNOWN_TRANSACTION':
        this.#logger.warn('payment attempt for an unknown transaction', {
          ...fields,
          outcome: 'ignored',
        });

        return;
    }
  }
}

/**
 * Step 1 of the Saga, and the only inbound message that creates anything.
 *
 * It is not a `SagaEventHandler` because it is not a transition: there is no
 * transaction to lock, no previous state to check, and the invariants it
 * enforces (T-1 to T-4) are about the request rather than about the machine.
 */
export class RequestTransferHandler implements InboundMessageHandler {
  public readonly messageType = transferRequestedV1.name;
  readonly #useCase: RequestTransferUseCase;
  readonly #logger: StructuredLogger;

  constructor(useCase: RequestTransferUseCase, logger: StructuredLogger) {
    this.#useCase = useCase;
    this.#logger = logger;
  }

  public async handle(envelope: MessageEnvelope<unknown>): Promise<void> {
    const payload = transferRequestedV1.schema.parse(envelope.payload);

    const outcome = await this.#useCase.execute(payload, {
      messageId: envelope.messageId,
      correlationId: envelope.correlationId,
      idempotencyKey: envelope.idempotencyKey,
      identity: envelope.identity,
      occurredAt: envelope.occurredAt,
    });

    const fields = {
      correlationId: envelope.correlationId,
      messageType: envelope.messageType,
      transactionId: payload.transactionId,
    };

    if (outcome.kind === 'REFUSED') {
      this.#logger.warn('transfer refused', {
        ...fields,
        outcome: 'refused',
        reason: outcome.reason,
      });

      return;
    }

    this.#logger.info(
      outcome.kind === 'STARTED' ? 'transfer accepted' : 'transfer already accepted',
      {
        ...fields,
        outcome: outcome.kind === 'STARTED' ? 'saga started' : 'idempotent retry',
        status: outcome.transaction.status,
      },
    );
  }
}

/**
 * The query, and the one message here that is **not** idempotency-guarded.
 *
 * A query changes nothing, and a redelivery must produce a fresh reply rather
 * than a silence that leaves the Gateway waiting out its five seconds and the
 * caller reading a timeout for a transfer that completed.
 */
export class TransactionStatusHandler implements InboundMessageHandler {
  public readonly messageType = transactionStatusRequestedV1.name;
  readonly #useCase: GetTransactionStatusUseCase;

  constructor(useCase: GetTransactionStatusUseCase) {
    this.#useCase = useCase;
  }

  public async handle(envelope: MessageEnvelope<unknown>): Promise<void> {
    await this.#useCase.execute(
      transactionStatusRequestedV1.schema.parse(envelope.payload),
      // The identity is what makes the ownership check possible (TD-035).
      envelope.identity,
    );
  }
}

/**
 * The listing, the second query and the second unguarded message, for the same
 * reason as the first.
 *
 * Its scope is decided from the envelope identity inside the use case and never
 * from the payload — see `ListTransactionsUseCase`.
 */
export class TransactionListHandler implements InboundMessageHandler {
  public readonly messageType = transactionListQueryV1.name;
  readonly #useCase: ListTransactionsUseCase;

  constructor(useCase: ListTransactionsUseCase) {
    this.#useCase = useCase;
  }

  public async handle(envelope: MessageEnvelope<unknown>): Promise<void> {
    await this.#useCase.execute(
      transactionListQueryV1.schema.parse(envelope.payload),
      envelope.identity,
    );
  }
}

/**
 * `transaction.stats.query.v1` — the dashboard's counts, and the third
 * unguarded message here for the reason the other two are: a query changes
 * nothing, and a redelivery must produce a fresh reply rather than a silence
 * that leaves the Gateway waiting out its five seconds.
 */
export class TransactionStatsHandler implements InboundMessageHandler {
  public readonly messageType = transactionStatsQueryV1.name;
  readonly #useCase: GetTransactionStatsUseCase;

  constructor(useCase: GetTransactionStatsUseCase) {
    this.#useCase = useCase;
  }

  public async handle(envelope: MessageEnvelope<unknown>): Promise<void> {
    transactionStatsQueryV1.schema.parse(envelope.payload);

    await this.#useCase.execute(envelope.identity);
  }
}

