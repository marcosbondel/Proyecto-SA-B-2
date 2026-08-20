import { z } from 'zod';

import { photoReference } from '../../dto/photo-reference.dto';
import { role, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * Register a customer.
 *
 * The credential travels in this message and in no other. It is the one field
 * in the whole catalogue that must never be logged, never echoed back and
 * never re-published: Customer Service hashes it on receipt and the plaintext
 * ends there (`docs/domain/entities.md`, "Access credential — never leaves the
 * service").
 */
export const customerRegisterV1 = defineContract({
  name: 'customer.register.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['customer-service'],
  schema: z.object({
    customerId: uuidV4,
    fullName: z.string().min(1).max(200),
    identityDocument: z.string().min(1).max(50),
    email: z.email(),
    /** Validated for coherence by the service, not by the wire format (C-5). */
    dateOfBirth: z.iso.date(),
    address: z.string().min(1).max(300),
    role,
    /** Never logged. See the note above. */
    credential: z.string().min(8).max(256),
    /** Absent until the document is uploaded; identity validation is separate. */
    photo: photoReference.nullable(),
  }),
});

export type CustomerRegisterV1 = z.infer<typeof customerRegisterV1.schema>;
