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
 * One row of a transfer listing.
 *
 * Deliberately **thinner than `transaction.status.replied.v1`**: no payment
 * outcome, no Saga trace. A list is scanned, and a hundred rows each carrying a
 * nested payment object is a large reply to render four columns from. The
 * screen links to the single-transfer route for the rest, which is also where
 * the ownership check is applied per row rather than per page.
 */
const row = z.object({
  transactionId: uuidV4,
  sourceAccount: uuidV4,
  targetAccount: uuidV4,
  amount: money,
  status: transactionStatus,
  reason: failureCode.nullable(),
  createdAt: isoTimestamp,
  completedAt: isoTimestamp.nullable(),
});

/**
 * The answer to `transaction.list.query.v1`, matched by `correlationId`.
 *
 * `total` is the full count **before** the limit, so a screen can say "showing
 * 100 of 340" rather than implying that 100 is all there is. It counts what the
 * asker is entitled to see, not what exists.
 */
export const transactionListRepliedV1 = defineContract({
  name: 'transaction.list.replied.v1',
  category: 'reply',
  producer: 'transaction-service',
  consumers: ['gateway'],
  schema: z.object({
    transactions: z.array(row),
    total: z.int().nonnegative(),
  }),
});

export type TransactionListRepliedV1 = z.infer<typeof transactionListRepliedV1.schema>;
