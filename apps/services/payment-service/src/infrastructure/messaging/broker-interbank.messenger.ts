import { EXCHANGES, catalogByName, followUpEnvelope, routingKeyFor } from '@bank/contracts';
import type { MessageEnvelope } from '@bank/contracts';
import type { MessageBroker } from '@bank/messaging';

import type { InterbankMessenger } from '../../application/interbank.ports';
import type { InterbankSendMessenger } from '../../application/interbank-send.ports';

/** Commands to Account are isolated from the Saga payment publisher. */
export class BrokerInterbankMessenger implements InterbankMessenger, InterbankSendMessenger {
  constructor(readonly broker: MessageBroker) {}

  async command(
    cause: MessageEnvelope<unknown>,
    messageType: string,
    payload: unknown,
  ): Promise<void> {
    const envelope = this.#build(cause, messageType, payload, 'command');
    await this.broker.publish(EXCHANGES.commands, routingKeyFor(messageType), envelope);
  }

  result(
    cause: MessageEnvelope<unknown>,
    messageType: string,
    payload: unknown,
  ): MessageEnvelope<unknown> {
    return this.#build(cause, messageType, payload, 'event');
  }

  async publishStored(envelope: MessageEnvelope<unknown>): Promise<void> {
    await this.broker.publish(EXCHANGES.events, routingKeyFor(envelope.messageType), envelope);
  }

  /**
   * Un evento, con la causa de la que hereda la correlación (T-47).
   *
   * Lo usa el envío de depósitos para tres cosas distintas: el cambio de estado
   * para la auditoría, y los dos finales que la Saga ya entiende
   * (`payment.succeeded.v1` y `payment.failed.v1`). Pasa por `#build`, así que
   * el contrato se valida antes de salir y este servicio no puede publicar un
   * mensaje del que no es productor — ni confundir un comando con un evento.
   */
  async event(
    cause: MessageEnvelope<unknown>,
    messageType: string,
    payload: unknown,
  ): Promise<void> {
    const envelope = this.#build(cause, messageType, payload, 'event');
    await this.broker.publish(EXCHANGES.events, routingKeyFor(messageType), envelope);
  }

  #build(
    cause: MessageEnvelope<unknown>,
    messageType: string,
    payload: unknown,
    category: 'command' | 'event',
  ): MessageEnvelope<unknown> {
    const contract = catalogByName.get(messageType);
    if (contract?.category !== category || contract.producer !== 'payment-service') {
      throw new Error(`Payment Service cannot publish ${messageType} as ${category}`);
    }
    const parsed = contract.schema.parse(payload);
    return followUpEnvelope(cause, parsed, {
      messageType,
      producer: 'payment-service',
      idempotencyKey: cause.idempotencyKey,
    });
  }
}
