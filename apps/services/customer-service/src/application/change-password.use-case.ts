import { customerPasswordChangedV1, customerPasswordChangeRejectedV1 } from '@bank/contracts';
import type { CustomerChangePasswordV1, Identity } from '@bank/contracts';

import { mayChangeOwnPassword } from '../domain/customer';
import type { Clock, CustomerRepository, EventPublisher, PasswordHasher } from './ports';

const MESSAGE_TYPE = 'customer.change-password.v1';

/**
 * Changing a password from inside a session — `C-01`'s second form.
 *
 * Three things it does that the reset does not.
 *
 * It **verifies the current password** before anything moves. A session is not
 * authorisation to replace the credential that creates sessions; a borrowed
 * unlocked laptop is the common case, and knowing the old password is what
 * separates the owner from whoever is sitting at their desk.
 *
 * It refuses **staff acting on somebody else**, administrators included
 * (`mayChangeOwnPassword`). Editing a customer's address is something a teller
 * does for a person in front of them; replacing their credential is taking the
 * account. Staff helping somebody locked out have the recovery flow, whose link
 * goes to the customer's own inbox.
 *
 * And it publishes an event for the **refusals** as well as the success, which
 * the update path does not. A wrong current password is unremarkable once and
 * is the most interesting line in the trail when it appears eleven times in a
 * minute, so the trail has to be able to hold it.
 */
export class ChangePasswordUseCase {
  readonly #repository: CustomerRepository;
  readonly #publisher: EventPublisher;
  readonly #hasher: PasswordHasher;
  readonly #clock: Clock;

  constructor(dependencies: {
    readonly repository: CustomerRepository;
    readonly publisher: EventPublisher;
    readonly hasher: PasswordHasher;
    readonly clock: Clock;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
    this.#hasher = dependencies.hasher;
    this.#clock = dependencies.clock;
  }

  public async execute(
    command: CustomerChangePasswordV1,
    identity: Identity | null,
    idempotencyKey: string,
  ): Promise<void> {
    const now = this.#clock.now();
    const seen = await this.#repository.findProcessed(idempotencyKey, MESSAGE_TYPE);

    if (seen !== null) {
      await this.#replay(seen.resultSummary, command.customerId, now);
      return;
    }

    if (!mayChangeOwnPassword(identity, command.customerId)) {
      await this.#settle(idempotencyKey, command.customerId, 'FORBIDDEN_ACCOUNT_ACCESS', now);
      return;
    }

    const existing = await this.#repository.findById(command.customerId);

    if (existing === null) {
      /**
       * Unreachable in practice — the identity in the envelope was minted from
       * a customer that existed a moment ago — and answered as a wrong
       * credential rather than as "no such customer", because the two must not
       * be distinguishable to whoever is typing.
       */
      await this.#settle(idempotencyKey, command.customerId, 'INVALID_CREDENTIALS', now);
      return;
    }

    const found = await this.#repository.findByEmail(existing.email);

    if (found === null || !(await this.#hasher.verify(command.currentCredential, found.credentialHash))) {
      await this.#settle(idempotencyKey, command.customerId, 'INVALID_CREDENTIALS', now);
      return;
    }

    const credentialHash = await this.#hasher.hash(command.newCredential);
    const changedAt = now.toISOString();

    await this.#repository.savePasswordChange({
      customerId: command.customerId,
      credentialHash,
      changedAt,
      idempotency: {
        idempotencyKey,
        messageType: MESSAGE_TYPE,
        resultSummary: { outcome: 'CHANGED', customerId: command.customerId, changedAt },
      },
    });

    await this.#publisher.publish({
      messageType: customerPasswordChangedV1.name,
      payload: { customerId: command.customerId, changedAt },
    });
  }

  /** Records the refusal and says it, so a redelivery answers the same. */
  async #settle(
    idempotencyKey: string,
    customerId: string,
    reason: 'INVALID_CREDENTIALS' | 'FORBIDDEN_ACCOUNT_ACCESS',
    now: Date,
  ): Promise<void> {
    await this.#repository.recordProcessed({
      idempotencyKey,
      messageType: MESSAGE_TYPE,
      resultSummary: { outcome: 'REJECTED', reason, customerId },
    });

    await this.#reject(customerId, reason, now);
  }

  async #replay(
    summary: Record<string, unknown>,
    customerId: string,
    now: Date,
  ): Promise<void> {
    if (summary.outcome === 'CHANGED') {
      await this.#publisher.publish({
        messageType: customerPasswordChangedV1.name,
        payload: {
          customerId: String(summary.customerId),
          changedAt: String(summary.changedAt),
        },
      });
      return;
    }

    await this.#reject(
      String(summary.customerId ?? customerId),
      summary.reason === 'FORBIDDEN_ACCOUNT_ACCESS'
        ? 'FORBIDDEN_ACCOUNT_ACCESS'
        : 'INVALID_CREDENTIALS',
      now,
    );
  }

  async #reject(
    customerId: string,
    reason: 'INVALID_CREDENTIALS' | 'FORBIDDEN_ACCOUNT_ACCESS',
    now: Date,
  ): Promise<void> {
    await this.#publisher.publish({
      messageType: customerPasswordChangeRejectedV1.name,
      payload: { customerId, reason, occurredAt: now.toISOString() },
    });
  }
}
