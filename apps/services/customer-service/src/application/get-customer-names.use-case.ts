import { customerNamesRepliedV1 } from '@bank/contracts';
import type { CustomerNamesQueryV1, Identity } from '@bank/contracts';

import { mayValidateIdentity } from '../domain/customer';
import type { CustomerRepository, EventPublisher } from './ports';

/**
 * The display names behind a set of customer ids — the query that closes
 * TD-026.
 *
 * **Staff only, and silence rather than a refusal.** A `CLIENTE` gets an empty
 * list whatever they asked about, and an id that does not exist simply does not
 * come back. Both are the same decision `customer.get.query.v1` makes: an
 * answer that distinguishes "no such customer" from "not yours" is a way to
 * discover which customer ids exist, and this one would be a fast way, since it
 * takes a hundred ids at a time.
 *
 * `mayValidateIdentity` is reused as the staff predicate rather than a second
 * one being written. It answers "is this actor staff", which is exactly the
 * question here; a new predicate with the same body would be a second place for
 * the answer to change.
 *
 * Not idempotency-guarded: a query changes nothing, and a redelivery must
 * produce a fresh reply rather than a silence that leaves the Gateway waiting
 * out its five seconds.
 */
export class GetCustomerNamesUseCase {
  readonly #repository: CustomerRepository;
  readonly #publisher: EventPublisher;

  constructor(dependencies: {
    readonly repository: CustomerRepository;
    readonly publisher: EventPublisher;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
  }

  public async execute(query: CustomerNamesQueryV1, identity: Identity | null): Promise<void> {
    if (!mayValidateIdentity(identity)) {
      await this.#reply([]);
      return;
    }

    // Deduplicated before the read: a listing of forty accounts held by three
    // people asks about three customers, not forty.
    const wanted = [...new Set(query.customerIds)];
    const names = await this.#repository.findNames(wanted);

    await this.#reply(names);
  }

  async #reply(names: readonly { customerId: string; fullName: string }[]): Promise<void> {
    await this.#publisher.reply({
      messageType: customerNamesRepliedV1.name,
      payload: { names },
    });
  }
}
