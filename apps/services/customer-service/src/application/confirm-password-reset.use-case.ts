import { customerPasswordResetCompletedV1, customerPasswordResetRejectedV1 } from '@bank/contracts';
import type { CustomerPasswordResetConfirmV1 } from '@bank/contracts';

import { DomainRejection } from '../domain/customer';
import type {
  ActivationTokenFactory,
  Clock,
  CustomerRepository,
  EventPublisher,
  PasswordHasher,
} from './ports';

const MESSAGE_TYPE = 'customer.password-reset.confirm.v1';

/**
 * The reset link, opened, with a new password typed into it.
 *
 * The shape is `VerifyEmailActivationUseCase`'s, deliberately: the token is
 * looked up **by digest**, both outcomes are events rather than a reply, and
 * the Gateway correlates whichever one carries its correlation. Repeating a
 * shape that already works is worth more here than inventing a second one for
 * the same problem.
 *
 * Two things this does that the activation does not. It hashes a credential,
 * with the same hasher registration uses — so a password set here and one set
 * at sign-up are stored identically and neither is a weaker way in. And it
 * burns **every** live token for the customer, not only the one spent: somebody
 * resetting a password may be doing it because their inbox is not theirs alone.
 *
 * A redelivery is answered from the idempotency record, not by re-verifying:
 * the first delivery burned the token, so a second evaluation would reject a
 * link that had just worked.
 */
export class ConfirmPasswordResetUseCase {
  readonly #repository: CustomerRepository;
  readonly #publisher: EventPublisher;
  readonly #hasher: PasswordHasher;
  readonly #tokens: ActivationTokenFactory;
  readonly #clock: Clock;

  constructor(dependencies: {
    readonly repository: CustomerRepository;
    readonly publisher: EventPublisher;
    readonly hasher: PasswordHasher;
    readonly tokens: ActivationTokenFactory;
    readonly clock: Clock;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
    this.#hasher = dependencies.hasher;
    this.#tokens = dependencies.tokens;
    this.#clock = dependencies.clock;
  }

  public async execute(
    command: CustomerPasswordResetConfirmV1,
    idempotencyKey: string,
  ): Promise<void> {
    const now = this.#clock.now();
    const seen = await this.#repository.findProcessed(idempotencyKey, MESSAGE_TYPE);

    if (seen !== null) {
      await this.#replay(seen.resultSummary, now);
      return;
    }

    const tokenHash = this.#tokens.digest(command.resetToken);
    const found = await this.#repository.findByPasswordResetToken(tokenHash, now);

    if (found.outcome !== 'FOUND') {
      const reason = found.outcome === 'EXPIRED' ? 'RESET_TOKEN_EXPIRED' : 'RESET_TOKEN_INVALID';

      await this.#repository.recordProcessed({
        idempotencyKey,
        messageType: MESSAGE_TYPE,
        resultSummary: { outcome: 'REJECTED', reason },
      });

      await this.#reject(reason, now);
      return;
    }

    const credentialHash = await this.#hasher.hash(command.credential);
    const changedAt = now.toISOString();

    try {
      await this.#repository.savePasswordReset({
        customerId: found.customer.customerId,
        credentialHash,
        tokenHash,
        usedAt: changedAt,
        idempotency: {
          idempotencyKey,
          messageType: MESSAGE_TYPE,
          resultSummary: {
            outcome: 'COMPLETED',
            customerId: found.customer.customerId,
            changedAt,
          },
        },
      });
    } catch (error) {
      /**
       * Two deliveries raced and the other one won: the token was live when
       * this delivery read it and spent by the time it wrote. The password is
       * already changed — by the winner, to the same value — so this reports
       * the refusal rather than retrying into a second change.
       */
      if (error instanceof DomainRejection && error.code === 'RESET_TOKEN_INVALID') {
        await this.#reject('RESET_TOKEN_INVALID', now);
        return;
      }

      throw error;
    }

    await this.#publisher.publish({
      messageType: customerPasswordResetCompletedV1.name,
      payload: { customerId: found.customer.customerId, changedAt },
    });
  }

  /** Repeats the first answer for a redelivered command. */
  async #replay(summary: Record<string, unknown>, now: Date): Promise<void> {
    if (summary.outcome === 'COMPLETED') {
      await this.#publisher.publish({
        messageType: customerPasswordResetCompletedV1.name,
        payload: {
          customerId: String(summary.customerId),
          changedAt: String(summary.changedAt),
        },
      });
      return;
    }

    await this.#reject(
      summary.reason === 'RESET_TOKEN_EXPIRED' ? 'RESET_TOKEN_EXPIRED' : 'RESET_TOKEN_INVALID',
      now,
    );
  }

  async #reject(
    reason: 'RESET_TOKEN_EXPIRED' | 'RESET_TOKEN_INVALID',
    now: Date,
  ): Promise<void> {
    await this.#publisher.publish({
      messageType: customerPasswordResetRejectedV1.name,
      payload: { reason, occurredAt: now.toISOString() },
    });
  }
}
