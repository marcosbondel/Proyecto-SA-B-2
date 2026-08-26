import { Inject, Injectable } from '@nestjs/common';
import { customerAuthenticateRepliedV1, customerAuthenticateV1 } from '@bank/contracts';

import { GatewayError } from '../errors/gateway-error';
import {
  MESSAGE_PUBLISHER,
  REPLY_WAITER,
  SESSION_SIGNER,
  type MessagePublisherPort,
  type ReplyWaiterPort,
  type SessionSignerPort,
} from '../ports';
import { askAndWait } from '../request-reply';
import { envelopeForRequest } from '../request-envelope';

export interface LoginRequest {
  readonly email: string;
  readonly credential: string;
  readonly correlationId: string;
}

export interface LoginResult {
  readonly token: string;
  readonly expiresIn: number;
  readonly correlationId: string;
}

@Injectable()
export class LoginUseCase {
  readonly #publisher: MessagePublisherPort;
  readonly #replies: ReplyWaiterPort;
  readonly #signer: SessionSignerPort;

  constructor(
    @Inject(MESSAGE_PUBLISHER) publisher: MessagePublisherPort,
    @Inject(REPLY_WAITER) replies: ReplyWaiterPort,
    @Inject(SESSION_SIGNER) signer: SessionSignerPort,
  ) {
    this.#publisher = publisher;
    this.#replies = replies;
    this.#signer = signer;
  }

  public async execute(request: LoginRequest): Promise<LoginResult> {
    const envelope = envelopeForRequest(
      { email: request.email, credential: request.credential },
      customerAuthenticateV1.name,
      // Nobody is authenticated yet — that is the point of this request.
      null,
      request.correlationId,
    );

    const reply = await askAndWait(this.#publisher, this.#replies, envelope);
    const parsed = customerAuthenticateRepliedV1.schema.safeParse(reply.payload);

    if (!parsed.success) {
      // Customer Service answered something this system does not define.
      // Minting a session from it would be worse than failing.
      throw GatewayError.internal();
    }

    const answer = parsed.data;

    /**
     * Three different facts, one identical response.
     *
     * A wrong password, an address nobody registered, and a correct password on
     * an account that never confirmed its email all end here. Customer Service
     * already collapses the first two into `INVALID_CREDENTIALS` so the login
     * route cannot be used to enumerate accounts; the third is collapsed here.
     *
     * The timing matches by construction rather than by padding: all three take
     * exactly one round trip over the broker, and the branch below does no work
     * that the approved branch does not also do.
     */
    if (answer.outcome === 'REJECTED' || answer.activationPending) {
      throw GatewayError.unauthenticated();
    }

    return {
      // Signing claims someone else decided. The gateway never judged the
      // credential; it only packages the verdict (ADR-010).
      token: this.#signer.sign(answer.claims),
      expiresIn: this.#signer.expiresInSeconds,
      correlationId: request.correlationId,
    };
  }
}
