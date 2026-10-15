import { z } from 'zod';

import { money, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';
import { interbankDestination } from '../interbank/outgoing.v1';
import { paymentScenario } from '../transaction/transfer.requested.v1';

/**
 * Step 4 of the transfer Saga: process the payment.
 *
 * Transaction Service orders this; Payment Service does **not** react to
 * `account.debited.v1` directly. That is what `docs/domain/use-cases.md` §6
 * fixed, and it is what keeps the Saga's state in one place without turning
 * Transaction Service into a central coordinator.
 */
export const paymentRequestedV1 = defineContract({
  name: 'payment.requested.v1',
  category: 'command',
  producer: 'transaction-service',
  consumers: ['payment-service'],
  schema: z.object({
    paymentId: uuidV4,
    transactionId: uuidV4,
    amount: money,
    /**
     * The demonstration scenario, carried the last leg of its journey.
     *
     * T-15 added `paymentScenario` to `transfer.requested.v1` so a demonstration
     * could choose how the Saga ends, and the Gateway validates it without ever
     * obeying it. But the service that *can* obey it is Payment Service, and
     * nothing in the catalogue reached it: `payment.requested.v1` carried an
     * amount and two identifiers. The field was being accepted at the door and
     * dropped one room short of the only consumer able to act on it.
     *
     * T-18 carries it the rest of the way. Additive and optional, exactly like
     * the T-15 amendment: a message that omits it validates as before, so the
     * version does not move and no binding changes. Transaction Service copies
     * the value it was given and decides nothing from it — obeying the scenario
     * is Payment Service's business (T-19), and deciding it here would put a
     * Saga outcome in the hands of the service that merely records it.
     */
    scenario: paymentScenario.optional(),

    /**
     * A quién hay que pedirle el pago, cuando no es el proveedor simulado
     * (T-47, §4.1 — Integración interbancaria).
     *
     * Opcional y aditivo, con la misma forma que `scenario`: un mensaje que lo
     * omite se paga como siempre. Cuando viene, Payment Service no llama al
     * proveedor simulado sino al **Gateway del banco pareja**, por HTTP, y
     * entonces pasa la única cosa que el resto de este servicio no sabía hacer:
     * la respuesta **no llega al momento**. El otro banco contesta `202
     * Accepted` y su decisión vuelve después, por callback.
     *
     * Transaction Service lo copia de `transfer.requested.v1` y no decide nada
     * con él, exactamente como hace con el escenario: a quién se le pide el
     * dinero es asunto de Payment, y decidirlo en el orquestador pondría una
     * salida de la Saga en manos del servicio que sólo la registra.
     */
    interbank: interbankDestination.optional(),
  }),
});

export type PaymentRequestedV1 = z.infer<typeof paymentRequestedV1.schema>;
