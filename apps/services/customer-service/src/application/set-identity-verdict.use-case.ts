import {
  customerIdentityRejectedV1,
  customerIdentityValidatedV1,
  customerKycRejectedV1,
  customerKycVerifiedV1,
} from '@bank/contracts';
import type { CustomerSetIdentityVerdictV1, Identity } from '@bank/contracts';

import { DomainRejection, mayValidateIdentity, recordIdentityVerdict } from '../domain/customer';
import type {
  ActivationTokenFactory,
  Clock,
  CustomerRepository,
  EventPublisher,
  LifecycleTelemetry,
} from './ports';

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
  readonly #telemetry: LifecycleTelemetry;

  constructor(dependencies: {
    readonly repository: CustomerRepository;
    readonly publisher: EventPublisher;
    readonly clock: Clock;
    readonly telemetry: LifecycleTelemetry;
    readonly tokens?: ActivationTokenFactory;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
    this.#clock = dependencies.clock;
    this.#telemetry = dependencies.telemetry;
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
      this.#telemetry.ignored({
        transition: transitionOf(command.verdict),
        customerId: command.customerId,
        reason: 'UNKNOWN_CUSTOMER',
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
        this.#telemetry.ignored({
          transition: transitionOf(command.verdict),
          customerId: command.customerId,
          reason: error.code,
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

    this.#telemetry.record({
      transition: transitionOf(command.verdict),
      customerId: updated.customerId,
      path: 'review',
      createdAt: existing.createdAt,
      at: now,
      creationTrace: await this.#repository.findCreationTrace(command.customerId),
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

      await this.#publisher.publish({
        messageType: customerKycVerifiedV1.name,
        payload: {
          customerId: updated.customerId,
          kycStatus: 'VERIFIED',
          verifiedAt: now.toISOString(),
        },
      });
      return;
    }

    await this.#publisher.publish({
      messageType: customerIdentityRejectedV1.name,
      payload: {
        customerId: updated.customerId,
        identityStatus: 'REJECTED',
        reason: 'IDENTITY_DOCUMENT_UNREADABLE',
        rejectedAt: now.toISOString(),
        email: existing.email,
        fullName: existing.fullName,
      },
    });

    await this.#publisher.publish({
      messageType: customerKycRejectedV1.name,
      payload: {
        customerId: updated.customerId,
        kycStatus: 'REJECTED',
        rejectedAt: now.toISOString(),
      },
    });
  }
}

function transitionOf(
  verdict: CustomerSetIdentityVerdictV1['verdict'],
): 'verified' | 'rejected' {
  return verdict === 'VALIDATED' ? 'verified' : 'rejected';
}
