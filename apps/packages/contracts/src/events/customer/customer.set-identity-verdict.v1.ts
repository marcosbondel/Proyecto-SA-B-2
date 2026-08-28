import { z } from 'zod';

import { uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * A teller's manual verdict on a customer's identity document.
 *
 * The assignment's flow is that a `CAJERO_RECEPTOR` reviews the document photo a
 * customer uploaded and accepts or refuses it — a human decision, not the
 * automatic digest/type/size check that runs when the photo is first submitted.
 * This is that decision. Authorisation (staff only) is the owning service's,
 * made from the envelope identity; the Gateway also guards the route.
 *
 * `VALIDATED` is terminal (the domain refuses to re-open an already-validated
 * identity), so a second approval is a no-op rather than a way to swap in a
 * different accepted document.
 */
export const customerSetIdentityVerdictV1 = defineContract({
  name: 'customer.set-identity-verdict.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['customer-service'],
  schema: z.object({
    customerId: uuidV4,
    verdict: z.enum(['VALIDATED', 'REJECTED']),
  }),
});

export type CustomerSetIdentityVerdictV1 = z.infer<typeof customerSetIdentityVerdictV1.schema>;
