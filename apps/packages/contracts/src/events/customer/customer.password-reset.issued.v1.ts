import { z } from 'zod';

import { isoTimestamp, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * A reset link was issued; send the email that carries it.
 *
 * The sibling of `customer.activation.requested.v1`, and it carries the clear
 * token for the same reason that one does: Customer Service stores only a
 * digest, so this is the single message where the usable value travels. It must
 * never be logged, echoed, or written to the audit record — the redaction in
 * `notification-audit-service` drops it before the insert.
 *
 * This event is published **only when the address belongs to an account**. An
 * unknown address produces no event at all, which is what keeps the route from
 * telling the internet which addresses are registered.
 */
export const customerPasswordResetIssuedV1 = defineContract({
  name: 'customer.password-reset.issued.v1',
  category: 'event',
  producer: 'customer-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    customerId: uuidV4,
    email: z.email(),
    /** The link stops working here. One hour by default — shorter than an
     *  activation link, because this one changes a credential. */
    expiresAt: isoTimestamp,
    /** Opaque to everyone but the service that issued it. Never logged. */
    resetToken: z.string().min(16).max(512),
  }),
});

export type CustomerPasswordResetIssuedV1 = z.infer<typeof customerPasswordResetIssuedV1.schema>;
