import { Inject, Injectable } from '@nestjs/common';
import {
  customerChangePasswordV1,
  customerPasswordChangedV1,
  customerPasswordChangeRejectedV1,
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

export interface ChangedPassword {
  readonly status: 'CHANGED';
  readonly correlationId: string;
}

/**
 * `C-01`'s "cambiar contraseña", answered in the same response.
 *
 * Synchronous for the reason the reset confirmation is: somebody typed their
 * current password and is watching a spinner, and "we are processing it" is not
 * an answer you can show them.
 *
 * Unlike the reset, the two refusals are **kept apart** in what the caller is
 * told. Nobody reaches this route without a session, so neither answer reveals
 * whether an account exists: a wrong current password is the person's own
 * mistake and saying so is the useful thing, and an attempt on somebody else's
 * account is a `403` because nothing about the request needs fixing.
 *
 * Whether this actor may change this subject's password is Customer Service's
 * decision, made against `mayChangeOwnPassword`. The Gateway has no customer
 * table and does not second-guess it — it forwards the verified identity and
 * translates the verdict.
 */
@Injectable()
export class ChangePasswordUseCase {
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
    readonly customerId: string;
    readonly currentCredential: string;
    readonly newCredential: string;
    readonly actor: Identity;
    readonly correlationId: string;
  }): Promise<ChangedPassword> {
    const answer = await askAndWait(
      this.#publisher,
      this.#replies,
      envelopeForRequest(
        {
          customerId: input.customerId,
          currentCredential: input.currentCredential,
          newCredential: input.newCredential,
        },
        customerChangePasswordV1.name,
        input.actor,
        input.correlationId,
      ),
    );

    if (answer.messageType === customerPasswordChangedV1.name) {
      const parsed = customerPasswordChangedV1.schema.safeParse(answer.payload);

      if (parsed.success) {
        return { status: 'CHANGED', correlationId: input.correlationId };
      }

      throw GatewayError.internal();
    }

    if (answer.messageType === customerPasswordChangeRejectedV1.name) {
      const parsed = customerPasswordChangeRejectedV1.schema.safeParse(answer.payload);

      if (!parsed.success) {
        throw GatewayError.internal();
      }

      // The catalogue's own code travels through untouched (FR-030); the table
      // in `failure-code-table.ts` picks the status, and nothing here decides.
      throw GatewayError.businessRejection(
        parsed.data.reason,
        parsed.data.reason === 'INVALID_CREDENTIALS'
          ? 'La contraseña actual no es correcta.'
          : 'No puedes cambiar la contraseña de otra persona.',
      );
    }

    throw GatewayError.internal();
  }
}
