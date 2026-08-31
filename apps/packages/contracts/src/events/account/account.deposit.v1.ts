import { z } from 'zod';

import { money, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * A teller took cash at a window and is crediting an account with it.
 *
 * `A-05` in the prototype, and the one movement in this system that has **no
 * counterparty**. A transfer moves money between two accounts and needs a Saga
 * to keep both sides consistent; a deposit adds money that arrived from outside
 * the bank, so there is nothing to debit, nothing to compensate, and no second
 * service that has to agree. Routing it through Transaction Service would mean
 * a transfer with a null source account and a state machine with a path that
 * never fails — which is how an orchestrator becomes the "god object" §4.1
 * penalises.
 *
 * `depositId` is minted by the Gateway and travels as the operation's own
 * identifier, so the receipt a teller is handed names something that exists
 * even when the command is redelivered.
 */
export const accountDepositV1 = defineContract({
  name: 'account.deposit.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['account-service'],
  schema: z.object({
    depositId: uuidV4,
    accountId: uuidV4,
    amount: money,
    /**
     * What the teller wrote on the slip. Free text, bounded, and **never a
     * place for a name or a document number** — the trail redacts by field name
     * and this field is not on that list, so anything typed here is stored as
     * written. The interface says so.
     */
    description: z.string().trim().min(1).max(140).optional(),
  }),
});

export type AccountDepositV1 = z.infer<typeof accountDepositV1.schema>;
