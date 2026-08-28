import { z } from 'zod';

import { failureCode, isoTimestamp } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * A registration was refused, and no customer exists.
 *
 * The catalogue had no such message: `customer.registered.v1` announced the
 * success and nothing announced the refusal, so a duplicated document or email
 * produced **silence**. Silence is indistinguishable from a message still in
 * flight, which left the interface no honest option but to wait out its timeout
 * and say it did not know (recorded as TD-022 while it was true).
 *
 * It carries **no `customerId`**, because none was created, and no email or
 * document, because the reason already names which of the two collided and
 * repeating the value would put personal data in the audit store for no
 * decision that depends on it.
 *
 * `INVALID_BIRTH_DATE` is here for the same reason as the other two: C-5 makes
 * an incoherent date a rejection of the whole registration, not a field error
 * the caller can be told about synchronously — the command was already accepted
 * with a `202` by then.
 */
export const customerRegisterRejectedV1 = defineContract({
  name: 'customer.register.rejected.v1',
  category: 'event',
  producer: 'customer-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    /** Which invariant refused it. Safe to show a person, by construction. */
    reason: failureCode.extract([
      'DOCUMENT_ALREADY_REGISTERED',
      'EMAIL_ALREADY_REGISTERED',
      'INVALID_BIRTH_DATE',
      'ROLE_NOT_ELIGIBLE',
    ]),
    rejectedAt: isoTimestamp,
  }),
});

export type CustomerRegisterRejectedV1 = z.infer<typeof customerRegisterRejectedV1.schema>;
