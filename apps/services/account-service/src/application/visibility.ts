import type { Identity } from '@bank/contracts';

import type { Account } from '../domain/account';
import type { AccountFilter } from './ports';

/**
 * Decision D-06, applied by the service that owns the data.
 *
 * The Gateway cannot make this call and says so in its own comments: it holds
 * no account table, so it cannot know who owns what. Here the row is in hand,
 * and the matrix is one line — "Query a balance: ✔ own accounts | ✔ any account
 * | ✔ any account".
 *
 * A `null` identity means the message came from the system rather than from a
 * person — the scheduler, a Saga step — and those are not reads on anyone's
 * behalf. They never reach this function.
 */
export function mayRead(identity: Identity | null, account: Account): boolean {
  if (identity === null) {
    return false;
  }

  return identity.role === 'CLIENTE' ? identity.customerId === account.customerId : true;
}

/**
 * Narrows a requested filter to what this identity may actually see, or `null`
 * when the answer is "nothing".
 *
 * A `CLIENTE` is pinned to their own `customerId` whatever they asked for, so a
 * caller who names somebody else's id gets an empty list rather than a refusal.
 * Same reasoning as `mayRead`: a refusal that distinguishes "not yours" from
 * "not there" is a lookup service for other people's accounts.
 *
 * `null` in, `null` out — and the caller answers with an empty list, not with
 * an unfiltered one. Returning `requested` unchanged for an unidentified caller
 * is the shape of mistake that leaks a whole table.
 */
export function visibleFilter(
  identity: Identity | null,
  requested: AccountFilter,
): AccountFilter | null {
  if (identity === null) {
    return null;
  }

  return identity.role === 'CLIENTE'
    ? { ...requested, customerId: identity.customerId }
    : requested;
}
