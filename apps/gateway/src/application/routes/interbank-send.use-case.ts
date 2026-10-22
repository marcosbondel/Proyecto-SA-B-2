import { INTERBANK_SETTLEMENT_ACCOUNT_ID, v1AmountFromMinor } from '@bank/contracts';
import type { Identity, Money } from '@bank/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { deriveUuidV4 } from '../derived-id';
import {
  INTERBANK_BANK_CODE,
  INTERBANK_ID_SECRET,
  INTERBANK_MAX_AMOUNT_MINOR,
  INTERBANK_PARTNER_BANK_CODES,
} from '../interbank-config';
import { GatewayError } from '../errors/gateway-error';
import { CommandsUseCase } from './commands.use-case';
import { QueriesUseCase } from './queries.use-case';

/**
 * Enviar un depósito al banco pareja (T-47, completado en T-60).
 *
 * **Qué valida el Gateway y qué no.** Valida lo que es del *formato* del
 * contrato y del acuerdo, que es un borde y no una regla de negocio: la moneda
 * (`GTQ`, la única que el contrato admite), el banco destino (el pareja
 * configurado, no el propio ni uno desconocido) y el monto contra el límite por
 * operación. Ninguna de las tres necesita un dato que el Gateway no tenga, y
 * rechazarlas aquí significa que **no se debita nada** — a diferencia de
 * dejarlas pasar y que Payment las decline con el dinero ya fuera de la cuenta.
 *
 * Lo que no valida, porque no puede y no le toca: que la cuenta destino exista
 * ni esté activa en el otro banco (lo dirá su callback `REJECTED`), que el
 * cliente esté `VERIFIED` (la Saga abre con la puerta de KYC y cierra en
 * `FAILED` sin mover dinero) ni que la cuenta origen sea suya (Account responde
 * `NOT_FOUND` a quien no la puede ver).
 *
 * **Lo único que consulta** es el número de la cuenta origen: el contrato exige
 * `originAccount` (`02-NNNNNNNNN`) y sólo Account lo tiene. Es una pregunta por
 * el broker, con la visibilidad de Account, y no una lectura de su tabla.
 */
@Injectable()
export class InterbankSendUseCase {
  constructor(
    @Inject(CommandsUseCase) readonly commands: CommandsUseCase,
    @Inject(QueriesUseCase) readonly queries: QueriesUseCase,
    @Inject(INTERBANK_BANK_CODE) readonly ownBankCode: string,
    @Inject(INTERBANK_PARTNER_BANK_CODES) readonly partnerBankCodes: readonly string[],
    @Inject(INTERBANK_MAX_AMOUNT_MINOR) readonly maxAmountMinor: number,
    @Inject(INTERBANK_ID_SECRET) readonly idSecret: string,
  ) {}

  async send(input: {
    readonly sourceAccount: string;
    readonly destinationBankCode: string;
    readonly destinationAccount: string;
    readonly amount: Money;
    readonly actor: Identity;
    readonly correlationId: string;
    readonly idempotencyKey: string;
  }): Promise<{
    readonly transactionId: string;
    readonly interbankTransferId: string;
    readonly correlationId: string;
  }> {
    this.#validate(input);

    const originAccount = await this.queries.accountNumberOf(input.sourceAccount, {
      actor: input.actor,
      correlationId: input.correlationId,
    });

    /*
     * El Gateway mina los dos identificadores que no pueden venir de fuera: el
     * `interbankTransferId`, que es la clave con la que el OTRO banco deduplica
     * (y debe ser un UUID: el contrato lo declara `format: uuid`), y la clave de
     * idempotencia del depósito, que el contrato obliga a que sea igual a él.
     * Uno adivinable desde fuera es uno que se puede colisionar a propósito — y
     * un depósito duplicado es el 50 % de §8.3.
     */
    /*
     * Derivados, no aleatorios (D7b): la misma `Idempotency-Key` del mismo
     * cliente da los mismos identificadores. Transaction ya hace que un
     * reintento produzca un solo débito; esto hace que además devuelva el id
     * del original en vez de uno nuevo que no nombra nada y da 404. Sin cabecera
     * la clave es aleatoria por petición, y los identificadores con ella.
     */
    const interbankTransferId = deriveUuidV4(
      this.idSecret,
      'interbank-transfer',
      input.actor.customerId,
      input.idempotencyKey,
    );
    const transactionId = deriveUuidV4(
      this.idSecret,
      'interbank-transaction',
      input.actor.customerId,
      input.idempotencyKey,
    );
    const accepted = await this.commands.requestTransfer({
      transactionId,
      sourceAccount: input.sourceAccount,
      // Siempre la cuenta de liquidación: el cliente no elige dónde entra.
      targetAccount: INTERBANK_SETTLEMENT_ACCOUNT_ID,
      amount: { amountMinor: input.amount.amountMinor, currency: input.amount.currency },
      interbank: {
        bankCode: input.destinationBankCode,
        account: input.destinationAccount,
        originAccount,
        interbankTransferId,
        idempotencyKey: interbankTransferId,
      },
      actor: input.actor,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
    });

    return { ...accepted, interbankTransferId };
  }

  #validate(input: {
    readonly destinationBankCode: string;
    readonly amount: Money;
  }): void {
    if (input.destinationBankCode === this.ownBankCode) {
      throw GatewayError.validation(
        'No se puede enviar un depósito interbancario al propio banco; use una transferencia.',
        'destinationBankCode',
      );
    }

    // Cualquier banco del registro (T-60): el de la configuración original y
    // los de `INTERBANK_PARTNERS`. Uno fuera de él no tiene a dónde ir.
    if (!this.partnerBankCodes.includes(input.destinationBankCode)) {
      throw GatewayError.validation(
        `El banco ${input.destinationBankCode} no está habilitado para depósitos interbancarios.`,
        'destinationBankCode',
      );
    }

    if (input.amount.currency !== 'GTQ') {
      throw GatewayError.validation(
        'El contrato interbancario sólo admite depósitos en GTQ.',
        'amount.currency',
      );
    }

    if (input.amount.amountMinor > this.maxAmountMinor) {
      throw GatewayError.validation(
        `El monto excede el límite por operación de Q${v1AmountFromMinor(this.maxAmountMinor)}.`,
        'amount.amountMinor',
      );
    }
  }
}
