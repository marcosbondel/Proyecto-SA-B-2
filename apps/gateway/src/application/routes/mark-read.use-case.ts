import { Inject, Injectable } from '@nestjs/common';
import { notificationMarkReadV1, notificationReadRepliedV1 } from '@bank/contracts';
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

export interface ReadResult {
  readonly changed: number;
  readonly unread: number;
  readonly correlationId: string;
}

/**
 * "Marcar como leída" — `N-01`'s only write.
 *
 * Synchronous, because the one thing the screen does next is redraw the unread
 * badge, and the reply carries the new count. A `202` here would mean asking a
 * second time for a number the write already knew.
 *
 * Whose notifications are being marked is decided by the owning service from
 * the envelope identity. The Gateway carries no `customerId` and could not: it
 * holds no notifications, so it has nothing to check an id against.
 */
@Injectable()
export class MarkNotificationsReadUseCase {
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
    readonly notificationIds?: readonly string[];
    readonly actor: Identity;
    readonly correlationId: string;
  }): Promise<ReadResult> {
    const payload =
      input.notificationIds === undefined ? {} : { notificationIds: [...input.notificationIds] };

    const parsed = notificationMarkReadV1.schema.safeParse(payload);

    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw GatewayError.validation(
        issue?.message ?? 'La solicitud no cumple el contrato.',
        issue?.path.join('.'),
      );
    }

    const answer = await askAndWait(
      this.#publisher,
      this.#replies,
      envelopeForRequest(
        parsed.data,
        notificationMarkReadV1.name,
        input.actor,
        input.correlationId,
      ),
    );

    const replied = notificationReadRepliedV1.schema.safeParse(answer.payload);

    if (answer.messageType !== notificationReadRepliedV1.name || !replied.success) {
      throw GatewayError.internal();
    }

    return { ...replied.data, correlationId: input.correlationId };
  }
}
