import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
  accountDepositRejectedV1,
  accountDepositV1,
  accountDepositedV1,
} from '@bank/contracts';
import type { Identity, Money } from '@bank/contracts';

import { GatewayError } from '../errors/gateway-error';
import {
  MESSAGE_PUBLISHER,
  REPLY_WAITER,
  type MessagePublisherPort,
  type ReplyWaiterPort,
} from '../ports';
import { askAndWait } from '../request-reply';
import { envelopeForRequest } from '../request-envelope';

export interface DepositResult {
  readonly depositId: string;
  readonly operationId: string;
  readonly balanceAfter: Money;
  readonly reactivated: boolean;
  readonly correlationId: string;
}

/**
 * `A-05` — a deposit taken at a window, answered in the same response.
 *
 * Synchronous, and it is the only *money-moving* route in the system that is.
 * A transfer is `202` because the Saga has four more steps to take and nobody
 * can promise the outcome yet; a deposit is one credit to one account with no
 * counterparty, so the answer exists by the time the movement commits. It has
 * to: a teller is standing in front of somebody holding cash, and "check back
 * later" is not something either of them can act on.
 *
 * The `depositId` is minted **here** rather than by the service, so the receipt
 * names something that exists even when the command is redelivered — the defect
 * recorded as TD-025 on the registration path, avoided by construction.
 *
 * The Gateway decides nothing about the money. It does not check the balance,
 * the account's status, or whether the actor may deposit — Account Service
 * refuses all three with a named code, and this translates the verdict.
 */
@Injectable()
export class DepositUseCase {
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
    readonly accountId: string;
    readonly amount: Money;
    readonly description?: string;
    readonly actor: Identity;
    readonly correlationId: string;
    readonly idempotencyKey: string;
  }): Promise<DepositResult> {
    const depositId = randomUUID();

    const payload = {
      depositId,
      accountId: input.accountId,
      amount: input.amount,
      ...(input.description === undefined ? {} : { description: input.description }),
    };

    const parsed = accountDepositV1.schema.safeParse(payload);

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
        accountDepositV1.name,
        input.actor,
        input.correlationId,
        { idempotencyKey: input.idempotencyKey },
      ),
    );

    if (answer.messageType === accountDepositedV1.name) {
      const deposited = accountDepositedV1.schema.safeParse(answer.payload);

      if (!deposited.success) {
        throw GatewayError.internal();
      }

      return {
        depositId: deposited.data.depositId,
        operationId: deposited.data.operationId,
        balanceAfter: deposited.data.balanceAfter,
        reactivated: deposited.data.reactivated,
        correlationId: input.correlationId,
      };
    }

    if (answer.messageType === accountDepositRejectedV1.name) {
      const rejected = accountDepositRejectedV1.schema.safeParse(answer.payload);

      if (!rejected.success) {
        throw GatewayError.internal();
      }

      throw GatewayError.businessRejection(rejected.data.reason, MESSAGES[rejected.data.reason]);
    }

    throw GatewayError.internal();
  }
}

/**
 * One sentence per refusal, and each says what to do next.
 *
 * None of them is "try again": a deposit that was refused for any of these
 * three will be refused again for the same reason until somebody changes
 * something outside this request.
 */
const MESSAGES: Readonly<
  Record<'ACCOUNT_NOT_FOUND' | 'INVALID_AMOUNT_PRECISION' | 'FORBIDDEN_ACCOUNT_ACCESS', string>
> = {
  ACCOUNT_NOT_FOUND: 'No existe una cuenta con ese número.',
  INVALID_AMOUNT_PRECISION: 'El monto debe tener como máximo dos decimales y ser mayor que cero.',
  FORBIDDEN_ACCOUNT_ACCESS: 'Solo un cajero o un administrador puede registrar un depósito.',
};
