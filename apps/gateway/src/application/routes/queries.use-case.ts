import { Inject, Injectable } from '@nestjs/common';
import {
  accountBalanceQueryV1,
  accountBalanceRepliedV1,
  auditQueryRepliedV1,
  auditQueryRequestedV1,
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

/**
 * The three questions whose answers the caller waits for.
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
