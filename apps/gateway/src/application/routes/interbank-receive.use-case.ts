import { createHash } from 'node:crypto';

import {
  interbankDepositRequest,
  interbankMinorUnits,
  paymentInterbankReceiveV1,
} from '@bank/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { GatewayError } from '../errors/gateway-error';
import { MESSAGE_PUBLISHER } from '../ports';
import type { MessagePublisherPort } from '../ports';
import { envelopeForRequest } from '../request-envelope';

/** El cuerpo que manda el banco pareja vive en `@bank/contracts` (T-56). */
const inputSchema = interbankDepositRequest;

/** An authenticated partner request becomes one broker command and a 202 receipt. */
@Injectable()
export class InterbankReceiveUseCase {
  constructor(@Inject(MESSAGE_PUBLISHER) readonly publisher: MessagePublisherPort) {}

  async receive(
    body: unknown,
    correlationId: string,
  ): Promise<{ depositId: string; correlationId: string }> {
    const input = inputSchema.safeParse(body);
    if (!input.success) {
      throw GatewayError.validation(
        input.error.issues[0]?.message ?? 'Solicitud interbancaria inválida.',
        input.error.issues[0]?.path.join('.'),
      );
    }
    const { timestamp, amount, ...resto } = input.data;
    const amountMinor =
      'amountMinor' in amount ? amount.amountMinor : interbankMinorUnits(amount.value);

    if (amountMinor === null) {
      throw GatewayError.validation(
        'El monto no es un decimal de dos cifras ni un entero de centavos.',
        'amount',
      );
    }

    const payload = paymentInterbankReceiveV1.schema.parse({
      ...resto,
      amount: { amountMinor, currency: amount.currency },
      depositId: depositIdFor(resto.originBankCode, resto.interbankTransferId),
      /*
       * Los dos sellos de tiempo, y separados a propósito: con uno solo no se
       * puede distinguir un reloj desfasado de un depósito que tardó en llegar,
       * y los dos se arreglan distinto.
       */
      partnerTimestamp: timestamp,
      requestedAt: new Date().toISOString(),
    });
    await this.publisher.publish(
      envelopeForRequest(payload, paymentInterbankReceiveV1.name, null, correlationId, {
        idempotencyKey: payload.idempotencyKey,
      }),
    );
    return { depositId: payload.depositId, correlationId };
  }
}

/** Stable receipt across partner retries; UUID format is required by the message contract. */
function depositIdFor(bank: string, transfer: string): string {
  const bytes = createHash('sha256')
    .update('bank-usac/interbank/v1\0')
    .update(bank)
    .update('\0')
    .update(transfer)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
