import { z } from 'zod';

import { defineContract } from '../contract';

/**
 * Ask for the catalogue of billers a customer may pay.
 *
 * A question with no arguments, which is unusual enough to be worth saying out
 * loud: the catalogue is the same for everybody, it is not scoped by identity,
 * and there is nothing to narrow. It is asked rather than hard-coded in the
 * frontend because the biller's **collection account id** is what a payment is
 * actually sent to, and an account id compiled into a browser bundle is an
 * account id that is wrong the first time anything is reseeded.
 */
export const accountBillersQueryV1 = defineContract({
  name: 'account.billers.query.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['account-service'],
  schema: z.object({}),
});

export type AccountBillersQueryV1 = z.infer<typeof accountBillersQueryV1.schema>;
