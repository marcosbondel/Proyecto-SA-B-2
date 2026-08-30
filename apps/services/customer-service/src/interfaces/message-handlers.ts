import {
  customerAuthenticateV1,
  customerChangePasswordV1,
  customerGetQueryV1,
  customerPasswordResetConfirmV1,
  customerPasswordResetRequestedV1,
  customerPendingValidationQueryV1,
  customerRegisterV1,
  customerSetIdentityVerdictV1,
  customerUpdateV1,
  customerValidateIdentityV1,
  customerVerifyEmailV1,
} from '@bank/contracts';
import type { MessageEnvelope } from '@bank/contracts';

import type { AuthenticateCustomerUseCase } from '../application/authenticate-customer.use-case';
import type { ChangePasswordUseCase } from '../application/change-password.use-case';
import type { ConfirmPasswordResetUseCase } from '../application/confirm-password-reset.use-case';
import type { GetCustomerUseCase } from '../application/get-customer.use-case';
import type { GetPendingValidationUseCase } from '../application/get-pending-validation.use-case';
import type { RegisterCustomerUseCase } from '../application/register-customer.use-case';
import type { RequestPasswordResetUseCase } from '../application/request-password-reset.use-case';
import type { SetIdentityVerdictUseCase } from '../application/set-identity-verdict.use-case';
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
 * "I forgot my password", and the reset that follows it.
 *
 * Both are idempotency-guarded inside their use cases, and both must be: the
 * first issues a token that invalidates the previous one, so a broker retry
 * would kill the link the person is about to click; the second spends a token,
 * so a retry would reject a link that had just worked.
 */
export class RequestPasswordResetHandler extends ContractHandler<
  ReturnType<typeof customerPasswordResetRequestedV1.schema.parse>
> {
  public readonly messageType = customerPasswordResetRequestedV1.name;
  readonly #useCase: RequestPasswordResetUseCase;

  constructor(useCase: RequestPasswordResetUseCase) {
    super();
    this.#useCase = useCase;
  }

  protected parse(payload: unknown) {
    return customerPasswordResetRequestedV1.schema.parse(payload);
  }

  protected async run(
    payload: ReturnType<typeof customerPasswordResetRequestedV1.schema.parse>,
    envelope: MessageEnvelope<unknown>,
  ): Promise<void> {
    await this.#useCase.execute(payload, envelope.idempotencyKey);
  }
}

export class ConfirmPasswordResetHandler extends ContractHandler<
  ReturnType<typeof customerPasswordResetConfirmV1.schema.parse>
> {
  public readonly messageType = customerPasswordResetConfirmV1.name;
  readonly #useCase: ConfirmPasswordResetUseCase;

  constructor(useCase: ConfirmPasswordResetUseCase) {
    super();
    this.#useCase = useCase;
  }

  protected parse(payload: unknown) {
    return customerPasswordResetConfirmV1.schema.parse(payload);
  }

  protected async run(
    payload: ReturnType<typeof customerPasswordResetConfirmV1.schema.parse>,
    envelope: MessageEnvelope<unknown>,
  ): Promise<void> {
    await this.#useCase.execute(payload, envelope.idempotencyKey);
  }
}

/**
 * Changing a password from inside a session.
 *
 * Idempotency-guarded like its siblings, and for a reason particular to it: a
 * redelivery must not re-verify the *old* password, which the first delivery
 * has already replaced — the second attempt would report a wrong credential
 * for a change that succeeded.
 */
export class ChangePasswordHandler extends ContractHandler<
  ReturnType<typeof customerChangePasswordV1.schema.parse>
> {
  public readonly messageType = customerChangePasswordV1.name;
  readonly #useCase: ChangePasswordUseCase;

  constructor(useCase: ChangePasswordUseCase) {
    super();
    this.#useCase = useCase;
  }

  protected parse(payload: unknown) {
    return customerChangePasswordV1.schema.parse(payload);
  }

  protected async run(
    payload: ReturnType<typeof customerChangePasswordV1.schema.parse>,
    envelope: MessageEnvelope<unknown>,
  ): Promise<void> {
    await this.#useCase.execute(payload, envelope.identity, envelope.idempotencyKey);
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

/** The teller's queue of identities awaiting a verdict. A query — not guarded. */
export class GetPendingValidationHandler extends ContractHandler<
  ReturnType<typeof customerPendingValidationQueryV1.schema.parse>
> {
  public readonly messageType = customerPendingValidationQueryV1.name;
  readonly #useCase: GetPendingValidationUseCase;

  constructor(useCase: GetPendingValidationUseCase) {
    super();
    this.#useCase = useCase;
  }

  protected parse(payload: unknown) {
    return customerPendingValidationQueryV1.schema.parse(payload);
  }

  protected async run(
    payload: ReturnType<typeof customerPendingValidationQueryV1.schema.parse>,
    envelope: MessageEnvelope<unknown>,
  ): Promise<void> {
    await this.#useCase.execute(payload, envelope.identity);
  }
}

/** A teller's manual VALIDATED/REJECTED verdict on an identity document. */
export class SetIdentityVerdictHandler extends ContractHandler<
  ReturnType<typeof customerSetIdentityVerdictV1.schema.parse>
> {
  public readonly messageType = customerSetIdentityVerdictV1.name;
  readonly #useCase: SetIdentityVerdictUseCase;

  constructor(useCase: SetIdentityVerdictUseCase) {
    super();
    this.#useCase = useCase;
  }

  protected parse(payload: unknown) {
    return customerSetIdentityVerdictV1.schema.parse(payload);
  }

  protected async run(
    payload: ReturnType<typeof customerSetIdentityVerdictV1.schema.parse>,
    envelope: MessageEnvelope<unknown>,
  ): Promise<void> {
    await this.#useCase.execute(payload, envelope.identity, envelope.idempotencyKey);
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
