import { customerKycRejectedV1, customerKycVerifiedV1 } from '@bank/contracts';
import type { CustomerSetKycStatusV1, Identity } from '@bank/contracts';

import { DomainRejection, mayManageKyc, setKycStatus } from '../domain/customer';
import type { Clock, CustomerRepository, EventPublisher } from './ports';

const MESSAGE_TYPE = 'customer.set-kyc-status.v1';

/**
 * Registers or updates a customer's KYC verdict (Fase 2, §4.1 p. 4).
 *
 * Staff only, checked here and not just at the Gateway — the same reason
 * `SetIdentityVerdictUseCase` re-checks: a permission enforced only at the
 * edge holds until a second producer appears. `VERIFIED` is terminal, so
 * approving an already-verified customer is refused by the domain and
 * recorded without re-announcing it.
 */
export class SetKycStatusUseCase {
  readonly #repository: CustomerRepository;
  readonly #publisher: EventPublisher;
  readonly #clock: Clock;

  constructor(dependencies: {
    readonly repository: CustomerRepository;
    readonly publisher: EventPublisher;
    readonly clock: Clock;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
    this.#clock = dependencies.clock;
  }

  public async execute(
    command: CustomerSetKycStatusV1,
    identity: Identity | null,
    idempotencyKey: string,
  ): Promise<void> {
    if (!mayManageKyc(identity)) {
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
      updated = setKycStatus(existing, command.status, now);
    } catch (error) {
      if (error instanceof DomainRejection) {
        // The KYC status was already VERIFIED: terminal, so this is a no-op
        // that is recorded and publishes nothing.
        await this.#repository.recordProcessed({
          idempotencyKey,
          messageType: MESSAGE_TYPE,
          resultSummary: { outcome: 'IGNORED', reason: error.code },
        });
        return;
      }

      throw error;
    }

    await this.#repository.saveKycVerdict({
      customer: updated,
      idempotency: {
        idempotencyKey,
        messageType: MESSAGE_TYPE,
        resultSummary: {
          outcome: 'APPLIED',
          customerId: command.customerId,
          status: command.status,
        },
      },
    });

    if (command.status === 'VERIFIED') {
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
      messageType: customerKycRejectedV1.name,
      payload: {
        customerId: updated.customerId,
        kycStatus: 'REJECTED',
        rejectedAt: now.toISOString(),
      },
    });
  }
}
