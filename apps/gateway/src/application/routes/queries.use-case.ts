import { Inject, Injectable } from '@nestjs/common';
import {
  accountBalanceQueryV1,
  accountBillersQueryV1,
  accountBillersRepliedV1,
  accountBalanceRepliedV1,
  accountListQueryV1,
  accountListRepliedV1,
  accountOperationsQueryV1,
  accountOperationsRepliedV1,
  auditQueryRepliedV1,
  auditQueryRequestedV1,
  auditEventsListQueryV1,
  auditEventsListRepliedV1,
  customerGetQueryV1,
  customerGetRepliedV1,
  customerNamesQueryV1,
  customerNamesRepliedV1,
  MAX_NAME_LOOKUPS,
  customerPendingValidationQueryV1,
  customerPendingValidationRepliedV1,
  customerListQueryV1,
  customerListRepliedV1,
  notificationInboxQueryV1,
  notificationInboxRepliedV1,
  notificationListQueryV1,
  notificationListRepliedV1,
  paymentListQueryV1,
  paymentListRepliedV1,
  paymentStatusQueryV1,
  paymentStatusRepliedV1,
  transactionListQueryV1,
  transactionListRepliedV1,
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

/**
 * What a transfer listing may be narrowed by. None of these is a permission
 * either: Transaction Service intersects them with the scope it derives from
 * the envelope identity, so a client naming somebody else's `customerId` gets
 * an empty list rather than a `403`.
 */
export interface TransferListFilter {
  readonly customerId?: string;
  readonly accountId?: string;
  readonly status?: 'PENDING' | 'DEBITING' | 'PAYMENT_PENDING' | 'COMPLETED' | 'FAILED' | 'COMPENSATED';
  /** Fase 2's vocabulary (T-28) — a separate filter from `status`, see the DTO. */
  readonly phaseStatus?: 'PENDING' | 'APPROVED' | 'FAILED';
  readonly from?: string;
  readonly to?: string;
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
   * The list of registered customers. Staff only.
   */
  public async customerList(
    limit: number,
    context: QueryContext,
  ): Promise<Record<string, unknown>> {
    const raw = await this.#ask(customerListQueryV1.name, { limit }, context);
    const parsed = customerListRepliedV1.schema.safeParse(raw);

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

    const holders = await this.#holderNames(parsed.data.accounts, context);

    return {
      ...parsed.data,
      accounts: parsed.data.accounts.map((account) => ({
        ...account,
        // Absent rather than null-filled when the name is not available: a
        // screen can tell "we did not ask" from "there is no name", and the
        // table falls back to the identifier it already had.
        ...(holders.get(account.customerId) === undefined
          ? {}
          : { holderName: holders.get(account.customerId) }),
      })),
      correlationId: context.correlationId,
    };
  }

  /**
   * The holders' names for a listing, resolved in **one** extra round trip.
   *
   * This is the composition TD-026 needed and the reason it could not be done
   * anywhere else. Account Service holds an opaque `customerId` and may not read
   * Customer Service's database (§8.2, 2.3); Customer Service does not know what
   * an account is. The Gateway is the only component that may hold both replies
   * at once, and holding two replies is aggregation — it computes nothing,
   * decides nothing, and reinterprets nothing.
   *
   * It **never fails the listing**. A table of accounts with opaque ids is worse
   * than one with names and far better than an error page, so a refusal, a
   * timeout or a broker that is away all resolve to an empty map and the screen
   * shows what it already had. That is also what a `CLIENTE` gets: the owning
   * service answers them with an empty list by design, and their own listing is
   * their own accounts, where the holder is themselves.
   */
  async #holderNames(
    accounts: readonly { readonly customerId: string }[],
    context: QueryContext,
  ): Promise<ReadonlyMap<string, string>> {
    const customerIds = [...new Set(accounts.map((account) => account.customerId))].slice(
      0,
      MAX_NAME_LOOKUPS,
    );

    if (customerIds.length === 0) {
      return new Map();
    }

    try {
      const raw = await this.#ask(customerNamesQueryV1.name, { customerIds }, context);
      const parsed = customerNamesRepliedV1.schema.safeParse(raw);

      if (!parsed.success) {
        return new Map();
      }

      return new Map(parsed.data.names.map((name) => [name.customerId, name.fullName]));
    } catch {
      return new Map();
    }
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

  /**
   * The biller catalogue — `G-01`'s dropdown.
   *
   * The only query here that carries no filter and no scope: the list of
   * services the bank collects for is the same for everybody. What each entry
   * carries is the biller's **collection account**, because a service payment
   * is a transfer to it.
   */
  public async billers(context: QueryContext): Promise<Record<string, unknown>> {
    const raw = await this.#ask(accountBillersQueryV1.name, {}, context);
    const parsed = accountBillersRepliedV1.schema.safeParse(raw);

    if (!parsed.success) {
      throw GatewayError.internal();
    }

    return { ...parsed.data, correlationId: context.correlationId };
  }

  /** A page of transfers, already narrowed by the owning service (TD-033). */
  public async transfers(
    filter: TransferListFilter,
    context: QueryContext,
  ): Promise<Record<string, unknown>> {
    const raw = await this.#ask(transactionListQueryV1.name, filter, context);
    const parsed = transactionListRepliedV1.schema.safeParse(raw);

    if (!parsed.success) {
      throw GatewayError.internal();
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
      /*
       * A borrowed code, and an imperfect one. The catalogue has no
       * `TRANSACTION_NOT_FOUND` — only `ACCOUNT_NOT_FOUND`, `CUSTOMER_NOT_FOUND`
       * and `IDENTITY_OBJECT_NOT_FOUND` name a missing subject, and none of them
       * is true of a transaction. `ILLEGAL_TRANSITION` is the nearest existing
       * code rather than a fourth kept honest, which is why it carries `409`
       * here instead of the `404` this outcome actually is (see
       * `FAILURE_CODE_STATUS`). The message is accurate; the code and the
       * status it drives are not. Adding a real not-found code is `@bank/contracts`
       * work, not the gateway's to do unilaterally.
       */
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
      // Same borrowed code as `transactionStatus` above, for the same reason:
      // no `PAYMENT_NOT_FOUND` exists in the catalogue, so this reuses the
      // nearest one rather than inventing a fifth. `409`, not the `404` this
      // actually is — see the longer note on the transaction case.
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
   * The paginated list of recent audit events across flows. ADMINISTRADOR only.
   */
  public async auditEventsList(
    params: { page: number; limit: number },
    context: QueryContext,
  ): Promise<Record<string, unknown>> {
    const raw = await this.#ask(auditEventsListQueryV1.name, params, context);
    const parsed = auditEventsListRepliedV1.schema.safeParse(raw);

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
      'read',
    );

    return reply.payload;
  }

  /**
   * `N-01` — the signed-in customer's own notifications.
   *
   * A different question from `notifications()` above, which is the staff
   * console: that one carries the simulated recipient of every delivery in the
   * system and is restricted to `ADMINISTRADOR` for exactly that reason. This
   * one is scoped by the envelope's identity inside the owning service, and the
   * query carries no field that could point it at somebody else.
   */
  public async inbox(
    limit: number | undefined,
    context: QueryContext,
  ): Promise<Record<string, unknown>> {
    const raw = await this.#ask(
      notificationInboxQueryV1.name,
      limit === undefined ? {} : { limit },
      context,
    );
    const parsed = notificationInboxRepliedV1.schema.safeParse(raw);

    if (!parsed.success) {
      throw GatewayError.internal();
    }

    return { ...parsed.data, correlationId: context.correlationId };
  }
}
