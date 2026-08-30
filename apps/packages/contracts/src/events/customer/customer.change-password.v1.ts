import { z } from 'zod';

import { uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * Change the password of an account somebody is already signed into.
 *
 * The sibling of `customer.password-reset.confirm.v1`, and the difference is
 * the credential that authorises it. A reset is authorised by a token emailed
 * to an address; this is authorised by **knowing the current password**, which
 * is why `currentCredential` travels and is verified by the owning service
 * before anything changes. A session alone is not enough: a borrowed unlocked
 * laptop is the case this defends against, and it is the common one.
 *
 * `customerId` is the subject. Whether the actor in the envelope may change
 * this subject's password is Customer Service's decision, not the Gateway's —
 * the Gateway has no customer table and could not answer it.
 */
export const customerChangePasswordV1 = defineContract({
  name: 'customer.change-password.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['customer-service'],
  schema: z.object({
    customerId: uuidV4,
    /** Proof that whoever is typing is who they say. Never logged. */
    currentCredential: z.string().min(1).max(256),
    /** The same bounds registration puts on a credential. Never logged. */
    newCredential: z.string().min(8).max(256),
  }),
});

export type CustomerChangePasswordV1 = z.infer<typeof customerChangePasswordV1.schema>;
