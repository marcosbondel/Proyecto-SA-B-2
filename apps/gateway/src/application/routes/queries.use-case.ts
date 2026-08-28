import { Inject, Injectable } from '@nestjs/common';
import {
  accountBalanceQueryV1,
  accountBalanceRepliedV1,
  accountListQueryV1,
  accountListRepliedV1,
  accountOperationsQueryV1,
  accountOperationsRepliedV1,
  auditQueryRepliedV1,
  auditQueryRequestedV1,
  customerGetQueryV1,
  customerGetRepliedV1,
  customerPendingValidationQueryV1,
  customerPendingValidationRepliedV1,
  notificationListQueryV1,
  notificationListRepliedV1,
  paymentListQueryV1,
  paymentListRepliedV1,
  paymentStatusQueryV1,
  paymentStatusRepliedV1,
  transactionStatusRepliedV1,
  transactionStatusRequestedV1,
} from '@bank/contracts';
import type { Identity } from '@bank/contracts';

import { GatewayError } from '../errors/gateway-error';
import {
  MESSAGE_PUBLISHER,
  REPLY_WAITER,
  type MessagePublisherPort,
  type ReplyWaiterPort,
} from '../ports';
import { askAndWait } from '../request-reply';
import { envelopeForRequest } from '../request-envelope';

export interface QueryContext {
  readonly actor: Identity;
  readonly correlationId: string;
}

/** What a listing may be narrowed by. Every field optional, none of them a permission. */
export interface AccountListFilter {
  readonly customerId?: string;
  readonly status?: 'ACTIVE' | 'INACTIVE';
  readonly accountType?: 'MONETARIA' | 'AHORRO';
}

/** What a notifications listing may be narrowed by. None of these is a permission. */
export interface NotificationListFilter {
  readonly correlationId?: string;
  readonly status?: 'PENDING' | 'SENT' | 'FAILED';
  readonly type?: string;
  readonly limit?: number;
}

/** What a payment listing may be narrowed by. None of these is a permission. */
export interface PaymentListFilter {
  readonly transactionId?: string;
  readonly status?: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  readonly errorType?: 'TRANSIENT' | 'PERMANENT';
}

/**
 * The seven questions whose answers the caller waits for.
 *
 * Each one publishes a command, waits at most five seconds, and hands back
 * whatever the owning service said — including its refusal. The gateway does
 * not compute a balance, does not decide whether a transaction exists, and does
 * not soften a `NOT_FOUND` into something friendlier: reinterpreting a verdict
 * is how an entry point becomes an author of business decisions.
 */
@Injectable()
export class QueriesUseCase {
  readonly #publisher: MessagePublisherPort;
  readonly #replies: ReplyWaiterPort;

  constructor(
    @Inject(MESSAGE_PUBLISHER) publisher: MessagePublisherPort,
    @Inject(REPLY_WAITER) replies: ReplyWaiterPort,
  ) {
    this.#publisher = publisher;
    this.#replies = replies;
  }

  public async balanceOf(
    accountId: string,
    context: QueryContext,
  ): Promise<Record<string, unknown>> {
    const raw = await this.#ask(accountBalanceQueryV1.name, { accountId }, context);
    const parsed = accountBalanceRepliedV1.schema.safeParse(raw);

    if (!parsed.success) {
      throw GatewayError.internal();
    }

    if (parsed.data.outcome === 'NOT_FOUND') {
      // The owning service's own code, carried untouched (FR-030).
      throw GatewayError.businessRejection(parsed.data.reason, 'La cuenta consultada no existe.');
    }

    return { ...parsed.data, correlationId: context.correlationId };
  }

  /** One customer's record, or the owning service's refusal, carried untouched. */
  public async getCustomer(
    customerId: string,
    context: QueryContext,
  ): Promise<Record<string, unknown>> {
    const raw = await this.#ask(customerGetQueryV1.name, { customerId }, context);
    const parsed = customerGetRepliedV1.schema.safeParse(raw);

    if (!parsed.success) {
      throw GatewayError.internal();
    }

    if (parsed.data.outcome === 'NOT_FOUND') {
      throw GatewayError.businessRejection(parsed.data.reason, 'El cliente consultado no existe.');
    }

    return { ...parsed.data, correlationId: context.correlationId };
  }

  /**
   * The customers awaiting an identity verdict. Staff work; a non-staff caller
   * gets an empty list from the owning service, not a distinguishable refusal.
   */
  public async pendingValidation(context: QueryContext): Promise<Record<string, unknown>> {
    const raw = await this.#ask(customerPendingValidationQueryV1.name, {}, context);
    const parsed = customerPendingValidationRepliedV1.schema.safeParse(raw);

    if (!parsed.success) {
      throw GatewayError.internal();
    }

    return { ...parsed.data, correlationId: context.correlationId };
  }

  /**
   * The accounts this caller may see.
   *
   * **No `NOT_FOUND` branch, on purpose.** An empty list is the whole answer,
   * and it means the same thing whether nothing exists or nothing is visible.
   * A gateway that distinguished them would hand back a way to discover which
   * accounts belong to somebody else.
   */
  public async accounts(
    filter: AccountListFilter,
    context: QueryContext,
  ): Promise<Record<string, unknown>> {
    const raw = await this.#ask(accountListQueryV1.name, filter, context);
    const parsed = accountListRepliedV1.schema.safeParse(raw);

    if (!parsed.success) {
      throw GatewayError.internal();
    }

    return { ...parsed.data, correlationId: context.correlationId };
  }

  /** The movements of one account, or the owning service's refusal, untouched. */
  public async operationsOf(
    accountId: string,
    context: QueryContext,
  ): Promise<Record<string, unknown>> {
    const raw = await this.#ask(accountOperationsQueryV1.name, { accountId }, context);
    const parsed = accountOperationsRepliedV1.schema.safeParse(raw);

    if (!parsed.success) {
      throw GatewayError.internal();
    }

    if (parsed.data.outcome === 'NOT_FOUND') {
      // The owning service's own code, carried untouched (FR-030).
      throw GatewayError.businessRejection(parsed.data.reason, 'La cuenta consultada no existe.');
    }

    return { ...parsed.data, correlationId: context.correlationId };
  }

  public async transactionStatus(
    transactionId: string,
    context: QueryContext,
  ): Promise<Record<string, unknown>> {
    const raw = await this.#ask(transactionStatusRequestedV1.name, { transactionId }, context);
    const parsed = transactionStatusRepliedV1.schema.safeParse(raw);

    if (!parsed.success) {
      throw GatewayError.internal();
    }

    if (parsed.data.outcome === 'NOT_FOUND') {
      // The reply carries no code for this case, so the gateway supplies the
      // nearest one from the catalogue rather than inventing a new vocabulary.
      throw GatewayError.businessRejection(
        'ILLEGAL_TRANSITION',
        'No existe una transacción con ese identificador.',
      );
    }

    return { ...parsed.data, correlationId: context.correlationId };
  }

  /**
   * The payments, as the monitoring screen reads them.
   *
   * No `NOT_FOUND` branch and no scope logic here, for the two different
   * reasons the two other listings give: an empty list is the whole answer,
   * and whatever narrowing is possible is Payment Service's to apply. What is
   * unusual about this one is that the owning service can narrow by almost
   * nothing — it holds a `transactionId` and no customer reference at all — so
   * the restriction that makes the route safe is the `@Roles` on the
   * controller, not an intersection here. Recorded as TD-037.
   */
  public async payments(
    filter: PaymentListFilter,
    context: QueryContext,
  ): Promise<Record<string, unknown>> {
    const raw = await this.#ask(paymentListQueryV1.name, filter, context);
    const parsed = paymentListRepliedV1.schema.safeParse(raw);

    if (!parsed.success) {
      throw GatewayError.internal();
    }

    return { ...parsed.data, correlationId: context.correlationId };
  }

  /**
   * One payment, with the rungs of its retry ladder.
   *
   * The reply carries no code for absence, so the gateway supplies the nearest
   * one from the catalogue rather than inventing a vocabulary — the same choice
   * `transactionStatus` makes two methods below, and made the same way so the
   * two cannot drift into answering differently for the same situation.
   */
  public async paymentStatus(
    paymentId: string,
    context: QueryContext,
  ): Promise<Record<string, unknown>> {
    const raw = await this.#ask(paymentStatusQueryV1.name, { paymentId }, context);
    const parsed = paymentStatusRepliedV1.schema.safeParse(raw);

    if (!parsed.success) {
      throw GatewayError.internal();
    }

    if (parsed.data.outcome === 'NOT_FOUND') {
      throw GatewayError.businessRejection(
        'ILLEGAL_TRANSITION',
        'No existe un pago con ese identificador.',
      );
    }

    return { ...parsed.data, correlationId: context.correlationId };
  }

  /**
   * The audit trail: how the frontend learns how any asynchronous command
   * ended. It is the reason a `202` is honest rather than a shrug.
   */
  public async audit(
    correlationId: string,
    context: QueryContext,
  ): Promise<Record<string, unknown>> {
    const raw = await this.#ask(auditQueryRequestedV1.name, { correlationId }, context);
    const parsed = auditQueryRepliedV1.schema.safeParse(raw);

    if (!parsed.success) {
      throw GatewayError.internal();
    }

    return { ...parsed.data, correlationId: context.correlationId };
  }

  /**
   * The notifications console: what the bank has told people, newest first.
   *
   * Added by T-20 and shaped exactly like `payments` above, for the same reason
   * and with the same gap: the owning service cannot narrow this by customer,
   * so the `@Roles('ADMINISTRADOR')` on the controller is what makes the route
   * safe rather than an intersection computed here. No `NOT_FOUND` branch — an
   * empty list is the whole answer.
   */
  public async notifications(
    filter: NotificationListFilter,
    context: QueryContext,
  ): Promise<Record<string, unknown>> {
    const raw = await this.#ask(notificationListQueryV1.name, filter, context);
    const parsed = notificationListRepliedV1.schema.safeParse(raw);

    if (!parsed.success) {
      throw GatewayError.internal();
    }

    return { ...parsed.data, correlationId: context.correlationId };
  }

  /**
   * Publishes the question and hands back the raw reply payload.
   *
   * Parsing is left to each caller so the reply's own schema types the result.
   * A shared generic here would have to widen the return type, and the widening
   * is exactly what lets an unparsed shape slip through to a browser.
   */
  async #ask(messageType: string, payload: unknown, context: QueryContext): Promise<unknown> {
    const reply = await askAndWait(
      this.#publisher,
      this.#replies,
      envelopeForRequest(payload, messageType, context.actor, context.correlationId),
    );

    return reply.payload;
  }
}
