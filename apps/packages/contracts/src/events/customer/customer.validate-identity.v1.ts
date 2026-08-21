import { z } from 'zod';

import { photoReference } from '../../dto/photo-reference.dto';
import { uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * Validate identity from the document photo.
 *
 * Carries a reference, never bytes (ADR-012). Customer Service fetches the
 * object, recomputes the digest and compares it before doing anything else, so
 * a reference that was swapped between the write and the read is caught rather
 * than accepted as an identity document.
 */
export const customerValidateIdentityV1 = defineContract({
  name: 'customer.validate-identity.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['customer-service'],
  schema: z.object({
    customerId: uuidV4,
    photo: photoReference,
  }),
});

export type CustomerValidateIdentityV1 = z.infer<typeof customerValidateIdentityV1.schema>;
