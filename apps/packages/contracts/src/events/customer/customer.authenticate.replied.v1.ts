import { z } from 'zod';

import { failureCode, role, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The answer to `customer.authenticate.v1`, matched by `correlationId`.
 *
 * It returns **claims, not a token**: the Gateway is the only component that
 * signs and validates the session JWT (ADR-010), so Customer Service says who
 * the user is and the Gateway decides what to mint from that.
 *
 * The rejection carries a single, deliberately uninformative code. Telling the
 * caller whether the email exists would turn the login endpoint into an
 * account-enumeration oracle, so `INVALID_CREDENTIALS` is returned whether the
 * address is unknown or the password is wrong.
 */
export const customerAuthenticateRepliedV1 = defineContract({
  name: 'customer.authenticate.replied.v1',
  category: 'reply',
  producer: 'customer-service',
  consumers: ['gateway'],
  schema: z.discriminatedUnion('outcome', [
    z.object({
      outcome: z.literal('APPROVED'),
      claims: z.object({
        customerId: uuidV4,
        username: z.string().min(1).max(100),
        role,
      }),
      /** True when the account still needs email activation (C-4). */
      activationPending: z.boolean(),
    }),
    z.object({
      outcome: z.literal('REJECTED'),
      /** Always INVALID_CREDENTIALS. Never distinguishes unknown from wrong. */
      reason: failureCode.extract(['INVALID_CREDENTIALS']),
    }),
  ]),
});

export type CustomerAuthenticateRepliedV1 = z.infer<typeof customerAuthenticateRepliedV1.schema>;
