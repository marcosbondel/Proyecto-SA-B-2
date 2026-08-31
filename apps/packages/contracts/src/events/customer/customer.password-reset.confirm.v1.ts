import { z } from 'zod';

import { defineContract } from '../contract';

/**
 * The reset link was opened and a new password was chosen.
 *
 * The token and the credential travel together and only here. The token is
 * looked up by digest, exactly as an activation token is, so a dump of the
 * table hands nobody a usable link; the credential is hashed by the owning
 * service with the same scrypt parameters registration uses, and the clear
 * value is never stored.
 *
 * The bounds are stated here rather than only in the browser because a rule
 * that lives in the form is a suggestion — this message can arrive from
 * anywhere the Gateway can be reached. They are the same bounds
 * `customer.register.v1` puts on the credential it carries: a password chosen
 * on this screen and one chosen at registration must be equally acceptable, or
 * the reset becomes a way to set a password the sign-up would have refused.
 */
export const customerPasswordResetConfirmV1 = defineContract({
  name: 'customer.password-reset.confirm.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['customer-service'],
  schema: z.object({
    resetToken: z.string().min(16).max(512),
    credential: z.string().min(8).max(256),
  }),
});

export type CustomerPasswordResetConfirmV1 = z.infer<typeof customerPasswordResetConfirmV1.schema>;
