import { z } from 'zod';

import { isoTimestamp, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/** A sign-in was accepted. Audit trail only; nobody decides anything on it. */
export const customerLoginSucceededV1 = defineContract({
  name: 'customer.login.succeeded.v1',
  category: 'event',
  producer: 'customer-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    customerId: uuidV4,
    /** First successful sign-in triggers activation delivery (§4.1, p. 5). */
    firstLogin: z.boolean(),
    occurredAt: isoTimestamp,
  }),
});

export type CustomerLoginSucceededV1 = z.infer<typeof customerLoginSucceededV1.schema>;
