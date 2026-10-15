import { paymentInterbankCallbackReceivedV1 } from '@bank/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { GatewayError } from '../errors/gateway-error';
import { MESSAGE_PUBLISHER } from '../ports';
import type { MessagePublisherPort } from '../ports';
import { envelopeForRequest } from '../request-envelope';

/**
 * La decisión del banco pareja sobre un depósito que este banco envió (T-47).
 *
 * La entrada es la misma forma que la del depósito entrante de T-46 y por la
 * misma razón: §4.2 fija que todo lo que viene del banco pareja **entra por el
 * API Gateway**, y lo que el Gateway hace con ello es validarlo, publicarlo y
 * contestar — nunca decidir. Aquí eso es literal: si el depósito existe, si la
 * decisión llega a tiempo y si cambia algo son tres preguntas de Payment
 * Service, que es quien tiene la fila y la máquina de estados.
 *
 * Responde `202` en cuanto el comando está en el broker. El banco pareja no es
 * una persona esperando un veredicto, y sostener su conexión mientras una base
 * de datos escribe es cómo un callback acaba reintentándose por timeout
 * habiendo funcionado.
 */
@Injectable()
export class InterbankCallbackUseCase {
  constructor(@Inject(MESSAGE_PUBLISHER) readonly publisher: MessagePublisherPort) {}

  async receive(body: unknown, correlationId: string): Promise<{ correlationId: string }> {
    /*
     * El contrato es una unión discriminada, así que esto rechaza por
     * construcción un `ACCEPTED` con motivo y un `REJECTED` sin él. No hace
     * falta una regla aparte: la forma es la regla.
     */
    const parsed = paymentInterbankCallbackReceivedV1.schema.safeParse(body);

    if (!parsed.success) {
      throw GatewayError.validation(
        parsed.error.issues[0]?.message ?? 'Callback interbancario inválido.',
        parsed.error.issues[0]?.path.join('.'),
      );
    }

    await this.publisher.publish(
      envelopeForRequest(
        parsed.data,
        paymentInterbankCallbackReceivedV1.name,
        null,
        correlationId,
        {
          /*
           * La clave de idempotencia del callback es el identificador del
           * depósito: dos callbacks del mismo depósito son el mismo mensaje,
           * digan lo que digan. Que la segunda decisión no cuente lo garantiza
           * la máquina de estados de Payment, no esta clave — pero esto evita
           * que el broker trate dos entregas idénticas como dos trabajos.
           */
          idempotencyKey: parsed.data.interbankTransferId,
        },
      ),
    );

    return { correlationId };
  }
}
