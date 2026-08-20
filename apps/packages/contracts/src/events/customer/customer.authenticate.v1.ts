import { z } from 'zod';

import { defineContract } from '../contract';

/**
 * Verify a customer's credentials.
 *
 * Asynchronous request/reply: the Gateway waits on `bank.replies` for at most
 * five seconds. The credential travels here in the clear on the broker, which
 * is acceptable only because the broker is not reachable from outside the
 * cluster; it must never reach a log, an audit event or the reply.
 *
 * Email is the login identifier (decision D-05 of T-02), not the username.
 */
export const customerAuthenticateV1 = defineContract({
  name: 'customer.authenticate.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['customer-service'],
  schema: z.object({
    email: z.email(),
    /** Never logged, never echoed, never republished. */
    credential: z.string().min(1).max(256),
  }),
});

export type CustomerAuthenticateV1 = z.infer<typeof customerAuthenticateV1.schema>;
