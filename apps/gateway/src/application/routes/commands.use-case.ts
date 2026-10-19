import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
  accountCreateV1,
  accountSetStatusV1,
  customerSetIdentityVerdictV1,
  customerSetKycStatusV1,
  customerUpdateV1,
  transferRequestedV1,
} from '@bank/contracts';
import type { AccountType, Identity, Money } from '@bank/contracts';
import type { PaymentScenario } from '@bank/contracts';

import { GatewayError } from '../errors/gateway-error';
import { MESSAGE_PUBLISHER, type MessagePublisherPort } from '../ports';
import { envelopeForRequest } from '../request-envelope';

/** What every asynchronous route needs to know about the caller. */
export interface CommandContext {
  readonly actor: Identity;
  readonly correlationId: string;
  readonly idempotencyKey: string;
}

export interface AcceptedCommand {
  readonly correlationId: string;
}

export interface UpdateCustomerRequest extends CommandContext {
  /** The **subject** — who is being updated. From the path, not the token. */
  readonly customerId: string;
  readonly fullName?: string;
  readonly address?: string;
  readonly dateOfBirth?: string;
}

export interface SetIdentityVerdictRequest extends CommandContext {
  readonly customerId: string;
  readonly verdict: 'VALIDATED' | 'REJECTED';
}

export interface SetKycStatusRequest extends CommandContext {
  readonly customerId: string;
  readonly status: 'VERIFIED' | 'REJECTED';
}

export interface OpenAccountRequest extends CommandContext {
  readonly accountType: AccountType;
  /** The subject. Absent means "myself", which is the common case. */
  readonly customerId?: string;
  /** AHORRO's minimum-opening-deposit rule (T-27) is Account Service's to enforce. */
  readonly initialDeposit?: Money;
}

export interface SetAccountStatusRequest extends CommandContext {
  readonly accountId: string;
  readonly status: 'ACTIVE' | 'INACTIVE';
  /** Obligatorio al desactivar; al activar puede faltar. */
  readonly reason?: string;
}

export interface TransferRequest extends CommandContext {
  readonly sourceAccount: string;
  readonly targetAccount: string;
  readonly amount: Money;
  /** Carried when staff initiates on behalf of customer. */
  readonly customerId?: string;
  /** Carried when the target is a biller's collection account. Never read here. */
  readonly reference?: string;
  readonly paymentScenario?: PaymentScenario;
  /**
   * A dónde va de verdad el dinero, cuando el destino está en otro banco
   * (T-47).
   *
   * Cuando viene, `targetAccount` es la cuenta de liquidación interbancaria de
   * este banco y esto dice a qué banco y a qué cuenta de allá corresponde. El
   * Gateway no lo interpreta —no sabe si esa cuenta existe en el otro banco, y
   * no le toca— pero sí **mina los dos identificadores**, que es lo único de
   * este bloque que no puede venir de fuera: el `interbankTransferId` es la
   * clave con la que el otro banco deduplica, y uno adivinable desde fuera es
   * uno que se puede colisionar a propósito.
   */
  readonly interbank?: {
    readonly bankCode: string;
    readonly account: string;
    /** La cuenta de este banco de la que sale el dinero (`02-NNNNNNNNN`), que el contrato exige. */
    readonly originAccount: string;
    readonly interbankTransferId: string;
    readonly idempotencyKey: string;
  };
}

/**
 * The four commands whose answer arrives later, if at all.
 *
 * They share one shape, and it is the shape constitution V describes: validate
 * the request against its contract, wrap it with the verified identity, publish
 * it, and say `202`. No balance is computed, no approval is decided, no Saga is
 * orchestrated. The gateway's opinion about any of these is that it has none.
 */
@Injectable()
export class CommandsUseCase {
  readonly #publisher: MessagePublisherPort;

  constructor(@Inject(MESSAGE_PUBLISHER) publisher: MessagePublisherPort) {
    this.#publisher = publisher;
  }

  public async updateCustomer(request: UpdateCustomerRequest): Promise<AcceptedCommand> {
    await this.#publish(
      customerUpdateV1,
      {
        customerId: request.customerId,
        ...(request.fullName === undefined ? {} : { fullName: request.fullName }),
        ...(request.address === undefined ? {} : { address: request.address }),
        ...(request.dateOfBirth === undefined ? {} : { dateOfBirth: request.dateOfBirth }),
      },
      request,
    );

    return { correlationId: request.correlationId };
  }

  /** A teller's manual identity verdict. Authorisation is the owning service's. */
  public async setIdentityVerdict(
    request: SetIdentityVerdictRequest,
  ): Promise<AcceptedCommand> {
    await this.#publish(
      customerSetIdentityVerdictV1,
      { customerId: request.customerId, verdict: request.verdict },
      request,
    );

    return { correlationId: request.correlationId };
  }

  /**
   * A teller's manual KYC verdict (T-31, §4.1 p. 4). Distinct from
   * `setIdentityVerdict`: this is the broader compliance decision the
   * transfer Saga's own KYC gate reads, not Fase 1's document-photo review.
   * Authorisation is the owning service's, made from the envelope identity.
   */
  public async setKycStatus(request: SetKycStatusRequest): Promise<AcceptedCommand> {
    await this.#publish(
      customerSetKycStatusV1,
      { customerId: request.customerId, status: request.status },
      request,
    );

    return { correlationId: request.correlationId };
  }

  public async openAccount(
    request: OpenAccountRequest,
  ): Promise<AcceptedCommand & { readonly accountId: string }> {
    const accountId = randomUUID();

    await this.#publish(
      accountCreateV1,
      {
        accountId,
        // Subject defaults to the actor. A cashier may name someone else;
        // whether they may operate on that person is Account Service's call.
        customerId: request.customerId ?? request.actor.customerId,
        accountType: request.accountType,
        ...(request.initialDeposit === undefined ? {} : { initialDeposit: request.initialDeposit }),
      },
      request,
    );

    return { accountId, correlationId: request.correlationId };
  }

  /**
   * Deactivating or reactivating an account by hand.
   *
   * The gateway checks the **role** — D-06 gives this to `ADMINISTRADOR`
   * alone — and stops there. Whether this particular account should change
   * state is a decision about data the gateway does not hold, so Account
   * Service makes it and this one carries the verified identity along so it
   * can. Both checks exist: this one keeps the route honest, and the service's
   * keeps the message honest whatever publishes it.
   */
  public async setAccountStatus(request: SetAccountStatusRequest): Promise<AcceptedCommand> {
    await this.#publish(
      accountSetStatusV1,
      {
        accountId: request.accountId,
        status: request.status,
        ...(request.reason === undefined ? {} : { reason: request.reason }),
      },
      request,
    );

    return { correlationId: request.correlationId };
  }

  public async requestTransfer(
    request: TransferRequest,
  ): Promise<AcceptedCommand & { readonly transactionId: string }> {
    const transactionId = randomUUID();

    await this.#publish(
      transferRequestedV1,
      {
        transactionId,
        sourceAccount: request.sourceAccount,
        targetAccount: request.targetAccount,
        amount: request.amount,
        ...(request.customerId === undefined ? {} : { customerId: request.customerId }),
        // Carried when the target is a biller's collection account. Never read here.
        ...(request.reference === undefined ? {} : { reference: request.reference }),
        // Carried, never obeyed. Acting on it is Transaction Service's job.
        ...(request.paymentScenario === undefined
          ? {}
          : { paymentScenario: request.paymentScenario }),
        // El destino en el otro banco (T-47). Igual que los dos de arriba: se
        // lleva y no se obedece — quien habla con el banco pareja es Payment.
        ...(request.interbank === undefined ? {} : { interbank: request.interbank }),
      },
      request,
    );

    return { transactionId, correlationId: request.correlationId };
  }

  /**
   * Checks the payload against the contract that defines it, then publishes.
   *
   * The DTO already validated shape at the edge. Re-checking here against
   * `@bank/contracts` is what stops the two from drifting: a contract that
   * gains a rule the DTO does not know about still refuses the message, at the
   * gateway, before it can die somewhere the caller cannot see.
   */
  async #publish(
    contract: { readonly name: string; readonly schema: { safeParse: (value: unknown) => unknown } },
    payload: unknown,
    context: CommandContext,
  ): Promise<void> {
    const parsed = contract.schema.safeParse(payload) as
      | { success: true; data: unknown }
      | { success: false; error: { issues: { message: string; path: (string | number)[] }[] } };

    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw GatewayError.validation(
        issue?.message ?? 'La solicitud no cumple el contrato.',
        issue?.path.join('.'),
      );
    }

    await this.#publisher.publish(
      envelopeForRequest(parsed.data, contract.name, context.actor, context.correlationId, {
        idempotencyKey: context.idempotencyKey,
      }),
    );
  }
}
