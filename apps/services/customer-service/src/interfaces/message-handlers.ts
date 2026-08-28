import {
  customerAuthenticateV1,
  customerGetQueryV1,
  customerRegisterV1,
  customerUpdateV1,
  customerValidateIdentityV1,
  customerVerifyEmailV1,
} from '@bank/contracts';
import type { MessageEnvelope } from '@bank/contracts';

import type { AuthenticateCustomerUseCase } from '../application/authenticate-customer.use-case';
import type { GetCustomerUseCase } from '../application/get-customer.use-case';
import type { RegisterCustomerUseCase } from '../application/register-customer.use-case';
import type { UpdateCustomerUseCase } from '../application/update-customer.use-case';
import type { ValidateIdentityUseCase } from '../application/validate-identity.use-case';
import type { VerifyEmailActivationUseCase } from '../application/verify-email-activation.use-case';
import type { InboundMessageHandler } from './inbound-message.handler';

/**
 * The five commands this service answers, each parsed before it is believed.
 *
 * Parsing at the edge is not ceremony. The broker hands over whatever was
 * published, and a payload that does not match its contract is a message this
 * service cannot act on — failing here names the contract and the field, while
 * failing three layers down names a property of `undefined`.
 *
 * A handler that throws is retried by the ladder and then dead-lettered. That
 * is right for a database that is down and wrong for a rejected password, which
 * is why every business refusal is an answer these handlers return normally,
 * never an exception they raise.
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

export class RegisterCustomerHandler extends ContractHandler<
  ReturnType<typeof customerRegisterV1.schema.parse>
> {
  public readonly messageType = customerRegisterV1.name;
  readonly #useCase: RegisterCustomerUseCase;

  constructor(useCase: RegisterCustomerUseCase) {
    super();
    this.#useCase = useCase;
  }

  protected parse(payload: unknown) {
    return customerRegisterV1.schema.parse(payload);
  }

  protected async run(
    payload: ReturnType<typeof customerRegisterV1.schema.parse>,
    envelope: MessageEnvelope<unknown>,
  ): Promise<void> {
    await this.#useCase.execute(payload, envelope.idempotencyKey, envelope.identity);
  }
}

export class UpdateCustomerHandler extends ContractHandler<
  ReturnType<typeof customerUpdateV1.schema.parse>
> {
  public readonly messageType = customerUpdateV1.name;
  readonly #useCase: UpdateCustomerUseCase;

  constructor(useCase: UpdateCustomerUseCase) {
    super();
    this.#useCase = useCase;
  }

  protected parse(payload: unknown) {
    return customerUpdateV1.schema.parse(payload);
  }

  protected async run(
    payload: ReturnType<typeof customerUpdateV1.schema.parse>,
    envelope: MessageEnvelope<unknown>,
  ): Promise<void> {
    await this.#useCase.execute(payload, envelope.identity, envelope.idempotencyKey);
  }
}

/**
 * Sign-in, the one command with somebody waiting on the other end.
 *
 * It is deliberately **not** idempotency-guarded: authentication changes
 * nothing, and a redelivery must produce a fresh reply rather than a silence
 * that leaves the Gateway waiting out its five seconds.
 */
export class AuthenticateCustomerHandler extends ContractHandler<
  ReturnType<typeof customerAuthenticateV1.schema.parse>
> {
  public readonly messageType = customerAuthenticateV1.name;
  readonly #useCase: AuthenticateCustomerUseCase;

  constructor(useCase: AuthenticateCustomerUseCase) {
    super();
    this.#useCase = useCase;
  }

  protected parse(payload: unknown) {
    return customerAuthenticateV1.schema.parse(payload);
  }

  protected async run(
    payload: ReturnType<typeof customerAuthenticateV1.schema.parse>,
  ): Promise<void> {
    await this.#useCase.execute(payload);
  }
}

export class VerifyEmailHandler extends ContractHandler<
  ReturnType<typeof customerVerifyEmailV1.schema.parse>
> {
  public readonly messageType = customerVerifyEmailV1.name;
  readonly #useCase: VerifyEmailActivationUseCase;

  constructor(useCase: VerifyEmailActivationUseCase) {
    super();
    this.#useCase = useCase;
  }

  protected parse(payload: unknown) {
    return customerVerifyEmailV1.schema.parse(payload);
  }

  protected async run(
    payload: ReturnType<typeof customerVerifyEmailV1.schema.parse>,
    envelope: MessageEnvelope<unknown>,
  ): Promise<void> {
    await this.#useCase.execute(payload, envelope.idempotencyKey);
  }
}

/**
 * Reading a customer, the first query this service answers.
 *
 * Not idempotency-guarded: a query changes nothing, and a redelivery must
 * produce a fresh reply rather than a silence that leaves the Gateway waiting.
 */
export class GetCustomerHandler extends ContractHandler<
  ReturnType<typeof customerGetQueryV1.schema.parse>
> {
  public readonly messageType = customerGetQueryV1.name;
  readonly #useCase: GetCustomerUseCase;

  constructor(useCase: GetCustomerUseCase) {
    super();
    this.#useCase = useCase;
  }

  protected parse(payload: unknown) {
    return customerGetQueryV1.schema.parse(payload);
  }

  protected async run(
    payload: ReturnType<typeof customerGetQueryV1.schema.parse>,
    envelope: MessageEnvelope<unknown>,
  ): Promise<void> {
    await this.#useCase.execute(payload, envelope.identity);
  }
}

export class ValidateIdentityHandler extends ContractHandler<
  ReturnType<typeof customerValidateIdentityV1.schema.parse>
> {
  public readonly messageType = customerValidateIdentityV1.name;
  readonly #useCase: ValidateIdentityUseCase;

  constructor(useCase: ValidateIdentityUseCase) {
    super();
    this.#useCase = useCase;
  }

  protected parse(payload: unknown) {
    return customerValidateIdentityV1.schema.parse(payload);
  }

  protected async run(
    payload: ReturnType<typeof customerValidateIdentityV1.schema.parse>,
    envelope: MessageEnvelope<unknown>,
  ): Promise<void> {
    await this.#useCase.execute(payload, envelope.idempotencyKey);
  }
}
