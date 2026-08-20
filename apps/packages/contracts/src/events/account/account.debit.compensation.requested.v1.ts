import { z } from 'zod';

import { failureCode, money, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * Put the money back into the source account.
 *
 * The single compensation path, reached from two different failures — a failed
 * payment at step 4 and a rejected credit at step 6. `triggeredBy` records
 * which one, because the audit record has to explain *why* money moved twice.
 */
export const accountDebitCompensationRequestedV1 = defineContract({
  name: 'account.debit.compensation.requested.v1',
  category: 'command',
  producer: 'transaction-service',
  consumers: ['account-service'],
  schema: z.object({
    transactionId: uuidV4,
    accountId: uuidV4,
    amount: money,
    triggeredBy: failureCode.extract([
      'PAYMENT_DECLINED',
      'PAYMENT_RETRIES_EXHAUSTED',
      'ACCOUNT_NOT_FOUND',
      'INVALID_AMOUNT_PRECISION',
    ]),
  }),
});

export type AccountDebitCompensationRequestedV1 = z.infer<
  typeof accountDebitCompensationRequestedV1.schema
>;
