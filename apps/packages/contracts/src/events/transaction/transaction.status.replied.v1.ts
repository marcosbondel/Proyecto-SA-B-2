import { z } from 'zod';

import {
  failureCode,
  isoTimestamp,
  money,
  transactionStatus,
  uuidV4,
} from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The answer to `transaction.status.requested.v1`.
 *
 * `reason` is present exactly when the transfer did not complete, and it is one
 * of the closed failure codes — never free text and never an internal message.
 * A status reply is the most likely thing a customer sees after a timeout, so
 * it is the last place that should leak an implementation detail.
 */
export const transactionStatusRepliedV1 = defineContract({
  name: 'transaction.status.replied.v1',
  category: 'reply',
  producer: 'transaction-service',
  consumers: ['gateway'],
  schema: z.discriminatedUnion('outcome', [
    z.object({
      outcome: z.literal('FOUND'),
      transactionId: uuidV4,
      status: transactionStatus,
      amount: money,
      reason: failureCode.nullable(),
      createdAt: isoTimestamp,
      updatedAt: isoTimestamp,
    }),
    z.object({
      outcome: z.literal('NOT_FOUND'),
    }),
  ]),
});

export type TransactionStatusRepliedV1 = z.infer<typeof transactionStatusRepliedV1.schema>;
