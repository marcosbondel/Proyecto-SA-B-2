import { z } from 'zod';

import { isoTimestamp, money, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * A per-transaction commission was charged, on top of `account.debited.v1`
 * (Fase 2, §4.1 p. 6: "Comisión por transacción (opcional)").
 *
 * Published only when the debited account's type has a commission configured
 * (`account-type-rules.ts`) — never for a type that does not, which is what
 * makes the rule "opcional" a fact about this event's presence rather than a
 * field that is sometimes zero.
 *
 * Deliberately a **separate** event from `account.debited.v1`, not a field on
 * it: Transaction Service's Saga compares `account.debited.v1.amount` against
 * the amount it asked to move, and a payload that silently grew by the
 * commission would break that equality. `amount` here is the commission
 * itself; `balanceAfter` is the balance once both the debit and the
 * commission have been applied, so the ledger is a single number, never two
 * that disagree.
 */
export const accountCommissionChargedV1 = defineContract({
  name: 'account.commission.charged.v1',
  category: 'event',
  producer: 'account-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    accountId: uuidV4,
    /** The transfer this commission was charged for. */
    transactionId: uuidV4,
    amount: money,
    balanceAfter: money,
    chargedAt: isoTimestamp,
  }),
});

export type AccountCommissionChargedV1 = z.infer<typeof accountCommissionChargedV1.schema>;
