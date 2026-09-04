import {
  customerActivationRequestedV1,
  customerIdentityRejectedV1,
  customerIdentityValidatedV1,
} from '@bank/contracts';
import type { CustomerSetIdentityVerdictV1, Identity } from '@bank/contracts';

import { DomainRejection, mayValidateIdentity, recordIdentityVerdict } from '../domain/customer';
import type { ActivationTokenFactory, Clock, CustomerRepository, EventPublisher } from './ports';

const MESSAGE_TYPE = 'customer.set-identity-verdict.v1';

/**
 * A teller's manual verdict on an identity document (the assignment's "a cajero
 * validates the document").
 *
 * Staff only, checked here and not just at the Gateway — the same reason Account
 * re-checks its own status change: a permission enforced only at the edge holds
 * until a second producer appears. `VALIDATED` is terminal, so approving an
 * already-validated identity is refused by the domain and recorded without
 * re-announcing it. On success it publishes the same identity event the
 * automatic check does, so Notification & Audit needs no new consumer.
 */
export class SetIdentityVerdictUseCase {
  readonly #repository: CustomerRepository;
  readonly #publisher: EventPublisher;
  readonly #clock: Clock;
  readonly #tokens?: ActivationTokenFactory;

  constructor(dependencies: {
    readonly repository: CustomerRepository;
    readonly publisher: EventPublisher;
    readonly clock: Clock;
    readonly tokens?: ActivationTokenFactory;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
    this.#clock = dependencies.clock;
    this.#tokens = dependencies.tokens;
  }

  public async execute(
    command: CustomerSetIdentityVerdictV1,
    identity: Identity | null,
    idempotencyKey: string,
  ): Promise<void> {
    if (!mayValidateIdentity(identity)) {
      return;
    }

    if ((await this.#repository.findProcessed(idempotencyKey, MESSAGE_TYPE)) !== null) {
      return;
    }

    const existing = await this.#repository.findById(command.customerId);

    if (existing === null) {
      await this.#repository.recordProcessed({
        idempotencyKey,
        messageType: MESSAGE_TYPE,
        resultSummary: { outcome: 'IGNORED', reason: 'UNKNOWN_CUSTOMER' },
      });
      return;
    }

    const now = this.#clock.now();

    let updated;

    try {
      updated = recordIdentityVerdict(existing, command.verdict, now);
    } catch (error) {
      if (error instanceof DomainRejection) {
        // The identity was already VALIDATED: terminal, so this is a no-op that
        // is recorded and publishes nothing.
        await this.#repository.recordProcessed({
          idempotencyKey,
          messageType: MESSAGE_TYPE,
          resultSummary: { outcome: 'IGNORED', reason: error.code },
        });
        return;
      }

      throw error;
    }

    await this.#repository.saveIdentityVerdict({
      customer: updated,
      document: null,
      idempotency: {
        idempotencyKey,
        messageType: MESSAGE_TYPE,
        resultSummary: {
          outcome: 'APPLIED',
          customerId: command.customerId,
          verdict: command.verdict,
        },
      },
    });

    if (command.verdict === 'VALIDATED') {
      await this.#publisher.publish({
        messageType: customerIdentityValidatedV1.name,
        payload: {
          customerId: updated.customerId,
          identityStatus: 'VALIDATED',
          validatedAt: now.toISOString(),
        },
      });

      if (this.#tokens !== undefined && existing.status === 'PENDING_ACTIVATION') {
        const activation = this.#tokens.issue();
        const expiresAt = new Date(now.getTime() + 86_400_000).toISOString();
        await this.#repository.saveActivationToken({
          customerId: updated.customerId,
          tokenHash: activation.tokenHash,
          expiresAt,
        });

        await this.#publisher.publish({
          messageType: customerActivationRequestedV1.name,
          payload: {
            customerId: updated.customerId,
            email: updated.email,
            expiresAt,
            activationToken: activation.token,
          },
        });
      }
      return;
    }

    await this.#publisher.publish({
      messageType: customerIdentityRejectedV1.name,
      payload: {
        customerId: updated.customerId,
        identityStatus: 'REJECTED',
        // A human refusal maps to the code that means "the document was not
        // acceptable" from the customer's side; a teller who refuses it is
        // saying exactly that.
        reason: 'IDENTITY_DOCUMENT_UNREADABLE',
        rejectedAt: now.toISOString(),
        email: existing.email,
        fullName: existing.fullName,
      },
    });
  }
}
