import {
  accountBalanceQueryV1,
  accountCreateV1,
  accountCreditRequestedV1,
  accountBillersQueryV1,
  accountDepositV1,
  accountDebitCompensationRequestedV1,
  accountDebitRequestedV1,
  accountListQueryV1,
  accountOperationsQueryV1,
  accountSetStatusV1,
} from '@bank/contracts';
import type { MessageEnvelope } from '@bank/contracts';

import type { CompensateDebitUseCase } from '../application/compensate-debit.use-case';
import type { CreateAccountUseCase } from '../application/create-account.use-case';
import type { CreditAccountUseCase } from '../application/credit-account.use-case';
import type { DepositUseCase } from '../application/deposit.use-case';
import type { ListBillersUseCase } from '../application/list-billers.use-case';
import type { DebitAccountUseCase } from '../application/debit-account.use-case';
import type { GetBalanceUseCase } from '../application/get-balance.use-case';
import type { GetOperationsUseCase } from '../application/get-operations.use-case';
import type { ListAccountsUseCase } from '../application/list-accounts.use-case';
import type { SetAccountStatusUseCase } from '../application/set-account-status.use-case';
import type { InboundMessageHandler } from './inbound-message.handler';

/**
 * The eight commands this service answers, each parsed before it is believed.
 *
 * Parsing at the edge is not ceremony. The broker hands over whatever was
 * published, and a payload that does not match its contract is a message this
 * service cannot act on — failing here names the contract and the field, while
 * failing three layers down names a property of `undefined`.
 *
 * A handler that throws is retried by the ladder and then dead-lettered. That
 * is right for a database that is down and wrong for an insufficient balance,
 * which is why every business refusal is an answer these handlers return
 * normally, never an exception they raise.
 */

/** Shared shape: parse, then hand the payload to a use case. */
abstract class ContractHandler<TPayload> implements InboundMessageHandler {
  public abstract readonly messageType: string;

  public async handle(envelope: MessageEnvelope<unknown>): Promise<void> {
    const parsed = this.parse(envelope.payload);

    await this.run(parsed, envelope);
  }

  protected abstract parse(payload: unknown): TPayload;

  protected abstract run(payload: TPayload, envelope: MessageEnvelope<unknown>): Promise<void>;
}

export class CreateAccountHandler extends ContractHandler<
  ReturnType<typeof accountCreateV1.schema.parse>
> {
  public readonly messageType = accountCreateV1.name;
  readonly #useCase: CreateAccountUseCase;

  constructor(useCase: CreateAccountUseCase) {
    super();
    this.#useCase = useCase;
  }

  protected parse(payload: unknown) {
    return accountCreateV1.schema.parse(payload);
  }

  protected async run(
    payload: ReturnType<typeof accountCreateV1.schema.parse>,
    envelope: MessageEnvelope<unknown>,
  ): Promise<void> {
    await this.#useCase.execute(payload, envelope.identity, envelope.idempotencyKey);
  }
}

/**
 * The three queries are **not** idempotency-guarded, deliberately.
 *
 * A query changes nothing, and a redelivery must produce a fresh reply rather
 * than a silence that leaves the Gateway waiting out its five seconds.
 */
export class GetBalanceHandler extends ContractHandler<
  ReturnType<typeof accountBalanceQueryV1.schema.parse>
> {
  public readonly messageType = accountBalanceQueryV1.name;
  readonly #useCase: GetBalanceUseCase;

  constructor(useCase: GetBalanceUseCase) {
    super();
    this.#useCase = useCase;
  }

  protected parse(payload: unknown) {
    return accountBalanceQueryV1.schema.parse(payload);
  }

  protected async run(
    payload: ReturnType<typeof accountBalanceQueryV1.schema.parse>,
    envelope: MessageEnvelope<unknown>,
  ): Promise<void> {
    await this.#useCase.execute(payload, envelope.identity);
  }
}

export class ListAccountsHandler extends ContractHandler<
  ReturnType<typeof accountListQueryV1.schema.parse>
> {
  public readonly messageType = accountListQueryV1.name;
  readonly #useCase: ListAccountsUseCase;

  constructor(useCase: ListAccountsUseCase) {
    super();
    this.#useCase = useCase;
  }

  protected parse(payload: unknown) {
    return accountListQueryV1.schema.parse(payload);
  }

  protected async run(
    payload: ReturnType<typeof accountListQueryV1.schema.parse>,
    envelope: MessageEnvelope<unknown>,
  ): Promise<void> {
    await this.#useCase.execute(payload, envelope.identity);
  }
}

export class GetOperationsHandler extends ContractHandler<
  ReturnType<typeof accountOperationsQueryV1.schema.parse>
> {
  public readonly messageType = accountOperationsQueryV1.name;
  readonly #useCase: GetOperationsUseCase;

  constructor(useCase: GetOperationsUseCase) {
    super();
    this.#useCase = useCase;
  }

  protected parse(payload: unknown) {
    return accountOperationsQueryV1.schema.parse(payload);
  }

  protected async run(
    payload: ReturnType<typeof accountOperationsQueryV1.schema.parse>,
    envelope: MessageEnvelope<unknown>,
  ): Promise<void> {
    await this.#useCase.execute(payload, envelope.identity);
  }
}

export class DebitAccountHandler extends ContractHandler<
  ReturnType<typeof accountDebitRequestedV1.schema.parse>
> {
  public readonly messageType = accountDebitRequestedV1.name;
  readonly #useCase: DebitAccountUseCase;

  constructor(useCase: DebitAccountUseCase) {
    super();
    this.#useCase = useCase;
  }

  protected parse(payload: unknown) {
    return accountDebitRequestedV1.schema.parse(payload);
  }

  protected async run(
    payload: ReturnType<typeof accountDebitRequestedV1.schema.parse>,
    envelope: MessageEnvelope<unknown>,
  ): Promise<void> {
    await this.#useCase.execute(payload, envelope.idempotencyKey);
  }
}

export class CreditAccountHandler extends ContractHandler<
  ReturnType<typeof accountCreditRequestedV1.schema.parse>
> {
  public readonly messageType = accountCreditRequestedV1.name;
  readonly #useCase: CreditAccountUseCase;

  constructor(useCase: CreditAccountUseCase) {
    super();
    this.#useCase = useCase;
  }

  protected parse(payload: unknown) {
    return accountCreditRequestedV1.schema.parse(payload);
  }

  protected async run(
    payload: ReturnType<typeof accountCreditRequestedV1.schema.parse>,
    envelope: MessageEnvelope<unknown>,
  ): Promise<void> {
    await this.#useCase.execute(payload, envelope.idempotencyKey);
  }
}

/**
 * A deposit at a window.
 *
 * The only movement handler that reads the **identity** off the envelope: the
 * Saga's debits and credits are ordered by Transaction Service and carry
 * whoever originated the transfer, while this one mints money into an account
 * from outside the system and the service that moves the balance has to be sure
 * a teller asked for it.
 */
export class DepositHandler extends ContractHandler<
  ReturnType<typeof accountDepositV1.schema.parse>
> {
  public readonly messageType = accountDepositV1.name;
  readonly #useCase: DepositUseCase;

  constructor(useCase: DepositUseCase) {
    super();
    this.#useCase = useCase;
  }

  protected parse(payload: unknown) {
    return accountDepositV1.schema.parse(payload);
  }

  protected async run(
    payload: ReturnType<typeof accountDepositV1.schema.parse>,
    envelope: MessageEnvelope<unknown>,
  ): Promise<void> {
    await this.#useCase.execute(payload, envelope.identity, envelope.idempotencyKey);
  }
}

/**
 * The biller catalogue. The only query in this service with no arguments and no
 * scope: the list of services the bank collects for is the same for everybody.
 */
export class ListBillersHandler extends ContractHandler<
  ReturnType<typeof accountBillersQueryV1.schema.parse>
> {
  public readonly messageType = accountBillersQueryV1.name;
  readonly #useCase: ListBillersUseCase;

  constructor(useCase: ListBillersUseCase) {
    super();
    this.#useCase = useCase;
  }

  protected parse(payload: unknown) {
    return accountBillersQueryV1.schema.parse(payload);
  }

  protected async run(): Promise<void> {
    await this.#useCase.execute();
  }
}

export class CompensateDebitHandler extends ContractHandler<
  ReturnType<typeof accountDebitCompensationRequestedV1.schema.parse>
> {
  public readonly messageType = accountDebitCompensationRequestedV1.name;
  readonly #useCase: CompensateDebitUseCase;

  constructor(useCase: CompensateDebitUseCase) {
    super();
    this.#useCase = useCase;
  }

  protected parse(payload: unknown) {
    return accountDebitCompensationRequestedV1.schema.parse(payload);
  }

  protected async run(
    payload: ReturnType<typeof accountDebitCompensationRequestedV1.schema.parse>,
    envelope: MessageEnvelope<unknown>,
  ): Promise<void> {
    await this.#useCase.execute(payload, envelope.idempotencyKey);
  }
}

export class SetAccountStatusHandler extends ContractHandler<
  ReturnType<typeof accountSetStatusV1.schema.parse>
> {
  public readonly messageType = accountSetStatusV1.name;
  readonly #useCase: SetAccountStatusUseCase;

  constructor(useCase: SetAccountStatusUseCase) {
    super();
    this.#useCase = useCase;
  }

  protected parse(payload: unknown) {
    return accountSetStatusV1.schema.parse(payload);
  }

  protected async run(
    payload: ReturnType<typeof accountSetStatusV1.schema.parse>,
    envelope: MessageEnvelope<unknown>,
  ): Promise<void> {
    await this.#useCase.execute(payload, envelope.identity, envelope.idempotencyKey);
  }
}
