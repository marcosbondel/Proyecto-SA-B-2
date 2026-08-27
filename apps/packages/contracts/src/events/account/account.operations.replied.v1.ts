import { z } from 'zod';

import {
  accountOperationStatus,
  accountOperationType,
  failureCode,
  isoTimestamp,
  money,
  uuidV4,
} from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The answer to `account.operations.query.v1`, matched by `correlationId`.
 *
 * `balanceAfter` is stored with each movement rather than recomputed by the
 * reader. A statement whose running total is derived at display time disagrees
 * with the ledger the moment two movements share a timestamp, and the person
 * reading it has no way to tell which number is the real one.
 *
 * `NOT_FOUND` covers both "no such account" and "not yours" for the same reason
 * the list reply has no error outcome: a distinguishable refusal is a probe.
 */
export const accountOperationsRepliedV1 = defineContract({
  name: 'account.operations.replied.v1',
  category: 'reply',
  producer: 'account-service',
  consumers: ['gateway'],
  schema: z.discriminatedUnion('outcome', [
    z.object({
      outcome: z.literal('FOUND'),
      accountId: uuidV4,
      operations: z.array(
        z.object({
          operationId: uuidV4,
          type: accountOperationType,
          amount: money,
          balanceAfter: money,
          /** The Saga this movement belongs to, or `null` for an opening. */
          transactionId: uuidV4.nullable(),
          status: accountOperationStatus,
          occurredAt: isoTimestamp,
        }),
      ),
    }),
    z.object({
      outcome: z.literal('NOT_FOUND'),
      reason: failureCode.extract(['ACCOUNT_NOT_FOUND']),
    }),
  ]),
});

export type AccountOperationsRepliedV1 = z.infer<typeof accountOperationsRepliedV1.schema>;
