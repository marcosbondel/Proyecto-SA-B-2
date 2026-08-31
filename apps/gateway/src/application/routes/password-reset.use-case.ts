import { Inject, Injectable } from '@nestjs/common';
import {
  customerPasswordResetCompletedV1,
  customerPasswordResetConfirmV1,
  customerPasswordResetRejectedV1,
  customerPasswordResetRequestedV1,
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

export interface AcceptedReset {
  readonly correlationId: string;
}

export interface CompletedReset {
  readonly status: 'CHANGED';
  readonly correlationId: string;
}

/**
 * Password recovery, in the two halves the prototype's `P-07` draws.
 *
 * The halves are deliberately different shapes, because they answer different
 * questions.
 *
 * **Asking** is fire-and-forget and always `202`. Waiting for an answer would
 * mean having one to give, and the only honest answer — "an email is on its way
 * if that address banks here" — is the same sentence whether or not it does.
 * Customer Service publishes nothing at all for an unknown address, so there is
 * nothing to correlate and nothing that could leak.
 *
 * **Spending the link** is synchronous, like the activation link it mirrors:
 * somebody just typed a new password and is watching a spinner. Both outcomes
 * are events rather than replies — the shape T-05 chose for this family — so
 * this waits for whichever one carries its correlation.
 *
 * Neither half is authenticated. The whole point is that the person cannot sign
 * in; the token in the link is the credential, and it is a bearer one.
 */
@Injectable()
export class PasswordResetUseCase {
  readonly #publisher: MessagePublisherPort;
  readonly #replies: ReplyWaiterPort;

  constructor(
    @Inject(MESSAGE_PUBLISHER) publisher: MessagePublisherPort,
    @Inject(REPLY_WAITER) replies: ReplyWaiterPort,
  ) {
    this.#publisher = publisher;
    this.#replies = replies;
  }

  public async request(input: {
    readonly email: string;
    readonly correlationId: string;
    readonly idempotencyKey: string;
  }): Promise<AcceptedReset> {
    await this.#publisher.publish(
      envelopeForRequest(
        { email: input.email },
        customerPasswordResetRequestedV1.name,
        null,
        input.correlationId,
        { idempotencyKey: input.idempotencyKey },
      ),
    );

    return { correlationId: input.correlationId };
  }

  public async confirm(input: {
    readonly resetToken: string;
    readonly credential: string;
    readonly correlationId: string;
  }): Promise<CompletedReset> {
    const answer = await askAndWait(
      this.#publisher,
      this.#replies,
      envelopeForRequest(
        { resetToken: input.resetToken, credential: input.credential },
        customerPasswordResetConfirmV1.name,
        null,
        input.correlationId,
      ),
    );

    if (answer.messageType === customerPasswordResetCompletedV1.name) {
      const parsed = customerPasswordResetCompletedV1.schema.safeParse(answer.payload);

      if (parsed.success) {
        return { status: 'CHANGED', correlationId: input.correlationId };
      }

      throw GatewayError.internal();
    }

    if (answer.messageType === customerPasswordResetRejectedV1.name) {
      /**
       * Invented, already spent and expired all end here, and all three get the
       * same sentence — the same collapse `VerifyEmailUseCase` performs, for the
       * same reason. The event keeps them apart so the audit record can; saying
       * which it was to whoever opened the link would confirm that a link was
       * once issued for that address.
       */
      throw GatewayError.businessRejection(
        'RESET_TOKEN_INVALID',
        'El enlace para restablecer la contraseña no es válido o ya fue utilizado.',
      );
    }

    // Something correlated with this request that is neither outcome.
    throw GatewayError.internal();
  }
}
