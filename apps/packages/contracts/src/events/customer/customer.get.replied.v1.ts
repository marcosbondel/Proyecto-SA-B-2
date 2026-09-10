import { z } from 'zod';

import { failureCode, role, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The answer to `customer.get.query.v1`, matched by `correlationId`.
 *
 * `FOUND` carries the record the authorised caller needs to display or edit it;
 * it is never published to the audit exchanges (a reply goes only to the
 * gateway), so the personal fields here are not the audit-store leak the
 * redaction rules guard against. The credential and the activation token are
 * **not** here and never leave the service. An unauthorised or unknown id is
 * `NOT_FOUND`, indistinguishable on purpose.
 */
export const customerGetRepliedV1 = defineContract({
  name: 'customer.get.replied.v1',
  category: 'reply',
  producer: 'customer-service',
  consumers: ['gateway'],
  schema: z.discriminatedUnion('outcome', [
    z.object({
      outcome: z.literal('FOUND'),
      customerId: uuidV4,
      fullName: z.string(),
      identityDocument: z.string(),
      email: z.email(),
      dateOfBirth: z.iso.date(),
      address: z.string(),
      username: z.string(),
      role,
      status: z.enum(['PENDING_ACTIVATION', 'ACTIVE']),
      identityStatus: z.enum(['PENDING', 'VALIDATED', 'REJECTED']),
      kycStatus: z.enum(['PENDING', 'VERIFIED', 'REJECTED']),
    }),
    z.object({
      outcome: z.literal('NOT_FOUND'),
      reason: failureCode.extract(['CUSTOMER_NOT_FOUND']),
    }),
  ]),
});

export type CustomerGetRepliedV1 = z.infer<typeof customerGetRepliedV1.schema>;
