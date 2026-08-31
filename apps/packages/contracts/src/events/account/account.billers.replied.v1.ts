import { z } from 'zod';

import { uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The answer to `account.billers.query.v1`, matched by `correlationId`.
 *
 * Each entry carries the biller's **collection account**, because that is what
 * a service payment is a transfer to. No balance travels: what a biller has
 * collected is none of a paying customer's business, and this reply is read by
 * the screen that lets anyone pay one.
 */
export const accountBillersRepliedV1 = defineContract({
  name: 'account.billers.replied.v1',
  category: 'reply',
  producer: 'account-service',
  consumers: ['gateway'],
  schema: z.object({
    billers: z.array(
      z.object({
        code: z.string().min(1).max(20),
        name: z.string().min(1).max(60),
        accountId: uuidV4,
      }),
    ),
  }),
});

export type AccountBillersRepliedV1 = z.infer<typeof accountBillersRepliedV1.schema>;
