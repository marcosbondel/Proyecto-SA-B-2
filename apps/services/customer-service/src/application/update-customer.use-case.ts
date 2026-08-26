import { customerUpdatedV1 } from '@bank/contracts';
import type { CustomerUpdateV1 } from '@bank/contracts';

import { DomainRejection, applyChanges } from '../domain/customer';
import type { Clock, CustomerRepository, EventPublisher } from './ports';

const MESSAGE_TYPE = 'customer.update.v1';

/**
 * Changing a customer's data, and saying exactly what changed.
 *
 * The event carries the **names** of the changed fields, never their values, so
 * the audit store never becomes a second copy of the customer. That also makes
 * "changed nothing" a real case worth handling: a command whose values match
 * what is already stored records itself as processed and publishes nothing,
 * because an event claiming a change that did not happen is a lie the audit
 * record keeps forever.
 *
 * A command for a customer that does not exist is **not** an error to retry.
 * Redelivering it four times cannot make the customer appear; it is recorded as
 * processed and dropped, so the dead-letter queue keeps its meaning.
 */
export class UpdateCustomerUseCase {
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

  public async execute(command: CustomerUpdateV1, idempotencyKey: string): Promise<void> {
    const seen = await this.#repository.findProcessed(idempotencyKey, MESSAGE_TYPE);

    if (seen !== null) {
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

    let result;

    try {
      result = applyChanges(
        existing,
        {
          ...(command.fullName === undefined ? {} : { fullName: command.fullName }),
          ...(command.address === undefined ? {} : { address: command.address }),
          ...(command.dateOfBirth === undefined ? {} : { dateOfBirth: command.dateOfBirth }),
        },
        this.#clock.now(),
      );
    } catch (error) {
      if (error instanceof DomainRejection) {
        // C-5 refused the date. Nothing was written, and the refusal is
        // recorded so a redelivery does not re-evaluate it.
        await this.#repository.recordProcessed({
          idempotencyKey,
          messageType: MESSAGE_TYPE,
          resultSummary: { outcome: 'REJECTED', reason: error.code },
        });
        return;
      }

      throw error;
    }

    if (result.changedFields.length === 0) {
      await this.#repository.recordProcessed({
        idempotencyKey,
        messageType: MESSAGE_TYPE,
        resultSummary: { outcome: 'UNCHANGED', customerId: command.customerId },
      });
      return;
    }

    await this.#repository.saveUpdate({
      customer: result.customer,
      idempotency: {
        idempotencyKey,
        messageType: MESSAGE_TYPE,
        resultSummary: {
          outcome: 'UPDATED',
          customerId: command.customerId,
          changedFields: [...result.changedFields],
        },
      },
    });

    await this.#publisher.publish({
      messageType: customerUpdatedV1.name,
      payload: {
        customerId: result.customer.customerId,
        changedFields: [...result.changedFields],
        updatedAt: result.customer.updatedAt,
      },
    });
  }
}
