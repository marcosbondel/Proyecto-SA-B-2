import { z } from 'zod';

import { failureCode, isoTimestamp } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * A sign-in was refused.
 *
 * Deliberately carries **no `customerId`**: including one would confirm that
 * the email belongs to somebody, which is exactly what the safe reason of
 * `customer.authenticate.replied.v1` refuses to reveal. Leaking it through the
 * audit event instead of the reply would be the same leak by another route.
 */
export const customerLoginRejectedV1 = defineContract({
  name: 'customer.login.rejected.v1',
  category: 'event',
  producer: 'customer-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    reason: failureCode.extract(['INVALID_CREDENTIALS']),
    occurredAt: isoTimestamp,
  }),
});

export type CustomerLoginRejectedV1 = z.infer<typeof customerLoginRejectedV1.schema>;
