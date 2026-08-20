import { z } from 'zod';

import { uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * Ask what happened to a transfer.
 *
 * This is what makes the five-second reply timeout survivable. When the Gateway
 * stops waiting it does **not** cancel anything — the Saga carries on — so the
 * caller needs a way to come back and ask. Either identifier works: the
 * transaction's own id, or the correlation id of the flow that started it.
 */
export const transactionStatusRequestedV1 = defineContract({
  name: 'transaction.status.requested.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['transaction-service'],
  schema: z
    .object({
      transactionId: uuidV4.optional(),
      correlationId: uuidV4.optional(),
    })
    .refine((value) => value.transactionId !== undefined || value.correlationId !== undefined, {
      message: 'one of transactionId or correlationId is required',
    }),
});

export type TransactionStatusRequestedV1 = z.infer<typeof transactionStatusRequestedV1.schema>;
