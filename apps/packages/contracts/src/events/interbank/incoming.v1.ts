import { z } from 'zod';

import {
  amountMinor,
  currencyCode,
  idempotencyKey,
  isoTimestamp,
  uuidV4,
} from '../../schemas/primitives';
import { defineContract } from '../contract';

/** Provisional wire shapes until the course publishes its OpenAPI contract. */
export const bankCode = z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/);
export const interbankTransferId = z.string().min(1).max(128);
export const interbankMoney = z.object({ amountMinor, currency: currencyCode });
export const interbankRejectionReason = z.enum([
  'ACCOUNT_NOT_FOUND',
  'ACCOUNT_INACTIVE',
  'AMOUNT_EXCEEDS_LIMIT',
  'UNSUPPORTED_CURRENCY',
  'WRONG_DESTINATION_BANK',
  'BANK_NOT_AUTHORIZED',
  'INVALID_REQUEST',
  'IDEMPOTENCY_CONFLICT',
]);

export const paymentInterbankReceiveV1 = defineContract({
  name: 'payment.interbank.receive.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['payment-service'],
  schema: z.object({
    depositId: uuidV4,
    interbankTransferId,
    idempotencyKey,
    originBankCode: bankCode,
    destinationBankCode: bankCode,
    accountId: uuidV4,
    amount: interbankMoney,
    requestedAt: isoTimestamp,
  }),
});
export type PaymentInterbankReceiveV1 = z.infer<typeof paymentInterbankReceiveV1.schema>;

export const accountInterbankEligibilityQueryV1 = defineContract({
  name: 'account.interbank.eligibility.query.v1',
  category: 'command',
  producer: 'payment-service',
  consumers: ['account-service'],
  schema: z.object({ depositId: uuidV4, accountId: uuidV4 }),
});
export type AccountInterbankEligibilityQueryV1 = z.infer<
  typeof accountInterbankEligibilityQueryV1.schema
>;

export const accountInterbankEligibilityRepliedV1 = defineContract({
  name: 'account.interbank.eligibility.replied.v1',
  category: 'reply',
  producer: 'account-service',
  consumers: ['payment-service'],
  schema: z
    .object({
      depositId: uuidV4,
      accountId: uuidV4,
      eligible: z.boolean(),
      reason: z.enum(['ACCOUNT_NOT_FOUND', 'ACCOUNT_INACTIVE']).nullable(),
    })
    .refine((value) => value.eligible === (value.reason === null), { path: ['reason'] }),
});
export type AccountInterbankEligibilityRepliedV1 = z.infer<
  typeof accountInterbankEligibilityRepliedV1.schema
>;

export const accountInterbankCreditRequestedV1 = defineContract({
  name: 'account.interbank.credit.requested.v1',
  category: 'command',
  producer: 'payment-service',
  consumers: ['account-service'],
  schema: z.object({ depositId: uuidV4, accountId: uuidV4, amount: interbankMoney }),
});
export type AccountInterbankCreditRequestedV1 = z.infer<
  typeof accountInterbankCreditRequestedV1.schema
>;

export const accountInterbankCreditedV1 = defineContract({
  name: 'account.interbank.credited.v1',
  category: 'event',
  producer: 'account-service',
  consumers: ['payment-service', 'notification-audit-service'],
  schema: z.object({ depositId: uuidV4, accountId: uuidV4, creditedAt: isoTimestamp }),
});
export type AccountInterbankCreditedV1 = z.infer<typeof accountInterbankCreditedV1.schema>;

export const accountInterbankCreditRejectedV1 = defineContract({
  name: 'account.interbank.credit.rejected.v1',
  category: 'event',
  producer: 'account-service',
  consumers: ['payment-service', 'notification-audit-service'],
  schema: z.object({
    depositId: uuidV4,
    accountId: uuidV4,
    reason: z.enum(['ACCOUNT_NOT_FOUND', 'ACCOUNT_INACTIVE', 'INVALID_REQUEST']),
  }),
});
export type AccountInterbankCreditRejectedV1 = z.infer<
  typeof accountInterbankCreditRejectedV1.schema
>;

export const paymentInterbankAcceptedV1 = defineContract({
  name: 'payment.interbank.accepted.v1',
  category: 'event',
  producer: 'payment-service',
  consumers: ['notification-audit-service'],
  schema: z.object({ depositId: uuidV4, decidedAt: isoTimestamp }),
});
export type PaymentInterbankAcceptedV1 = z.infer<typeof paymentInterbankAcceptedV1.schema>;

export const paymentInterbankRejectedV1 = defineContract({
  name: 'payment.interbank.rejected.v1',
  category: 'event',
  producer: 'payment-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    depositId: uuidV4,
    reason: interbankRejectionReason,
    decidedAt: isoTimestamp,
  }),
});
export type PaymentInterbankRejectedV1 = z.infer<typeof paymentInterbankRejectedV1.schema>;
