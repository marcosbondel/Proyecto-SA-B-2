import { z } from 'zod';

import { transactionStatus, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/** How many rows one screen may ask for at once. */
export const MAX_TRANSACTION_ROWS = 100;

/**
 * Ask for a list of transfers — the query that closes TD-033.
 *
 * `GET /api/transfers/{id}` has existed since T-18 and answers "how did this one
 * end". Nothing answered "which transfers are mine", so `/transferencias`
 * offered a lookup by identifier and said why there was no list, which is
 * honest and is not what somebody wants after their third transfer.
 *
 * **Every filter here is a request, not a permission.** Who may see which
 * transfers is Transaction Service's decision, made from the envelope identity
 * against the `customer_id` it now records at request time. A `CLIENTE` naming
 * somebody else's `customerId` gets an empty list rather than a `403`, for the
 * reason the account listing does the same: a distinguishable refusal is a way
 * to discover which customers exist.
 */
export const transactionListQueryV1 = defineContract({
  name: 'transaction.list.query.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['transaction-service'],
  schema: z.object({
    /** Narrow to one customer's transfers. Staff only, in effect. */
    customerId: uuidV4.optional(),
    /** Narrow to the transfers that touched one account, either side. */
    accountId: uuidV4.optional(),
    status: transactionStatus.optional(),
    limit: z.int().positive().max(MAX_TRANSACTION_ROWS).optional(),
  }),
});

export type TransactionListQueryV1 = z.infer<typeof transactionListQueryV1.schema>;
