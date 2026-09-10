import { customerGetRepliedV1 } from '@bank/contracts';
import type { CustomerGetQueryV1, Identity } from '@bank/contracts';

import { mayReadCustomer } from '../domain/customer';
import type { CustomerRepository, EventPublisher } from './ports';

/**
 * Answers "who is this customer", to whoever may see them and to nobody else.
 *
 * Customer Service's first read path. A record this identity may not read — a
 * `CLIENTE` asking for somebody else — is answered `NOT_FOUND` rather than
 * "forbidden": the two are different facts, and a distinguishable refusal would
 * turn this query into a way to discover which customer ids exist. The reply
 * never carries the credential or the activation token; those never leave the
 * service.
 *
 * A query changes nothing, so it is **not** idempotency-guarded: a redelivery
 * must produce a fresh reply rather than a silence that leaves the Gateway
 * waiting out its five seconds.
 */
export class GetCustomerUseCase {
  readonly #repository: CustomerRepository;
  readonly #publisher: EventPublisher;

  constructor(dependencies: {
    readonly repository: CustomerRepository;
    readonly publisher: EventPublisher;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
  }

  public async execute(payload: CustomerGetQueryV1, identity: Identity | null): Promise<void> {
    const customer = await this.#repository.findById(payload.customerId);

    if (customer === null || !mayReadCustomer(identity, customer.customerId)) {
      await this.#publisher.reply({
        messageType: customerGetRepliedV1.name,
        payload: { outcome: 'NOT_FOUND', reason: 'CUSTOMER_NOT_FOUND' },
      });

      return;
    }

    await this.#publisher.reply({
      messageType: customerGetRepliedV1.name,
      payload: {
        outcome: 'FOUND',
        customerId: customer.customerId,
        fullName: customer.fullName,
        identityDocument: customer.identityDocument,
        email: customer.email,
        dateOfBirth: customer.dateOfBirth,
        address: customer.address,
        username: customer.username,
        role: customer.role,
        status: customer.status,
        identityStatus: customer.identityStatus,
        kycStatus: customer.kycStatus,
      },
    });
  }
}
