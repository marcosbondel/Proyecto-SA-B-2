import { z } from 'zod';

import { uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * Change a customer's data.
 *
 * Every field is optional because this is a partial update, but the message is
 * refused when none is present: an update that changes nothing is a caller bug
 * that would otherwise emit a `customer.updated` saying nothing happened.
 *
 * Email, document, role and credential are **not** updatable here. Each has its
 * own invariant (C-1, C-3, C-6) and changing it is a different use case.
 */
export const customerUpdateV1 = defineContract({
  name: 'customer.update.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['customer-service'],
  schema: z
    .object({
      customerId: uuidV4,
      fullName: z.string().min(1).max(200).optional(),
      address: z.string().min(1).max(300).optional(),
      dateOfBirth: z.iso.date().optional(),
    })
    .refine(
      (value) =>
        value.fullName !== undefined ||
        value.address !== undefined ||
        value.dateOfBirth !== undefined,
      { message: 'an update must change at least one field' },
    ),
});

export type CustomerUpdateV1 = z.infer<typeof customerUpdateV1.schema>;
