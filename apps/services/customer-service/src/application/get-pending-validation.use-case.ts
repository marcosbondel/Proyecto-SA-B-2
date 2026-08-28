import { customerPendingValidationRepliedV1 } from '@bank/contracts';
import type { CustomerPendingValidationQueryV1, Identity } from '@bank/contracts';

import { mayValidateIdentity } from '../domain/customer';
import type { CustomerRepository, EventPublisher } from './ports';

/** Bounded so one large queue cannot produce a reply past the 5s ceiling. */
const MAX_PENDING = 100;

/**
 * The teller's queue of identities awaiting a verdict.
 *
 * Staff only: a `CLIENTE` gets an empty list, which is the same answer whether
 * nothing is pending or nothing is theirs to see. Not idempotency-guarded — a
 * query changes nothing and a redelivery must produce a fresh reply.
 */
export class GetPendingValidationUseCase {
  readonly #repository: CustomerRepository;
  readonly #publisher: EventPublisher;

  constructor(dependencies: {
    readonly repository: CustomerRepository;
    readonly publisher: EventPublisher;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
  }

  public async execute(
    _payload: CustomerPendingValidationQueryV1,
    identity: Identity | null,
  ): Promise<void> {
    if (!mayValidateIdentity(identity)) {
      await this.#publisher.reply({
        messageType: customerPendingValidationRepliedV1.name,
        payload: { customers: [], omitted: 0 },
      });
      return;
    }

    const { customers, total } = await this.#repository.listPendingIdentityValidation(MAX_PENDING);

    await this.#publisher.reply({
      messageType: customerPendingValidationRepliedV1.name,
      payload: {
        customers: customers.map((customer) => ({
          customerId: customer.customerId,
          fullName: customer.fullName,
          email: customer.email,
          registeredAt: customer.createdAt,
        })),
        omitted: Math.max(0, total - customers.length),
      },
    });
  }
}
