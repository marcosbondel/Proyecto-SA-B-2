import {
  accountInterbankCreditRejectedV1,
  accountInterbankCreditedV1,
  accountInterbankEligibilityRepliedV1,
} from '@bank/contracts';
import type {
  AccountInterbankCreditRequestedV1,
  AccountInterbankEligibilityQueryV1,
} from '@bank/contracts';

import { creditInterbank, DomainRejection } from '../domain/account';
import type { Account } from '../domain/account';
import type { AccountRepository, Clock, EventPublisher } from './ports';

/** Account Service owns both the eligibility answer and the locked money movement. */
export class InterbankAccountUseCase {
  readonly #repository: AccountRepository;
  readonly #publisher: EventPublisher;
  readonly #clock: Clock;

  constructor(deps: { repository: AccountRepository; publisher: EventPublisher; clock: Clock }) {
    this.#repository = deps.repository;
    this.#publisher = deps.publisher;
    this.#clock = deps.clock;
  }

  async eligibility(query: AccountInterbankEligibilityQueryV1): Promise<void> {
    const account = await this.#find(query);
    const reason =
      account === null
        ? 'ACCOUNT_NOT_FOUND'
        : account.status === 'ACTIVE'
          ? null
          : 'ACCOUNT_INACTIVE';
    await this.#publisher.reply({
      messageType: accountInterbankEligibilityRepliedV1.name,
      payload: {
        depositId: query.depositId,
        /*
         * La referencia con la que se preguntó, y —cuando existe— la cuenta
         * resuelta. Quien preguntó por número se entera del UUID, y quien
         * preguntó por UUID, del número.
         */
        ...(query.accountId === undefined ? {} : { accountId: query.accountId }),
        ...(query.accountNumber === undefined ? {} : { accountNumber: query.accountNumber }),
        ...(account === null ? {} : { accountId: account.accountId, accountNumber: account.accountNumber }),
        eligible: reason === null,
        reason,
      },
    });
  }

  /**
   * Acredita un depósito del banco pareja.
   *
   * **Idempotente por `depositId`** y evaluado antes de tocar el saldo: la
   * reentrega de la orden contesta lo mismo sin acreditar de nuevo.
   *
   * Acredita **incondicionalmente** en cuanto la orden llega, y eso es una
   * propiedad de la que el resto del sistema depende (B4): Payment no puede
   * cancelar ni vencer un depósito desde que ordena el crédito, precisamente
   * porque aquí no hay forma de retirar la orden. Si algún día esto aceptara una
   * contraorden, esa regla de Payment tendría que revisarse con él.
   */
  async credit(command: AccountInterbankCreditRequestedV1): Promise<void> {
    const messageType = 'account.interbank.credit.requested.v1';
    const account = await this.#find(command);
    const seen = await this.#repository.findProcessed(command.depositId, messageType);
    if (seen !== null) {
      await this.#publishOutcome(command, account, seen.resultSummary);
      return;
    }

    if (account === null) {
      await this.#reject(command, null, 'ACCOUNT_NOT_FOUND');
      return;
    }

    const now = this.#clock.now();
    try {
      const applied = await this.#repository.applyMovement({
        accountId: account.accountId,
        type: 'CREDIT',
        transactionId: null,
        idempotencyKey: command.depositId,
        messageType,
        decide: (found) => creditInterbank(found, command.amount, now),
        now,
      });
      if (applied === null) {
        await this.#reject(command, account, 'ACCOUNT_NOT_FOUND');
        return;
      }

      await this.#publishOutcome(command, applied.account, {
        outcome: 'CREDITED',
        creditedAt: applied.operation.occurredAt.toISOString(),
      });
    } catch (error) {
      if (!(error instanceof DomainRejection)) throw error;
      await this.#reject(
        command,
        account,
        error.code === 'ACCOUNT_INACTIVE' ? 'ACCOUNT_INACTIVE' : 'INVALID_REQUEST',
      );
    }
  }

  /** La cuenta que la referencia nombra, por UUID o por número del contrato. */
  async #find(reference: {
    readonly accountId?: string | undefined;
    readonly accountNumber?: string | undefined;
  }): Promise<Account | null> {
    if (reference.accountId !== undefined) {
      return await this.#repository.findById(reference.accountId);
    }

    return reference.accountNumber === undefined
      ? null
      : await this.#repository.findByNumber(reference.accountNumber);
  }

  async #reject(
    command: AccountInterbankCreditRequestedV1,
    account: Account | null,
    reason: 'ACCOUNT_NOT_FOUND' | 'ACCOUNT_INACTIVE' | 'INVALID_REQUEST',
  ): Promise<void> {
    await this.#repository.recordProcessed({
      idempotencyKey: command.depositId,
      messageType: 'account.interbank.credit.requested.v1',
      resultSummary: { outcome: 'REJECTED', reason },
    });
    await this.#publishOutcome(command, account, { outcome: 'REJECTED', reason });
  }

  async #publishOutcome(
    command: AccountInterbankCreditRequestedV1,
    account: Account | null,
    summary: Record<string, unknown>,
  ): Promise<void> {
    if (summary.outcome === 'CREDITED' || summary.outcome === 'APPLIED') {
      if (account === null) {
        throw new Error('Un crédito aplicado tiene que conocer la cuenta acreditada.');
      }
      await this.#publisher.publish({
        messageType: accountInterbankCreditedV1.name,
        payload: {
          depositId: command.depositId,
          accountId: account.accountId,
          accountNumber: account.accountNumber,
          creditedAt: summary.creditedAt ?? summary.occurredAt,
        },
      });
      return;
    }
    await this.#publisher.publish({
      messageType: accountInterbankCreditRejectedV1.name,
      payload: {
        depositId: command.depositId,
        ...(command.accountId === undefined ? {} : { accountId: command.accountId }),
        ...(command.accountNumber === undefined ? {} : { accountNumber: command.accountNumber }),
        reason: summary.reason,
      },
    });
  }
}
