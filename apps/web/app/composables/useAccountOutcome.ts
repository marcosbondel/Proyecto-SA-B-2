import { outcomeFromAccountAudit } from '../lib/account';

/**
 * `useCommandOutcome`, told which messages end an account opening.
 *
 * `account.opened.v1` is success and `account.open.rejected.v1` is a refusal.
 * The second of those is a message T-17 had to add: before it, a refused
 * opening produced silence, and this composable would have reported a timeout
 * for something that had already been decided.
 *
 * As with customers, only an `ADMINISTRADOR` session can read the trail, so
 * everyone else stays at `PENDING` with the `accountId` and the correlation in
 * hand. For an account that is more useful than it sounds: the identifier is
 * real the moment the Gateway answers, and `/cuentas/<id>` will show the
 * balance as soon as the account exists.
 */
export function useAccountOutcome() {
  return useCommandOutcome(outcomeFromAccountAudit);
}
