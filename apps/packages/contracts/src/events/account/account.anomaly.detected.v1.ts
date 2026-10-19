import { z } from 'zod';

import { accountType, isoTimestamp, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * An account was used more often than the configured limit allows (Fase 3,
 * §4.1 — Account Service, "Monitoreo de uso de cuentas", T-42).
 *
 * Published when the number of debits and credits on one account inside a
 * sliding window exceeds a threshold. Both numbers are configuration —
 * `ANOMALY_MAX_OPERATIONS` and `ANOMALY_WINDOW_MINUTES`, ten operations in
 * five minutes by default — and both travel in the event, so a consumer can say
 * *which* rule fired without reading the producer's configuration.
 *
 * **It reports and nothing more.** The account is not blocked: a block would
 * turn a signal into an outage for a customer who may have done nothing wrong,
 * and would make a debit that is already part of a transfer fail halfway
 * through its Saga. The reasoning is recorded in the ADR that closes T-42.
 *
 * **At most one per account per window.** After publishing, the producer stays
 * silent about that account for the same number of minutes, so a burst of
 * thirty operations is one event, not twenty.
 *
 * Carries no balance, document, name or address: the identifiers are enough to
 * find the account, and the audit trail joins them to everything else.
 */
export const accountAnomalyDetectedV1 = defineContract({
  name: 'account.anomaly.detected.v1',
  category: 'event',
  producer: 'account-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    accountId: uuidV4,
    customerId: uuidV4.optional(),
    accountType,
    /** Why it fired. Only one rule exists today; the field keeps the event closed to a second. */
    rule: z.literal('HIGH_FREQUENCY'),
    /** How many debits and credits were found in the window; always greater than `threshold`. */
    operationCount: z.int().positive(),
    /** The "N" of "more than N operations in M minutes". */
    threshold: z.int().positive(),
    /** The "M". */
    windowMinutes: z.int().positive(),
    /** The start of the window that was counted, `detectedAt` minus `windowMinutes`. */
    windowStart: isoTimestamp,
    detectedAt: isoTimestamp,
  }),
});

export type AccountAnomalyDetectedV1 = z.infer<typeof accountAnomalyDetectedV1.schema>;
