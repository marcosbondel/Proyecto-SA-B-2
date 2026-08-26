import { customerEmailVerificationRejectedV1, customerEmailVerifiedV1 } from '@bank/contracts';
import type { CustomerVerifyEmailV1 } from '@bank/contracts';

import { DomainRejection, verifyEmail } from '../domain/customer';
import type { ActivationTokenFactory, Clock, CustomerRepository, EventPublisher } from './ports';

const MESSAGE_TYPE = 'customer.verify-email.v1';

/**
 * The activation link, opened.
 *
 * The token is looked up **by digest**: what the database holds is a SHA-256 of
 * the value that was emailed, so a dump of `email_activation_tokens` hands
 * nobody a working link. The clear value exists in the email and in the URL the
 * person clicked, and nowhere else.
 *
 * Both outcomes are events rather than a reply, following the shape T-05 chose
 * for `customer.login.rejected`. The Gateway correlates whichever one carries
 * its correlation id and turns the two rejections into one sentence, so the
 * distinction between *expired* and *invalid* stays in the audit record where
 * it is useful and out of the browser where it would confirm that a token was
 * once issued for an address.
 *
 * A redelivery is answered from the idempotency record, not by re-verifying:
 * the first delivery burned the token, so a second evaluation would reject a
 * link that had just worked.
 */
export class VerifyEmailActivationUseCase {
  readonly #repository: CustomerRepository;
  readonly #publisher: EventPublisher;
  readonly #tokens: ActivationTokenFactory;
  readonly #clock: Clock;

  constructor(dependencies: {
    readonly repository: CustomerRepository;
    readonly publisher: EventPublisher;
    readonly tokens: ActivationTokenFactory;
    readonly clock: Clock;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
    this.#tokens = dependencies.tokens;
    this.#clock = dependencies.clock;
  }

  public async execute(command: CustomerVerifyEmailV1, idempotencyKey: string): Promise<void> {
    const now = this.#clock.now();
    const seen = await this.#repository.findProcessed(idempotencyKey, MESSAGE_TYPE);

    if (seen !== null) {
      await this.#replay(seen.resultSummary, now);
      return;
    }

    const tokenHash = this.#tokens.digest(command.activationToken);
    const found = await this.#repository.findByActivationToken(tokenHash, now);

    if (found.outcome !== 'FOUND') {
      const reason =
        found.outcome === 'EXPIRED' ? 'ACTIVATION_TOKEN_EXPIRED' : 'ACTIVATION_TOKEN_INVALID';

      await this.#repository.recordProcessed({
        idempotencyKey,
        messageType: MESSAGE_TYPE,
        resultSummary: { outcome: 'REJECTED', reason },
      });

      await this.#reject(reason, now);
      return;
    }

    let activated;

    try {
      activated = verifyEmail(found.customer, now);
    } catch (error) {
      if (error instanceof DomainRejection) {
        // The account was already active: the token was used before.
        await this.#repository.recordProcessed({
          idempotencyKey,
          messageType: MESSAGE_TYPE,
          resultSummary: { outcome: 'REJECTED', reason: 'ACTIVATION_TOKEN_INVALID' },
        });

        await this.#reject('ACTIVATION_TOKEN_INVALID', now);
        return;
      }

      throw error;
    }

    await this.#repository.saveEmailVerification({
      customer: activated,
      tokenHash,
      usedAt: now.toISOString(),
      idempotency: {
        idempotencyKey,
        messageType: MESSAGE_TYPE,
        resultSummary: {
          outcome: 'VERIFIED',
          customerId: activated.customerId,
          emailVerifiedAt: activated.emailVerifiedAt,
        },
      },
    });

    await this.#publisher.publish({
      messageType: customerEmailVerifiedV1.name,
      payload: {
        customerId: activated.customerId,
        emailVerifiedAt: activated.emailVerifiedAt,
        status: 'ACTIVE',
      },
    });
  }

  /**
   * Repeats the first answer for a redelivered command.
   *
   * Somebody is holding an HTTP connection open on the other side of this — the
   * Gateway answers the activation link synchronously — so silence would cost
   * them a five-second timeout for a question that was already settled.
   */
  async #replay(summary: Record<string, unknown>, now: Date): Promise<void> {
    if (summary.outcome === 'VERIFIED') {
      await this.#publisher.publish({
        messageType: customerEmailVerifiedV1.name,
        payload: {
          customerId: String(summary.customerId),
          emailVerifiedAt: String(summary.emailVerifiedAt),
          status: 'ACTIVE',
        },
      });
      return;
    }

    const reason =
      summary.reason === 'ACTIVATION_TOKEN_EXPIRED'
        ? 'ACTIVATION_TOKEN_EXPIRED'
        : 'ACTIVATION_TOKEN_INVALID';

    await this.#reject(reason, now);
  }

  async #reject(
    reason: 'ACTIVATION_TOKEN_EXPIRED' | 'ACTIVATION_TOKEN_INVALID',
    now: Date,
  ): Promise<void> {
    await this.#publisher.publish({
      messageType: customerEmailVerificationRejectedV1.name,
      payload: { reason, occurredAt: now.toISOString() },
    });
  }
}
