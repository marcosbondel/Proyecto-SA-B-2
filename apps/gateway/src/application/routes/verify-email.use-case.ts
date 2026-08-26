import { Inject, Injectable } from '@nestjs/common';
import {
  customerEmailVerificationRejectedV1,
  customerEmailVerifiedV1,
  customerVerifyEmailV1,
} from '@bank/contracts';

import { GatewayError } from '../errors/gateway-error';
import {
  MESSAGE_PUBLISHER,
  REPLY_WAITER,
  type MessagePublisherPort,
  type ReplyWaiterPort,
} from '../ports';
import { askAndWait } from '../request-reply';
import { envelopeForRequest } from '../request-envelope';

export interface VerifyEmailResult {
  readonly status: 'ACTIVE';
  readonly correlationId: string;
}

/**
 * Turns the emailed activation link into an answer a person can read.
 *
 * The two outcomes are **events**, not replies: T-02 and T-05 modelled them as
 * something the audit record hears rather than something the caller is told.
 * This waits for whichever one carries its correlation and reports it.
 *
 * Correlating is not deciding. Customer Service still decides whether the token
 * is good; the gateway only stops guessing on the caller's behalf, which is
 * what the alternative — a blank page and "go check the audit trail" — would
 * have amounted to for somebody who just clicked a link in their inbox.
 *
 * Consuming the event here takes nothing away from anyone: both keep flowing to
 * `audit.all`, and `notification-audit-service` remains their declared consumer.
 */
@Injectable()
export class VerifyEmailUseCase {
  readonly #publisher: MessagePublisherPort;
  readonly #replies: ReplyWaiterPort;

  constructor(
    @Inject(MESSAGE_PUBLISHER) publisher: MessagePublisherPort,
    @Inject(REPLY_WAITER) replies: ReplyWaiterPort,
  ) {
    this.#publisher = publisher;
    this.#replies = replies;
  }

  public async execute(activationToken: string, correlationId: string): Promise<VerifyEmailResult> {
    const answer = await askAndWait(
      this.#publisher,
      this.#replies,
      envelopeForRequest(
        { activationToken },
        customerVerifyEmailV1.name,
        // Opening an activation link is not an authenticated act — the whole
        // point is that the account is not usable yet.
        null,
        correlationId,
      ),
    );

    if (answer.messageType === customerEmailVerifiedV1.name) {
      const parsed = customerEmailVerifiedV1.schema.safeParse(answer.payload);

      if (parsed.success) {
        return { status: 'ACTIVE', correlationId };
      }

      throw GatewayError.internal();
    }

    if (answer.messageType === customerEmailVerificationRejectedV1.name) {
      /**
       * Invented, already used, and expired all end here, and all three get the
       * same sentence.
       *
       * The event distinguishes expired from invalid — it has to, so the audit
       * record can — but repeating that distinction to whoever opened the link
       * would confirm that a token was once issued for that address. That is an
       * account-enumeration oracle reachable by anyone with a URL.
       */
      throw GatewayError.businessRejection(
        'ACTIVATION_TOKEN_INVALID',
        'El enlace de activación no es válido o ya fue utilizado.',
      );
    }

    // Something correlated with this request that is neither outcome.
    throw GatewayError.internal();
  }
}
