import { z } from 'zod';

import { isoTimestamp, money, transactionStatus, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The money arrived. Terminal state.
 *
 * Carries `customerId` for the reason `transaction.compensated.v1` sets out at
 * length: the envelope's identity does not survive Payment Service's retry
 * sweeper, so a transfer that succeeds on a later attempt reaches Notification
 * & Audit with nobody to tell. The whole terminal family declares its subject
 * rather than only the events that happen to need it — a fallback that applies
 * to two of three contracts is an exception no reader of the third can see.
 */
export const transactionCompletedV1 = defineContract({
  name: 'transaction.completed.v1',
  category: 'event',
  producer: 'transaction-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    transactionId: uuidV4,
    customerId: uuidV4.nullable(),
    sourceAccount: uuidV4,
    targetAccount: uuidV4,
    amount: money,
    status: transactionStatus.extract(['COMPLETED']),
    completedAt: isoTimestamp,
  }),
});

export type TransactionCompletedV1 = z.infer<typeof transactionCompletedV1.schema>;
