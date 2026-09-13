import { customerListRepliedV1 } from '@bank/contracts';
import type { CustomerListQueryV1, Identity } from '@bank/contracts';

import { mayValidateIdentity } from '../domain/customer';
import type { CustomerRepository, EventPublisher } from './ports';

export class GetCustomerListUseCase {
  readonly #repository: CustomerRepository;
  readonly #publisher: EventPublisher;

  constructor(dependencies: {
    readonly repository: CustomerRepository;
    readonly publisher: EventPublisher;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
  }

  public async execute(payload: CustomerListQueryV1, identity: Identity | null): Promise<void> {
    if (!mayValidateIdentity(identity)) {
      await this.#publisher.reply({
        messageType: customerListRepliedV1.name,
        payload: { customers: [], omitted: 0 },
      });
      return;
    }

    const limit = payload.limit ?? 50;
    const { customers, total } = await this.#repository.listCustomers(limit);

    await this.#publisher.reply({
      messageType: customerListRepliedV1.name,
      payload: {
        customers: customers.map((c) => ({
          customerId: c.customerId,
          fullName: c.fullName,
          email: c.email.split('#rejected#')[0] ?? c.email,
          username: c.username.split('#rejected#')[0] ?? c.username,
          documentNumber: c.identityDocument.split('#rejected#')[0] ?? c.identityDocument,
          identityStatus: c.identityStatus,
          role: c.role,
          status: c.status,
          registeredAt: c.createdAt,
          kycStatus: c.kycStatus,
        })),
        omitted: Math.max(0, total - customers.length),
      },
    });
  }
}
