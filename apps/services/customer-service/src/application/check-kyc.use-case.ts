import { customerKycCheckedV1 } from '@bank/contracts';
import type { CustomerKycCheckRequestedV1 } from '@bank/contracts';

import { mayInitiateTransactions } from '../domain/customer';
import type { CustomerRepository, EventPublisher } from './ports';

/**
 * The Saga's own KYC gate (T-31, §4.1 p. 4), asked from the outside rather
 * than read from the inside.
 *
 * This is what closes the gap `mayInitiateTransactions` left open since T-26:
 * that function was already the domain's answer to "may this customer
 * transact", but nothing outside this service could call it without reading
 * this service's own table (X-1). `customer.kyc.check.requested.v1` is
 * Transaction Service asking the question the same way it orders a debit, and
 * this use case is the only thing that answers it.
 *
 * Not idempotency-guarded, for the same reason `GetCustomerHandler` is not: it
 * is a question, not a movement, so a redelivery must produce a fresh answer
 * rather than a silence that leaves the Saga waiting. Asking twice is
 * harmless — see `domain/transaction.ts`'s own note on `KYC_CHECK_ORDERED`
 * being a self-transition.
 *
 * A customer this service cannot find at all is answered `allowed: false`:
 * the Saga always gets a verdict, and a transfer that names a bad customer
 * reference belongs in `FAILED`, not stuck waiting for an answer that will
 * never come.
 */
export class CheckKycUseCase {
  readonly #repository: CustomerRepository;
  readonly #publisher: EventPublisher;

  constructor(dependencies: {
    readonly repository: CustomerRepository;
    readonly publisher: EventPublisher;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
  }

  public async execute(payload: CustomerKycCheckRequestedV1): Promise<void> {
    const customer = await this.#repository.findById(payload.customerId);

    if (customer === null) {
      await this.#publisher.publish({
        messageType: customerKycCheckedV1.name,
        payload: {
          transactionId: payload.transactionId,
          customerId: payload.customerId,
          kycStatus: 'PENDING',
          allowed: false,
        },
      });

      return;
    }

    await this.#publisher.publish({
      messageType: customerKycCheckedV1.name,
      payload: {
        transactionId: payload.transactionId,
        customerId: customer.customerId,
        kycStatus: customer.kycStatus,
        allowed: mayInitiateTransactions(customer),
      },
    });
  }
}
