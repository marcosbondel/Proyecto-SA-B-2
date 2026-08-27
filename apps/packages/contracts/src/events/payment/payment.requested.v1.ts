import { z } from 'zod';

import { money, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';
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
  }),
});

export type PaymentRequestedV1 = z.infer<typeof paymentRequestedV1.schema>;
