import { Inject, Injectable } from '@nestjs/common';
import {
  accountStatsQueryV1,
  accountStatsRepliedV1,
  auditStatsQueryV1,
  auditStatsRepliedV1,
  customerStatsQueryV1,
  customerStatsRepliedV1,
  paymentStatsQueryV1,
  paymentStatsRepliedV1,
  transactionStatsQueryV1,
  transactionStatsRepliedV1,
} from '@bank/contracts';
import type { Identity } from '@bank/contracts';

import {
  MESSAGE_PUBLISHER,
  REPLY_WAITER,
  type MessagePublisherPort,
  type ReplyWaiterPort,
} from '../ports';
import { askAndWait } from '../request-reply';
import { envelopeForRequest } from '../request-envelope';

/**
 * `D-01` and `D-02`, composed from five services that each count their own rows.
 *
 * This is the Gateway doing the one thing an entry point is for: holding five
 * replies at once. It computes nothing — every number here was counted by the
 * service that owns the table it came from, which is the only place it *can* be
 * counted, since no service may read another's database (§8.2, 2.3).
 *
 * **Every section is independently optional.** The five questions go out
 * together and each answer is taken if it arrives; a service that is restarting
 * leaves its tile blank instead of failing the screen. A dashboard that goes
 * dark because Payment Service is redeploying is worse than one with a gap, and
 * this is the screen most likely to be open when something is wrong.
 *
 * Who may see what is decided by each owning service from the envelope
 * identity, and each answers a client with zeroes rather than a refusal — so a
 * `CLIENTE` reaching this route gets a dashboard of nothing rather than an
 * error, and no role check lives here.
 */
@Injectable()
export class DashboardUseCase {
  readonly #publisher: MessagePublisherPort;
  readonly #replies: ReplyWaiterPort;

  constructor(
    @Inject(MESSAGE_PUBLISHER) publisher: MessagePublisherPort,
    @Inject(REPLY_WAITER) replies: ReplyWaiterPort,
  ) {
    this.#publisher = publisher;
    this.#replies = replies;
  }

  public async execute(input: {
    readonly actor: Identity;
    readonly correlationId: string;
  }): Promise<Record<string, unknown>> {
    const [customers, accounts, transfers, payments, audit] = await Promise.all([
      this.#section(customerStatsQueryV1.name, customerStatsRepliedV1, input),
      this.#section(accountStatsQueryV1.name, accountStatsRepliedV1, input),
      this.#section(transactionStatsQueryV1.name, transactionStatsRepliedV1, input),
      this.#section(paymentStatsQueryV1.name, paymentStatsRepliedV1, input),
      this.#section(auditStatsQueryV1.name, auditStatsRepliedV1, input),
    ]);

    return {
      customers,
      accounts,
      transfers,
      payments,
      audit,
      correlationId: input.correlationId,
    };
  }

  /**
   * One question, on **its own correlation**, and `null` for every way it can
   * fail.
   *
   * The correlation matters and is the one surprise here. Five questions go out
   * at once and the reply registry keys a waiter by correlation id, so five
   * concurrent waits on the request's single correlation would collide — one
   * answer settling somebody else's wait. Each question is therefore its own
   * correlation root, which is what `envelopeForRequest` does when it is given
   * none.
   *
   * Nothing is lost by that. Constitution VIII's rule is that a *flow* keeps
   * one correlation; five independent counts are five flows, none of them
   * changes anything, and the request's own correlation still travels back in
   * the response for an operator to follow.
   *
   * A timeout, a broker that is away, a reply that does not match its contract
   * — all three mean the same thing to this screen: that tile has no number
   * right now. Distinguishing them here would put five error states on a
   * dashboard, and the correlation id in the response is what an operator
   * actually follows when a tile is blank.
   */
  async #section<
    TSchema extends { safeParse: (value: unknown) => { success: boolean; data?: unknown } },
  >(
    messageType: string,
    reply: { readonly name: string; readonly schema: TSchema },
    input: { readonly actor: Identity; readonly correlationId: string },
  ): Promise<unknown> {
    try {
      const answer = await askAndWait(
        this.#publisher,
        this.#replies,
        envelopeForRequest({}, messageType, input.actor),
        'read',
      );

      if (answer.messageType !== reply.name) {
        return null;
      }

      const parsed = reply.schema.safeParse(answer.payload);

      return parsed.success ? (parsed.data ?? null) : null;
    } catch {
      return null;
    }
  }
}
