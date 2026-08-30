import { z } from 'zod';

import { defineContract } from '../contract';

/**
 * Somebody asked to recover the password of the account behind this address.
 *
 * The address is all this carries, and the command is **answered by nobody**:
 * the Gateway accepts it and reports the same thing whether or not the address
 * belongs to an account. A route that behaved differently for a known and an
 * unknown address would be an account-enumeration oracle open to the whole
 * internet — the same reasoning that keeps the sign-in failure generic
 * (FR-013) and the activation rejection unspecific.
 *
 * So the interesting outcome is not a reply. It is the email, or its absence.
 */
export const customerPasswordResetRequestedV1 = defineContract({
  name: 'customer.password-reset.requested.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['customer-service'],
  schema: z.object({
    email: z.email(),
  }),
});

export type CustomerPasswordResetRequestedV1 = z.infer<
  typeof customerPasswordResetRequestedV1.schema
>;
